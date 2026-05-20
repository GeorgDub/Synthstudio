/**
 * tests/features/pattern-tension.test.ts - v3.208
 *
 * Pure-Coverage fuer client/src/utils/patternTension.ts.
 * Foundation fuer Drumming-Tension-Maess + Pattern-Analyse-Suite
 * (Style-Klassifikation, Auto-Tagging, Tension-basierter Mutator).
 */
import { describe, it, expect } from "vitest";
import {
  computeTension,
  offBeatRatio,
  velocitySpread,
  type TensionFactors,
  type TensionStepLike,
} from "@/utils/patternTension";

// --- Helpers ---------------------------------------------------------------

function mkSteps(activeIdx: readonly number[], len = 16): TensionStepLike[] {
  const out: TensionStepLike[] = [];
  for (let i = 0; i < len; i++) {
    out.push({ active: activeIdx.includes(i) });
  }
  return out;
}

function mkStepsWithVel(
  spec: readonly { i: number; v: number | undefined }[],
  len = 16,
): TensionStepLike[] {
  const out: TensionStepLike[] = [];
  for (let i = 0; i < len; i++) {
    out.push({ active: false });
  }
  for (const s of spec) {
    if (s.i >= 0 && s.i < len) {
      out[s.i] = { active: true, velocity: s.v };
    }
  }
  return out;
}

// =============================================================================
// computeTension - empty / degenerate
// =============================================================================

describe("computeTension - empty / degenerate", () => {
  it("empty array -> all factors 0", () => {
    const r = computeTension([]);
    expect(r.offBeatScore).toBe(0);
    expect(r.velocityVariance).toBe(0);
    expect(r.syncopationScore).toBe(0);
    expect(r.overallTension).toBe(0);
  });

  it("all-inactive steps -> all factors 0", () => {
    const r = computeTension(mkSteps([], 16));
    expect(r.offBeatScore).toBe(0);
    expect(r.velocityVariance).toBe(0);
    expect(r.syncopationScore).toBe(0);
    expect(r.overallTension).toBe(0);
  });

  it("single hit on downbeat (step 0) -> all factors 0", () => {
    const r = computeTension(mkSteps([0]));
    expect(r.offBeatScore).toBe(0);
    expect(r.velocityVariance).toBe(0);
    expect(r.syncopationScore).toBe(0);
    expect(r.overallTension).toBe(0);
  });

  it("single off-beat hit -> non-zero off + sync, zero vel", () => {
    const r = computeTension(mkSteps([1]), 4);
    expect(r.offBeatScore).toBe(1);
    expect(r.velocityVariance).toBe(0);
    expect(r.syncopationScore).toBeGreaterThan(0);
    expect(r.overallTension).toBeGreaterThan(0);
  });
});

// =============================================================================
// computeTension - 4-on-the-floor (lowest tension baseline)
// =============================================================================

describe("computeTension - 4-on-the-floor", () => {
  it("kick on 0/4/8/12 -> offBeatScore=0, syncopationScore=0", () => {
    const r = computeTension(mkSteps([0, 4, 8, 12]), 4);
    expect(r.offBeatScore).toBe(0);
    expect(r.syncopationScore).toBe(0);
    expect(r.velocityVariance).toBe(0);
    expect(r.overallTension).toBe(0);
  });

  it("4-on-the-floor with explicit uniform velocity -> tension stays 0", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: 0.8 },
        { i: 4, v: 0.8 },
        { i: 8, v: 0.8 },
        { i: 12, v: 0.8 },
      ],
      16,
    );
    const r = computeTension(steps, 4);
    expect(r.offBeatScore).toBe(0);
    expect(r.syncopationScore).toBe(0);
    expect(r.velocityVariance).toBe(0);
    expect(r.overallTension).toBe(0);
  });
});

// =============================================================================
// computeTension - off-beat hits
// =============================================================================

