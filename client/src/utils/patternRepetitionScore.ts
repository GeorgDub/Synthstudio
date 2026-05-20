/**
 * patternRepetitionScore.ts - v3.215
 * ------------------------------------------------------------------------
 * Pure-Helper: detektiert repetitive Sub-Patterns innerhalb eines Step-
 * Patterns und berechnet einen Repetition-Score in [0..1].
 *
 *   - Score nahe 1  -> stark selbst-aehnlich (ABAB, AAAA, ...)
 *   - Score nahe 0  -> wenig Wiederholung (random / unique sequence)
 *
 * Foundation fuer:
 *   - Pattern-Library-Filter (zeig mir alle tight-Patterns)
 *   - KI-Generator-Heuristik (verwerfe Patterns mit zu hoher Repetition)
 *   - Visualisierung im Pattern-Header (Repetition-Bar / Tile-Count)
 *
 * Orthogonal zu:
 *   - patternFlowDirection (v3.213): misst WO sind die Hits konzentriert
 *   - patternEntropy (v3.206): Shannon-Information per bit/bigram
 *   - patternEnergyCurve (v3.211): Magnitude-Verlauf ueber die Zeit
 * Repetition misst SELBST-AEHNLICHKEIT - orthogonal zu allen dreien.
 *
 * --- Pinned Choices (gepinnt via Tests) ---
 *   #1 Similarity-Formel:
 *      similarity(startA, startB, L) =
 *        count of k in [0,L) where steps[startA+k] === steps[startB+k], div L.
 *      (Fraction-of-matching boolean positions.)
 *
 *   #2 Threshold strict gt: similarity gt 0.8 (analog patternFlowDirection
 *      v3.213 strict-gt-Konvention). Match mit similarity == 0.8 faellt
 *      durch (= kein Match).
 *
 *   #3 repetitionScore = covered-size div length, mit covered =
 *      UNION der Indices in jedem Match-Range (A-Range ODER B-Range).
 *
 *   #4 Dedup overlapping matches (keep longest):
 *      - Zwei Matches A, B overlappen iff deren A-Ranges oder B-Ranges
 *        sich schneiden.
 *      - Tie-break bei gleicher Laenge: hoehere similarity gewinnt;
 *        danach kleinerer startA.
 *
 *   #5 uniqueRegions = Anzahl maximal-zusammenhaengender Runs von
 *      NICHT-covered Indices. All-covered -> 0. None-covered -> 1.
 *      Empty -> 0.
 *
 *   #6 Sort-Order der Matches: descending similarity, descending length,
 *      ascending startA.
 *
 *   #7 minLength Sanitizer:
 *      undefined / NaN / non-integer / lt 1 -> 4 (Default).
 *      gt floor(length/2) -> clamped auf floor(length/2).
 *      ANMERKUNG: Der Clamp 'gt floor(length/2)' und Pin #8 feuern auf
 *      derselben Bedingung (rawMin gt length/2 iff 2*rawMin gt length).
 *      Weil Pin #8 zuerst auf den REQUESTED Wert geprueft wird, ist der
 *      Clamp logisch dokumentiert aber bei sinnvollen Inputs nie aktiv -
 *      reine Vorsichts-Sicherheitsstufe gegen Loop-Out-of-Bound.
 *
 *   #8 Early-Exit (auf REQUESTED minLength nach NaN/lt1-Default,
 *      VOR dem Clamp): length lt 2*minLength -> []. Begruendung:
 *      User-Intention "minLength=N" heisst "ich will Sub-Patterns der
 *      Laenge mindestens N"; ein Pattern muss mindestens 2*N lang sein
 *      damit ZWEI disjunkte Sub-Patterns dieser Laenge existieren.
 *
 * Reine Funktion: kein Mutate, kein Date.now, kein Math.random.
 *
 * Owner: frontend (pattern utility - analog patternFlowDirection v3.213).
 */

// --- Public Types ----------------------------------------------------------

export interface RepetitionMatch {
  startA: number;
  startB: number;
  length: number;
  similarity: number;
}

export interface RepetitionResult {
  repetitionScore: number;
  matches: RepetitionMatch[];
  uniqueRegions: number;
}

// --- Constants -------------------------------------------------------------

const DEFAULT_MIN_LENGTH = 4;
const SIMILARITY_THRESHOLD = 0.8;

// --- Internal Helpers ------------------------------------------------------

/**
 * Returns the sanitized minLength BEFORE the floor(length/2) clamp.
 * Used both for the Pin #8 early-exit check AND as the basis for the
 * post-clamp value used by the main loop.
 */
