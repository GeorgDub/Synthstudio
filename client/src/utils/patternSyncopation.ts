/**
 * client/src/utils/patternSyncopation.ts (v3.194)
 *
 * Pure-Helper: berechnet einen Syncopation-Score (0..1) basierend auf
 * Longuet-Higgins / Lerdahl-style metrical hierarchy. Hits auf weak
 * metrical positions (off-beats, sub-divisions) erhöhen den Score, Hits
 * auf strong positions (downbeat, beats) senken ihn.
 *
 * Foundation für künftige Pattern-Analyse-Suite (Style-Erkennung,
 * Auto-Tagging, Mutator-Steuerung über "musikalischen Charakter").
 *
 * Alle Funktionen sind seiteneffekt-frei. Kein Store-Zugriff. Input
 * wird nicht mutiert.
 *
 * Metric-Hierarchie (pro step-index i, mit barLength = stepsPerBeat * beatsPerBar):
 *   - i % barLength === 0                      → weight 0 (downbeat, strongest)
 *   - i % stepsPerBeat === 0                   → weight 1 (other beats)
 *   - i % (stepsPerBeat / 2) === 0             → weight 2 (off-beats, "&")
 *   - sonst                                    → weight 3 (sub-divisions, "e"/"a")
 *
 * Score = sum(weight pro active step) / (totalActive * 3)   ∈ [0, 1]
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface SyncopationOptions {
  /** Steps pro Beat. Default 4 (1/16-Pattern). */
  stepsPerBeat?: number;
  /** Beats pro Bar. Default 4 (4/4-Time). */
  beatsPerBar?: number;
}

export interface SyncopationResult {
  /** 0..1. 0 = no syncopation (alle hits auf downbeat), 1 = max syncopation. */
  score: number;
  /** Anzahl active steps auf weak metrical positions (step % stepsPerBeat !== 0). */
  offBeatHits: number;
  /** Anzahl active steps auf Step 0 (strict — nicht jeder bar-downbeat). */
  downBeatHits: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_STEPS_PER_BEAT = 4;
const DEFAULT_BEATS_PER_BAR = 4;
const MAX_WEIGHT = 3;

// ─── Defensive Defaults ──────────────────────────────────────────────────────

function resolveStepsPerBeat(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_STEPS_PER_BEAT;
  }
  return Math.floor(raw);
}

function resolveBeatsPerBar(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_BEATS_PER_BAR;
  }
  return Math.floor(raw);
}

// ─── Internal: Metric Weight ─────────────────────────────────────────────────

/**
 * Liefert das Gewicht (0..3) für eine gegebene step-Position.
 * Höheres Gewicht = schwächere metrische Position = stärkere Syncopation,
 * wenn dort ein Hit liegt.
 */
function metricWeight(
  stepIdx: number,
  stepsPerBeat: number,
  barLength: number,
): number {
  if (stepIdx % barLength === 0) return 0;
  if (stepIdx % stepsPerBeat === 0) return 1;
  const halfBeat = Math.floor(stepsPerBeat / 2);
  if (halfBeat > 0 && stepIdx % halfBeat === 0) return 2;
  return MAX_WEIGHT;
}

// ─── analyzeSyncopation ──────────────────────────────────────────────────────

/**
 * Compute syncopation based on metrical hierarchy.
 *
 * Empty / all-false → score 0, hits 0.
 * Score is normalized to [0, 1] using MAX_WEIGHT = 3.
 *
 * Beispiele (defaults stepsPerBeat=4, beatsPerBar=4 → barLength=16):
 *   - [t,f,f,f, t,f,f,f, t,f,f,f, t,f,f,f] (4-on-floor)
 *     weights: 0, 1, 1, 1 → sum=3, active=4 → 3/12 = 0.25 (mild)
 *   - [f,f,t,f, f,f,t,f, f,f,t,f, f,f,t,f] (all off-beats step%4===2)
 *     weights: 2,2,2,2 → 8 / (4*3) = 0.667
 *   - [f,t,f,t, f,t,f,t, ...] (all sub-divisions)
 *     weights: alle 3 → 24 / (8*3) = 1.0
 */
export function analyzeSyncopation(
  pattern: readonly boolean[],
  options: SyncopationOptions = {},
): SyncopationResult {
  const stepsPerBeat = resolveStepsPerBeat(options.stepsPerBeat);
  const beatsPerBar = resolveBeatsPerBar(options.beatsPerBar);
  const barLength = stepsPerBeat * beatsPerBar;

  const n = pattern.length;
  if (n === 0) {
    return { score: 0, offBeatHits: 0, downBeatHits: 0 };
  }

  let weightSum = 0;
  let activeCount = 0;
  let offBeatHits = 0;
  let downBeatHits = 0;

  for (let i = 0; i < n; i++) {
    if (!pattern[i]) continue;

    activeCount++;

    if (i === 0) {
      downBeatHits++;
    }
    if (i % stepsPerBeat !== 0) {
      offBeatHits++;
    }

    weightSum += metricWeight(i, stepsPerBeat, barLength);
  }

  if (activeCount === 0) {
    return { score: 0, offBeatHits: 0, downBeatHits: 0 };
  }

  const score = weightSum / (activeCount * MAX_WEIGHT);

  return {
    score,
    offBeatHits,
    downBeatHits,
  };
}
