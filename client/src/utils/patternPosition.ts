/**
 * Synthstudio — patternPosition.ts (v3.37.0)
 *
 * Helper für UI-Bar.Beat.Sub-Anzeige aus MIDI-Beat-/Step-Positionen. Closes
 * v3.36 Caveat 'Pattern-Length > 16 fold-display' — wenn ein externer
 * DAW-Master SPP-Werte sendet, die über die aktuelle Pattern-Länge
 * hinausgehen (Song-Position vs. Loop-Position), wird der Step modulo
 * gefaltet UND ein "(loop)"-Hinweis angezeigt.
 *
 * Isomorphic: reine Pure-Function, keine React-/Electron-Imports.
 */

/** Anzahl Beats pro Bar (4/4 Standard). 16 Steps = 4 Beats = 1 Bar. */
export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;

export interface PatternPositionDisplay {
  /** Bar (1-indexed). Bei step≥stepCount: bezogen auf den gefalteten Step. */
  bar: number;
  /** Beat innerhalb des Bars (1..4). */
  beat: number;
  /** Sub-Step innerhalb des Beats (1..4). */
  sub: number;
  /** Der tatsächlich klingende Step im Pattern (modulo stepCount). */
  effectiveStep: number;
  /** Wahr, wenn positionStep ≥ stepCount (= Master ist hinter dem Loop-Ende). */
  isLooped: boolean;
  /** Anzahl Loops, die der Position-Pointer bereits "übersprungen" hat. */
  loopCount: number;
  /** Pre-formatierter Anzeige-String "Bar B.b.s" oder "Bar B.b.s (loop)". */
  label: string;
}

/**
 * Formatiert eine Step-/MIDI-Beat-Position in Bar.Beat.Sub-Notation und
 * berücksichtigt Pattern-Länge.
 *
 * Beispiele bei stepCount=16:
 *   formatPatternPosition(0, 16)  → "Bar 1.1.1",        effectiveStep=0
 *   formatPatternPosition(5, 16)  → "Bar 1.2.2",        effectiveStep=5
 *   formatPatternPosition(15, 16) → "Bar 1.4.4",        effectiveStep=15
 *   formatPatternPosition(16, 16) → "Bar 1.1.1 (loop)", effectiveStep=0,
 *                                                       loopCount=1
 *   formatPatternPosition(48, 16) → "Bar 1.1.1 (loop)", effectiveStep=0,
 *                                                       loopCount=3
 *
 * Defensiv: negative Steps werden auf 0 geclampt, stepCount ≤ 0 wird auf
 * 16 normalisiert, NaN/Infinity-Inputs werden defensive auf 0 geklemmt.
 */
export function formatPatternPosition(
  positionStep: number,
  stepCount: number,
): PatternPositionDisplay {
  const safeStep = Number.isFinite(positionStep) && positionStep >= 0
    ? Math.floor(positionStep)
    : 0;
  const safeStepCount = Number.isFinite(stepCount) && stepCount > 0
    ? Math.floor(stepCount)
    : STEPS_PER_BAR;

  const loopCount = Math.floor(safeStep / safeStepCount);
  const effectiveStep = safeStep % safeStepCount;
  const isLooped = loopCount > 0;

  // Bar.Beat.Sub innerhalb des effektiv klingenden Bereiches.
  const bar  = Math.floor(effectiveStep / STEPS_PER_BAR) + 1;
  const beat = Math.floor((effectiveStep % STEPS_PER_BAR) / STEPS_PER_BEAT) + 1;
  const sub  = (effectiveStep % STEPS_PER_BEAT) + 1;

  const base = `Bar ${bar}.${beat}.${sub}`;
  const label = isLooped ? `${base} (loop)` : base;

  return { bar, beat, sub, effectiveStep, isLooped, loopCount, label };
}
