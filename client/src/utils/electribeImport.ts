/**
 * client/src/utils/electribeImport.ts
 *
 * TASK-237 / v2.88.0 — KORG Electribe 2 Pattern-Importer.
 *
 * Unterstuetzte Formate:
 *   - `.e2pattern`   = Single-Pattern-Export
 *   - `.e2sallpat`   = "All-Pattern"-Bank (mehrere Patterns)
 *
 * Format-Status:
 *   ⚠ BEST-EFFORT-SPEZIFIKATION. Das KORG Electribe 2 Sampler-Pattern-Format
 *   ist NICHT offiziell dokumentiert. Die hier implementierten Offsets/
 *   Struktur-Annahmen basieren auf oeffentlich verfuegbaren Community-
 *   Reverse-Engineering-Notes (Forum-Posts, Korg-Tools-Source-Analysen) und
 *   einem konservativen "Skip-vor-Pattern-Block"-Ansatz, der auf der
 *   Praesenz des Magic-Bytes "KORG" und einer plausiblen Pattern-Anzahl
 *   beruht. Echte Files koennen Offset-Verschiebungen haben — der Parser
 *   schaltet defensiv bei out-of-range Reads in den Fehlerpfad zurueck.
 *
 *   Falls der Importer auf realen Files unzureichend funktioniert, ist die
 *   naechste Anlaufstelle:
 *     - parseElectribeBank() — Bank-Header-Offset-Korrektur
 *     - parsePatternBlock() — Pattern-internal-Layout (Name/BPM/Step-Tabelle)
 *     - PATTERN_BLOCK_SIZE / PART_BLOCK_SIZE Konstanten
 *
 *   Die Test-Suite (tests/features/electribe-import.test.ts) baut
 *   synthetische Buffer mit dem hier dokumentierten Layout — diese
 *   Buffer reflektieren NICHT zwingend reale .e2sallpat-Files, sondern
 *   die hier vereinbarte Best-Effort-Spec. Reale Validierung benoetigt
 *   eine handvoll Original-Files vom Geraet.
 *
 * Endianness:
 *   - Multi-Byte-Integer LITTLE-ENDIAN (DataView.getUint*LE-Varianten).
 *   - BPM 16-bit fixed-point (Wert/10 → BPM, z.B. 1200 = 120.0 BPM).
 *
 * Pattern-Struktur (Best-Effort):
 *   - Magic           4 Bytes "KORG" (ASCII)
 *   - Version         2 Bytes LE   (Format-Version, z.B. 0x0001)
 *   - Pattern-Count   2 Bytes LE   (.e2pattern: 1, .e2sallpat: bis 250)
 *   - Pattern-Block * Pattern-Count
 *
 * Pattern-Block (PATTERN_BLOCK_SIZE Bytes):
 *   - Name            8 Bytes ASCII (null-padded)
 *   - BPM             2 Bytes LE   (BPM*10, Range 200..3000 → 20..300 BPM)
 *   - StepLength      1 Byte       (Step-Anzahl 16/32/64)
 *   - Swing           1 Byte       (0..100, Prozent)
 *   - Reserved        4 Bytes
 *   - Part[16]        16 × PART_BLOCK_SIZE
 *
 * Part-Block (PART_BLOCK_SIZE Bytes):
 *   - SampleId        2 Bytes LE   (Patch/Sample-Nummer, 0..0xFFFF)
 *   - Volume          1 Byte       (0..127)
 *   - Pan             1 Byte       (0..127, 64 = center)
 *   - Pitch           1 Byte       (signed, -64..+63 semitones)
 *   - FxSend          1 Byte       (0..127)
 *   - Reserved        2 Bytes
 *   - Steps[64]       64 × 1 Byte  (Bit 7 = active, Bits 0..6 = velocity 0..127)
 *   - Motion[4]       4 × MOTION_SLOT_SIZE
 *
 * Motion-Slot (MOTION_SLOT_SIZE Bytes):
 *   - ParamId         1 Byte       (0..255, geraete-spezifisch — siehe MOTION_PARAM_NAMES)
 *   - Enabled         1 Byte       (0/1)
 *   - Reserved        2 Bytes
 *   - Values[16]      16 × 1 Byte  (Parameter-Werte 0..127)
 */

