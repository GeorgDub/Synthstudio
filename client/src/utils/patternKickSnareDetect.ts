/**
 * patternKickSnareDetect.ts -- v3.223
 * ----
 * Detects kick-snare pattern conventions. Classic backbeat = kick on
 * musical beats 1+3 (steps 0,8 in 16-step grid), snare on 2+4 (steps
 * 4,12). The helper returns kick/snare placement ratios plus a
 * groovePattern label.
 *
 * Public API:
 *   - analyzeKickSnare(parts) -> KickSnareAnalysis
 *
 * Inputs:
 *   - parts: PartLike[] with shape { name:string, steps:{active:boolean}[] }
 *
 * Conventions used here (PINNED -- tests depend on them):
 *
 * Pin #1 - Strong vs weak beat indices.
 *   Spec text states strong=[0,4,8,12] / weak=[2,6,10,14]. That puts a
 *   "Standard backbeat (kick 0,8 + snare 4,12)" example at
 *   snareOnWeak=0, which contradicts isBackbeat=true. The musical
 *   convention "kick on 1+3, snare on 2+4" maps to:
 *     strongBeats = [0, 8]   (downbeats -- beats 1, 3)
 *     weakBeats   = [4, 12]  (backbeats -- beats 2, 4)
 *   We use the musical mapping so the backbeat test passes.
 *
 * Pin #2 - Length-adaptation rule.
 *   For non-16-step grids: strongBeats = [0, floor(len/2)];
 *   weakBeats = [floor(len/4), floor(3*len/4)]. Indices >= len are
 *   filtered out, duplicates de-duplicated.
 *
 * Pin #3 - Kick detection regex: /kick|bd|bass\s*drum/i on part.name.
 *
 * Pin #4 - Snare detection regex: /snare|sd|sn/i on part.name.
 *
 * Pin #5 - kickOnStrong = (# kick-active strong-beat steps) / strongBeats.length.
 *          snareOnWeak  = (# snare-active weak-beat steps) / weakBeats.length.
 *          0 when respective part missing or strong/weak set empty.
 *
 * Pin #6 - isBackbeat = hasKick && hasSnare && kickOnStrong > 0.5
 *          && snareOnWeak > 0.5.
 *
 * Pin #7 - groovePattern branch order (spec-literal):
 *          1. isBackbeat                                -> "backbeat"
 *          2. kickOnStrong > 0.5 && !hasSnare           -> "kick-heavy"
 *          3. snareOnWeak  > 0.5 && !hasKick            -> "snare-heavy"
 *          4. hasKick && hasSnare && !isBackbeat        -> "broken"
 *          5. totalHits < 4                             -> "sparse"
 *          6. else                                      -> "unknown"
 *
 * Pin #8 - Pure: no Date.now(), no Math.random(), no input mutation.
 *
 * Defensive:
 *   - parts null/undefined/non-array          -> defaults, "sparse"
 *   - empty parts                             -> defaults, "sparse"
 *   - part with no steps array                -> ignored (no hits)
 *   - parts.steps length not 16               -> indices adapted (Pin #2)
 *
 * Owner: frontend (pattern-utility, analog patternEntropy v3.206 /
 *                  patternGroovePerception v3.222).
 */

// ---- Public Types ----

export interface KickSnareAnalysis {
  hasKick: boolean;
  hasSnare: boolean;
  isBackbeat: boolean;
  /** 0..1, fraction of strong-beat steps that hold a kick. */
  kickOnStrong: number;
  /** 0..1, fraction of weak-beat steps that hold a snare. */
  snareOnWeak: number;
  groovePattern:
    | "backbeat"
    | "kick-heavy"
    | "snare-heavy"
    | "broken"
    | "sparse"
    | "unknown";
}

export interface PartLike {
  name: string;
  steps: { active: boolean }[];
}

// ---- Constants ----

const KICK_NAME_RE = /kick|bd|bass\s*drum/i;
const SNARE_NAME_RE = /snare|sd|sn/i;

const DEFAULT_RESULT: KickSnareAnalysis = {
  hasKick: false,
  hasSnare: false,
  isBackbeat: false,
  kickOnStrong: 0,
  snareOnWeak: 0,
  groovePattern: "sparse",
};

const SPARSE_THRESHOLD = 4;
const PLACEMENT_THRESHOLD = 0.5;

// ---- Internal Helpers ----

