/**
 * tests/features/electribe-pattern-write.test.ts
 *
 * v3.26.0 — E2 Pattern WRITE (.e2spat) → Synthstudio → KORG E2 Sampler.
 * v3.34.0 — Adds bit-exact-polish coverage for the 3 KORG-native encoding
 *           conventions (name NUL-pad, 0xFF velocity sentinel, inactive-step
 *           note 0x00). Existing semantic round-trip tests remain green.
 *
 * Verifies the binary builder, the Synthstudio adapter, and the round-trip
 * property `parseRealPattern(buildE2PatternFile(input)) ≈ input`.
 */

import { describe, it, expect } from "vitest";
import {
  buildE2PatternFile,
  looksLikeE2PatternFile,
  E2_DEFAULT_NOTE,
  E2_DEFAULT_VELOCITY,
  E2_DEFAULT_VELOCITY_RAW_BYTE,
  E2_INACTIVE_STEP_NOTE,
  type E2PatternInput,
  type E2StepInput,
} from "../../client/src/utils/electribePatternBuilder";
import {
  convertSynthstudioPatternToE2,
  convertStepToE2,
  synthVolumeToE2,
  synthPanToE2,
  synthPitchToE2Note,
  synthStepCountToE2StepLength,
} from "../../client/src/utils/electribePatternConvert";
import {
  parseElectribePattern,
  isRealElectribeFile,
  ELECTRIBE_REAL_FILE_SIZE,
  type ParsedPattern,
} from "../../client/src/utils/electribeImport";
import type { PatternData, PartData, StepData } from "../../client/src/audio/AudioEngine";
import {
  validateE2PatternFilename,
  validateE2PatternBuffer,
  E2_PATTERN_FILE_SIZE_EXACT,
} from "../../electron/ipcValidators";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function emptyStep(): E2StepInput {
  return { active: false };
}

function makeMinimalInput(overrides: Partial<E2PatternInput> = {}): E2PatternInput {
  // Each part gets its own fresh steps array — otherwise the shared reference
  // makes mutations on one part leak into all others.
  return {
    name: "TEST",
    bpm: 120,
    stepLength: 16,
    parts: new Array(16).fill(0).map(() => ({
      steps: new Array(64).fill(0).map(emptyStep),
    })),
    ...overrides,
  };
}

function makeSynthstudioStep(active = false, velocity = 100, pitch = 0): StepData {
  return { active, velocity, pitch };
}

function makeSynthstudioPart(name: string, steps: StepData[], volume = 0.8, pan = 0): PartData {
  return {
    id: `part-${name}`,
    name,
    muted: false,
    soloed: false,
    volume,
    pan,
    steps,
    fx: {} as PartData["fx"], // not used by converter
  };
}

function makeSynthstudioPattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: "test-pattern",
    name: "Synthstudio Test",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: 128,
    parts: new Array(16).fill(0).map((_, i) =>
      makeSynthstudioPart(`p${i}`, new Array(16).fill(0).map(() => makeSynthstudioStep())),
    ),
    ...overrides,
  };
}

// ─── 1. Builder basics ───────────────────────────────────────────────────────

describe("buildE2PatternFile — basics", () => {
  it("produces an ArrayBuffer of exactly 16640 bytes", () => {
    const buffer = buildE2PatternFile(makeMinimalInput());
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(ELECTRIBE_REAL_FILE_SIZE);
    expect(buffer.byteLength).toBe(16640);
  });

  it("writes the KORG / e2sampler / PTST magic markers correctly", () => {
    const buffer = buildE2PatternFile(makeMinimalInput());
    const u8 = new Uint8Array(buffer);
    // "KORG" at 0x00
    expect(String.fromCharCode(u8[0], u8[1], u8[2], u8[3])).toBe("KORG");
    // "e2sampler" at 0x10
    const id = String.fromCharCode(...u8.slice(0x10, 0x19));
    expect(id).toBe("e2sampler");
    // "PTST" at 0x100
    expect(String.fromCharCode(u8[0x100], u8[0x101], u8[0x102], u8[0x103])).toBe("PTST");
    // Version u32 LE = 1
    const view = new DataView(buffer);
    expect(view.getUint32(0x20, true)).toBe(1);
  });

  it("isRealElectribeFile + looksLikeE2PatternFile both pass on a fresh build", () => {
    const buffer = buildE2PatternFile(makeMinimalInput());
    expect(isRealElectribeFile(buffer)).toBe(true);
    expect(looksLikeE2PatternFile(buffer)).toBe(true);
  });
});

