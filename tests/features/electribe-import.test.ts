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
  ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET,
  ELECTRIBE_ALLPAT_PATTERN_STRIDE,
  ELECTRIBE_ALLPAT_SLOT_COUNT,
  ELECTRIBE_ALLPAT_EXPECTED_SIZE,
  ELECTRIBE_ALLPAT_GLST_MARKER,
  ELECTRIBE_ALLPAT_GLST_OFFSET,
  parseElectribeBank,
  parseElectribePattern,
  parseElectribeAllPatBank,
  convertParsedPatternToSynthstudio,
  detectElectribeFormat,
  detectElectribeFormatKind,
  isRealElectribeFile,
  isElectribeAllPatBank,
  filterNonInitPatterns,
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
    expect(part0.steps[0]).toMatchObject({ active: true, velocity: 100 });
    expect(part0.steps[5]).toMatchObject({ active: true, velocity: 64 });
    expect(part0.steps[15]).toMatchObject({ active: true, velocity: 1 });
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
    // v3.11: Limit ist jetzt 8 MB. 9 MB Buffer ueberschreitet das.
    const huge = new Uint8Array(9 * 1024 * 1024);
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

  it("v3.39: StepCount 64 bleibt 64 (KORG-Parität, vorher 32-cap)", () => {
    const ab = buildElectribeBuffer({ patterns: [{ stepLength: 64 }] });
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(ab));
    expect(conv.stepCount).toBe(64);
    expect(conv.drumParts[0].steps.length).toBe(64);
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

  it("Real-File-Layout-Konstanten plausibel: 16 parts × 816 = 13056 ab 0x900 → 0x3C00 (+ 1280B trailing footer = 16640)", () => {
    // v3.12.0: Stride corrected to 816 (was 896 pre-RE).
    // Parts ends at 0x900 + 13056 = 0x3C00. Trailing 1280 bytes = pattern footer.
    const partsEnd = ELECTRIBE_REAL_PARTS_OFFSET + PARTS_PER_PATTERN * ELECTRIBE_REAL_PART_STRIDE;
    expect(partsEnd).toBe(0x3C00);
    expect(ELECTRIBE_REAL_FILE_SIZE - partsEnd).toBe(1280); // footer-size
    expect(ELECTRIBE_REAL_PART_STRIDE).toBe(816);
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
      // v3.12: Step-Encoding ist jetzt verified — BodyTalk1 hat aktive Steps.
      expect(conv.drumParts.every(d => Array.isArray(d.steps))).toBe(true);
    });
  },
);

// ─── v3.12.0 — Step-Encoding Reverse-Engineering Tests ───────────────────────
//
// Diese Tests verifizieren das neu RE-d 12-byte step-record-Layout (siehe
// electribeImport.ts Header-Kommentar). Sub-Tests conditional auf Real-File-
// Availability — die programmierten Patterns aus den User-Files sind die
// "ground truth" gegen die wir validieren.

(REAL_FILES_AVAILABLE ? describe : describe.skip)(
  "electribeImport – v3.12 Step-Encoding RE (Real-File-Verifikation)",
  () => {
    it("BodyTalk1: hat insgesamt mindestens 100 aktive steps verteilt auf mehrere parts", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      const totalActive = p.parts.reduce(
        (sum, part) => sum + part.steps.filter(s => s.active).length,
        0,
      );
      // Verifiziert via Hex-Inspection: BodyTalk hat ~290 aktive steps insgesamt.
      expect(totalActive).toBeGreaterThan(100);
      // Mindestens 6 parts haben programmierte triggers (verifiziert).
      const partsWithSteps = p.parts.filter(part => part.steps.some(s => s.active)).length;
      expect(partsWithSteps).toBeGreaterThanOrEqual(6);
    });

    it("Init181: minimaler Init-Pattern, max 1 Part hat steps (sehr wenige aktive)", () => {
      // Hex-RE: Init181 ist ein near-Init-Pattern. 15 von 16 Parts sind 100% empty.
      // Nur Part 8 hat 4 aktive Steps (0,4,8,12) — vermutlich ein default-bass-pattern
      // das KORG als "Init Sample" benutzt. Das ist OK, dieses Pattern ist nicht 100% leer.
      const buf = loadRealFile(REAL_FILE_INIT_181);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      const totalActive = p.parts.reduce(
        (sum, part) => sum + part.steps.filter(s => s.active).length,
        0,
      );
      const partsWithSteps = p.parts.filter(part => part.steps.some(s => s.active)).length;
      // Maximal 1 Part hat steps + maximal 4 aktive Steps insgesamt
      expect(partsWithSteps).toBeLessThanOrEqual(1);
      expect(totalActive).toBeLessThanOrEqual(4);
    });

    it("BodyTalk1: 0xFF im NOTEN-Byte leckt nicht in die Velocity", () => {
      // v3.306: Dieser Test hiess vorher "Velocity-Default-Sentinel (0xFF) wird
      // zu 127 dekodiert" und las damit das falsche Byte. In der Werksdatei
      // steht 0xFF auf byte 1 (Note = "kein neuer Ton"), nicht auf byte 2.
      // Nachgemessen: Part 0 hat 48 aktive Steps, ALLE mit Velocity 96, und
      // byte 1 traegt 32x 0xFF plus echte Tonhoehen (39/55/34/47/…).
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      const part0 = p.parts[0];
      const activeSteps = part0.steps.filter(s => s.active);
      expect(activeSteps.length).toBeGreaterThan(0);
      expect(activeSteps.every(s => s.velocity === 96)).toBe(true);
      expect(part0.steps.every(s => s.velocity <= 127)).toBe(true);
      // Die 0xFF taucht als NOTE auf und wird unveraendert durchgereicht.
      expect(activeSteps.some(s => s.note === 0xff)).toBe(true);
    });

    it("BodyTalk1: Part 6 (Hi-Hat-typisch) hat klares offbeat-Pattern (steps 2/6/10/...)", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      // Hex-RE bestaetigt: BodyTalk Part 6 hat 16 aktive Steps, alle bei
      // index 2,6,10,14,18,22,26,30,34,38,42,46,50,54,58,62 (offbeat-Pattern).
      const part6 = p.parts[6];
      const activeIndices = part6.steps
        .map((s, i) => (s.active ? i : -1))
        .filter(i => i >= 0);
      expect(activeIndices).toEqual([2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62]);
    });

    it("Init181 + Init250 + BodyTalk1: alle 64 step-slots pro Part werden in Step-Array materialisiert", () => {
      for (const fn of [REAL_FILE_BODYTALK, REAL_FILE_INIT_181, REAL_FILE_INIT_250]) {
        const buf = loadRealFile(fn);
        if (!buf) continue;
        const p = parseElectribePattern(buf);
        for (const part of p.parts) {
          expect(part.steps).toHaveLength(STEPS_PER_PART);
          // Keine velocity darf out-of-range sein (defensive Clamp greift).
          expect(part.steps.every(s => s.velocity >= 0 && s.velocity <= 127)).toBe(true);
        }
      }
    });

    it("BodyTalk1 Part 11 (Kick-typisch): aktive Steps liegen auf den 4er-Beats", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      // Hex-RE: Part 11 hat 9 aktive Steps bei 0,4,12,20,28,36,44,52,60 (Kick auf jedem 4er-Beat).
      const part11 = p.parts[11];
      const activeIndices = part11.steps
        .map((s, i) => (s.active ? i : -1))
        .filter(i => i >= 0);
      expect(activeIndices).toEqual([0, 4, 12, 20, 28, 36, 44, 52, 60]);
    });
  },
);

