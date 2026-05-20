/**
 * client/src/utils/patternFitnessScore.ts (v3.195)
 *
 * Pure-Helper: "Fitness"-Score 0..1 fuer ein PatternData. Kombiniert
 * mehrere Pattern-Metrics in eine einzelne "interestingness"-Score.
 * Foundation fuer kuenftige Auto-Evaluation oder Genetic-Algorithm-
 * Fitness-Function (Pattern-Evolve, Auto-Curate, Smart-Shuffle).
 *
 * Sub-Komponenten (jeweils 0..1):
 *   - density:        Peak bei targetDensity (Default 0.35). 0 und 1 -> 0.
 *   - syncopation:    stdDev der Hit-Positionen, normalized auf stepCount/2.
 *   - partVariation:  Anteil der Parts mit >= 1 active step.
 *   - consistency:    Anteil unique step-pattern-Signatures pro Part.
 *                     (Mehr Variation zwischen Parts -> hoeherer Score —
 *                     entgegen wortwoertlicher Lesart "consistency". Der
 *                     spec-NB "hohe consistency = niedrig score, low
 *                     consistency = high" definiert die Semantik: dieser
 *                     Component belohnt Parts-Vielfalt, nicht Wiederholung.
 *                     Formel: unique-signatures / parts-with-hits. Wenn
 *                     keine Parts Hits haben -> 0, NICHT 1.)
 *
 * total = gewichteter Mittelwert (Default-Gewichte: je 0.25). labelFitness
 * mapped 0..1 -> "boring" | "minimal" | "balanced" | "interesting" | "chaotic".
 *
 * Defensive: leere/ungueltige Patterns -> alle Scores 0, label "boring".
 * Eingaben werden NICHT mutiert. Pure & DOM-frei.
 *
 * Abgrenzung zu patternComplexity.ts: dieser Helper ersetzt velocity-
 * variation durch "consistency" (cross-part-Variation) und nutzt eine
 * einfachere Syncopation-Heuristik (stdDev der Hit-Positionen statt
 * stdDev der Hit-Distanzen). Beide Helpers koexistieren als unter-
 * schiedliche Lenses auf "Pattern-Qualitaet".
 */
import type { PatternData } from "../audio/AudioEngine";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface FitnessOptions {
  weights?: Partial<{
    density: number;
    syncopation: number;
    partVariation: number;
    consistency: number;
  }>;
  /** Target-density fuer optimal fitness. Default 0.35. */
  targetDensity?: number;
}

export interface FitnessScoreResult {
  total: number;
  components: {
    density: number;
    syncopation: number;
    partVariation: number;
    consistency: number;
  };
  label: FitnessLabel;
}

export type FitnessLabel =
  | "boring"
  | "minimal"
  | "balanced"
  | "interesting"
  | "chaotic";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TARGET_DENSITY = 0.35;
const DEFAULT_WEIGHT = 0.25;

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

function computeDensityComponent(
  activeHits: number,
  totalSlots: number,
  targetDensity: number,
): number {
  if (totalSlots <= 0) return 0;
  if (activeHits === 0 || activeHits === totalSlots) return 0;

  const density = activeHits / totalSlots;
  const target = clamp01(targetDensity);
  const maxDist = Math.max(target, 1 - target);
  if (maxDist <= 0) return 0;

  return clamp01(1 - Math.abs(density - target) / maxDist);
}

function computeSyncopationComponent(
  hitPositions: number[],
  stepCount: number,
): number {
  if (hitPositions.length < 2) return 0;
  if (stepCount <= 1) return 0;

  const dev = stdDev(hitPositions);
  // Max stdDev fuer N Positionen in [0, stepCount-1] ist ungefaehr
  // (stepCount-1)/2 (Cluster an beiden Enden). Normalize auf stepCount/2.
  const denominator = stepCount / 2;
  return clamp01(dev / denominator);
}

