/**
 * tests/features/pattern-density.test.ts (TASK-CVG-DENSITY / v2.61)
 *
 * Pure-Coverage für client/src/utils/patternDensity.ts (139 LOC).
 *
 * Density-Map wird von MixAssistant + Pattern-Visualization genutzt um
 * Pattern-Aktivität zu visualisieren. Reine Aggregations-Math gegen
 * PartData[] — kein AudioContext.
 */
import { describe, it, expect } from "vitest";
import {
  computeDensityMap,
  detectFlashingPairs,
} from "@/utils/patternDensity";
import type { PartData, StepData } from "@/audio/AudioEngine";

// ─── Test-Fixtures ───────────────────────────────────────────────────────────

function makeStep(active: boolean, velocity?: number, probability?: number): StepData {
  return { active, velocity, probability };
}

function makePart(id: string, steps: StepData[], muted = false): PartData {
  return {
    id,
    name: id,
    muted,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
  };
}

function allActive(count: number, velocity = 100, probability = 100): StepData[] {
  return Array.from({ length: count }, () => makeStep(true, velocity, probability));
}

function allInactive(count: number): StepData[] {
  return Array.from({ length: count }, () => makeStep(false));
}

// ─── computeDensityMap ────────────────────────────────────────────────────────

describe("PatternDensity – computeDensityMap Empty Cases", () => {
  it("Leere Parts-Liste → totalDensity=0, partCount=0", () => {
    const map = computeDensityMap([]);
    expect(map.partCount).toBe(0);
    expect(map.stepCount).toBe(0);
    expect(map.totalDensity).toBe(0);
    expect(map.cells).toEqual([]);
  });

  it("Alle Parts muted → wie leere Liste", () => {
    const parts = [makePart("a", allActive(16), true), makePart("b", allActive(16), true)];
    const map = computeDensityMap(parts);
    expect(map.partCount).toBe(0);
    expect(map.totalDensity).toBe(0);
  });
});

describe("PatternDensity – computeDensityMap Full-Active", () => {
  it("1 Part voll aktiv mit velocity=127 → totalDensity=1", () => {
    const parts = [makePart("a", allActive(16, 127, 100))];
    const map = computeDensityMap(parts);
    expect(map.totalDensity).toBe(1);
    expect(map.partCount).toBe(1);
    expect(map.stepCount).toBe(16);
  });

  it("Velocity 64 (~halb), prob 100 → totalDensity ≈ 64/127", () => {
    const parts = [makePart("a", allActive(16, 64, 100))];
    const map = computeDensityMap(parts);
    expect(map.totalDensity).toBeCloseTo(64 / 127, 5);
  });

  it("Probability 50, velocity 127 → totalDensity = 0.5", () => {
    const parts = [makePart("a", allActive(16, 127, 50))];
    const map = computeDensityMap(parts);
    expect(map.totalDensity).toBeCloseTo(0.5, 5);
  });

  it("Mixed: 2 Parts, eine voll aktiv, eine leer → totalDensity=0.5", () => {
    const parts = [makePart("a", allActive(16, 127, 100)), makePart("b", allInactive(16))];
    const map = computeDensityMap(parts);
    expect(map.totalDensity).toBeCloseTo(0.5, 5);
  });
});

describe("PatternDensity – computeDensityMap Step-Density", () => {
  it("Erster Step voll aktiv, Rest inactive → stepDensity[0]=1, rest=0", () => {
    const steps: StepData[] = [makeStep(true, 127, 100), ...allInactive(15)];
    const map = computeDensityMap([makePart("a", steps)]);
    expect(map.stepDensity[0]).toBe(1);
    expect(map.stepDensity[15]).toBe(0);
  });

  it("Steps mit fehlender velocity/probability nutzen Defaults", () => {
    const parts = [makePart("a", [makeStep(true)])]; // active=true, kein vel/prob
    const map = computeDensityMap(parts);
    // Default: vel=127 → 1, prob=100 → 1, weight=1*1=1
    expect(map.totalDensity).toBe(1);
  });
});