// ─── v3.12.0 — Step-Encoding Tests (synthetisches Real-File) ─────────────────
//
// Diese Tests bauen synthetisch ein Real-File mit programmierten Step-Triggers
// und verifizieren dass der Parser sie korrekt extrahiert. Damit funktioniert
// das auch ohne reale User-Files (z.B. auf Fresh-Clone / CI).

function buildRealElectribeBufferWithSteps(opts: {
  name?: string;
  bpm?: number;
  /** Per-Part Map: stepIndex → {trigger:0|1, velocity:0..127|0xFF, note?:number} */
  partTriggers?: Array<Record<number, { trigger: 0 | 1; velocity: number; note?: number }>>;
}): ArrayBuffer {
  const buf = new Uint8Array(ELECTRIBE_REAL_FILE_SIZE);
  const view = new DataView(buf.buffer);

  for (let i = 0; i < 4; i++) buf[i] = ELECTRIBE_MAGIC.charCodeAt(i);
  const id = ELECTRIBE_REAL_IDENTIFIER;
  for (let i = 0; i < id.length; i++) buf[0x10 + i] = id.charCodeAt(i);
  view.setUint32(0x20, 1, true);
  for (let i = 0x24; i < 0x100; i++) buf[i] = 0xff;
  const marker = ELECTRIBE_REAL_PATTERN_MARKER;
  for (let i = 0; i < marker.length; i++) buf[0x100 + i] = marker.charCodeAt(i);
  const name = (opts.name ?? "Test").slice(0, 16);
  for (let i = 0; i < name.length; i++) buf[0x110 + i] = name.charCodeAt(i);
  view.setUint16(0x122, Math.round((opts.bpm ?? 120) * 10), true);

  // Write step-records into each part.
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    const partOffset = 0x900 + p * 816;
    const triggers = opts.partTriggers?.[p] ?? {};
    for (let s = 0; s < 64; s++) {
      const recOff = partOffset + 0x30 + s * 12;
      const trig = triggers[s];
      if (trig !== undefined) {
        // v3.306: Note @1, Velocity @2, Gate @3, Gate-Länge @4 — am Gerät und
        // an der Werksdatei 245_BodyTalk1 belegt (s. electribeImport.ts).
        buf[recOff + 0] = trig.trigger;
        buf[recOff + 1] = trig.note ?? 0x48;
        buf[recOff + 2] = trig.velocity;
        buf[recOff + 3] = trig.trigger ? 1 : 0;
        buf[recOff + 4] = trig.trigger ? 0x3d : 0x00;
      }
    }
  }
  return buf.buffer;
}

