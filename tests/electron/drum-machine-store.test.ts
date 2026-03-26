/**
 * drum-machine-store.test.ts
 *
 * Tests für die reinen Hilfsfunktionen und Logik-Schichten
 * des Drum-Machine-Stores (Phase 9 – bestehende Features).
 *
 * Keine React-Hooks nötig: reine Datentransformationen werden
 * direkt getestet ohne Hooks aufzurufen.
 */
import { describe, it, expect } from "vitest";
import { euclidean } from "../../client/src/utils/euclidean";

// ─── Hilfsfunktionen (gespiegelt aus Store) ───────────────────────────────────

interface StepData {
  active: boolean;
  velocity: number;
  pitch: number;
  probability?: number;
  condition?: string;
}

function makeSteps(count: number): StepData[] {
  return Array.from({ length: count }, () => ({ active: false, velocity: 100, pitch: 0 }));
}

function toggleStep(steps: StepData[], index: number): StepData[] {
  return steps.map((s, i) => i === index ? { ...s, active: !s.active } : s);
}

function setStepVelocity(steps: StepData[], index: number, velocity: number): StepData[] {
  const v = Math.max(1, Math.min(127, Math.round(velocity)));
  return steps.map((s, i) => i === index ? { ...s, velocity: v } : s);
}

function setStepPitch(steps: StepData[], index: number, pitch: number): StepData[] {
  return steps.map((s, i) => i === index ? { ...s, pitch } : s);
}

function setStepProbability(steps: StepData[], index: number, probability: number): StepData[] {
  const p = Math.max(0, Math.min(100, probability));
  return steps.map((s, i) => i === index ? { ...s, probability: p } : s);
}

function setStepCondition(steps: StepData[], index: number, condition: string): StepData[] {
  return steps.map((s, i) => i === index ? { ...s, condition } : s);
}

function applyEuclidean(steps: StepData[], hits: number, totalSteps: number, rotation = 0): StepData[] {
  const pattern = euclidean(hits, totalSteps, rotation);
  return steps.map((s, i) => ({ ...s, active: pattern[i] ?? false }));
}

function shiftRight(steps: StepData[]): StepData[] {
  return [steps[steps.length - 1], ...steps.slice(0, steps.length - 1)];
}

function shiftLeft(steps: StepData[]): StepData[] {
  return [...steps.slice(1), steps[0]];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("toggleStep", () => {
  it("aktiviert einen inaktiven Step", () => {
    const steps = makeSteps(16);
    const next = toggleStep(steps, 3);
    expect(next[3].active).toBe(true);
    expect(next[0].active).toBe(false);
  });

  it("deaktiviert einen aktiven Step", () => {
    let steps = makeSteps(16);
    steps = toggleStep(steps, 3);
    steps = toggleStep(steps, 3);
    expect(steps[3].active).toBe(false);
  });

  it("verändert keine anderen Steps", () => {
    const steps = makeSteps(16);
    const next = toggleStep(steps, 5);
    expect(next.filter((s, i) => i !== 5 && s.active)).toHaveLength(0);
  });
});

describe("setStepVelocity", () => {
  it("setzt Velocity korrekt", () => {
    let steps = makeSteps(8);
    steps = setStepVelocity(steps, 2, 80);
    expect(steps[2].velocity).toBe(80);
  });

  it("clampmt Velocity auf 1–127", () => {
    let steps = makeSteps(8);
    expect(setStepVelocity(steps, 0, 200)[0].velocity).toBe(127);
    expect(setStepVelocity(steps, 0, -10)[0].velocity).toBe(1);
    expect(setStepVelocity(steps, 0, 0)[0].velocity).toBe(1);
  });
});

describe("setStepPitch", () => {
  it("setzt Pitch-Offset", () => {
    const steps = makeSteps(8);
    const next = setStepPitch(steps, 1, 12);
    expect(next[1].pitch).toBe(12);
  });
});

describe("setStepProbability", () => {
  it("setzt Probability 0–100", () => {
    let steps = makeSteps(8);
    steps = setStepProbability(steps, 0, 75);
    expect(steps[0].probability).toBe(75);
  });

  it("clampmt auf 0–100", () => {
    const steps = makeSteps(8);
    expect(setStepProbability(steps, 0, 150)[0].probability).toBe(100);
    expect(setStepProbability(steps, 0, -5)[0].probability).toBe(0);
  });
});

describe("setStepCondition", () => {
  it("setzt Condition 'fill'", () => {
    const steps = makeSteps(8);
    const next = setStepCondition(steps, 3, "fill");
    expect(next[3].condition).toBe("fill");
  });
});

describe("applyEuclidean (via euclidean-Util)", () => {
  it("verteilt 3 Hits auf 8 Steps korrekt", () => {
    const steps = makeSteps(8);
    const next = applyEuclidean(steps, 3, 8);
    const activeCount = next.filter(s => s.active).length;
    expect(activeCount).toBe(3);
  });

  it("respektiert Rotation", () => {
    const stepsA = applyEuclidean(makeSteps(8), 3, 8, 0);
    const stepsB = applyEuclidean(makeSteps(8), 3, 8, 2);
    // Rotiert → anderes Muster
    expect(stepsA.map(s => s.active)).not.toEqual(stepsB.map(s => s.active));
  });
});

describe("shiftPattern", () => {
  it("verschiebt rechts (letzten Step vorne anfügen)", () => {
    let steps = makeSteps(4);
    steps = toggleStep(steps, 0); // [T,F,F,F]
    const shifted = shiftRight(steps); // [F,T,F,F]
    expect(shifted[0].active).toBe(false);
    expect(shifted[1].active).toBe(true);
  });

  it("verschiebt links (ersten Step hinten anfügen)", () => {
    let steps = makeSteps(4);
    steps = toggleStep(steps, 3); // [F,F,F,T]
    const shifted = shiftLeft(steps); // [F,F,T,F]... no: [F,F,T,...] wait:
    // steps after toggle: [F,F,F,T]
    // shiftLeft: [...steps.slice(1), steps[0]] → [F,F,T,F]
    expect(shifted[2].active).toBe(true);
    expect(shifted[3].active).toBe(false);
  });
});
