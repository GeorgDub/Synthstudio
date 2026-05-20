/**
 * patternTension.ts - v3.208
 * ------------------------------------------------------------------------
 * Pure-Helper: Drumming-Tension-Mass fuer Pattern-Step-Sequenzen.
 * Kombiniert drei orthogonale Faktoren zu einem Overall-Tension-Score:
 *
 *   1. offBeatScore     - Ratio of hits NOT aligned with strong beats
 *                          (stepIndex % stepsPerBeat !== 0).
 *   2. velocityVariance - Coefficient of variation of active hit
 *                          velocities (stddev / mean), clamped to 0..1.
 *   3. syncopationScore - Average normalized distance of active hits to
 *                          the nearest strong beat. 0 = all hits on
 *                          strong beats, 1 = all hits maximally between
 *                          strong beats. (see Spec-Note below.)
 *
 * overallTension = 0.4 * offBeatScore
 *                + 0.3 * velocityVariance
 *                + 0.3 * syncopationScore
 *
 * Range: alle Faktoren 0..1, overallTension entsprechend 0..1.
 *
 * --- Spec-Note: syncopationScore ---
 * Original spec text reads as 1 minus avgDist/stepsPerBeat which yields
 * 1.0 when ALL hits land on strong beats. That contradicts the name
 * (syncopation), the task title which enumerates syncopation as a
 * positive tension contributor, and the spec test row "Syncopation
 * hits between strong beats" which only makes sense if the score
 * RISES when hits sit between strong beats.
 *
 * Implementation therefore uses the semantic form:
 *
 *   syncopationScore = avgDist / (stepsPerBeat / 2)
 *
 * where avgDist is the mean (over active hits) of the distance to the
 * nearest strong beat. Max possible avgDist is stepsPerBeat/2, so the
 * result is bounded 0..1.
 *
 * --- Defensive Behavior ---
 *  - Empty steps                       -> alle Faktoren 0
 *  - No active hits                    -> alle Faktoren 0
 *  - velocity undefined / NaN          -> treated as 1.0 (loud default)
 *  - velocity non-finite (Infinity)    -> treated as 1.0
 *  - stepsPerBeat <= 0 / NaN / undef.  -> default 4 (16th-note grid)
 *  - stepsPerBeat non-integer          -> floored
 *  - single active hit                 -> velocityVariance = 0
 *  - all-zero velocities (mean=0)      -> velocityVariance = 0 (avoid /0)
 *
 * Reine Funktionen: kein Mutate, kein Date.now(), kein Math.random().
 *
 * Owner: frontend (pattern utility - analog patternSyncopation v3.194,
 *                  patternEntropy v3.206).
 */

// --- Public Types ----------------------------------------------------------

export interface TensionStepLike {
  active: boolean;
  velocity?: number;
}

export interface TensionFactors {
  /** 0..1, ratio of off-beat hits to total active hits. */
  offBeatScore: number;
  /** 0..1, coefficient of variation of velocities (stddev/mean), clamped. */
  velocityVariance: number;
  /** 0..1, normalized average distance to nearest strong beat. */
  syncopationScore: number;
  /** 0..1, weighted combination (0.4 off + 0.3 vel + 0.3 sync). */
  overallTension: number;
}

// --- Constants -------------------------------------------------------------

const DEFAULT_STEPS_PER_BEAT = 4;
const WEIGHT_OFFBEAT = 0.4;
const WEIGHT_VELOCITY = 0.3;
const WEIGHT_SYNCOPATION = 0.3;

// --- Internal Helpers ------------------------------------------------------

function resolveStepsPerBeat(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_STEPS_PER_BEAT;
  }
  return Math.max(1, Math.floor(raw));
}

function resolveVelocity(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 1.0;
  }
  return raw;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function distanceToStrongBeat(i: number, stepsPerBeat: number): number {
  const mod = ((i % stepsPerBeat) + stepsPerBeat) % stepsPerBeat;
  return Math.min(mod, stepsPerBeat - mod);
}

// --- Public Helpers --------------------------------------------------------

export function offBeatRatio(
  steps: readonly TensionStepLike[],
  stepsPerBeat?: number,
): number {
  const spb = resolveStepsPerBeat(stepsPerBeat);
  let total = 0;
  let off = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || !s.active) continue;
    total++;
    if (i % spb !== 0) off++;
  }
  if (total === 0) return 0;
  return off / total;
}

export function velocitySpread(steps: readonly TensionStepLike[]): number {
  const vels: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || !s.active) continue;
    vels.push(resolveVelocity(s.velocity));
  }
  const n = vels.length;
  if (n === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += vels[i];
  const mean = sum / n;
  if (mean === 0) return 0;

  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const d = vels[i] - mean;
    sqSum += d * d;
  }
  const variance = sqSum / n;
  const stddev = Math.sqrt(variance);
  const cov = stddev / Math.abs(mean);
  return clamp01(cov);
}

// --- Public API ------------------------------------------------------------

export function computeTension(
  steps: readonly TensionStepLike[],
  stepsPerBeat?: number,
): TensionFactors {
  const spb = resolveStepsPerBeat(stepsPerBeat);

  const n = steps.length;
  if (n === 0) {
    return {
      offBeatScore: 0,
      velocityVariance: 0,
      syncopationScore: 0,
      overallTension: 0,
    };
  }

  const activeIdx: number[] = [];
  const activeVels: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = steps[i];
    if (!s || !s.active) continue;
    activeIdx.push(i);
    activeVels.push(resolveVelocity(s.velocity));
  }

  const total = activeIdx.length;
  if (total === 0) {
    return {
      offBeatScore: 0,
      velocityVariance: 0,
      syncopationScore: 0,
      overallTension: 0,
    };
  }

  let off = 0;
  for (let k = 0; k < total; k++) {
    if (activeIdx[k] % spb !== 0) off++;
  }
  const offBeatScore = clamp01(off / total);

  let velSum = 0;
  for (let k = 0; k < total; k++) velSum += activeVels[k];
  const mean = velSum / total;
  let velocityVariance: number;
  if (mean === 0) {
    velocityVariance = 0;
  } else {
    let sqSum = 0;
    for (let k = 0; k < total; k++) {
      const d = activeVels[k] - mean;
      sqSum += d * d;
    }
    const stddev = Math.sqrt(sqSum / total);
    velocityVariance = clamp01(stddev / Math.abs(mean));
  }

  const maxDist = spb / 2;
  let distSum = 0;
  for (let k = 0; k < total; k++) {
    distSum += distanceToStrongBeat(activeIdx[k], spb);
  }
  const avgDist = distSum / total;
  const syncopationScore = maxDist > 0 ? clamp01(avgDist / maxDist) : 0;

  const overallTension = clamp01(
    WEIGHT_OFFBEAT * offBeatScore +
      WEIGHT_VELOCITY * velocityVariance +
      WEIGHT_SYNCOPATION * syncopationScore,
  );

  return {
    offBeatScore,
    velocityVariance,
    syncopationScore,
    overallTension,
  };
}
