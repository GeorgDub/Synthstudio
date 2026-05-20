/**
 * tests/features/pattern-complexity-sum.test.ts - v3.219
 *
 * Pure-Coverage for client/src/utils/patternComplexitySum.ts.
 *
 * Spec pinned via tests:
 *   - Pin 1: default weights {density:0.2, entropy:0.25,
 *             syncopation:0.2, pulseCount:0.1,
 *             symmetryScore:0.1 inv, repetitionScore:0.15 inv}.
 *   - Pin 2: symmetryScore and repetitionScore inverted (1 - x).
 *   - Pin 3: total = sum(contrib) / sum(weight_present).
 *   - Pin 4: NaN/Inf treated as undefined; values clamped [0..1].
 *   - Pin 5: dominantComponent = max(score*weight), ties first in
 *             COMPONENT_ORDER.
 *   - Pin 6: buildComponentBreakdown returns 6 entries always.
 *   - Pin 7: pulseCount is 0..1.
 *   - Pin 8: components contains only present fields.
 */
import { describe, it, expect } from "vitest";
import {
  computeComplexitySum,
  buildComponentBreakdown,
  type ComplexitySumInput,
  type ComplexityComponent,
} from "@/utils/patternComplexitySum";

describe("computeComplexitySum - empty / degenerate", () => {
  it("empty input -> total=0, components=[], dominant empty", () => {
    const r = computeComplexitySum({});
    expect(r.totalComplexity).toBe(0);
    expect(r.components).toEqual([]);
    expect(r.dominantComponent).toBe("");
  });

  it("null input -> total=0", () => {
    const r = computeComplexitySum(null);
    expect(r.totalComplexity).toBe(0);
    expect(r.components).toEqual([]);
    expect(r.dominantComponent).toBe("");
  });

  it("undefined input -> total=0", () => {
    const r = computeComplexitySum(undefined);
    expect(r.totalComplexity).toBe(0);
    expect(r.components).toEqual([]);
  });

  it("all-undefined fields -> like empty", () => {
    const r = computeComplexitySum({
      density: undefined,
      entropy: undefined,
      syncopation: undefined,
      pulseCount: undefined,
      symmetryScore: undefined,
      repetitionScore: undefined,
    });
    expect(r.totalComplexity).toBe(0);
    expect(r.components).toEqual([]);
  });
});

describe("computeComplexitySum - all 6 inputs", () => {
  it("all 0.5 -> total = 0.5 (Pin 1 + Pin 2)", () => {
    const r = computeComplexitySum({
      density: 0.5,
      entropy: 0.5,
      syncopation: 0.5,
      pulseCount: 0.5,
      symmetryScore: 0.5,
      repetitionScore: 0.5,
    });
    expect(r.totalComplexity).toBeCloseTo(0.5, 6);
    expect(r.components).toHaveLength(6);
  });

  it("all 1 -> total = 0.75 (sym/rep gate down)", () => {
    const r = computeComplexitySum({
      density: 1,
      entropy: 1,
      syncopation: 1,
      pulseCount: 1,
      symmetryScore: 1,
      repetitionScore: 1,
    });
    expect(r.totalComplexity).toBeCloseTo(0.75, 6);
  });

  it("all 0 -> total = 0.25 (inverted contribute max)", () => {
    const r = computeComplexitySum({
      density: 0,
      entropy: 0,
      syncopation: 0,
      pulseCount: 0,
      symmetryScore: 0,
      repetitionScore: 0,
    });
    expect(r.totalComplexity).toBeCloseTo(0.25, 6);
  });
});

describe("computeComplexitySum - only-density (Pin 3)", () => {
  it("only density=0.7 -> total = 0.7", () => {
    const r = computeComplexitySum({ density: 0.7 });
    expect(r.totalComplexity).toBeCloseTo(0.7, 6);
    expect(r.components).toHaveLength(1);
    expect(r.components[0]).toEqual({
      name: "density",
      score: 0.7,
      weight: 0.2,
    });
    expect(r.dominantComponent).toBe("density");
  });

  it("only entropy=0.4 -> total = 0.4", () => {
    const r = computeComplexitySum({ entropy: 0.4 });
    expect(r.totalComplexity).toBeCloseTo(0.4, 6);
  });

  it("only syncopation=0.9 -> total = 0.9", () => {
    const r = computeComplexitySum({ syncopation: 0.9 });
    expect(r.totalComplexity).toBeCloseTo(0.9, 6);
  });
});