describe("computeTension - off-beat hits", () => {
  it("pure off-beat hits (steps 1/5/9/13) -> offBeatScore=1", () => {
    const r = computeTension(mkSteps([1, 5, 9, 13]), 4);
    expect(r.offBeatScore).toBe(1);
    expect(r.syncopationScore).toBeCloseTo(0.5, 5);
  });

  it("syncopation hits between strong beats (steps 2/6/10/14) -> sync=1, off=1", () => {
    const r = computeTension(mkSteps([2, 6, 10, 14]), 4);
    expect(r.offBeatScore).toBe(1);
    expect(r.syncopationScore).toBeCloseTo(1, 5);
    expect(r.overallTension).toBeGreaterThanOrEqual(0.7);
  });

  it("mixed strong+off (0,2,4,6 / spb=4) -> half off-beat", () => {
    const r = computeTension(mkSteps([0, 2, 4, 6]), 4);
    expect(r.offBeatScore).toBeCloseTo(0.5, 5);
    expect(r.syncopationScore).toBeCloseTo(0.5, 5);
  });
});

// =============================================================================
// computeTension - velocity dynamics
// =============================================================================

describe("computeTension - velocity dynamics", () => {
  it("uniform velocity -> velocityVariance ~ 0", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: 0.5 },
        { i: 4, v: 0.5 },
        { i: 8, v: 0.5 },
        { i: 12, v: 0.5 },
      ],
      16,
    );
    const r = computeTension(steps);
    expect(r.velocityVariance).toBeCloseTo(0, 6);
  });

  it("wide velocity spread -> velocityVariance > 0.3", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: 0.1 },
        { i: 4, v: 1.0 },
        { i: 8, v: 0.2 },
        { i: 12, v: 0.9 },
      ],
      16,
    );
    const r = computeTension(steps);
    expect(r.velocityVariance).toBeGreaterThan(0.3);
    expect(r.velocityVariance).toBeLessThanOrEqual(1);
  });

  it("velocity undefined -> treated as 1.0 (uniform => variance 0)", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: undefined },
        { i: 4, v: undefined },
        { i: 8, v: undefined },
      ],
      16,
    );
    const r = computeTension(steps);
    expect(r.velocityVariance).toBe(0);
  });

  it("NaN velocity -> treated as 1.0", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: NaN },
        { i: 4, v: NaN },
        { i: 8, v: 1.0 },
      ],
      16,
    );
    const r = computeTension(steps);
    expect(r.velocityVariance).toBe(0);
  });

  it("Infinity velocity -> treated as 1.0", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: Infinity },
        { i: 4, v: 1 },
      ],
      16,
    );
    const r = computeTension(steps);
    expect(r.velocityVariance).toBe(0);
    expect(Number.isFinite(r.overallTension)).toBe(true);
  });

  it("all-zero velocities -> velocityVariance=0 (no div-by-zero)", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: 0 },
        { i: 4, v: 0 },
        { i: 8, v: 0 },
      ],
      16,
    );
    const r = computeTension(steps);
    expect(r.velocityVariance).toBe(0);
    expect(Number.isFinite(r.overallTension)).toBe(true);
  });

  it("single hit -> velocityVariance always 0", () => {
    const steps = mkStepsWithVel([{ i: 3, v: 0.7 }], 16);
    const r = computeTension(steps);
    expect(r.velocityVariance).toBe(0);
  });
});

// =============================================================================
// computeTension - stepsPerBeat parameter
// =============================================================================

