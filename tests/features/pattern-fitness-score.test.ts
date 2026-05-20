/**
 * tests/features/pattern-fitness-score.test.ts (v3.195)
 *
 * Pure-Coverage fuer client/src/utils/patternFitnessScore.ts.
 *
 * Validates die 4-Subscore-Aggregation (density, syncopation,
 * partVariation, consistency) plus labelFitness boundaries und
 * die fitness-spezifische Semantik (consistency = Parts-Variation,
 * NICHT Wiederholung).
 */
import { describe, it, expect } from "vitest";
import {
  computeFitnessScore,
  labelFitness,
  type FitnessLabel,
  type FitnessOptions,
} from "@/utils/patternFitnessScore";
import type { PatternData } from "@/audio/AudioEngine";

// ─── Test-Helpers ────────────────────────────────────────────────────────────

function makePattern(
  parts: Array<{ steps: boolean[] }>,
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
      steps: p.steps.map((s) => ({ active: s })),
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

function pad16(indices: number[]): boolean[] {
  const out: boolean[] = Array(16).fill(false);
  for (const i of indices) {
    if (i >= 0 && i < 16) out[i] = true;
  }
  return out;
}

// ─── Defensive Cases ─────────────────────────────────────────────────────────

describe("PatternFitnessScore - Empty / Defensive", () => {
  it("Empty pattern (0 parts) -> alle components 0 + label boring", () => {
    const res = computeFitnessScore(emptyPattern());
    expect(res.total).toBe(0);
    expect(res.components.density).toBe(0);
    expect(res.components.syncopation).toBe(0);
    expect(res.components.partVariation).toBe(0);
    expect(res.components.consistency).toBe(0);
    expect(res.label).toBe<FitnessLabel>("boring");
  });

  it("Parts vorhanden aber 0 active steps -> alle components 0", () => {
    const p = makePattern([
      { steps: pad16([]) },
      { steps: pad16([]) },
      { steps: pad16([]) },
    ]);
    const res = computeFitnessScore(p);
    expect(res.components.density).toBe(0);
    expect(res.components.partVariation).toBe(0);
    // consistency MUST be 0 wenn keine Parts Hits haben — sonst wuerde
    // all-zero-signatures unique=1 / partsWithHits=0 → NaN/inflate ergeben.
    expect(res.components.consistency).toBe(0);
    expect(res.components.syncopation).toBe(0);
    expect(res.total).toBe(0);
    expect(res.label).toBe<FitnessLabel>("boring");
  });

  it("Score liegt immer in [0,1] (clamped)", () => {
    const p = makePattern([
      { steps: pad16([0, 2, 5, 7, 10, 13]) },
      { steps: pad16([1, 4, 8, 11, 14]) },
      { steps: pad16([3, 6, 9, 12, 15]) },
    ]);
    const res = computeFitnessScore(p);
    expect(res.total).toBeGreaterThanOrEqual(0);
    expect(res.total).toBeLessThanOrEqual(1);
    for (const v of [
      res.components.density,
      res.components.syncopation,
      res.components.partVariation,
      res.components.consistency,
    ]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Density Component ──────────────────────────────────────────────────────

describe("PatternFitnessScore - Density Component", () => {
  it("density=1 (alle steps active) -> density component 0", () => {
    const p = makePattern([{ steps: Array(16).fill(true) }]);
    const res = computeFitnessScore(p);
    expect(res.components.density).toBe(0);
  });

  it("density=0 -> density component 0", () => {
    const p = makePattern([{ steps: pad16([]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.density).toBe(0);
  });

  it("density nahe targetDensity (0.35) -> density component nahe 1", () => {
    // 6/16 = 0.375, very close to 0.35
    const p = makePattern([{ steps: pad16([0, 3, 6, 9, 12, 14]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.density).toBeGreaterThan(0.9);
  });

  it("density=0.5 bei targetDensity=0.5 -> density component = 1", () => {
    const p = makePattern([{ steps: pad16([0, 2, 4, 6, 8, 10, 12, 14]) }]);
    const res = computeFitnessScore(p, { targetDensity: 0.5 });
    expect(res.components.density).toBeCloseTo(1.0, 5);
  });
});

// ─── Syncopation Component ──────────────────────────────────────────────────

describe("PatternFitnessScore - Syncopation Component", () => {
  it("Nur 1 Hit -> syncopation component = 0 (stdDev braucht >= 2)", () => {
    const p = makePattern([{ steps: pad16([5]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.syncopation).toBe(0);
  });

  it("Gleichmaessig verteilte Hits (Positions [0,4,8,12]) -> syncopation > 0", () => {
    // stdDev([0,4,8,12]) ~= 4.47, normalized auf 16/2=8 -> ~0.56
    const p = makePattern([{ steps: pad16([0, 4, 8, 12]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.syncopation).toBeGreaterThan(0.4);
    expect(res.components.syncopation).toBeLessThan(0.7);
  });

  it("Hits an beiden Enden (max stdDev) -> syncopation nahe 1", () => {
    // Positions [0, 15] -> stdDev = 7.5, normalized auf 8 -> 0.9375
    const p = makePattern([{ steps: pad16([0, 15]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.syncopation).toBeGreaterThan(0.9);
  });

  it("Hits eng beieinander (low stdDev) -> syncopation niedrig", () => {
    // Positions [5,6,7,8] -> stdDev ~= 1.12, normalized auf 8 -> ~0.14
    const p = makePattern([{ steps: pad16([5, 6, 7, 8]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.syncopation).toBeLessThan(0.25);
  });
});

// ─── Part Variation Component ───────────────────────────────────────────────

describe("PatternFitnessScore - Part Variation Component", () => {
  it("1 Part mit Hits -> partVariation = 1", () => {
    const p = makePattern([{ steps: pad16([0, 4, 8]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.partVariation).toBe(1);
  });

  it("8 Parts, alle mit Hits -> partVariation = 1", () => {
    const parts = Array.from({ length: 8 }, () => ({ steps: pad16([0]) }));
    const p = makePattern(parts);
    const res = computeFitnessScore(p);
    expect(res.components.partVariation).toBe(1);
  });

  it("4 Parts, nur 1 hat Hits -> partVariation = 0.25", () => {
    const parts = [
      { steps: pad16([0, 4]) },
      { steps: pad16([]) },
      { steps: pad16([]) },
      { steps: pad16([]) },
    ];
    const p = makePattern(parts);
    const res = computeFitnessScore(p);
    expect(res.components.partVariation).toBeCloseTo(0.25, 5);
  });
});

// ─── Consistency Component (Parts-Variation Semantik) ──────────────────────

describe("PatternFitnessScore - Consistency Component", () => {
  it("Alle Parts identisches Step-Pattern -> unique=1 / parts=N -> niedrig", () => {
    const sig = pad16([0, 4, 8, 12]);
    const p = makePattern([
      { steps: sig },
      { steps: sig },
      { steps: sig },
      { steps: sig },
    ]);
    const res = computeFitnessScore(p);
    // 1 unique signature, 4 parts with hits -> 1/4 = 0.25
    expect(res.components.consistency).toBeCloseTo(0.25, 5);
  });

  it("Jeder Part hat unique Pattern -> consistency = 1", () => {
    const p = makePattern([
      { steps: pad16([0]) },
      { steps: pad16([4]) },
      { steps: pad16([8]) },
      { steps: pad16([12]) },
    ]);
    const res = computeFitnessScore(p);
    // 4 unique signatures, 4 parts with hits -> 1.0
    expect(res.components.consistency).toBeCloseTo(1.0, 5);
  });

  it("Mix: 2 parts identisch + 2 parts unique -> 3/4 = 0.75", () => {
    const shared = pad16([0, 8]);
    const p = makePattern([
      { steps: shared },
      { steps: shared },
      { steps: pad16([1, 5]) },
      { steps: pad16([3, 11]) },
    ]);
    const res = computeFitnessScore(p);
    expect(res.components.consistency).toBeCloseTo(0.75, 5);
  });

  it("Single part -> consistency = 1 (1 unique / 1 part)", () => {
    const p = makePattern([{ steps: pad16([0, 4, 8]) }]);
    const res = computeFitnessScore(p);
    expect(res.components.consistency).toBe(1);
  });
});

// ─── Total / Weights ────────────────────────────────────────────────────────

describe("PatternFitnessScore - Total / Weights", () => {
  it("Default weights = je 0.25 -> total = Mittelwert der 4 Components", () => {
    const p = makePattern([{ steps: pad16([0, 4, 8, 12]) }]);
    const res = computeFitnessScore(p);
    const expected =
      (res.components.density +
        res.components.syncopation +
        res.components.partVariation +
        res.components.consistency) /
      4;
    expect(res.total).toBeCloseTo(expected, 5);
  });

  it("Custom weight={density:1} -> total = density component", () => {
    const p = makePattern([{ steps: pad16([0, 3, 6, 9, 12]) }]);
    const opts: FitnessOptions = {
      weights: { density: 1, syncopation: 0, partVariation: 0, consistency: 0 },
    };
    const res = computeFitnessScore(p, opts);
    expect(res.total).toBeCloseTo(res.components.density, 5);
  });

  it("Alle weights = 0 -> total = 0", () => {
    const p = makePattern([{ steps: pad16([0, 4, 8, 12]) }]);
    const res = computeFitnessScore(p, {
      weights: { density: 0, syncopation: 0, partVariation: 0, consistency: 0 },
    });
    expect(res.total).toBe(0);
  });
});

// ─── Determinism + Immutability ────────────────────────────────────────────

describe("PatternFitnessScore - Determinism", () => {
  it("Gleicher Input -> gleicher Output (deterministisch)", () => {
    const p = makePattern([
      { steps: pad16([0, 2, 5, 9, 13]) },
      { steps: pad16([1, 6, 10]) },
    ]);
    const a = computeFitnessScore(p);
    const b = computeFitnessScore(p);
    expect(a).toEqual(b);
  });

  it("Result enthaelt label-Feld konsistent zu labelFitness(total)", () => {
    const p = makePattern([
      { steps: pad16([0, 3, 6, 9, 12]) },
      { steps: pad16([1, 5, 9, 13]) },
      { steps: pad16([2, 7, 11]) },
    ]);
    const res = computeFitnessScore(p);
    expect(res.label).toBe(labelFitness(res.total));
  });
});

// ─── labelFitness boundaries ────────────────────────────────────────────────

describe("PatternFitnessScore - labelFitness boundaries", () => {
  it("0 -> boring", () => {
    expect(labelFitness(0)).toBe<FitnessLabel>("boring");
  });

  it("0.149 -> boring, 0.15 -> minimal", () => {
    expect(labelFitness(0.149)).toBe<FitnessLabel>("boring");
    expect(labelFitness(0.15)).toBe<FitnessLabel>("minimal");
  });

  it("0.349 -> minimal, 0.35 -> balanced", () => {
    expect(labelFitness(0.349)).toBe<FitnessLabel>("minimal");
    expect(labelFitness(0.35)).toBe<FitnessLabel>("balanced");
  });

  it("0.599 -> balanced, 0.6 -> interesting", () => {
    expect(labelFitness(0.599)).toBe<FitnessLabel>("balanced");
    expect(labelFitness(0.6)).toBe<FitnessLabel>("interesting");
  });

  it("0.849 -> interesting, 0.85 -> chaotic", () => {
    expect(labelFitness(0.849)).toBe<FitnessLabel>("interesting");
    expect(labelFitness(0.85)).toBe<FitnessLabel>("chaotic");
  });

  it("1 -> chaotic, > 1 -> chaotic (clamped)", () => {
    expect(labelFitness(1)).toBe<FitnessLabel>("chaotic");
    expect(labelFitness(2)).toBe<FitnessLabel>("chaotic");
  });

  it("Negative -> boring (clamped)", () => {
    expect(labelFitness(-0.5)).toBe<FitnessLabel>("boring");
    expect(labelFitness(-Infinity)).toBe<FitnessLabel>("boring");
  });

  it("NaN -> boring (clamp01 fallback)", () => {
    expect(labelFitness(Number.NaN)).toBe<FitnessLabel>("boring");
  });
});

// ─── Realistic Patterns ────────────────────────────────────────────────────

describe("PatternFitnessScore - Realistic", () => {
  it("4-on-floor + 1 Part: hohe density+partVariation+consistency -> total >= 0.5", () => {
    // density=4/16=0.25 nahe 0.35 -> density ~ 0.85
    // syncopation: stdDev([0,4,8,12])~4.47 / 8 = ~0.56
    // partVariation = 1, consistency = 1 (1 part, 1 unique)
    // -> average ~ 0.85 -> "chaotic" label moeglich
    const p = makePattern([{ steps: pad16([0, 4, 8, 12]) }]);
    const res = computeFitnessScore(p);
    expect(res.total).toBeGreaterThan(0.5);
    expect(["balanced", "interesting", "chaotic"]).toContain(res.label);
  });

  it("4 Parts identisches Pattern -> consistency niedrig -> total < single-part", () => {
    const samePattern = pad16([0, 4, 8, 12]);
    const single = computeFitnessScore(
      makePattern([{ steps: samePattern }]),
    );
    const repeated = computeFitnessScore(
      makePattern([
        { steps: samePattern },
        { steps: samePattern },
        { steps: samePattern },
        { steps: samePattern },
      ]),
    );
    // Single: consistency = 1; Repeated: consistency = 0.25
    expect(repeated.components.consistency).toBeLessThan(
      single.components.consistency,
    );
    expect(repeated.total).toBeLessThan(single.total);
  });

  it("Diverses Pattern mit 4 unique Parts -> total > 0.5", () => {
    const p = makePattern([
      { steps: pad16([0, 3, 7, 11, 14]) },
      { steps: pad16([1, 5, 9]) },
      { steps: pad16([2, 6, 13]) },
      { steps: pad16([4, 10, 15]) },
    ]);
    const res = computeFitnessScore(p);
    expect(res.total).toBeGreaterThan(0.5);
    expect(["balanced", "interesting", "chaotic"]).toContain(res.label);
  });
});
