/**
 * patternSymmetryScore.ts - v3.217
 * ------------------------------------------------------------------------
 * Pure-Helper: detektiert symmetrische Patterns (Palindrome,
 * Mirror-Symmetry) in einer boolean-step-Sequence und liefert
 * mehrere komplementaere Scores.
 *
 *   - isPalindrome=true  -> steps gleich vorwaerts wie rueckwaerts
 *   - palindromeScore    -> 0..1 Aehnlichkeit zur eigenen Reverse
 *   - mirrorAxis         -> beste Spiegel-Achse (Index)
 *   - halfMirrorScore    -> Score an der besten Spiegel-Achse
 *
 * Foundation fuer:
 *   - Pattern-Library-Filter "symmetric patterns"
 *   - KI-Generator-Heuristik: erzwinge oder verbiete Symmetrie
 *   - Visualisierung im Pattern-Header (Symmetry-Bar / Axis-Marker)
 *
 * Orthogonal zu:
 *   - patternRepetitionScore (v3.215): misst Self-Similarity ueber
 *     sliding-window Sub-Pattern-Matches.
 *   - patternFlowDirection (v3.213): misst WO Hits konzentriert sind.
 *   - patternEntropy (v3.206): Shannon-Information.
 * Symmetry misst spiegelnde Struktur – orthogonal zu allen dreien.
 *
 * --- Pinned Choices (gepinnt via Tests) ---
 *
 *   #1 computePalindrome:
 *      Vergleicht steps[i] mit steps[length-1-i] fuer
 *      i in [0, Math.floor(length/2)). Bei ungerader Laenge wird
 *      das mittlere Element NICHT mitgezaehlt (standard convention).
 *      score = matching / half-length, mit half-length = floor(length/2).
 *      isPalindrome iff score === 1.
 *
 *   #2 Empty / single-element:
 *      length=0 -> isPalindrome=false, palindromeScore=0,
 *                  mirrorAxis=0, halfMirrorScore=0.
 *      length=1 -> isPalindrome=true (trivially), palindromeScore=1,
 *                  mirrorAxis=0, halfMirrorScore=1.
 *
 *   #3 findMirrorAxis Kandidaten:
 *      axis k in [1, length-1].
 *      Fuer length <= 1: kein Kandidat existiert -> default
 *      { axisIndex: 0, score: length===1 ? 1 : 0 }.
 *
 *   #4 findMirrorAxis Vergleichs-Range:
 *      Fuer Achse k vergleiche steps[k-i] mit steps[k+i] fuer
 *      i in [1, ...] solange k-i >= 0 UND k+i < length.
 *      i=0 wird EXCLUDED (trivial self-match auf steps[k]).
 *      score = matching / validComparisons; falls
 *      validComparisons=0 -> score=0 (kein NaN).
 *
 *   #5 findMirrorAxis Tie-Break:
 *      Mehrere Achsen mit gleichem score: kleinster axisIndex
 *      gewinnt (analog patternRepetitionScore.startA-asc).
 *
 *   #6 halfMirrorScore = findMirrorAxis(steps).score
 *      (NICHT redundant zu palindromeScore: palindromeScore
 *      misst Reverse-Symmetry um den IMPLIZITEN Mittelpunkt,
 *      halfMirrorScore misst Symmetrie um die BESTE Spiegel-Achse.)
 *
 *   #7 symmetryScore kombiniert:
 *      isPalindrome, palindromeScore, mirrorAxis (best),
 *      halfMirrorScore (best-axis-score).
 *
 *   #8 Strict s === true Boolean-Contract:
 *      truthy non-bool (1, "x", {}) zaehlen als inactive.
 *
 * Reine Funktion: kein Mutate, kein Date.now, kein Math.random.
 *
 * Owner: frontend (pattern-utility wie patternRepetitionScore v3.215).
 */

// --- Public Types ----------------------------------------------------------