describe("computeTension - stepsPerBeat variations", () => {
  it("stepsPerBeat=1 -> every step is a strong beat -> offBeat=0", () => {
    const r = computeTension(mkSteps([0, 1, 2, 3], 4), 1);
    expect(r.offBeatScore).toBe(0);
    expect(r.syncopationScore).toBe(0);
  });

  it("stepsPerBeat=2 -> only even steps are strong", () => {
    const r = computeTension(mkSteps([0, 1, 2, 3], 4), 2);
    expect(r.offBeatScore).toBeCloseTo(0.5, 5);
  });

  it("stepsPerBeat=4 (default) -> step 4 strong, step 1/2/3 off", () => {
    const r = computeTension(mkSteps([0, 1, 2, 3], 4), 4);
    expect(r.offBeatScore).toBeCloseTo(3 / 4, 5);
  });

  it("stepsPerBeat=8 -> finer grid", () => {
    const r = computeTension(mkSteps([0, 8, 16], 24), 8);
    expect(r.offBeatScore).toBe(0);
    expect(r.syncopationScore).toBe(0);
  });

  it("stepsPerBeat=0 -> default 4", () => {
    const r = computeTension(mkSteps([0, 4, 8, 12]), 0);
    expect(r.offBeatScore).toBe(0);
  });

  it("stepsPerBeat=NaN -> default 4", () => {
    const r = computeTension(mkSteps([0, 4, 8, 12]), NaN);
    expect(r.offBeatScore).toBe(0);
    expect(r.syncopationScore).toBe(0);
  });

  it("stepsPerBeat=-3 -> default 4", () => {
    const r = computeTension(mkSteps([1, 5, 9, 13]), -3);
    expect(r.offBeatScore).toBe(1);
  });

  it("stepsPerBeat=4.7 -> floored to 4", () => {
    const r = computeTension(mkSteps([0, 4, 8, 12]), 4.7);
    expect(r.offBeatScore).toBe(0);
  });

  it("stepsPerBeat=Infinity -> default 4", () => {
    const r = computeTension(mkSteps([0, 4, 8, 12]), Infinity);
    expect(r.offBeatScore).toBe(0);
  });

  it("stepsPerBeat undefined -> default 4", () => {
    const r = computeTension(mkSteps([0, 4, 8, 12]), undefined);
    expect(r.offBeatScore).toBe(0);
  });
});

// =============================================================================
// computeTension - overallTension bounds + composition
// =============================================================================

describe("computeTension - overallTension bounds", () => {
  it("overallTension always in 0..1 (random-ish pattern)", () => {
    const steps = mkStepsWithVel(
      [
        { i: 1, v: 0.2 },
        { i: 3, v: 0.9 },
        { i: 6, v: 0.4 },
        { i: 10, v: 1.0 },
        { i: 14, v: 0.1 },
      ],
      16,
    );
    const r = computeTension(steps);
    expect(r.overallTension).toBeGreaterThanOrEqual(0);
    expect(r.overallTension).toBeLessThanOrEqual(1);
    expect(r.offBeatScore).toBeGreaterThanOrEqual(0);
    expect(r.offBeatScore).toBeLessThanOrEqual(1);
    expect(r.velocityVariance).toBeGreaterThanOrEqual(0);
    expect(r.velocityVariance).toBeLessThanOrEqual(1);
    expect(r.syncopationScore).toBeGreaterThanOrEqual(0);
    expect(r.syncopationScore).toBeLessThanOrEqual(1);
  });

  it("max-tension scenario -> overallTension close to 1", () => {
    const steps = mkStepsWithVel(
      [
        { i: 2, v: 0.01 },
        { i: 6, v: 1.0 },
        { i: 10, v: 0.01 },
        { i: 14, v: 1.0 },
      ],
      16,
    );
    const r = computeTension(steps, 4);
    expect(r.offBeatScore).toBe(1);
    expect(r.syncopationScore).toBeCloseTo(1, 5);
    expect(r.velocityVariance).toBeGreaterThan(0.5);
    expect(r.overallTension).toBeGreaterThan(0.85);
  });

  it("min-tension scenario -> overallTension = 0", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: 0.7 },
        { i: 4, v: 0.7 },
        { i: 8, v: 0.7 },
        { i: 12, v: 0.7 },
      ],
      16,
    );
    const r = computeTension(steps, 4);
    expect(r.overallTension).toBe(0);
  });

  it("weight verification: overall = 0.4*off + 0.3*vel + 0.3*sync", () => {
    const steps = mkStepsWithVel(
      [
        { i: 2, v: 0.5 },
        { i: 6, v: 0.5 },
        { i: 10, v: 0.5 },
        { i: 14, v: 0.5 },
      ],
      16,
    );
    const r = computeTension(steps, 4);
    expect(r.offBeatScore).toBe(1);
    expect(r.velocityVariance).toBe(0);
    expect(r.syncopationScore).toBeCloseTo(1, 5);
    expect(r.overallTension).toBeCloseTo(0.7, 5);
  });
});