function computePartVariationComponent(
  partsWithHits: number,
  totalParts: number,
): number {
  if (totalParts <= 0) return 0;
  if (partsWithHits <= 0) return 0;
  return clamp01(partsWithHits / totalParts);
}

function computeConsistencyComponent(
  signatures: string[],
  partsWithHits: number,
): number {
  if (partsWithHits <= 0) return 0;
  if (signatures.length === 0) return 0;
  const unique = new Set(signatures).size;
  return clamp01(unique / partsWithHits);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Berechnet Fitness-Score (0..1) fuer ein PatternData.
 *
 * Kombiniert density / syncopation / partVariation / consistency in eine
 * gewichtete "interestingness"-Score plus kategorische Label.
 */
export function computeFitnessScore(
  pattern: PatternData,
  options?: FitnessOptions,
): FitnessScoreResult {
  const targetDensity =
    options?.targetDensity !== undefined
      ? options.targetDensity
      : DEFAULT_TARGET_DENSITY;

  const weights = {
    density: options?.weights?.density ?? DEFAULT_WEIGHT,
    syncopation: options?.weights?.syncopation ?? DEFAULT_WEIGHT,
    partVariation: options?.weights?.partVariation ?? DEFAULT_WEIGHT,
    consistency: options?.weights?.consistency ?? DEFAULT_WEIGHT,
  };

  const parts = pattern?.parts ?? [];
  const totalParts = parts.length;

  if (totalParts === 0) {
    return {
      total: 0,
      components: {
        density: 0,
        syncopation: 0,
        partVariation: 0,
        consistency: 0,
      },
      label: "boring",
    };
  }

  // Aggregate. Collect step-pattern signatures only for parts with hits.
  const hitPositions: number[] = [];
  const signatures: string[] = [];
  let activeHits = 0;
  let totalSlots = 0;
  let partsWithHits = 0;
  let maxStepCount = 0;

  for (const part of parts) {
    const steps = part?.steps ?? [];
    totalSlots += steps.length;
    if (steps.length > maxStepCount) maxStepCount = steps.length;

    let partHitCount = 0;
    let sig = "";
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const active = !!(step && step.active);
      sig += active ? "1" : "0";
      if (active) {
        activeHits++;
        partHitCount++;
        hitPositions.push(i);
      }
    }
    if (partHitCount > 0) {
      partsWithHits++;
      signatures.push(sig);
    }
  }

  const density = computeDensityComponent(
    activeHits,
    totalSlots,
    targetDensity,
  );
  const syncopation = computeSyncopationComponent(hitPositions, maxStepCount);
  const partVariation = computePartVariationComponent(
    partsWithHits,
    totalParts,
  );
  const consistency = computeConsistencyComponent(signatures, partsWithHits);

  const weightSum =
    weights.density +
    weights.syncopation +
    weights.partVariation +
    weights.consistency;

  const total =
    weightSum > 0
      ? clamp01(
          (density * weights.density +
            syncopation * weights.syncopation +
            partVariation * weights.partVariation +
            consistency * weights.consistency) /
            weightSum,
        )
      : 0;

  return {
    total,
    components: { density, syncopation, partVariation, consistency },
    label: labelFitness(total),
  };
}

/**
 * Kategorische Einordnung des Total-Scores (UI-Display).
 *
 * Boundaries:
 *   <  0.15  -> "boring"
 *   <  0.35  -> "minimal"
 *   <  0.6   -> "balanced"
 *   <  0.85  -> "interesting"
 *   >= 0.85  -> "chaotic"
 *
 * Negative / >1 Inputs werden auf 0..1 geclamped (analog
 * categorizeComplexity in patternComplexity.ts).
 */
export function labelFitness(score: number): FitnessLabel {
  const v = clamp01(score);
  if (v < 0.15) return "boring";
  if (v < 0.35) return "minimal";
  if (v < 0.6) return "balanced";
  if (v < 0.85) return "interesting";
  return "chaotic";
}
