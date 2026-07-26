/**
 * Synthstudio — Hacktribe-RAM-Zugriff (v3.285.0)
 *
 * Reine Byte-Logik für Hacktribes generische Peek/Poke-Kommandos. Das ist der
 * eigentliche Machtvektor der Firmware: es gibt **kein** dediziertes
 * FX- oder Groove-Sysex — Hacktribes Editor schreibt einfach typisierte Bytes
 * an feste Adressen im AM1808-Adressraum.
 *
 * ⚠️ Das hier ist kategorisch gefährlicher als CC und NRPN. Ein Schreibvorgang
 * an die falsche Adresse trifft den laufenden Code des Geräts. Entsprechend die
 * Leitlinien, die dieses Modul durchsetzt:
 *
 *   1. **Nur DDR2** (`0xC0000000`–`0xCFFFFFFF`). Der On-Chip-RAM ab
 *      `0x80000000` ist Boot-Loader-Gebiet und Sprungziel von `0x57` — dort
 *      hinzuschreiben ist der direkte Weg zum unbrauchbaren Gerät.
 *      {@link validateRamRange} lehnt alles andere ab.
 *   2. **Kein Flash, kein Execute.** `0x55`/`0x56` (Flash) und `0x57` (Execute)
 *      haben hier absichtlich keine Builder. Flash überlebt den Power-Cycle,
 *      ein Fehler ist dann nicht mehr durch Aus- und Einschalten zu beheben.
 *      Bei RAM hilft ein Power-Cycle.
 *   3. **Chunking.** Große Strukturen werden in Häppchen geschrieben, jedes mit
 *      eigener Adress-Setzung — einzelne große Writes schlagen laut Hacktribe
 *      (Discussion #37) reproduzierbar öfter fehl.
 *
 * Was dieses Modul NICHT leisten kann: prüfen, ob das Gerät gerade spielt.
 * RAM-Writes während der Wiedergabe können kollidieren; das muss der Aufrufer
 * durch den Nutzer bestätigen lassen (siehe `audio/HacktribeRamTransfer.ts`).
 *
 * Protokoll (`docs/reverse/electribe2_native_sysex.md` §5):
 * ```
 * Lesen   : F0 42 3g 00 01 24 52 <syx_enc(addr_le32 ‖ len_le32)> F7
 *           → Daten in resp[9..-1], syx_dec
 * Schreiben (zweistufig):
 *   1) F0 …head… 53 <syx_enc(addr_le32 ‖ len_le32)> F7
 *   2) F0 …head… 54 <syx_enc(data)> F7   → ACK 0x21
 * ```
 */
import {
  buildFrame,
  decode7Bit,
  encode7Bit,
  isE2SysexFrame,
  type E2FrameOptions,
} from "./e2NativeSysex";

/** Die Kommandos, die dieses Modul benutzt. Flash und Execute fehlen absichtlich. */
export const RAM_CMD = {
  /** CPU-RAM lesen. */
  read: 0x52,
  /** Ziel-Adresse + Länge für den folgenden Write setzen. */
  setWriteAddress: 0x53,
  /** Nutzdaten schreiben. Antwortet mit ACK `0x21`. */
  writeData: 0x54,
} as const;

/** ACK-Kommando, mit dem das Gerät einen erfolgreichen Write bestätigt. */
export const RAM_ACK_CMD = 0x21;

/** Untere Grenze des erlaubten Adressraums (AM1808 DDR2-EMIF). */
export const DDR2_BASE = 0xc0000000;
/** Obere Grenze (exklusiv). */
export const DDR2_END = 0xd0000000;

/**
 * Häppchengröße für Writes.
 *
 * `0x100` ist die Größe, an der Hacktribes Editor die 524-B-FX-Presets
 * aufteilt (`[:0x100]` + `[0x100:]`). Wir chunken durchgehend so — etwas
 * konservativer als der Editor, aber mit derselben bewährten Obergrenze.
 */
export const RAM_WRITE_CHUNK = 0x100;

/** Maximale Leselänge pro Anfrage, damit die Antwort ein Frame bleibt. */
export const RAM_READ_CHUNK = 0x100;

// ─── Adress-Karte bekannter Strukturen ──────────────────────────────────────

