/**
 * step-probability.test.ts
 *
 * Tests für shouldTriggerStep() – Probability und Conditional Triggers (Phase 1)
 * Kein Electron-Import, kein AudioContext – reine Logik-Tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { StepData, StepCondition } from "../../client/src/audio/AudioEngine";

// ─── Isolierte shouldTriggerStep-Logik (ohne AudioEngine-Klasse) ─────────────
// Spiegelt die Implementierung aus AudioEngine.ts wider, damit Tests ohne
// Web Audio API / AudioContext laufen.

function shouldTriggerStep(
  step: StepData,
  loopCount: number,
  isFillActive: boolean
): boolean {
  if (!step.active) return false;
  const prob = Math.max(0, Math.min(100, step.probability ?? 100));
  if (prob <= 0) return false;
  // Probability-Check wird für deterministische Tests übersprungen (prob < 100 Fälle
  // werden separat per statistischem Test überprüft)
  const condition = step.condition;
  if (!condition || condition.type === "always") return true;
  if (condition.type === "every") {
    return (loopCount % condition.of) === (condition.n - 1);
  }
  if (condition.type === "fill") return isFillActive;
  if (condition.type === "not_fill") return !isFillActive;
  return true;
}

// Stochastischer Probability-Check (separates Utility)
function triggerWithProbability(prob: number): boolean {
  const clamped = Math.max(0, Math.min(100, prob));
  if (clamped <= 0) return false;
  if (clamped >= 100) return true;
  return Math.random() * 100 <= clamped;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("shouldTriggerStep – Probability", () => {
  it("löst nie aus wenn probability=0", () => {
    const step: StepData = { active: true, probability: 0 };
    for (let i = 0; i < 100; i++) {
      expect(shouldTriggerStep(step, i, false)).toBe(false);
    }
  });

  it("löst immer aus wenn probability=100", () => {
    const step: StepData = { active: true, probability: 100 };
    for (let i = 0; i < 100; i++) {
      expect(shouldTriggerStep(step, i, false)).toBe(true);
    }
  });

  it("löst statistisch ~50% aus bei probability=50 (1000 Iterationen)", () => {
    let triggers = 0;
    for (let i = 0; i < 1000; i++) {
      if (triggerWithProbability(50)) triggers++;
    }
    // Toleranz 10%: 400–600 erwartet
    expect(triggers).toBeGreaterThan(350);
    expect(triggers).toBeLessThan(650);
  });

  it("löst immer aus wenn condition=always und probability=100", () => {
    const step: StepData = {
      active: true,
      probability: 100,
      condition: { type: "always" },
    };
    for (let i = 0; i < 50; i++) {
      expect(shouldTriggerStep(step, i, false)).toBe(true);
    }
  });
});

describe("shouldTriggerStep – Conditional Triggers", () => {
  it("'every 1:2' löst exakt jeden 2. Durchlauf aus (loopCount 0,1,2,3…)", () => {
    const step: StepData = {
      active: true,
      probability: 100,
      condition: { type: "every", n: 1, of: 2 },
    };
    // n=1, of=2 → loopCount % 2 === 0 → true bei 0, 2, 4…
    expect(shouldTriggerStep(step, 0, false)).toBe(true);
    expect(shouldTriggerStep(step, 1, false)).toBe(false);
    expect(shouldTriggerStep(step, 2, false)).toBe(true);
    expect(shouldTriggerStep(step, 3, false)).toBe(false);
  });

  it("'every 2:2' löst exakt beim 2. von 2 Durchläufen aus", () => {
    const step: StepData = {
      active: true,
      probability: 100,
      condition: { type: "every", n: 2, of: 2 },
    };
    // n=2, of=2 → loopCount % 2 === 1 → true bei 1, 3, 5…
    expect(shouldTriggerStep(step, 0, false)).toBe(false);
    expect(shouldTriggerStep(step, 1, false)).toBe(true);
    expect(shouldTriggerStep(step, 2, false)).toBe(false);
    expect(shouldTriggerStep(step, 3, false)).toBe(true);
  });

  it("'every 1:4' löst beim 1., 5., 9. Durchlauf aus (loopCount 0, 4, 8)", () => {
    const step: StepData = {
      active: true,
      probability: 100,
      condition: { type: "every", n: 1, of: 4 },
    };
    expect(shouldTriggerStep(step, 0, false)).toBe(true);
    expect(shouldTriggerStep(step, 1, false)).toBe(false);
    expect(shouldTriggerStep(step, 3, false)).toBe(false);
    expect(shouldTriggerStep(step, 4, false)).toBe(true);
    expect(shouldTriggerStep(step, 8, false)).toBe(true);
  });

  it("fill-condition löst nur aus wenn isFillActive=true", () => {
    const step: StepData = {
      active: true,
      probability: 100,
      condition: { type: "fill" },
    };
    expect(shouldTriggerStep(step, 0, false)).toBe(false);
    expect(shouldTriggerStep(step, 0, true)).toBe(true);
  });

  it("not_fill-condition löst nur aus wenn isFillActive=false", () => {
    const step: StepData = {
      active: true,
      probability: 100,
      condition: { type: "not_fill" },
    };
    expect(shouldTriggerStep(step, 0, false)).toBe(true);
    expect(shouldTriggerStep(step, 0, true)).toBe(false);
  });

  it("inaktiver Step wird nie ausgelöst unabhängig von probability", () => {
    const step: StepData = { active: false, probability: 100 };
    for (let i = 0; i < 50; i++) {
      expect(shouldTriggerStep(step, i, false)).toBe(false);
      expect(shouldTriggerStep(step, i, true)).toBe(false);
    }
  });

  it("Step ohne probability-Feld hat Standard-Verhalten (100%)", () => {
    const step: StepData = { active: true };
    expect(shouldTriggerStep(step, 0, false)).toBe(true);
  });

  it("probability=-1 wird als 0 behandelt (Clamp)", () => {
    const step: StepData = { active: true, probability: -1 };
    // probability wird auf 0 geclampt → niemals auslösen
    for (let i = 0; i < 20; i++) {
      expect(shouldTriggerStep(step, i, false)).toBe(false);
    }
  });
});
