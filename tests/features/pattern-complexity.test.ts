/**
 * tests/features/pattern-complexity.test.ts (v3.171)
 *
 * Pure-Coverage für client/src/utils/patternComplexity.ts.
 *
 * Validates the 4-Subscore-Aggregation (density, syncopation,
 * part-variation, velocity-variation) plus categorical mapping.
 */
import { describe, it, expect } from "vitest";
import {
  computePatternComplexity,
  categorizeComplexity,
  type ComplexityCategory,
} from "@/utils/patternComplexity";
import type { PatternData } from "@/audio/AudioEngine";

// Test-Helper

function makePattern(
  parts: Array<{
    steps: Array<boolean | { active: boolean; velocity?: number }>;
  }>,
): PatternData {
  return {
    id: "test",
    name: "Test",
    stepCount: 16 as const,
    stepResolution: "1/16" as never,
    bpm: 120,
    parts: parts.map((p, i) => ({
      id: "p" + i,
      name: "Part " + i,
      muted: false,
      soloed: false,
      volume: 1,
      pan: 0,
      steps: p.steps.map((s) =>
        typeof s === "boolean" ? { active: s } : s,
      ),
    })) as never,
  };
}

function emptyPattern(): PatternData {
  return {
    id: "empty",
    name: "Empty",
    stepCount: 16 as const,
    stepResolution: "1/16" as never,
    bpm: 120,
    parts: [],
  };
}

function pattern16(active: boolean[]): boolean[] {
  const out = [...active];
  while (out.length < 16) out.push(false);
  return out;
}

describe("PatternComplexity - Empty / Defensive Cases", () => {
  it("Empty pattern (0 parts) -> alle Scores 0, category minimal", () => {
    const res = computePatternComplexity(emptyPattern());
    expect(res.densityScore).toBe(0);
    expect(res.syncopationScore).toBe(0);
    expect(res.partVariationScore).toBe(0);
    expect(res.velocityVariationScore).toBe(0);
    expect(res.total).toBe(0);
    const cat: ComplexityCategory = categorizeComplexity(res.total);
    expect(cat).toBe("minimal");
  });

  it("Pattern mit Parts aber 0 active steps -> alle Scores 0", () => {
    const p = makePattern([
      { steps: pattern16([]) },
      { steps: pattern16([]) },
    ]);
    const res = computePatternComplexity(p);
    expect(res.densityScore).toBe(0);
    expect(res.partVariationScore).toBe(0);
    expect(res.total).toBe(0);
  });
});

describe("PatternComplexity - Density Score", () => {
  it("Pattern alle-true (100% density) -> densityScore = 0", () => {
    const allTrue = Array(16).fill(true);
    const p = makePattern([{ steps: allTrue }]);
    const res = computePatternComplexity(p);
    expect(res.densityScore).toBe(0);
    const cat = categorizeComplexity(res.total);
    expect(["minimal", "simple"]).toContain(cat);
  });

  it("Pattern optimal-density (~37.5%) -> densityScore nahe 1", () => {
    const s = pattern16([true, false, false, true, false, false, true, false, false, true, false, false, true, false, true, false]);
    const hits = s.filter((v) => v).length;
    expect(hits).toBe(6);
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.densityScore).toBeGreaterThan(0.9);
  });

  it("Pattern 50% density bei optimal=0.5 -> densityScore = 1", () => {
    const s = pattern16([true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false]);
    expect(s.filter((v) => v).length).toBe(8);
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p, { optimalDensity: 0.5 });
    expect(res.densityScore).toBeCloseTo(1.0, 5);
  });

  it("Pattern 0% density bei optimal=0.35 -> densityScore = 0", () => {
    const p = makePattern([{ steps: pattern16([]) }]);
    const res = computePatternComplexity(p);
    expect(res.densityScore).toBe(0);
  });
});

describe("PatternComplexity - Syncopation Score", () => {
  it("Pattern 4-on-the-floor -> syncopationScore = 0", () => {
    const s = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.syncopationScore).toBe(0);
    expect(res.densityScore).toBeGreaterThan(0);
  });

  it("Pattern irregular hits -> syncopationScore > 0.5", () => {
    const s = pattern16([true, true, false, false, false, true, false, false, false, false, false, false, false, true, false, false]);
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.syncopationScore).toBeGreaterThan(0.5);
  });

  it("Pattern mit nur 1 hit -> syncopationScore = 0", () => {
    const s = pattern16([true]);
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.syncopationScore).toBe(0);
  });
});

