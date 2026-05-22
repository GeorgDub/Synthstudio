/**
 * Synthstudio – patternDensityAnalyzer.ts (v3.159.0)
 *
 * Pure-Helpers für SINGLE-PATTERN-Analyse: density (hits/total ratio),
 * consecutive runs, average distance between hits, syncopation score,
 * sparse/medium/dense categorization.  Foundation für Pattern-Suggestion UX,
 * Pattern-Bank Density-Filter und Auto-Mix-Hints.
 *
 * Operiert auf `readonly boolean[]` (ein einzelnes Pattern als Step-Array).
 * Nicht zu verwechseln mit der multi-part-aggregierten DensityMap aus
 * `patternDensity.ts` — siehe Abschnitt unten.
 *
 * Public API:
 *  - calculateDensity(pattern) → DensityResult
 *  - countConsecutiveRuns(pattern) → number[]
 *  - hitDistances(pattern) → number[]
 *  - syncopationScore(pattern) → number 0..1
 *  - categorizeDensity(density) → "empty" | "sparse" | "medium" | "dense" | "full"
 *
 * Pure & Node-testbar.  Tests: tests/features/pattern-density-analyzer.test.ts
 *
 * ─── Verhältnis zu `patternDensity.ts` (Multi-Part) ───────────────────────
 *
 * Diese Datei (`patternDensityAnalyzer.ts`) : SINGLE-Pattern-Analyse,
 *   Input = `readonly boolean[]`.  Liefert Density-Kategorie + Statistiken
 *   (runs, distances, syncopation). Konsumiert in DrumMachine.tsx
 *   (Density-Badge im Header), `patternBankDensity.ts` (Bank-Filter).
 *
 * `patternDensity.ts`                       : MULTI-Part-Density-Map,
 *   Input = `PartData[]` (Drum-Machine Multi-Track-State).  Liefert
 *   gewichtetes 2D-Cells-Array + per-step + per-part Aggregate.
 *   Konsumiert in `useMixAnalytics` (Mix-Heatmap, Flashing-Pair-Detection).
 *
 * Beide Module sind KEINE Duplikate — sie bedienen unterschiedliche
 * Granularitäten und Datenshapes. Sie koexistieren bewusst.
 *
 * Wer ein einzelnes Pattern bewerten will (Step-Array) → diese Datei.
 * Wer ein Multi-Track-Set analysieren will (PartData[]) → `patternDensity.ts`.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export type DensityCategory = "empty" | "sparse" | "medium" | "dense" | "full";

export interface DensityResult {
  /** hits / total — 0..1 */
  density: number;
  /** Anzahl der true-Steps */
  hits: number;
  /** Gesamtanzahl Steps */
  total: number;
  /** Kategorische Einordnung */
  category: DensityCategory;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Berechnet die Density eines Patterns. Liefert hits/total ratio + kategorische
 * Einordnung.
 *
 * Schwellen:
 *  - empty:  density === 0
 *  - sparse: 0 < density <= 0.25
 *  - medium: 0.25 < density <= 0.5
 *  - dense:  0.5 < density < 1
 *  - full:   density === 1
 */
export function calculateDensity(pattern: readonly boolean[]): DensityResult {
  const total = pattern.length;
  if (total === 0) {
    return { density: 0, hits: 0, total: 0, category: "empty" };
  }
  let hits = 0;
  for (const b of pattern) if (b) hits++;
  const density = hits / total;
  return {
    density,
    hits,
    total,
    category: categorizeDensity(density),
  };
}

/**
 * Kategorische Einordnung einer Density (0..1).
 */
export function categorizeDensity(density: number): DensityCategory {
  if (!Number.isFinite(density) || density <= 0) return "empty";
  if (density >= 1) return "full";
  if (density <= 0.25) return "sparse";
  if (density <= 0.5) return "medium";
  return "dense";
}

/**
 * Zählt aufeinanderfolgende true-Runs.  Liefert die Längen aller Runs in
 * Ordnung.  Beispiel: [T, T, F, T, F, F, T, T, T] → [2, 1, 3].
 */
export function countConsecutiveRuns(pattern: readonly boolean[]): number[] {
  const runs: number[] = [];
  let cur = 0;
  for (const b of pattern) {
    if (b) {
      cur++;
    } else if (cur > 0) {
      runs.push(cur);
      cur = 0;
    }
  }
  if (cur > 0) runs.push(cur);
  return runs;
}

/**
 * Distanzen zwischen aufeinanderfolgenden Hits. Liefert array mit den
 * Step-Distanzen zwischen jedem Hit-Paar.
 *
 * Beispiel: [T, F, F, T, F, T] → distances [3, 2].
 *
 * Bei <= 1 Hit → leeres Array.
 */
export function hitDistances(pattern: readonly boolean[]): number[] {
  const distances: number[] = [];
  let lastHitIdx = -1;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i]) {
      if (lastHitIdx >= 0) {
        distances.push(i - lastHitIdx);
      }
      lastHitIdx = i;
    }
  }
  return distances;
}

/**
 * Syncopation-Score: misst wie unregelmaessig ein Pattern ist.
 *
 * Approach: standard-deviation der Hit-Distanzen, normalisiert auf 0..1.
 * Bei perfekt-regelmaessigen Hits (z.B. 4-on-the-floor) ist Distance immer
 * identisch → stdDev = 0 → Syncopation = 0.
 * Bei unregelmaessigen Patterns → höher.
 *
 * Defensive: < 2 Hits → 0 (keine Distanzen).
 */
export function syncopationScore(pattern: readonly boolean[]): number {
  const distances = hitDistances(pattern);
  if (distances.length < 2) return 0;

  let sum = 0;
  for (const d of distances) sum += d;
  const mean = sum / distances.length;

  let variance = 0;
  for (const d of distances) variance += (d - mean) * (d - mean);
  variance /= distances.length;
  const stdDev = Math.sqrt(variance);

  // Normalisierung: stdDev kann theoretisch bis ~steps/2 gehen.
  // Pragmatisch: stdDev / steps ist meist 0..0.3 für echte Patterns.
  const normalized = Math.min(1, stdDev / (pattern.length * 0.25));
  return normalized;
}