function sanitizeMinLengthRaw(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MIN_LENGTH;
  }
  const n = Math.floor(value);
  if (n < 1) return DEFAULT_MIN_LENGTH;
  return n;
}

function clampMinLengthToHalf(rawMin: number, length: number): number {
  const halfFloor = Math.floor(length / 2);
  if (halfFloor > 0 && rawMin > halfFloor) return halfFloor;
  return rawMin;
}

function computeSimilarity(
  steps: readonly boolean[],
  startA: number,
  startB: number,
  L: number,
): number {
  let matches = 0;
  for (let k = 0; k < L; k++) {
    const a = steps[startA + k] === true;
    const b = steps[startB + k] === true;
    if (a === b) matches++;
  }
  return matches / L;
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function matchesOverlap(a: RepetitionMatch, b: RepetitionMatch): boolean {
  const aAEnd = a.startA + a.length;
  const aBEnd = a.startB + a.length;
  const bAEnd = b.startA + b.length;
  const bBEnd = b.startB + b.length;
  if (rangesOverlap(a.startA, aAEnd, b.startA, bAEnd)) return true;
  if (rangesOverlap(a.startB, aBEnd, b.startB, bBEnd)) return true;
  return false;
}

function preferenceCompare(a: RepetitionMatch, b: RepetitionMatch): number {
  if (a.length !== b.length) return b.length - a.length;
  if (a.similarity !== b.similarity) return b.similarity - a.similarity;
  if (a.startA !== b.startA) return a.startA - b.startA;
  return a.startB - b.startB;
}

function finalSortCompare(a: RepetitionMatch, b: RepetitionMatch): number {
  if (a.similarity !== b.similarity) return b.similarity - a.similarity;
  if (a.length !== b.length) return b.length - a.length;
  if (a.startA !== b.startA) return a.startA - b.startA;
  return a.startB - b.startB;
}

function dedupOverlapping(matches: RepetitionMatch[]): RepetitionMatch[] {
  const sorted = [...matches].sort(preferenceCompare);
  const kept: RepetitionMatch[] = [];
  for (const m of sorted) {
    let conflicts = false;
    for (const k of kept) {
      if (matchesOverlap(m, k)) {
        conflicts = true;
        break;
      }
    }
    if (!conflicts) kept.push(m);
  }
  return kept;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// --- Public API ------------------------------------------------------------

export function findRepetitions(
  steps: readonly boolean[],
  minLength?: number,
): RepetitionMatch[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const length = steps.length;

  // Pin #8: Early-exit applied to the REQUESTED (pre-clamp) minLength.
  // Reason: clamped minLength is always <= floor(length/2), so a post-clamp
  // check would never fire. Spec phrasing "patterns < minLength*2 -> empty"
  // refers to the original request.
  const rawMin = sanitizeMinLengthRaw(minLength);
  if (length < 2 * rawMin) return [];

  // Pin #7 clamp applied to the requested value AFTER the early-exit.
  const minLen = clampMinLengthToHalf(rawMin, length);

  const halfFloor = Math.floor(length / 2);
  const raw: RepetitionMatch[] = [];

  for (let L = minLen; L <= halfFloor; L++) {
    const maxStart = length - L;
    for (let startA = 0; startA <= maxStart; startA++) {
      for (let startB = startA + 1; startB <= maxStart; startB++) {
        const sim = computeSimilarity(steps, startA, startB, L);
        if (sim > SIMILARITY_THRESHOLD) {
          raw.push({ startA, startB, length: L, similarity: sim });
        }
      }
    }
  }

  if (raw.length === 0) return [];

  const deduped = dedupOverlapping(raw);
  deduped.sort(finalSortCompare);
  return deduped;
}

export function computeRepetitionScore(
  steps: readonly boolean[],
): RepetitionResult {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { repetitionScore: 0, matches: [], uniqueRegions: 0 };
  }

  const length = steps.length;
  const matches = findRepetitions(steps);

  const covered = new Set<number>();
  for (const m of matches) {
    for (let k = 0; k < m.length; k++) {
      covered.add(m.startA + k);
      covered.add(m.startB + k);
    }
  }

  const repetitionScore = clamp01(covered.size / length);

  let uniqueRegions = 0;
  let inRun = false;
  for (let i = 0; i < length; i++) {
    if (!covered.has(i)) {
      if (!inRun) {
        uniqueRegions++;
        inRun = true;
      }
    } else {
      inRun = false;
    }
  }

  return { repetitionScore, matches, uniqueRegions };
}
