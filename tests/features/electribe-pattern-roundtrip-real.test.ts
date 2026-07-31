/**
 * tests/features/electribe-pattern-roundtrip-real.test.ts
 *
 * v3.33.0 — REAL-FILE ROUND-TRIP for the v3.26 `.e2spat` Builder.
 * v3.34.0 — STRENGTHENED bit-exact-drift bounds + 3 NEW encoding-style
 *           assertions verifying that the v3.34 builder adopts the KORG-native
 *           encoding conventions (name NUL-pad, 0xFF velocity sentinel,
 *           inactive-step note 0x00). The drift caps were ratcheted down to
 *           catch any future regression.
 *
 * Motivation
 * ──────────
 * v3.26 introduced `buildE2PatternFile` (binary writer) and
 * `convertSynthstudioPatternToE2` (Synthstudio → E2 adapter), but the only
 * round-trip tests so far built SYNTHETIC inputs in-memory and parsed them
 * back. That proves the builder is internally consistent, but does NOT prove
 * the builder is compatible with the byte layout produced by a real KORG E2
 * Sampler. This file closes that gap.
 *
 * Test pipeline
 * ─────────────
 *
 *   Verifier 1 ("parse → build → parse equality"):
 *
 *     real .e2spat
 *        → parseElectribePattern → P0
 *        → projectParsedToBuilderInput(P0) → I1
 *        → buildE2PatternFile(I1) → buf2
 *        → parseElectribePattern(buf2) → P1
 *     assert  P1 ≈ P0     (all decoded fields equal)
 *
 *   Verifier 2 ("Synthstudio-loop"):
 *
 *     real .e2spat
 *        → parseElectribePattern → P0
 *        → convertParsedPatternToSynthstudio → synthImport
 *        → synthstudioImportToPatternData(synthImport, P0.bpm) → PatternData
 *        → convertSynthstudioPatternToE2 → I2
 *        → buildE2PatternFile(I2) → buf3
 *        → parseElectribePattern(buf3) → P2
 *     assert  documented-equality + documented-lossy fields
 *
 *   Bit-Diff inspection:
 *
 *     Compare buf2 byte-for-byte to real .e2spat — the first 16640 bytes
 *     should agree on every byte the builder is responsible for. Diffs are
 *     collected by region (file-header / motion / part-headers / steps /
 *     misc) and asserted against a known whitelist of regions the v3.26
 *     builder writes defaults for (e.g. it does not preserve the unknown
 *     bytes between 0x024..0x100 which real files fill with 0xFF padding
 *     and the builder already does too, or the part-footer/unused bytes
 *     the parser doesn't decode).
 *
 * Conditional skip
 * ────────────────
 * Real .e2spat files live in `<repo>/Korg e2s files/`. On CI / fresh
 * clone these files are NOT present (user-supplied dumps, NOT in the
 * repository). The whole suite is wrapped with `describe.skip` in that
 * case so the build stays green.
 *
 * Documented findings (verified against 4 real files 2026-05-18)
 * ──────────────────────────────────────────────────────────────
 *
 *   Reference files (all 16640 bytes, all valid `.e2spat`):
 *     - 245_BodyTalk1   — BPM 165, 64-step, 314 active steps across 14 parts
 *     - 181_Init Pattern — BPM 120, 16-step, 4 active steps (NOT truly empty!)
 *     - 250_Init Pattern — BPM 170, 64-step, 274 active steps (NOT empty either!)
 *     - 001_Advi$ory1    — BPM 128, 64-step, 90 active steps, name with '$'
 *
 *   ROUND-TRIP STABLE through builder-only (Verifier 1, all 4 files):
 *     - name (16-char trimmed ASCII, incl. '$' char)
 *     - bpm (1 decimal precision, BPM × 10 u16 LE)
 *     - stepLength (16 / 32 / 64)
 *     - per-part volume (0..127 @ part+0x15)
 *     - per-part pan (0..127 @ part+0x22)
 *     - per-step trigger (active flag, all 16 × 64 = 1024 steps per file)
 *     - per-step velocity (0..127, incl. 0xFF sentinel → 127 normalisation)
 *
 *   ROUND-TRIP LOSSY through Synthstudio (Verifier 2):
 *     - 64-step patterns capped to 32 steps (Synthstudio max). Active steps
 *       in indices 32..63 are dropped. Verified: BodyTalk1 keeps only its
 *       first-32-steps active count after Synthstudio loop.
 *     - per-step velocity 0 remapped to 100 (Synthstudio default in
 *       convertParsedPatternToSynthstudio line 1348). Acceptable because
 *       active steps don't have velocity 0 in practice.
 *     - per-step pitch is per-PART in Synthstudio (uniform across all steps
 *       of one part), but per-STEP in E2. Round-trip pitch on active steps
 *       only; inactive-step "note" bytes lost.
 *     - per-part fxSend: reader doesn't decode → builder writes 0 → re-parsed
 *       as 0. Lossy if real file had non-zero (not observed in our 4 files).
 *     - motion-sequencer slots: NOT round-tripped through Synthstudio in
 *       v3.26. convertSynthstudioPatternToE2 only forwards motion if caller
 *       passes options.motionSlots explicitly. Verifier 1 DOES preserve
 *       motion via projectParsedToBuilderInput.
 *     - accent flag, swing: reader returns defaults (false / 0) either way.
 *
 *   BYTE-LEVEL DIFFS vs real files (encoding-style, NOT bugs):
 *     1) Pattern-Name padding (0x110..0x120):
 *          Real: "BodyTalk1\x20\x20\x20\x00\x00\x00\x00" or "Init Pattern\x00\x00\x00\x00"
 *          Builder: "BodyTalk1\x20\x20\x20\x20\x20\x20\x20" (all-space)
 *          → parser trims trailing whitespace+NUL, decoded name identical.
 *     2) Step-Velocity sentinel (per-step byte 1):
 *          Real BodyTalk1: 0xFF (= "use default 127" sentinel)
 *          Builder: explicit 0x60 (96) for unset, or echo'd value 127 after parse
 *          → parser maps 0xFF → 127, builder writes 127, decoded velocity identical.
 *     3) Step-Note on inactive steps (per-step byte 4):
 *          Real Init181: 0x00, Real BodyTalk1: 0x48
 *          Builder: always 0x48 (parser doesn't expose per-step note)
 *          → no parser-visible field affected.
 *     4) 0x024..0x100 (220B) padding, part-header unknown bytes, pattern
 *        footer 0x3C00..end — all unknown to the parser, builder writes
 *        zeros/defaults.
 *
 *   v3.26 BUILDER BUGS FOUND: NONE. All decoded-field values round-trip
 *   correctly via Verifier 1 for all 4 reference files. Byte-level drifts
 *   are pure encoding-style choices the parser is robust to. No fix-up
 *   needed to the v3.26 builder.
 *
 *   FUTURE BUILDER POLISH (optional, not required for correctness):
 *     - Adopt 0xFF velocity sentinel for default-velocity unset steps
 *       (reduces drift on BodyTalk1 by ~1000 bytes).
 *     - Adopt NUL-padding after first-NUL in name field (reduces drift
 *       by ~5-7 bytes per file).
 *     Neither would change ANY semantic round-trip property.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  parseElectribePattern,
  isRealElectribeFile,
  convertParsedPatternToSynthstudio,
  ELECTRIBE_REAL_FILE_SIZE,
  ELECTRIBE_REAL_PARTS_OFFSET,
  ELECTRIBE_REAL_PART_STRIDE,
  ELECTRIBE_REAL_PART_HEADER_BYTES,
  ELECTRIBE_REAL_PART_VOLUME_OFFSET,
  ELECTRIBE_REAL_PART_PAN_OFFSET,
  ELECTRIBE_REAL_STEP_RECORD_BYTES,
  ELECTRIBE_REAL_STEPS_PER_PART,
  ELECTRIBE_REAL_STEP_TRIGGER_OFFSET,
  ELECTRIBE_REAL_STEP_VELOCITY_OFFSET,
  ELECTRIBE_REAL_STEP_NOTE_OFFSET,
  ELECTRIBE_REAL_STEP_GATE_LENGTH_OFFSET,
  type ParsedPattern,
  type ParsedPart,
  type SynthstudioPatternImport,
} from "../../client/src/utils/electribeImport";
import {
  buildE2PatternFile,
  looksLikeE2PatternFile,
  type E2PatternInput,
  type E2PartInput,
  type E2StepInput,
} from "../../client/src/utils/electribePatternBuilder";
import {
  convertSynthstudioPatternToE2,
} from "../../client/src/utils/electribePatternConvert";
import type { PatternData, PartData, StepData } from "../../client/src/audio/AudioEngine";

// ─── Real-File Locations (user-supplied, conditional skip on CI) ─────────────

const REAL_FILES_DIR = path.resolve(process.cwd(), "Korg e2s files");

const REAL_FILE_BODYTALK = "245_BodyTalk1   .e2spat";
const REAL_FILE_INIT_181 = "181_Init Pattern.e2spat";
const REAL_FILE_INIT_250 = "250_Init Pattern.e2spat";
const REAL_FILE_ADVISORY = "001_Advi$ory1   .e2spat";

const REAL_FILES = [
  REAL_FILE_BODYTALK,
  REAL_FILE_INIT_181,
  REAL_FILE_INIT_250,
  REAL_FILE_ADVISORY,
];

const REAL_FILES_AVAILABLE = (() => {
  try {
    if (!fs.existsSync(REAL_FILES_DIR)) return false;
    if (!fs.statSync(REAL_FILES_DIR).isDirectory()) return false;
    // All 4 files must exist for the whole suite to run.
    return REAL_FILES.every(name =>
      fs.existsSync(path.join(REAL_FILES_DIR, name)),
    );
  } catch {
    return false;
  }
})();

function loadReal(name: string): Uint8Array {
  const full = path.join(REAL_FILES_DIR, name);
  return new Uint8Array(fs.readFileSync(full));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps the parser's `ParsedPattern` back into the builder's `E2PatternInput`
 * shape. This is the inverse of `parseElectribePattern` insofar as the
 * builder's input model captures it. Fields the parser doesn't decode
 * (pitch on parts, fxSend, accent) get safe defaults that match the
 * builder's defaults.
 */
