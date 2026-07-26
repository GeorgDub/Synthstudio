/**
 * Synthstudio — Native Korg Electribe 2 / Electribe 2 Sampler MIDI SysEx.
 *
 * Dies ist die *geräte-native* Korg-SysEx-Schicht (Manufacturer-ID 0x42),
 * NICHT unser OmniTribe-OTP-Protokoll (0x7D, siehe audio/OmniTribeBridge.ts).
 * Ein E2/E2S — egal ob Stock-Firmware oder mit **hacktribe** gepatcht —
 * spricht dieses Protokoll über die reguläre MIDI-Buchse / USB-MIDI.
 *
 * Quelle (verbatim portiert, bit-genau): bangcorrupt/hacktribe
 *   scripts/e2_syx_codec.py  → 7-in-8-Packing (syx_enc / syx_dec)
 *   scripts/e2sysex.py       → Frame-Header + Function-IDs
 *   scripts/e2pat2syx.py     → Pattern-Dump-Wrapping
 * Korg-Referenz: "Electribe 2 (Sampler) MIDI Implementation".
 *
 * Isomorph & seiteneffektfrei: reine Byte-Helpers, keine Web-MIDI-Abhängigkeit.
 * Transport (navigator.requestMIDIAccess, Chunking, Timing) macht der Aufrufer.
 *
 * WICHTIG — was über SysEx geht und was NICHT:
 *   ✅ Current-Pattern (Edit-Buffer), nummerierte Patterns 0–249, Global-Data,
 *      Realtime-CC/NRPN, sowie (hacktribe-only) CPU-RAM/Flash Read/Write/Execute.
 *   ❌ Sample-PCM: die E2S überträgt Samples ausschließlich datei-basiert über
 *      `e2sSample.all` auf der SD-Karte (USB-Mass-Storage) — NICHT über SysEx.
 *      Siehe e2sBankReader.ts / e2sBankBuilder.ts.
 */

// ─── Frame-Konstanten ────────────────────────────────────────────────────────
export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
/** Korg Manufacturer-ID. */
export const KORG_ID = 0x42;
/** Format-Präfix der Electribe-2-Familie (nach [chan]). */
export const E2_FORMAT_PREFIX = [0x00, 0x01] as const;

/** Model-ID im Frame-Header (Byte 5). */
export const E2Model = {
  SYNTH: 0x23,
  /** Electribe 2 Sampler — auch der Wert für ein mit hacktribe gepatchtes Gerät. */
  SAMPLER: 0x24,
} as const;
export type E2Model = (typeof E2Model)[keyof typeof E2Model];

/**
 * Function-IDs (verbatim aus e2sysex.py).
 * REQ = Host→Device Request, DUMP = Datenrahmen (bidirektional), ACK/NAK = Reply.
 */
export const E2Func = {
  CURRENT_PATTERN_DUMP_REQ: 0x10, // → Reply CURRENT_PATTERN_DUMP (0x40)
  CURRENT_PATTERN_DUMP: 0x40,
  PATTERN_DUMP_REQ: 0x1c, // + [lsb, msb] → Reply PATTERN_DUMP (0x4C)
  PATTERN_DUMP: 0x4c, // + [lsb, msb] + enc(body)
  GLOBAL_DUMP_REQ: 0x0e, // → Reply GLOBAL_DUMP (0x51)
  GLOBAL_DUMP: 0x51,
  ACK: 0x23, // DATA LOAD COMPLETED
  NAK: 0x24, // DATA LOAD ERROR
  // ── hacktribe-only Debug-Funktionen (nicht in Stock-Firmware) ──
  READ_CPU_RAM: 0x52, // + enc(addr[4 LE] + len[4 LE])
  SET_WRITE_ADDR: 0x53, // + enc(addr[4 LE] + len[4 LE])
  WRITE_CPU_RAM: 0x54, // + enc(data)
  READ_FLASH: 0x55, // + enc(addr[4 LE] + len[4 LE])
  EXECUTE_CPU_RAM: 0x57, // + enc(addr[4 LE] + 4 reserved 0)
} as const;