export interface SymmetryResult {
  /** Exact same forwards and reverse (palindromeScore === 1). */
  isPalindrome: boolean;
  /** 0..1 similarity to reverse. */
  palindromeScore: number;
  /** Index in [0, length-1] of the optimal mirror axis. */
  mirrorAxis: number;
  /** 0..1 score at the optimal mirror axis (`findMirrorAxis().score`). */
  halfMirrorScore: number;
}

// --- Internal Helpers ------------------------------------------------------

function asActive(v: unknown): boolean {
  // Pin #8: strict s === true.
  return v === true;
}

// --- Public API ------------------------------------------------------------

/**
 * Compare a sequence to its reverse.
 *
 * Pin #1:
 *   - half = Math.floor(length / 2).
 *   - For each i in [0, half): compare steps[i] vs steps[length-1-i].
 *   - score = matching / half. (For odd lengths, the middle element is
 *     ignored — standard palindrome convention.)
 *   - isPalindrome iff score === 1 (or trivially length=1).
 *
 * Pin #2 edge-cases:
 *   - length=0 -> { isPalindrome: false, score: 0 }.
 *   - length=1 -> { isPalindrome: true,  score: 1 }.
 */
export function computePalindrome(
  steps: readonly boolean[],
): { isPalindrome: boolean; score: number } {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { isPalindrome: false, score: 0 };
  }
  const length = steps.length;
  if (length === 1) {
    return { isPalindrome: true, score: 1 };
  }
  const half = Math.floor(length / 2);
  let matching = 0;
  for (let i = 0; i < half; i++) {
    const a = asActive(steps[i]);
    const b = asActive(steps[length - 1 - i]);
    if (a === b) matching++;
  }
  const score = half > 0 ? matching / half : 0;
  return { isPalindrome: score === 1, score };
}

/**
 * Search for the axis that maximises mirror-symmetry.
 *
 * Pin #3..#5:
 *   - Kandidaten k in [1, length-1].
 *   - Fuer Achse k vergleiche steps[k-i] vs steps[k+i] fuer i >= 1
 *     solange beide Indizes valid sind.
 *   - score = matching / validComparisons (0 falls keine).
 *   - Tie-Break: kleinster axisIndex.
 *   - length=0 -> { 0, 0 }; length=1 -> { 0, 1 }.
 */
export function findMirrorAxis(
  steps: readonly boolean[],
): { axisIndex: number; score: number } {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { axisIndex: 0, score: 0 };
  }
  const length = steps.length;
  if (length === 1) {
    return { axisIndex: 0, score: 1 };
  }

  let bestAxis = 0;
  let bestScore = -1;

  for (let k = 1; k < length; k++) {
    let matching = 0;
    let valid = 0;
    for (let i = 1; ; i++) {
      const left = k - i;
      const right = k + i;
      if (left < 0 || right >= length) break;
      const a = asActive(steps[left]);
      const b = asActive(steps[right]);
      if (a === b) matching++;
      valid++;
    }
    const score = valid > 0 ? matching / valid : 0;
    // Pin #5: kleinster Index gewinnt bei Tie -> strict >, nicht >=.
    if (score > bestScore) {
      bestScore = score;
      bestAxis = k;
    }
  }

  if (bestScore < 0) bestScore = 0;
  return { axisIndex: bestAxis, score: bestScore };
}

/**
 * Combined result. Pin #7:
 *   - { isPalindrome, palindromeScore } from computePalindrome.
 *   - { mirrorAxis, halfMirrorScore } from findMirrorAxis.
 */
export function symmetryScore(steps: readonly boolean[]): SymmetryResult {
  const pal = computePalindrome(steps);
  const mir = findMirrorAxis(steps);
  return {
    isPalindrome: pal.isPalindrome,
    palindromeScore: pal.score,
    mirrorAxis: mir.axisIndex,
    halfMirrorScore: mir.score,
  };
}
