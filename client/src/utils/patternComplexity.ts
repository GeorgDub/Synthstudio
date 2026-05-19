/**
 * client/src/utils/patternComplexity.ts (v3.171)
 *
 * Pure-Helper: berechnet einen 0..1 Complexity-Score für ein PatternData.
 * Kombiniert vier Sub-Metriken (density, syncopation, part-variation,
 * velocity-variation) zu einem einzigen Wert, plus eine kategorische
 * Einordnung für UI-Display.
 *
 * - density:           Peak bei optimalDensity (Default 0.35). 0 und 1 = 0.
 * - syncopation:       Standard-Deviation der Hit-Distanzen, normalisiert.
 * - partVariation:     Anteil der Parts mit >= 1 active step.
 * - velocityVariation: Standard-Deviation der Velocities (Sweet-Spot ~32).
 *
 * Defensive: leere Patterns / 0 Parts → alle Scores 0, category "minimal".
 */
import type { PatternData } from "../audio/AudioEngine";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ComplexityScoreBreakdown {
  /** Density-Score: 0..1. Peak bei 30-40% density (sweet spot). */
  densityScore: number;
  /** Syncopation-Score: 0..1. Mehr Variation in Hit-Distanzen = höher. */
  syncopationScore: number;
  /** Part-Variation: 0..1. Wie viele Parts haben != 0 hits. */
  partVariationScore: number;
  /** Velocity-Variation: 0..1. Mehr Velocity-Spread = höher (wenn vorhanden). */
  velocityVariationScore: number;
  /** Total: gewichteter Mittelwert der 4 sub-scores. */
  total: number;
}

export interface ComplexityOptions {
  /** Gewichtung pro Subscore. Default: jeweils 0.25. */
  weights?: Partial<{
    density: number;
    syncopation: number;
    partVariation: number;
    velocityVariation: number;
  }>;
  /** Optimal-Density für density-Score-Peak. Default 0.35 (35%). */
  optimalDensity?: number;
}

export type ComplexityCategory =
  | "minimal"
  | "simple"
  | "balanced"
  | "complex"
  | "chaotic";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_OPTIMAL_DENSITY = 0.35;
const DEFAULT_WEIGHT = 0.25;
const VELOCITY_SWEETSPOT_STDDEV = 32; // → score 1 wenn stdDev ~32 (Skala 0..127)
const VELOCITY_NORMALIZER = 64;
const SYNCOPATION_DEVIATION_WEIGHT = 0.5;
const DEFAULT_VELOCITY = 100;

// ─── Internal Helpers ────────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) /
    values.length;
  return Math.sqrt(variance);
}

// ─── Sub-Score Computations ──────────────────────────────────────────────────

function computeDensityScore(
  activeHits: number,
  totalSlots: number,
  optimalDensity: number,
): number {
  if (totalSlots <= 0) return 0;
  if (activeHits === 0 || activeHits === totalSlots) return 0;

  const density = activeHits / totalSlots;
  const optimal = clamp01(optimalDensity);
  // Maximaler Abstand vom Optimum (entweder nach 0 oder nach 1).
  const maxDist = Math.max(optimal, 1 - optimal);
  if (maxDist <= 0) return 0;

  const dist = Math.abs(density - optimal);
  return clamp01(1 - dist / maxDist);
}

function computeSyncopationScore(hitIndices: number[]): number {
  if (hitIndices.length < 2) return 0;

  // Distanzen zwischen aufeinanderfolgenden Hits (sortiert).
  const sorted = [...hitIndices].sort((a, b) => a - b);
  const distances: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    distances.push(sorted[i] - sorted[i - 1]);
  }
  if (distances.length === 0) return 0;

  const avgDistance =
    distances.reduce((a, b) => a + b, 0) / distances.length;
  if (avgDistance <= 0) return 0;

  const deviation = stdDev(distances);
  return clamp01(deviation / (avgDistance * SYNCOPATION_DEVIATION_WEIGHT));
}

