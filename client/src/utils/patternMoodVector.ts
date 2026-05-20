/**
 * patternMoodVector.ts -- v3.227
 * ----
 * Maps pattern characteristics to an emotional/mood vector and classifies
 * the dominant mood label.
 *
 * Public API:
 *   - computeMoodVector(parts) -> MoodVector
 *   - classifyMood(parts)       -> MoodLabel { primary, confidence, vector }
 *
 * Pinned Choices (tests depend on them):
 *
 * Pin #1 - total-positions for energy aggregates across ALL parts:
 *     energy = sum(active hits over all parts) / sum(parts[i].steps.length)
 *
 * Pin #2 - tension = fraction of TOTAL hits on off-beat positions
 *   [2,6,10,14] in 16-step grid (scaled proportionally for other lengths).
 *
 * Pin #3 - warmth = clamp((fracKick - fracCymbal + 1) / 2, 0, 1).
 *     KICK_NAME_RE   = /kick|bd|bass\s*drum/i
 *     CYMBAL_NAME_RE = /hat|hh|ch|oh|hi-?hat|crash|cymbal|ride/i
 *
 * Pin #4 - complexity = clamp(1 - max(quartileDensities), 0, 1) on the
 *   merged any-hit boolean sequence of length max(parts[i].steps.length).
 *
 * Pin #5 - flow = clamp(1 - variance(spacings) / max(spacings), 0, 1)
 *   on merged active step indices. <2 hits or max(spacings)==0 -> 1.0
 *   (perceptually smooth).
 *
 * Pin #6 - classifyMood priority order (first match wins). The spec lists
 *   labels in a textual order; this implementation reorders for sane
 *   coverage of edge patterns:
 *     1. minimal    : energy < 0.2                       (sparse patterns)
 *     2. chaotic    : complexity > 0.8 && flow < 0.4     (extreme irregularity)
 *     3. aggressive : energy > 0.6 && tension > 0.5
 *     4. tense      : tension > 0.6 && complexity > 0.5
 *     5. energetic  : energy > 0.7 && tension < 0.4
 *     6. calm       : energy < 0.3 && flow > 0.7         (incl. uniform 4-on-floor)
 *     7. playful    : complexity > 0.5 && flow > 0.6     (moderate-complex catch-all)
 *     8. fallback   : "minimal" with confidence 0.2
 *
 *   Rationale:
 *     - minimal precedes calm: a 1-hit pattern (energy=0.0625) satisfies
 *       BOTH; the more-specific energy-floor branch wins.
 *     - calm precedes playful: a uniform 4-on-the-floor pattern (energy=0.25,
 *       complexity=0.75 via 1-max-density, flow=1.0) satisfies both calm
 *       and playful; spec calls it "calm or energetic", so calm wins.
 *     - playful at end catches mid-complexity / mid-flow patterns that
 *       are not low-energy enough for calm.
 *
 * Pin #7 - Pure: no Date.now(), no Math.random(), no input mutation.
 *
 * Defensive:
 *   - parts null/undefined/non-array/empty -> all-0.5 vector;
 *     classifyMood -> { primary:"minimal", confidence:0 }
 *   - part.steps non-array -> treated as []
 *   - part.name non-string -> not counted toward kick/cymbal regex match
 *   - step.active non-boolean -> falsy
 *   - all components clamped [0,1]
 *
 * Owner: frontend (pattern-utility analog patternHihatDetect v3.225 /
 *                  patternKickSnareDetect v3.223 / patternFillTransition v3.226).
 */

// ---- Public Types ----

export interface MoodVector {
  energy: number;
  tension: number;
  warmth: number;
  complexity: number;
  flow: number;
}

export interface MoodLabel {
  primary:
    | "calm"
    | "energetic"
    | "aggressive"
    | "tense"
    | "playful"
    | "minimal"
    | "chaotic";
  confidence: number;
  vector: MoodVector;
}

export interface MoodStepLike {
  active: boolean;
  velocity?: number;
}

export interface MoodPartLike {
  name: string;
  steps: MoodStepLike[];
}

// ---- Constants ----

const KICK_NAME_RE = /kick|bd|bass\s*drum/i;
const CYMBAL_NAME_RE = /hat|hh|ch|oh|hi-?hat|crash|cymbal|ride/i;

const CANONICAL_OFFBEATS_16 = [2, 6, 10, 14];
const NUM_QUARTERS = 4;

const NEUTRAL_VECTOR: MoodVector = {
  energy: 0.5,
  tension: 0.5,
  warmth: 0.5,
  complexity: 0.5,
  flow: 0.5,
};

// ---- Internal Helpers ----

