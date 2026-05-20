/**
 * tests/features/pattern-syncopation.test.ts (v3.194)
 *
 * Pure-Coverage fuer client/src/utils/patternSyncopation.ts.
 * Foundation fuer Pattern-Analyse-Suite (Style-Klassifikation,
 * Auto-Tagging, "musikalischer Charakter"-Mutator).
 */
import { describe, it, expect } from "vitest";
import {
  analyzeSyncopation,
  type SyncopationOptions,
  type SyncopationResult,
} from "@/utils/patternSyncopation";

// --- Helpers -----------------------------------------------------------------

const ON = true;
const OFF = false;

function mkPattern(activeIdx: readonly number[], length = 16): boolean[] {
  const out = new Array(length).fill(false) as boolean[];
  for (const i of activeIdx) {
    if (i >= 0 && i < length) out[i] = true;
  }
  return out;
}

// --- Tests -------------------------------------------------------------------

describe("analyzeSyncopation - basics", () => {
  it("empty pattern -> score 0, all hits 0", () => {
    const res = analyzeSyncopation([]);
    expect(res.score).toBe(0);
    expect(res.offBeatHits).toBe(0);
    expect(res.downBeatHits).toBe(0);
  });

  it("all-false pattern -> score 0, all hits 0", () => {
    const pattern = new Array(16).fill(false) as boolean[];
    const res = analyzeSyncopation(pattern);
    expect(res.score).toBe(0);
    expect(res.offBeatHits).toBe(0);
    expect(res.downBeatHits).toBe(0);
  });

  it("single hit at downbeat (step 0) -> score 0, downBeatHits=1, offBeatHits=0", () => {
    const pattern = mkPattern([0]);
    const res = analyzeSyncopation(pattern);
    expect(res.score).toBe(0);
    expect(res.downBeatHits).toBe(1);
    expect(res.offBeatHits).toBe(0);
  });
});

describe("analyzeSyncopation - 4-on-the-floor", () => {
  it("kick on 0/4/8/12 -> low syncopation (weights 0+1+1+1)/12 = 0.25", () => {
    const pattern = mkPattern([0, 4, 8, 12]);
    const res = analyzeSyncopation(pattern);
    expect(res.score).toBeLessThan(0.3);
    expect(res.score).toBeCloseTo(0.25, 5);
    expect(res.downBeatHits).toBe(1);
    expect(res.offBeatHits).toBe(0);
  });
});

describe("analyzeSyncopation - off-beat hits", () => {
  it("all off-beats (steps 2/6/10/14) -> score >= 0.5", () => {
    const pattern = mkPattern([2, 6, 10, 14]);
    const res = analyzeSyncopation(pattern);
    expect(res.score).toBeGreaterThanOrEqual(0.5);
    expect(res.score).toBeCloseTo(8 / 12, 5);
    expect(res.downBeatHits).toBe(0);
    expect(res.offBeatHits).toBe(4);
  });
});

describe("analyzeSyncopation - sub-divisions", () => {
  it("all sub-divisions (steps 1/3/5/7/9/11/13/15) -> score = 1 (max)", () => {
    const pattern = mkPattern([1, 3, 5, 7, 9, 11, 13, 15]);
    const res = analyzeSyncopation(pattern);
    expect(res.score).toBeCloseTo(1.0, 5);
    expect(res.downBeatHits).toBe(0);
    expect(res.offBeatHits).toBe(8);
  });
});

describe("analyzeSyncopation - hit counts", () => {
  it("downBeatHits + offBeatHits counts on mixed pattern", () => {
    const pattern = mkPattern([0, 4, 6, 11]);
    const res = analyzeSyncopation(pattern);
    expect(res.downBeatHits).toBe(1);
    expect(res.offBeatHits).toBe(2);
    expect(res.score).toBeCloseTo(0.5, 5);
  });

  it("downBeatHits is STRICT at step 0 only - not other bar-downbeats", () => {
    const pattern = mkPattern([0, 16], 32);
    const res = analyzeSyncopation(pattern);
    expect(res.downBeatHits).toBe(1);
    expect(res.offBeatHits).toBe(0);
    expect(res.score).toBe(0);
  });
});

describe("analyzeSyncopation - custom options", () => {
  it("stepsPerBeat=8 changes metric granularity", () => {
    const pattern = mkPattern([0, 8, 4, 2], 32);
    const res = analyzeSyncopation(pattern, { stepsPerBeat: 8 });
    expect(res.score).toBeCloseTo(0.5, 5);
    expect(res.downBeatHits).toBe(1);
    expect(res.offBeatHits).toBe(2);
  });

  it("beatsPerBar=2 changes bar length", () => {
    const pattern = mkPattern([0, 8]);
    const res = analyzeSyncopation(pattern, { beatsPerBar: 2 });
    expect(res.score).toBe(0);
    expect(res.downBeatHits).toBe(1);
    expect(res.offBeatHits).toBe(0);
  });
});