// ─── Konstanten ───────────────────────────────────────────────────────────────

export const ELECTRIBE_MAGIC = "KORG";

/** Maximale Pattern-Anzahl in einer Bank (.e2sallpat speichert bis 250). */
export const MAX_PATTERNS_PER_BANK = 250;

/** Anzahl Parts pro Pattern (Electribe 2 Sampler hat 16: 8 Drum + 6 Synth + 2 Stretch/Audio). */
export const PARTS_PER_PATTERN = 16;

/** Maximale Step-Anzahl pro Part. */
export const STEPS_PER_PART = 64;

/** Anzahl Motion-Sequencer-Slots pro Part. */
export const MOTION_SLOTS_PER_PART = 4;

/** Motion-Sequencer-Steps pro Slot (1 Bar @ 16 Steps). */
export const MOTION_STEPS_PER_SLOT = 16;

/** BPM-Bereich gemaess Hardware-Spec. */
export const ELECTRIBE_MIN_BPM = 20;
export const ELECTRIBE_MAX_BPM = 300;

/** Sample-Size der Sub-Strukturen (Best-Effort-Spec). */
export const PATTERN_HEADER_SIZE   = 16; // Name(8) + BPM(2) + StepLength(1) + Swing(1) + Reserved(4)
export const PART_HEADER_SIZE      = 8;  // SampleId(2) + Volume(1) + Pan(1) + Pitch(1) + FxSend(1) + Reserved(2)
export const MOTION_SLOT_SIZE      = 4 + MOTION_STEPS_PER_SLOT; // ParamId(1)+Enabled(1)+Reserved(2)+16 Values
export const PART_BLOCK_SIZE       = PART_HEADER_SIZE + STEPS_PER_PART + (MOTION_SLOTS_PER_PART * MOTION_SLOT_SIZE);
export const PATTERN_BLOCK_SIZE    = PATTERN_HEADER_SIZE + (PARTS_PER_PATTERN * PART_BLOCK_SIZE);

/** Bank-Header: Magic(4) + Version(2) + PatternCount(2) = 8 Bytes. */
export const BANK_HEADER_SIZE = 8;

/** Maximum acceptable file size (Hard-Cap, Schutz vor riesigen Inputs). */
export const MAX_ELECTRIBE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Mapping ParamId → Anzeigename. Best-Effort — die echten ParamIds des Electribe 2
 * sind geraete-spezifisch und nicht oeffentlich dokumentiert. Diese Liste
 * abdeckt die wichtigsten User-bekannten Parameter; unbekannte IDs werden
 * "Param NN" benannt.
 */
export const MOTION_PARAM_NAMES: Record<number, string> = {
  0:  "Filter Cutoff",
  1:  "Filter Resonance",
  2:  "Filter Drive",
  3:  "Amp EG Attack",
  4:  "Amp EG Decay",
  5:  "Pitch",
  6:  "Pan",
  7:  "Volume",
  8:  "FX Send",
  9:  "Master FX Depth",
  10: "Modulation Depth",
  11: "Modulation Speed",
  12: "Sample Start",
  13: "Sample End",
  14: "Reverse",
  15: "Roll",
};

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ParsedMotionSlot {
  /** ParamId aus dem File (0..255). */
  paramId: number;
  /** Anzeigename (aus MOTION_PARAM_NAMES, sonst "Param NN"). */
  paramName: string;
  enabled: boolean;
  /** 16 Werte, 0..127. */
  values: number[];
}

export interface ParsedPartStep {
  active: boolean;
  /** 0..127. */
  velocity: number;
}