describe("electribeImport – v3.12 Step-Encoding (synthetic)", () => {
  it("liest programmierte Step-Trigger korrekt zurueck (Trigger + Velocity)", () => {
    const ab = buildRealElectribeBufferWithSteps({
      name: "X",
      bpm: 120,
      partTriggers: [
        { 0: { trigger: 1, velocity: 100 }, 4: { trigger: 1, velocity: 64 } },
      ],
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[0].steps[0]).toMatchObject({ active: true, velocity: 100 });
    expect(p.parts[0].steps[4]).toMatchObject({ active: true, velocity: 64 });
    expect(p.parts[0].steps[1].active).toBe(false);
  });

  it("Velocity-Sentinel 0xFF → 127 (default-velocity)", () => {
    const ab = buildRealElectribeBufferWithSteps({
      partTriggers: [{ 0: { trigger: 1, velocity: 0xff } }],
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[0].steps[0]).toMatchObject({ active: true, velocity: 127 });
  });

  it("inactive trigger (byte0=0) wird als active:false dekodiert auch bei Velocity-Byte != 0", () => {
    const ab = buildRealElectribeBufferWithSteps({
      partTriggers: [{ 5: { trigger: 0, velocity: 100 } }],
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[0].steps[5].active).toBe(false);
  });

  it("Step-Daten werden korrekt parts-getrennt extrahiert (keine Cross-Contamination)", () => {
    const ab = buildRealElectribeBufferWithSteps({
      partTriggers: [
        { 0: { trigger: 1, velocity: 50 } },                              // Part 0 step 0
        {},                                                                // Part 1: empty
        { 7: { trigger: 1, velocity: 80 } },                              // Part 2 step 7
      ],
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[0].steps[0]).toMatchObject({ active: true, velocity: 50 });
    expect(p.parts[0].steps[7].active).toBe(false);
    expect(p.parts[1].steps[0].active).toBe(false);
    expect(p.parts[1].steps[7].active).toBe(false);
    expect(p.parts[2].steps[0].active).toBe(false);
    expect(p.parts[2].steps[7]).toMatchObject({ active: true, velocity: 80 });
  });

  it("Out-of-range velocity-byte (0x80..0xFE, exclusive 0xFF) wird auf 127 geclampt", () => {
    const ab = buildRealElectribeBufferWithSteps({
      partTriggers: [{ 0: { trigger: 1, velocity: 0x90 } }],
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[0].steps[0].active).toBe(true);
    expect(p.parts[0].steps[0].velocity).toBe(127);
  });

  it("16. Part (Index 15) wird korrekt parsed (Stride-Check bis ans Ende)", () => {
    const ab = buildRealElectribeBufferWithSteps({
      partTriggers: Array.from({ length: 16 }, (_, i) =>
        i === 15 ? { 63: { trigger: 1, velocity: 99 } } : {},
      ),
    });
    const p = parseElectribePattern(ab);
    expect(p.parts[15].steps[63]).toMatchObject({ active: true, velocity: 99 });
    expect(p.parts[15].steps[62].active).toBe(false);
  });
});

// ─── v3.11.0 — .e2sallpat Multi-Pattern-Bank Tests ───────────────────────────
//
// Layout (verified gegen 2016 Stock-Bank):
//   - 0x00000..0x000FF  File-Header (KORG + e2sampler + Version + 0xFF padding)
//   - 0x00100..0x001FF  GLST/GLED Bank-Metadata-Chunks
//   - 0x00200..0x100FF  0xFF padding
//   - 0x10100..0x3F40FF 250 × 16384B Pattern-Records (PTST-prefixed)
//
// File-Total: exakt 4 161 792 Bytes.

function buildAllPatBuffer(opts: {
  /** Per-Slot Name + BPM (Slot 1..250). Andere Slots werden auf "Init Pattern" / 120 BPM gesetzt. */
  slots?: Array<{ slot: number; name: string; bpm: number }>;
  /** Optionale Slot-Anzahl Truncation (Default = 250). */
  slotCount?: number;
  /** Markert PTST-Marker bei diesen Slot-Indizes als kaputt (zum Defensive-Test). */
  brokenSlots?: number[];
}): ArrayBuffer {
  const slotCount = opts.slotCount ?? ELECTRIBE_ALLPAT_SLOT_COUNT;
  const total = ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + slotCount * ELECTRIBE_ALLPAT_PATTERN_STRIDE;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // 0x00: "KORG"
  for (let i = 0; i < 4; i++) buf[i] = ELECTRIBE_MAGIC.charCodeAt(i);
  // 0x10: "e2sampler"
  const id = ELECTRIBE_REAL_IDENTIFIER;
  for (let i = 0; i < id.length; i++) buf[0x10 + i] = id.charCodeAt(i);
  // 0x20: version=1
  view.setUint32(0x20, 1, true);
  // 0x24..0x100: 0xFF
  for (let i = 0x24; i < 0x100; i++) buf[i] = 0xff;
  // 0x100: "GLST"
  for (let i = 0; i < 4; i++) buf[ELECTRIBE_ALLPAT_GLST_OFFSET + i] = ELECTRIBE_ALLPAT_GLST_MARKER.charCodeAt(i);
  // 0x104: chunk-length = 256
  view.setUint32(0x104, 256, true);
  // 0x1FC: "GLED"
  const gled = "GLED";
  for (let i = 0; i < 4; i++) buf[0x1fc + i] = gled.charCodeAt(i);
  // 0x200..0x10100: 0xFF padding
  for (let i = 0x200; i < ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET; i++) buf[i] = 0xff;

  // Init alle Slots mit "Init Pattern" / 120 BPM und PTST-Marker.
  for (let i = 0; i < slotCount; i++) {
    const ptst = ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + i * ELECTRIBE_ALLPAT_PATTERN_STRIDE;
    for (let k = 0; k < 4; k++) buf[ptst + k] = ELECTRIBE_REAL_PATTERN_MARKER.charCodeAt(k);
    const initName = "Init Pattern";
    for (let k = 0; k < initName.length; k++) buf[ptst + 0x10 + k] = initName.charCodeAt(k);
    view.setUint16(ptst + 0x22, 1200, true); // BPM=120
  }

  // Overrides
  for (const s of opts.slots ?? []) {
    const idx = s.slot - 1;
    if (idx < 0 || idx >= slotCount) continue;
    const ptst = ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + idx * ELECTRIBE_ALLPAT_PATTERN_STRIDE;
    // Zero-out name area before write
    for (let k = 0; k < 16; k++) buf[ptst + 0x10 + k] = 0;
    const n = s.name.slice(0, 16);
    for (let k = 0; k < n.length; k++) buf[ptst + 0x10 + k] = n.charCodeAt(k);
    view.setUint16(ptst + 0x22, Math.round(s.bpm * 10), true);
  }

  // Broken-Slot-Markers
  for (const idx of opts.brokenSlots ?? []) {
    if (idx < 0 || idx >= slotCount) continue;
    const ptst = ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + idx * ELECTRIBE_ALLPAT_PATTERN_STRIDE;
    buf[ptst] = 0; // zerstoere PTST-Marker
  }

  return buf.buffer;
}

describe("electribeImport – v3.11 .e2sallpat Multi-Pattern-Bank-Layout", () => {
  it("Layout-Konstanten konsistent: 0x10100 + 250 × 0x4000 = 0x3F4100 (4 161 792 Bytes)", () => {
    expect(ELECTRIBE_ALLPAT_EXPECTED_SIZE).toBe(4_161_792);
    expect(ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET).toBe(0x10100);
    expect(ELECTRIBE_ALLPAT_PATTERN_STRIDE).toBe(0x4000);
    expect(ELECTRIBE_ALLPAT_SLOT_COUNT).toBe(250);
  });

  it("isElectribeAllPatBank erkennt synthetisches Layout", () => {
    const ab = buildAllPatBuffer({});
    expect(isElectribeAllPatBank(ab)).toBe(true);
    // Standalone .e2spat darf nicht als allpat-Bank durchgehen.
    const single = buildRealElectribeBuffer({ name: "X", bpm: 120 });
    expect(isElectribeAllPatBank(single)).toBe(false);
  });

  it("isElectribeAllPatBank lehnt File ohne GLST-Marker ab", () => {
    const ab = buildAllPatBuffer({});
    const u8 = new Uint8Array(ab);
    u8[0x100] = 0; // zerstoere GLST
    expect(isElectribeAllPatBank(u8.buffer)).toBe(false);
  });

  it("detectElectribeFormat liefert 'bank' fuer .e2sallpat", () => {
    const ab = buildAllPatBuffer({});
    expect(detectElectribeFormat(ab)).toBe("bank");
  });

  it("detectElectribeFormatKind liefert 'e2sallpat' / 'e2spat' / 'legacy' / 'unknown'", () => {
    const allpat = buildAllPatBuffer({});
    const single = buildRealElectribeBuffer({ name: "X", bpm: 120 });
    // Legacy: bare KORG + Version-Bytes (kein PTST/GLST).
    const legacy = new Uint8Array(64);
    for (let i = 0; i < 4; i++) legacy[i] = ELECTRIBE_MAGIC.charCodeAt(i);
    expect(detectElectribeFormatKind(allpat)).toBe("e2sallpat");
    expect(detectElectribeFormatKind(single)).toBe("e2spat");
    expect(detectElectribeFormatKind(legacy.buffer)).toBe("legacy");
    expect(detectElectribeFormatKind(new Uint8Array(2).buffer)).toBe("unknown");
  });

  it("parseElectribeAllPatBank parsed 250 PTST-Records mit korrekten Namen/BPMs", () => {
    const ab = buildAllPatBuffer({
      slots: [
        { slot: 1,   name: "Stalactite 1", bpm: 73.4 },
        { slot: 4,   name: "Solar 1",      bpm: 120 },
        { slot: 245, name: "BodyTalk1",    bpm: 165 },
        { slot: 250, name: "Last Slot",    bpm: 200 },
      ],
    });
    const bank = parseElectribeAllPatBank(ab);
    expect(bank.patternCount).toBe(250);
    expect(bank.patterns).toHaveLength(250);
    expect(bank.patterns[0].name).toBe("Stalactite 1");
    expect(bank.patterns[0].bpm).toBeCloseTo(73.4, 1);
    expect(bank.patterns[3].name).toBe("Solar 1");
    expect(bank.patterns[244].name).toBe("BodyTalk1");
    expect(bank.patterns[244].bpm).toBeCloseTo(165, 1);
    expect(bank.patterns[249].name).toBe("Last Slot");
    expect(bank.patterns[249].bpm).toBeCloseTo(200, 1);
    // Init-Slots auf 120 BPM
    expect(bank.patterns[1].name).toBe("Init Pattern");
    expect(bank.patterns[1].bpm).toBeCloseTo(120, 1);
  });

  it("parseElectribeAllPatBank: BPMs sind in plausibler Range (>=20, <=300)", () => {
    const ab = buildAllPatBuffer({
      slots: [
        { slot: 1, name: "Slow",  bpm: 60 },
        { slot: 2, name: "Med",   bpm: 128 },
        { slot: 3, name: "Fast",  bpm: 200 },
      ],
    });
    const bank = parseElectribeAllPatBank(ab);
    for (const p of bank.patterns) {
      expect(p.bpm).toBeGreaterThanOrEqual(20);
      expect(p.bpm).toBeLessThanOrEqual(300);
    }
  });

  it("parseElectribeAllPatBank: Pattern-Namen werden korrekt extrahiert", () => {
    const ab = buildAllPatBuffer({
      slots: [
        { slot: 50, name: "Test 123",      bpm: 120 },
        { slot: 51, name: "Init Pattern",  bpm: 120 },
        { slot: 52, name: "CircuitDaughter", bpm: 110 },
      ],
    });
    const bank = parseElectribeAllPatBank(ab);
    expect(bank.patterns[49].name).toBe("Test 123");
    expect(bank.patterns[50].name).toBe("Init Pattern");
    expect(bank.patterns[51].name).toBe("CircuitDaughter");
  });

  it("parseElectribeAllPatBank ist defensive gegen kaputte PTST-Marker — kein Throw", () => {
    const ab = buildAllPatBuffer({
      slots: [{ slot: 1, name: "OK", bpm: 120 }],
      brokenSlots: [5, 10, 200],
    });
    const bank = parseElectribeAllPatBank(ab);
    expect(bank.patternCount).toBe(250);
    // Kaputte Slots haben Fallback-Namen + Default-BPM 120
    expect(bank.patterns[5].name).toBe("Slot 6");
    expect(bank.patterns[10].name).toBe("Slot 11");
    expect(bank.patterns[200].name).toBe("Slot 201");
    expect(bank.patterns[200].bpm).toBe(120);
    // OK-Slot bleibt intakt
    expect(bank.patterns[0].name).toBe("OK");
  });

  it("parseElectribeAllPatBank lehnt zu kleine Buffer ab", () => {
    const tiny = new Uint8Array(0x100).buffer;
    expect(() => parseElectribeAllPatBank(tiny)).toThrow(/zu klein/);
  });

  it("parseElectribeBank dispatched .e2sallpat-Layout an parseElectribeAllPatBank", () => {
    const ab = buildAllPatBuffer({
      slots: [{ slot: 1, name: "First", bpm: 140 }],
    });
    const bank = parseElectribeBank(ab);
    expect(bank.patternCount).toBe(250);
    expect(bank.patterns[0].name).toBe("First");
  });

  it("filterNonInitPatterns filtert 'Init Pattern' + 'Slot N' Fallbacks", () => {
    const patterns = [
      { name: "Init Pattern", bpm: 120, stepLength: 16, swing: 0, parts: [] },
      { name: "BodyTalk1",    bpm: 165, stepLength: 16, swing: 0, parts: [] },
      { name: "Slot 42",      bpm: 120, stepLength: 16, swing: 0, parts: [] },
      { name: "",             bpm: 120, stepLength: 16, swing: 0, parts: [] },
      { name: "Custom",       bpm: 130, stepLength: 16, swing: 0, parts: [] },
    ];
    const nonInit = filterNonInitPatterns(patterns);
    expect(nonInit).toHaveLength(2);
    expect(nonInit.map(p => p.name)).toEqual(["BodyTalk1", "Custom"]);
  });

  it("parseElectribeAllPatBank: Truncated-Bank wird sicher geparst (nur passende Slots)", () => {
    const ab = buildAllPatBuffer({
      slotCount: 100, // truncated
      slots: [{ slot: 1, name: "Trunc", bpm: 120 }],
    });
    const bank = parseElectribeAllPatBank(ab);
    expect(bank.patternCount).toBe(100);
    expect(bank.patterns[0].name).toBe("Trunc");
  });
});

// ─── v3.11.0 — Real Stock-Bank Conditional-Test ──────────────────────────────
//
// Falls die 2016-Stock-Bank am erwarteten Pfad liegt, validieren wir gegen
// echte Bytes. CI / Fresh-Clone ohne diese User-Daten → .skip.

const REAL_E2SALLPAT_PATH = path.resolve(
  process.cwd(),
  "e2s-2016",
  "e2s-2016.e2sallpat",
);
const REAL_E2SALLPAT_AVAILABLE = (() => {
  try {
    return fs.existsSync(REAL_E2SALLPAT_PATH);
  } catch {
    return false;
  }
})();

(REAL_E2SALLPAT_AVAILABLE ? describe : describe.skip)(
  "electribeImport – Real .e2sallpat Stock Bank (2016 Summer)",
  () => {
    it("Stock-Bank: exakte File-Size = 4 161 792 Bytes", () => {
      const buf = fs.readFileSync(REAL_E2SALLPAT_PATH);
      expect(buf.byteLength).toBe(ELECTRIBE_ALLPAT_EXPECTED_SIZE);
    });

    it("Stock-Bank: isElectribeAllPatBank=true, detectElectribeFormat='bank'", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      expect(isElectribeAllPatBank(buf)).toBe(true);
      expect(detectElectribeFormat(buf)).toBe("bank");
      expect(detectElectribeFormatKind(buf)).toBe("e2sallpat");
    });

    it("Stock-Bank: parseElectribeAllPatBank liefert 250 Patterns mit gueltigen BPMs", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeAllPatBank(buf);
      expect(bank.patternCount).toBe(250);
      expect(bank.patterns).toHaveLength(250);
      for (const p of bank.patterns) {
        expect(p.bpm).toBeGreaterThanOrEqual(20);
        expect(p.bpm).toBeLessThanOrEqual(300);
        expect(p.parts).toHaveLength(PARTS_PER_PATTERN);
      }
    });

    it("Stock-Bank: erste 3 Patterns heissen 'Stalactite 1/2/3'", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeAllPatBank(buf);
      expect(bank.patterns[0].name).toBe("Stalactite 1");
      expect(bank.patterns[1].name).toBe("Stalactite 2");
      expect(bank.patterns[2].name).toBe("Stalactite 3");
      // BPM 73.4 (verifiziert via binary inspection)
      expect(bank.patterns[0].bpm).toBeCloseTo(73.4, 1);
    });

    it("Stock-Bank: filterNonInitPatterns liefert mehrere hundert User-Patterns", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeAllPatBank(buf);
      const nonInit = filterNonInitPatterns(bank.patterns);
      // 2016-Stock-Bank: 241 non-Init Slots laut binary inspection.
      expect(nonInit.length).toBeGreaterThan(200);
      expect(nonInit.length).toBeLessThan(250);
    });

    it("Stock-Bank: parseElectribeBank dispatched korrekt (kein Throw, 250 Patterns)", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeBank(buf);
      expect(bank.patternCount).toBe(250);
    });
  },
);