function projectParsedToBuilderInput(parsed: ParsedPattern): E2PatternInput {
  const parts: E2PartInput[] = parsed.parts.map(p => {
    const steps: E2StepInput[] = p.steps.map(s => ({
      active: s.active,
      // Velocity 0 round-trips through builder as default 96; we explicitly
      // forward the parsed value (incl. 0) so the assertion is precise.
      velocity: s.velocity,
      // v3.306 — Note, Gate-Flag und Gate-Länge werden jetzt vom Parser
      // mitgeführt und hier weitergereicht. Ohne sie schrieb der Builder
      // Vorgabewerte, und die Abweichung gegen echte Dateien stieg deutlich
      // (Init181: <200 → 1188 Bytes) — genau diese Lücke schließt der Umbau.
      note: s.note,
      gate: s.gate,
      gateLength: s.gateLength,
      // v3.308 — Chord-Noten (Bytes 5..7) mitführen; ohne sie verlor der
      // Round-Trip Akkorde (BodyTalk trägt welche).
      chordNotes: s.chordNotes,
    }));
    return {
      volume: p.volume,
      pan: p.pan,
      pitch: p.pitch,
      fxSend: p.fxSend,
      steps,
    };
  });

  // step-length 16/32/64 → builder accepts the same enum.
  const stepLength: 16 | 32 | 64 =
    parsed.stepLength === 32
      ? 32
      : parsed.stepLength === 64
      ? 64
      : 16;

  return {
    name: parsed.name,
    bpm: parsed.bpm,
    stepLength,
    swing: parsed.swing,
    parts,
    // Motion: the parser has `patternMotion?: ParsedPatternMotionSlot[]`.
    // The builder accepts `E2MotionSlot[]` with the same shape modulo
    // optional `enabled`. We forward only the enabled slots.
    motionSlots: (parsed.patternMotion ?? [])
      .filter(slot => slot.enabled)
      .map(slot => ({
        paramId: slot.paramId,
        targetPart: slot.targetPart >= 0 ? slot.targetPart : undefined,
        values: slot.values.slice(0, 64),
      })),
  };
}

