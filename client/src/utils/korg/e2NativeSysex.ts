/**
 * Synthstudio — Korg Electribe 2 natives Sysex-Protokoll (v3.268.0)
 *
 * Reine Byte-Logik (keine MIDI-Seiteneffekte, voll unit-testbar) für das
 * ECHTE Geräteprotokoll `F0 42 3g 00 01 24 …`.
 *
 * NICHT verwechseln mit OTP (`F0 7D 01 02 …`, OmniTribeBridge.ts) — das ist
 * unser eigenes Firmware-Protokoll. Dieses Modul spricht mit einer Stock- oder
 * Hacktribe-Electribe.
 *
 * Frame-Layout:
 *   F0  42  3g  00  01  24  <cmd>  <body …>  F7
 *       │   │   │   └──┬──┘   └ Command-Byte
 *       │   │   │      └ Product-ID: 0x0124 = E2 Sampler, 0x0123 = E2 Synth
 *       │   │   └ Padding
 *       │   └ 0x30 + Global-Channel (0..15)
 *       └ Korg Manufacturer-ID
 *
 * Quelle: Korg „electribe sampler MIDI Implementation" Rev 1.00 (2015-04-27),
 * verifiziert gegen bangcorrupt/hacktribe-editor `utils/ht_sysex_format.py`
 * und keijiro/e2edit `SysExCodec.cs`. Details:
 * omnitribe `docs/reverse/electribe2_native_sysex.md`.
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
export const KORG_MANUFACTURER_ID = 0x42;

/** Product-ID des Electribe 2 **Sampler** (auch Hacktribe meldet sich so). */
export const PRODUCT_ID_E2_SAMPLER = 0x0124;
/** Product-ID des Electribe 2 **Synth**. */
export const PRODUCT_ID_E2_SYNTH = 0x0123;

/** Command-Bytes (msg_id). Nur die Pattern-/Global-Teilmenge, die auch auf
 *  Stock-Firmware existiert — 0x52..0x58 sind Hacktribe-Erweiterungen und
 *  bewusst NICHT Teil dieses Moduls. */
export const E2_CMD = {
  /** H→D: Edit-Buffer anfordern. Antwort: CURRENT_PATTERN_DUMP oder NAK. */
  CURRENT_PATTERN_DUMP_REQUEST: 0x10,
  /** H→D: Pattern-Slot anfordern (+ 2 Index-Bytes). Antwort: PATTERN_DUMP. */
  PATTERN_DUMP_REQUEST: 0x1c,
  /** H→D: Global-Settings anfordern. Antwort: GLOBAL_DUMP. */
  GLOBAL_DUMP_REQUEST: 0x0e,
  /** H→D: Edit-Buffer in Slot schreiben (+ 2 Index-Bytes). */
  PATTERN_WRITE_REQUEST: 0x11,
  /** H↔D: Edit-Buffer-Daten. */
  CURRENT_PATTERN_DUMP: 0x40,
  /** H↔D: Slot-Pattern-Daten (+ 2 Index-Bytes vor den Daten). */
  PATTERN_DUMP: 0x4c,
  /** H↔D: Global-Daten. */
  GLOBAL_DUMP: 0x51,
  /** D→H: Write OK. */
  WRITE_COMPLETED: 0x21,
  /** D→H: Write fehlgeschlagen. */
  WRITE_ERROR: 0x22,
  /** D→H: ACK. */
  DATA_LOAD_COMPLETED: 0x23,
  /** D→H: NAK. */
  DATA_LOAD_ERROR: 0x24,
  /** D→H: Frame-Format falsch (z. B. Länge). */
  DATA_FORMAT_ERROR: 0x26,
} as const;

/**
 * Alternativer Global-Request-Code. Korgs eigene Doku widerspricht sich:
 * der Detailblock nennt 0x1E, die Übersichtstabelle 0x0E. hacktribe nutzt
 * 0x0E, keijiro/e2edit nutzt 0x1E. Für Robustheit beide kennen.
 */
