/**
 * patternHihatDetect.ts -- v3.225
 * ----
 * Detects hi-hat usage and grid-style across a list of parts. Identifies
 * a hi-hat part by name regex, then classifies the hit pattern as one of
 * the canonical drum-machine grids ("all-16", "all-8", "off-beat",
 * "syncopated", "sparse") or "none" when no hi-hat part is present.
 *
 * Public API:
 *   - analyzeHihat(parts) -> HihatAnalysis
 *
 * Inputs:
 *   - parts: HihatPartLike[] with shape { name:string, steps:{active:boolean}[] }
 *
 * Conventions used here (PINNED -- tests depend on them):
 *
 * Pin #1 - hatStyle branch order. Spec lists six cases without explicit
 *   order, but the listed tests force this order:
 *     1. !hasHihat                                  -> "none"
 *     2. totalHits < 3                              -> "sparse"
 *        (MUST precede grid checks; otherwise single/double hits would
 *        fall to "syncopated".)
 *     3. activeIndices == ALL_16_GRID_SET           -> "all-16"
 *     4. activeIndices == EIGHTH_GRID_SET           -> "all-8"
 *     5. activeIndices == OFF_BEAT_SET              -> "off-beat"
 *     6. else                                       -> "syncopated"
 *
 * Pin #2 - Strict set-equality. Spec text says "hits primarily on every
 *   2nd step", but the canonical tests demand exact classification:
 *   an "all-8" pattern is *exactly* the 8 indices [0,2,4,6,8,10,12,14],
 *   not a superset or majority. Same for "off-beat" = [2,6,10,14] and
 *   "all-16" = [0..15]. Anything else maps to "syncopated".
 *
 * Pin #3 - Hi-hat detection regex on part.name (case-insensitive):
 *     /hat|hh|ch|oh|hi-?hat|closed.?hat|open.?hat/i
 *   Note: the literal token "ch" will also match names like "Crash" or
 *   "Catch". The spec regex is used as-is; callers needing strict
 *   filtering should rename their non-hat parts.
 *
 * Pin #4 - is8thGrid flag is true when the active-index *set* equals
 *   EIGHTH_GRID_SET exactly (16-step assumption). is16thGrid is true
 *   when the set equals ALL_16_GRID_SET exactly.
 *
 * Pin #5 - consistencyScore formula:
 *     spacings = [active[1]-active[0], active[2]-active[1], ...]
 *     (no wrap-around, sequential diffs only)
 *     consistencyScore = clamp(1 - variance(spacings) / max(spacings), 0, 1)
 *   Edge cases:
 *     - < 2 hits             -> 0  (no spacing measurable)
 *     - max(spacings) == 0   -> 0  (would div-by-zero)
 *     - finalized via clamp [0, 1] to defend against >1 due to FP.
 *
 * Pin #6 - hasHihat is true if any part.name matches HIHAT_NAME_RE. The
 *   "first matching part wins" rule is applied (analog patternKickSnareDetect
 *   v3.223).
 *
 * Pin #7 - Step-length flexibility. The classifications use the FOUND
 *   active indices; pattern length is taken from hat.steps.length and
 *   compared to the *expected* canonical sets for 16-step grids. For
 *   non-16-step lengths, set-equality checks still apply numerically;
 *   typical 16-step convention is the most common case in tests.
 *
 * Pin #8 - Pure: no Date.now(), no Math.random(), no input mutation.
 *
 * Defensive:
 *   - parts null/undefined/non-array          -> default "none" result
 *   - empty parts                             -> default "none" result
 *   - part with no steps array                -> hasHihat true if name
 *                                                matches but 0 active hits
 *   - part name typeof !== "string"           -> skipped
 *
 * Owner: frontend (pattern-utility, analog patternKickSnareDetect v3.223).
 */

// ---- Public Types ----

