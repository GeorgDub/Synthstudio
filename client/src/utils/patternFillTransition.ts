/**
 * patternFillTransition.ts -- v3.226
 * ----
 * Detects fill/transition regions in a step-based drum pattern. A "fill"
 * is a contiguous quarter of the pattern whose hit-density exceeds a
 * threshold relative to the baseline density of the non-tail portion.
 * Foundation for last-bar-fill detection (typical drum-fill convention)
 * + multi-fill heatmap (intro/breakdown markers in long arrangements).
 *
 * Public API:
 *   - detectFillTransitions(steps) -> FillTransitionResult
 *
 * Inputs:
 *   - steps: FillStepLike[] with shape { active:boolean }
 *
 * Conventions used here (PINNED -- tests depend on them):
 *
 * Pin #1 - fillRegions scope. Spec describes the algorithm primarily for
 *   the last quarter, but explicitly demands "Single fill in middle",
 *   "Multiple fill regions" and "Edge: fill at very end" as test cases.
 *   Resolved: divide the pattern into 4 equal quarters
 *     quarterLen = max(1, floor(length / 4))
 *     quarter k spans [k*quarterLen .. (k+1)*quarterLen - 1], with the
 *     last quarter taking the remainder up to length-1.
 *   Each qualifying quarter -> ONE FillRegion. No merging of adjacent
 *   fills; this matches "Multiple fill regions" naturally without
 *   sliding-window state.
 *
 * Pin #2 - baselineDensity scope. Spec text:
 *     baselineDensity = total active / length (excluding last 25%)
 *   = activeCount(steps[0 .. length - quarterLen - 1]) / (length - quarterLen).
 *   NOT whole-pattern density. This means the dense MIDDLE quarter IS
 *   included in the baseline (inflating it) -- tests must use patterns
 *   where the middle fill clearly exceeds 1.5 * baseline.
 *
 * Pin #3 - Threshold semantics: STRICT >, not >=. Spec says
 *   "density > 1.5 * baselineDensity". Tested via the all-true case:
 *   baseline=1.0, last-quarter density=1.0, 1.0 > 1.5 is FALSE -> no fill.
 *
 * Pin #4 - lastBarIsFill = (length >= 8) AND
 *                          (last-quarter density > 1.5 * baselineDensity).
 *   The length-gate is redundant when length<8 already returns defaults,
 *   but kept for clarity (defensive layer).
 *
 * Pin #5 - fillIntensity = avg(region.intensity for region in fillRegions),
 *   clamped to [0,1]. Empty fillRegions -> 0 (NOT NaN, NOT undefined).
 *
 * Pin #6 - FillRegion.intensity = that quarter's local hit-density
 *   (active-in-quarter / quarterLen). Already in [0,1].
 *
 * Pin #7 - Edge: baselineDensity itself when length-quarterLen === 0
 *   (cannot happen given length>=8, but defensively) -> 0.
 *   When baselineDensity === 0 and any quarter has hits -> that quarter
 *   IS a fill (any hits > 1.5*0 = 0). When baselineDensity === 0 and
 *   no hits anywhere -> no fills (0 > 0 = false).
 *
 * Pin #8 - Pure: no Date.now, no Math.random, no input mutation.
 *
 * Defensive:
 *   - steps null/undefined/non-array            -> defaults
 *   - steps.length < 8                          -> defaults
 *   - step with non-boolean .active             -> treated as falsy
 *
 * Owner: frontend (pattern-utility, analog patternHihatDetect v3.225 /
 *        patternKickSnareDetect v3.223).
 */

// ---- Public Types ----

export interface FillRegion {
  /** Inclusive start step index. */
  startStep: number;
  /** Inclusive end step index. */
  endStep: number;
  /** 0..1 hit density in this region (active-in-region / region-length). */
  intensity: number;
}