/** Max. Pattern-Index (250 Slots: 0–249). */
export const E2_MAX_PATTERN = 249;
/** Rohgröße eines Pattern-Bodies (ohne 0x100-KORG-Dateiheader). */
export const E2_PATTERN_BODY_SIZE = 0x4000; // 16384
/** Größe des KORG-Dateiheaders in einer .e2pat/.e2spat-Datei. */
export const E2_FILE_HEADER_SIZE = 0x100;

// ─── 7-in-8-Codec (Korg 8-Bit ↔ 7-Bit-MIDI) ─────────────────────────────────
// 1 "Set" = 7 Rohbytes → 8 MIDI-Bytes: [Header, d0..d6]. Header-Bit i = MSB von
// Datenbyte i; die 7 Folgebytes tragen die unteren 7 Bit. Letzte Gruppe darf
// kürzer sein (k<7 Bytes → Header + k Bytes). Bit-genau zu e2_syx_codec.py.

/** 8-Bit-Rohdaten → 7-Bit-MIDI-SysEx-Payload. */
export function encode7in8(data: Uint8Array | number[]): Uint8Array {
  const src = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const out: number[] = [];
  for (let i = 0; i < src.length; i += 7) {
    const groupLen = Math.min(7, src.length - i);
    let header = 0;
    for (let j = 0; j < groupLen; j++) {
      header |= ((src[i + j] & 0x80) >> 7) << j;
    }
    out.push(header);
    for (let j = 0; j < groupLen; j++) out.push(src[i + j] & 0x7f);
  }
  return Uint8Array.from(out);
}

/** 7-Bit-MIDI-SysEx-Payload → 8-Bit-Rohdaten (invers zu encode7in8). */
export function decode7in8(syx: Uint8Array | number[]): Uint8Array {
  const src = syx instanceof Uint8Array ? syx : Uint8Array.from(syx);
  const out: number[] = [];
  for (let i = 0; i < src.length; i += 8) {
    const chunkLen = Math.min(8, src.length - i);
    const header = src[i];
    for (let j = 1; j < chunkLen; j++) {
      const bit = (header >> (j - 1)) & 1;
      out.push((src[i + j] & 0x7f) | (bit << 7));
    }
  }
  return Uint8Array.from(out);
}

// ─── Pattern-Nummer-Encoding (LE 7-Bit-Paar) ─────────────────────────────────
/** Pattern-Index (0-basiert) → [lsb, msb] (7-bit). */
export function patternNumberToMidi(n: number): [number, number] {
  const clamped = Math.max(0, Math.min(E2_MAX_PATTERN, Math.floor(n)));
  return [clamped % 128, Math.floor(clamped / 128)];
}
/** [lsb, msb] → Pattern-Index (0-basiert). */
export function midiToPatternNumber(lsb: number, msb: number): number {
  return (lsb & 0x7f) + (msb & 0x7f) * 128;
}

// ─── Frame-Bau ───────────────────────────────────────────────────────────────
function head(model: E2Model, globalChannel: number, func: number): number[] {
  const chan = 0x30 + (globalChannel & 0x0f);
  return [SYSEX_START, KORG_ID, chan, ...E2_FORMAT_PREFIX, model, func];
}

export interface FrameOpts {
  model?: E2Model;
  /** Globaler MIDI-Kanal 0–15 (landet im 0x3g-Nibble). */
  globalChannel?: number;
}

/** Geräte-Suche (device inquiry). Antwort beginnt mit F0 42 50 01 … */
export function buildSearchRequest(): Uint8Array {
  return Uint8Array.from([SYSEX_START, KORG_ID, 0x50, 0x00, 0x00, SYSEX_END]);
}

/** Request: Edit-Buffer (Current Pattern) dumpen → Reply 0x40. */
export function buildCurrentPatternDumpRequest(
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.CURRENT_PATTERN_DUMP_REQ),
    SYSEX_END,
  ]);
}