// =============================================================================
// computeTension - immutability + structural guarantees
// =============================================================================

describe("computeTension - immutability + structure", () => {
  it("input array not mutated", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: 0.5 },
        { i: 5, v: 0.8 },
      ],
      16,
    );
    const snapshot = steps.map((s) => ({ ...s }));
    computeTension(steps, 4);
    expect(steps).toEqual(snapshot);
  });

  it("result always has the four documented keys", () => {
    const r = computeTension(mkSteps([0, 3, 8]), 4);
    expect(Object.keys(r).sort()).toEqual(
      ["offBeatScore", "overallTension", "syncopationScore", "velocityVariance"].sort(),
    );
  });

  it("readonly input is accepted (compile-time check via cast)", () => {
    const steps: readonly TensionStepLike[] = mkSteps([0, 4]);
    const r: TensionFactors = computeTension(steps);
    expect(r.overallTension).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// offBeatRatio helper
// =============================================================================

describe("offBeatRatio helper", () => {
  it("empty -> 0", () => {
    expect(offBeatRatio([])).toBe(0);
  });

  it("no active hits -> 0", () => {
    expect(offBeatRatio(mkSteps([], 16))).toBe(0);
  });

  it("4-on-the-floor (0,4,8,12, spb=4) -> 0", () => {
    expect(offBeatRatio(mkSteps([0, 4, 8, 12]), 4)).toBe(0);
  });

  it("all off-beats (1,5,9,13) -> 1", () => {
    expect(offBeatRatio(mkSteps([1, 5, 9, 13]), 4)).toBe(1);
  });

  it("mixed -> ratio", () => {
    expect(offBeatRatio(mkSteps([0, 1, 4, 5]), 4)).toBeCloseTo(0.5, 5);
  });

  it("stepsPerBeat=undefined -> default 4", () => {
    expect(offBeatRatio(mkSteps([1, 2, 3]))).toBe(1);
  });

  it("stepsPerBeat=0 -> coerced to 4", () => {
    expect(offBeatRatio(mkSteps([0, 4, 8, 12]), 0)).toBe(0);
  });
});

// =============================================================================
// velocitySpread helper
// =============================================================================

describe("velocitySpread helper", () => {
  it("empty -> 0", () => {
    expect(velocitySpread([])).toBe(0);
  });

  it("no active hits -> 0", () => {
    expect(velocitySpread(mkSteps([], 16))).toBe(0);
  });

  it("single hit -> 0", () => {
    expect(velocitySpread(mkStepsWithVel([{ i: 0, v: 0.5 }]))).toBe(0);
  });

  it("uniform velocities -> 0", () => {
    const s = mkStepsWithVel([
      { i: 0, v: 0.5 },
      { i: 4, v: 0.5 },
      { i: 8, v: 0.5 },
    ]);
    expect(velocitySpread(s)).toBeCloseTo(0, 6);
  });

  it("wide spread -> high (> 0.3)", () => {
    const s = mkStepsWithVel([
      { i: 0, v: 0.05 },
      { i: 4, v: 1.0 },
      { i: 8, v: 0.1 },
    ]);
    expect(velocitySpread(s)).toBeGreaterThan(0.3);
  });

  it("all zero velocities -> 0 (no div-by-zero)", () => {
    const s = mkStepsWithVel([
      { i: 0, v: 0 },
      { i: 4, v: 0 },
    ]);
    expect(velocitySpread(s)).toBe(0);
  });

  it("NaN velocities normalized to 1.0", () => {
    const s = mkStepsWithVel([
      { i: 0, v: NaN },
      { i: 4, v: 1 },
      { i: 8, v: NaN },
    ]);
    expect(velocitySpread(s)).toBe(0);
  });

  it("clamped to <= 1", () => {
    const s = mkStepsWithVel([
      { i: 0, v: 0.001 },
      { i: 4, v: 2.0 },
      { i: 8, v: 0.001 },
    ]);
    const v = velocitySpread(s);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
