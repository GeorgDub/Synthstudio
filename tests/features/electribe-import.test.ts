/**
 * tests/features/electribe-import.test.ts
 *
 * TASK-237 (v2.88.0) — Unit-Tests fuer den KORG Electribe 2 Pattern-Importer.
 *
 * Test-Strategie:
 *   - Synthetische ArrayBuffer per Builder-Helper "buildElectribeBuffer()"
 *     mit dem in `electribeImport.ts` dokumentierten Best-Effort-Layout.
 *   - Tests verifizieren das Parser-Verhalten gegen diese Buffer.
 *   - KEIN echtes .e2pattern/.e2sallpat-Binary checked-in.
 *
 * Reale Hardware-Files koennen Offset-Verschiebungen haben. In dem Fall
 * muessen die hier definierten Layout-Konstanten + die Parser-Offsets
 * gemeinsam kalibriert werden.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ELECTRIBE_MAGIC,
  ELECTRIBE_REAL_IDENTIFIER,
  ELECTRIBE_REAL_PATTERN_MARKER,
  ELECTRIBE_REAL_FILE_SIZE,
  ELECTRIBE_REAL_NAME_OFFSET,
  ELECTRIBE_REAL_BPM_OFFSET,
  ELECTRIBE_REAL_PARTS_OFFSET,
  ELECTRIBE_REAL_PART_STRIDE,
  MAX_PATTERNS_PER_BANK,
  PARTS_PER_PATTERN,
  STEPS_PER_PART,
  MOTION_SLOTS_PER_PART,
  MOTION_STEPS_PER_SLOT,
  PATTERN_BLOCK_SIZE,
  PART_BLOCK_SIZE,
  PATTERN_HEADER_SIZE,
  PART_HEADER_SIZE,
  MOTION_SLOT_SIZE,
  BANK_HEADER_SIZE,
  parseElectribeBank,
  parseElectribePattern,
  convertParsedPatternToSynthstudio,
  detectElectribeFormat,
  isRealElectribeFile,
  looksLikeElectribeFile,
  clamp01,
  clampPan,
} from "../../client/src/utils/electribeImport";

// ─── Buffer-Builder (synthetische Test-Fixtures) ─────────────────────────────

interface MotionSpec {
  paramId: number;
  enabled: boolean;
  values: number[]; // erwartet 16 Werte, sonst gefuellt mit 0
}

interface PartSpec {
  sampleId?: number;
  volume?: number;
  pan?: number;
  pitch?: number;
  fxSend?: number;
  /** stepIndex → velocity (1..127). Active wird via Bit-7 gesetzt. */
  triggers?: Record<number, number>;
  motion?: MotionSpec[];
}

interface PatternSpec {
  name?: string;
  bpm?: number;
  stepLength?: number;
  swing?: number;
  parts?: PartSpec[];
}

function buildPartBlock(spec: PartSpec): Uint8Array {
  const buf = new Uint8Array(PART_BLOCK_SIZE);
  const view = new DataView(buf.buffer);
  let pos = 0;
  view.setUint16(pos, spec.sampleId ?? 0, true); pos += 2;
  view.setUint8(pos, spec.volume ?? 100);        pos += 1;
  view.setUint8(pos, spec.pan ?? 64);            pos += 1;
  view.setInt8(pos, spec.pitch ?? 0);            pos += 1;
  view.setUint8(pos, spec.fxSend ?? 0);          pos += 1;
  pos += 2; // reserved

  // Steps
  for (let s = 0; s < STEPS_PER_PART; s++) {
    const v = spec.triggers?.[s];
    if (v !== undefined) {
      const vel = Math.min(127, Math.max(1, v));
      buf[pos] = 0x80 | (vel & 0x7f);
    }
    pos += 1;
  }

  // Motion-Slots
  for (let m = 0; m < MOTION_SLOTS_PER_PART; m++) {
    const slot = spec.motion?.[m];
    view.setUint8(pos, slot?.paramId ?? 0);            pos += 1;
    view.setUint8(pos, slot?.enabled ? 1 : 0);          pos += 1;
    pos += 2; // reserved
    for (let v = 0; v < MOTION_STEPS_PER_SLOT; v++) {
      view.setUint8(pos, slot?.values?.[v] ?? 0);       pos += 1;
    }
  }
  return buf;
}