/** Request: nummeriertes Pattern (0–249) dumpen → Reply 0x4C. */
export function buildPatternDumpRequest(
  patternNumber: number,
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  const [lsb, msb] = patternNumberToMidi(patternNumber);
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.PATTERN_DUMP_REQ),
    lsb,
    msb,
    SYSEX_END,
  ]);
}

/** Request: Global-Data dumpen → Reply 0x51. */
export function buildGlobalDumpRequest(opts: FrameOpts = {}): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.GLOBAL_DUMP_REQ),
    SYSEX_END,
  ]);
}

/**
 * Datenrahmen: Body in den Edit-Buffer (Current Pattern) schreiben (0x40).
 * @param body Roh-Pattern-Body (0x4000 B, ohne 0x100-Dateiheader).
 */
export function buildCurrentPatternDump(
  body: Uint8Array,
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  const enc = encode7in8(body);
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.CURRENT_PATTERN_DUMP),
    ...enc,
    SYSEX_END,
  ]);
}

/**
 * Datenrahmen: Body in nummerierten Pattern-Slot schreiben (0x4C + [lsb,msb]).
 */
export function buildPatternDump(
  patternNumber: number,
  body: Uint8Array,
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  const [lsb, msb] = patternNumberToMidi(patternNumber);
  const enc = encode7in8(body);
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.PATTERN_DUMP),
    lsb,
    msb,
    ...enc,
    SYSEX_END,
  ]);
}

/** Datenrahmen: Global-Data schreiben (0x51). */
export function buildGlobalDump(
  body: Uint8Array,
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  const enc = encode7in8(body);
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.GLOBAL_DUMP),
    ...enc,
    SYSEX_END,
  ]);
}

// ─── .e2pat/.e2spat-Datei ↔ Roh-Body ─────────────────────────────────────────
/** Entfernt den 0x100-KORG-Dateiheader → Roh-Body (für Pattern-Dumps). */
export function patternFileToBody(file: Uint8Array): Uint8Array {
  if (file.length < E2_FILE_HEADER_SIZE) {
    throw new Error(
      `pattern file too short: ${file.length} < ${E2_FILE_HEADER_SIZE}`
    );
  }
  return file.subarray(E2_FILE_HEADER_SIZE);
}

/**
 * Baut einen kompletten .e2pat/.e2spat-Datei-Puffer aus einem Roh-Body.
 * Header verbatim wie e2syx2pat.py: "KORG"(16) + tag(16) + 01 00 00 00 + 0xFF-Pad.
 * @param sampler true → "e2sampler"-Tag (E2S), false → "electribe"-Tag (E2 Synth).
 */
export function bodyToPatternFile(
  body: Uint8Array,
  sampler = true
): Uint8Array {
  const header = new Uint8Array(E2_FILE_HEADER_SIZE).fill(0xff);
  const korg = [0x4b, 0x4f, 0x52, 0x47]; // "KORG"
  header.set(korg, 0);
  for (let i = korg.length; i < 16; i++) header[i] = 0x00;
  const tag = sampler
    ? [0x65, 0x32, 0x73, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x72] // "e2sampler"
    : [0x65, 0x6c, 0x65, 0x63, 0x74, 0x72, 0x69, 0x62, 0x65]; // "electribe"
  header.set(tag, 16);
  for (let i = 16 + tag.length; i < 32; i++) header[i] = 0x00;
  header[32] = 0x01;
  header[33] = 0x00;
  header[34] = 0x00;
  header[35] = 0x00;
  const out = new Uint8Array(E2_FILE_HEADER_SIZE + body.length);
  out.set(header, 0);
  out.set(body, E2_FILE_HEADER_SIZE);
  return out;
}

