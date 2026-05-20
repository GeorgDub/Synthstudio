/**
 * patternSequenceCorrelation.ts — v3.204
 * ------------------------------------------------------------------------
 * Pure helpers für Cross-Correlation und Similarity-Vergleich
 * zwischen zwei Boolean-Sequences (z.B. Step-Pattern-Lanes).
 *
 *  - compareSequences(a, b)   : direkter Step-by-Step-Vergleich (kein Shift)
 *  - findBestShift(a, b)      : zirkuläre Cross-Correlation — sucht den
 *                               Shift-k mit höchster Similarity (Right-Shift
 *                               auf b: rotated[i] = b[(i - k + n) % n]).
 *  - patternSimilarity(a, b)  : symmetrischer max-Wert über beide
 *                               Richtungen (per Spec).
 *
 * Defensiv:
 *  - Leere Inputs → similarity = 0, matchingSteps = 0, totalSteps = 0
 *  - Verschiedene Längen → min-Länge wird verwendet, totalSteps = min
 *  - Bei verschiedenen Längen ist Circular-Shift nicht definiert →
 *    findBestShift fällt auf compareSequences(a, b) zurück, shifted=0.
 *
 * Reine Funktionen: keine Mutation, kein Date.now(), kein Math.random().
 */

// ─── Public Types ───────────────────────────────────────────────────────────

export interface CorrelationResult {
  /** Ähnlichkeit im Bereich 0..1, exakter Match = 1. */
  similarity: number;
  /** Anzahl Steps wo a[i] === b[i]. */
  matchingSteps: number;
  /** Anzahl verglichener Steps (min length, 0 bei leerem Input). */
  totalSteps: number;
  /**
   * Shift in Steps (Right-Rotation auf b), der das Ergebnis lieferte.
   * Bei compareSequences immer 0; bei findBestShift = bester Shift.
   */
  shifted: number;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Vergleicht zwei boolesche Sequences Step-by-Step ohne Shift.
 *
 * Bei verschiedenen Längen wird nur bis min(a.length, b.length) verglichen;
 * totalSteps spiegelt das wider. Bei beidseitig leerem Input → similarity=0
 * (defensiv, kein div-by-zero).
 */
export function compareSequences(a: boolean[], b: boolean[]): CorrelationResult {
  const total = Math.min(a.length, b.length);
  if (total === 0) {
    return { similarity: 0, matchingSteps: 0, totalSteps: 0, shifted: 0 };
  }
  let matching = 0;
  for (let i = 0; i < total; i++) {
    if (a[i] === b[i]) matching++;
  }
  return {
    similarity: matching / total,
    matchingSteps: matching,
    totalSteps: total,
    shifted: 0,
  };
}

/**
 * Sucht den besten Right-Shift `k` auf b (zirkulär), der die höchste
 * Similarity mit a liefert. Definition des Shifts:
 *
 *     rotated[i] = b[(i - k + n) % n]
 *
 * D.h. k=2 bedeutet: jedes b[i] landet auf Position (i+2) % n in `rotated`.
 *
 * Liefert das vollständige CorrelationResult inkl. `shifted=k`.
 *
 * Bei verschiedenen Längen ist eine zirkuläre Rotation nicht eindeutig
 * definiert → wir fallen defensiv auf compareSequences(a, b) zurück
 * (shifted=0). Bei leerem Input → 0-Result.
 */
export function findBestShift(a: boolean[], b: boolean[]): CorrelationResult {
  if (a.length === 0 || b.length === 0) {
    return { similarity: 0, matchingSteps: 0, totalSteps: 0, shifted: 0 };
  }
  if (a.length !== b.length) {
    // Cross-Correlation per Rotation nur sinnvoll bei gleicher Länge.
    return compareSequences(a, b);
  }

  const n = a.length;
  let best: CorrelationResult = {
    similarity: -1,
    matchingSteps: 0,
    totalSteps: n,
    shifted: 0,
  };

  for (let k = 0; k < n; k++) {
    let matching = 0;
    for (let i = 0; i < n; i++) {
      // Right-Rotation: rotated[i] = b[(i - k + n) % n]
      const j = (i - k + n) % n;
      if (a[i] === b[j]) matching++;
    }
    const similarity = matching / n;
    if (similarity > best.similarity) {
      best = { similarity, matchingSteps: matching, totalSteps: n, shifted: k };
    }
  }

  return best;
}

/**
 * Symmetrische Pattern-Similarity. Spec verlangt explizit
 *   max(compareSequences(a, b).similarity, compareSequences(b, a).similarity)
 * — auch wenn compareSequences bereits symmetrisch ist (matching count
 *   und min-length sind beide symmetrisch in a,b). Wir folgen der Spec
 *   1:1, damit der Vertrag stabil bleibt.
 */
export function patternSimilarity(a: boolean[], b: boolean[]): number {
  const ab = compareSequences(a, b).similarity;
  const ba = compareSequences(b, a).similarity;
  return Math.max(ab, ba);
}
