/**
 * tests/features/pattern-rhythm-rotate.test.ts (v3.192)
 *
 * Pure-Coverage fuer client/src/utils/patternRhythmRotate.ts.
 * Alle Funktionen muessen NEUE Arrays liefern, Input unveraendert lassen.
 */
import { describe, it, expect } from "vitest";
import {
  rotatePatternByBeats,
  rotateWithinBeats,
  ROTATE_PRESETS,
  type RhythmRotateOptions,
} from "@/utils/patternRhythmRotate";

// ─── rotatePatternByBeats ────────────────────────────────────────────────────

describe("rotatePatternByBeats", () => {
  it("empty input returns []", () => {
    expect(rotatePatternByBeats([])).toEqual([]);
    expect(rotatePatternByBeats([], { beats: 5, stepsPerBeat: 4 })).toEqual([]);
  });

  it("defaults stepsPerBeat=4 beats=1 on symmetric 4-on-the-floor stays same", () => {
    const input = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const out = rotatePatternByBeats(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("asymmetric pattern: 1 beat right rotation shifts by stepsPerBeat", () => {
    const input = [
      true,  false, false, false,
      false, false, false, false,
      false, false, false, false,
      false, false, false, false,
    ];
    const out = rotatePatternByBeats(input, { stepsPerBeat: 4, beats: 1 });
    const expected = [
      false, false, false, false,
      true,  false, false, false,
      false, false, false, false,
      false, false, false, false,
    ];
    expect(out).toEqual(expected);
  });

  it("beats negative does left rotation", () => {
    const input = [
      true,  false, false, false,
      false, false, false, false,
      false, false, false, false,
      false, false, false, false,
    ];
    const out = rotatePatternByBeats(input, { stepsPerBeat: 4, beats: -1 });
    const expected = [
      false, false, false, false,
      false, false, false, false,
      false, false, false, false,
      true,  false, false, false,
    ];
    expect(out).toEqual(expected);
  });

  it("beats overflow wraps modulo length", () => {
    const input = [true, false, false, false];
    const out = rotatePatternByBeats(input, { stepsPerBeat: 4, beats: 2 });
    expect(out).toEqual([true, false, false, false]);
    expect(out).not.toBe(input);
  });

  it("input remains unchanged (immutability)", () => {
    const input = [true, false, true, false, true, false, true, false];
    const snapshot = [...input];
    rotatePatternByBeats(input, { stepsPerBeat: 2, beats: 1 });
    expect(input).toEqual(snapshot);
  });

  it("defensive: stepsPerBeat <= 0 falls back to 4", () => {
    const input = [
      true,  false, false, false,
      false, false, false, false,
    ];
    const outZero = rotatePatternByBeats(input, { stepsPerBeat: 0, beats: 1 });
    const outNeg = rotatePatternByBeats(input, { stepsPerBeat: -3, beats: 1 });
    const expected = [
      false, false, false, false,
      true,  false, false, false,
    ];
    expect(outZero).toEqual(expected);
    expect(outNeg).toEqual(expected);
  });

  it("defensive: beats NaN falls back to 1", () => {
    const input = [
      true,  false, false, false,
      false, false, false, false,
    ];
    const out = rotatePatternByBeats(input, {
      stepsPerBeat: 4,
      beats: Number.NaN,
    });
    expect(out).toEqual([
      false, false, false, false,
      true,  false, false, false,
    ]);
  });

  it("defensive: stepsPerBeat Infinity falls back to 4", () => {
    const input = [
      true,  false, false, false,
      false, false, false, false,
    ];
    const out = rotatePatternByBeats(input, {
      stepsPerBeat: Number.POSITIVE_INFINITY,
      beats: 1,
    });
    expect(out).toEqual([
      false, false, false, false,
      true,  false, false, false,
    ]);
  });

  it("custom stepsPerBeat=2: 1 beat equals 2 steps", () => {
    const input = [true, false, false, false, false, false, false, false];
    const out = rotatePatternByBeats(input, { stepsPerBeat: 2, beats: 1 });
    expect(out).toEqual([false, false, true, false, false, false, false, false]);
  });
});

// ─── rotateWithinBeats ───────────────────────────────────────────────────────

describe("rotateWithinBeats", () => {
  it("empty input returns []", () => {
    expect(rotateWithinBeats([])).toEqual([]);
  });

  it("16-step canonical: hits on first step of each group move to position 1 within group", () => {
    const input = [
      true,  false, false, false,
      true,  false, false, false,
      true,  false, false, false,
      true,  false, false, false,
    ];
    const out = rotateWithinBeats(input, { stepsPerBeat: 4, beats: 1 });
    expect(out).toEqual([
      false, true,  false, false,
      false, true,  false, false,
      false, true,  false, false,
      false, true,  false, false,
    ]);
  });

  it("group order is preserved (no inter-group migration)", () => {
    const input = [
      true,  false, false, false,
      false, true,  false, false,
      false, false, true,  false,
      false, false, false, true,
    ];
    const out = rotateWithinBeats(input, { stepsPerBeat: 4, beats: 1 });
    expect(out).toEqual([
      false, true,  false, false,
      false, false, true,  false,
      false, false, false, true,
      true,  false, false, false,
    ]);
  });

  it("negative beats causes left rotation per group", () => {
    const input = [
      true,  false, false, false,
      true,  false, false, false,
    ];
    const out = rotateWithinBeats(input, { stepsPerBeat: 4, beats: -1 });
    expect(out).toEqual([
      false, false, false, true,
      false, false, false, true,
    ]);
  });

  it("trailing partial group: 6 steps with stepsPerBeat=4", () => {
    const input = [true, false, false, false, true, false];
    const out = rotateWithinBeats(input, { stepsPerBeat: 4, beats: 1 });
    expect(out).toEqual([false, true, false, false, false, true]);
  });

  it("input remains unchanged (immutability)", () => {
    const input = [true, false, true, false, true, false, true, false];
    const snapshot = [...input];
    rotateWithinBeats(input, { stepsPerBeat: 4, beats: 1 });
    expect(input).toEqual(snapshot);
  });

  it("defensive: NaN beats falls back to 1", () => {
    const input = [
      true,  false, false, false,
      true,  false, false, false,
    ];
    const out = rotateWithinBeats(input, {
      stepsPerBeat: 4,
      beats: Number.NaN,
    });
    expect(out).toEqual([
      false, true, false, false,
      false, true, false, false,
    ]);
  });

  it("defensive: stepsPerBeat <= 0 falls back to 4", () => {
    const input = [
      true,  false, false, false,
      true,  false, false, false,
    ];
    const out = rotateWithinBeats(input, { stepsPerBeat: 0, beats: 1 });
    expect(out).toEqual([
      false, true, false, false,
      false, true, false, false,
    ]);
  });
});

// ─── ROTATE_PRESETS ──────────────────────────────────────────────────────────

describe("ROTATE_PRESETS", () => {
  it("has exactly 4 presets", () => {
    expect(ROTATE_PRESETS.length).toBe(4);
  });

  it("all presets have unique IDs", () => {
    const ids = ROTATE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains one-beat-fwd / one-beat-bwd / half-bar / within-beat", () => {
    const ids = ROTATE_PRESETS.map((p) => p.id);
    expect(ids).toContain("one-beat-fwd");
    expect(ids).toContain("one-beat-bwd");
    expect(ids).toContain("half-bar");
    expect(ids).toContain("within-beat");
  });

  it("all presets have stepsPerBeat=4 (classic 1/16)", () => {
    for (const p of ROTATE_PRESETS) {
      expect(p.stepsPerBeat).toBe(4);
    }
  });

  it("+1 Beat preset rotates a 16-step pattern correctly", () => {
    const preset = ROTATE_PRESETS.find((p) => p.id === "one-beat-fwd");
    expect(preset).toBeDefined();
    const opts: RhythmRotateOptions = {
      stepsPerBeat: preset!.stepsPerBeat,
      beats: preset!.beats,
    };
    const input = [
      true,  false, false, false,
      false, false, false, false,
      false, false, false, false,
      false, false, false, false,
    ];
    const out = rotatePatternByBeats(input, opts);
    expect(out[4]).toBe(true);
    expect(out[0]).toBe(false);
  });
});