export interface HihatAnalysis {
  hasHihat: boolean;
  /** true when active-index set equals [0,2,4,6,8,10,12,14] exactly. */
  is8thGrid: boolean;
  /** true when active-index set equals [0..15] exactly. */
  is16thGrid: boolean;
  hatStyle:
    | "off-beat"
    | "all-16"
    | "all-8"
    | "syncopated"
    | "sparse"
    | "none";
  /** 0..1, how regular the hit-spacings are; 0 when <2 hits. */
  consistencyScore: number;
}

export interface HihatPartLike {
  name: string;
  steps: { active: boolean }[];
}

// ---- Constants ----

const HIHAT_NAME_RE = /hat|hh|ch|oh|hi-?hat|closed.?hat|open.?hat/i;

const SPARSE_THRESHOLD = 3;

const ALL_16_GRID = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const EIGHTH_GRID = [0, 2, 4, 6, 8, 10, 12, 14];
const OFF_BEAT = [2, 6, 10, 14];

const DEFAULT_RESULT: HihatAnalysis = {
  hasHihat: false,
  is8thGrid: false,
  is16thGrid: false,
  hatStyle: "none",
  consistencyScore: 0,
};

// ---- Internal Helpers ----

function freshDefault(): HihatAnalysis {
  return {
    hasHihat: DEFAULT_RESULT.hasHihat,
    is8thGrid: DEFAULT_RESULT.is8thGrid,
    is16thGrid: DEFAULT_RESULT.is16thGrid,
    hatStyle: DEFAULT_RESULT.hatStyle,
    consistencyScore: DEFAULT_RESULT.consistencyScore,
  };
}

function findHihatPart(parts: HihatPartLike[]): HihatPartLike | undefined {
  for (const p of parts) {
    if (!p || typeof p.name !== "string") continue;
    if (HIHAT_NAME_RE.test(p.name)) return p;
  }
  return undefined;
}

function collectActiveIndices(
  steps: { active: boolean }[] | undefined | null,
): number[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s && s.active === true) out.push(i);
  }
  return out;
}

function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function computeSpacings(activeIndices: number[]): number[] {
  if (activeIndices.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < activeIndices.length; i++) {
    out.push(activeIndices[i] - activeIndices[i - 1]);
  }
  return out;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) {
    const d = v - mean;
    acc += d * d;
  }
  return acc / values.length;
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function computeConsistency(activeIndices: number[]): number {
  if (activeIndices.length < 2) return 0;
  const spacings = computeSpacings(activeIndices);
  if (spacings.length === 0) return 0;
  let max = spacings[0];
  for (const s of spacings) {
    if (s > max) max = s;
  }
  if (max <= 0) return 0;
  const v = variance(spacings);
  return clamp(1 - v / max, 0, 1);
}

// ---- Public API ----

export function analyzeHihat(parts: HihatPartLike[]): HihatAnalysis {
  if (!Array.isArray(parts) || parts.length === 0) {
    return freshDefault();
  }

  const hatPart = findHihatPart(parts);
  const hasHihat = hatPart !== undefined;

  if (!hasHihat) {
    return freshDefault();
  }

  const activeIndices = collectActiveIndices(hatPart!.steps);
  const totalHits = activeIndices.length;

  const is16thGrid = setsEqual(activeIndices, ALL_16_GRID);
  const is8thGrid = setsEqual(activeIndices, EIGHTH_GRID);
  const isOffBeat = setsEqual(activeIndices, OFF_BEAT);

  const consistencyScore = computeConsistency(activeIndices);

  // Pin #1 branch order
  let hatStyle: HihatAnalysis["hatStyle"];
  if (totalHits < SPARSE_THRESHOLD) {
    hatStyle = "sparse";
  } else if (is16thGrid) {
    hatStyle = "all-16";
  } else if (is8thGrid) {
    hatStyle = "all-8";
  } else if (isOffBeat) {
    hatStyle = "off-beat";
  } else {
    hatStyle = "syncopated";
  }

  return {
    hasHihat: true,
    is8thGrid,
    is16thGrid,
    hatStyle,
    consistencyScore,
  };
}