// ─── v3.13.0 — Part-Header Volume/Pan + Pattern-Globals StepLength RE ────────
//
// Diese Tests verifizieren die in v3.13.0 reverse-engineerten Felder:
//   - Part-Volume @ part_off + 0x15 (HIGH confidence)
//   - Part-Pan    @ part_off + 0x22 (HIGH confidence)
//   - StepLength  @ PTST    + 0x25 (HIGH confidence, code 0/1/3 → 16/32/64)
//
// Methodology: Histogram-Analyse ueber 4000 part-samples + maxStep-Korrelation.

(REAL_FILES_AVAILABLE ? describe : describe.skip)(
  "electribeImport – v3.13 Part-Header Volume/Pan (Real-File-Verifikation)",
  () => {
    it("BodyTalk1: Parts haben unterschiedliche Volume-Werte (nicht alle = default)", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      const volumes = p.parts.map(part => part.volume);
      const uniqueVols = new Set(volumes);
      // BodyTalk hat bewusst gemixte Levels — sollte mindestens 3 verschiedene
      // Volume-Werte ueber die 16 Parts haben.
      expect(uniqueVols.size).toBeGreaterThanOrEqual(3);
      // Alle im erwarteten 0..127-Range.
      expect(volumes.every(v => v >= 0 && v <= 127)).toBe(true);
    });

    it.skip("BodyTalk1: spezifische Part-Volumes match Hex-RE", () => {
      // v3.297: SKIP — die erwarteten Werte (20/127/108/46/127) stammen aus
      // der Hex-Inspektion von +0x15, und +0x15 ist laut Korg TABLE 6 (plus
      // Gerätebefund) EG Decay/Release, NICHT Volume. Volume = Amp Level liegt
      // bei +0x18; die dortigen BodyTalk-Werte sind nicht hex-katalogisiert.
      // Neu vermessen, sobald die Real-Files wieder eingecheckt sind.
    });

    it("Init181: alle 16 Parts haben Default-Amp-Level 85", () => {
      const buf = loadRealFile(REAL_FILE_INIT_181);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      // v3.297: Amp Level @ +0x18 — der Init-Body trägt dort 85 auf allen 16
      // Parts (gegen das eingebettete Init-Template verifiziert). Der frühere
      // Wert 127 war der EG-Decay-Default @0x15.
      for (const part of p.parts) {
        expect(part.volume).toBe(85);
      }
    });

    it("Init181: alle 16 Parts haben Pan = 64 (center)", () => {
      const buf = loadRealFile(REAL_FILE_INIT_181);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      // v3.297: Amp Pan @ +0x19 ist i8 mit 0 = Center → UI-Wert 64. Der
      // Init-Body hat dort 0x00 auf allen Parts (Template-verifiziert).
      for (const part of p.parts) {
        expect(part.pan).toBe(64);
      }
    });

    it("BodyTalk1: Pan-Werte variieren ueber Parts (Stereo-Mix)", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      const pans = p.parts.map(part => part.pan);
      const uniquePans = new Set(pans);
      // v3.297: Spezifische Byte-Erwartungen entfernt — sie stammten aus der
      // widerlegten +0x22-Lesung (= IFX Edit). Generische Zusicherung bleibt:
      // Alle im 0..127-Range (i8@0x19-Decode clampt sauber).
      expect(pans.every(v => v >= 0 && v <= 127)).toBe(true);
      void uniquePans;
    });

    it.skip("convertParsedPatternToSynthstudio: BodyTalk Pan wird auf -1..+1 normalisiert", () => {
      // v3.297: SKIP — Erwartungswerte (0.46 / -1) waren aus der widerlegten
      // +0x22-Pan-Lesung abgeleitet. Neu vermessen mit Amp Pan @0x19 (i8),
      // sobald die Real-Files wieder verfügbar sind.
    });

    it.skip("convertParsedPatternToSynthstudio: BodyTalk Volume wird auf 0..1 normalisiert", () => {
      // v3.297: SKIP — Erwartungswerte (20/127, 127/127) waren aus der
      // widerlegten +0x15-Volume-Lesung abgeleitet (= EG Decay). Neu vermessen
      // mit Amp Level @0x18, sobald die Real-Files wieder verfügbar sind.
    });
  },
);