/** Pin #2 -- produce strong/weak beat indices adapted to len. */
function computeBeatIndices(len: number): {
  strong: number[];
  weak: number[];
} {
  if (!Number.isFinite(len) || len <= 0) {
    return { strong: [], weak: [] };
  }
  const halfLen = Math.floor(len / 2);
  const quarterLen = Math.floor(len / 4);
  const threeQuarterLen = Math.floor((3 * len) / 4);

  const rawStrong = [0, halfLen];
  const rawWeak = [quarterLen, threeQuarterLen];

  const strong = Array.from(
    new Set(rawStrong.filter((i) => i >= 0 && i < len)),
  );
  const weak = Array.from(
    new Set(rawWeak.filter((i) => i >= 0 && i < len)),
  );
  return { strong, weak };
}

/** Pure-helper: count active steps at a list of indices. */
function countActiveAt(
  steps: { active: boolean }[] | undefined | null,
  indices: number[],
): number {
  if (!Array.isArray(steps) || steps.length === 0) return 0;
  if (indices.length === 0) return 0;
  let hits = 0;
  for (const i of indices) {
    if (i < 0 || i >= steps.length) continue;
    const s = steps[i];
    if (s && s.active === true) hits += 1;
  }
  return hits;
}

/** Pure-helper: total active step count across all parts. */
function countTotalHits(parts: PartLike[]): number {
  let total = 0;
  for (const p of parts) {
    if (!p || !Array.isArray(p.steps)) continue;
    for (const s of p.steps) {
      if (s && s.active === true) total += 1;
    }
  }
  return total;
}

/** Pure-helper: locate first part whose name matches the regex. */
function findPart(parts: PartLike[], re: RegExp): PartLike | undefined {
  for (const p of parts) {
    if (!p || typeof p.name !== "string") continue;
    if (re.test(p.name)) return p;
  }
  return undefined;
}

/** Fresh defensive copy of the default result so callers always get a new object. */
function freshDefault(): KickSnareAnalysis {
  return {
    hasKick: DEFAULT_RESULT.hasKick,
    hasSnare: DEFAULT_RESULT.hasSnare,
    isBackbeat: DEFAULT_RESULT.isBackbeat,
    kickOnStrong: DEFAULT_RESULT.kickOnStrong,
    snareOnWeak: DEFAULT_RESULT.snareOnWeak,
    groovePattern: DEFAULT_RESULT.groovePattern,
  };
}

// ---- Public API ----

/**
 * Inspect parts for kick/snare placement and classify the groove.
 *
 * @param parts list of named tracks with step-arrays. null/undefined/non-array
 *              and empty arrays return the sparse default.
 */
export function analyzeKickSnare(parts: PartLike[]): KickSnareAnalysis {
  if (!Array.isArray(parts) || parts.length === 0) {
    return freshDefault();
  }

  const kickPart = findPart(parts, KICK_NAME_RE);
  const snarePart = findPart(parts, SNARE_NAME_RE);
  const hasKick = kickPart !== undefined;
  const hasSnare = snarePart !== undefined;

  let referenceLen = 16;
  if (kickPart && Array.isArray(kickPart.steps) && kickPart.steps.length > 0) {
    referenceLen = kickPart.steps.length;
  } else if (
    snarePart &&
    Array.isArray(snarePart.steps) &&
    snarePart.steps.length > 0
  ) {
    referenceLen = snarePart.steps.length;
  } else {
    for (const p of parts) {
      if (p && Array.isArray(p.steps) && p.steps.length > 0) {
        referenceLen = p.steps.length;
        break;
      }
    }
  }

  const { strong, weak } = computeBeatIndices(referenceLen);

  const kickStrongHits = hasKick
    ? countActiveAt(kickPart!.steps, strong)
    : 0;
  const snareWeakHits = hasSnare
    ? countActiveAt(snarePart!.steps, weak)
    : 0;

  const kickOnStrong = strong.length > 0 ? kickStrongHits / strong.length : 0;
  const snareOnWeak = weak.length > 0 ? snareWeakHits / weak.length : 0;

  const isBackbeat =
    hasKick &&
    hasSnare &&
    kickOnStrong > PLACEMENT_THRESHOLD &&
    snareOnWeak > PLACEMENT_THRESHOLD;

  const totalHits = countTotalHits(parts);

  let groovePattern: KickSnareAnalysis["groovePattern"];
  if (isBackbeat) {
    groovePattern = "backbeat";
  } else if (kickOnStrong > PLACEMENT_THRESHOLD && !hasSnare) {
    groovePattern = "kick-heavy";
  } else if (snareOnWeak > PLACEMENT_THRESHOLD && !hasKick) {
    groovePattern = "snare-heavy";
  } else if (hasKick && hasSnare && !isBackbeat) {
    groovePattern = "broken";
  } else if (totalHits < SPARSE_THRESHOLD) {
    groovePattern = "sparse";
  } else {
    groovePattern = "unknown";
  }

  return {
    hasKick,
    hasSnare,
    isBackbeat,
    kickOnStrong,
    snareOnWeak,
    groovePattern,
  };
}
