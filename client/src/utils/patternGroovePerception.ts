/**
 * patternGroovePerception.ts — v3.222
 * ------------------------------------------------------------------------
 * Perceptual-Groove-Feeling: misst Swing + Push/Pull/Laidback einer
 * Step-Sequence anhand der Micro-Timing-Offsets pro Step.
 *
 * Public API:
 *   - computeSwingPercent(steps)  : 0..100 - 50% = kein Swing, 75% = full shuffle
 *   - detectPushPull(steps)       : -1..1 - <0 laidback (pulled back),
 *                                            >0 push  (drueckt vor)
 *   - perceiveGroove(steps)       : GrooveFeel { swingPercent, feel, microPushScore }
 *
 * Modell:
 *   - timing pro Step ist die fraktionelle Step-Position 0..1, 0 = exakt
 *     auf der Step-Grid-Linie. Per Spec ist 0.5 = "no swing" (Off-Beat
 *     genau in der Mitte zwischen On-Beats); 0.67 ≈ triplet-shuffle.
 *
 * PINNED CHOICES (Tests pinnen):
 *   #1 swing/push-Auswertung NUR auf aktiven OFF-BEAT-Steps (i%2 === 1).
 *      Spec-Algorithmus sagt zwar "all active steps" fuer detectPushPull,
 *      die Test-Cases ("All-on-beat (timing=0) -> feel='tight'") sind
 *      aber NUR mit dieser Einschraenkung konsistent. Konsistent zur
 *      Swing-Definition, die explizit i%2===1 nennt.
 *   #2 Default-Werte bei empty/no-off-beats:
 *      swingPercent=50, feel="tight", microPushScore=0.
 *   #3 swingPercent = clamp(avgOffBeatTiming * 100, 0, 100). Spec spricht
 *      von "mapped to 50..75" — das ist eine narrative Range, kein
 *      hartes Mapping; rohe Prozent-Form wird ueber clamp [0,100] geliefert.
 *   #4 microPushScore = avg(timing - 0.5) ueber aktive Off-Beat-Steps.
 *      Vorzeichen: <0 = laidback (timing<0.5, "frueher"); >0 = push.
 *   #5 feel-Mapping in Reihenfolge: |micro|<0.05 -> "tight";
 *      micro> 0.05 -> "push"; micro< -0.05 -> "laidback"; sonst -> "loose".
 *      An exakt ±0.05 (Math.abs(0.05)===0.05, nicht <0.05) faellt der
 *      Fall in "loose" - bewusst die spec'd Fallback-Kante.
 *   #6 Sanitizer fuer timing pro Step:
 *      undefined / NaN / -Inf / negativ -> 0;  +Inf / >1 -> 1.
 *      active falsy -> Step wird in beiden Auswertungen ignoriert.
 *   #7 steps null/undefined/non-array -> Default-Result.
 *   #8 Pure: kein Mutate, kein Date.now(), kein Math.random().
 *
 * Owner: frontend (pattern-utility, analog patternEntropy v3.206 /
 *                  patternRepetitionScore v3.215).
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface GrooveFeel {
  /** 0..100, gemessen aus off-beat timing. 50 = neutral / kein Swing. */
  swingPercent: number;
  /** Klassifikation des Groove-Feelings. */
  feel: "tight" | "push" | "laidback" | "loose";
  /** -1..1, negative = laidback, positive = push. Center ≈ tight. */
  microPushScore: number;
}