(REAL_FILES_AVAILABLE ? describe : describe.skip)(
  "electribeImport – v3.13 Pattern-Globals StepLength (Real-File-Verifikation)",
  () => {
    it("BodyTalk1: StepLength code 3 → 64 Steps", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      // Hex-RE: PTST+0x25 = 0x03 ⇒ 64 Steps.
      expect(p.stepLength).toBe(64);
    });

    it("Init181: StepLength code 0 → 16 Steps (Default)", () => {
      const buf = loadRealFile(REAL_FILE_INIT_181);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      // Hex-RE: PTST+0x25 = 0x00 ⇒ 16 Steps.
      expect(p.stepLength).toBe(16);
    });

    it("Advisory1 + Init250: StepLength code 3 → 64 Steps", () => {
      for (const fn of [REAL_FILE_ADVISORY, REAL_FILE_INIT_250]) {
        const buf = loadRealFile(fn);
        if (!buf) continue;
        const p = parseElectribePattern(buf);
        // Hex-RE bestaetigt: beide Files haben PTST+0x25 = 3.
        expect(p.stepLength).toBe(64);
      }
    });

    it("v3.39: convertParsedPatternToSynthstudio: StepCount 64 bleibt 64 (KORG-Parität)", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const conv = convertParsedPatternToSynthstudio(parseElectribePattern(buf));
      // BodyTalk parsed mit stepLength=64 → Synthstudio v3.39 unterstützt 64.
      expect(conv.stepCount).toBe(64);
    });
  },
);

// ─── v3.13.0 — Stock-Bank histogram verification ──────────────────────────────

