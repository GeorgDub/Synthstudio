/**
 * Synthstudio – quantizeGrid.ts
 *
 * Quantisiert Steps auf ein mathematisches Raster.
 * Nutzen: Zufällig gesetzte Steps (via MIDI-Recording oder Randomize)
 * werden auf das nächste saubere Raster eingerastet.
 *
 * Stärke:
 *  100% = hartes Quantize (exakt auf Raster)
 *  50%  = halbwegs (Steps werden zur Hälfte gezogen)
 *  0%   = kein Quantize
 */

import type { StepData } from "@/audio/AudioEngine";

export type QuantizeGrid = "1/4" | "1/8" | "1/16" | "1/32";

const GRID_DIVISIONS: Record<QuantizeGrid, number> = {
  "1/4":  4,
  "1/8":  8,
  "1/16": 16,
  "1/32": 32,
};

export interface QuantizeOptions {
  grid: QuantizeGrid;
  strength: number;      // 0–1 (0=kein, 1=hart)
  stepCount: number;     // Gesamtanzahl Steps (16 oder 32)
  swingAmount?: number;  // 0–0.5 (Swing nach Quantize anwenden)
}

/**
 * Quantisiert eine Step-Array (verschiebt Steps auf das Raster).
 * Da DrumMachine-Steps diskrete Slots sind, werden Steps entfernt/kopiert.
 *
 * Robustheit (BUG-005 / TASK-104): Wenn `pt.steps.length` und `pattern.stepCount`
 * auseinanderlaufen (kann durch MIDI-Import, Pattern-Morph oder geladene
 * Projekte passieren), darf der Code nicht crashen. Wir clampen daher alle
 * Index-Zugriffe an die tatsächliche Array-Länge und iterieren nur so weit
 * wie das Steps-Array reicht.
 */
export function quantizeSteps(
  steps: StepData[],
  opts: QuantizeOptions,
): StepData[] {
  const { grid, strength, stepCount } = opts;
  if (strength <= 0) return steps;
  if (!steps || steps.length === 0) return steps;

  const divisions = GRID_DIVISIONS[grid];
  // Wenn stepCount unsinnig ist (0 / negativ / NaN), fallen wir auf die
  // tatsächliche Step-Länge zurück, statt durch Null zu teilen.
  const effectiveStepCount = stepCount > 0 ? stepCount : steps.length;
  const stepsPerDiv = effectiveStepCount / divisions;

  const result: StepData[] = steps.map((s) => ({ ...s, active: false }));
  // Maximal-Index ist durch BEIDE Grenzen begrenzt: das logische Raster
  // (stepCount) UND das physische Steps-Array (steps.length).
  const maxIdx = Math.min(result.length, effectiveStepCount) - 1;
  if (maxIdx < 0) return result;

  const limit = Math.min(steps.length, effectiveStepCount);
  for (let i = 0; i < limit; i++) {
    if (!steps[i]?.active) continue;

    // Nächsten Raster-Punkt finden
    const nearestGrid = stepsPerDiv > 0
      ? Math.round(i / stepsPerDiv) * stepsPerDiv
      : i;
    const clampedGrid = Math.max(0, Math.min(maxIdx, nearestGrid));

    // Interpolierter Ziel-Index (strength=1 → genau auf Raster)
    const targetIdx = Math.round(i + (clampedGrid - i) * strength);
    const finalIdx  = Math.max(0, Math.min(maxIdx, targetIdx));

    const target = result[finalIdx];
    if (!target) continue; // Defensiv – sollte durch maxIdx-Clamp unmöglich sein

    // Step am Ziel-Index aktivieren (Velocity aus Quell-Step)
    if (!target.active) {
      result[finalIdx] = { ...steps[i] };
    } else {
      // Kollision: höhere Velocity gewinnt
      if ((steps[i].velocity ?? 100) > (target.velocity ?? 100)) {
        result[finalIdx] = { ...steps[i] };
      }
    }
  }

  return result;
}

/** Formatiert Quantize-Grid-Auflösung für die UI. */
export function formatGrid(grid: QuantizeGrid): string {
  return grid;
}