function buildPatternBlock(spec: PatternSpec): Uint8Array {
  const buf = new Uint8Array(PATTERN_BLOCK_SIZE);
  const view = new DataView(buf.buffer);
  let pos = 0;
  // Name 8 Bytes ASCII
  const name = (spec.name ?? "TEST").slice(0, 8);
  for (let i = 0; i < 8; i++) {
    buf[pos + i] = i < name.length ? name.charCodeAt(i) : 0;
  }
  pos += 8;
  // BPM (BPM*10)
  view.setUint16(pos, Math.round((spec.bpm ?? 120) * 10), true); pos += 2;
  // StepLength
  view.setUint8(pos, spec.stepLength ?? 16);                     pos += 1;
  // Swing
  view.setUint8(pos, spec.swing ?? 50);                          pos += 1;
  pos += 4; // reserved

  // Parts
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    const partBuf = buildPartBlock(spec.parts?.[p] ?? {});
    buf.set(partBuf, pos);
    pos += PART_BLOCK_SIZE;
  }
  return buf;
}

function buildElectribeBuffer(opts: {
  magic?: string;
  version?: number;
  patternCount?: number;
  patterns?: PatternSpec[];
  truncate?: number; // Bytes vom Ende abschneiden
}): ArrayBuffer {
  const magic = opts.magic ?? ELECTRIBE_MAGIC;
  const version = opts.version ?? 1;
  const count = opts.patternCount ?? (opts.patterns?.length ?? 1);
  const total = BANK_HEADER_SIZE + count * PATTERN_BLOCK_SIZE;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let pos = 0;
  for (let i = 0; i < 4; i++) buf[pos + i] = magic.charCodeAt(i) || 0;
  pos += 4;
  view.setUint16(pos, version, true); pos += 2;
  view.setUint16(pos, count, true);   pos += 2;

  for (let i = 0; i < count; i++) {
    const spec = opts.patterns?.[i] ?? {};
    const block = buildPatternBlock(spec);
    buf.set(block, pos);
    pos += PATTERN_BLOCK_SIZE;
  }

  if (opts.truncate && opts.truncate > 0) {
    return buf.slice(0, Math.max(0, total - opts.truncate)).buffer;
  }
  return buf.buffer;
}

// ─── Tests: Sanity / Magic ───────────────────────────────────────────────────

describe("electribeImport – Magic & Format-Detection", () => {
  it("erkennt das KORG-Magic", () => {
    const ab = buildElectribeBuffer({ patternCount: 1 });
    expect(() => parseElectribeBank(ab)).not.toThrow();
  });

  it("wirft bei invalid Magic", () => {
    const ab = buildElectribeBuffer({ magic: "JUNK", patternCount: 1 });
    expect(() => parseElectribeBank(ab)).toThrow(/Magic/);
  });

  it("wirft bei zu kleinem Buffer (< 8 Bytes)", () => {
    const ab = new ArrayBuffer(4);
    expect(() => parseElectribeBank(ab)).toThrow(/zu klein/);
  });

  it("detectElectribeFormat unterscheidet single-pattern vs bank", () => {
    const single = buildElectribeBuffer({ patternCount: 1 });
    const bank   = buildElectribeBuffer({ patternCount: 3 });
    expect(detectElectribeFormat(single)).toBe("pattern");
    expect(detectElectribeFormat(bank)).toBe("bank");
  });

  it("looksLikeElectribeFile akzeptiert valid magic, ablehnt junk", () => {
    expect(looksLikeElectribeFile(buildElectribeBuffer({ patternCount: 1 }))).toBe(true);
    const junk = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]).buffer;
    expect(looksLikeElectribeFile(junk)).toBe(false);
    expect(looksLikeElectribeFile(new Uint8Array([1, 2]).buffer)).toBe(false);
  });

  it("akzeptiert Uint8Array, ArrayBuffer und DataView als Input", () => {
    const ab = buildElectribeBuffer({ patternCount: 1 });
    expect(() => parseElectribeBank(ab)).not.toThrow();
    expect(() => parseElectribeBank(new Uint8Array(ab))).not.toThrow();
    expect(() => parseElectribeBank(new DataView(ab))).not.toThrow();
  });
});

// ─── Tests: Pattern-Header (Name / BPM / StepLength / Swing) ────────────────

