/**
 * tests/features/quantize.test.ts
 *
 * Regression-Tests für den Quantize-Crash-Bug (require() in ES-Modul).
 * Stellt sicher dass quantizeSteps direkt importierbar + ausführbar ist.
 */
import { describe, it, expect } from "vitest";
import { quantizeSteps, formatGrid, type QuantizeGrid } from "../../client/src/utils/quantizeGrid";
import type { StepData } from "../../client/src/audio/AudioEngine";

function makeSteps(activeIndices: number[], stepCount = 16): StepData[] {
  return Array.from({ length: stepCount }, (_, i) => ({
    active: activeIndices.includes(i),
    velocity: 100,
  }));
}

describe("quantizeSteps (Regression: kein require()-Crash)", () => {
  it("kann ohne Crash importiert + aufgerufen werden", () => {
    const steps = makeSteps([0, 5, 10]);
    expect(() => quantizeSteps(steps, { grid: "1/4", strength: 1, stepCount: 16 })).not.toThrow();
  });

  it("strength=0 lässt Steps unverändert", () => {
    const steps = makeSteps([3, 7, 11]);
    const result = quantizeSteps(steps, { grid: "1/4", strength: 0, stepCount: 16 });
    expect(result).toEqual(steps);
  });

  it("strength=1 mit grid='1/4' rastet auf Viertel ein (Indices 0,4,8,12)", () => {
    const steps = makeSteps([1, 5, 9, 13]); // verschoben um 1 von Viertel
    const result = quantizeSteps(steps, { grid: "1/4", strength: 1, stepCount: 16 });
    const activeIdx = result.map((s, i) => s.active ? i : -1).filter(i => i >= 0);
    // Sollte auf 0, 4, 8, 12 einrasten
    expect(activeIdx).toEqual([0, 4, 8, 12]);
  });

  it("erhält Velocity beim Quantisieren", () => {
    const steps = makeSteps([1]);
    steps[1] = { active: true, velocity: 88 };
    const result = quantizeSteps(steps, { grid: "1/4", strength: 1, stepCount: 16 });
    const firstActive = result.find(s => s.active);
    expect(firstActive?.velocity).toBe(88);
  });

  it("Kollision: höhere Velocity gewinnt", () => {
    const steps: StepData[] = Array.from({ length: 16 }, () => ({ active: false, velocity: 100 }));
    steps[0] = { active: true, velocity: 50 };
    steps[1] = { active: true, velocity: 127 };
    // Beide rasten auf Index 0 ein bei 1/4
    const result = quantizeSteps(steps, { grid: "1/4", strength: 1, stepCount: 16 });
    expect(result[0].active).toBe(true);
    expect(result[0].velocity).toBe(127);
  });

  it("funktioniert für 32-Step-Patterns", () => {
    const steps = makeSteps([0, 7, 15, 23], 32);
    const result = quantizeSteps(steps, { grid: "1/8", strength: 1, stepCount: 32 });
    expect(result).toHaveLength(32);
    expect(result.some(s => s.active)).toBe(true);
  });

  it("formatGrid liefert Anzeige-String zurück", () => {
    const grids: QuantizeGrid[] = ["1/4", "1/8", "1/16", "1/32"];
    grids.forEach(g => expect(formatGrid(g)).toBe(g));
  });
});