export interface FillTransitionResult {
  fillRegions: FillRegion[];
  /** true when last quarter density > 1.5 * baselineDensity (length>=8). */
  lastBarIsFill: boolean;
  /** 0..1, average region intensity (0 when no fills). */
  fillIntensity: number;
  /** 0..1, hit density of the non-tail portion (first 75% of pattern). */
  baselineDensity: number;
}

export interface FillStepLike {
  active: boolean;
}

// ---- Constants ----

const MIN_LENGTH = 8;
const FILL_THRESHOLD_MULT = 1.5;
const NUM_QUARTERS = 4;

const DEFAULT_RESULT: FillTransitionResult = {
  fillRegions: [],
  lastBarIsFill: false,
  fillIntensity: 0,
  baselineDensity: 0,
};

// ---- Internal Helpers ----

function freshDefault(): FillTransitionResult {
  return {
    fillRegions: [],
    lastBarIsFill: DEFAULT_RESULT.lastBarIsFill,
    fillIntensity: DEFAULT_RESULT.fillIntensity,
    baselineDensity: DEFAULT_RESULT.baselineDensity,
  };
}

function isActive(step: FillStepLike | undefined | null): boolean {
  return !!step && step.active === true;
}

function countActiveRange(
  steps: FillStepLike[],
  start: number,
  endExclusive: number,
): number {
  let n = 0;
  for (let i = start; i < endExclusive; i++) {
    if (isActive(steps[i])) n++;
  }
  return n;
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// ---- Public API ----

export function detectFillTransitions(
  steps: FillStepLike[],
): FillTransitionResult {
  if (!Array.isArray(steps) || steps.length < MIN_LENGTH) {
    return freshDefault();
  }

  const length = steps.length;
  // Pin #1: quarter boundaries
  const quarterLen = Math.max(1, Math.floor(length / NUM_QUARTERS));

  // Pin #2: baseline excludes the last quarter.
  const baselineEnd = length - quarterLen; // exclusive end of baseline region
  const baselineLen = baselineEnd;
  const baselineHits = countActiveRange(steps, 0, baselineEnd);
  const baselineDensity =
    baselineLen > 0 ? baselineHits / baselineLen : 0;

  const threshold = FILL_THRESHOLD_MULT * baselineDensity;

  // Quarter spans:
  //   q=0..NUM_QUARTERS-2 -> [q*quarterLen .. (q+1)*quarterLen - 1]
  //   q=NUM_QUARTERS-1    -> [q*quarterLen .. length-1]            (remainder)
  const fillRegions: FillRegion[] = [];

  for (let q = 0; q < NUM_QUARTERS; q++) {
    const qStart = q * quarterLen;
    const qEndExclusive =
      q === NUM_QUARTERS - 1 ? length : (q + 1) * quarterLen;
    const qLen = qEndExclusive - qStart;
    if (qLen <= 0) continue;

    const hits = countActiveRange(steps, qStart, qEndExclusive);
    const density = hits / qLen;

    // Pin #3: strict > comparison
    if (density > threshold) {
      fillRegions.push({
        startStep: qStart,
        endStep: qEndExclusive - 1,
        intensity: clamp(density, 0, 1),
      });
    }
  }

  // Pin #4: lastBarIsFill
  const lastQStart = (NUM_QUARTERS - 1) * quarterLen;
  const lastQEndEx = length;
  const lastQLen = lastQEndEx - lastQStart;
  const lastQHits = countActiveRange(steps, lastQStart, lastQEndEx);
  const lastQDensity = lastQLen > 0 ? lastQHits / lastQLen : 0;
  const lastBarIsFill =
    length >= MIN_LENGTH && lastQDensity > threshold;

  // Pin #5: fillIntensity = avg of region intensities, clamp [0,1]
  let fillIntensity = 0;
  if (fillRegions.length > 0) {
    let sum = 0;
    for (const r of fillRegions) sum += r.intensity;
    fillIntensity = clamp(sum / fillRegions.length, 0, 1);
  }

  return {
    fillRegions,
    lastBarIsFill,
    fillIntensity,
    baselineDensity: clamp(baselineDensity, 0, 1),
  };
}
