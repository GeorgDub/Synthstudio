/**
 * Synthstudio – Slide/Glide-Utilities (v2.14, TB-303-Style)
 *
 * Pure Helpers für die Berechnung des Per-Step-Slides.
 * Wird vom AudioEngine konsumiert; getrennt damit pro-Funktion testbar.
 */

export interface SlideContext {
  /** True wenn der unmittelbar vorhergehende getriggerte Step `slide=true` hatte. */
  prevHadSlide: boolean;
  /** Frequenz (Hz) des vorherigen Triggers. Undefined wenn noch keiner war. */
  prevFreq?: number;
  /** Aktuelle Ziel-Frequenz (Hz). */
  currentFreq: number;
  /** Dauer eines Steps in Sekunden. */
  stepDurationSec: number;
}

export interface SlideDecision {
  /** Soll Glide angewendet werden? */
  applyGlide: boolean;
  /** Glide-Zeit in Sekunden (0 wenn kein Glide). */
  glideSeconds: number;
  /** Frequenz, bei der das Glide-Ramping starten soll. */
  startFreq?: number;
}

/**
 * Faktor (0–1) der Step-Dauer den der Glide-Ramp einnimmt.
 * 0.8 = der Pitch erreicht den Zielwert bei 80% der Step-Länge,
 * was sich musikalisch wie das echte 303-Slide anfühlt (kurz vor dem
 * nächsten Step-Hit greift die Ziel-Tonhöhe).
 */
export const SLIDE_DURATION_FACTOR = 0.8;

/**
 * Berechnet ob für einen Step Glide angewendet werden soll und mit welchen
 * Parametern. Pure Funktion ohne Audio-Context.
 */
export function decideSlide(ctx: SlideContext): SlideDecision {
  if (!ctx.prevHadSlide) {
    return { applyGlide: false, glideSeconds: 0 };
  }
  if (ctx.prevFreq == null || !Number.isFinite(ctx.prevFreq) || ctx.prevFreq <= 0) {
    return { applyGlide: false, glideSeconds: 0 };
  }
  if (Math.abs(ctx.prevFreq - ctx.currentFreq) < 0.001) {
    // Identische Frequenzen → kein hörbarer Glide nötig
    return { applyGlide: false, glideSeconds: 0 };
  }
  const glideSeconds = Math.max(0.005, ctx.stepDurationSec * SLIDE_DURATION_FACTOR);
  return { applyGlide: true, glideSeconds, startFreq: ctx.prevFreq };
}

/**
 * Findet im Steps-Array den Index des nächsten aktiven Steps (zyklisch).
 * Wird z.B. zur Anzeige des Slide-Ziels in der UI genutzt.
 */
export function findNextActiveStepIndex(
  steps: Array<{ active: boolean }>,
  fromIndex: number,
): number {
  if (steps.length === 0) return -1;
  for (let off = 1; off <= steps.length; off++) {
    const idx = (fromIndex + off) % steps.length;
    if (steps[idx]?.active) return idx;
  }
  return -1;
}
