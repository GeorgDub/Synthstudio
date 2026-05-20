/**
 * patternEntropy.ts — v3.206
 * ------------------------------------------------------------------------
 * Shannon-Entropy-based measures for boolean step sequences (drum
 * patterns, gate lanes, ...). Quantifies *predictability* of a pattern:
 *
 *   - bitEntropy(steps)       : per-symbol Shannon entropy over the
 *                                {true,false} alphabet. p_true is
 *                                trueCount / total. Range 0..1 bit.
 *   - bigramEntropy(steps)    : per-symbol Shannon entropy over the
 *                                4-letter alphabet {"00","01","10","11"}
 *                                of 2-step sliding bigrams. Range 0..2 bit.
 *   - complexityIndex(steps)  : convex combination of the *normalized*
 *                                entropies, range 0..1.
 *
 * Both bitEntropy and bigramEntropy return the SAME EntropyResult-shape
 * with a shared top-5 bigrams[] (computed once over the sliding window).
 *
 * Defensive:
 *  - Empty array          → entropy=0, normalizedEntropy=0, bigrams=[]
 *  - Single element       → bigrams=[] (no window fits), bitEntropy
 *                           still computes (one symbol, p=1, entropy=0)
 *  - All-same elements    → entropy=0
 *  - 0 · log2(0) := 0     (Shannon convention; guarded against NaN)
 *
 * Reine Funktionen: kein Mutate, kein Date.now(), kein Math.random().
 *
 * Owner: frontend (pattern utility — analog patternSequenceCorrelation v3.204).
 */

// ─── Public Types ───────────────────────────────────────────────────────────

export interface EntropyResult {
  /**
   * Per-symbol Shannon entropy in bits.
   *  - bitEntropy:    max = 1 bit (alphabet size 2)
   *  - bigramEntropy: max = 2 bits (alphabet size 4)
   */
  entropy: number;
  /** entropy / log2(alphabetSize) — clamped to 0..1. */
  normalizedEntropy: number;
  /**
   * Top-5 most-common 2-step bigrams in {"00","01","10","11"}.
   * Sorted by count DESC, ties broken by lexicographic order on the
   * bigram-string for deterministic output.
   * Empty for input length < 2.
   */
  bigrams: { pattern: string; count: number }[];
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** Shannon-safe `p · log2(p)` with the convention 0·log2(0) := 0. */
function xlog2x(p: number): number {
  return p === 0 ? 0 : p * Math.log2(p);
}

/** Sort bigrams by count DESC, lex ASC on pattern for tie-breaking. */
function sortBigrams(
  entries: { pattern: string; count: number }[]
): { pattern: string; count: number }[] {
  return entries.slice().sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0;
  });
}

/**
 * Count all 4 possible 2-step bigrams across a sliding window of size 2.
 * Returns full [{pattern, count}] for all 4 keys (even zero-counts) so
 * downstream code can compute entropy directly; the top-5 list returned
 * to callers is filtered to count > 0 (else the "top-5" is just noise).
 */
function countBigrams(
  steps: boolean[]
): { pattern: string; count: number }[] {
  const counts: Record<string, number> = { "00": 0, "01": 0, "10": 0, "11": 0 };
  for (let i = 0; i + 1 < steps.length; i++) {
    const key = (steps[i] ? "1" : "0") + (steps[i + 1] ? "1" : "0");
    counts[key]++;
  }
  return [
    { pattern: "00", count: counts["00"] },
    { pattern: "01", count: counts["01"] },
    { pattern: "10", count: counts["10"] },
    { pattern: "11", count: counts["11"] },
  ];
}

/** Pick top-5 entries by count DESC (lex tie-break), filter count === 0. */
function topBigrams(
  entries: { pattern: string; count: number }[]
): { pattern: string; count: number }[] {
  return sortBigrams(entries)
    .filter((e) => e.count > 0)
    .slice(0, 5);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Per-symbol Shannon entropy over the {true,false} alphabet.
 *
 * `entropy = -(p_true · log2(p_true) + p_false · log2(p_false))`
 *
 *   - 0 for empty input
 *   - 0 for all-true or all-false (no variance)
 *   - 1.0 for perfectly balanced (50/50) input
 *
 * @param steps - readonly boolean sequence (not mutated)
 * @returns EntropyResult with `bigrams` populated from the SAME input
 *          (shared top-5 for convenience).
 */
export function bitEntropy(steps: boolean[]): EntropyResult {
  const n = steps.length;
  if (n === 0) {
    return { entropy: 0, normalizedEntropy: 0, bigrams: [] };
  }

  let trueCount = 0;
  for (let i = 0; i < n; i++) {
    if (steps[i]) trueCount++;
  }
  const pTrue = trueCount / n;
  const pFalse = 1 - pTrue;

  // `+ 0` normalizes any -0 result (Object.is(-0, 0) === false) so
  // consumers comparing with toBe(0) get +0 deterministically.
  const entropy = -(xlog2x(pTrue) + xlog2x(pFalse)) + 0;
  // alphabet size 2 → max entropy = log2(2) = 1
  const normalizedEntropy = entropy; // already in 0..1
  const bigrams = topBigrams(countBigrams(steps));

  return {
    entropy,
    normalizedEntropy: clamp01(normalizedEntropy),
    bigrams,
  };
}

/**
 * Per-symbol Shannon entropy over the 4-letter alphabet of sliding
 * 2-step bigrams.
 *
 *   - 0 for input length < 2 (no bigram fits)
 *   - 0 for all-true / all-false (only "11" or "00" appears)
 *   - 2.0 bits if all 4 bigrams are equally distributed
 *
 * @param steps - readonly boolean sequence (not mutated)
 */
export function bigramEntropy(steps: boolean[]): EntropyResult {
  const n = steps.length;
  if (n < 2) {
    return { entropy: 0, normalizedEntropy: 0, bigrams: [] };
  }

  const all = countBigrams(steps);
  const totalBigrams = n - 1;

  let entropy = 0;
  for (const { count } of all) {
    if (count === 0) continue;
    const p = count / totalBigrams;
    entropy += xlog2x(p);
  }
  // `+ 0` normalizes -0 to +0 (see bitEntropy comment above).
  entropy = -entropy + 0;
  // alphabet size 4 → max entropy = log2(4) = 2
  const normalizedEntropy = entropy / 2;

  return {
    entropy,
    normalizedEntropy: clamp01(normalizedEntropy),
    bigrams: topBigrams(all),
  };
}

/**
 * Composite complexity index in 0..1, weighted toward bigram (2nd-order)
 * structure:
 *
 *   complexityIndex = (bitEntropy.normalizedEntropy
 *                      + 2 · bigramEntropy.normalizedEntropy) / 3
 *
 * Both operands are normalized to 0..1, so the result is bounded.
 *
 *   - Higher → more complex / unpredictable
 *   - 0 for empty or all-same input
 *   - 4-on-the-floor pattern → low (predictable)
 *   - Random-like → close to 1
 *
 * @param steps - readonly boolean sequence (not mutated)
 */
export function complexityIndex(steps: boolean[]): number {
  if (steps.length === 0) return 0;
  const a = bitEntropy(steps).normalizedEntropy;
  const b = bigramEntropy(steps).normalizedEntropy;
  return clamp01((a + 2 * b) / 3);
}

// ─── Local utilities ────────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v > 1) return 1;
  return v;
}