describe("electribeImport – Pattern-Header", () => {
  it("liest BPM korrekt (120 BPM)", () => {
    const ab = buildElectribeBuffer({ patterns: [{ bpm: 120 }] });
    const p  = parseElectribePattern(ab);
    expect(p.bpm).toBeCloseTo(120, 5);
  });

  it("liest BPM korrekt (95.5 BPM Fixed-Point)", () => {
    const ab = buildElectribeBuffer({ patterns: [{ bpm: 95.5 }] });
    const p  = parseElectribePattern(ab);
    expect(p.bpm).toBeCloseTo(95.5, 1);
  });

  it("klemmt BPM auf gueltigen Bereich (20..300)", () => {
    const tooHigh = buildElectribeBuffer({ patterns: [{ bpm: 999 }] });
    const tooLow  = buildElectribeBuffer({ patterns: [{ bpm: 5 }] });
    expect(parseElectribePattern(tooHigh).bpm).toBe(300);
    expect(parseElectribePattern(tooLow).bpm).toBe(20);
  });

  it("liest Pattern-Namen", () => {
    const ab = buildElectribeBuffer({ patterns: [{ name: "AcidHse" }] });
    expect(parseElectribePattern(ab).name).toBe("AcidHse");
  });

  it("trimmt Null-Bytes im Namen + strippt non-ASCII", () => {
    // Builder paddet mit 0x00 — Test stellt sicher dass der Parser sie wegfiltert.
    const ab = buildElectribeBuffer({ patterns: [{ name: "AB" }] });
    expect(parseElectribePattern(ab).name).toBe("AB");
  });

  it("falled back auf PATTERN_N wenn Name leer", () => {
    const ab = buildElectribeBuffer({ patterns: [{ name: "" }] });
    expect(parseElectribePattern(ab).name).toBe("PATTERN_1");
  });

  it("klemmt invalide StepLength auf 16", () => {
    const ab = buildElectribeBuffer({ patterns: [{ stepLength: 99 }] });
    expect(parseElectribePattern(ab).stepLength).toBe(16);
  });

  it("akzeptiert StepLength 16/32/64", () => {
    expect(parseElectribePattern(buildElectribeBuffer({ patterns: [{ stepLength: 16 }] })).stepLength).toBe(16);
    expect(parseElectribePattern(buildElectribeBuffer({ patterns: [{ stepLength: 32 }] })).stepLength).toBe(32);
    expect(parseElectribePattern(buildElectribeBuffer({ patterns: [{ stepLength: 64 }] })).stepLength).toBe(64);
  });

  it("liest Swing-Byte", () => {
    const ab = buildElectribeBuffer({ patterns: [{ swing: 75 }] });
    expect(parseElectribePattern(ab).swing).toBe(75);
  });
});

// ─── Tests: Parts + Steps ────────────────────────────────────────────────────

