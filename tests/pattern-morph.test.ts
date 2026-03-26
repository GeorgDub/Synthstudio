/**
 * tests/pattern-morph.test.ts
 *
 * Unit-Tests für patternMorph.ts und useMorphStore.ts (Phase 5, v1.9).
 * Umgebung: Node – kein DOM, kein Browser-API.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  morphStep,
  morphStepDeterministic,
  morphPatterns,
} from "@/utils/patternMorph";
import {
  __resetMorphForTests,
  getMorphState,
  setAmount,
} from "@/store/useMorphStore";
import type { StepData, PatternData, PartData } from "@/audio/AudioEngine";

// ─── Test-Hilfsfunktionen ─────────────────────────────────────────────────────

function makeStep(overrides: Partial<StepData> = {}): StepData {
  return {
    active: false,
    velocity: 1,
    pitch: 0,
    probability: 1,
    condition: { type: "always" },
    ...overrides,
  };
}

function makePart(id: string, steps: StepData[]): PartData {
  return {
    id,
    name: `Part ${id}`,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: {
      filterEnabled: false,
      filterType: "lowpass",
      filterFreq: 8000,
      filterQ: 1,
      filterGain: 0,
      distortionEnabled: false,
      distortionAmount: 50,
      compressorEnabled: false,
      compressorThreshold: -24,
      compressorRatio: 4,
      compressorAttack: 0.003,
      compressorRelease: 0.25,
      delayEnabled: false,
      delayTime: 0.25,
      delayFeedback: 0.3,
      delayMix: 0.3,
      reverbEnabled: false,
      reverbDecay: 2.0,
      reverbMix: 0.3,
      eqEnabled: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
    },
  };
}

function makePattern(id: string, parts: PartData[]): PatternData {
  return {
    id,
    name: `Pattern ${id}`,
    stepCount: 16,
    stepResolution: "1/16",
    bpm: null,
    parts,
  };
}

// ─── morphStepDeterministic ───────────────────────────────────────────────────

describe("morphStepDeterministic", () => {
  // Test 1: amount=0, beide Steps identisch zu A → Ergebnis = A
  it("amount=0 gibt vollständig Step A zurück", () => {
    const stepA = makeStep({ active: true, velocity: 0.8, pitch: 2 });
    const stepB = makeStep({ active: false, velocity: 0.2, pitch: -3 });

    const result = morphStepDeterministic(stepA, stepB, 0, 0.5);

    expect(result.active).toBe(true);
    expect(result.velocity).toBeCloseTo(0.8);
    expect(result.pitch).toBeCloseTo(2);
  });

  // Test 2: amount=1, beide Steps identisch zu B → Ergebnis = B
  it("amount=1 gibt vollständig Step B zurück", () => {
    const stepA = makeStep({ active: true, velocity: 0.8, pitch: 2 });
    const stepB = makeStep({ active: false, velocity: 0.2, pitch: -3 });

    const result = morphStepDeterministic(stepA, stepB, 1, 0.5);

    expect(result.active).toBe(false);
    expect(result.velocity).toBeCloseTo(0.2);
    expect(result.pitch).toBeCloseTo(-3);
  });

  // Test 3: Nur A aktiv, amount=0, seed=0 → aktiv (Wahrscheinlichkeit = 1-0 = 1 > seed=0)
  it("Nur A aktiv, amount=0, seed=0 → aktiv", () => {
    const stepA = makeStep({ active: true });
    const stepB = makeStep({ active: false });

    const result = morphStepDeterministic(stepA, stepB, 0, 0);
    expect(result.active).toBe(true);
  });

  // Test 4: Nur A aktiv, amount=1, seed=0.99 → inaktiv (Wahrscheinlichkeit = 1-1 = 0 < seed=0.99 → false)
  it("Nur A aktiv, amount=1, seed=0.99 → inaktiv", () => {
    const stepA = makeStep({ active: true });
    const stepB = makeStep({ active: false });

    const result = morphStepDeterministic(stepA, stepB, 1, 0.99);
    expect(result.active).toBe(false);
  });

  // Test 5: Nur B aktiv, amount=1, seed=0 → aktiv (Wahrscheinlichkeit = 1 > seed=0)
  it("Nur B aktiv, amount=1, seed=0 → aktiv", () => {
    const stepA = makeStep({ active: false });
    const stepB = makeStep({ active: true });

    const result = morphStepDeterministic(stepA, stepB, 1, 0);
    expect(result.active).toBe(true);
  });

  // Test 6: Velocity wird linear interpoliert: A=0, B=1, amount=0.5 → velocity=0.5
  it("Velocity wird linear interpoliert: A=0, B=1, amount=0.5 → 0.5", () => {
    const stepA = makeStep({ velocity: 0 });
    const stepB = makeStep({ velocity: 1 });

    const result = morphStepDeterministic(stepA, stepB, 0.5, 0.5);
    expect(result.velocity).toBeCloseTo(0.5);
  });
});

// ─── morphPatterns ────────────────────────────────────────────────────────────

describe("morphPatterns", () => {
  // Test 7: Gibt neues PatternData-Objekt zurück (nicht gleiche Referenz)
  it("gibt ein neues PatternData-Objekt zurück (nicht mutierend)", () => {
    const stepsA = Array.from({ length: 16 }, () => makeStep({ active: true }));
    const stepsB = Array.from({ length: 16 }, () => makeStep({ active: false }));
    const patternA = makePattern("A", [makePart("p1", stepsA)]);
    const patternB = makePattern("B", [makePart("p1", stepsB)]);

    const result = morphPatterns(patternA, patternB, 0.5);

    expect(result).not.toBe(patternA);
    expect(result).not.toBe(patternB);
    expect(result.parts[0]).not.toBe(patternA.parts[0]);
    expect(result.parts[0]).not.toBe(patternB.parts[0]);
  });

  // Test 8: Parts-Länge entspricht max(A.parts.length, B.parts.length)
  it("Parts-Länge = max(A.parts, B.parts)", () => {
    const steps = Array.from({ length: 16 }, () => makeStep());
    const patternA = makePattern("A", [
      makePart("p1", steps),
      makePart("p2", steps),
      makePart("p3", steps),
    ]);
    const patternB = makePattern("B", [
      makePart("p1", steps),
    ]);

    const result = morphPatterns(patternA, patternB, 0.5);

    expect(result.parts.length).toBe(3);
  });
});

// ─── useMorphStore ────────────────────────────────────────────────────────────

describe("useMorphStore (Singleton-Logik)", () => {
  beforeEach(() => {
    __resetMorphForTests();
  });

  // Test 9: setAmount(0.3) → amount === 0.3
  it("setAmount(0.3) → amount === 0.3", () => {
    setAmount(0.3);

    const state = getMorphState();
    expect(state.amount).toBeCloseTo(0.3);
  });
});