describe("PatternComplexity - Part Variation Score", () => {
  it("Pattern mit 1 Part (Hits) -> partVariationScore = 1", () => {
    const p = makePattern([{ steps: pattern16([true, false, true, false, true]) }]);
    const res = computePatternComplexity(p);
    expect(res.partVariationScore).toBe(1);
  });

  it("Pattern mit 8 Parts, alle haben Hits -> partVariationScore = 1", () => {
    const parts = Array.from({ length: 8 }, () => ({ steps: pattern16([true]) }));
    const p = makePattern(parts);
    const res = computePatternComplexity(p);
    expect(res.partVariationScore).toBe(1);
  });

  it("Pattern mit 8 Parts, nur 2 haben Hits -> partVariationScore = 0.25", () => {
    const parts = Array.from({ length: 8 }, (_, i) => ({
      steps: i < 2 ? pattern16([true]) : pattern16([]),
    }));
    const p = makePattern(parts);
    const res = computePatternComplexity(p);
    expect(res.partVariationScore).toBeCloseTo(0.25, 5);
  });

  it("1-Part vs 8-Parts (jeweils Hits) -> partVariationScore identisch (beide = 1)", () => {
    const single = makePattern([{ steps: pattern16([true, false, true]) }]);
    const eight = makePattern(
      Array.from({ length: 8 }, () => ({ steps: pattern16([true]) })),
    );
    const a = computePatternComplexity(single);
    const b = computePatternComplexity(eight);
    expect(a.partVariationScore).toBe(b.partVariationScore);
    expect(a.partVariationScore).toBe(1);
  });
});

describe("PatternComplexity - Velocity Variation Score", () => {
  it("velocityVariationScore = 0 wenn alle velocities gleich", () => {
    const s = Array.from({ length: 16 }, (_, i) =>
      i % 4 === 0 ? { active: true, velocity: 100 } : { active: false },
    );
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.velocityVariationScore).toBe(0);
  });

  it("velocityVariationScore > 0 wenn velocities variieren", () => {
    const s = [
      { active: true, velocity: 30 },
      { active: false },
      { active: true, velocity: 127 },
      { active: false },
      { active: true, velocity: 60 },
      { active: false },
      { active: true, velocity: 110 },
      { active: false },
      { active: false }, { active: false }, { active: false }, { active: false },
      { active: false }, { active: false }, { active: false }, { active: false },
    ];
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.velocityVariationScore).toBeGreaterThan(0);
  });

  it("Velocity stdDev moderat -> velocityVariationScore zwischen 0.3 und 0.6", () => {
    const s = Array.from({ length: 16 }, (_, i) => {
      if (i % 2 !== 0) return { active: false };
      return { active: true, velocity: i % 4 === 0 ? 50 : 100 };
    });
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.velocityVariationScore).toBeGreaterThan(0.3);
    expect(res.velocityVariationScore).toBeLessThan(0.6);
  });

  it("Velocity fehlt -> Default 100, alle gleich -> score 0", () => {
    const s = pattern16([true, false, true, false, true]);
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.velocityVariationScore).toBe(0);
  });
});

describe("PatternComplexity - Total / Weights", () => {
  it("Custom weights ergeben unterschiedliches total als Default", () => {
    const s = pattern16([true, false, true, false, true, false, true]);
    const p = makePattern([{ steps: s }]);
    const def = computePatternComplexity(p);
    const onlyDensity = computePatternComplexity(p, {
      weights: { density: 1, syncopation: 0, partVariation: 0, velocityVariation: 0 },
    });
    expect(onlyDensity.total).toBeCloseTo(def.densityScore, 5);
    expect(onlyDensity.total).not.toBeCloseTo(def.total, 2);
  });

  it("Weights = 0 fuer alle -> total = 0", () => {
    const s = pattern16([true, false, true, false, true]);
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p, {
      weights: { density: 0, syncopation: 0, partVariation: 0, velocityVariation: 0 },
    });
    expect(res.total).toBe(0);
  });

  it("Total ist clamped auf 0..1", () => {
    const s = pattern16([true, false, true, false, true, false, true]);
    const p = makePattern([{ steps: s }]);
    const res = computePatternComplexity(p);
    expect(res.total).toBeGreaterThanOrEqual(0);
    expect(res.total).toBeLessThanOrEqual(1);
  });
});