// ─── Pattern-Body-Reader (verifizierte Offsets, body-relativ) ────────────────
// Quelle: hacktribe/e2-scripts (e2all2pat.py, e2seqrot.py, e2_recode_sample_pat.py).
// Body = Datei ohne 0x100-KORG-Header. Das *interne* Step-Feld-Layout (Note/
// Velocity/Gate) ist noch NICHT reverse-engineert — hier nur die gesicherten
// Felder: Pattern-Name + Part-OSC/Sample-Referenzen.
export const PATTERN_NAME_OFFSET = 0x10; // body-relativ, 16 ASCII
export const PATTERN_NAME_LEN = 16;
export const PART_TABLE_OFFSET = 0x800; // body-relativ
export const PART_COUNT = 16;
export const PART_STRIDE = 0x330;
export const PART_OSC_REF_OFFSET = 0x08; // u16 LE innerhalb eines Parts (Sample/OSC-Ref)
export const PART_VOLUME_OFFSET = 0x15; // u8 0..127
export const PART_PAN_OFFSET = 0x22; // u8 0..127 (64 = center)
// v3.296: Per-Part Filter-Block. Offsets dreifach verifiziert (Korgs offizielle
// "electribe MIDI Implementation Rev 1.00" TABLE 6 + keijiro/e2edit struct Part
// + maks/elfer PartType): Filter Type @0x0C (0..16), Cutoff @0x0D (0..127),
// Resonance @0x0E (0..127), EG Int @0x0F (i8 -63..+63).
export const PART_FILTER_TYPE_OFFSET = 0x0c;
export const PART_FILTER_CUTOFF_OFFSET = 0x0d;
export const PART_FILTER_RESONANCE_OFFSET = 0x0e;
export const PART_FILTER_EGINT_OFFSET = 0x0f;
export const PART_SEQ_OFFSET = 0x30; // Sequenz-Block: 64 × 12 B = 0x300, füllt den Part
export const PART_SEQ_STEP_SIZE = 0x0c;
export const STEPS_PER_PART = 64; // Sequenz-Block hält bis zu 64 Steps
// Step-Record-Feld-Offsets (verifiziert: e2sExport.ts-Writer + Daten-Analyse von
// Stock-Init + Testbank — trigger/note/velocity/gate/gatelen).
export const STEP_TRIGGER_OFFSET = 0;
export const STEP_NOTE_OFFSET = 1;
export const STEP_VELOCITY_OFFSET = 2;
export const STEP_GATE_OFFSET = 3;
export const STEP_GATELEN_OFFSET = 4;
// Body-relative Pattern-Header-Felder.
export const PATTERN_BPM_OFFSET = 0x22; // u16 LE, ×10 (z.B. 1200 = 120.0 BPM)
export const PATTERN_STEPLEN_OFFSET = 0x25; // Code 0→16, 1→32, 3→64
const STEP_LENGTH_FROM_CODE: Record<number, number> = { 0: 16, 1: 32, 3: 64 };

/** Liest den Pattern-Namen aus dem Roh-Body (ASCII, null-/space-getrimmt). */
export function readPatternName(body: Uint8Array): string {
  if (body.length < PATTERN_NAME_OFFSET + PATTERN_NAME_LEN) return "";
  let s = "";
  for (let i = 0; i < PATTERN_NAME_LEN; i++) {
    const b = body[PATTERN_NAME_OFFSET + i];
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
  }
  return s.replace(/\s+$/, "");
}

/**
 * Liest die 16 Part-OSC/Sample-Referenzen (u16 LE @ Part+0x08).
 * Das ist die Nummer, die auf ein Sample (501+) oder einen Oszillator zeigt —
 * dieselbe, die hacktribes Remap-Tools umschreiben. -1 falls Part außerhalb.
 */
export function readPartOscRefs(body: Uint8Array): number[] {
  const refs: number[] = [];
  for (let p = 0; p < PART_COUNT; p++) {
    const off = PART_TABLE_OFFSET + p * PART_STRIDE + PART_OSC_REF_OFFSET;
    refs.push(off + 1 < body.length ? body[off] | (body[off + 1] << 8) : -1);
  }
  return refs;
}