export const E2_CMD_GLOBAL_DUMP_REQUEST_ALT = 0x1e;

/** Roh-Größe eines PTST-Pattern-Bodys (ohne 0x100-Dateiheader). */
export const E2_PATTERN_BODY_SIZE = 0x4000; // 16384
/** Roh-Größe des Global-Blocks. */
export const E2_GLOBAL_SIZE = 0x100; // 256
/** Höchster gültiger Pattern-Index (250 Slots: 0..249). */
export const E2_MAX_PATTERN_INDEX = 249;

// ─── 7↔8-Bit-Codec (Korg-Standard) ───────────────────────────────────────────

/**
 * Kodiert 8-Bit-Daten ins MIDI-taugliche 7-Bit-Format.
 *
 * Schema: Je 7 Datenbytes wird ein Header-Byte vorangestellt, dessen Bits 0..6
 * die jeweils obersten Bits (Bit 7) der folgenden 7 Bytes tragen. Der letzte
 * Block darf kürzer als 7 Bytes sein; sein Header trägt entsprechend weniger
 * Bits. Overhead ≈ 8/7 (+14.3 %).
 *
 * 16384 Bytes → 2340 volle Blöcke (18720 B) + Rest 4 B (+1 Header) = 18725 B.
 */
export function encode7Bit(data: Uint8Array): Uint8Array {
  const fullBlocks = Math.floor(data.length / 7);
  const rest = data.length - fullBlocks * 7;
  const outLen = fullBlocks * 8 + (rest > 0 ? rest + 1 : 0);
  const out = new Uint8Array(outLen);

  let si = 0;
  let oi = 0;
  while (si < data.length) {
    const n = Math.min(7, data.length - si);
    let header = 0;
    for (let i = 0; i < n; i++) {
      if ((data[si + i] & 0x80) !== 0) header |= 1 << i;
    }
    out[oi++] = header;
    for (let i = 0; i < n; i++) out[oi++] = data[si + i] & 0x7f;
    si += n;
  }
  return out;
}

/**
 * Dekodiert 7-Bit-Sysex-Daten zurück nach 8 Bit (Umkehrung von `encode7Bit`).
 * Tolerant gegenüber einem abgeschnittenen letzten Block.
 */
export function decode7Bit(data: Uint8Array): Uint8Array {
  const fullBlocks = Math.floor(data.length / 8);
  const restRaw = data.length - fullBlocks * 8;
  // Ein angebrochener Block besteht aus 1 Header + (restRaw-1) Datenbytes.
  const restData = restRaw > 1 ? restRaw - 1 : 0;
  const out = new Uint8Array(fullBlocks * 7 + restData);

  let si = 0;
  let oi = 0;
  while (si < data.length) {
    const header = data[si++];
    const n = Math.min(7, data.length - si);
    for (let i = 0; i < n; i++) {
      const hi = (header >> i) & 1;
      out[oi++] = (data[si + i] & 0x7f) | (hi << 7);
    }
    si += n;
  }
  return out;
}

// ─── Frame-Bau ───────────────────────────────────────────────────────────────

/** Optionen für alle Frame-Builder. */
export interface E2FrameOptions {
  /** MIDI-Global-Channel 0..15 (Default 0). */
  globalChannel?: number;
  /** Product-ID; Default Sampler (0x0124). */
  productId?: number;
}

function clampChannel(ch: number | undefined): number {
  if (typeof ch !== "number" || !Number.isFinite(ch)) return 0;
  return Math.max(0, Math.min(15, Math.floor(ch)));
}

/** Baut den 6-Byte-Kopf `F0 42 3g 00 <pidHi> <pidLo>`. */
function frameHead(opts?: E2FrameOptions): number[] {
  const ch = clampChannel(opts?.globalChannel);
  const pid = opts?.productId ?? PRODUCT_ID_E2_SAMPLER;
  return [SYSEX_START, KORG_MANUFACTURER_ID, 0x30 + ch, 0x00, (pid >> 8) & 0x7f, pid & 0x7f];
}