export interface RamMapEntry {
  key: string;
  label: string;
  /** Basis-Adresse des Slots 0. */
  base: number;
  /** Abstand zwischen zwei Slots in Bytes. */
  stride: number;
  /** Anzahl Slots. */
  count: number;
  /** Länge einer Struktur in Bytes (meist == stride). */
  size: number;
  /** Kurzer Hinweis fürs UI. */
  note?: string;
}

/**
 * Die live editierbaren Strukturen im DDR2 der Hacktribe-Firmware.
 *
 * Quelle: `omnitribe/docs/reverse/hacktribe_ram_and_formats.md` §1, verifiziert
 * gegen `hacktribe-editor/utils/ht_sysex.py`.
 *
 * Ausdrücklich **nicht** dabei: die Limit-Zähler von `add_ifx`/`add_groove`
 * (13 bzw. 4 Einzel-Bytes an verstreuten Adressen). Die sind nur nötig, damit
 * ein *neues* Preset im Menü erscheint, und ein halb hochgezählter Satz
 * hinterlässt eine inkonsistente Firmware. Wer das braucht, nimmt Hacktribes
 * eigenen Editor.
 */
export const E2_RAM_MAP: readonly RamMapEntry[] = [
  {
    key: "ifxPreset",
    label: "IFX-Preset",
    base: 0xc00a80f0,
    stride: 0x20c,
    count: 96,
    size: 0x20c,
    note: "524 B pro Preset, Slot 0–95",
  },
  {
    key: "mfxPreset",
    label: "MFX-Preset",
    base: 0xc00b4f30,
    stride: 0x20c,
    count: 32,
    size: 0x20c,
    note: "524 B pro Preset, Slot 0–31",
  },
  {
    key: "fxEditBuffer",
    label: "FX-Edit-Buffer (live)",
    base: 0xc03478a8,
    stride: 0x72,
    count: 0x21,
    size: 0x72,
    note: "Slot = part*2 + ifxSlot; Slot 32 (0x20) = MFX",
  },
  {
    key: "groove",
    label: "Groove-Template",
    base: 0xc0143b00,
    stride: 0x140,
    count: 96,
    size: 0x140,
    note: "320 B pro Template, Slot 0–95",
  },
  {
    key: "maxIfxIndex",
    label: "Max-IFX-Index (nur lesen)",
    base: 0xc0048f80,
    stride: 1,
    count: 1,
    size: 1,
    note: "1 Byte — zum Schreiben gehören 12 weitere Zähler, siehe Modul-Doku",
  },
] as const;

export function findRamMapEntry(key: string): RamMapEntry | undefined {
  return E2_RAM_MAP.find((e) => e.key === key);
}

/** Adresse eines Slots: `base + stride * index`. */
export function addressForSlot(entry: RamMapEntry, index: number): number {
  const i = Math.max(0, Math.min(entry.count - 1, Math.round(index)));
  return entry.base + entry.stride * i;
}

// ─── Validierung ────────────────────────────────────────────────────────────

export type RamRangeCheck = { ok: true } | { ok: false; reason: string };

/**
 * Liegt `[addr, addr+len)` vollständig im erlaubten DDR2-Fenster?
 *
 * Bewusst eine harte Grenze und keine Warnung: der On-Chip-RAM ab `0x80000000`
 * ist Boot-Loader-Gebiet, und ein Write dorthin ist die zuverlässigste Methode,
 * das Gerät unbrauchbar zu machen. Ein Werkzeug, das das mit einem „bist du
 * sicher?" durchlässt, ist ein Werkzeug, das es irgendwann tut.
 */
export function validateRamRange(addr: number, len: number): RamRangeCheck {
  if (!Number.isFinite(addr) || !Number.isInteger(addr) || addr < 0) {
    return { ok: false, reason: "Adresse ist keine gültige Ganzzahl" };
  }
  if (!Number.isFinite(len) || !Number.isInteger(len) || len <= 0) {
    return { ok: false, reason: "Länge muss eine positive Ganzzahl sein" };
  }
  if (addr < DDR2_BASE || addr >= DDR2_END) {
    return {
      ok: false,
      reason:
        `Adresse 0x${addr.toString(16).toUpperCase()} liegt außerhalb des DDR2-Fensters ` +
        `(0x${DDR2_BASE.toString(16).toUpperCase()}–0x${(DDR2_END - 1).toString(16).toUpperCase()}). ` +
        "Der On-Chip-RAM ab 0x80000000 ist Boot-Loader-Gebiet und hier gesperrt.",
    };
  }
  if (addr + len > DDR2_END) {
    return { ok: false, reason: "Bereich reicht über das Ende des DDR2-Fensters hinaus" };
  }
  return { ok: true };
}