// ─── 2. BPM × 10 round-trip ──────────────────────────────────────────────────

describe("BPM × 10 encoding", () => {
  it("encodes 120 BPM as u16 LE = 1200 at 0x122", () => {
    const buffer = buildE2PatternFile(makeMinimalInput({ bpm: 120 }));
    const view = new DataView(buffer);
    expect(view.getUint16(0x122, true)).toBe(1200);
  });

  it("encodes 170.5 BPM as u16 LE = 1705 (rounded)", () => {
    const buffer = buildE2PatternFile(makeMinimalInput({ bpm: 170.5 }));
    const view = new DataView(buffer);
    expect(view.getUint16(0x122, true)).toBe(1705);
  });

  it("clamps BPM to hardware range [20, 300]", () => {
    const view1 = new DataView(buildE2PatternFile(makeMinimalInput({ bpm: 5 })));
    expect(view1.getUint16(0x122, true)).toBe(200); // 20 × 10
    const view2 = new DataView(buildE2PatternFile(makeMinimalInput({ bpm: 999 })));
    expect(view2.getUint16(0x122, true)).toBe(3000); // 300 × 10
  });

  it("round-trips through parseElectribePattern", () => {
    for (const bpm of [120, 170, 165, 128, 90.5, 200]) {
      const buffer = buildE2PatternFile(makeMinimalInput({ bpm }));
      const parsed = parseElectribePattern(buffer) as ParsedPattern;
      expect(parsed.bpm).toBeCloseTo(bpm, 1);
    }
  });
});

// ─── 3. Pattern name (space-padded ASCII) ────────────────────────────────────

describe("Pattern name encoding", () => {
  it("v3.34: NUL-pads short names to 16 bytes (KORG-native encoding)", () => {
    const buffer = buildE2PatternFile(makeMinimalInput({ name: "Hi" }));
    const u8 = new Uint8Array(buffer);
    expect(u8[0x110]).toBe(0x48); // 'H'
    expect(u8[0x111]).toBe(0x69); // 'i'
    expect(u8[0x112]).toBe(0x00); // v3.34: NUL pad (was 0x20 in v3.26)
    expect(u8[0x110 + 15]).toBe(0x00); // last byte is NUL
  });

  it("truncates names longer than 16 chars", () => {
    const buffer = buildE2PatternFile(makeMinimalInput({ name: "ThisIsAVeryLongPatternName" }));
    const u8 = new Uint8Array(buffer);
    const decoded = String.fromCharCode(...u8.slice(0x110, 0x120));
    // Read-side trims trailing whitespace, but we wrote exactly 16 chars.
    expect(decoded.length).toBe(16);
    expect(decoded).toBe("ThisIsAVeryLongP");
  });

  it("round-trips a name through parseElectribePattern (trim trailing space)", () => {
    const buffer = buildE2PatternFile(makeMinimalInput({ name: "BodyTalk1" }));
    const parsed = parseElectribePattern(buffer) as ParsedPattern;
    expect(parsed.name).toBe("BodyTalk1");
  });
});

// ─── 4. Step-encoding round-trip (trigger + velocity + note) ─────────────────