/** Generischer Frame: Kopf + cmd + body + F7. */
export function buildFrame(cmd: number, body: Uint8Array | number[] = [], opts?: E2FrameOptions): Uint8Array {
  const head = frameHead(opts);
  const b = body instanceof Uint8Array ? body : Uint8Array.from(body);
  const out = new Uint8Array(head.length + 1 + b.length + 1);
  out.set(head, 0);
  out[head.length] = cmd & 0x7f;
  out.set(b, head.length + 1);
  out[out.length - 1] = SYSEX_END;
  return out;
}

/**
 * Pattern-Index als 2 × 7-Bit (LSB zuerst) — so erwartet es Korg:
 * `int_to_midi(x) = [x % 128, x // 128]`.
 */
export function encodePatternIndex(index: number): [number, number] {
  const i = Math.max(0, Math.min(E2_MAX_PATTERN_INDEX, Math.floor(index)));
  return [i & 0x7f, (i >> 7) & 0x7f];
}

/** Umkehrung von `encodePatternIndex`. */
export function decodePatternIndex(lsb: number, msb: number): number {
  return (lsb & 0x7f) | ((msb & 0x7f) << 7);
}

/** H→D: „Schick mir deinen Edit-Buffer." → `F0 42 30 00 01 24 10 F7` */
export function buildCurrentPatternDumpRequest(opts?: E2FrameOptions): Uint8Array {
  return buildFrame(E2_CMD.CURRENT_PATTERN_DUMP_REQUEST, [], opts);
}

/** H→D: „Schick mir Pattern #index." → `… 1C <lsb> <msb> F7` */
export function buildPatternDumpRequest(index: number, opts?: E2FrameOptions): Uint8Array {
  return buildFrame(E2_CMD.PATTERN_DUMP_REQUEST, encodePatternIndex(index), opts);
}

/** H→D: Global-Settings anfordern. */
export function buildGlobalDumpRequest(opts?: E2FrameOptions): Uint8Array {
  return buildFrame(E2_CMD.GLOBAL_DUMP_REQUEST, [], opts);
}

/**
 * H→D: Edit-Buffer ans Gerät senden (16384-Byte-Body wird 7-bit-kodiert).
 * Ergibt exakt 18733 Bytes für einen 16384-Byte-Body.
 */
export function buildCurrentPatternDump(body: Uint8Array, opts?: E2FrameOptions): Uint8Array {
  assertBodySize(body);
  return buildFrame(E2_CMD.CURRENT_PATTERN_DUMP, encode7Bit(body), opts);
}

/**
 * H→D: Pattern direkt in einen Slot schreiben.
 * Ergibt exakt 18735 Bytes für einen 16384-Byte-Body.
 */
export function buildPatternDump(index: number, body: Uint8Array, opts?: E2FrameOptions): Uint8Array {
  assertBodySize(body);
  const [lsb, msb] = encodePatternIndex(index);
  const enc = encode7Bit(body);
  const payload = new Uint8Array(2 + enc.length);
  payload[0] = lsb;
  payload[1] = msb;
  payload.set(enc, 2);
  return buildFrame(E2_CMD.PATTERN_DUMP, payload, opts);
}

function assertBodySize(body: Uint8Array): void {
  if (body.length !== E2_PATTERN_BODY_SIZE) {
    throw new Error(
      `E2 pattern body must be exactly ${E2_PATTERN_BODY_SIZE} bytes, got ${body.length}`,
    );
  }
}

// ─── Antwort-Parsing ─────────────────────────────────────────────────────────

/** Ergebnis von `parseE2SysexResponse`. */
export type E2SysexResponse =
  | { kind: "currentPatternDump"; body: Uint8Array }
  | { kind: "patternDump"; index: number; body: Uint8Array }
  | { kind: "globalDump"; data: Uint8Array }
  | { kind: "ack"; cmd: number }
  | { kind: "nak"; cmd: number; reason: string }
  | { kind: "unknown"; cmd: number }
  | { kind: "invalid"; reason: string };

