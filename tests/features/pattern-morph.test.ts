/**
 * tests/features/pattern-morph.test.ts (TASK-CVG-MORPH / v2.62)
 *
 * Pure-Coverage für client/src/utils/patternMorph.ts.
 *
 * Pattern-Morphing interpoliert Steps zwischen zwei Patterns. Wir nutzen
 * morphStepDeterministic (mit injizierbarem Seed) für stabile Tests —
 * morphStep selbst nutzt Math.random() und wird nur in Edge-Cases getestet
 * wo das Ergebnis seed-unabhängig deterministisch ist (both active /
 * both inactive / amount=0 / amount=1).
 */
import { describe, it, expect } from "vitest";
import {
  morphStep,
  morphStepDeterministic,
  morphPatterns,
} from "@/utils/patternMorph";
import type { StepData, PatternData, PartData } from "@/audio/AudioEngine";

function step(active: boolean, velocity = 100, pitch = 0): StepData {
  return { active, velocity, pitch, probability: 100 };
}

describe("PatternMorph – morphStepDeterministic Logic", () => {
  it("Beide active → immer active (egal seed/amount)", () => {
    const A = step(true, 100);
    const B = step(true, 50);
    expect(morphStepDeterministic(A, B, 0.5, 0).active).toBe(true);
    expect(morphStepDeterministic(A, B, 0.5, 1).active).toBe(true);
    expect(morphStepDeterministic(A, B, 0, 0.5).active).toBe(true);
  });

  it("Beide inactive → immer inactive", () => {
    const A = step(false);
    const B = step(false);
    expect(morphStepDeterministic(A, B, 0.5, 0).active).toBe(false);
    expect(morphStepDeterministic(A, B, 0.5, 1).active).toBe(false);
  });

  it("Nur A active, amount=0 → A dominant → seed<1 ergibt active=true", () => {
    const A = step(true);
    const B = step(false);
    expect(morphStepDeterministic(A, B, 0, 0).active).toBe(true);
    expect(morphStepDeterministic(A, B, 0, 0.99).active).toBe(true);
  });

  it("Nur A active, amount=1 → B dominant → seed<0 unmöglich → active=false", () => {
    const A = step(true);
    const B = step(false);
    expect(morphStepDeterministic(A, B, 1, 0).active).toBe(false);
    expect(morphStepDeterministic(A, B, 1, 0.5).active).toBe(false);
  });

  it("Nur B active, amount=1 → seed<1 → active=true", () => {
    const A = step(false);
    const B = step(true);
    expect(morphStepDeterministic(A, B, 1, 0).active).toBe(true);
  });

  it("Nur B active, amount=0 → seed<0 unmöglich → active=false", () => {
    const A = step(false);
    const B = step(true);
    expect(morphStepDeterministic(A, B, 0, 0.5).active).toBe(false);
  });

  it("Crossover at threshold: A-aktiv, amount=0.3, seed=0.5 → seed<(1-0.3)=0.7 → active=true", () => {
    const A = step(true);
    const B = step(false);
    expect(morphStepDeterministic(A, B, 0.3, 0.5).active).toBe(true);
  });

  it("Crossover at threshold: A-aktiv, amount=0.3, seed=0.8 → seed>0.7 → active=false", () => {
    const A = step(true);
    const B = step(false);
    expect(morphStepDeterministic(A, B, 0.3, 0.8).active).toBe(false);
  });
});

describe("PatternMorph – morphStepDeterministic Linear-Interpolation", () => {
  it("Velocity interpoliert linear: 100 → 50 mit amount=0.5 = 75", () => {
    const result = morphStepDeterministic(step(true, 100), step(true, 50), 0.5, 0);
    expect(result.velocity).toBe(75);
  });

  it("amount=0 → Velocity bleibt A", () => {
    const result = morphStepDeterministic(step(true, 80), step(true, 20), 0, 0);
    expect(result.velocity).toBe(80);
  });

  it("amount=1 → Velocity = B", () => {
    const result = morphStepDeterministic(step(true, 80), step(true, 20), 1, 0);
    expect(result.velocity).toBe(20);
  });

  it("Pitch interpoliert linear", () => {
    const result = morphStepDeterministic(step(true, 100, 0), step(true, 100, 12), 0.5, 0);
    expect(result.pitch).toBe(6);
  });

  it("Velocity-Default: inactive A ohne velocity → 0, gemorpht mit active B@100 amount=0.5 → 50", () => {
    // Step ohne velocity-Field: inactive → Default 0, active → Default 100
    const inactiveA: StepData = { active: false, pitch: 0, probability: 100 };
    const activeB: StepData = { active: true, velocity: 100, pitch: 0, probability: 100 };
    const result = morphStepDeterministic(inactiveA, activeB, 0.5, 0);
    // velocityA=0 (Default für inactive), velocityB=100 → 0 + 50 = 50
    expect(result.velocity).toBe(50);
  });

  it("Amount-Clamping: -0.5 wird zu 0", () => {
    const result = morphStepDeterministic(step(true, 100), step(true, 0), -0.5, 0);
    expect(result.velocity).toBe(100);
  });

  it("Amount-Clamping: 2 wird zu 1", () => {
    const result = morphStepDeterministic(step(true, 100), step(true, 0), 2, 0);
    expect(result.velocity).toBe(0);
  });
});