/** Convert a Synthstudio `SynthstudioPatternImport` back into the
 *  `PatternData` that the v3.26 `convertSynthstudioPatternToE2`
 *  adapter expects. */
function synthImportToPatternData(
  imp: SynthstudioPatternImport,
  bpmHint: number,
): PatternData {
  const parts: PartData[] = imp.drumParts.map(dp => {
    const steps: StepData[] = dp.steps.map((active, i) => ({
      active,
      velocity: dp.velocities[i],
      pitch: dp.pitchSemitones,
    }));
    return {
      id: `roundtrip-part-${dp.partIndex}`,
      name: dp.sampleHint,
      muted: false,
      soloed: false,
      volume: dp.volume,
      pan: dp.pan,
      steps,
      fx: {} as PartData["fx"],
    };
  });
  return {
    id: "roundtrip-pattern",
    name: imp.name,
    stepCount: imp.stepCount,
    stepResolution: imp.stepCount === 32 ? "1/32" : "1/16",
    bpm: bpmHint,
    parts,
  };
}

/** Count `{active: true}` steps across all 16 parts × 64 steps. */
function countActiveSteps(p: ParsedPattern): number {
  let n = 0;
  for (const part of p.parts) {
    for (const s of part.steps) if (s.active) n++;
  }
  return n;
}

/** Cheap structural equality for two parsed patterns over fields the
 *  v3.13/v3.15 reader actually decodes. Throws via `expect` on first
 *  mismatch with a descriptive message. */
function expectParsedEqual(actual: ParsedPattern, expected: ParsedPattern, label: string): void {
  expect(actual.name, `${label}: name`).toBe(expected.name);
  expect(actual.bpm, `${label}: bpm`).toBeCloseTo(expected.bpm, 1);
  expect(actual.stepLength, `${label}: stepLength`).toBe(expected.stepLength);
  expect(actual.parts.length, `${label}: parts.length`).toBe(expected.parts.length);

  for (let p = 0; p < expected.parts.length; p++) {
    const a = actual.parts[p];
    const e = expected.parts[p];
    expect(a.volume, `${label}: part ${p} volume`).toBe(e.volume);
    expect(a.pan, `${label}: part ${p} pan`).toBe(e.pan);
    expect(a.steps.length, `${label}: part ${p} steps.length`).toBe(e.steps.length);
    for (let s = 0; s < e.steps.length; s++) {
      expect(a.steps[s].active, `${label}: part ${p} step ${s} active`).toBe(
        e.steps[s].active,
      );
      expect(a.steps[s].velocity, `${label}: part ${p} step ${s} velocity`).toBe(
        e.steps[s].velocity,
      );
    }
  }
}

