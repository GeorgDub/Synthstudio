/**
 * tests/features/pattern-fill-transition.test.ts (v3.226)
 *
 * Pure-Coverage for client/src/utils/patternFillTransition.ts.
 * Inputs must never be mutated; detectFillTransitions is deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  detectFillTransitions,
  type FillTransitionResult,
  type FillStepLike,
} from "@/utils/patternFillTransition";

function makeSteps(activeIdx: number[], len = 16): FillStepLike[] {
  return new Array(len).fill(0).map((_, i) => ({
    active: activeIdx.includes(i),
  }));
}

function makeAllTrue(len: number): FillStepLike[] {
  return new Array(len).fill(0).map(() => ({ active: true }));
}

function snapshot(steps: FillStepLike[]): string {
  return JSON.stringify(steps);
}

const DEFAULTS: FillTransitionResult = {
  fillRegions: [],
  lastBarIsFill: false,
  fillIntensity: 0,
  baselineDensity: 0,
};

describe("detectFillTransitions - empty / degenerate", () => {
  it("empty array -> defaults", () => {
    expect(detectFillTransitions([])).toEqual(DEFAULTS);
  });
  it("null cast -> defaults", () => {
    expect(detectFillTransitions(null as unknown as FillStepLike[])).toEqual(DEFAULTS);
  });
  it("undefined cast -> defaults", () => {
    expect(detectFillTransitions(undefined as unknown as FillStepLike[])).toEqual(DEFAULTS);
  });
  it("non-array cast -> defaults", () => {
    expect(detectFillTransitions("nope" as unknown as FillStepLike[])).toEqual(DEFAULTS);
  });
  it("length < 8 -> defaults (length=7)", () => {
    expect(detectFillTransitions(makeSteps([0, 1], 7))).toEqual(DEFAULTS);
  });
  it("length < 8 -> defaults (length=4)", () => {
    expect(detectFillTransitions(makeSteps([0, 1, 2, 3], 4))).toEqual(DEFAULTS);
  });
});

describe("detectFillTransitions - 4-on-the-floor (uniform)", () => {
  it("classic 4-on-floor [0,4,8,12] -> no fill regions", () => {
    const r = detectFillTransitions(makeSteps([0, 4, 8, 12]));
    expect(r.fillRegions).toEqual([]);
    expect(r.lastBarIsFill).toBe(false);
  });
  it("4-on-floor baselineDensity equals 0.25", () => {
    const r = detectFillTransitions(makeSteps([0, 4, 8, 12]));
    expect(r.baselineDensity).toBeCloseTo(0.25, 5);
  });
  it("4-on-floor fillIntensity equals 0", () => {
    expect(detectFillTransitions(makeSteps([0, 4, 8, 12])).fillIntensity).toBe(0);
  });
});

describe("detectFillTransitions - last-bar denser", () => {
  it("sparse front + dense q3 -> lastBarIsFill true", () => {
    const r = detectFillTransitions(makeSteps([0, 4, 8, 12, 13, 14, 15]));
    expect(r.lastBarIsFill).toBe(true);
  });
  it("sparse front + dense q3 -> exactly 1 fill region at q3", () => {
    const r = detectFillTransitions(makeSteps([0, 4, 8, 12, 13, 14, 15]));
    expect(r.fillRegions.length).toBe(1);
    expect(r.fillRegions[0].startStep).toBe(12);
    expect(r.fillRegions[0].endStep).toBe(15);
  });
  it("dense q3 region intensity equals 1.0", () => {
    const r = detectFillTransitions(makeSteps([0, 4, 8, 12, 13, 14, 15]));
    expect(r.fillRegions[0].intensity).toBeCloseTo(1.0, 5);
  });
});

describe("detectFillTransitions - all-true", () => {
  it("all 16 active -> no fill (strict > threshold)", () => {
    const r = detectFillTransitions(makeAllTrue(16));
    expect(r.fillRegions).toEqual([]);
    expect(r.lastBarIsFill).toBe(false);
  });
  it("all-true baselineDensity equals 1.0", () => {
    expect(detectFillTransitions(makeAllTrue(16)).baselineDensity).toBe(1);
  });
  it("all-true fillIntensity equals 0 (empty regions)", () => {
    expect(detectFillTransitions(makeAllTrue(16)).fillIntensity).toBe(0);
  });
});

describe("detectFillTransitions - sparse / low-contrast", () => {
  it("all baseline-only hits (q0..q2 full, q3 empty) -> no fills", () => {
    const r = detectFillTransitions(makeSteps([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(r.fillRegions).toEqual([]);
    expect(r.lastBarIsFill).toBe(false);
  });
  it("baselineDensity equals 1 when first 75% all active", () => {
    const r = detectFillTransitions(makeSteps([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(r.baselineDensity).toBeCloseTo(1.0, 5);
  });
});

describe("detectFillTransitions - single fill in middle (q1)", () => {
  it("dense q1 only -> exactly 1 fill region at q1", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7]));
    expect(r.fillRegions.length).toBe(1);
    expect(r.fillRegions[0].startStep).toBe(4);
    expect(r.fillRegions[0].endStep).toBe(7);
  });
  it("dense q1 only -> lastBarIsFill false", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7]));
    expect(r.lastBarIsFill).toBe(false);
  });
  it("dense q1 only -> region intensity 1.0", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7]));
    expect(r.fillRegions[0].intensity).toBeCloseTo(1.0, 5);
  });
});

describe("detectFillTransitions - multiple fill regions", () => {
  it("dense q1 + q3 -> 2 fill regions", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7, 12, 13, 14, 15]));
    expect(r.fillRegions.length).toBe(2);
  });
  it("dense q1 + q3 -> regions cover [4..7] and [12..15]", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7, 12, 13, 14, 15]));
    expect(r.fillRegions[0].startStep).toBe(4);
    expect(r.fillRegions[0].endStep).toBe(7);
    expect(r.fillRegions[1].startStep).toBe(12);
    expect(r.fillRegions[1].endStep).toBe(15);
  });
  it("dense q1 + q3 -> lastBarIsFill true", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7, 12, 13, 14, 15]));
    expect(r.lastBarIsFill).toBe(true);
  });
});

describe("detectFillTransitions - fill at very end", () => {
  it("only q3 has hits -> q3 qualifies (baseline=0 + any hit)", () => {
    const r = detectFillTransitions(makeSteps([12, 13, 14, 15]));
    expect(r.fillRegions.length).toBe(1);
    expect(r.fillRegions[0].startStep).toBe(12);
    expect(r.fillRegions[0].endStep).toBe(15);
    expect(r.lastBarIsFill).toBe(true);
  });
});

describe("detectFillTransitions - baselineDensity range", () => {
  it("baselineDensity in [0,1] across many patterns", () => {
    const cases: number[][] = [
      [],
      [0],
      [0, 4, 8, 12],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [4, 5, 6, 7],
      [12, 13, 14, 15],
      [0, 1, 2, 3, 4, 5, 6, 7],
    ];
    for (const idx of cases) {
      const r = detectFillTransitions(makeSteps(idx));
      expect(r.baselineDensity).toBeGreaterThanOrEqual(0);
      expect(r.baselineDensity).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.baselineDensity)).toBe(true);
    }
  });
  it("baselineDensity 0 when zero hits in first 75%", () => {
    const r = detectFillTransitions(makeSteps([12, 13, 14, 15]));
    expect(r.baselineDensity).toBe(0);
  });
});

describe("detectFillTransitions - fillIntensity range", () => {
  it("fillIntensity in [0,1] across many patterns", () => {
    const cases: number[][] = [
      [],
      [0, 4, 8, 12],
      [4, 5, 6, 7],
      [12, 13, 14, 15],
      [4, 5, 6, 7, 12, 13, 14, 15],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    ];
    for (const idx of cases) {
      const r = detectFillTransitions(makeSteps(idx));
      expect(r.fillIntensity).toBeGreaterThanOrEqual(0);
      expect(r.fillIntensity).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.fillIntensity)).toBe(true);
    }
  });
  it("fillIntensity equals 0 when no fills detected", () => {
    expect(detectFillTransitions(makeSteps([0, 4, 8, 12])).fillIntensity).toBe(0);
  });
  it("fillIntensity equals 1 when fill region density is 1.0", () => {
    expect(detectFillTransitions(makeSteps([4, 5, 6, 7])).fillIntensity).toBeCloseTo(1, 5);
  });
});

describe("detectFillTransitions - short patterns >= 8", () => {
  it("length 8 with last-quarter dense -> lastBarIsFill true", () => {
    const r = detectFillTransitions(makeSteps([0, 6, 7], 8));
    expect(r.lastBarIsFill).toBe(true);
    expect(r.fillRegions.length).toBeGreaterThanOrEqual(1);
  });
  it("length 8 uniform -> no fill", () => {
    const r = detectFillTransitions(makeSteps([0, 2, 4, 6], 8));
    expect(r.fillRegions).toEqual([]);
    expect(r.lastBarIsFill).toBe(false);
  });
  it("length 8 returns valid baselineDensity", () => {
    const r = detectFillTransitions(makeSteps([0, 2, 4, 6], 8));
    expect(r.baselineDensity).toBeCloseTo(0.5, 5);
  });
});

describe("detectFillTransitions - FillRegion.intensity field", () => {
  it("each region intensity equals quarter-local density", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7]));
    expect(r.fillRegions[0].intensity).toBeCloseTo(1.0, 5);
  });
  it("partial dense quarter intensity reflects density", () => {
    const r = detectFillTransitions(makeSteps([12, 14], 16));
    expect(r.fillRegions.length).toBe(1);
    expect(r.fillRegions[0].intensity).toBeCloseTo(0.5, 5);
  });
});

describe("detectFillTransitions - purity / immutability", () => {
  it("does not mutate input steps", () => {
    const steps = makeSteps([0, 4, 8, 12, 13, 14, 15]);
    const before = snapshot(steps);
    detectFillTransitions(steps);
    detectFillTransitions(steps);
    expect(snapshot(steps)).toBe(before);
  });
  it("deterministic: two calls yield equal result", () => {
    const steps = makeSteps([4, 5, 6, 7, 12, 13, 14, 15]);
    expect(detectFillTransitions(steps)).toEqual(detectFillTransitions(steps));
  });
  it("returns fresh result object each call", () => {
    expect(detectFillTransitions([])).not.toBe(detectFillTransitions([]));
  });
  it("returns fresh fillRegions array (not shared)", () => {
    const a = detectFillTransitions(makeSteps([4, 5, 6, 7]));
    const b = detectFillTransitions(makeSteps([4, 5, 6, 7]));
    expect(a.fillRegions).not.toBe(b.fillRegions);
  });
});

describe("detectFillTransitions - result shape", () => {
  it("returns exactly 4 keys", () => {
    const r = detectFillTransitions([]);
    expect(Object.keys(r).sort()).toEqual([
      "baselineDensity",
      "fillIntensity",
      "fillRegions",
      "lastBarIsFill",
    ]);
  });
  it("fillRegions is array for any input", () => {
    const cases: FillStepLike[][] = [
      [],
      makeSteps([0]),
      makeSteps([0, 4, 8, 12]),
      makeSteps([12, 13, 14, 15]),
      makeAllTrue(16),
    ];
    for (const steps of cases) {
      expect(Array.isArray(detectFillTransitions(steps).fillRegions)).toBe(true);
    }
  });
  it("each FillRegion has 3 keys startStep/endStep/intensity", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7]));
    expect(r.fillRegions.length).toBeGreaterThan(0);
    expect(Object.keys(r.fillRegions[0]).sort()).toEqual([
      "endStep",
      "intensity",
      "startStep",
    ]);
  });
});

describe("detectFillTransitions - edge cases", () => {
  it("steps with non-boolean active treated as falsy", () => {
    const steps: FillStepLike[] = new Array(16).fill(0).map((_, i) => ({
      active: (i === 4 ? "yes" : false) as unknown as boolean,
    }));
    const r = detectFillTransitions(steps);
    expect(r.fillRegions).toEqual([]);
    expect(r.lastBarIsFill).toBe(false);
  });
  it("fill regions are ordered by startStep ascending", () => {
    const r = detectFillTransitions(makeSteps([4, 5, 6, 7, 12, 13, 14, 15]));
    for (let i = 1; i < r.fillRegions.length; i++) {
      expect(r.fillRegions[i].startStep).toBeGreaterThan(r.fillRegions[i - 1].endStep);
    }
  });
  it("length=15 (not divisible by 4) returns finite valid result", () => {
    const r = detectFillTransitions(makeSteps([0, 14], 15));
    expect(Number.isFinite(r.baselineDensity)).toBe(true);
    expect(Number.isFinite(r.fillIntensity)).toBe(true);
    expect(Array.isArray(r.fillRegions)).toBe(true);
  });
});

describe("detectFillTransitions - combinations", () => {
  it("medium baseline + denser-than-1.5x q3 -> fill", () => {
    const r = detectFillTransitions(makeSteps([0, 1, 4, 5, 8, 9, 12, 13, 14, 15]));
    expect(r.fillRegions.length).toBeGreaterThanOrEqual(1);
    const last = r.fillRegions[r.fillRegions.length - 1];
    expect(last.startStep).toBe(12);
    expect(r.lastBarIsFill).toBe(true);
  });
  it("medium baseline + same-density q3 -> NO last-bar fill (strict >)", () => {
    const r = detectFillTransitions(makeSteps([0, 1, 4, 5, 8, 9, 12, 13]));
    expect(r.lastBarIsFill).toBe(false);
  });
});
