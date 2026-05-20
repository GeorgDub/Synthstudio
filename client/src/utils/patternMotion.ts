/**
 * patternMotion.ts (v3.221)
 *
 * Pure-Helper: Motion-Vectors zwischen aufeinanderfolgenden steps.
 *
 * Public API:
 * - `computeMotion(steps)`: Vektoren + overall/net/acceleration
 * - `motionPeak(motion)`: Vektor mit größtem |delta| (oder null)
 */

export interface MotionVector {
  fromStep: number;
  toStep: number;
  delta: number;
}

export interface MotionResult {
  vectors: MotionVector[];
  overallMotion: number;
  netDirection: number;
  acceleration: number;
}

export interface MotionStepLike {
  active: boolean;
  velocity?: number;
}

function sanitizeVelocity(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  if (v < 0) return 1;
  if (v > 1) return 1;
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

function stepEnergy(s: MotionStepLike): number {
  if (!s || !s.active) return 0;
  return sanitizeVelocity(s.velocity);
}

export function computeMotion(steps: MotionStepLike[]): MotionResult {
  const empty: MotionResult = { vectors: [], overallMotion: 0, netDirection: 0, acceleration: 0 };
  if (!steps || !Array.isArray(steps) || steps.length < 2) return empty;

  const vectors: MotionVector[] = [];
  const absDeltas: number[] = [];
  let sumAbs = 0;
  let sumDelta = 0;

  for (let i = 0; i < steps.length - 1; i++) {
    const a = stepEnergy(steps[i]);
    const b = stepEnergy(steps[i + 1]);
    const delta = clamp(b - a, -1, 1);
    vectors.push({ fromStep: i, toStep: i + 1, delta });
    const abs = Math.abs(delta);
    absDeltas.push(abs);
    sumAbs += abs;
    sumDelta += delta;
  }

  const count = vectors.length;
  const overallMotion = clamp(sumAbs / count, 0, 1);
  const netDirection = clamp(sumDelta / count, -1, 1);

  let acceleration = 0;
  if (count >= 2) {
    const mean = sumAbs / count;
    let variance = 0;
    for (const a of absDeltas) {
      const diff = a - mean;
      variance += diff * diff;
    }
    variance /= count;
    acceleration = clamp(Math.sqrt(variance) * 2, 0, 1);
  }

  return { vectors, overallMotion, netDirection, acceleration };
}

export function motionPeak(motion: MotionResult): MotionVector | null {
  if (!motion || !motion.vectors || motion.vectors.length === 0) return null;
  let best = motion.vectors[0];
  let bestAbs = Math.abs(best.delta);
  for (let i = 1; i < motion.vectors.length; i++) {
    const v = motion.vectors[i];
    const a = Math.abs(v.delta);
    if (a > bestAbs) {
      best = v;
      bestAbs = a;
    }
  }
  return best;
}