/** Compute the byte-region diff between built and real file. Returns
 *  the count of differing bytes inside the parser-decoded fields only —
 *  if non-zero we have a builder bug. Bytes outside the decoded fields
 *  are returned separately as "unknown-region diffs" (expected ≥ 0). */
interface ByteDiffReport {
  totalDiff: number;
  decodedFieldDiff: number;
  unknownRegionDiff: number;
  firstDecodedDiff: { offset: number; built: number; real: number } | null;
}

function computeByteDiff(built: ArrayBuffer, real: Uint8Array): ByteDiffReport {
  const b = new Uint8Array(built);
  let totalDiff = 0;
  let decodedFieldDiff = 0;
  let unknownRegionDiff = 0;
  let firstDecodedDiff: ByteDiffReport["firstDecodedDiff"] = null;

  for (let i = 0; i < Math.min(b.length, real.length); i++) {
    if (b[i] !== real[i]) {
      totalDiff++;
      if (isDecodedField(i)) {
        decodedFieldDiff++;
        if (!firstDecodedDiff) {
          firstDecodedDiff = { offset: i, built: b[i], real: real[i] };
        }
      } else {
        unknownRegionDiff++;
      }
    }
  }
  return { totalDiff, decodedFieldDiff, unknownRegionDiff, firstDecodedDiff };
}

/** True if the byte at `offset` corresponds to a field the v3.13/v3.15
 *  parser ACTUALLY DECODES and returns from `parseElectribePattern`. A
 *  decoded-field byte must round-trip BIT-EXACTLY through the builder
 *  (any diff here is a regression / builder bug).
 *
 *  v3.34 NOTE: step byte 2 (constant 0x60), byte 3 (accent), and byte 4
 *  (note) are NOT decoded by the parser — they don't appear in the
 *  `ParsedPartStep` interface (which only has `active` + `velocity`).
 *  Real KORG files use varying values at these offsets, but the builder
 *  writes deterministic defaults. The drift in these bytes is encoding-
 *  style, NOT a semantic round-trip failure.
 */