describe("analyzeSyncopation - bounds", () => {
  it("score always in [0, 1] across many random-ish patterns", () => {
    const cases: ReadonlyArray<readonly boolean[]> = [
      mkPattern([]),
      mkPattern([0]),
      mkPattern([0, 4, 8, 12]),
      mkPattern([1, 3, 5, 7, 9, 11, 13, 15]),
      mkPattern([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
      mkPattern([2, 6, 10, 14]),
      mkPattern([0, 2, 4, 6]),
      mkPattern([5, 7, 11]),
    ];
    for (const p of cases) {
      const res = analyzeSyncopation(p);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(1);
    }
  });

  it("all-true 16-step pattern gives mixed score in (0, 1)", () => {
    const pattern = new Array(16).fill(true) as boolean[];
    const res = analyzeSyncopation(pattern);
    expect(res.score).toBeGreaterThan(0);
    expect(res.score).toBeLessThan(1);
    expect(res.score).toBeCloseTo(35 / 48, 5);
    expect(res.downBeatHits).toBe(1);
    expect(res.offBeatHits).toBe(12);
  });
});

describe("analyzeSyncopation - defensive defaults", () => {
  it("stepsPerBeat <= 0 falls back to 4", () => {
    const pattern = mkPattern([0, 4, 8, 12]);
    const res = analyzeSyncopation(pattern, { stepsPerBeat: 0 });
    const expected = analyzeSyncopation(pattern);
    expect(res.score).toBeCloseTo(expected.score, 10);
    expect(res.downBeatHits).toBe(expected.downBeatHits);
    expect(res.offBeatHits).toBe(expected.offBeatHits);
  });

  it("stepsPerBeat NaN / Infinity -> default 4", () => {
    const pattern = mkPattern([0, 4, 8, 12]);
    const resNaN = analyzeSyncopation(pattern, { stepsPerBeat: NaN });
    const resInf = analyzeSyncopation(pattern, { stepsPerBeat: Infinity });
    const expected = analyzeSyncopation(pattern);
    expect(resNaN.score).toBeCloseTo(expected.score, 10);
    expect(resInf.score).toBeCloseTo(expected.score, 10);
  });

  it("beatsPerBar <= 0 / NaN falls back to 4", () => {
    const pattern = mkPattern([0, 4, 8, 12]);
    const res0 = analyzeSyncopation(pattern, { beatsPerBar: 0 });
    const resNeg = analyzeSyncopation(pattern, { beatsPerBar: -2 });
    const resNaN = analyzeSyncopation(pattern, { beatsPerBar: NaN });
    const expected = analyzeSyncopation(pattern);
    expect(res0.score).toBeCloseTo(expected.score, 10);
    expect(resNeg.score).toBeCloseTo(expected.score, 10);
    expect(resNaN.score).toBeCloseTo(expected.score, 10);
  });

  it("does not mutate input pattern", () => {
    const original = mkPattern([0, 5, 11]);
    const snapshot = [...original];
    analyzeSyncopation(original, { stepsPerBeat: 4, beatsPerBar: 4 });
    expect(original).toEqual(snapshot);
  });
});

describe("analyzeSyncopation - result shape", () => {
  it("returns SyncopationResult with score/offBeatHits/downBeatHits keys", () => {
    const res: SyncopationResult = analyzeSyncopation([ON, OFF, ON, OFF]);
    expect(typeof res.score).toBe("number");
    expect(typeof res.offBeatHits).toBe("number");
    expect(typeof res.downBeatHits).toBe("number");
    expect(Number.isFinite(res.score)).toBe(true);
  });

  it("SyncopationOptions type compiles with partial fields", () => {
    const opts1: SyncopationOptions = {};
    const opts2: SyncopationOptions = { stepsPerBeat: 4 };
    const opts3: SyncopationOptions = { beatsPerBar: 3 };
    const opts4: SyncopationOptions = { stepsPerBeat: 8, beatsPerBar: 2 };
    expect(analyzeSyncopation([], opts1).score).toBe(0);
    expect(analyzeSyncopation([], opts2).score).toBe(0);
    expect(analyzeSyncopation([], opts3).score).toBe(0);
    expect(analyzeSyncopation([], opts4).score).toBe(0);
  });
});