/**
 * Erkennt, ob `bytes` überhaupt ein Korg-Electribe-Sysex-Frame ist
 * (F0 42 3g 00 <pid>) — ohne den Inhalt zu deuten.
 */
export function isE2SysexFrame(bytes: Uint8Array | number[]): boolean {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < 8) return false;
  if (b[0] !== SYSEX_START || b[1] !== KORG_MANUFACTURER_ID) return false;
  if ((b[2] & 0xf0) !== 0x30) return false;
  if (b[3] !== 0x00) return false;
  const pid = ((b[4] & 0x7f) << 8) | (b[5] & 0x7f);
  return pid === PRODUCT_ID_E2_SAMPLER || pid === PRODUCT_ID_E2_SYNTH;
}

/**
 * Parst eine Geräte-Antwort. Dekodiert Dump-Nutzdaten automatisch zurück
 * nach 8 Bit und schneidet sie auf die erwartete Größe zu (das Gerät hängt
 * je nach Firmware Padding an).
 */
export function parseE2SysexResponse(bytes: Uint8Array | number[]): E2SysexResponse {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (!isE2SysexFrame(b)) return { kind: "invalid", reason: "not a Korg Electribe sysex frame" };
  if (b[b.length - 1] !== SYSEX_END) return { kind: "invalid", reason: "missing F7 terminator" };

  const cmd = b[6];
  // Nutzdaten liegen zwischen Command-Byte und F7.
  const payload = b.subarray(7, b.length - 1);

  switch (cmd) {
    case E2_CMD.CURRENT_PATTERN_DUMP: {
      const decoded = decode7Bit(payload);
      if (decoded.length < E2_PATTERN_BODY_SIZE) {
        return { kind: "invalid", reason: `pattern body too short: ${decoded.length}` };
      }
      return { kind: "currentPatternDump", body: decoded.subarray(0, E2_PATTERN_BODY_SIZE) };
    }
    case E2_CMD.PATTERN_DUMP: {
      if (payload.length < 2) return { kind: "invalid", reason: "pattern dump missing index bytes" };
      const index = decodePatternIndex(payload[0], payload[1]);
      const decoded = decode7Bit(payload.subarray(2));
      if (decoded.length < E2_PATTERN_BODY_SIZE) {
        return { kind: "invalid", reason: `pattern body too short: ${decoded.length}` };
      }
      return { kind: "patternDump", index, body: decoded.subarray(0, E2_PATTERN_BODY_SIZE) };
    }
    case E2_CMD.GLOBAL_DUMP: {
      const decoded = decode7Bit(payload);
      return { kind: "globalDump", data: decoded.subarray(0, Math.min(decoded.length, E2_GLOBAL_SIZE)) };
    }
    case E2_CMD.DATA_LOAD_COMPLETED:
    case E2_CMD.WRITE_COMPLETED:
      return { kind: "ack", cmd };
    case E2_CMD.DATA_LOAD_ERROR:
      return { kind: "nak", cmd, reason: "data load error" };
    case E2_CMD.WRITE_ERROR:
      return { kind: "nak", cmd, reason: "write error" };
    case E2_CMD.DATA_FORMAT_ERROR:
      return { kind: "nak", cmd, reason: "data format error" };
    default:
      return { kind: "unknown", cmd };
  }
}

// ─── Body ↔ Datei ────────────────────────────────────────────────────────────

/** Größe des KORG-Dateiheaders, der einem `.e2spat` vorangestellt ist. */
export const E2_FILE_HEADER_SIZE = 0x100; // 256

