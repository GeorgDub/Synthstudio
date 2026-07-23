/**
 * esxImportPreview.ts — reine Vorschau-/Zusammenfassung eines geparsten ESX-Banks
 * für den Unified-Import-Dialog.
 *
 * Der Dialog zeigt dem User VOR der Entscheidung (Konvertieren vs. direkt in
 * Sequenzer), was in der Datei steckt: welche Patterns belegt sind, ihr BPM,
 * ihre effektive Step-Länge (16..128 via patternLength) und — entscheidend —
 * welche Patterns beim E2S-Export **reduziert** werden müssen (>64 Steps, da die
 * E2S nur 4 Bänke = 64 fasst). Plus die Sample-Anzahl.
 *
 * Rein + seiteneffektfrei → in Node testbar; keine Kopplung an DOM/AudioEngine.
 */

import type { EsxBank, EsxPattern } from "../korg/esxParser";
import { E2_MAX_STEPS } from "../patternStepReduce";

export interface EsxImportPatternPreview {
  index: number;
  name: string;
  bpm: number;
  /** Effektive Step-Länge (16..128 = patternLength × 16). */
  effectiveSteps: number;
  /** true, wenn effectiveSteps > 64 → beim E2S-Konvertieren reduzieren. */
  needsReduction: boolean;
  /** Anzahl Drum-Parts mit mindestens einem aktiven Step. */
  activeDrumParts: number;
  /** true, wenn mind. ein Keyboard-Part Melodiedaten (Note ≠ 0) trägt. */
  hasMelody: boolean;
}

export interface EsxImportPreview {
  source: string;
  /** Anzahl belegter (non-empty) Patterns. */
  patternCount: number;
  monoSamples: number;
  stereoSamples: number;
  /** Wie viele Patterns beim E2S-Export reduziert werden müssten (>64 Steps). */
  patternsNeedingReduction: number;
  patterns: EsxImportPatternPreview[];
  warnings: string[];
}

/** Vorschau eines einzelnen Patterns. Rein. */
export function previewEsxPattern(
  pattern: EsxPattern,
  target: number = E2_MAX_STEPS
): EsxImportPatternPreview {
  const activeDrumParts = pattern.parts.filter(p =>
    p.steps.some(s => s.active)
  ).length;
  const hasMelody = (pattern.keyboardParts ?? []).some(kp =>
    kp.note.some(n => n !== 0)
  );
  return {
    index: pattern.index,
    name: pattern.name,
    bpm: pattern.bpm,
    effectiveSteps: pattern.effectiveSteps,
    needsReduction: pattern.effectiveSteps > target,
    activeDrumParts,
    hasMelody,
  };
}

/**
 * Fasst einen geparsten ESX-Bank zu einer Import-Vorschau zusammen. `target` ist
 * das E2S-Step-Limit (Default 64) für die Reduktions-Kennzeichnung.
 */
export function buildEsxImportPreview(
  bank: EsxBank,
  target: number = E2_MAX_STEPS
): EsxImportPreview {
  const patterns = bank.patterns.map(p => previewEsxPattern(p, target));
  return {
    source: bank.source,
    patternCount: patterns.length,
    monoSamples: bank.monoSamples.length,
    stereoSamples: bank.stereoSamples.length,
    patternsNeedingReduction: patterns.filter(p => p.needsReduction).length,
    patterns,
    warnings: bank.warnings,
  };
}
