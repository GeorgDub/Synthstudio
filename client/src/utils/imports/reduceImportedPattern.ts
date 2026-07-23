/**
 * reduceImportedPattern.ts — Step-Reduktion auf der kanonischen Import-Ebene.
 *
 * Brücke zwischen der reinen Reduktions-Engine (`patternStepReduce`) und dem
 * gemeinsamen `ImportResult`-Modell. Der Import-Dialog ruft dies im Edit-Schritt
 * auf, BEVOR ein Pattern in den Sequenzer geladen oder zu `.e2spat`/`.e2sallpat`
 * konvertiert wird: hätte ein Quell-Pattern mehr als das E2-Limit (64) Steps
 * (z.B. eine >4-Bank-Quelle), werden alle Parts nach der gewählten Strategie auf
 * 64 gekürzt. Für 16-Step-Quellen (reale ESX-1) ist es ein No-op.
 *
 * Rein + seiteneffektfrei → in Node testbar; keine Kopplung an AudioEngine/DOM.
 */

import type { ImportResult, ImportedPattern } from "./types";
import {
  reduceSteps,
  stepReductionNeeded,
  E2_MAX_STEPS,
  type StepReductionStrategy,
} from "../patternStepReduce";

/** true, wenn irgendein Part des Patterns über `target` Steps hätte. */
export function patternNeedsReduction(
  pattern: ImportedPattern,
  target: number = E2_MAX_STEPS
): boolean {
  return (
    stepReductionNeeded(pattern.stepCount, target) ||
    pattern.parts.some(p => p.steps.length > target)
  );
}

/**
 * Reduziert ein einzelnes Import-Pattern auf `target` Steps. Gibt bei No-op
 * dieselbe Referenz zurück (kein unnötiges Kopieren / Re-Render).
 */
export function reduceImportedPatternSteps(
  pattern: ImportedPattern,
  target: number = E2_MAX_STEPS,
  strategy: StepReductionStrategy = "decimate"
): ImportedPattern {
  if (!patternNeedsReduction(pattern, target)) return pattern;
  const parts = pattern.parts.map(p => ({
    ...p,
    steps: reduceSteps(p.steps, target, strategy),
  }));
  return {
    ...pattern,
    stepCount: Math.min(pattern.stepCount, target),
    parts,
  };
}

export interface ReducedImportResult {
  result: ImportResult;
  /** Anzahl der Patterns, die tatsächlich reduziert wurden. */
  reducedCount: number;
}

/**
 * Reduziert alle Patterns eines `ImportResult` auf `target` Steps und meldet,
 * wie viele betroffen waren (für UI-Feedback: „3 Patterns von 128 auf 64
 * gekürzt"). Bleibt referenz-stabil, wenn nichts zu tun ist.
 */
export function reduceImportResultSteps(
  result: ImportResult,
  target: number = E2_MAX_STEPS,
  strategy: StepReductionStrategy = "decimate"
): ReducedImportResult {
  let reducedCount = 0;
  const patterns = result.patterns.map(p => {
    const reduced = reduceImportedPatternSteps(p, target, strategy);
    if (reduced !== p) reducedCount++;
    return reduced;
  });
  if (reducedCount === 0) return { result, reducedCount: 0 };
  return { result: { ...result, patterns }, reducedCount };
}