/**
 * Verpackt einen rohen 16384-Byte-Sysex-Body in eine vollwertige
 * `.e2spat`-Datei (256-Byte-KORG-Header + Body).
 *
 * Zweck: Der vorhandene Parser (`utils/electribeImport.ts`) arbeitet auf
 * Dateien, das Gerät liefert per Sysex aber nur den nackten Body. Statt einen
 * zweiten Parser zu bauen, stellen wir den fehlenden Header voran — so
 * durchläuft ein per MIDI geholtes Pattern exakt denselben, bereits erprobten
 * Import-Pfad wie eine Datei von der SD-Karte.
 */
export function wrapPatternBodyAsFile(body: Uint8Array): Uint8Array {
  assertBodySize(body);
  const out = new Uint8Array(E2_FILE_HEADER_SIZE + E2_PATTERN_BODY_SIZE);
  // "KORG" @ 0x00
  out[0] = 0x4b; out[1] = 0x4f; out[2] = 0x52; out[3] = 0x47;
  // "e2sampler" @ 0x10
  const id = "e2sampler";
  for (let i = 0; i < id.length; i++) out[0x10 + i] = id.charCodeAt(i);
  // Version u32 LE = 1 @ 0x20
  out[0x20] = 0x01;
  // 0xFF-Padding bis zum Body
  out.fill(0xff, 0x24, E2_FILE_HEADER_SIZE);
  out.set(body, E2_FILE_HEADER_SIZE);
  return out;
}

// ─── Device Search (Korg-weit einheitlich) ───────────────────────────────────

/** H→D: Geräte-Suche `F0 42 50 00 <echoId> F7` (kanal-unabhängig). */
export function buildDeviceSearchRequest(echoId = 0x00): Uint8Array {
  return Uint8Array.from([SYSEX_START, KORG_MANUFACTURER_ID, 0x50, 0x00, echoId & 0x7f, SYSEX_END]);
}

/** Ergebnis einer Device-Search-Antwort. */
export interface E2DeviceSearchReply {
  globalChannel: number;
  /** 0x24 = Sampler, 0x23 = Synth. */
  deviceId: number;
  isSampler: boolean;
  /** Firmware major.minor, falls im Reply enthalten. */
  version: string | null;
}

/**
 * Parst `F0 42 50 01 0g <echo> <id> …` — die Antwort auf `buildDeviceSearchRequest`.
 * Gibt `null` zurück, wenn es keine Search-Antwort ist.
 */
export function parseDeviceSearchReply(bytes: Uint8Array | number[]): E2DeviceSearchReply | null {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < 8) return null;
  if (b[0] !== SYSEX_START || b[1] !== KORG_MANUFACTURER_ID) return null;
  if (b[2] !== 0x50 || b[3] !== 0x01) return null;
  const globalChannel = b[4] & 0x0f;
  const deviceId = b[6];
  const version = b.length >= 12 ? `${b[10]}.${b[11]}` : null;
  return {
    globalChannel,
    deviceId,
    isSampler: deviceId === 0x24,
    version,
  };
}

// ─── Transport-Hilfe ─────────────────────────────────────────────────────────

/**
 * Default-Chunk-Größe beim Senden langer Sysex-Frames.
 *
 * Hintergrund: Lange Sysex-Messages müssen in Häppchen mit kleinen Pausen
 * gesendet werden, sonst brechen Übertragungen sporadisch ab (bangcorrupt
 * pflegt dafür eigene mido-/python-rtmidi-Forks mit exakt diesem Wert).
 * Web MIDI puffert selbst, aber ein 18.7-KB-Frame am Stück ist grenzwertig.
 */
export const SYSEX_CHUNK_SIZE = 512;

/** Zerlegt einen Frame in `SYSEX_CHUNK_SIZE`-Häppchen (für gedrosseltes Senden). */
export function chunkSysex(frame: Uint8Array, chunkSize = SYSEX_CHUNK_SIZE): Uint8Array[] {
  if (chunkSize <= 0) return [frame];
  const out: Uint8Array[] = [];
  for (let i = 0; i < frame.length; i += chunkSize) {
    out.push(frame.subarray(i, Math.min(i + chunkSize, frame.length)));
  }
  return out;
}