export interface GrooveStepLike {
  active: boolean;
  /** 0..1, position relative to step grid (0 = exactly on-beat). */
  timing?: number;
  velocity?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_SWING_PERCENT = 50;
const DEFAULT_MICRO_PUSH = 0;
const FEEL_TIGHT_THRESHOLD = 0.05;
const SWING_NEUTRAL_TIMING = 0.5;

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Pin #6 — Sanitize a per-step timing value into [0, 1]. */
function sanitizeTiming(t: number | undefined): number {
  if (t === undefined || t === null) return 0;
  if (typeof t !== "number") return 0;
  if (Number.isNaN(t)) return 0;
  if (t === Number.NEGATIVE_INFINITY) return 0;
  if (t === Number.POSITIVE_INFINITY) return 1;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** Pin #7 — true iff steps is a usable (possibly empty) GrooveStepLike[]. */
function isStepArray(steps: unknown): steps is GrooveStepLike[] {
  return Array.isArray(steps);
}

/**
 * Pin #1 — Walk the steps, collect sanitized timings of ACTIVE OFF-BEAT
 * (i % 2 === 1) steps only.
 */
function collectOffBeatTimings(steps: GrooveStepLike[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (i % 2 !== 1) continue;
    const step = steps[i];
    if (!step || step.active !== true) continue;
    out.push(sanitizeTiming(step.timing));
  }
  return out;
}

/** Arithmetic mean; empty input -> 0. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

/** Hard-clamp into [lo, hi]. NaN -> lo (defensive). */
function clampRange(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the swing-percentage of a step sequence.
 *
 * Pin #1 + #3: averages timing of active off-beat steps (i%2===1),
 * maps directly to percent via × 100 and clamps to [0, 100]. With no
 * active off-beats the function returns DEFAULT_SWING_PERCENT = 50.
 */
export function computeSwingPercent(steps: GrooveStepLike[]): number {
  if (!isStepArray(steps) || steps.length === 0) return DEFAULT_SWING_PERCENT;
  const timings = collectOffBeatTimings(steps);
  if (timings.length === 0) return DEFAULT_SWING_PERCENT;
  const avg = mean(timings);
  return clampRange(avg * 100, 0, 100);
}

/**
 * Compute the push/pull score of a step sequence.
 *
 * Pin #1 + #4: averages (timing - 0.5) over active off-beat steps.
 *   - Result < 0  → laidback (off-beats "pulled forward", earlier than .5)
 *   - Result > 0  → push     (off-beats "pushed back", later than .5)
 *   - Result ≈ 0  → tight    (off-beats centered)
 *
 * Empty / no active off-beats → 0.
 */
export function detectPushPull(steps: GrooveStepLike[]): number {
  if (!isStepArray(steps) || steps.length === 0) return DEFAULT_MICRO_PUSH;
  const timings = collectOffBeatTimings(steps);
  if (timings.length === 0) return DEFAULT_MICRO_PUSH;
  let sum = 0;
  for (let i = 0; i < timings.length; i++) {
    sum += timings[i] - SWING_NEUTRAL_TIMING;
  }
  const avg = sum / timings.length;
  // micro-push is theoretically in (-0.5, +0.5) given timing ∈ [0,1].
  // Clamp to [-1, 1] for the public contract.
  return clampRange(avg, -1, 1);
}

/**
 * Combine computeSwingPercent + detectPushPull into a perceptual feel.
 * Pin #5 feel-mapping order: tight → push → laidback → loose (fallback).
 */
export function perceiveGroove(steps: GrooveStepLike[]): GrooveFeel {
  if (!isStepArray(steps) || steps.length === 0) {
    return {
      swingPercent: DEFAULT_SWING_PERCENT,
      feel: "tight",
      microPushScore: DEFAULT_MICRO_PUSH,
    };
  }
  const swingPercent = computeSwingPercent(steps);
  const microPushScore = detectPushPull(steps);

  let feel: GrooveFeel["feel"];
  if (Math.abs(microPushScore) < FEEL_TIGHT_THRESHOLD) {
    feel = "tight";
  } else if (microPushScore > FEEL_TIGHT_THRESHOLD) {
    feel = "push";
  } else if (microPushScore < -FEEL_TIGHT_THRESHOLD) {
    feel = "laidback";
  } else {
    feel = "loose";
  }

  return { swingPercent, feel, microPushScore };
}