describe("computeComplexitySum - inverted sym/rep (Pin 2)", () => {
  it("symmetryScore=1 -> score = 0", () => {
    const r = computeComplexitySum({ symmetryScore: 1 });
    expect(r.totalComplexity).toBe(0);
    expect(r.components[0].score).toBe(0);
  });

  it("symmetryScore=0 -> score = 1, total = 1", () => {
    const r = computeComplexitySum({ symmetryScore: 0 });
    expect(r.totalComplexity).toBe(1);
    expect(r.components[0].score).toBe(1);
  });

  it("repetitionScore=0 -> score = 1, total = 1", () => {
    const r = computeComplexitySum({ repetitionScore: 0 });
    expect(r.totalComplexity).toBe(1);
    expect(r.components[0].score).toBe(1);
  });

  it("repetitionScore=1 -> score = 0", () => {
    const r = computeComplexitySum({ repetitionScore: 1 });
    expect(r.totalComplexity).toBe(0);
    expect(r.components[0].score).toBe(0);
  });

  it("symmetryScore=0.3 -> effective score = 0.7", () => {
    const r = computeComplexitySum({ symmetryScore: 0.3 });
    expect(r.components[0].score).toBeCloseTo(0.7, 6);
  });
});

describe("computeComplexitySum - dominantComponent (Pin 5)", () => {
  it("entropy beats density via weight (equal scores)", () => {
    const r = computeComplexitySum({ density: 0.5, entropy: 0.5 });
    expect(r.dominantComponent).toBe("entropy");
  });

  it("density beats entropy via score gap", () => {
    const r = computeComplexitySum({ density: 0.9, entropy: 0.3 });
    expect(r.dominantComponent).toBe("density");
  });

  it("tie-break first-in-order wins (density=0.5 entropy=0.4)", () => {
    const r = computeComplexitySum({ density: 0.5, entropy: 0.4 });
    expect(r.dominantComponent).toBe("density");
  });

  it("inverted rep beats density", () => {
    const r = computeComplexitySum({ density: 0.5, repetitionScore: 0 });
    expect(r.dominantComponent).toBe("repetitionScore");
  });
});

describe("computeComplexitySum - clamping (Pin 4)", () => {
  it("density=5 -> clamped to 1", () => {
    const r = computeComplexitySum({ density: 5 });
    expect(r.components[0].score).toBe(1);
  });

  it("density=-3 -> clamped to 0", () => {
    const r = computeComplexitySum({ density: -3 });
    expect(r.components[0].score).toBe(0);
  });

  it("symmetryScore=2 -> clamp 1 then invert to 0", () => {
    const r = computeComplexitySum({ symmetryScore: 2 });
    expect(r.components[0].score).toBe(0);
  });

  it("symmetryScore=-1 -> clamp 0 then invert to 1", () => {
    const r = computeComplexitySum({ symmetryScore: -1 });
    expect(r.components[0].score).toBe(1);
  });
});

describe("computeComplexitySum - NaN/Inf -> excluded (Pin 4)", () => {
  it("NaN density -> excluded", () => {
    const r = computeComplexitySum({ density: NaN, entropy: 0.5 });
    expect(r.components).toHaveLength(1);
    expect(r.components[0].name).toBe("entropy");
  });

  it("Infinity -> excluded", () => {
    const r = computeComplexitySum({ density: Infinity, entropy: 0.5 });
    expect(r.components).toHaveLength(1);
  });

  it("-Infinity -> excluded", () => {
    const r = computeComplexitySum({ density: -Infinity, entropy: 0.5 });
    expect(r.components).toHaveLength(1);
  });

  it("all-NaN -> empty result", () => {
    const r = computeComplexitySum({
      density: NaN,
      entropy: NaN,
      syncopation: NaN,
      pulseCount: NaN,
      symmetryScore: NaN,
      repetitionScore: NaN,
    });
    expect(r.totalComplexity).toBe(0);
    expect(r.components).toEqual([]);
  });
});

describe("computeComplexitySum - partial input (3 of 6)", () => {
  it("density+entropy+sync = 0.5 -> total = 0.5", () => {
    const r = computeComplexitySum({
      density: 0.5,
      entropy: 0.5,
      syncopation: 0.5,
    });
    expect(r.totalComplexity).toBeCloseTo(0.5, 6);
    expect(r.components).toHaveLength(3);
  });

  it("density=1 + sym=0 -> total = 1", () => {
    const r = computeComplexitySum({ density: 1, symmetryScore: 0 });
    expect(r.totalComplexity).toBeCloseTo(1, 6);
  });

  it("density=0.4 + rep=0.6 -> total = 0.4", () => {
    const r = computeComplexitySum({ density: 0.4, repetitionScore: 0.6 });
    expect(r.totalComplexity).toBeCloseTo(0.4, 6);
  });
});