// ─── Voller Pattern-Decoder (verifiziertes Step/Part-Layout) ─────────────────
export interface E2Step {
  active: boolean;
  note: number; // 0..127
  velocity: number; // 0..127
  gate: boolean; // gate-flag (byte 3) — muss bei aktiven Steps gesetzt sein
  gateLen: number; // gate-length (byte 4)
  /**
   * Opake Step-Bytes +0x05..+0x0B (7 Bytes). SEMANTIK UNBEKANNT — vermutlich
   * Motion-/Param-Lock, aber in allen verfügbaren Files (Stock-Init + Testbank,
   * 250×16×64 Steps) durchgehend NULL, daher nicht reverse-engineert. Wird hier
   * roh erhalten, damit ein Motion-haltiges Device-Pattern die Daten nicht still
   * verliert. Siehe docs/reverse/pattern_format.md.
   */
  motion: number[]; // 7 Bytes
}

/** true, wenn ein Step Nicht-Null-Motion-Bytes trägt. */
export function stepHasMotion(step: E2Step): boolean {
  return step.motion.some(b => b !== 0);
}
export interface E2PartDecoded {
  sampleRef: number; // u16 LE @ +0x08 (Sample/OSC-Nummer)
  volume: number; // @ +0x15
  pan: number; // @ +0x22 (64 = center)
  /** v3.296: Filter Type @ +0x0C (roher Gerätewert 0..16, TABLE 6). */
  filterType: number;
  /** v3.296: Filter Cutoff @ +0x0D (0..127). */
  cutoff: number;
  /** v3.296: Filter Resonance @ +0x0E (0..127). */
  resonance: number;
  /** v3.296: Filter EG Int @ +0x0F (i8, -63..+63). */
  egInt: number;
  steps: E2Step[]; // stepLength Einträge
  activeCount: number;
}
export interface E2PatternDecoded {
  name: string;
  bpm: number; // dekodiert (×10 → Float)
  stepLength: number; // 16 | 32 | 64
  parts: E2PartDecoded[]; // 16
}

function readU16LE(body: Uint8Array, off: number): number {
  return off + 1 < body.length ? body[off] | (body[off + 1] << 8) : 0;
}

/** Erstes Byte des opaken Motion-Bereichs im Step-Record. */
export const STEP_MOTION_OFFSET = 0x05;
export const STEP_MOTION_LEN = 7; // +0x05..+0x0B

/** Dekodiert einen einzelnen Step-Record (12 B) ab `off`. */
export function decodeStep(body: Uint8Array, off: number): E2Step {
  const motion: number[] = [];
  for (let i = 0; i < STEP_MOTION_LEN; i++) {
    motion.push(body[off + STEP_MOTION_OFFSET + i] ?? 0);
  }
  return {
    active: (body[off + STEP_TRIGGER_OFFSET] ?? 0) !== 0,
    note: body[off + STEP_NOTE_OFFSET] ?? 0,
    velocity: body[off + STEP_VELOCITY_OFFSET] ?? 0,
    gate: (body[off + STEP_GATE_OFFSET] ?? 0) !== 0,
    gateLen: body[off + STEP_GATELEN_OFFSET] ?? 0,
    motion,
  };
}

/**
 * Voll-Decode eines Roh-Pattern-Bodies (0x4000, ohne 0x100-Header) in
 * strukturierte Parts + Steps. Layout verifiziert gegen e2sExport.ts (Writer)
 * und Daten-Analyse (Stock-Init-Template + Testbank mit echten Triggern).
 */
export function decodePatternBody(body: Uint8Array): E2PatternDecoded {
  const bpm = readU16LE(body, PATTERN_BPM_OFFSET) / 10;
  const code = body[PATTERN_STEPLEN_OFFSET] ?? 0;
  const stepLength = STEP_LENGTH_FROM_CODE[code] ?? 16;
  const parts: E2PartDecoded[] = [];
  for (let p = 0; p < PART_COUNT; p++) {
    const base = PART_TABLE_OFFSET + p * PART_STRIDE;
    const steps: E2Step[] = [];
    let activeCount = 0;
    for (let s = 0; s < stepLength && s < STEPS_PER_PART; s++) {
      const step = decodeStep(
        body,
        base + PART_SEQ_OFFSET + s * PART_SEQ_STEP_SIZE
      );
      if (step.active) activeCount++;
      steps.push(step);
    }
    const egRaw = body[base + PART_FILTER_EGINT_OFFSET] ?? 0;
    parts.push({
      sampleRef: readU16LE(body, base + PART_OSC_REF_OFFSET),
      volume: body[base + PART_VOLUME_OFFSET] ?? 0,
      pan: body[base + PART_PAN_OFFSET] ?? 0,
      filterType: body[base + PART_FILTER_TYPE_OFFSET] ?? 0,
      cutoff: Math.min(127, body[base + PART_FILTER_CUTOFF_OFFSET] ?? 127),
      resonance: Math.min(127, body[base + PART_FILTER_RESONANCE_OFFSET] ?? 0),
      egInt: egRaw > 127 ? egRaw - 256 : egRaw, // i8
      steps,
      activeCount,
    });
  }
  return { name: readPatternName(body), bpm, stepLength, parts };
}