function freshNeutralVector(): MoodVector {
  return {
    energy: NEUTRAL_VECTOR.energy,
    tension: NEUTRAL_VECTOR.tension,
    warmth: NEUTRAL_VECTOR.warmth,
    complexity: NEUTRAL_VECTOR.complexity,
    flow: NEUTRAL_VECTOR.flow,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function isActive(step: unknown): boolean {
  return (
    typeof step === "object" &&
    step !== null &&
    (step as { active?: unknown }).active === true
  );
}

function partsAreEmpty(parts: unknown): boolean {
  return !Array.isArray(parts) || parts.length === 0;
}

function getSteps(part: MoodPartLike): MoodStepLike[] {
  if (!part || !Array.isArray(part.steps)) return [];
  return part.steps;
}

function totalPositions(parts: MoodPartLike[]): number {
  let n = 0;
  for (const p of parts) n += getSteps(p).length;
  return n;
}

function totalHits(parts: MoodPartLike[]): number {
  let n = 0;
  for (const p of parts) {
    for (const s of getSteps(p)) {
      if (isActive(s)) n++;
    }
  }
  return n;
}

function partHits(part: MoodPartLike): number {
  let n = 0;
  for (const s of getSteps(part)) if (isActive(s)) n++;
  return n;
}

function offBeatPositions(len: number): number[] {
  if (len <= 0) return [];
  if (len === 16) return CANONICAL_OFFBEATS_16.slice();
  const set = new Set<number>();
  for (const p of CANONICAL_OFFBEATS_16) {
    const idx = Math.floor((p * len) / 16);
    if (idx >= 0 && idx < len) set.add(idx);
  }
  const out = Array.from(set);
  out.sort((a, b) => a - b);
  return out;
}

function countTensionHits(parts: MoodPartLike[]): number {
  let n = 0;
  for (const p of parts) {
    const steps = getSteps(p);
    if (steps.length === 0) continue;
    const offBeats = offBeatPositions(steps.length);
    for (const i of offBeats) {
      if (isActive(steps[i])) n++;
    }
  }
  return n;
}

function findKickHits(parts: MoodPartLike[]): number {
  let n = 0;
  for (const p of parts) {
    if (!p || typeof p.name !== "string") continue;
    if (KICK_NAME_RE.test(p.name)) n += partHits(p);
  }
  return n;
}

function findCymbalHits(parts: MoodPartLike[]): number {
  let n = 0;
  for (const p of parts) {
    if (!p || typeof p.name !== "string") continue;
    if (CYMBAL_NAME_RE.test(p.name)) n += partHits(p);
  }
  return n;
}

function mergeStepActivity(parts: MoodPartLike[]): boolean[] {
  let maxLen = 0;
  for (const p of parts) {
    const len = getSteps(p).length;
    if (len > maxLen) maxLen = len;
  }
  if (maxLen === 0) return [];
  const merged: boolean[] = new Array(maxLen).fill(false);
  for (const p of parts) {
    const steps = getSteps(p);
    for (let i = 0; i < steps.length; i++) {
      if (isActive(steps[i])) merged[i] = true;
    }
  }
  return merged;
}

function quartileDensities(merged: boolean[]): number[] {
  const len = merged.length;
  if (len === 0) return [0, 0, 0, 0];
  const quarterLen = Math.max(1, Math.floor(len / NUM_QUARTERS));
  const dens: number[] = [];
  for (let q = 0; q < NUM_QUARTERS; q++) {
    const start = q * quarterLen;
    const end = q === NUM_QUARTERS - 1 ? len : start + quarterLen;
    if (start >= len) {
      dens.push(0);
      continue;
    }
    let hits = 0;
    for (let i = start; i < end; i++) if (merged[i]) hits++;
    const span = Math.max(1, end - start);
    dens.push(hits / span);
  }
  return dens;
}

function computeComplexity(merged: boolean[]): number {
  if (merged.length === 0) return 0;
  const dens = quartileDensities(merged);
  let maxD = dens[0];
  for (const d of dens) if (d > maxD) maxD = d;
  return clamp(1 - maxD, 0, 1);
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

function computeFlow(merged: boolean[]): number {
  const indices: number[] = [];
  for (let i = 0; i < merged.length; i++) if (merged[i]) indices.push(i);
  if (indices.length < 2) return 1;
  const spacings: number[] = [];
  for (let i = 1; i < indices.length; i++) {
    spacings.push(indices[i] - indices[i - 1]);
  }
  if (spacings.length === 0) return 1;
  let maxS = spacings[0];
  for (const s of spacings) if (s > maxS) maxS = s;
  if (maxS <= 0) return 1;
  const v = variance(spacings);
  return clamp(1 - v / maxS, 0, 1);
}

function computeWarmth(parts: MoodPartLike[], totalH: number): number {
  if (totalH === 0) return 0.5;
  const kick = findKickHits(parts);
  const cymbal = findCymbalHits(parts);
  const fracKick = kick / totalH;
  const fracCymbal = cymbal / totalH;
  return clamp((fracKick - fracCymbal + 1) / 2, 0, 1);
}

// ---- Public API ----

export function computeMoodVector(parts: MoodPartLike[]): MoodVector {
  if (partsAreEmpty(parts)) return freshNeutralVector();

  const safeParts = parts as MoodPartLike[];
  const totalPos = totalPositions(safeParts);
  if (totalPos === 0) return freshNeutralVector();

  const totalH = totalHits(safeParts);
  const energy = clamp(totalH / totalPos, 0, 1);

  const tensionHits = countTensionHits(safeParts);
  const tension = totalH === 0 ? 0 : clamp(tensionHits / totalH, 0, 1);

  const warmth = computeWarmth(safeParts, totalH);

  const merged = mergeStepActivity(safeParts);
  const complexity = computeComplexity(merged);
  const flow = computeFlow(merged);

  return { energy, tension, warmth, complexity, flow };
}

// ---- Mood-Classification Helpers ----

interface BranchEval {
  label: MoodLabel["primary"];
  matched: boolean;
  confidence: number;
}

function evalChaotic(v: MoodVector): BranchEval {
  const matched = v.complexity > 0.8 && v.flow < 0.4;
  const conf = matched
    ? clamp(((v.complexity - 0.8) / 0.2 + (0.4 - v.flow) / 0.4) / 2, 0, 1)
    : 0;
  return { label: "chaotic", matched, confidence: conf };
}

function evalAggressive(v: MoodVector): BranchEval {
  const matched = v.energy > 0.6 && v.tension > 0.5;
  const conf = matched
    ? clamp(((v.energy - 0.6) / 0.4 + (v.tension - 0.5) / 0.5) / 2, 0, 1)
    : 0;
  return { label: "aggressive", matched, confidence: conf };
}

function evalTense(v: MoodVector): BranchEval {
  const matched = v.tension > 0.6 && v.complexity > 0.5;
  const conf = matched
    ? clamp(((v.tension - 0.6) / 0.4 + (v.complexity - 0.5) / 0.5) / 2, 0, 1)
    : 0;
  return { label: "tense", matched, confidence: conf };
}

function evalEnergetic(v: MoodVector): BranchEval {
  const matched = v.energy > 0.7 && v.tension < 0.4;
  const conf = matched
    ? clamp(((v.energy - 0.7) / 0.3 + (0.4 - v.tension) / 0.4) / 2, 0, 1)
    : 0;
  return { label: "energetic", matched, confidence: conf };
}

function evalPlayful(v: MoodVector): BranchEval {
  const matched = v.complexity > 0.5 && v.flow > 0.6;
  const conf = matched
    ? clamp(((v.complexity - 0.5) / 0.5 + (v.flow - 0.6) / 0.4) / 2, 0, 1)
    : 0;
  return { label: "playful", matched, confidence: conf };
}

function evalMinimal(v: MoodVector): BranchEval {
  const matched = v.energy < 0.2;
  const conf = matched ? clamp((0.2 - v.energy) / 0.2, 0, 1) : 0;
  return { label: "minimal", matched, confidence: conf };
}

function evalCalm(v: MoodVector): BranchEval {
  const matched = v.energy < 0.3 && v.flow > 0.7;
  const conf = matched
    ? clamp(((0.3 - v.energy) / 0.3 + (v.flow - 0.7) / 0.3) / 2, 0, 1)
    : 0;
  return { label: "calm", matched, confidence: conf };
}

export function classifyMood(parts: MoodPartLike[]): MoodLabel {
  if (partsAreEmpty(parts)) {
    return {
      primary: "minimal",
      confidence: 0,
      vector: freshNeutralVector(),
    };
  }

  const vector = computeMoodVector(parts);

  // Pin #6 effective priority order (minimal-first, playful-after-calm):
  //   1. minimal    -- gives sparse patterns priority over calm
  //   2. chaotic    -- only extreme-complexity, low-flow
  //   3. aggressive -- high energy + tension
  //   4. tense      -- specific tension + complexity profile
  //   5. energetic  -- high energy, low tension
  //   6. calm       -- low energy + smooth flow
  //   7. playful    -- last specific branch; catches moderate-complexity
  //                    patterns that did not satisfy calm
  //   8. fallback   -- "minimal" with confidence 0.2
  const branches: BranchEval[] = [
    evalMinimal(vector),
    evalChaotic(vector),
    evalAggressive(vector),
    evalTense(vector),
    evalEnergetic(vector),
    evalCalm(vector),
    evalPlayful(vector),
  ];

  for (const b of branches) {
    if (b.matched) {
      return {
        primary: b.label,
        confidence: clamp(b.confidence, 0, 1),
        vector,
      };
    }
  }

  return {
    primary: "minimal",
    confidence: 0.2,
    vector,
  };
}
