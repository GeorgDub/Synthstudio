/**
 * patternComparable.ts — v3.229
 * ------------------------------------------------------------------------
 * Pure helpers fuer composite Pattern-vs-Pattern Vergleich. Kombiniert
 * Strukturmetrik (zirkulaere Cross-Correlation auf den active-Flags),
 * Density-Aehnlichkeit und Flow-Richtung zu einer einzigen
 * ComparisonResult-Struktur mit qualitativer Klassifikation.
 *
 *   - structuralCompare(a, b): number
 *       Best-Match Similarity ueber alle zirkulaeren Right-Shifts auf b.
 *       Liefert nur die Similarity; der zugehoerige Shift wird durch
 *       comparePatterns intern via findBestStructuralAlignment ermittelt
 *       (Pin #1).
 *
 *   - densityCompare(a, b): number
 *       1 - |density(a) - density(b)| auf [0..1].
 *
 *   - comparePatterns(a, b): ComparisonResult
 *       Aggregat aus structural/density/flow + bestAlignment + Label.
 *
 * ABGRENZUNG zu existierenden Helpern:
 *   - patternSequenceCorrelation.ts v3.204 macht den zirkulaeren
 *     Cross-Correlation-Loop auf rohem boolean[]. comparePatterns
 *     dupliziert ~80% dieser Logik gegen CompareStepLike[]. Beide
 *     Helper koexistieren bewusst (duplicate-by-design analog
 *     sampleExciter / sampleDeesser). Konvergenz Refactor-Owner-Thema.
 *   - patternMoodVector.ts v3.227 berechnet density-aehnliche Features
 *     fuer 5-axis Mood-Vector. Kein direkter Overlap.
 *
 * PINNED CHOICES (via Advisor-Pre-Check):
 *   #1 structuralCompare liefert nur similarity:number — bestAlignment
 *      wird in comparePatterns via interner findBestStructuralAlignment
 *      ermittelt. structuralCompare ruft dieselbe Routine und extrahiert
 *      .similarity. Keine Doppel-Iteration.
 *   #2 Step-Match-Definition: NUR active-Flag (boolean) wird verglichen.
 *      velocity wird in v3.229 IGNORIERT (reserviert fuer zukuenftige
 *      gewichtete Varianten). Per Test gepinnt.
 *   #3 flowSimilarity exakt: dirA = sign(secondHalfDensity_a -
 *      firstHalfDensity_a); analog dirB. flowSimilarity = dirA===dirB
 *      ? 1.0 : 0.0.
 *   #4 Verschiedene Laengen: BEIDE Inputs werden auf min(a.length,
 *      b.length) truncated VOR jeder Analyse. bestAlignment faellt
 *      dann natuerlich aus dem truncated Structural-Loop.
 *   #5 Empty-Input: alle Felder 0, classification "different". Per Test.
 *   #6 n=1 (truncated): second-half ist leer -> flowSimilarity = 1.0
 *      (degeneriert beide flat), NICHT NaN. Sanitize vor sign().
 *   #7 Classification: STRICT >= per Spec. >= 0.95 -> identical;
 *      >= 0.7 -> very-similar; >= 0.4 -> related; sonst different.
 *      Boundary-Tests fuer 0.95 / 0.7 / 0.4 exakt.
 *   #8 Tie-Break im Structural-Loop: STRICT > damit k=0 bei identical
 *      Patterns gewinnt (bestAlignment === 0 nicht n-1).
 *
 * Pure & DOM-frei: keine Mutation, kein Date.now(), kein Math.random().
 */

// --- Public Types ----------------------------------------------------------

/** Minimaler Step-Shape fuer Vergleichszwecke. velocity reserviert. */
export interface CompareStepLike {
  active: boolean;
  /** Reserviert fuer zukuenftige gewichtete Varianten; v3.229 ungenutzt. */
  velocity?: number;
}

export type ComparisonClassification =
  | "identical"
  | "very-similar"
  | "related"
  | "different";

export interface ComparisonResult {
  /** Aggregat 0.5*structural + 0.3*density + 0.2*flow, im [0..1]. */
  overallSimilarity: number;
  /** Beste zirkulaere Step-by-Step Similarity, im [0..1]. */
  structuralSimilarity: number;
  /** 1 - |density(a) - density(b)|, im [0..1]. */
  densitySimilarity: number;
  /** 1.0 wenn beide Patterns dieselbe halbglobale Richtung haben, sonst 0.0. */
  flowSimilarity: number;
  /** Right-Shift k auf b, der structuralSimilarity ergab. */
  bestAlignment: number;
  /** Qualitatives Label per Threshold (siehe Pin #7). */
  classification: ComparisonClassification;
}

// --- Konstanten ------------------------------------------------------------

const THRESHOLD_IDENTICAL = 0.95;
const THRESHOLD_VERY_SIMILAR = 0.7;
const THRESHOLD_RELATED = 0.4;

const WEIGHT_STRUCTURAL = 0.5;
const WEIGHT_DENSITY = 0.3;
const WEIGHT_FLOW = 0.2;

// --- Internal Helpers ------------------------------------------------------

function isCompareStepArray(x: unknown): x is CompareStepLike[] {
  return Array.isArray(x);
}

/** Defensiv: Step-Array -> boolean[] (active-Flag, alles andere = false). */
function toActiveFlags(steps: CompareStepLike[]): boolean[] {
  const out: boolean[] = new Array(steps.length);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    out[i] = !!(s && s.active === true);
  }
  return out;
}

/** density = hits / length; 0 fuer length=0. */
function density(flags: boolean[]): number {
  if (flags.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i]) hits++;
  return hits / flags.length;
}