describe("Step encoding round-trip", () => {
  it("writes byte 0 = 0x01 for active steps, 0x00 for inactive", () => {
    const input = makeMinimalInput();
    input.parts[0].steps[0] = { active: true, velocity: 100 };
    input.parts[0].steps[1] = { active: false };
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    const partStart = 0x900;
    const stepArea = partStart + 0x30;
    expect(view.getUint8(stepArea + 0 * 12)).toBe(0x01); // step 0 trigger
    expect(view.getUint8(stepArea + 1 * 12)).toBe(0x00); // step 1 trigger
  });

  it("writes velocity at byte 1 and note at byte 4", () => {
    const input = makeMinimalInput();
    input.parts[0].steps[0] = { active: true, velocity: 100, note: 60 };
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    const stepOffset = 0x900 + 0x30;
    expect(view.getUint8(stepOffset + 1)).toBe(100); // velocity
    expect(view.getUint8(stepOffset + 4)).toBe(60); // note
    expect(view.getUint8(stepOffset + 2)).toBe(0x60); // constant
  });

  it("v3.34: writes 0xFF velocity sentinel and default note 0x48 for ACTIVE unset step", () => {
    const input = makeMinimalInput();
    input.parts[0].steps[0] = { active: true }; // no velocity, no note
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    const stepOffset = 0x900 + 0x30;
    // v3.34: byte 1 = 0xFF KORG sentinel (parser maps → 127).
    expect(view.getUint8(stepOffset + 1)).toBe(E2_DEFAULT_VELOCITY_RAW_BYTE);
    expect(E2_DEFAULT_VELOCITY_RAW_BYTE).toBe(0xff);
    // Decoded velocity is still the canonical default 127.
    expect(E2_DEFAULT_VELOCITY).toBe(127);
    // Active step still gets default note 0x48 (C5).
    expect(view.getUint8(stepOffset + 4)).toBe(E2_DEFAULT_NOTE);
  });

  it("reads back active flags + velocities via parseElectribePattern", () => {
    const input = makeMinimalInput();
    // Sparse activation pattern on part 0
    input.parts[0].steps[0] = { active: true, velocity: 100, note: 60 };
    input.parts[0].steps[4] = { active: true, velocity: 64, note: 62 };
    input.parts[0].steps[8] = { active: true, velocity: 127, note: 64 };
    input.parts[0].steps[12] = { active: true, velocity: 32, note: 67 };

    const buffer = buildE2PatternFile(input);
    const parsed = parseElectribePattern(buffer) as ParsedPattern;
    const part0 = parsed.parts[0];

    expect(part0.steps[0].active).toBe(true);
    expect(part0.steps[0].velocity).toBe(100);
    expect(part0.steps[1].active).toBe(false);
    expect(part0.steps[4].active).toBe(true);
    expect(part0.steps[4].velocity).toBe(64);
    expect(part0.steps[8].velocity).toBe(127);
    expect(part0.steps[12].velocity).toBe(32);
  });
});

// ─── 4b. v3.34 bit-exact-polish encoding conventions ────────────────────────