function computePartVariationScore(
  partsWithHits: number,
  totalParts: number,
): number {
  if (totalParts <= 0) return 0;
  if (partsWithHits <= 0) return 0;
  return clamp01(partsWithHits / totalParts);
}

function computeVelocityVariationScore(velocities: number[]): number {
  if (velocities.length < 2) return 0;
  const deviation = stdDev(velocities);
  return clamp01(deviation / VELOCITY_NORMALIZER);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Berechnet ComplexityScore für ein PatternData.
 *
 * Liefert vier normierte Sub-Scores plus einen gewichteten Total-Score
 * (alle 0..1). Default-Gewichtung ist gleichverteilt (je 0.25).
 */
export function computePatternComplexity(
  pattern: PatternData,
  options?: ComplexityOptions,
): ComplexityScoreBreakdown {
  const optimalDensity =
    options?.optimalDensity !== undefined
      ? options.optimalDensity
      : DEFAULT_OPTIMAL_DENSITY;

  const weights = {
    density: options?.weights?.density ?? DEFAULT_WEIGHT,
    syncopation: options?.weights?.syncopation ?? DEFAULT_WEIGHT,
    partVariation: options?.weights?.partVariation ?? DEFAULT_WEIGHT,
    velocityVariation: options?.weights?.velocityVariation ?? DEFAULT_WEIGHT,
  };

  const parts = pattern?.parts ?? [];
  const totalParts = parts.length;

  // Defensive: kein Pattern / keine Parts → alles 0.
  if (totalParts === 0) {
    return {
      densityScore: 0,
      syncopationScore: 0,
      partVariationScore: 0,
      velocityVariationScore: 0,
      total: 0,
    };
  }

  // Aggregiere active steps über alle Parts.
  const hitIndices: number[] = [];
  const velocities: number[] = [];
  let activeHits = 0;
  let totalSlots = 0;
  let partsWithHits = 0;

  for (const part of parts) {
    const steps = part?.steps ?? [];
    totalSlots += steps.length;

    let partHitCount = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step && step.active) {
        activeHits++;
        partHitCount++;
        hitIndices.push(i);
        const vel = step.velocity !== undefined ? step.velocity : DEFAULT_VELOCITY;
        velocities.push(vel);
      }
    }
    if (partHitCount > 0) partsWithHits++;
  }

  const densityScore = computeDensityScore(
    activeHits,
    totalSlots,
    optimalDensity,
  );
  const syncopationScore = computeSyncopationScore(hitIndices);
  const partVariationScore = computePartVariationScore(
    partsWithHits,
    totalParts,
  );
  const velocityVariationScore = computeVelocityVariationScore(velocities);

  // Gewichteter Mittelwert. Wenn alle weights 0 → total 0.
  const weightSum =
    weights.density +
    weights.syncopation +
    weights.partVariation +
    weights.velocityVariation;

  const total =
    weightSum > 0
      ? clamp01(
          (densityScore * weights.density +
            syncopationScore * weights.syncopation +
            partVariationScore * weights.partVariation +
            velocityVariationScore * weights.velocityVariation) /
            weightSum,
        )
      : 0;

  return {
    densityScore,
    syncopationScore,
    partVariationScore,
    velocityVariationScore,
    total,
  };
}

/**
 * Kategorische Einordnung des Total-Scores (für UI-Display).
 *
 * Boundaries:
 *  - < 0.15  → "minimal"
 *  - < 0.35  → "simple"
 *  - < 0.6   → "balanced"
 *  - < 0.85  → "complex"
 *  - >= 0.85 → "chaotic"
 */
export function categorizeComplexity(total: number): ComplexityCategory {
  const v = clamp01(total);
  if (v < 0.15) return "minimal";
  if (v < 0.35) return "simple";
  if (v < 0.6) return "balanced";
  if (v < 0.85) return "complex";
  return "chaotic";
}