describe("electribeImport – Parts + Steps", () => {
  it("liest 16 Parts mit 64 Steps", () => {
    const ab = buildElectribeBuffer({ patterns: [{}] });
    const p  = parseElectribePattern(ab);
    expect(p.parts).toHaveLength(PARTS_PER_PATTERN);
    expect(p.parts.every(part => part.steps.length === STEPS_PER_PART)).toBe(true);
  });

  it("liest Velocity aus Step-Byte (Bit7 = active, Bits0-6 = velocity)", () => {
    const ab = buildElectribeBuffer({
      patterns: [{ parts: [{ triggers: { 0: 100, 5: 64, 15: 1 } }] }],
    });
    const p  = parseElectribePattern(ab);
    const part0 = p.parts[0];
    expect(part0.steps[0]).toEqual({ active: true, velocity: 100 });
    expect(part0.steps[5]).toEqual({ active: true, velocity: 64 });
    expect(part0.steps[15]).toEqual({ active: true, velocity: 1 });
    expect(part0.steps[1].active).toBe(false);
  });

  it("liest Part-Header (sampleId, volume, pan, pitch, fxSend)", () => {
    const ab = buildElectribeBuffer({
      patterns: [{ parts: [{ sampleId: 0x1234, volume: 100, pan: 90, pitch: -12, fxSend: 50 }] }],
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[0].sampleId).toBe(0x1234);
    expect(p.parts[0].volume).toBe(100);
    expect(p.parts[0].pan).toBe(90);
    expect(p.parts[0].pitch).toBe(-12);
    expect(p.parts[0].fxSend).toBe(50);
  });

  it("liest signed Pitch korrekt (negatives Semitone)", () => {
    const ab = buildElectribeBuffer({ patterns: [{ parts: [{ pitch: -24 }] }] });
    expect(parseElectribePattern(ab).parts[0].pitch).toBe(-24);
  });

  it("liest 4 Motion-Slots pro Part", () => {
    const ab = buildElectribeBuffer({ patterns: [{}] });
    const p  = parseElectribePattern(ab);
    expect(p.parts[0].motion).toHaveLength(MOTION_SLOTS_PER_PART);
    expect(p.parts[0].motion.every(m => m.values.length === MOTION_STEPS_PER_SLOT)).toBe(true);
  });

  it("liest Motion-Slot-Werte", () => {
    const values = Array(MOTION_STEPS_PER_SLOT).fill(0).map((_, i) => i * 8);
    const ab = buildElectribeBuffer({
      patterns: [{ parts: [{ motion: [{ paramId: 0, enabled: true, values }] }] }],
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[0].motion[0].enabled).toBe(true);
    expect(p.parts[0].motion[0].paramName).toBe("Filter Cutoff");
    expect(p.parts[0].motion[0].values).toEqual(values);
  });

  it("benennt unbekannte ParamIds als 'Param NN'", () => {
    const ab = buildElectribeBuffer({
      patterns: [{ parts: [{ motion: [{ paramId: 200, enabled: true, values: [] }] }] }],
    });
    expect(parseElectribePattern(ab).parts[0].motion[0].paramName).toBe("Param 200");
  });
});

// ─── Tests: Bank (.e2sallpat) ────────────────────────────────────────────────

describe("electribeImport – Bank-File", () => {
  it("liefert array of patterns aus Bank-File", () => {
    const ab = buildElectribeBuffer({
      patterns: [{ name: "P1", bpm: 120 }, { name: "P2", bpm: 130 }, { name: "P3", bpm: 140 }],
    });
    const bank = parseElectribeBank(ab);
    expect(bank.patternCount).toBe(3);
    expect(bank.patterns.map(p => p.name)).toEqual(["P1", "P2", "P3"]);
    expect(bank.patterns.map(p => p.bpm)).toEqual([120, 130, 140]);
  });

  it("wirft bei Pattern-Count > MAX_PATTERNS_PER_BANK", () => {
    // Wir konstruieren Header mit count=999 aber kuerzem body — parser muss erst auf count-Limit pruefen.
    const buf = new Uint8Array(BANK_HEADER_SIZE);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < 4; i++) buf[i] = ELECTRIBE_MAGIC.charCodeAt(i);
    view.setUint16(4, 1, true);
    view.setUint16(6, MAX_PATTERNS_PER_BANK + 1, true);
    expect(() => parseElectribeBank(buf.buffer)).toThrow(/Pattern-Anzahl/);
  });

  it("akzeptiert exakt MAX_PATTERNS_PER_BANK Patterns", () => {
    // Wir konstruieren manuell — buildElectribeBuffer allokiert sonst 250 × ~16KB = 4 MB
    // (was zwar unter dem 5 MB Limit liegt aber den Test langsam macht).
    // Stattdessen: header mit count=250, kein body → parser muss wegen Plausi-Check werfen.
    const buf = new Uint8Array(BANK_HEADER_SIZE);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < 4; i++) buf[i] = ELECTRIBE_MAGIC.charCodeAt(i);
    view.setUint16(4, 1, true);
    view.setUint16(6, MAX_PATTERNS_PER_BANK, true);
    // Header valide, aber Body fehlt → muss "Datei zu kurz" werfen, NICHT "Pattern-Anzahl".
    expect(() => parseElectribeBank(buf.buffer)).toThrow(/zu kurz/);
  });
});

// ─── Tests: Out-of-bounds / Defensive ────────────────────────────────────────

describe("electribeImport – Defensive Reads", () => {
  it("wirft bei truncated Buffer mitten im Pattern-Block", () => {
    const ab = buildElectribeBuffer({ patternCount: 2, truncate: PATTERN_BLOCK_SIZE + 10 });
    expect(() => parseElectribeBank(ab)).toThrow();
  });

  it("wirft bei Datei > MAX_ELECTRIBE_FILE_BYTES", () => {
    // 6 MB buffer (> 5 MB Limit), valid magic.
    const huge = new Uint8Array(6 * 1024 * 1024);
    for (let i = 0; i < 4; i++) huge[i] = ELECTRIBE_MAGIC.charCodeAt(i);
    new DataView(huge.buffer).setUint16(4, 1, true);
    new DataView(huge.buffer).setUint16(6, 0, true);
    expect(() => parseElectribeBank(huge.buffer)).toThrow(/zu gross/);
  });

  it("parseElectribePattern wirft wenn patternCount=0", () => {
    const buf = new Uint8Array(BANK_HEADER_SIZE);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < 4; i++) buf[i] = ELECTRIBE_MAGIC.charCodeAt(i);
    view.setUint16(4, 1, true);
    view.setUint16(6, 0, true);
    expect(() => parseElectribePattern(buf.buffer)).toThrow(/keine Patterns/);
  });

  it("Layout-Konstanten sind self-konsistent", () => {
    expect(PART_BLOCK_SIZE).toBe(
      PART_HEADER_SIZE + STEPS_PER_PART + (MOTION_SLOTS_PER_PART * MOTION_SLOT_SIZE),
    );
    expect(PATTERN_BLOCK_SIZE).toBe(PATTERN_HEADER_SIZE + (PARTS_PER_PATTERN * PART_BLOCK_SIZE));
  });
});