describe("v3.34: KORG-native encoding conventions", () => {
  it("v3.34: Builder writes name NUL-padded after string content (BodyTalk1)", () => {
    const buffer = buildE2PatternFile(makeMinimalInput({ name: "BodyTalk1" }));
    const u8 = new Uint8Array(buffer);
    // 9-char name, then 7 × 0x00 padding.
    const expected = [0x42, 0x6f, 0x64, 0x79, 0x54, 0x61, 0x6c, 0x6b, 0x31,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    for (let i = 0; i < 16; i++) {
      expect(u8[0x110 + i], `byte ${i} of name field`).toBe(expected[i]);
    }
  });

  it("v3.34: Builder writes name NUL-padded for empty / short names", () => {
    const buffer = buildE2PatternFile(makeMinimalInput({ name: "Hi" }));
    const u8 = new Uint8Array(buffer);
    expect(u8[0x110]).toBe(0x48); // 'H'
    expect(u8[0x111]).toBe(0x69); // 'i'
    // All remaining 14 bytes are NUL (NOT 0x20 as in pre-v3.34).
    for (let i = 2; i < 16; i++) {
      expect(u8[0x110 + i], `byte ${i} of name field`).toBe(0x00);
    }
    // Parser still trims trailing whitespace+NUL → decoded name "Hi".
    const parsed = parseElectribePattern(buffer) as ParsedPattern;
    expect(parsed.name).toBe("Hi");
  });

  it("v3.34: Builder writes 0xFF sentinel for explicit velocity 127 on active step", () => {
    const input = makeMinimalInput();
    input.parts[0].steps[0] = { active: true, velocity: 127 };
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    expect(view.getUint8(0x900 + 0x30 + 1)).toBe(0xff);
    // Parser maps 0xFF → 127, so the decoded velocity round-trips.
    const parsed = parseElectribePattern(buffer) as ParsedPattern;
    expect(parsed.parts[0].steps[0].velocity).toBe(127);
  });

  it("v3.34: Builder writes literal byte for non-127 explicit velocities", () => {
    const input = makeMinimalInput();
    input.parts[0].steps[0] = { active: true, velocity: 100 };
    input.parts[0].steps[1] = { active: true, velocity: 64 };
    input.parts[0].steps[2] = { active: true, velocity: 0 };
    input.parts[0].steps[3] = { active: true, velocity: 1 };
    input.parts[0].steps[4] = { active: true, velocity: 126 };
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    const base = 0x900 + 0x30;
    expect(view.getUint8(base + 0 * 12 + 1)).toBe(100);
    expect(view.getUint8(base + 1 * 12 + 1)).toBe(64);
    expect(view.getUint8(base + 2 * 12 + 1)).toBe(0);
    expect(view.getUint8(base + 3 * 12 + 1)).toBe(1);
    expect(view.getUint8(base + 4 * 12 + 1)).toBe(126);
  });

  it("v3.34: Inactive step byte 4 (note) = 0x00 (NOT 0x48)", () => {
    const input = makeMinimalInput();
    // Leave all steps inactive (the makeMinimalInput default).
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    const stepBase = 0x900 + 0x30;
    // Spot-check the first 16 inactive steps of part 0.
    for (let s = 0; s < 16; s++) {
      expect(view.getUint8(stepBase + s * 12 + 4), `inactive step ${s} note byte`).toBe(
        E2_INACTIVE_STEP_NOTE,
      );
      expect(view.getUint8(stepBase + s * 12 + 4), `inactive step ${s} == 0x00`).toBe(0x00);
    }
  });

  it("v3.34: Inactive step byte 1 (velocity) = 0xFF sentinel (unset → 0xFF)", () => {
    const input = makeMinimalInput();
    // makeMinimalInput uses `{ active: false }` so velocity is unset.
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    const stepBase = 0x900 + 0x30;
    for (let s = 0; s < 16; s++) {
      expect(view.getUint8(stepBase + s * 12 + 1), `inactive step ${s} vel byte`).toBe(0xff);
    }
  });

  it("v3.34: Active step with explicit note still writes that note byte", () => {
    const input = makeMinimalInput();
    input.parts[0].steps[0] = { active: true, note: 60, velocity: 80 };
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    expect(view.getUint8(0x900 + 0x30 + 4)).toBe(60);
    expect(view.getUint8(0x900 + 0x30 + 1)).toBe(80);
  });
});

// ─── 5. Volume + Pan round-trip ──────────────────────────────────────────────

describe("Part-header Volume + Pan round-trip", () => {
  it("writes Volume at part+0x15 and Pan at part+0x22", () => {
    const input = makeMinimalInput();
    input.parts[0].volume = 100;
    input.parts[0].pan = 30;
    input.parts[5].volume = 64;
    input.parts[5].pan = 96;

    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    expect(view.getUint8(0x900 + 0x15)).toBe(100); // part 0 volume
    expect(view.getUint8(0x900 + 0x22)).toBe(30); // part 0 pan
    expect(view.getUint8(0x900 + 5 * 816 + 0x15)).toBe(64); // part 5 volume
    expect(view.getUint8(0x900 + 5 * 816 + 0x22)).toBe(96); // part 5 pan
  });

  it("clamps Volume + Pan to 0..127", () => {
    const input = makeMinimalInput();
    input.parts[0].volume = 500;
    input.parts[0].pan = -50;
    const buffer = buildE2PatternFile(input);
    const view = new DataView(buffer);
    expect(view.getUint8(0x900 + 0x15)).toBe(127);
    expect(view.getUint8(0x900 + 0x22)).toBe(0);
  });

  it("round-trips Volume + Pan through parseElectribePattern", () => {
    const input = makeMinimalInput();
    const sampleValues = [
      [127, 64],
      [100, 30],
      [50, 96],
      [0, 127],
    ];
    for (let i = 0; i < sampleValues.length; i++) {
      input.parts[i].volume = sampleValues[i][0];
      input.parts[i].pan = sampleValues[i][1];
    }
    const buffer = buildE2PatternFile(input);
    const parsed = parseElectribePattern(buffer) as ParsedPattern;
    for (let i = 0; i < sampleValues.length; i++) {
      expect(parsed.parts[i].volume).toBe(sampleValues[i][0]);
      expect(parsed.parts[i].pan).toBe(sampleValues[i][1]);
    }
  });
});

// ─── 6. Step-length codes ────────────────────────────────────────────────────

describe("Step-length encoding", () => {
  it("writes code 0 for 16 steps, 1 for 32, 3 for 64", () => {
    for (const [stepLen, code] of [[16, 0], [32, 1], [64, 3]] as const) {
      const buffer = buildE2PatternFile(makeMinimalInput({ stepLength: stepLen }));
      const u8 = new Uint8Array(buffer);
      expect(u8[0x125]).toBe(code);
    }
  });

  it("round-trips through parseElectribePattern", () => {
    for (const stepLen of [16, 32, 64] as const) {
      const buffer = buildE2PatternFile(makeMinimalInput({ stepLength: stepLen }));
      const parsed = parseElectribePattern(buffer) as ParsedPattern;
      expect(parsed.stepLength).toBe(stepLen);
    }
  });
});

// ─── 7. CRITICAL: Round-Trip build → read → re-build ────────────────────────

describe("CRITICAL: Round-Trip Write → Read → Write", () => {
  it("preserves a fully-programmed pattern across one build→read→build cycle", () => {
    // Build a realistic pattern: 4 parts active with different step patterns.
    const input = makeMinimalInput({ name: "RoundTrip", bpm: 132, stepLength: 32 });
    input.parts[0].volume = 100;
    input.parts[0].pan = 50;
    input.parts[0].steps[0] = { active: true, velocity: 120, note: 60 };
    input.parts[0].steps[4] = { active: true, velocity: 90, note: 60 };
    input.parts[0].steps[8] = { active: true, velocity: 110, note: 60 };
    input.parts[0].steps[12] = { active: true, velocity: 80, note: 60 };

    input.parts[1].volume = 80;
    input.parts[1].pan = 80;
    for (let s = 0; s < 16; s += 2) {
      input.parts[1].steps[s] = { active: true, velocity: 100, note: 62 };
    }

    input.parts[2].volume = 110;
    input.parts[2].pan = 30;
    input.parts[2].steps[3] = { active: true, velocity: 64, note: 64 };
    input.parts[2].steps[11] = { active: true, velocity: 64, note: 64 };

    // Build, read back, then re-build from parsed → should byte-equal first build.
    const buffer1 = buildE2PatternFile(input);
    const parsed = parseElectribePattern(buffer1) as ParsedPattern;

    // Verify the parsed pattern matches the input.
    expect(parsed.name).toBe("RoundTrip");
    expect(parsed.bpm).toBeCloseTo(132, 1);
    expect(parsed.stepLength).toBe(32);
    expect(parsed.parts[0].volume).toBe(100);
    expect(parsed.parts[0].pan).toBe(50);
    expect(parsed.parts[0].steps[0].active).toBe(true);
    expect(parsed.parts[0].steps[0].velocity).toBe(120);
    expect(parsed.parts[1].volume).toBe(80);
    expect(parsed.parts[2].steps[3].active).toBe(true);
    expect(parsed.parts[2].steps[3].velocity).toBe(64);
  });
});

// ─── 8. Synthstudio adapter ──────────────────────────────────────────────────

describe("convertSynthstudioPatternToE2 adapter", () => {
  it("maps a 16-step Synthstudio pattern → E2 stepLength 16", () => {
    const pattern = makeSynthstudioPattern({ stepCount: 16 });
    const e2 = convertSynthstudioPatternToE2(pattern);
    expect(e2.stepLength).toBe(16);
    expect(e2.parts).toHaveLength(16);
  });

  it("maps a 32-step Synthstudio pattern → E2 stepLength 32", () => {
    const pattern = makeSynthstudioPattern({ stepCount: 32 });
    const e2 = convertSynthstudioPatternToE2(pattern);
    expect(e2.stepLength).toBe(32);
  });

  it("falls back to globalBpm when pattern.bpm is null", () => {
    const pattern = makeSynthstudioPattern({ bpm: null });
    const e2 = convertSynthstudioPatternToE2(pattern, { globalBpm: 140 });
    expect(e2.bpm).toBe(140);
  });

  it("converts volume 0..1 → 0..127 and pan -1..+1 → 0..127", () => {
    expect(synthVolumeToE2(0)).toBe(0);
    expect(synthVolumeToE2(0.5)).toBe(64);
    expect(synthVolumeToE2(1)).toBe(127);
    expect(synthVolumeToE2(undefined)).toBe(127); // default

    expect(synthPanToE2(-1)).toBe(1); // 64 - 63
    expect(synthPanToE2(0)).toBe(64);
    expect(synthPanToE2(1)).toBe(127);
    expect(synthPanToE2(undefined)).toBe(64);
  });

  it("converts step.pitch semitones → MIDI note centered on C5 (0x48)", () => {
    expect(synthPitchToE2Note(0)).toBe(0x48);
    expect(synthPitchToE2Note(12)).toBe(0x48 + 12);
    expect(synthPitchToE2Note(-12)).toBe(0x48 - 12);
    expect(synthPitchToE2Note(100)).toBe(127); // clamped
    expect(synthPitchToE2Note(-200)).toBe(0); // clamped
    expect(synthPitchToE2Note(undefined)).toBe(0x48);
  });

  it("synthStepCountToE2StepLength maps 16→16, 32→32, others→16", () => {
    expect(synthStepCountToE2StepLength(16)).toBe(16);
    expect(synthStepCountToE2StepLength(32)).toBe(32);
    expect(synthStepCountToE2StepLength(64)).toBe(64);
    expect(synthStepCountToE2StepLength(undefined)).toBe(16);
    expect(synthStepCountToE2StepLength(0)).toBe(16);
  });

  it("convertStepToE2: maps active+velocity through, applies pitch to note", () => {
    const s1 = convertStepToE2({ active: true, velocity: 90, pitch: 5 });
    expect(s1.active).toBe(true);
    expect(s1.velocity).toBe(90);
    expect(s1.note).toBe(0x48 + 5);

    const s2 = convertStepToE2({ active: false });
    expect(s2.active).toBe(false);
    expect(s2.velocity).toBeUndefined(); // builder will use default
    expect(s2.note).toBe(0x48);

    const s3 = convertStepToE2(undefined);
    expect(s3.active).toBe(false);
  });

  it("pads partial Synthstudio.parts to exactly 16 E2 parts", () => {
    const pattern = makeSynthstudioPattern();
    pattern.parts = pattern.parts.slice(0, 4); // only 4 parts
    const e2 = convertSynthstudioPatternToE2(pattern);
    expect(e2.parts).toHaveLength(16);
    // Padding parts have empty steps array (builder pads to 64 internally).
    expect(e2.parts[15].steps).toEqual([]);
  });
});

// ─── 9. Adapter + Builder + Reader full round-trip ───────────────────────────

describe("Full Round-Trip: Synthstudio → E2 → file → parse", () => {
  it("Synthstudio pattern → buildE2PatternFile → parse retains structure", () => {
    const pattern = makeSynthstudioPattern({
      name: "FullTrip",
      bpm: 145,
      stepCount: 16,
    });
    // Activate kick on every 4th step of part 0.
    for (let s = 0; s < 16; s += 4) {
      pattern.parts[0].steps[s] = { active: true, velocity: 110, pitch: 0 };
    }
    pattern.parts[0].volume = 1.0; // max
    pattern.parts[0].pan = 0; // center

    const e2Input = convertSynthstudioPatternToE2(pattern, { globalBpm: 120 });
    const buffer = buildE2PatternFile(e2Input);
    const parsed = parseElectribePattern(buffer) as ParsedPattern;

    expect(parsed.name).toBe("FullTrip");
    expect(parsed.bpm).toBeCloseTo(145, 1);
    expect(parsed.stepLength).toBe(16);
    expect(parsed.parts[0].volume).toBe(127);
    expect(parsed.parts[0].pan).toBe(64);
    expect(parsed.parts[0].steps[0].active).toBe(true);
    expect(parsed.parts[0].steps[0].velocity).toBe(110);
    expect(parsed.parts[0].steps[4].active).toBe(true);
    expect(parsed.parts[0].steps[8].active).toBe(true);
    expect(parsed.parts[0].steps[12].active).toBe(true);
    expect(parsed.parts[0].steps[1].active).toBe(false);
  });
});

// ─── 10. IPC validators ──────────────────────────────────────────────────────

describe("IPC validators (validateE2PatternFilename / Buffer)", () => {
  it("accepts a valid .e2spat filename", () => {
    const r = validateE2PatternFilename("mypattern.e2spat");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filename).toBe("mypattern.e2spat");
  });

  it("rejects path traversal, bad extension, non-ASCII", () => {
    expect(validateE2PatternFilename("../escape.e2spat").ok).toBe(false);
    expect(validateE2PatternFilename("foo/bar.e2spat").ok).toBe(false);
    expect(validateE2PatternFilename("file.bin").ok).toBe(false);
    expect(validateE2PatternFilename("").ok).toBe(false);
    expect(validateE2PatternFilename(null as unknown as string).ok).toBe(false);
    expect(validateE2PatternFilename("pattern\0.e2spat").ok).toBe(false);
  });

  it("accepts a freshly-built E2 pattern buffer", () => {
    const buffer = buildE2PatternFile(makeMinimalInput());
    const u8 = new Uint8Array(buffer);
    const r = validateE2PatternBuffer(u8.byteLength, u8.slice(0, 0x104));
    expect(r.ok).toBe(true);
  });

  it("rejects wrong-size buffers", () => {
    const wrongSize = new Uint8Array(1000);
    expect(validateE2PatternBuffer(1000, wrongSize).ok).toBe(false);
    expect(validateE2PatternBuffer(E2_PATTERN_FILE_SIZE_EXACT - 1, wrongSize).ok).toBe(false);
  });

  it("rejects buffers missing the KORG / e2sampler / PTST markers", () => {
    const bogus = new Uint8Array(0x104).fill(0xff);
    const r = validateE2PatternBuffer(E2_PATTERN_FILE_SIZE_EXACT, bogus);
    expect(r.ok).toBe(false);
  });
});