/**
 * Sucht den besten Right-Shift k auf b. Right-Rotation Konvention
 * identisch zu patternSequenceCorrelation v3.204:
 *   rotated[i] = b[(i - k + n) % n]
 * Tie-Break: STRICT > damit k=0 immer gewinnt (Pin #8).
 * Annahme: a.length === b.length === n und n > 0. Aufrufer-Pflicht.
 */
function findBestStructuralAlignment(
  a: boolean[],
  b: boolean[]
): { similarity: number; shift: number } {
  const n = a.length;
  let bestSim = -1;
  let bestShift = 0;
  for (let k = 0; k < n; k++) {
    let matching = 0;
    for (let i = 0; i < n; i++) {
      const j = (i - k + n) % n;
      if (a[i] === b[j]) matching++;
    }
    const sim = matching / n;
    if (sim > bestSim) {
      bestSim = sim;
      bestShift = k;
    }
  }
  return { similarity: bestSim < 0 ? 0 : bestSim, shift: bestShift };
}

/** sign() ohne NaN: -1 | 0 | +1. */
function sign(v: number): -1 | 0 | 1 {
  if (!Number.isFinite(v) || v === 0) return 0;
  return v > 0 ? 1 : -1;
}

/**
 * flowSimilarity per Pin #3: Richtungsvergleich der Halb-Densities.
 * Bei truncated length < 2 -> degeneriert beide flat (Pin #6) -> 1.0.
 */
function computeFlowSimilarity(a: boolean[], b: boolean[]): number {
  const n = a.length;
  if (n < 2) return 1.0;

  const half = Math.floor(n / 2);
  const firstA = a.slice(0, half);
  const secondA = a.slice(half);
  const firstB = b.slice(0, half);
  const secondB = b.slice(half);

  const dirA = sign(density(secondA) - density(firstA));
  const dirB = sign(density(secondB) - density(firstB));

  return dirA === dirB ? 1.0 : 0.0;
}

/** Truncate beide Arrays auf min-Length (Pin #4). Erzeugt frische Arrays. */
function truncateToMin(
  a: CompareStepLike[],
  b: CompareStepLike[]
): { flagsA: boolean[]; flagsB: boolean[]; n: number } {
  const n = Math.min(a.length, b.length);
  const flagsA = toActiveFlags(a.slice(0, n));
  const flagsB = toActiveFlags(b.slice(0, n));
  return { flagsA, flagsB, n };
}

function classify(overall: number): ComparisonClassification {
  if (overall >= THRESHOLD_IDENTICAL) return "identical";
  if (overall >= THRESHOLD_VERY_SIMILAR) return "very-similar";
  if (overall >= THRESHOLD_RELATED) return "related";
  return "different";
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function emptyResult(): ComparisonResult {
  return {
    overallSimilarity: 0,
    structuralSimilarity: 0,
    densitySimilarity: 0,
    flowSimilarity: 0,
    bestAlignment: 0,
    classification: "different",
  };
}

// --- Public API ------------------------------------------------------------

/**
 * Beste zirkulaere Step-by-Step Similarity (best Right-Shift) zwischen
 * den active-Flags von a und b. Bei verschiedenen Laengen wird auf
 * min-Length truncated (Pin #4). Bei leerem Input -> 0.
 */
export function structuralCompare(
  a: CompareStepLike[],
  b: CompareStepLike[]
): number {
  if (!isCompareStepArray(a) || !isCompareStepArray(b)) return 0;
  const { flagsA, flagsB, n } = truncateToMin(a, b);
  if (n === 0) return 0;
  return findBestStructuralAlignment(flagsA, flagsB).similarity;
}

/**
 * Density-Aehnlichkeit als 1 - |density(a) - density(b)|. Defensiv
 * geclampt auf [0..1]. Bei verschiedenen Laengen wird auf min-Length
 * truncated (Pin #4). Bei beidseitig leerem Input -> 0.
 */
export function densityCompare(
  a: CompareStepLike[],
  b: CompareStepLike[]
): number {
  if (!isCompareStepArray(a) || !isCompareStepArray(b)) return 0;
  const { flagsA, flagsB, n } = truncateToMin(a, b);
  if (n === 0) return 0;
  const diff = Math.abs(density(flagsA) - density(flagsB));
  return clamp01(1 - diff);
}

/**
 * Composite Pattern-Vergleich. Aggregat aus:
 *   overallSimilarity = 0.5*structural + 0.3*density + 0.2*flow
 * + qualitatives Label per Threshold (Pin #7).
 *
 * Defensiv: nicht-Array, null, undefined -> empty result.
 * Verschiedene Laengen -> min-Length truncate (Pin #4).
 * Leerer Input -> alle Felder 0, classification "different" (Pin #5).
 */
export function comparePatterns(
  a: CompareStepLike[],
  b: CompareStepLike[]
): ComparisonResult {
  if (!isCompareStepArray(a) || !isCompareStepArray(b)) {
    return emptyResult();
  }
  const { flagsA, flagsB, n } = truncateToMin(a, b);
  if (n === 0) return emptyResult();

  const struct = findBestStructuralAlignment(flagsA, flagsB);
  const structuralSimilarity = clamp01(struct.similarity);
  const bestAlignment = struct.shift;

  const densitySimilarity = clamp01(
    1 - Math.abs(density(flagsA) - density(flagsB))
  );

  const flowSimilarity = computeFlowSimilarity(flagsA, flagsB);

  const overallSimilarity = clamp01(
    WEIGHT_STRUCTURAL * structuralSimilarity +
      WEIGHT_DENSITY * densitySimilarity +
      WEIGHT_FLOW * flowSimilarity
  );

  return {
    overallSimilarity,
    structuralSimilarity,
    densitySimilarity,
    flowSimilarity,
    bestAlignment,
    classification: classify(overallSimilarity),
  };
}