describe("PatternDensity – computeDensityMap Variable Step-Counts", () => {
  it("Parts mit unterschiedlichen Step-Counts: stepCount = max", () => {
    const parts = [makePart("a", allActive(8)), makePart("b", allActive(16))];
    const map = computeDensityMap(parts);
    expect(map.stepCount).toBe(16);
  });

  it("Kürzerer Part wird mit 0 gepaddet im cells-Grid", () => {
    const parts = [makePart("a", allActive(4)), makePart("b", allActive(8, 127, 100))];
    const map = computeDensityMap(parts);
    // cells[5][0] = part-a step 5 (existiert nicht) → 0
    expect(map.cells[5][0]).toBe(0);
    expect(map.cells[5][1]).toBe(1); // part-b step 5 voll aktiv (velocity=127)
  });
});

describe("PatternDensity – computeDensityMap Part-Density", () => {
  it("partDensity[0]=1 wenn Part voll aktiv", () => {
    const parts = [makePart("a", allActive(16, 127, 100))];
    const map = computeDensityMap(parts);
    expect(map.partDensity[0]).toBe(1);
  });

  it("partDensity[1]=0 wenn Part leer", () => {
    const parts = [makePart("a", allActive(16)), makePart("b", allInactive(16))];
    const map = computeDensityMap(parts);
    expect(map.partDensity[1]).toBe(0);
  });
});

// ─── detectFlashingPairs ──────────────────────────────────────────────────────

describe("PatternDensity – detectFlashingPairs Edge Cases", () => {
  it("Weniger als 2 active Parts → keine Pairs", () => {
    expect(detectFlashingPairs([])).toEqual([]);
    expect(detectFlashingPairs([makePart("a", allActive(16))])).toEqual([]);
  });

  it("Alle Parts muted → keine Pairs", () => {
    const parts = [
      makePart("a", allActive(16), true),
      makePart("b", allActive(16), true),
    ];
    expect(detectFlashingPairs(parts)).toEqual([]);
  });
});

describe("PatternDensity – detectFlashingPairs Detection", () => {
  it("Zwei identische voll-aktive Parts → coActivation=1, über default-threshold 0.5", () => {
    const parts = [makePart("a", allActive(16)), makePart("b", allActive(16))];
    const pairs = detectFlashingPairs(parts);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].partA).toBe("a");
    expect(pairs[0].partB).toBe("b");
    expect(pairs[0].coActivation).toBe(1);
  });

  it("Zwei Parts mit disjunkten Steps (alternierend) → coActivation=0, unter threshold", () => {
    const stepsA: StepData[] = Array.from({ length: 16 }, (_, i) => makeStep(i % 2 === 0));
    const stepsB: StepData[] = Array.from({ length: 16 }, (_, i) => makeStep(i % 2 === 1));
    const pairs = detectFlashingPairs([makePart("a", stepsA), makePart("b", stepsB)]);
    expect(pairs).toHaveLength(0);
  });

  it("Threshold filtert: 50% co-active mit threshold=0.5 → KEIN pair (strikt >)", () => {
    // 8 von 16 Steps gemeinsam aktiv → coActivation=0.5, exakt am threshold
    const steps: StepData[] = Array.from({ length: 16 }, (_, i) => makeStep(i < 8));
    const pairs = detectFlashingPairs([makePart("a", steps), makePart("b", steps)], 0.5);
    expect(pairs).toHaveLength(0); // strikt >, nicht >=
  });

  it("Threshold filtert: 75% co-active mit threshold=0.5 → pair erscheint", () => {
    const steps: StepData[] = Array.from({ length: 16 }, (_, i) => makeStep(i < 12));
    const pairs = detectFlashingPairs([makePart("a", steps), makePart("b", steps)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].coActivation).toBeCloseTo(0.75, 5);
  });

  it("Drei Parts: pairs werden in O(n²) erzeugt (max 3 pairs für 3 Parts)", () => {
    const steps = allActive(16);
    const pairs = detectFlashingPairs([
      makePart("a", steps),
      makePart("b", steps),
      makePart("c", steps),
    ]);
    expect(pairs).toHaveLength(3); // 3-choose-2
  });

  it("Custom threshold = 0.9 unterdrückt 75%-Paare", () => {
    const steps: StepData[] = Array.from({ length: 16 }, (_, i) => makeStep(i < 12));
    const pairs = detectFlashingPairs([makePart("a", steps), makePart("b", steps)], 0.9);
    expect(pairs).toHaveLength(0);
  });
});