describe("buildComponentBreakdown - always 6 entries (Pin 6)", () => {
  it("empty -> 6 entries score=0", () => {
    const r = buildComponentBreakdown({});
    expect(r).toHaveLength(6);
    for (const c of r) expect(c.score).toBe(0);
  });

  it("null/undefined -> 6 entries", () => {
    expect(buildComponentBreakdown(null)).toHaveLength(6);
    expect(buildComponentBreakdown(undefined)).toHaveLength(6);
  });

  it("names in deterministic order", () => {
    const r = buildComponentBreakdown({});
    expect(r.map((c) => c.name)).toEqual([
      "density",
      "entropy",
      "syncopation",
      "pulseCount",
      "symmetryScore",
      "repetitionScore",
    ]);
  });

  it("partial: missing=0, present clamped", () => {
    const r = buildComponentBreakdown({ density: 0.7, entropy: 1.5 });
    expect(r).toHaveLength(6);
    expect(r[0]).toEqual({ name: "density", score: 0.7, weight: 0.2 });
    expect(r[1]).toEqual({ name: "entropy", score: 1, weight: 0.25 });
    expect(r[2].score).toBe(0);
    expect(r[3].score).toBe(0);
    expect(r[4].score).toBe(0);
    expect(r[5].score).toBe(0);
  });

  it("symmetryScore=0.3 -> effective 0.7", () => {
    const r = buildComponentBreakdown({ symmetryScore: 0.3 });
    const sym = r.find((c) => c.name === "symmetryScore");
    expect(sym).toBeDefined();
    expect(sym!.score).toBeCloseTo(0.7, 6);
  });

  it("default weights are exposed", () => {
    const r = buildComponentBreakdown({});
    const find = (n: string) => r.find((c) => c.name === n)!;
    expect(find("density").weight).toBe(0.2);
    expect(find("entropy").weight).toBe(0.25);
    expect(find("syncopation").weight).toBe(0.2);
    expect(find("pulseCount").weight).toBe(0.1);
    expect(find("symmetryScore").weight).toBe(0.1);
    expect(find("repetitionScore").weight).toBe(0.15);
  });
});

describe("purity & determinism", () => {
  it("computeComplexitySum does not mutate input", () => {
    const input: ComplexitySumInput = {
      density: 0.5,
      entropy: 0.7,
      symmetryScore: 0.3,
    };
    const snap = JSON.stringify(input);
    computeComplexitySum(input);
    expect(JSON.stringify(input)).toBe(snap);
  });

  it("computeComplexitySum deterministic across 2 calls", () => {
    const input: ComplexitySumInput = {
      density: 0.4,
      entropy: 0.7,
      syncopation: 0.3,
      symmetryScore: 0.5,
    };
    expect(computeComplexitySum(input)).toEqual(computeComplexitySum(input));
  });

  it("buildComponentBreakdown deterministic", () => {
    const input: ComplexitySumInput = { density: 0.4, entropy: 0.7 };
    expect(buildComponentBreakdown(input)).toEqual(
      buildComponentBreakdown(input),
    );
  });

  it("returns fresh objects per call", () => {
    const input: ComplexitySumInput = { density: 0.5 };
    const a = computeComplexitySum(input);
    const b = computeComplexitySum(input);
    expect(a).not.toBe(b);
    expect(a.components).not.toBe(b.components);
  });
});

describe("totalComplexity bounds", () => {
  it("total in [0..1] over arbitrary inputs", () => {
    const samples: ComplexitySumInput[] = [
      { density: 0.5 },
      { entropy: 1, syncopation: 0 },
      { density: 0, entropy: 0, syncopation: 0, pulseCount: 0 },
      { symmetryScore: 0.5, repetitionScore: 0.5 },
      { density: 5, entropy: -3 },
      { density: 0.123, entropy: 0.456, syncopation: 0.789 },
    ];
    for (const s of samples) {
      const r = computeComplexitySum(s);
      expect(r.totalComplexity).toBeGreaterThanOrEqual(0);
      expect(r.totalComplexity).toBeLessThanOrEqual(1);
    }
  });

  it("components scores always in [0..1]", () => {
    const r = computeComplexitySum({
      density: 5,
      entropy: -3,
      syncopation: 0.5,
      pulseCount: 1.2,
      symmetryScore: 2,
      repetitionScore: -1,
    });
    for (const c of r.components) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });
});

describe("type-shape contract", () => {
  it("ComplexitySumResult has expected keys", () => {
    const r = computeComplexitySum({ density: 0.5 });
    expect(Object.keys(r).sort()).toEqual([
      "components",
      "dominantComponent",
      "totalComplexity",
    ]);
  });

  it("ComplexityComponent has expected keys", () => {
    const r = computeComplexitySum({ density: 0.5 });
    const c: ComplexityComponent = r.components[0];
    expect(Object.keys(c).sort()).toEqual(["name", "score", "weight"]);
  });
});