function isDecodedField(offset: number): boolean {
  // File-Header markers + version field (0x00..0x024).
  if (offset < 0x024) return true;
  // PTST marker @ 0x100, name @ 0x110..0x120, BPM @ 0x122..0x123,
  // step-length code @ 0x125.
  if (offset >= 0x100 && offset < 0x104) return true;
  if (offset >= 0x110 && offset < 0x120) return true;
  if (offset === 0x122 || offset === 0x123) return true;
  if (offset === 0x125) return true;

  // Per-part decoded bytes (volume @+0x15, pan @+0x22, step trigger +
  // step velocity only — see v3.34 NOTE above).
  if (offset >= ELECTRIBE_REAL_PARTS_OFFSET) {
    const partRel = offset - ELECTRIBE_REAL_PARTS_OFFSET;
    if (partRel >= 16 * ELECTRIBE_REAL_PART_STRIDE) return false;
    const inPart = partRel % ELECTRIBE_REAL_PART_STRIDE;
    if (inPart === ELECTRIBE_REAL_PART_VOLUME_OFFSET) return true;
    if (inPart === ELECTRIBE_REAL_PART_PAN_OFFSET) return true;
    // Step records: ONLY byte 0 (trigger) and byte 1 (velocity) are
    // parser-decoded. Bytes 2/3/4 are not exposed in ParsedPartStep.
    if (inPart >= ELECTRIBE_REAL_PART_HEADER_BYTES) {
      const stepArea = inPart - ELECTRIBE_REAL_PART_HEADER_BYTES;
      if (stepArea >= ELECTRIBE_REAL_STEPS_PER_PART * ELECTRIBE_REAL_STEP_RECORD_BYTES) {
        return false;
      }
      const inStep = stepArea % ELECTRIBE_REAL_STEP_RECORD_BYTES;
      return (
        inStep === ELECTRIBE_REAL_STEP_TRIGGER_OFFSET ||
        inStep === ELECTRIBE_REAL_STEP_VELOCITY_OFFSET
      );
    }
  }
  return false;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const runner = REAL_FILES_AVAILABLE ? describe : describe.skip;

runner("electribePatternBuilder – Real-File Round-Trip (v3.33.0)", () => {
  // ── Sanity: files load and look like real .e2spat ─────────────────────────
  it("all 4 real files load + are valid .e2spat (16640 bytes, KORG/e2sampler/PTST)", () => {
    for (const name of REAL_FILES) {
      const buf = loadReal(name);
      expect(buf.byteLength, `${name}: size`).toBe(ELECTRIBE_REAL_FILE_SIZE);
      expect(isRealElectribeFile(buf), `${name}: isRealElectribeFile`).toBe(true);
      expect(looksLikeE2PatternFile(buf), `${name}: looksLikeE2PatternFile`).toBe(true);
    }
  });

  // ─── 1. BodyTalk1: full header round-trip ─────────────────────────────────
  it("BodyTalk1 round-trips Name + BPM + StepLength + step-active state", () => {
    const real = loadReal(REAL_FILE_BODYTALK);
    const parsed = parseElectribePattern(real);

    // Sanity vs known truth (verified manually 2026-05-18):
    expect(parsed.name).toBe("BodyTalk1");
    expect(parsed.bpm).toBeCloseTo(165, 1);
    expect(parsed.stepLength).toBe(64);
    expect(countActiveSteps(parsed)).toBe(314);

    // Build a fresh file from the parsed structure.
    const input = projectParsedToBuilderInput(parsed);
    const built = buildE2PatternFile(input);

    // The new file must itself be a valid .e2spat.
    expect(looksLikeE2PatternFile(built)).toBe(true);
    expect(built.byteLength).toBe(ELECTRIBE_REAL_FILE_SIZE);

    // Parse the rebuilt file. All decoded fields must match the original parse.
    const reparsed = parseElectribePattern(built);
    expectParsedEqual(reparsed, parsed, "BodyTalk1");
  });

  // ─── 2. Per-part volume + pan + per-step velocity round-trip ──────────────
  it("BodyTalk1 round-trips per-part volume + pan + per-step velocity bitwise", () => {
    const real = loadReal(REAL_FILE_BODYTALK);
    const parsed = parseElectribePattern(real);
    const input = projectParsedToBuilderInput(parsed);
    const built = buildE2PatternFile(input);
    const reparsed = parseElectribePattern(built);

    // Build a fingerprint per part: [volume, pan, sum-of-velocities, active-count].
    for (let p = 0; p < parsed.parts.length; p++) {
      const orig = parsed.parts[p];
      const back = reparsed.parts[p];
      expect(back.volume, `part ${p} volume`).toBe(orig.volume);
      expect(back.pan, `part ${p} pan`).toBe(orig.pan);

      const origActive = orig.steps.filter(s => s.active).length;
      const backActive = back.steps.filter(s => s.active).length;
      expect(backActive, `part ${p} active count`).toBe(origActive);

      const origVelSum = orig.steps.reduce((a, s) => a + s.velocity, 0);
      const backVelSum = back.steps.reduce((a, s) => a + s.velocity, 0);
      expect(backVelSum, `part ${p} velocity sum`).toBe(origVelSum);
    }
  });

  // ─── 3. Both Init Patterns round-trip ─────────────────────────────────────
  it("181_Init Pattern (16-step, 4 sparse active steps) round-trips identically", () => {
    const real = loadReal(REAL_FILE_INIT_181);
    const parsed = parseElectribePattern(real);

    // Known truth:
    expect(parsed.name).toBe("Init Pattern");
    expect(parsed.bpm).toBeCloseTo(120, 1);
    expect(parsed.stepLength).toBe(16);
    expect(countActiveSteps(parsed)).toBe(4);

    const input = projectParsedToBuilderInput(parsed);
    const built = buildE2PatternFile(input);
    const reparsed = parseElectribePattern(built);
    expectParsedEqual(reparsed, parsed, "Init_181");
  });

  it("250_Init Pattern (64-step, surprisingly 274 active steps) round-trips identically", () => {
    const real = loadReal(REAL_FILE_INIT_250);
    const parsed = parseElectribePattern(real);

    expect(parsed.name).toBe("Init Pattern");
    expect(parsed.bpm).toBeCloseTo(170, 1);
    expect(parsed.stepLength).toBe(64);
    expect(countActiveSteps(parsed)).toBe(274);

    const input = projectParsedToBuilderInput(parsed);
    const built = buildE2PatternFile(input);
    const reparsed = parseElectribePattern(built);
    expectParsedEqual(reparsed, parsed, "Init_250");
  });

  // ─── 4. Advisory1 round-trip ──────────────────────────────────────────────
  it("Advisory1 round-trips Name + BPM + 90 active steps across 9 parts", () => {
    const real = loadReal(REAL_FILE_ADVISORY);
    const parsed = parseElectribePattern(real);

    expect(parsed.name).toBe("Advi$ory1");
    expect(parsed.bpm).toBeCloseTo(128, 1);
    expect(parsed.stepLength).toBe(64);
    expect(countActiveSteps(parsed)).toBe(90);

    const input = projectParsedToBuilderInput(parsed);
    const built = buildE2PatternFile(input);
    const reparsed = parseElectribePattern(built);
    expectParsedEqual(reparsed, parsed, "Advisory1");
  });

  // ─── 5. Synthstudio-loop: lossy but documented ────────────────────────────
  it("Synthstudio-loop: Init_181 survives the lossy parse→synth→build→parse roundtrip", () => {
    // We pick Init_181 because (a) stepLength=16 so no 64→32 capping
    // happens, and (b) the 4 active steps are easy to verify exactly.
    const real = loadReal(REAL_FILE_INIT_181);
    const parsed = parseElectribePattern(real);

    const synthImport = convertParsedPatternToSynthstudio(parsed);
    const patternData = synthImportToPatternData(synthImport, parsed.bpm);
    const e2Input = convertSynthstudioPatternToE2(patternData, { globalBpm: parsed.bpm });
    const built = buildE2PatternFile(e2Input);
    const final = parseElectribePattern(built);

    // Lossless fields:
    expect(final.name).toBe(parsed.name);
    expect(final.bpm).toBeCloseTo(parsed.bpm, 1);
    expect(final.stepLength).toBe(parsed.stepLength);

    // Per-part active-counts identical (16 steps fit Synthstudio's max).
    for (let p = 0; p < parsed.parts.length; p++) {
      const o = parsed.parts[p].steps.filter(s => s.active).length;
      const f = final.parts[p].steps.filter(s => s.active).length;
      expect(f, `part ${p} active count after Synthstudio loop`).toBe(o);
    }

    // Per-part volume / pan are normalised to [0..1]/[-1..+1] in the
    // synth-import then re-scaled back — small rounding error is allowed.
    for (let p = 0; p < parsed.parts.length; p++) {
      expect(
        Math.abs(final.parts[p].volume - parsed.parts[p].volume),
        `part ${p} volume drift`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(final.parts[p].pan - parsed.parts[p].pan),
        `part ${p} pan drift`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("v3.39: Synthstudio-loop: BodyTalk1 bleibt 64 steps (KORG-Parität, kein cap mehr)", () => {
    const real = loadReal(REAL_FILE_BODYTALK);
    const parsed = parseElectribePattern(real);
    expect(parsed.stepLength).toBe(64);

    const synthImport = convertParsedPatternToSynthstudio(parsed);
    // v3.39: Synthstudio unterstützt jetzt nativ 64 Steps — kein cap mehr.
    expect(synthImport.stepCount).toBe(64);

    const patternData = synthImportToPatternData(synthImport, parsed.bpm);
    const e2Input = convertSynthstudioPatternToE2(patternData, { globalBpm: parsed.bpm });
    const built = buildE2PatternFile(e2Input);
    const final = parseElectribePattern(built);

    // After the loop the rebuilt file is STILL a 64-step pattern (lossless).
    expect(final.stepLength).toBe(64);

    // Alle 64 steps der Original-Aktivitäten müssen erhalten bleiben.
    for (let p = 0; p < parsed.parts.length; p++) {
      const origActive = parsed.parts[p].steps.filter(s => s.active).length;
      const finalActive = final.parts[p].steps.filter(s => s.active).length;
      expect(finalActive, `part ${p} active steps (lossless)`).toBe(origActive);
    }
  });

  // ─── 6. Bit-Diff inspection: documented byte-level encoding differences ──
  //
  // FINDING (v3.33.0): Real KORG E2 files do NOT bit-exactly match the
  // builder's output, even after a parse-build round-trip. The differences
  // are SEMANTICALLY EQUIVALENT — both representations decode to the same
  // values through the parser — but represent legitimate encoding choices
  // the v3.26 builder deviates from:
  //
  //   ENCODING-DIFF (decoded-equal):
  //
  //     1) Pattern-Name padding (offset 0x110..0x120):
  //          Real:    "BodyTalk1\x20\x20\x20\x00\x00\x00\x00" (space-then-NUL)
  //          Real:    "Init Pattern\x00\x00\x00\x00"          (NUL-padded)
  //          Builder: "BodyTalk1\x20\x20\x20\x20\x20\x20\x20" (all-space)
  //        Parser trims trailing whitespace+NUL → decoded name identical.
  //
  //     2) Step-Velocity sentinel (per-step byte 1):
  //          Real BodyTalk1: 0xFF (= sentinel "use default 127")
  //          Builder:        0x60 (= explicit 96, builder's no-velocity default)
  //                          or explicit 0..127 when caller sets velocity.
  //        Parser maps 0xFF → 127. Since `projectParsedToBuilderInput`
  //        forwards the parsed velocity (127), the builder writes 127
  //        (not the 0xFF sentinel). Decoded velocity identical.
  //
  //     3) Step-Note on INACTIVE steps (per-step byte 4):
  //          Real Init181: 0x00 (inactive step, note=0)
  //          Real BodyTalk1: 0x48 (inactive step, note=C5)
  //          Builder: always 0x48 (default C5) — parser doesn't expose
  //                   per-step note, so projectParsedToBuilderInput can't
  //                   reproduce the real file's 0x00 vs 0x48 choice.
  //        No parser-visible field is affected.
  //
  //   These tests therefore assert SEMANTIC round-trip (already covered by
  //   tests 1-5) plus document the byte-level drift as an INFO-only metric.
  //   If a future v3.x reduces the drift (e.g. by adopting the 0xFF velocity
  //   sentinel), the recorded upper bounds will tighten naturally.
  //
  //   v3.26 BUILDER BUGS FOUND: NONE. All decoded-field values round-trip
  //   correctly; the byte-level diffs are pure encoding-style choices.

  it("v3.34 Bit-Diff: BodyTalk1 total-drift is BOUNDED-TIGHTER than v3.33", () => {
    // v3.33 baseline: ~5000-7000 total drift. After v3.34 bit-exact-polish
    // (name NUL-pad, 0xFF velocity sentinel, inactive-step note 0x00),
    // BodyTalk1 drift drops to ~1030 total bytes. Remaining drift is in
    // bytes the parser does NOT decode (step accent byte 3, step note
    // byte 4, part-header unknown offsets, post-pattern footer "PTED"
    // marker). NEW v3.34 upper bound: < 1500 total bytes (was ~7000 v3.33).
    const real = loadReal(REAL_FILE_BODYTALK);
    const parsed = parseElectribePattern(real);
    const built = buildE2PatternFile(projectParsedToBuilderInput(parsed));

    const diff = computeByteDiff(built, real);

    // Total drift: post-v3.34 must be < 1500 bytes (was ~7000 v3.33).
    expect(diff.totalDiff, "BodyTalk1 total drift after v3.34").toBeLessThan(1500);

    // CRITICAL: decoded-field drift = bytes the parser actually decodes
    // (trigger, velocity, volume, pan, name, BPM, stepLength). After v3.34
    // this should be near-zero — only the 3 trailing spaces in
    // "BodyTalk1   \x00\x00\x00\x00" the parser strips → builder writes NULs.
    expect(diff.decodedFieldDiff, "BodyTalk1 decoded-field drift after v3.34").toBeLessThan(
      10,
    );
  });

  it("v3.34 Bit-Diff: 181_Init total drift < 200 bytes (close to bit-exact)", () => {
    const real = loadReal(REAL_FILE_INIT_181);
    const parsed = parseElectribePattern(real);
    const built = buildE2PatternFile(projectParsedToBuilderInput(parsed));

    const diff = computeByteDiff(built, real);
    // Init181 has only 4 active steps + uses 0x00 inactive-note convention.
    // After v3.34 polish: total drift ~152 bytes (part-header unknown bytes
    // + post-name header + post-pattern footer). Decoded-field drift = 0.
    expect(diff.totalDiff, "Init181 total drift after v3.34").toBeLessThan(200);
    expect(diff.decodedFieldDiff, "Init181 decoded-field drift after v3.34").toBe(0);
  });

  it("v3.34 Bit-Diff: all 4 real files show TIGHTENED bounded drift", () => {
    // v3.34 ratcheted-down per-file caps. Recorded baselines after v3.34
    // builder fixes (verified manually 2026-05-18):
    //   BodyTalk1: ~1030 total / ~3 decoded (was ~7000 / ~492 in v3.33)
    //   Init181:   ~152 total  / 0 decoded   (was ~5400 / ~1028 in v3.33)
    //   Init250:   bounded (similar shape to BodyTalk1)
    //   Advisory1: bounded
    // Decoded-field caps are now stringent (< 20) — any future regression
    // that adds new decoded-byte drift will trip these. Total caps still
    // allow part-header unknown-byte drift the parser doesn't expose.
    const caps: Record<string, { decoded: number; total: number }> = {
      [REAL_FILE_BODYTALK]: { decoded: 10, total: 1500 },
      [REAL_FILE_INIT_181]: { decoded: 5, total: 200 },
      [REAL_FILE_INIT_250]: { decoded: 20, total: 1500 },
      [REAL_FILE_ADVISORY]: { decoded: 20, total: 1500 },
    };
    for (const name of REAL_FILES) {
      const real = loadReal(name);
      const parsed = parseElectribePattern(real);
      const built = buildE2PatternFile(projectParsedToBuilderInput(parsed));
      const diff = computeByteDiff(built, real);
      expect(diff.decodedFieldDiff, `${name}: decodedFieldDiff`).toBeLessThan(
        caps[name].decoded,
      );
      expect(diff.totalDiff, `${name}: totalDiff`).toBeLessThan(caps[name].total);
    }
  });

  // ─── v3.34: encoding-convention assertions on built output ────────────────

  it("v3.34: Builder output at 0x110 is NUL-padded ab name-length (BodyTalk1)", () => {
    const real = loadReal(REAL_FILE_BODYTALK);
    const parsed = parseElectribePattern(real);
    const built = new Uint8Array(buildE2PatternFile(projectParsedToBuilderInput(parsed)));
    // Real parsed name is "BodyTalk1" (9 chars). v3.34 builder must write
    // 9 ASCII chars + 7 × 0x00 (NOT spaces) into the 16B name field.
    const expected = [0x42, 0x6f, 0x64, 0x79, 0x54, 0x61, 0x6c, 0x6b, 0x31,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    for (let i = 0; i < 16; i++) {
      expect(built[0x110 + i], `name byte ${i}`).toBe(expected[i]);
    }
  });

  it("v3.306: Velocity 127 landet als 0x7F auf Byte 2, NICHT als 0xFF-Sentinel", () => {
    // Vorher hiess dieser Test "Builder writes 0xFF velocity sentinel" und
    // schrieb die Velocity nach Byte 1. Am Geraet gemessen (2026-07-30) liegt
    // die Velocity auf Byte 2 und traegt echte Werte; 0xFF gehoert zum
    // NOTEN-Byte und bedeutet dort "kein neuer Ton".
    const input: E2PatternInput = {
      name: "Test",
      bpm: 120,
      stepLength: 16,
      parts: new Array(16).fill(0).map(() => ({
        steps: new Array(64).fill(0).map(() => ({ active: false } as E2StepInput)),
      })),
    };
    input.parts[0].steps[0] = { active: true, velocity: 127 };
    const built = new Uint8Array(buildE2PatternFile(input));
    // part 0 step 0 record: offset = 0x900 + 0x30 = 0x930.
    expect(built[0x930 + 1]).toBe(0x48); // Note: Vorgabe C5
    expect(built[0x930 + 2]).toBe(0x7f); // Velocity: echter Wert
    const reparsed = parseElectribePattern(built.buffer);
    expect(reparsed.parts[0].steps[0].velocity).toBe(127);
  });

  it("v3.306: 0xFF im Noten-Byte ueberlebt den Round-Trip unveraendert", () => {
    // Werksdateien nutzen das reichlich (BodyTalk: 98x). Ein Klemmen auf 127
    // wuerde aus "kein neuer Ton" eine echte Note machen.
    const input: E2PatternInput = {
      name: "Test",
      bpm: 120,
      stepLength: 16,
      parts: new Array(16).fill(0).map(() => ({
        steps: new Array(64).fill(0).map(() => ({ active: false } as E2StepInput)),
      })),
    };
    input.parts[0].steps[0] = { active: true, velocity: 96, note: 0xff };
    const built = new Uint8Array(buildE2PatternFile(input));
    expect(built[0x930 + 1]).toBe(0xff);
    expect(parseElectribePattern(built.buffer).parts[0].steps[0].note).toBe(0xff);
  });

  it("v3.306: inaktive Steps tragen Note 0x48 und Gate-Länge 0x00", () => {
    const real = loadReal(REAL_FILE_INIT_181);
    const parsed = parseElectribePattern(real);
    const built = new Uint8Array(buildE2PatternFile(projectParsedToBuilderInput(parsed)));
    // Count zero vs non-zero byte-4 values in inactive-step records across
    // all 16 parts × 64 steps.
    let inactiveTotal = 0;
    let inactiveByte4Zero = 0;
    for (let p = 0; p < 16; p++) {
      const partStart = ELECTRIBE_REAL_PARTS_OFFSET + p * ELECTRIBE_REAL_PART_STRIDE;
      const stepBase = partStart + ELECTRIBE_REAL_PART_HEADER_BYTES;
      for (let s = 0; s < ELECTRIBE_REAL_STEPS_PER_PART; s++) {
        const off = stepBase + s * ELECTRIBE_REAL_STEP_RECORD_BYTES;
        const trig = built[off + ELECTRIBE_REAL_STEP_TRIGGER_OFFSET];
        if (trig === 0x00) {
          inactiveTotal++;
          // v3.306: Unter dem korrigierten Layout liegt die Note auf byte 1 und
          // steht in echten Dateien AUCH bei inaktiven Steps auf 0x48; die
          // Gate-Länge (byte 4) ist dort 0x00. Vorher prüfte dieser Test
          // NOTE_OFFSET (damals byte 4) auf 0x00 — nach der Korrektur wäre das
          // die falsche Stelle.
          if (
            built[off + ELECTRIBE_REAL_STEP_NOTE_OFFSET] === 0x48 &&
            built[off + ELECTRIBE_REAL_STEP_GATE_LENGTH_OFFSET] === 0x00
          ) {
            inactiveByte4Zero++;
          }
        }
      }
    }
    // Init181 has 4 active steps total → 16×64 - 4 = 1020 inactive steps.
    expect(inactiveTotal).toBeGreaterThan(1000);
    expect(inactiveByte4Zero, "inaktive Steps mit Note 0x48 + Gate-Länge 0x00").toBe(
      inactiveTotal,
    );
  });

  // ─── 7. Builder produces 16640 bytes for every real input ─────────────────
  it("buildE2PatternFile yields exactly 16640 bytes for every real-file input", () => {
    for (const name of REAL_FILES) {
      const real = loadReal(name);
      const parsed = parseElectribePattern(real);
      const built = buildE2PatternFile(projectParsedToBuilderInput(parsed));
      expect(built.byteLength, `${name}: built byteLength`).toBe(
        ELECTRIBE_REAL_FILE_SIZE,
      );
    }
  });
});
