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
 */
export function quantizeSteps(
  steps: StepData[],
  opts: QuantizeOptions,
): StepData[] {
  const { grid, strength, stepCount } = opts;
  if (strength <= 0) return steps;

  const divisions = GRID_DIVISIONS[grid];
  const stepsPerDiv = stepCount / divisions;

  const result: StepData[] = steps.map((s, _i) => ({ ...s, active: false }));

  for (let i = 0; i < stepCount; i++) {
    if (!steps[i]?.active) continue;

    // Nächsten Raster-Punkt finden
    const nearestGrid = Math.round(i / stepsPerDiv) * stepsPerDiv;
    const clampedGrid = Math.max(0, Math.min(stepCount - 1, nearestGrid));

    // Interpolierter Ziel-Index (strength=1 → genau auf Raster)
    const targetIdx = Math.round(i + (clampedGrid - i) * strength);
    const finalIdx  = Math.max(0, Math.min(stepCount - 1, targetIdx));

    // Step am Ziel-Index aktivieren (Velocity aus Quell-Step)
    if (!result[finalIdx].active) {
      result[finalIdx] = { ...steps[i] };
    } else {
      // Kollision: höhere Velocity gewinnt
      if ((steps[i].velocity ?? 100) > (result[finalIdx].velocity ?? 100)) {
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