// ─── Tests: Konvertierung zu Synthstudio ─────────────────────────────────────

describe("electribeImport – convertParsedPatternToSynthstudio", () => {
  it("mappt 16 Electribe-Parts auf drumParts mit partIndex 0..15", () => {
    const ab = buildElectribeBuffer({ patterns: [{}] });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.drumParts).toHaveLength(PARTS_PER_PATTERN);
    expect(conv.drumParts.map(d => d.partIndex)).toEqual(
      Array.from({ length: PARTS_PER_PATTERN }, (_, i) => i),
    );
  });

  it("vergibt sampleHint je nach Index (Drum/Synth/Stretch)", () => {
    const ab = buildElectribeBuffer({ patterns: [{}] });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.drumParts[0].sampleHint).toBe("Drum 1");
    expect(conv.drumParts[7].sampleHint).toBe("Drum 8");
    expect(conv.drumParts[8].sampleHint).toBe("Synth 1");
    expect(conv.drumParts[13].sampleHint).toBe("Synth 6");
    expect(conv.drumParts[14].sampleHint).toBe("Stretch 1");
    expect(conv.drumParts[15].sampleHint).toBe("Stretch 2");
  });

  it("kopiert Steps + Velocities ins richtige Drum-Part-Array", () => {
    const ab = buildElectribeBuffer({
      patterns: [{
        stepLength: 16,
        parts: [
          { triggers: { 0: 100, 4: 64 } },
          { triggers: { 2: 80 } },
        ],
      }],
    });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.drumParts[0].steps[0]).toBe(true);
    expect(conv.drumParts[0].steps[4]).toBe(true);
    expect(conv.drumParts[0].steps[1]).toBe(false);
    expect(conv.drumParts[0].velocities[0]).toBe(100);
    expect(conv.drumParts[0].velocities[4]).toBe(64);
    expect(conv.drumParts[1].steps[2]).toBe(true);
    expect(conv.drumParts[1].velocities[2]).toBe(80);
  });

  it("normalisiert volume 0..127 auf 0..1", () => {
    const ab = buildElectribeBuffer({ patterns: [{ parts: [{ volume: 127 }, { volume: 0 }, { volume: 64 }] }] });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.drumParts[0].volume).toBeCloseTo(1, 5);
    expect(conv.drumParts[1].volume).toBe(0);
    expect(conv.drumParts[2].volume).toBeCloseTo(64 / 127, 5);
  });

  it("normalisiert pan 0..127 (64=center) auf -1..+1", () => {
    const ab = buildElectribeBuffer({ patterns: [{ parts: [{ pan: 64 }, { pan: 127 }, { pan: 0 }] }] });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.drumParts[0].pan).toBe(0);
    expect(conv.drumParts[1].pan).toBe(1);
    expect(conv.drumParts[2].pan).toBeCloseTo(-1, 1);
  });

  it("clampt StepCount 64 auf 32 (Synthstudio-Limit)", () => {
    const ab = buildElectribeBuffer({ patterns: [{ stepLength: 64 }] });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.stepCount).toBe(32);
    expect(conv.drumParts[0].steps.length).toBe(32);
  });

  it("uebernimmt BPM und Pattern-Name", () => {
    const ab = buildElectribeBuffer({ patterns: [{ name: "MyBeat", bpm: 145 }] });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.bpm).toBeCloseTo(145, 1);
    expect(conv.name).toBe("MyBeat");
  });
});

// ─── Tests: Motion-Sequencer → AutomationLanes ───────────────────────────────