describe("PatternMorph – morphStep (mit Math.random Wrapper)", () => {
  it("Beide active → deterministisch active (seed-unabhängig)", () => {
    const A = step(true, 100);
    const B = step(true, 50);
    expect(morphStep(A, B, 0.5).active).toBe(true);
  });

  it("Beide inactive → deterministisch inactive", () => {
    expect(morphStep(step(false), step(false), 0.5).active).toBe(false);
  });

  it("Velocity-Interpolation ist seed-unabhängig", () => {
    const result = morphStep(step(true, 100), step(true, 50), 0.5);
    expect(result.velocity).toBe(75);
  });
});

// ─── morphPatterns ───────────────────────────────────────────────────────────

function mkPart(id: string, name: string, steps: StepData[]): PartData {
  return {
    id, name,
    muted: false, soloed: false,
    volume: 1, pan: 0,
    steps,
  };
}

function mkPattern(id: string, name: string, parts: PartData[]): PatternData {
  return {
    id, name,
    stepCount: 16,
    stepResolution: "1/16",
    bpm: null,
    parts,
  };
}

describe("PatternMorph – morphPatterns", () => {
  it("Beide leere Patterns → Output mit 0 parts", () => {
    const pA = mkPattern("a", "A", []);
    const pB = mkPattern("b", "B", []);
    const result = morphPatterns(pA, pB, 0.5);
    expect(result.parts).toHaveLength(0);
  });

  it("amount=0 dominiert Pattern A — Name + id reflektieren Morph-Origin", () => {
    const A = mkPattern("aaa", "Pat A", []);
    const B = mkPattern("bbb", "Pat B", []);
    const result = morphPatterns(A, B, 0);
    expect(result.id).toBe("morph-aaa-bbb");
    expect(result.name).toBe("Morph Pat A → Pat B");
  });

  it("Beide haben gleichviele Parts mit allen Steps active → Output hat überall active", () => {
    const partA = mkPart("p1", "Part1", [step(true), step(true)]);
    const partB = mkPart("p1", "Part1", [step(true), step(true)]);
    const A = mkPattern("a", "A", [partA]);
    const B = mkPattern("b", "B", [partB]);
    const result = morphPatterns(A, B, 0.5);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].steps.every((s) => s.active)).toBe(true);
  });

  it("Beide haben gleichviele Parts mit allen Steps inactive → Output ist überall inactive", () => {
    const partA = mkPart("p1", "P1", [step(false), step(false)]);
    const partB = mkPart("p1", "P1", [step(false), step(false)]);
    const result = morphPatterns(mkPattern("a", "A", [partA]), mkPattern("b", "B", [partB]), 0.5);
    expect(result.parts[0].steps.every((s) => !s.active)).toBe(true);
  });

  it("Asymmetric: A 2 Parts, B 1 Part → Output hat 2 Parts (max)", () => {
    const A = mkPattern("a", "A", [mkPart("p1", "P1", [step(true)]), mkPart("p2", "P2", [step(true)])]);
    const B = mkPattern("b", "B", [mkPart("p1", "P1", [step(true)])]);
    const result = morphPatterns(A, B, 0.5);
    expect(result.parts).toHaveLength(2);
  });

  it("Dominant-Pattern für amount<0.5 ist A (Part-Metadata)", () => {
    const partA = mkPart("p1", "Part-A-Name", [step(true)]);
    const partB = mkPart("p1", "Part-B-Name", [step(true)]);
    const result = morphPatterns(mkPattern("a", "A", [partA]), mkPattern("b", "B", [partB]), 0.3);
    expect(result.parts[0].name).toBe("Part-A-Name");
  });

  it("Dominant-Pattern für amount>=0.5 ist B", () => {
    const partA = mkPart("p1", "A-Name", [step(true)]);
    const partB = mkPart("p1", "B-Name", [step(true)]);
    const result = morphPatterns(mkPattern("a", "A", [partA]), mkPattern("b", "B", [partB]), 0.7);
    expect(result.parts[0].name).toBe("B-Name");
  });

  it("Result ist neues Objekt (Immutability)", () => {
    const A = mkPattern("a", "A", []);
    const B = mkPattern("b", "B", []);
    const result = morphPatterns(A, B, 0.5);
    expect(result).not.toBe(A);
    expect(result).not.toBe(B);
  });
});
