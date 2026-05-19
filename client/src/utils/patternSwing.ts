/**
 * client/src/utils/patternSwing.ts (v3.162.0)
 *
 * Pure helpers for swing-quantization of step patterns.
 *
 * Swing shifts off-beat steps (the "and"-positions in MPC terminology)
 * slightly later in time, producing the classic shuffle/groove feel.
 *
 * Design:
 *   - swingOffsetForStep() returns the per-step time-shift in seconds.
 *   - buildSwingMap() maps an active step-pattern to {stepIndex, swingDeltaMs} pairs.
 *
 * The helpers are intentionally side-effect-free and deterministic so they
 * can be unit-tested without the audio engine.
 */

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Swing amount in [0..1].
 *   0   = straight (no shift)
 *   0.5 = full shuffle (max half-step late on off-beats)
 */
export type SwingAmount = number;

export interface SwungStep {
  stepIndex: number;
  /** Verschiebung in Millisekunden relativ zur straight-Position. */
  swingDeltaMs: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const SWING_NONE = 0;
export const SWING_LIGHT = 0.15;
export const SWING_MEDIUM = 0.33;
export const SWING_HEAVY = 0.5;

// ─── Internal helpers ────────────────────────────────────────────────────────

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function clampSwing(swing: number): number {
  if (!isFiniteNumber(swing) || swing <= 0) return 0;
  if (swing > 1) return 1;
  return swing;
}

/**
 * Returns true if `stepIndex` is an "off-beat" position for the given resolution.
 *
 * For all supported resolutions (8 / 16 / 32) the off-beat positions are the
 * odd indices — straight 8ths/16ths/32nds alternate on / off / on / off …
 * across the step grid. The swing-shift always moves the odd-index pulses.
 */
function isOffBeatIndex(stepIndex: number, resolution: 8 | 16 | 32): boolean {
  if (!Number.isInteger(stepIndex) || stepIndex < 0) return false;
  // Resolution-Parameter ist Teil der Public-API für künftige Erweiterungen
  // (z.B. 32stel-Shuffle mit alternativen Off-Beat-Patterns). Heute reicht
  // der ungerade-Index-Check, der für 8/16/32 identisch ist.
  if (resolution !== 8 && resolution !== 16 && resolution !== 32) return false;
  return stepIndex % 2 === 1;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Berechnet den Step-Offset in Sub-Beat-Sekunden für einen gegebenen Step-Index
 * bei einem gegebenen Swing-Amount + Resolution.
 *
 * Bei resolution = 16: off-beat positions sind die ungeraden Indices (1, 3, 5...).
 * Diese werden um (swing × stepDuration × 0.5) nach hinten verschoben.
 *
 * Bei resolution = 8: off-beat sind ungerade Indices der 8tel-Stufen.
 *
 * @returns Offset in Sekunden (0 = no shift, positiv = shifted later).
 */
export function swingOffsetForStep(
  stepIndex: number,
  swingAmount: SwingAmount,
  stepDurationSec: number,
  resolution: 8 | 16 | 32,
): number {
  if (!isFiniteNumber(stepIndex)) return 0;
  if (!isFiniteNumber(stepDurationSec) || stepDurationSec <= 0) return 0;

  const swing = clampSwing(swingAmount);
  if (swing === 0) return 0;

  if (!isOffBeatIndex(stepIndex, resolution)) return 0;

  return swing * stepDurationSec * 0.5;
}

/**
 * Wendet Swing auf ein Boolean-Pattern (16-step) an indem es die On-Beat-Pulses
 * an Even-Indices liest, die Off-Beat-Pulses an Odd-Indices verschoben anwendet.
 *
 * Liefert ein neues Pattern (immutable). Für reine boolean[]-Pattern macht
 * "swing" allerdings KEINEN visuellen Unterschied — der Helper liefert daher
 * eine "swung-shifted" Repräsentation: Array von { stepIndex, swingDeltaMs } Pairs.
 *
 * Nur aktive Steps (pattern[i] === true) werden gemappt; inaktive Steps werden
 * übersprungen (klein-O über die Anzahl Pattern-Steps).
 */
export function buildSwingMap(
  pattern: readonly boolean[],
  swingAmount: SwingAmount,
  stepDurationSec: number,
  resolution: 8 | 16 | 32,
): SwungStep[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];
  if (!isFiniteNumber(stepDurationSec) || stepDurationSec <= 0) return [];

  const swing = clampSwing(swingAmount);

  const out: SwungStep[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== true) continue;
    const offsetSec = swingOffsetForStep(i, swing, stepDurationSec, resolution);
    out.push({
      stepIndex: i,
      swingDeltaMs: offsetSec * 1000,
    });
  }
  return out;
}