(REAL_E2SALLPAT_AVAILABLE ? describe : describe.skip)(
  "electribeImport – v3.13 Stock-Bank Volume/Pan/StepLength Statistik",
  () => {
    it("Stock-Bank: Volume-Range 0..127 ueber alle 4000 Parts (kein clamp-warning)", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeAllPatBank(buf);
      let minVol = 200, maxVol = -1;
      let totalParts = 0;
      for (const p of bank.patterns) {
        for (const part of p.parts) {
          if (part.volume < minVol) minVol = part.volume;
          if (part.volume > maxVol) maxVol = part.volume;
          totalParts++;
          expect(part.volume).toBeGreaterThanOrEqual(0);
          expect(part.volume).toBeLessThanOrEqual(127);
        }
      }
      expect(totalParts).toBe(250 * 16);
      // Min sollte irgendwo bei 0 sein (mindestens 1 muted part), max bei 127.
      expect(minVol).toBeLessThanOrEqual(64);
      expect(maxVol).toBe(127);
    });

    it("Stock-Bank: Pan-Center (64) dominiert, Ausreißer auf beiden Seiten", () => {
      // v3.307: Erwartungen an die korrigierte Pan-Semantik angepasst
      // (v3.297: Pan = i8 @ part+0x19, 0 = Center). Die alten Zahlen
      // (hard-L > 50, hard-R > 200) beschrieben das Histogramm des FALSCHEN
      // Bytes (+0x22 = IFX Edit). Reale Verteilung der 4000 Stock-Parts:
      // 3573× Center, 427 verteilte Werte 18..127, hard-L kommt nicht vor.
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeAllPatBank(buf);
      let centerCount = 0, leftCount = 0, rightCount = 0;
      for (const p of bank.patterns) {
        for (const part of p.parts) {
          expect(part.pan).toBeGreaterThanOrEqual(0);
          expect(part.pan).toBeLessThanOrEqual(127);
          if (part.pan === 64) centerCount++;
          else if (part.pan < 64) leftCount++;
          else rightCount++;
        }
      }
      // Center dominiert klar (real: 3573 von 4000).
      expect(centerCount).toBeGreaterThan(3000);
      // Beide Seiten kommen in nennenswerter Zahl vor (real: 199 L / 228 R).
      expect(leftCount).toBeGreaterThan(100);
      expect(rightCount).toBeGreaterThan(100);
    });

    it("Stock-Bank: StepLength-Distribution (16=Init, 32=Edge-Cases, 64=Mehrheit)", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeAllPatBank(buf);
      const counts = { 16: 0, 32: 0, 64: 0 };
      for (const p of bank.patterns) {
        const len = p.stepLength as 16 | 32 | 64;
        counts[len]++;
      }
      // Laut Hex-Analyse: 9 Init-Patterns (16), 2 patterns (32), 239 patterns (64).
      expect(counts[16]).toBeGreaterThan(5);
      expect(counts[16]).toBeLessThan(20);
      expect(counts[32]).toBeGreaterThanOrEqual(1);
      expect(counts[64]).toBeGreaterThan(200);
      expect(counts[16] + counts[32] + counts[64]).toBe(250);
    });

    it("Stock-Bank: futureMonger1 (Slot 202) hat StepLength=32", () => {
      const buf = new Uint8Array(fs.readFileSync(REAL_E2SALLPAT_PATH));
      const bank = parseElectribeAllPatBank(buf);
      // Slot 202 = index 201. Hex-RE: PTST+0x25 = 0x01 ⇒ 32 Steps.
      const slot202 = bank.patterns[201];
      expect(slot202.name).toBe("futureMonger1");
      expect(slot202.stepLength).toBe(32);
    });
  },
);

// ─── v3.13.0 — Synthetic edge-case tests for new constants ──────────────────

describe("electribeImport – v3.13 Constants are exported", () => {
  it("Volume/Pan offset constants sind self-konsistent", async () => {
    const mod = await import("../../client/src/utils/electribeImport");
    // v3.297 (Gerätebefund + Korg TABLE 6): Volume = Amp Level @0x18,
    // Pan = Amp Pan @0x19 (i8, 0=Center). 0x15/0x22 waren EG Decay / IFX Edit.
    expect(mod.ELECTRIBE_REAL_PART_VOLUME_OFFSET).toBe(0x18);
    expect(mod.ELECTRIBE_REAL_PART_PAN_OFFSET).toBe(0x19);
    expect(mod.ELECTRIBE_REAL_PART_VOLUME_DEFAULT).toBe(127);
    expect(mod.ELECTRIBE_REAL_PART_PAN_DEFAULT).toBe(64);
    expect(mod.ELECTRIBE_REAL_STEP_LENGTH_OFFSET).toBe(0x25);
    expect(mod.ELECTRIBE_REAL_STEP_LENGTH_CODES[0]).toBe(16);
    expect(mod.ELECTRIBE_REAL_STEP_LENGTH_CODES[1]).toBe(32);
    expect(mod.ELECTRIBE_REAL_STEP_LENGTH_CODES[3]).toBe(64);
  });
});

// ─── v3.15.0 — Pattern-Level Motion-Sequencer Reverse-Engineering ─────────────
//
// Verifiziert das in electribeImport.ts dokumentierte 560-Byte Motion-Layout
// (PTST-relativ, 8 Slots × 64 Werte ab PTST+0x130). Tests laufen sowohl gegen
// synthetische Buffer (Buffer-Builder, immer ausfuehrbar) als auch gegen die
// reale Stock-Bank `e2s-2016.e2sallpat` (conditional).

describe("electribeImport – v3.15 Motion-Sequencer Constants", () => {
  it("Motion-Sequencer constants sind self-konsistent", async () => {
    const mod = await import("../../client/src/utils/electribeImport");
    expect(mod.ELECTRIBE_MOTION_PARAM_TABLE_OFFSET).toBe(0x100);
    expect(mod.ELECTRIBE_MOTION_TARGET_TABLE_OFFSET).toBe(0x118);
    expect(mod.ELECTRIBE_MOTION_DATA_TABLE_OFFSET).toBe(0x130);
    expect(mod.ELECTRIBE_MOTION_SLOTS_PER_PATTERN).toBe(8);
    expect(mod.ELECTRIBE_MOTION_VALUES_PER_SLOT).toBe(64);
    expect(mod.ELECTRIBE_MOTION_SLOT_STRIDE).toBe(64);
    // Motion-Region-Size: 0x130 + 8*64 - 0x100 = 560 Bytes
    const regionEnd = mod.ELECTRIBE_MOTION_DATA_TABLE_OFFSET
      + mod.ELECTRIBE_MOTION_SLOTS_PER_PATTERN * mod.ELECTRIBE_MOTION_SLOT_STRIDE;
    expect(regionEnd - mod.ELECTRIBE_MOTION_PARAM_TABLE_OFFSET).toBe(560);
  });

  it("Param-Name-Map enthaelt Eintraege fuer alle 17 beobachteten IDs", async () => {
    const mod = await import("../../client/src/utils/electribeImport");
    for (let pid = 1; pid <= 17; pid++) {
      expect(mod.ELECTRIBE_PATTERN_MOTION_PARAM_NAMES[pid]).toBeDefined();
    }
  });
});

