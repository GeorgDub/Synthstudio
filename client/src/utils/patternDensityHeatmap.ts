/**
 * patternDensityHeatmap.ts
 * ============================================================
 * Pure-Helper: 2D-Heatmap-Daten fuer Multi-Part-Pattern.
 *
 * Komplementaer zu patternDensity.ts (DensityMap, dense cells)
 * und patternDensityAnalyzer.ts (global density-Score).
 *
 * Diese Variante produziert SPARSE Daten — nur aktive Cells werden
 * gespeichert (cells.length === Summe aktiver Steps), nicht das
 * gesamte 2D-Raster. Dadurch effizient fuer Pattern mit niedriger
 * Density (z.B. 16-Step-Pattern, 4 Parts, ~4 Hits => 4 Cells statt 64).
 *
 * Zielanwendungen:
 *   - Heatmap-Visualisierung (Canvas/SVG) mit value-getoenten Farben
 *   - Hotspot-Highlighting in MultiTrack-Step-Grid
 *   - Pattern-Statistik (avgDensity, maxValue) als Quick-Glance-Badges
 *
 * Design-Notes:
 *   - velocity wird auf [0,1] geclamped (NaN/neg/>1 -> 1, undefined -> 1)
 *   - inactive Steps werden NICHT in cells aufgenommen (sparse storage)
 *   - stepCount = max length aller parts (kuerzere Parts sind "implizit padded")
 *   - empty -> alle Zaehler 0, kein Crash
 *   - findHotspot deterministisch: bei ties wird der FIRST gefundene zurueckgegeben
 *     (iteration order entspricht der Reihenfolge in cells[])
 *
 * ============================================================
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PatternRowLike {
  partId?: string;
  partName?: string;
  steps: { active: boolean; velocity?: number }[];
}

export interface HeatmapCell {
  partIndex: number;
  stepIndex: number;
  /** Active * clamped velocity ∈ [0,1] */
  value: number;
}

export interface HeatmapData {
  /** Sparse: only active cells included. */
  cells: HeatmapCell[];
  partCount: number;
  /** Max length across all parts. */
  stepCount: number;
  /** Highest cell value (0 if no active cells). */
  maxValue: number;
  /** Total active-step-count / (partCount * stepCount). 0 bei empty. */
  avgDensity: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Sanitize velocity to [0,1]; undefined/NaN/Infinity/neg/>1 → 1. */
function sanitizeVelocity(v: number | undefined): number {
  if (v === undefined) return 1;
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  if (v < 0) return 1;
  if (v > 1) return 1;
  return v;
}

// ─── buildHeatmap ─────────────────────────────────────────────────────────────

/**
 * Bauen einer Sparse-Heatmap aus Multi-Part-Pattern-Daten.
 *
 * - Nur aktive Steps werden als HeatmapCell emittiert (sparse).
 * - stepCount = max(parts[i].steps.length).
 * - velocity-Werte werden auf [0,1] geclamped.
 *
 * Defensiv: leere parts → leeres HeatmapData mit allen Zaehlern 0.
 */
export function buildHeatmap(parts: PatternRowLike[]): HeatmapData {
  if (!Array.isArray(parts) || parts.length === 0) {
    return {
      cells: [],
      partCount: 0,
      stepCount: 0,
      maxValue: 0,
      avgDensity: 0,
    };
  }

  const partCount = parts.length;
  let stepCount = 0;
  for (const p of parts) {
    if (p && Array.isArray(p.steps) && p.steps.length > stepCount) {
      stepCount = p.steps.length;
    }
  }

  const cells: HeatmapCell[] = [];
  let maxValue = 0;
  let activeCount = 0;

  for (let pi = 0; pi < partCount; pi++) {
    const part = parts[pi];
    if (!part || !Array.isArray(part.steps)) continue;
    const steps = part.steps;
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];
      if (!step || !step.active) continue;
      const value = sanitizeVelocity(step.velocity);
      cells.push({ partIndex: pi, stepIndex: si, value });
      activeCount++;
      if (value > maxValue) maxValue = value;
    }
  }

  const total = partCount * stepCount;
  const avgDensity = total > 0 ? activeCount / total : 0;

  return {
    cells,
    partCount,
    stepCount,
    maxValue,
    avgDensity,
  };
}

// ─── columnDensity ────────────────────────────────────────────────────────────

/**
 * Anteil der parts, deren steps[stepIndex] aktiv ist.
 *
 * Defensiv: out-of-bounds stepIndex / empty parts / NaN → 0.
 */
export function columnDensity(parts: PatternRowLike[], stepIndex: number): number {
  if (!Array.isArray(parts) || parts.length === 0) return 0;
  if (typeof stepIndex !== "number" || !Number.isFinite(stepIndex) || stepIndex < 0) return 0;
  const idx = Math.floor(stepIndex);

  let active = 0;
  let total = 0;
  for (const p of parts) {
    if (!p || !Array.isArray(p.steps)) continue;
    total++;
    if (idx < p.steps.length) {
      const step = p.steps[idx];
      if (step && step.active) active++;
    }
  }
  if (total === 0) return 0;
  return active / total;
}

// ─── rowDensity ───────────────────────────────────────────────────────────────

/**
 * Anteil aktiver steps innerhalb eines Parts.
 *
 * Defensiv: missing/empty part → 0.
 */
export function rowDensity(part: PatternRowLike): number {
  if (!part || !Array.isArray(part.steps) || part.steps.length === 0) return 0;
  let active = 0;
  for (const step of part.steps) {
    if (step && step.active) active++;
  }
  return active / part.steps.length;
}

// ─── findHotspot ──────────────────────────────────────────────────────────────

/**
 * Sucht die Cell mit dem hoechsten value.
 * Bei Ties wird die ERSTE gefundene Cell zurueckgegeben (deterministisch).
 *
 * - leere Heatmap (cells.length === 0) → null.
 */
export function findHotspot(
  heatmap: HeatmapData,
): { partIndex: number; stepIndex: number; value: number } | null {
  if (!heatmap || !Array.isArray(heatmap.cells) || heatmap.cells.length === 0) {
    return null;
  }
  let best: HeatmapCell = heatmap.cells[0];
  for (let i = 1; i < heatmap.cells.length; i++) {
    const c = heatmap.cells[i];
    if (c.value > best.value) best = c;
  }
  return {
    partIndex: best.partIndex,
    stepIndex: best.stepIndex,
    value: best.value,
  };
}