describe("electribeImport – Motion-Sequencer zu AutomationLanes", () => {
  it("aktivierte Motion-Slots landen in automationLanes", () => {
    const ab = buildElectribeBuffer({
      patterns: [{
        parts: [{
          motion: [
            { paramId: 0, enabled: true, values: Array(MOTION_STEPS_PER_SLOT).fill(127) },
            { paramId: 1, enabled: false, values: [] },
          ],
        }],
      }],
    });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    // Nur der enabled-Slot ist eine Lane.
    const lanes = conv.automationLanes.filter(l => l.label.includes("Filter Cutoff"));
    expect(lanes.length).toBeGreaterThanOrEqual(1);
  });

  it("normalisiert Motion-Werte 0..127 auf 0..1", () => {
    const values = Array.from({ length: MOTION_STEPS_PER_SLOT }, (_, i) => i * 8);
    const ab = buildElectribeBuffer({
      patterns: [{
        parts: [{ motion: [{ paramId: 0, enabled: true, values }] }],
      }],
    });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    const lane = conv.automationLanes.find(l => l.label.includes("Filter Cutoff"));
    expect(lane).toBeDefined();
    if (!lane) return;
    expect(lane.points[0]).toBe(0);
    expect(lane.points[15]).toBeCloseTo(120 / 127, 2);
    expect(lane.min).toBe(0);
    expect(lane.max).toBe(1);
  });

  it("disabled Motion-Slots erzeugen KEINE Lane", () => {
    const ab = buildElectribeBuffer({
      patterns: [{
        parts: [{ motion: [{ paramId: 5, enabled: false, values: [1, 2, 3] }] }],
      }],
    });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.automationLanes.find(l => l.target.startsWith("Pitch"))).toBeUndefined();
  });

  it("Lane-Target enthaelt paramName und partIndex", () => {
    const ab = buildElectribeBuffer({
      patterns: [{
        parts: [
          {},
          {},
          { motion: [{ paramId: 0, enabled: true, values: [10] }] },
        ],
      }],
    });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    const lane = conv.automationLanes[0];
    expect(lane).toBeDefined();
    expect(lane.target).toBe("Filter Cutoff:2");
    expect(lane.label).toContain("Part 3");
  });
});

// ─── Tests: Helper-Pures ─────────────────────────────────────────────────────

describe("electribeImport – clamp helpers", () => {
  it("clamp01 begrenzt auf [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
  });

  it("clampPan begrenzt auf [-1,+1]", () => {
    expect(clampPan(-2)).toBe(-1);
    expect(clampPan(0)).toBe(0);
    expect(clampPan(2)).toBe(1);
    expect(clampPan(NaN)).toBe(0);
  });
});

// ─── Tests: Echtes KORG E2 Sampler-Layout (v3.2.0 Calibration) ──────────────
//
// Diese Tests bauen synthetisch das ECHTE Real-File-Layout nach (Magic + ID +
// PTST-Marker + Name-Offset + BPM-Offset). Damit ist der Test deterministisch
// und das Repository bleibt frei von User-Daten / grossen Binary-Files.
//
// Falls die echten Files am erwarteten Pfad vorliegen, laufen zusaetzliche
// Real-File-Tests; sonst .skip mit Begruendung.

function buildRealElectribeBuffer(opts: {
  name?: string;
  bpm?: number;
  version?: number;
  totalSize?: number;
}): ArrayBuffer {
  const total = opts.totalSize ?? ELECTRIBE_REAL_FILE_SIZE;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // 0x00: "KORG" + 12× 0x00
  for (let i = 0; i < 4; i++) buf[i] = ELECTRIBE_MAGIC.charCodeAt(i);

  // 0x10: "e2sampler" + zeros
  const id = ELECTRIBE_REAL_IDENTIFIER;
  for (let i = 0; i < id.length; i++) buf[0x10 + i] = id.charCodeAt(i);

  // 0x20: version (u32 LE)
  view.setUint32(0x20, opts.version ?? 1, true);

  // 0x24..0x100: 0xFF padding (matches real files)
  for (let i = 0x24; i < 0x100; i++) buf[i] = 0xff;

  // 0x100: "PTST" + 12× 0x00
  const marker = ELECTRIBE_REAL_PATTERN_MARKER;
  for (let i = 0; i < marker.length; i++) buf[0x100 + i] = marker.charCodeAt(i);

  // 0x110: Pattern-Name (16 Byte ASCII, space-padded with trailing zeros)
  const name = (opts.name ?? "TestPattern").slice(0, 16);
  for (let i = 0; i < name.length; i++) buf[ELECTRIBE_REAL_NAME_OFFSET + i] = name.charCodeAt(i);

  // 0x122: BPM × 10 (u16 LE)
  view.setUint16(ELECTRIBE_REAL_BPM_OFFSET, Math.round((opts.bpm ?? 120) * 10), true);

  return buf.buffer;
}