describe("electribeImport – v3.15 parsePatternMotionTable (synthetic)", () => {
  /**
   * Baut einen minimalen DataView mit einer Motion-Table an PTST=0x100
   * (= .e2spat-Layout).
   */
  function buildMotionBuffer(slotSpecs: Array<{ paramId: number; target: number; values: number[] }>): DataView {
    // Wir brauchen mindestens 0x100 + 0x230 = 0x330 Bytes.
    // Plus Magic-Bytes? Nein — parsePatternMotionTable nimmt absolute ptstOffset
    // und liest direkt von dort. Wir bauen Buffer mit nur Motion-Region.
    const size = 0x500;
    const buf = new Uint8Array(size);
    const ptst = 0x100;

    for (let i = 0; i < Math.min(slotSpecs.length, 8); i++) {
      const spec = slotSpecs[i];
      buf[ptst + 0x100 + i] = spec.paramId;
      buf[ptst + 0x118 + i] = spec.target;
      for (let v = 0; v < Math.min(spec.values.length, 64); v++) {
        buf[ptst + 0x130 + i * 64 + v] = spec.values[v];
      }
    }

    return new DataView(buf.buffer);
  }

  it("liefert immer 8 Slots, auch wenn alle disabled", async () => {
    const { parsePatternMotionTable } = await import("../../client/src/utils/electribeImport");
    const view = buildMotionBuffer([]);
    const slots = parsePatternMotionTable(view, 0x100);
    expect(slots).toHaveLength(8);
    expect(slots.every(s => !s.enabled)).toBe(true);
    expect(slots.every(s => s.paramId === 0)).toBe(true);
  });

  it("decoded paramId + targetPart aus Header-Tabellen", async () => {
    const { parsePatternMotionTable } = await import("../../client/src/utils/electribeImport");
    const view = buildMotionBuffer([
      { paramId: 0x11, target: 0x05, values: new Array(64).fill(0x40) },
    ]);
    const slots = parsePatternMotionTable(view, 0x100);
    expect(slots[0].enabled).toBe(true);
    expect(slots[0].paramId).toBe(0x11);
    expect(slots[0].rawTarget).toBe(0x05);
    expect(slots[0].targetPart).toBe(4); // rawTarget 5 → partIndex 4
    expect(slots[0].values[0]).toBe(0x40);
    expect(slots[0].values[63]).toBe(0x40);
    // Slot 1..7 disabled
    for (let i = 1; i < 8; i++) expect(slots[i].enabled).toBe(false);
  });

  it("targetPart=-1 bei rawTarget=17..19 (global/future-use)", async () => {
    const { parsePatternMotionTable } = await import("../../client/src/utils/electribeImport");
    const view = buildMotionBuffer([
      { paramId: 5, target: 17, values: new Array(64).fill(50) },
      { paramId: 6, target: 19, values: new Array(64).fill(60) },
    ]);
    const slots = parsePatternMotionTable(view, 0x100);
    expect(slots[0].targetPart).toBe(-1);
    expect(slots[0].rawTarget).toBe(17);
    expect(slots[1].targetPart).toBe(-1);
    expect(slots[1].rawTarget).toBe(19);
  });

  it("clamped value 0x80 (128) auf 127", async () => {
    const { parsePatternMotionTable } = await import("../../client/src/utils/electribeImport");
    const values = new Array(64).fill(0);
    values[3] = 0x80;
    values[5] = 0xFF;
    const view = buildMotionBuffer([{ paramId: 0x11, target: 1, values }]);
    const slots = parsePatternMotionTable(view, 0x100);
    expect(slots[0].values[3]).toBe(127);
    expect(slots[0].values[5]).toBe(127);
  });

  it("disabled slot mit paramId=0 aber non-zero data wird auf enabled gesetzt (data wins)", async () => {
    const { parsePatternMotionTable } = await import("../../client/src/utils/electribeImport");
    // Beobachtet in Trials1 — paramId=0 aber Slot hat data
    const values = new Array(64).fill(0);
    values[10] = 50;
    const view = buildMotionBuffer([{ paramId: 0, target: 0, values }]);
    const slots = parsePatternMotionTable(view, 0x100);
    expect(slots[0].enabled).toBe(true);
    expect(slots[0].paramId).toBe(0);
    expect(slots[0].paramName).toBe("disabled"); // weil paramId=0
    expect(slots[0].values[10]).toBe(50);
  });

  it("out-of-bounds buffer liefert 8 disabled defaults", async () => {
    const { parsePatternMotionTable } = await import("../../client/src/utils/electribeImport");
    const tiny = new DataView(new Uint8Array(0x50).buffer);
    const slots = parsePatternMotionTable(tiny, 0x100);
    expect(slots).toHaveLength(8);
    expect(slots.every(s => !s.enabled)).toBe(true);
    expect(slots.every(s => s.values.length === 64)).toBe(true);
    expect(slots.every(s => s.values.every(v => v === 0))).toBe(true);
  });
});