/** Kompakte Zusammenfassung eines gepullten Pattern-Bodies (Name + dekodierte Steps). */
export interface PatternSummary {
  name: string;
  oscRefs: number[]; // 16 Parts
  bodyLength: number;
  bpm: number;
  stepLength: number; // 16 | 32 | 64
  activeSteps: number[]; // aktive Steps pro Part (16)
  totalActive: number;
}
export function summarizePatternBody(body: Uint8Array): PatternSummary {
  const dec = decodePatternBody(body);
  const activeSteps = dec.parts.map(p => p.activeCount);
  return {
    name: dec.name,
    oscRefs: readPartOscRefs(body),
    bodyLength: body.length,
    bpm: dec.bpm,
    stepLength: dec.stepLength,
    activeSteps,
    totalActive: activeSteps.reduce((a, b) => a + b, 0),
  };
}

// ─── hacktribe-only: CPU-RAM Read/Write (0x52/0x53/0x54) ─────────────────────
// Verbatim aus e2sysex.py. Adressen 32-bit LE, danach 7-in-8-kodiert.
// NUR mit hacktribe-Firmware verfügbar. Writes gehen in DDR-RAM → Power-Cycle
// stellt wieder her. Ziel-Bereiche: IFX-/Groove-Preset-Tabellen (siehe unten).

/** uint32 → 4 Bytes Little-Endian (unsigned-safe für Adressen ≥ 0x80000000). */
export function u32le(n: number): number[] {
  const u = n >>> 0;
  return [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff];
}

/** Request: CPU-RAM lesen (0x52) — addr+len 32-bit LE, 7-in-8-kodiert. */
export function buildReadCpuRamRequest(
  addr: number,
  len: number,
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  const enc = encode7in8(Uint8Array.from([...u32le(addr), ...u32le(len)]));
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.READ_CPU_RAM),
    ...enc,
    SYSEX_END,
  ]);
}

/** Request 1/2: Schreib-Adresse+Länge setzen (0x53). */
export function buildSetWriteAddrRequest(
  addr: number,
  len: number,
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  const enc = encode7in8(Uint8Array.from([...u32le(addr), ...u32le(len)]));
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.SET_WRITE_ADDR),
    ...enc,
    SYSEX_END,
  ]);
}

/** Request 2/2: Schreib-Daten senden (0x54) — 7-in-8-kodiert. */
export function buildWriteCpuRamData(
  data: Uint8Array,
  opts: FrameOpts = {}
): Uint8Array {
  const { model = E2Model.SAMPLER, globalChannel = 0 } = opts;
  const enc = encode7in8(data);
  return Uint8Array.from([
    ...head(model, globalChannel, E2Func.WRITE_CPU_RAM),
    ...enc,
    SYSEX_END,
  ]);
}

// ─── IFX-Preset- & Groove-Template-Tabellen (hacktribe RAM) ──────────────────
export const IFX_BASE_ADDR = 0xc00a80f0;
export const IFX_STRIDE = 0x20c;
export const IFX_MAX = 100; // Index 0..99
export const IFX_COUNT_ADDR = 0xc003efdc; // 1 Byte: aktuelle Anzahl
export const GROOVE_BASE_ADDR = 0xc0143b00;
export const GROOVE_STRIDE = 0x140;
export const GROOVE_MAX = 128; // Index 0..127
export const GROOVE_COUNT_ADDR = 0xc007bb88; // 1 Byte: aktuelle Anzahl
/** Max. Nutzlast pro 0x54-Write (set_ifx splittet bei 0x100). */
export const CPU_RAM_WRITE_CHUNK = 0x100;