export interface ParsedPart {
  /** 0..15 — der Part-Index im Pattern. */
  index: number;
  /** Sample/Patch-ID aus dem Electribe-File (NICHT auf Synthstudio-Sample gemappt). */
  sampleId: number;
  /** 0..127. */
  volume: number;
  /** 0..127 (64 = center). */
  pan: number;
  /** Signed -64..+63 semitones. */
  pitch: number;
  /** 0..127. */
  fxSend: number;
  /** Trigger-Steps, immer `STEPS_PER_PART` lang. */
  steps: ParsedPartStep[];
  /** 4 Motion-Sequencer-Slots. */
  motion: ParsedMotionSlot[];
}

export interface ParsedPattern {
  /** Sanitisierter ASCII-Name (max 8 Zeichen). */
  name: string;
  /** BPM (z.B. 120.0). */
  bpm: number;
  /** 16, 32 oder 64. */
  stepLength: number;
  /** Swing 0..100. */
  swing: number;
  /** 16 Parts. */
  parts: ParsedPart[];
}

export interface ParsedElectribeBank {
  version: number;
  patternCount: number;
  patterns: ParsedPattern[];
}

// ─── Reader-Helper ────────────────────────────────────────────────────────────

class SafeReader {
  pos = 0;
  readonly view: DataView;
  readonly length: number;

  constructor(view: DataView) {
    this.view  = view;
    this.length = view.byteLength;
  }

  remaining(): number {
    return this.length - this.pos;
  }

  ensure(n: number, context: string): void {
    if (this.pos < 0 || this.pos + n > this.length) {
      throw new Error(
        `Electribe-Parser: out-of-bounds read (${context}) — need ${n} byte(s) at ${this.pos}, have ${this.length - this.pos}`,
      );
    }
  }

