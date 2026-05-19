/**
 * tests/features/pattern-bank-density.test.ts (v3.162)
 *
 * Pure-Coverage für client/src/utils/patternBankDensity.ts
 *
 * Tests die Multi-Pattern-Density-Aggregation: pro-Pattern hits/total,
 * gewichtete averageDensity, dominantCategory mit Tie-Break (fülliger gewinnt).
 */
import { describe, it, expect } from "vitest";
import { analyzePatternBank } from "@/utils/patternBankDensity";
import type { PatternData } from "@/audio/AudioEngine";

// ─── Test-Fixtures ───────────────────────────────────────────────────────────

function makePattern(
  id: string,
  name: string,
  parts: Array<{ steps: boolean[] }>,
): PatternData {
  return {
    id,
    name,
    stepCount: 16 as const,
    stepResolution: "1/16" as any,
    bpm: 120,
    parts: parts.map((p, i) => ({
      id: `${id}-p${i}`,
      name: `Part ${i}`,
      muted: false,
      soloed: false,
      volume: 1,
      pan: 0,
      steps: p.steps.map((active) => ({ active })),
    })) as any,
  };
}

function active(count: number): boolean[] {
  return Array.from({ length: count }, () => true);
}

function inactive(count: number): boolean[] {
  return Array.from({ length: count }, () => false);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("analyzePatternBank", () => {
  it("1. empty array → empty report", () => {
    const report = analyzePatternBank([]);
    expect(report.perPattern).toEqual([]);
    expect(report.totalHits).toBe(0);
    expect(report.totalSteps).toBe(0);
    expect(report.averageDensity).toBe(0);
    expect(report.dominantCategory).toBe("empty");
  });

  it("2. single empty pattern → totalHits=0, averageDensity=0", () => {
    const p = makePattern("p1", "Empty", [{ steps: inactive(16) }]);
    const report = analyzePatternBank([p]);
    expect(report.totalHits).toBe(0);
    expect(report.totalSteps).toBe(16);
    expect(report.averageDensity).toBe(0);
    expect(report.dominantCategory).toBe("empty");
    expect(report.perPattern).toHaveLength(1);
    expect(report.perPattern[0].hits).toBe(0);
    expect(report.perPattern[0].density).toBe(0);
    expect(report.perPattern[0].category).toBe("empty");
  });

  it("3. single pattern alle-true → density=1, category=full", () => {
    const p = makePattern("p1", "Full", [{ steps: active(16) }]);
    const report = analyzePatternBank([p]);
    expect(report.totalHits).toBe(16);
    expect(report.totalSteps).toBe(16);
    expect(report.averageDensity).toBe(1);
    expect(report.dominantCategory).toBe("full");
    expect(report.perPattern[0].density).toBe(1);
    expect(report.perPattern[0].category).toBe("full");
  });

  it("4. multi-pattern aggregate-math (3 patterns)", () => {
    // p1: 16 steps, 4 hits → density 0.25 (sparse boundary)
    // p2: 16 steps, 8 hits → density 0.5 (medium boundary)
    // p3: 16 steps, 12 hits → density 0.75 (dense)
    const p1 = makePattern("p1", "A", [
      { steps: [...active(4), ...inactive(12)] },
    ]);
    const p2 = makePattern("p2", "B", [
      { steps: [...active(8), ...inactive(8)] },
    ]);
    const p3 = makePattern("p3", "C", [
      { steps: [...active(12), ...inactive(4)] },
    ]);
    const report = analyzePatternBank([p1, p2, p3]);
    expect(report.totalHits).toBe(24);
    expect(report.totalSteps).toBe(48);
    expect(report.averageDensity).toBe(0.5);
    expect(report.perPattern[0].density).toBeCloseTo(0.25);
    expect(report.perPattern[0].category).toBe("sparse");
    expect(report.perPattern[1].density).toBeCloseTo(0.5);
    expect(report.perPattern[1].category).toBe("medium");
    expect(report.perPattern[2].density).toBeCloseTo(0.75);
    expect(report.perPattern[2].category).toBe("dense");
  });

  it("5. dominantCategory: 2 sparse + 1 dense → sparse", () => {
    const s1 = makePattern("s1", "S1", [
      { steps: [...active(2), ...inactive(14)] },
    ]);
    const s2 = makePattern("s2", "S2", [
      { steps: [...active(3), ...inactive(13)] },
    ]);
    const d1 = makePattern("d1", "D1", [
      { steps: [...active(12), ...inactive(4)] },
    ]);
    const report = analyzePatternBank([s1, s2, d1]);
    expect(report.dominantCategory).toBe("sparse");
  });

  it("6. dominantCategory bei Tie: 1 dense + 1 sparse → dense (fülliger gewinnt)", () => {
    const sparse = makePattern("s", "Sparse", [
      { steps: [...active(2), ...inactive(14)] },
    ]);
    const dense = makePattern("d", "Dense", [
      { steps: [...active(12), ...inactive(4)] },
    ]);
    const report = analyzePatternBank([sparse, dense]);
    expect(report.dominantCategory).toBe("dense");
  });

  it("7. averageDensity gewichtet nach Pattern-Length", () => {
    // 100 steps mit 50 hits + 16 steps mit 8 hits → 58/116 ≈ 0.5
    const big = makePattern("big", "Big", [
      { steps: [...active(50), ...inactive(50)] },
    ]);
    const small = makePattern("small", "Small", [
      { steps: [...active(8), ...inactive(8)] },
    ]);
    const report = analyzePatternBank([big, small]);
    expect(report.totalHits).toBe(58);
    expect(report.totalSteps).toBe(116);
    expect(report.averageDensity).toBeCloseTo(58 / 116);
    expect(report.averageDensity).toBeCloseTo(0.5);
  });

  it("8. perPattern hat richtige patternId/name-Werte", () => {
    const p1 = makePattern("alpha-id", "Alpha Name", [
      { steps: active(16) },
    ]);
    const p2 = makePattern("beta-id", "Beta Name", [
      { steps: inactive(16) },
    ]);
    const report = analyzePatternBank([p1, p2]);
    expect(report.perPattern[0].patternId).toBe("alpha-id");
    expect(report.perPattern[0].patternName).toBe("Alpha Name");
    expect(report.perPattern[1].patternId).toBe("beta-id");
    expect(report.perPattern[1].patternName).toBe("Beta Name");
  });

  it("9. multi-part pattern: aggregiert über alle parts", () => {
    // 2 parts × 16 steps = 32 total, 4 hits in part0 + 8 hits in part1 = 12 hits
    const p = makePattern("multi", "Multi", [
      { steps: [...active(4), ...inactive(12)] },
      { steps: [...active(8), ...inactive(8)] },
    ]);
    const report = analyzePatternBank([p]);
    expect(report.totalHits).toBe(12);
    expect(report.totalSteps).toBe(32);
    expect(report.perPattern[0].hits).toBe(12);
    expect(report.perPattern[0].total).toBe(32);
    expect(report.perPattern[0].density).toBeCloseTo(12 / 32);
  });
});