describe("electribeImport – isRealElectribeFile detector", () => {
  it("erkennt synthetisch gebautes Real-File-Layout", () => {
    const ab = buildRealElectribeBuffer({ name: "Test", bpm: 120 });
    expect(isRealElectribeFile(ab)).toBe(true);
  });

  it("lehnt synthetisches Legacy-Layout ab (kein PTST-Marker)", () => {
    const legacy = new Uint8Array(BANK_HEADER_SIZE + PATTERN_BLOCK_SIZE);
    for (let i = 0; i < 4; i++) legacy[i] = ELECTRIBE_MAGIC.charCodeAt(i);
    expect(isRealElectribeFile(legacy.buffer)).toBe(false);
  });

  it("lehnt Buffer ohne KORG-Magic ab", () => {
    const ab = buildRealElectribeBuffer({ name: "X", bpm: 120 });
    const buf = new Uint8Array(ab);
    buf[0] = 0; // zerstoere Magic
    expect(isRealElectribeFile(buf.buffer)).toBe(false);
  });

  it("lehnt Buffer ohne e2sampler-ID ab", () => {
    const ab = buildRealElectribeBuffer({ name: "X", bpm: 120 });
    const buf = new Uint8Array(ab);
    buf[0x10] = 0; // zerstoere ID-Marker
    expect(isRealElectribeFile(buf.buffer)).toBe(false);
  });

  it("lehnt Buffer ohne PTST-Marker ab", () => {
    const ab = buildRealElectribeBuffer({ name: "X", bpm: 120 });
    const buf = new Uint8Array(ab);
    buf[0x100] = 0; // zerstoere Pattern-Marker
    expect(isRealElectribeFile(buf.buffer)).toBe(false);
  });

  it("lehnt zu kleine Buffer ab", () => {
    expect(isRealElectribeFile(new Uint8Array(0x100).buffer)).toBe(false);
  });
});

describe("electribeImport – Real-File Layout (synthetic)", () => {
  it("liest BPM aus 0x122 (u16 LE / 10) — 120 BPM", () => {
    const ab = buildRealElectribeBuffer({ name: "Init", bpm: 120 });
    const p = parseElectribePattern(ab);
    expect(p.bpm).toBeCloseTo(120, 1);
  });

  it("liest BPM 165.0 (BodyTalk1-Beispiel)", () => {
    const ab = buildRealElectribeBuffer({ name: "BodyTalk1", bpm: 165 });
    const p = parseElectribePattern(ab);
    expect(p.bpm).toBeCloseTo(165, 1);
  });

  it("liest Pattern-Namen aus 0x110 (max 16 Zeichen, trailing zeros gestrippt)", () => {
    const ab = buildRealElectribeBuffer({ name: "Advi$ory1", bpm: 128 });
    const p = parseElectribePattern(ab);
    expect(p.name).toBe("Advi$ory1");
  });

  it("liest Pattern-Namen 'Init Pattern' korrekt (12 Zeichen, mit Space)", () => {
    const ab = buildRealElectribeBuffer({ name: "Init Pattern", bpm: 120 });
    expect(parseElectribePattern(ab).name).toBe("Init Pattern");
  });

  it("liefert 16 Parts (mit Defaults — Best-Effort)", () => {
    const ab = buildRealElectribeBuffer({ name: "X", bpm: 120 });
    const p = parseElectribePattern(ab);
    expect(p.parts).toHaveLength(PARTS_PER_PATTERN);
    expect(p.parts.every(part => part.steps.length === STEPS_PER_PART)).toBe(true);
  });

  it("klemmt BPM-Garbage auf valid Range (Real-File-Path)", () => {
    const ab = buildRealElectribeBuffer({ name: "X", bpm: 5 });
    expect(parseElectribePattern(ab).bpm).toBe(20);
  });

  it("detectElectribeFormat liefert 'pattern' fuer Real-File-Layout", () => {
    const ab = buildRealElectribeBuffer({ name: "X", bpm: 120 });
    expect(detectElectribeFormat(ab)).toBe("pattern");
  });

  it("version aus 0x20 (u32 LE) in den Bank-Output uebernommen", () => {
    const ab = buildRealElectribeBuffer({ name: "X", bpm: 120, version: 1 });
    const bank = parseElectribeBank(ab);
    expect(bank.version).toBe(1);
    expect(bank.patternCount).toBe(1);
  });

  it("Real-File-Layout-Konstanten plausibel: 16 parts × 896 = 14336 ab 0x900 == 16640", () => {
    expect(
      ELECTRIBE_REAL_PARTS_OFFSET + PARTS_PER_PATTERN * ELECTRIBE_REAL_PART_STRIDE,
    ).toBe(ELECTRIBE_REAL_FILE_SIZE);
  });

  it("convertParsedPatternToSynthstudio funktioniert mit Real-File-Output", () => {
    const ab = buildRealElectribeBuffer({ name: "RealTest", bpm: 140 });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.name).toBe("RealTest");
    expect(conv.bpm).toBeCloseTo(140, 1);
    expect(conv.drumParts).toHaveLength(PARTS_PER_PATTERN);
  });
});

// ─── Tests: Echte KORG E2 Sampler-Files (nur wenn vorhanden) ─────────────────
//
// Falls die User-Files im Repo-Root unter "Korg e2s files/" liegen, laufen
// diese Tests gegen echte Bytes. Auf CI / Fresh-Clone ohne diese User-Daten
// wird .skip — das ist absichtlich, damit das Repo schlank bleibt.