  u8(context = "u8"): number {
    this.ensure(1, context);
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  i8(context = "i8"): number {
    this.ensure(1, context);
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  u16LE(context = "u16"): number {
    this.ensure(2, context);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  ascii(n: number, context = "ascii"): string {
    this.ensure(n, context);
    let s = "";
    for (let i = 0; i < n; i++) {
      const b = this.view.getUint8(this.pos + i);
      if (b === 0) continue;
      // Nur Druck-ASCII zulassen (32..126), Rest wird gestrippt.
      if (b >= 32 && b <= 126) s += String.fromCharCode(b);
    }
    this.pos += n;
    return s.trim();
  }

  skip(n: number, context = "skip"): void {
    this.ensure(n, context);
    this.pos += n;
  }
}

// ─── Eingabe-Normalisierung ──────────────────────────────────────────────────

function toDataView(input: ArrayBuffer | Uint8Array | DataView): DataView {
  if (input instanceof DataView) return input;
  if (input instanceof Uint8Array) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return new DataView(input);
  }
  throw new Error("Electribe-Parser: Eingabe muss ArrayBuffer, Uint8Array oder DataView sein.");
}

// ─── Pattern-Block-Parser ────────────────────────────────────────────────────

function parsePartBlock(reader: SafeReader, index: number): ParsedPart {
  // Part-Header
  const sampleId = reader.u16LE(`part[${index}].sampleId`);
  const volume   = reader.u8(`part[${index}].volume`);
  const pan      = reader.u8(`part[${index}].pan`);
  const pitch    = reader.i8(`part[${index}].pitch`);
  const fxSend   = reader.u8(`part[${index}].fxSend`);
  reader.skip(2, `part[${index}].reserved`);

  // Steps (1 Byte / Step)
  const steps: ParsedPartStep[] = new Array(STEPS_PER_PART);
  for (let s = 0; s < STEPS_PER_PART; s++) {
    const b = reader.u8(`part[${index}].step[${s}]`);
    const active   = (b & 0x80) !== 0;
    const velocity = b & 0x7f;
    steps[s] = { active, velocity };
  }

  // Motion-Slots
  const motion: ParsedMotionSlot[] = new Array(MOTION_SLOTS_PER_PART);
  for (let m = 0; m < MOTION_SLOTS_PER_PART; m++) {
    const paramId = reader.u8(`part[${index}].motion[${m}].paramId`);
    const enabled = reader.u8(`part[${index}].motion[${m}].enabled`) !== 0;
    reader.skip(2, `part[${index}].motion[${m}].reserved`);
    const values: number[] = new Array(MOTION_STEPS_PER_SLOT);
    for (let v = 0; v < MOTION_STEPS_PER_SLOT; v++) {
      values[v] = reader.u8(`part[${index}].motion[${m}].value[${v}]`);
    }
    motion[m] = {
      paramId,
      paramName: MOTION_PARAM_NAMES[paramId] ?? `Param ${paramId}`,
      enabled,
      values,
    };
  }

  return {
    index,
    sampleId,
    volume,
    pan,
    pitch,
    fxSend,
    steps,
    motion,
  };
}

function parsePatternBlock(reader: SafeReader, indexHint: number): ParsedPattern {
  const name       = reader.ascii(8, `pattern[${indexHint}].name`);
  const bpmRaw     = reader.u16LE(`pattern[${indexHint}].bpm`);
  const stepLength = reader.u8(`pattern[${indexHint}].stepLength`);
  const swing      = reader.u8(`pattern[${indexHint}].swing`);
  reader.skip(4, `pattern[${indexHint}].reserved`);

  // BPM-Decode: fixed-point /10. Auf den valid Range klemmen, falls Garbage drin steht.
  let bpm = bpmRaw / 10;
  if (!Number.isFinite(bpm) || bpm < ELECTRIBE_MIN_BPM) bpm = ELECTRIBE_MIN_BPM;
  if (bpm > ELECTRIBE_MAX_BPM) bpm = ELECTRIBE_MAX_BPM;

  // StepLength-Klamp: 16/32/64 sind die einzigen Hardware-validen Werte.
  let validStepLength: number = stepLength;
  if (validStepLength !== 16 && validStepLength !== 32 && validStepLength !== 64) {
    validStepLength = 16;
  }

  const parts: ParsedPart[] = new Array(PARTS_PER_PATTERN);
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    parts[p] = parsePartBlock(reader, p);
  }

  return {
    name: name || `PATTERN_${indexHint + 1}`,
    bpm,
    stepLength: validStepLength,
    swing,
    parts,
  };
}

// ─── Public-API ──────────────────────────────────────────────────────────────

/**
 * Erkennt das Format anhand der ersten Bytes + Pattern-Count.
 *
 * @returns "pattern" fuer single .e2pattern, "bank" fuer .e2sallpat.
 *          Wirft Error wenn Magic fehlt.
 */
export function detectElectribeFormat(input: ArrayBuffer | Uint8Array | DataView): "pattern" | "bank" {
  const view = toDataView(input);
  if (view.byteLength < BANK_HEADER_SIZE) {
    throw new Error("Electribe-Parser: Datei zu klein (< 8 Bytes Header).");
  }
  const reader = new SafeReader(view);
  const magic  = reader.ascii(4, "magic");
  if (magic !== ELECTRIBE_MAGIC) {
    throw new Error(`Electribe-Parser: ungueltiges Magic "${magic}", erwartet "${ELECTRIBE_MAGIC}".`);
  }
  reader.u16LE("version");
  const count = reader.u16LE("patternCount");
  if (count <= 1) return "pattern";
  return "bank";
}

/**
 * Parst eine `.e2sallpat`-Bank oder ein `.e2pattern`-File.
 *
 * @throws Error bei invalid Magic, out-of-bounds, oder Pattern-Count > 250.
 */
export function parseElectribeBank(input: ArrayBuffer | Uint8Array | DataView): ParsedElectribeBank {
  const view = toDataView(input);
  if (view.byteLength > MAX_ELECTRIBE_FILE_BYTES) {
    throw new Error(`Electribe-Parser: Datei zu gross (${view.byteLength} > ${MAX_ELECTRIBE_FILE_BYTES}).`);
  }
  if (view.byteLength < BANK_HEADER_SIZE) {
    throw new Error("Electribe-Parser: Datei zu klein (< 8 Bytes Header).");
  }

  const reader = new SafeReader(view);
  const magic  = reader.ascii(4, "magic");
  if (magic !== ELECTRIBE_MAGIC) {
    throw new Error(`Electribe-Parser: ungueltiges Magic "${magic}", erwartet "${ELECTRIBE_MAGIC}".`);
  }
  const version       = reader.u16LE("version");
  const patternCount  = reader.u16LE("patternCount");

  if (patternCount < 0 || patternCount > MAX_PATTERNS_PER_BANK) {
    throw new Error(`Electribe-Parser: ungueltige Pattern-Anzahl ${patternCount} (max ${MAX_PATTERNS_PER_BANK}).`);
  }

  // Pflicht-Plausibilitaet: bleibt mindestens patternCount * PATTERN_BLOCK_SIZE Bytes uebrig?
  const expectedBytes = patternCount * PATTERN_BLOCK_SIZE;
  if (reader.remaining() < expectedBytes) {
    throw new Error(
      `Electribe-Parser: Datei zu kurz fuer ${patternCount} Patterns — ` +
      `brauche ${expectedBytes} Bytes, habe ${reader.remaining()} Bytes uebrig.`,
    );
  }

  const patterns: ParsedPattern[] = new Array(patternCount);
  for (let i = 0; i < patternCount; i++) {
    patterns[i] = parsePatternBlock(reader, i);
  }

  return { version, patternCount, patterns };
}

/**
 * Parst eine `.e2pattern`-Datei (oder die erste Pattern aus einer Bank).
 *
 * @throws Error bei invalid Magic oder leerer Bank.
 */
export function parseElectribePattern(input: ArrayBuffer | Uint8Array | DataView): ParsedPattern {
  const bank = parseElectribeBank(input);
  if (bank.patternCount < 1 || bank.patterns.length === 0) {
    throw new Error("Electribe-Parser: Datei enthaelt keine Patterns.");
  }
  return bank.patterns[0];
}

// ─── Konvertierung zu Synthstudio-Format ─────────────────────────────────────

/**
 * Output der Konvertierung — keine direkte Store-Modifikation, der Aufrufer
 * verteilt die Daten:
 *
 *   - `drumParts` → useDrumMachineStore.setPartSteps()
 *   - `automationLanes` → useAutomationStore.addLane() + setPoint()
 *   - `bpm` → useDrumMachineStore.setPatternBpm() oder global setBpm
 *   - `name` → useDrumMachineStore.renamePattern()
 */
export interface SynthstudioPatternImport {
  /** Pattern-Anzeigename. */
  name: string;
  /** BPM (z.B. 120.0). */
  bpm: number;
  /** Pattern-Step-Count (16 oder 32 — Hardware-64 wird auf 32 geclampt mit Warn). */
  stepCount: 16 | 32;
  /** Swing 0..100 (aktuell Info-only — Synthstudio hat eigenes Groove-System). */
  swing: number;
  /**
   * Pro Electribe-Part ein Objekt:
   *   - partIndex: 0..15 → mappt 1:1 auf Drum-Parts-Index (8 Drums + 6 Synths + 2 Stretch)
   *   - sampleId: Original-Electribe-Sample-Patch (NICHT geladen — nur Meta)
   *   - steps[stepCount] boolean trigger
   *   - velocities[stepCount] 0..127
   *   - volume / pan (0..1 bzw. -1..+1 normalisiert)
   */
  drumParts: Array<{
    partIndex: number;
    sampleId: number;
    sampleHint: string;
    volume: number;
    pan: number;
    pitchSemitones: number;
    steps: boolean[];
    velocities: number[];
  }>;
  /**
   * Automation-Lanes aus den Motion-Sequencer-Slots. Pro aktiviertem Slot
   * eine Lane mit interpolierten Werten.
   */
  automationLanes: Array<{
    /** Vorgeschlagenes useAutomationStore-Target — bewusst informativ, der Aufrufer
     *  entscheidet ob er es so uebernimmt oder z.B. auf "fxParam"-Routing umwirft. */
    target: string;
    label: string;
    /** Sparse-Map step → value (0..1 normalisiert). */
    points: Record<number, number>;
    /** Min/Max (immer 0..1 fuer Motion-Slot-Werte). */
    min: number;
    max: number;
  }>;
}

/**
 * Konvertiert ein geparstes Electribe-Pattern in das Synthstudio-Import-Format.
 *
 * Annahmen:
 *   - Velocity-Skala 0..127 wird beibehalten (Synthstudio verwendet auch 0..127).
 *   - Volume 0..127 → 0..1.
 *   - Pan 0..127 (64=center) → -1..+1.
 *   - Pitch -64..+63 bleibt unveraendert.
 *   - StepCount 64 wird auf 32 geclampt (Synthstudio max ist 32).
 */
export function convertParsedPatternToSynthstudio(parsed: ParsedPattern): SynthstudioPatternImport {
  // StepCount-Mapping: Hardware 16 → 16, 32 → 32, 64 → 32 mit Truncation.
  const stepCount: 16 | 32 = parsed.stepLength >= 32 ? 32 : 16;
  const cap = Math.min(stepCount, parsed.stepLength);

  const drumParts: SynthstudioPatternImport["drumParts"] = parsed.parts.map(p => {
    // Velocity-Bit aus Step-Byte trennen → eigene velocity-Arrays.
    const stepsArr     = new Array<boolean>(stepCount).fill(false);
    const velocitiesArr = new Array<number>(stepCount).fill(100);
    for (let s = 0; s < cap; s++) {
      stepsArr[s]      = p.steps[s].active;
      velocitiesArr[s] = p.steps[s].velocity > 0 ? p.steps[s].velocity : 100;
    }
    // Sample-Hint Label: "Part 1" / "Synth 9" etc. Index 0..7 = Drum, 8..13 = Synth, 14..15 = Stretch.
    let sampleHint: string;
    if (p.index < 8) sampleHint = `Drum ${p.index + 1}`;
    else if (p.index < 14) sampleHint = `Synth ${p.index - 7}`;
    else sampleHint = `Stretch ${p.index - 13}`;

    return {
      partIndex: p.index,
      sampleId: p.sampleId,
      sampleHint,
      volume: clamp01(p.volume / 127),
      pan: clampPan((p.pan - 64) / 63),
      pitchSemitones: p.pitch,
      steps: stepsArr,
      velocities: velocitiesArr,
    };
  });

  // Automation-Lanes aus aktivierten Motion-Slots.
  const automationLanes: SynthstudioPatternImport["automationLanes"] = [];
  for (const part of parsed.parts) {
    for (let m = 0; m < part.motion.length; m++) {
      const slot = part.motion[m];
      if (!slot.enabled) continue;
      const points: Record<number, number> = {};
      for (let v = 0; v < slot.values.length; v++) {
        points[v] = clamp01(slot.values[v] / 127);
      }
      automationLanes.push({
        // Best-Effort-Target — der Aufrufer kann diesen String parsen.
        // Format: "<paramName>:<partIndex>" damit klar ist wer die Lane besitzt.
        target: `${slot.paramName}:${part.index}`,
        label: `${slot.paramName} (Part ${part.index + 1})`,
        points,
        min: 0,
        max: 1,
      });
    }
  }

  return {
    name: parsed.name,
    bpm: parsed.bpm,
    stepCount,
    swing: parsed.swing,
    drumParts,
    automationLanes,
  };
}

// ─── Kleine Helper (intern + exportiert fuer Tests) ─────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

/**
 * Validation-Helper fuer den IPC-Layer (Electron) / File-Drop (Browser).
 * Prueft nur die ersten 4 Bytes — keine vollstaendige Parser-Validierung.
 */
export function looksLikeElectribeFile(buffer: ArrayBuffer | Uint8Array): boolean {
  try {
    const view = toDataView(buffer);
    if (view.byteLength < BANK_HEADER_SIZE) return false;
    const reader = new SafeReader(view);
    const magic  = reader.ascii(4, "magic");
    return magic === ELECTRIBE_MAGIC;
  } catch {
    return false;
  }
}