/** RAM-Adresse eines IFX-Preset-Slots (0..99). */
export function ifxPresetAddr(index: number): number {
  return IFX_BASE_ADDR + IFX_STRIDE * index;
}
/** RAM-Adresse eines Groove-Template-Slots (0..127). */
export function groovePresetAddr(index: number): number {
  return GROOVE_BASE_ADDR + GROOVE_STRIDE * index;
}

/** true, wenn [addr, addr+len) vollständig in der IFX- ODER Groove-Tabelle liegt. */
export function isWritablePresetRam(addr: number, len: number): boolean {
  const inRange = (base: number, stride: number, max: number) =>
    addr >= base && addr + len <= base + stride * max;
  return (
    inRange(IFX_BASE_ADDR, IFX_STRIDE, IFX_MAX) ||
    inRange(GROOVE_BASE_ADDR, GROOVE_STRIDE, GROOVE_MAX)
  );
}

// ─── Parsen eingehender SysEx ─────────────────────────────────────────────────
export type E2SysexParsed =
  | {
      kind: "identity";
      globalChannel: number;
      model: number;
      versionMajor: number;
      versionMinor: number;
    }
  | { kind: "currentPattern"; body: Uint8Array }
  | { kind: "pattern"; patternNumber: number; body: Uint8Array }
  | { kind: "global"; body: Uint8Array }
  | { kind: "cpuRamData"; data: Uint8Array }
  | { kind: "ack" }
  | { kind: "nak" }
  | { kind: "unknown"; func: number };

/**
 * Parst einen eingehenden Korg-E2-SysEx-Frame (inkl. F0…F7).
 * Gibt null zurück, wenn es kein Korg-E2-Frame ist (falsche Magic).
 * Pattern-/Global-Bodies werden mit decode7in8 zurück in 8-Bit gewandelt.
 */
export function parseSysex(bytes: Uint8Array | number[]): E2SysexParsed | null {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < 6 || b[0] !== SYSEX_START || b[1] !== KORG_ID) return null;

  // Device-Inquiry-Reply: F0 42 50 01 …
  if (b[2] === 0x50 && b[3] === 0x01) {
    return {
      kind: "identity",
      globalChannel: b[4] ?? 0,
      model: b[6] ?? 0,
      versionMajor: b[10] ?? 0,
      versionMinor: b[11] ?? 0,
    };
  }

  // Daten-Frame: F0 42 3g 00 01 <model> <func> …
  if (b[3] !== E2_FORMAT_PREFIX[0] || b[4] !== E2_FORMAT_PREFIX[1]) {
    return { kind: "unknown", func: b[6] ?? -1 };
  }
  const func = b[6];
  const endIdx = b[b.length - 1] === SYSEX_END ? b.length - 1 : b.length;

  switch (func) {
    case E2Func.CURRENT_PATTERN_DUMP:
      return {
        kind: "currentPattern",
        body: decode7in8(b.subarray(7, endIdx)),
      };
    case E2Func.PATTERN_DUMP:
      return {
        kind: "pattern",
        patternNumber: midiToPatternNumber(b[7] ?? 0, b[8] ?? 0),
        body: decode7in8(b.subarray(9, endIdx)),
      };
    case E2Func.GLOBAL_DUMP:
      return { kind: "global", body: decode7in8(b.subarray(7, endIdx)) };
    case E2Func.READ_CPU_RAM:
      // RAM-Read-Reply: Daten ab Index 9 (e2sysex.py: syx_dec(response[9:-1])).
      return { kind: "cpuRamData", data: decode7in8(b.subarray(9, endIdx)) };
    case E2Func.ACK:
      return { kind: "ack" };
    case E2Func.NAK:
      return { kind: "nak" };
    default:
      return { kind: "unknown", func };
  }
}