const REAL_FILES_DIR = path.resolve(process.cwd(), "Korg e2s files");
const REAL_FILES_AVAILABLE = (() => {
  try {
    return fs.existsSync(REAL_FILES_DIR) && fs.statSync(REAL_FILES_DIR).isDirectory();
  } catch {
    return false;
  }
})();

function loadRealFile(name: string): Uint8Array | null {
  try {
    const full = path.join(REAL_FILES_DIR, name);
    if (!fs.existsSync(full)) return null;
    return new Uint8Array(fs.readFileSync(full));
  } catch {
    return null;
  }
}

// Note: Filenames enthalten ASCII-Spaces — exakt wie auf Disk.
const REAL_FILE_BODYTALK = "245_BodyTalk1   .e2spat";
const REAL_FILE_INIT_181 = "181_Init Pattern.e2spat";
const REAL_FILE_INIT_250 = "250_Init Pattern.e2spat";
const REAL_FILE_ADVISORY = "001_Advi$ory1   .e2spat";

(REAL_FILES_AVAILABLE ? describe : describe.skip)(
  "electribeImport – Real KORG E2 Sampler Files (.e2spat verified 2026-05-18)",
  () => {
    it("245_BodyTalk1.e2spat: 16640 Bytes, KORG + e2sampler magic, BPM=165, name='BodyTalk1'", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      expect(buf).not.toBeNull();
      if (!buf) return;
      expect(buf.byteLength).toBe(ELECTRIBE_REAL_FILE_SIZE);
      expect(isRealElectribeFile(buf)).toBe(true);
      const p = parseElectribePattern(buf);
      expect(p.bpm).toBeCloseTo(165, 1);
      expect(p.name).toBe("BodyTalk1");
    });

    it("181_Init Pattern.e2spat: BPM=120, name='Init Pattern'", () => {
      const buf = loadRealFile(REAL_FILE_INIT_181);
      expect(buf).not.toBeNull();
      if (!buf) return;
      const p = parseElectribePattern(buf);
      expect(p.bpm).toBeCloseTo(120, 1);
      expect(p.name).toBe("Init Pattern");
    });

    it("250_Init Pattern.e2spat: BPM=170, name='Init Pattern'", () => {
      const buf = loadRealFile(REAL_FILE_INIT_250);
      expect(buf).not.toBeNull();
      if (!buf) return;
      const p = parseElectribePattern(buf);
      // 250er-File hat ueberraschend BPM=170 — Init-Defaults variieren
      // pro Slot je nach Werkseinstellung des Geraets.
      expect(p.bpm).toBeCloseTo(170, 1);
      expect(p.name).toBe("Init Pattern");
    });

    it("001_Advisory1.e2spat: BPM=128, name='Advi$ory1', 16 Parts gerendert", () => {
      const buf = loadRealFile(REAL_FILE_ADVISORY);
      expect(buf).not.toBeNull();
      if (!buf) return;
      const p = parseElectribePattern(buf);
      expect(p.bpm).toBeCloseTo(128, 1);
      expect(p.name).toBe("Advi$ory1");
      expect(p.parts).toHaveLength(PARTS_PER_PATTERN);
    });

    it("Real-Files haben einheitliches Magic-Layout (4 Files round-trip)", () => {
      const files = [REAL_FILE_BODYTALK, REAL_FILE_INIT_181, REAL_FILE_INIT_250, REAL_FILE_ADVISORY];
      for (const name of files) {
        const buf = loadRealFile(name);
        if (!buf) continue;
        expect(buf.byteLength).toBe(ELECTRIBE_REAL_FILE_SIZE);
        expect(isRealElectribeFile(buf)).toBe(true);
        // detectElectribeFormat liefert 'pattern' (single)
        expect(detectElectribeFormat(buf)).toBe("pattern");
        // parseElectribePattern crasht nicht
        const p = parseElectribePattern(buf);
        expect(p.parts).toHaveLength(PARTS_PER_PATTERN);
      }
    });

    it("convertParsedPatternToSynthstudio mit echtem BodyTalk1 produziert valid Output", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const conv = convertParsedPatternToSynthstudio(parseElectribePattern(buf));
      expect(conv.name).toBe("BodyTalk1");
      expect(conv.bpm).toBeCloseTo(165, 1);
      expect(conv.drumParts).toHaveLength(PARTS_PER_PATTERN);
      // Step-Encoding ist Best-Effort — alle Steps inactive (default), aber nicht crashy.
      expect(conv.drumParts.every(d => Array.isArray(d.steps))).toBe(true);
    });
  },
);
