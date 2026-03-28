/**
 * Synthstudio – patternMorph.ts  (Phase 5, v1.9)
 *
 * Pure Algorithmus-Utility für Pattern Morphing zwischen zwei PatternData-Objekten.
 * Kein React, kein AudioContext, kein State.
 */
import type { StepData, PatternData, PartData } from "../audio/AudioEngine";

// ─── Step-Morphing ────────────────────────────────────────────────────────────

/**
 * Deterministische Version von morphStep für Tests.
 * Anstatt Math.random() zu verwenden, entscheidet `seed` (0–1) ob ein
 * probabilistischer Step aktiv ist.
 *
 * Interpolationsregeln:
 *   - Beide aktiv:   immer aktiv
 *   - Keiner aktiv:  immer inaktiv
 *   - Nur A aktiv:   aktiv wenn seed < (1 - amount)
 *   - Nur B aktiv:   aktiv wenn seed < amount
 *
 * Velocity und Pitch werden linear interpoliert (unabhängig vom active-Zustand).
 * Probability und Condition werden von dem dominierenden Pattern übernommen.
 */
export function morphStepDeterministic(
  stepA: StepData,
  stepB: StepData,
  amount: number,
  seed: number
): StepData {
  const clampedAmount = Math.max(0, Math.min(1, amount));

  let active: boolean;
  if (stepA.active && stepB.active) {
    active = true;
  } else if (!stepA.active && !stepB.active) {
    active = false;
  } else if (stepA.active && !stepB.active) {
    // A aktiv, B inaktiv: Wahrscheinlichkeit = (1 - amount)
    active = seed < (1 - clampedAmount);
  } else {
    // B aktiv, A inaktiv: Wahrscheinlichkeit = amount
    active = seed < clampedAmount;
  }

  const velocityA = stepA.velocity ?? 1;
  const velocityB = stepB.velocity ?? 1;
  const velocity = velocityA + (velocityB - velocityA) * clampedAmount;

  const pitchA = stepA.pitch ?? 0;
  const pitchB = stepB.pitch ?? 0;
  const pitch = pitchA + (pitchB - pitchA) * clampedAmount;

  const probabilityA = stepA.probability ?? 1;
  const probabilityB = stepB.probability ?? 1;
  const probability = probabilityA + (probabilityB - probabilityA) * clampedAmount;

  // Condition: dominierendes Pattern (amount < 0.5 → A, sonst → B)
  const condition = clampedAmount < 0.5 ? stepA.condition : stepB.condition;

  return {
    active,
    velocity,
    pitch,
    probability,
    condition: condition ?? { type: "always" },
  };
}

/**
 * Interpoliert einen einzelnen Step zwischen A und B mit Math.random().
 *
 * amount 0.0 = vollständig Muster A
 * amount 1.0 = vollständig Muster B
 */
export function morphStep(
  stepA: StepData,
  stepB: StepData,
  amount: number
): StepData {
  return morphStepDeterministic(stepA, stepB, amount, Math.random());
}

// ─── Stiller Part (Platzhalter für fehlende Parts) ───────────────────────────

function _silentStep(): StepData {
  return {
    active: false,
    velocity: 0,
    pitch: 0,
    probability: 1,
    condition: { type: "always" },
  };
}

function _silentPart(id: string, name: string, stepCount: number): PartData {
  return {
    id,
    name,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps: Array.from({ length: stepCount }, _silentStep),
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

// ─── Pattern-Morphing ─────────────────────────────────────────────────────────

/**
 * Morpht zwei vollständige Patterns.
 *
 * Parts werden anhand der Index-Position gemappt (Part 0 → Part 0, etc.).
 * Wenn ein Pattern weniger Parts hat, wird ein stiller Part als Platzhalter
 * verwendet. Die Ausgabe enthält max(A.parts.length, B.parts.length) Parts.
 *
 * Gibt ein neues PatternData-Objekt zurück (nicht mutierend).
 */
export function morphPatterns(
  patternA: PatternData,
  patternB: PatternData,
  amount: number
): PatternData {
  const clampedAmount = Math.max(0, Math.min(1, amount));
  const partCount = Math.max(patternA.parts.length, patternB.parts.length);
  const stepCount = Math.max(
    patternA.parts[0]?.steps.length ?? 16,
    patternB.parts[0]?.steps.length ?? 16
  );

  const parts: PartData[] = [];

  for (let i = 0; i < partCount; i++) {
    const partA = patternA.parts[i] ?? _silentPart(`part-${i}`, `Part ${i + 1}`, stepCount);
    const partB = patternB.parts[i] ?? _silentPart(`part-${i}`, `Part ${i + 1}`, stepCount);

    const stepsA = partA.steps;
    const stepsB = partB.steps;
    const maxSteps = Math.max(stepsA.length, stepsB.length);

    const morphedSteps: StepData[] = [];
    for (let s = 0; s < maxSteps; s++) {
      const sA = stepsA[s] ?? _silentStep();
      const sB = stepsB[s] ?? _silentStep();
      morphedSteps.push(morphStep(sA, sB, clampedAmount));
    }

    // Part-Metadaten von dem dominierenden Pattern übernehmen
    const dominantPart = clampedAmount < 0.5 ? partA : partB;

    parts.push({
      ...dominantPart,
      steps: morphedSteps,
    });
  }

  // Ergebnis-Pattern: Metadaten vom dominierenden Pattern
  const dominantPattern = clampedAmount < 0.5 ? patternA : patternB;

  return {
    ...dominantPattern,
    id: `morph-${patternA.id}-${patternB.id}`,
    name: `Morph ${patternA.name} → ${patternB.name}`,
    parts,
  };
}