describe("PatternComplexity - categorizeComplexity boundaries", () => {
  it("0 -> minimal", () => {
    expect(categorizeComplexity(0)).toBe("minimal");
  });

  it("0.149 -> minimal, 0.15 -> simple", () => {
    expect(categorizeComplexity(0.149)).toBe("minimal");
    expect(categorizeComplexity(0.15)).toBe("simple");
  });

  it("0.349 -> simple, 0.35 -> balanced", () => {
    expect(categorizeComplexity(0.349)).toBe("simple");
    expect(categorizeComplexity(0.35)).toBe("balanced");
  });

  it("0.599 -> balanced, 0.6 -> complex", () => {
    expect(categorizeComplexity(0.599)).toBe("balanced");
    expect(categorizeComplexity(0.6)).toBe("complex");
  });

  it("0.849 -> complex, 0.85 -> chaotic", () => {
    expect(categorizeComplexity(0.849)).toBe("complex");
    expect(categorizeComplexity(0.85)).toBe("chaotic");
  });

  it("1 -> chaotic, > 1 -> chaotic (clamped)", () => {
    expect(categorizeComplexity(1)).toBe("chaotic");
    expect(categorizeComplexity(2)).toBe("chaotic");
  });

  it("Negative input -> minimal (clamped)", () => {
    expect(categorizeComplexity(-0.5)).toBe("minimal");
  });
});

describe("PatternComplexity - Determinismus", () => {
  it("Gleicher Input -> gleicher Output (deterministisch)", () => {
    const s = pattern16([true, false, true, false, true, false, false, true]);
    const p = makePattern([
      { steps: s },
      { steps: pattern16([false, true, false, true]) },
    ]);
    const a = computePatternComplexity(p);
    const b = computePatternComplexity(p);
    expect(a).toEqual(b);
  });

  it("Alle Sub-Scores liegen in [0,1]", () => {
    const s = pattern16([true, true, false, true, false, true, true, false, true]);
    const p = makePattern([
      { steps: s },
      {
        steps: s.map((v, i) =>
          v ? { active: true, velocity: 30 + ((i * 17) % 90) } : { active: false },
        ),
      },
    ]);
    const res = computePatternComplexity(p);
    for (const v of [
      res.densityScore,
      res.syncopationScore,
      res.partVariationScore,
      res.velocityVariationScore,
      res.total,
    ]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("PatternComplexity - Realistic Patterns", () => {
  it("Komplexes Pattern -> total > 0.35 und category balanced/complex/chaotic", () => {
    const p = makePattern([
      {
        steps: [
          { active: true, velocity: 100 },
          { active: false },
          { active: true, velocity: 60 },
          { active: false },
          { active: false },
          { active: true, velocity: 120 },
          { active: false },
          { active: true, velocity: 80 },
          { active: false },
          { active: false },
          { active: true, velocity: 40 },
          { active: false },
          { active: true, velocity: 110 },
          { active: false },
          { active: false },
          { active: false },
        ],
      },
      {
        steps: [
          { active: false },
          { active: true, velocity: 90 },
          { active: false },
          { active: false },
          { active: true, velocity: 50 },
          { active: false },
          { active: true, velocity: 100 },
          { active: false },
          { active: false },
          { active: true, velocity: 70 },
          { active: false },
          { active: false },
          { active: false },
          { active: true, velocity: 30 },
          { active: false },
          { active: false },
        ],
      },
      { steps: pattern16([true]) },
      { steps: pattern16([false, false, false, false, false, true]) },
    ]);
    const res = computePatternComplexity(p);
    expect(res.total).toBeGreaterThan(0.35);
    const cat = categorizeComplexity(res.total);
    expect(["balanced", "complex", "chaotic"]).toContain(cat);
  });

  it("Simple kick auf 1+5+9+13 -> regelmaessig + gleiche velocities", () => {
    // 1 Part, 4 hits, alle velocity=100, exakt regelmaessig
    const p = makePattern([
      {
        steps: [
          { active: true, velocity: 100 },
          { active: false }, { active: false }, { active: false },
          { active: true, velocity: 100 },
          { active: false }, { active: false }, { active: false },
          { active: true, velocity: 100 },
          { active: false }, { active: false }, { active: false },
          { active: true, velocity: 100 },
          { active: false }, { active: false }, { active: false },
        ],
      },
    ]);
    const res = computePatternComplexity(p);
    // Regelmaessig -> kein Syncopation
    expect(res.syncopationScore).toBe(0);
    // Alle velocities gleich -> keine Velocity-Variation
    expect(res.velocityVariationScore).toBe(0);
    // PartVariation = 1 (1/1), Density nahe Optimum (0.25 vs 0.35)
    expect(res.partVariationScore).toBe(1);
    expect(res.densityScore).toBeGreaterThan(0.7);
    // Total = (densityScore + 0 + 1 + 0)/4 -> rund 0.4..0.5
    expect(res.total).toBeGreaterThan(0.3);
    expect(res.total).toBeLessThan(0.6);
  });
});