// ─── Adresse/Länge kodieren ─────────────────────────────────────────────────

/** 32-Bit-Wert little-endian in 4 Bytes. */
export function u32le(value: number): number[] {
  const v = value >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** Liest 4 Bytes little-endian als vorzeichenlose 32-Bit-Zahl. */
export function readU32le(bytes: ArrayLike<number>, offset = 0): number {
  return (
    ((bytes[offset] & 0xff) |
      ((bytes[offset + 1] & 0xff) << 8) |
      ((bytes[offset + 2] & 0xff) << 16) |
      ((bytes[offset + 3] & 0xff) << 24)) >>>
    0
  );
}

/** Der 8-Byte-Rumpf `addr_le32 ‖ len_le32`, wie ihn `0x52` und `0x53` erwarten. */
export function encodeAddrLen(addr: number, len: number): Uint8Array {
  return Uint8Array.from([...u32le(addr), ...u32le(len)]);
}

// ─── Frame-Bau ──────────────────────────────────────────────────────────────

/** Leseanfrage für `len` Bytes ab `addr`. */
export function buildRamReadRequest(
  addr: number,
  len: number,
  opts?: E2FrameOptions,
): Uint8Array {
  return buildFrame(RAM_CMD.read, encode7Bit(encodeAddrLen(addr, len)), opts);
}

/** Schritt 1 eines Writes: Zieladresse und Länge setzen. */
export function buildRamWriteAddress(
  addr: number,
  len: number,
  opts?: E2FrameOptions,
): Uint8Array {
  return buildFrame(RAM_CMD.setWriteAddress, encode7Bit(encodeAddrLen(addr, len)), opts);
}

/** Schritt 2 eines Writes: die Nutzdaten. */
export function buildRamWriteData(data: Uint8Array, opts?: E2FrameOptions): Uint8Array {
  return buildFrame(RAM_CMD.writeData, encode7Bit(data), opts);
}

// ─── Antworten auswerten ────────────────────────────────────────────────────

export type RamReadResult =
  | { kind: "data"; data: Uint8Array }
  | { kind: "ack" }
  | { kind: "unknown"; cmd: number };

/**
 * Wertet eine Geräteantwort aus.
 *
 * Nutzdaten stehen ab Index 7 (nach 6-Byte-Kopf und Kommando) bis vor das
 * abschließende `F7` — siehe `resp[9:-1]` in Hacktribes Python-Editor, dessen
 * Index um die dort mitgezählten Bytes verschoben ist.
 */
export function parseRamResponse(frame: Uint8Array | number[]): RamReadResult | null {
  const b = frame instanceof Uint8Array ? frame : Uint8Array.from(frame);
  if (!isE2SysexFrame(b)) return null;
  const cmd = b[6];
  if (cmd === RAM_ACK_CMD) return { kind: "ack" };
  if (cmd === RAM_CMD.read) {
    const end = b[b.length - 1] === 0xf7 ? b.length - 1 : b.length;
    return { kind: "data", data: decode7Bit(b.subarray(7, end)) };
  }
  return { kind: "unknown", cmd };
}

// ─── Chunking ───────────────────────────────────────────────────────────────

export interface RamChunk {
  addr: number;
  bytes: Uint8Array;
}

/**
 * Teilt einen Schreibvorgang in Häppchen mit je eigener Zieladresse.
 *
 * Jedes Häppchen wird als vollständiges Adresse-dann-Daten-Paar gesendet; das
 * entspricht dem Vorgehen von Hacktribes Editor bei großen Strukturen und ist
 * deutlich zuverlässiger als ein einzelner großer Write.
 */
export function splitRamWrite(
  addr: number,
  data: Uint8Array,
  chunkSize = RAM_WRITE_CHUNK,
): RamChunk[] {
  const size = chunkSize > 0 ? chunkSize : RAM_WRITE_CHUNK;
  const out: RamChunk[] = [];
  for (let off = 0; off < data.length; off += size) {
    out.push({
      addr: addr + off,
      bytes: data.subarray(off, Math.min(off + size, data.length)),
    });
  }
  return out;
}

/** Teilt einen Lesevorgang analog auf. */
export function splitRamRead(
  addr: number,
  len: number,
  chunkSize = RAM_READ_CHUNK,
): { addr: number; len: number }[] {
  const size = chunkSize > 0 ? chunkSize : RAM_READ_CHUNK;
  const out: { addr: number; len: number }[] = [];
  for (let off = 0; off < len; off += size) {
    out.push({ addr: addr + off, len: Math.min(size, len - off) });
  }
  return out;
}

// ─── Hex-Ein-/Ausgabe ───────────────────────────────────────────────────────

/**
 * Parst eine Hex-Eingabe (Leerzeichen, Zeilenumbrüche und `0x` sind erlaubt).
 *
 * Liefert eine Fehlermeldung statt zu werfen: das ist Nutzereingabe, und ein
 * Tippfehler soll eine Meldung ergeben und keinen Absturz.
 */
export function parseHexBytes(
  text: string,
): { ok: true; bytes: Uint8Array } | { ok: false; reason: string } {
  const cleaned = text.replace(/0x/gi, "").replace(/[\s,]+/g, "");
  if (cleaned.length === 0) return { ok: false, reason: "Keine Bytes angegeben" };
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    return { ok: false, reason: "Enthält Zeichen, die keine Hex-Ziffern sind" };
  }
  if (cleaned.length % 2 !== 0) {
    return { ok: false, reason: "Ungerade Anzahl Hex-Ziffern — ein halbes Byte fehlt" };
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
  }
  return { ok: true, bytes };
}