describe("electribeImport – v3.15 Pattern-Motion in convertParsedPatternToSynthstudio", () => {
  it("Pattern-Motion ohne Real-File wird ignored (legacy Test bleibt gruen)", async () => {
    // Synthetic Test ohne patternMotion-Feld: convert sollte keine pattern-motion-Lanes emitten
    const { convertParsedPatternToSynthstudio } = await import("../../client/src/utils/electribeImport");
    const conv = convertParsedPatternToSynthstudio({
      name: "synthetic",
      bpm: 120,
      stepLength: 16,
      swing: 0,
      parts: [],
      // patternMotion: undefined ← legacy synthetic
    });
    expect(conv.automationLanes).toHaveLength(0);
  });

  it("Pattern-Motion wird zu automationLanes mit slot/target-Routing", async () => {
    const { convertParsedPatternToSynthstudio } = await import("../../client/src/utils/electribeImport");
    const values = new Array(64).fill(64); // half-volume sweep
    const conv = convertParsedPatternToSynthstudio({
      name: "with-motion",
      bpm: 120,
      stepLength: 16,
      swing: 0,
      parts: [],
      patternMotion: [
        {
          paramId: 0x11,
          paramName: "Param 17",
          targetPart: 4,
          rawTarget: 5,
          enabled: true,
          values,
        },
        {
          paramId: 0,
          paramName: "disabled",
          targetPart: -1,
          rawTarget: 0,
          enabled: false,
          values: new Array(64).fill(0),
        },
        ...Array.from({ length: 6 }, () => ({
          paramId: 0,
          paramName: "disabled",
          targetPart: -1,
          rawTarget: 0,
          enabled: false,
          values: new Array(64).fill(0),
        })),
      ],
    });
    expect(conv.automationLanes).toHaveLength(1);
    const lane = conv.automationLanes[0];
    expect(lane.target).toBe("Param 17:slot0:part4");
    expect(lane.label).toBe("Param 17 (Slot 1 → Part 5)");
    // stepCount=16 (from stepLength=16), so 16 points generated.
    expect(Object.keys(lane.points)).toHaveLength(16);
    // Each point ≈ 64/127 ≈ 0.504
    expect(lane.points[0]).toBeCloseTo(64 / 127, 2);
    expect(lane.points[15]).toBeCloseTo(64 / 127, 2);
  });

  it("Pattern-Motion mit global-target (rawTarget>=17) → label 'global'", async () => {
    const { convertParsedPatternToSynthstudio } = await import("../../client/src/utils/electribeImport");
    const conv = convertParsedPatternToSynthstudio({
      name: "global-target",
      bpm: 120,
      stepLength: 16,
      swing: 0,
      parts: [],
      patternMotion: [
        {
          paramId: 1,
          paramName: "Param 01",
          targetPart: -1,
          rawTarget: 19,
          enabled: true,
          values: new Array(64).fill(100),
        },
        ...Array.from({ length: 7 }, () => ({
          paramId: 0,
          paramName: "disabled",
          targetPart: -1,
          rawTarget: 0,
          enabled: false,
          values: new Array(64).fill(0),
        })),
      ],
    });
    expect(conv.automationLanes).toHaveLength(1);
    expect(conv.automationLanes[0].target).toBe("Param 01:slot0:global19");
    expect(conv.automationLanes[0].label).toContain("global");
  });
});

// Real-File-Tests (conditional auf Stock-Bank-Verfuegbarkeit)
const REAL_ALLPAT_DIR = path.resolve(process.cwd(), "e2s-2016");
const REAL_ALLPAT_FILE = path.join(REAL_ALLPAT_DIR, "e2s-2016.e2sallpat");
const REAL_ALLPAT_AVAILABLE = (() => {
  try {
    return fs.existsSync(REAL_ALLPAT_FILE) && fs.statSync(REAL_ALLPAT_FILE).size > 4_000_000;
  } catch {
    return false;
  }
})();

(REAL_ALLPAT_AVAILABLE ? describe : describe.skip)(
  "electribeImport – v3.15 Motion-Sequencer (Stock-Bank Verifikation)",
  () => {
    it("BodyTalk1 (Single-Pattern .e2spat) hat 0 enabled Motion-Slots (vorher unbekannt aber via RE verified)", () => {
      const buf = loadRealFile(REAL_FILE_BODYTALK);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      expect(p.patternMotion).toBeDefined();
      expect(p.patternMotion!).toHaveLength(8);
      // BodyTalk hat in der Motion-Region nur Nullen — alle Slots disabled.
      expect(p.patternMotion!.every(s => !s.enabled)).toBe(true);
    });

    it("Init181 hat 0 enabled Motion-Slots", () => {
      const buf = loadRealFile(REAL_FILE_INIT_181);
      if (!buf) return;
      const p = parseElectribePattern(buf);
      expect(p.patternMotion).toBeDefined();
      expect(p.patternMotion!.every(s => !s.enabled)).toBe(true);
    });

    it("Stock-Bank: mindestens 100 Patterns haben mind. 1 enabled Motion-Slot", async () => {
      const { parseElectribeAllPatBank } = await import("../../client/src/utils/electribeImport");
      const buf = new Uint8Array(fs.readFileSync(REAL_ALLPAT_FILE));
      const bank = parseElectribeAllPatBank(buf);
      const withMotion = bank.patterns.filter(p =>
        Array.isArray(p.patternMotion) && p.patternMotion.some(s => s.enabled),
      ).length;
      // RE measured: 127 / 250 = 50.8%
      expect(withMotion).toBeGreaterThan(100);
      expect(withMotion).toBeLessThan(150);
    });

    it("Stock-Bank: alle paramIds liegen in known range [0..17]", async () => {
      const { parseElectribeAllPatBank } = await import("../../client/src/utils/electribeImport");
      const buf = new Uint8Array(fs.readFileSync(REAL_ALLPAT_FILE));
      const bank = parseElectribeAllPatBank(buf);
      let outOfRange = 0;
      for (const p of bank.patterns) {
        if (!p.patternMotion) continue;
        for (const slot of p.patternMotion) {
          if (slot.paramId > 17 || slot.paramId < 0) outOfRange++;
        }
      }
      expect(outOfRange).toBe(0);
    });

    it("Stock-Bank: 80th Floor 3 (slot 102) hat klares sweep-Pattern in Slot 0", async () => {
      const { parseElectribeAllPatBank } = await import("../../client/src/utils/electribeImport");
      const buf = new Uint8Array(fs.readFileSync(REAL_ALLPAT_FILE));
      const bank = parseElectribeAllPatBank(buf);
      // Index 101 = "80th Floor 3" (1-basierter Slot 102)
      const p = bank.patterns[101];
      expect(p.patternMotion).toBeDefined();
      // Erster Slot ist enabled (paramId or data) — verifiziert via RE
      const enabledCount = p.patternMotion!.filter(s => s.enabled).length;
      expect(enabledCount).toBeGreaterThanOrEqual(4);
      // Slot 0 hat eine sweeping curve (Werte starten low, steigen)
      const slot0 = p.patternMotion![0];
      // RE-beobachtet: Werte 0x3F=63 → 0x7E=126 (ascending sweep)
      // Konservativer Test: max value > min value (kein flat)
      const maxV = Math.max(...slot0.values);
      const minV = Math.min(...slot0.values);
      expect(maxV).toBeGreaterThan(minV);
    });

    it("Stock-Bank: convertParsedPatternToSynthstudio produziert pattern-motion automationLanes fuer 80th Floor 3", async () => {
      const { parseElectribeAllPatBank, convertParsedPatternToSynthstudio } = await import(
        "../../client/src/utils/electribeImport"
      );
      const buf = new Uint8Array(fs.readFileSync(REAL_ALLPAT_FILE));
      const bank = parseElectribeAllPatBank(buf);
      const conv = convertParsedPatternToSynthstudio(bank.patterns[101]);
      // 80th Floor 3 hat per RE 4-5 enabled slots → 4-5 automation lanes
      const patternMotionLanes = conv.automationLanes.filter(l => /slot\d+:/.test(l.target));
      expect(patternMotionLanes.length).toBeGreaterThanOrEqual(3);
      expect(patternMotionLanes.length).toBeLessThanOrEqual(8);
      // Jede Lane hat Punkte
      expect(patternMotionLanes.every(l => Object.keys(l.points).length > 0)).toBe(true);
    });
  },
);