/** Formatiert Bytes als Hex-Dump mit Adress-Spalte. */
export function formatHexDump(bytes: Uint8Array, baseAddr = 0, perLine = 16): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += perLine) {
    const slice = bytes.subarray(off, Math.min(off + perLine, bytes.length));
    const addr = (baseAddr + off).toString(16).toUpperCase().padStart(8, "0");
    const hex = Array.from(slice, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    lines.push(`${addr}  ${hex}`);
  }
  return lines.join("\n");
}

/** Parst eine Adresse aus Text (`0xC00A80F0`, `C00A80F0`, dezimal). */
export function parseAddress(
  text: string,
): { ok: true; addr: number } | { ok: false; reason: string } {
  const t = text.trim();
  if (!t) return { ok: false, reason: "Keine Adresse angegeben" };
  const hex = /^0x/i.test(t) || /^[0-9a-f]*[a-f][0-9a-f]*$/i.test(t);
  const n = hex ? Number.parseInt(t.replace(/^0x/i, ""), 16) : Number.parseInt(t, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return { ok: false, reason: `„${t}" ist keine gültige Adresse` };
  }
  return { ok: true, addr: n >>> 0 };
}

// ─── Verifikation ───────────────────────────────────────────────────────────

export interface RamVerifyResult {
  ok: boolean;
  /** Index des ersten abweichenden Bytes, oder -1. */
  firstDiff: number;
  /** Anzahl abweichender Bytes. */
  diffCount: number;
}

/**
 * Vergleicht Soll- und Ist-Bytes nach einem Write.
 *
 * Ein Write, der nicht zurückgelesen wurde, ist ein Write, von dem man nichts
 * weiß — deshalb ist die Verifikation im Transfer-Pfad nicht optional.
 */
export function verifyRamWrite(expected: Uint8Array, actual: Uint8Array): RamVerifyResult {
  if (expected.length !== actual.length) {
    return { ok: false, firstDiff: Math.min(expected.length, actual.length), diffCount: -1 };
  }
  let firstDiff = -1;
  let diffCount = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) {
      if (firstDiff < 0) firstDiff = i;
      diffCount++;
    }
  }
  return { ok: diffCount === 0, firstDiff, diffCount };
}
