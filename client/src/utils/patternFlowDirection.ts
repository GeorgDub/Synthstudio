/**
 * patternFlowDirection.ts - v3.213
 * ------------------------------------------------------------------------
 * Pure-Helper: erkennt die "Flow-Richtung" eines Drum-Patterns.
 * Klassifiziert den Verlauf der Step-Aktivitaet entlang der Zeit-Achse als
 * 'forward' (energy baut auf), 'backward' (energy nach vorn verlagert),
 * 'center-out' (Peak in der Mitte), 'edges-in' (offen an den Raendern,
 * Mitte duenn) oder 'uniform' (gleichmaessig verteilt).
 *
 * Foundation fuer:
 *   - Auto-Mix-Suggestions ("dieses Pattern baut auf - Volume-Riser passt")
 *   - Pattern-Library-Filter ("zeig mir alle Build-up-Patterns")
 *   - Visualisierung als Flow-Pfeil-Indikator im Pattern-Header
 *
 * Orthogonal zu patternEnergyCurve (v3.211 - Energy-Magnitude ueber Zeit
 * mit Sliding-Window) und patternTension (v3.208 - Off-Beat/Syncopation
 * Maess). Flow-Direction misst die GROBE STRUKTUR der Aktivitaet, nicht
 * die Magnitude oder Tension.
 *
 * --- Algorithmus ---
 *   1. firstHalfDensity  = (hits in steps[0 .. half-1]) / half
 *      secondHalfDensity = (hits in steps[half .. length-1]) / (length - half)
 *      mit half = floor(length / 2).
 *
 *   2. centerDensity = (hits in middle third) / (centerLen)
 *      mit centerStart = floor(length / 3),
 *          centerEnd   = floor(2 * length / 3),
 *          centerLen   = centerEnd - centerStart.
 *
 *   3. edgeDensity = (hits in first sixth + last sixth) / edgeLen
 *      mit edgeChunk = floor(length / 6),
 *          edgeLen   = 2 * edgeChunk.
 *
 *   4. Klassifikation (Priority-Order ist load-bearing):
 *      - if abs(firstHalf - secondHalf) > 0.2:
 *          firstHalf > secondHalf -> 'backward' (energy im Vergangenheit)
 *          secondHalf > firstHalf -> 'forward'  (build-up)
 *      - elif abs(center - edge) > 0.2:
 *          center > edge -> 'center-out'
 *          edge > center -> 'edges-in'
 *      - else -> 'uniform'
 *      Strict '>' an der 0.2-Grenze: delta == 0.2 faellt auf 'uniform'
 *      (analog patternEnergyCurve detectTrend slope-Threshold).
 *
 *   5. confidence:
 *      - direction in {forward, backward}     -> abs(firstHalfDelta)
 *      - direction in {center-out, edges-in}  -> abs(centerEdgeDelta)
 *      - direction == uniform                 -> max(|halfDelta|, |centerEdgeDelta|)
 *      Geclampt 0..1.
 *
 * --- Defensiv ---
 *   - empty steps         -> { direction:'uniform', confidence:0, all densities:0 }
 *   - length < 6          -> direction = 'uniform' (zu kurz fuer meaningful direction),
 *                            ABER densities + confidence WERDEN berechnet
 *                            (cheap + nuetzlich fuer Debug/Callers).
 *   - non-array input     -> wie empty.
 *   - Hits: strict s === true (matches boolean[] contract).
 *   - Division-by-zero: bei segmentLen == 0 (z.B. centerLen=0 bei length<3)
 *                       -> density = 0 fuer das Segment.
 *
 * Reine Funktion: kein Mutate, kein Date.now(), kein Math.random().
 *
 * Owner: frontend (pattern utility - analog patternEnergyCurve v3.211,
 *                  patternTension v3.208, patternEntropy v3.206).
 */

// --- Public Types ----------------------------------------------------------

export type FlowDirection =
  | "forward"
  | "backward"
  | "center-out"
  | "edges-in"
  | "uniform";

export interface FlowResult {
  direction: FlowDirection;
  /** Stretch 0..1 - magnitude of the dominant delta. */
  confidence: number;
  firstHalfDensity: number;
  secondHalfDensity: number;
  centerDensity: number;
  edgeDensity: number;
}

// --- Constants -------------------------------------------------------------

const DELTA_THRESHOLD = 0.2;
const MIN_LENGTH_FOR_DIRECTION = 6;

// --- Internal Helpers ------------------------------------------------------

function countHits(steps: readonly boolean[], from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    if (steps[i] === true) n++;
  }
  return n;
}

function safeDensity(hits: number, len: number): number {
  if (len <= 0) return 0;
  return hits / len;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function emptyResult(): FlowResult {
  return {
    direction: "uniform",
    confidence: 0,
    firstHalfDensity: 0,
    secondHalfDensity: 0,
    centerDensity: 0,
    edgeDensity: 0,
  };
}

// --- Public API ------------------------------------------------------------

/**
 * Klassifiziert den Flow eines Step-Patterns.
 * Siehe File-JSDoc fuer Algorithmus + Defensiv-Verhalten.
 */
export function detectFlowDirection(steps: readonly boolean[]): FlowResult {
  if (!Array.isArray(steps) || steps.length === 0) {
    return emptyResult();
  }

  const n = steps.length;

  // --- Half densities ---
  const half = Math.floor(n / 2);
  const firstHalfHits = countHits(steps, 0, half);
  const secondHalfHits = countHits(steps, half, n);
  const firstHalfLen = half;
  const secondHalfLen = n - half;
  const firstHalfDensity = safeDensity(firstHalfHits, firstHalfLen);
  const secondHalfDensity = safeDensity(secondHalfHits, secondHalfLen);

  // --- Center third ---
  const centerStart = Math.floor(n / 3);
  const centerEnd = Math.floor((2 * n) / 3);
  const centerLen = centerEnd - centerStart;
  const centerHits = countHits(steps, centerStart, centerEnd);
  const centerDensity = safeDensity(centerHits, centerLen);

  // --- Edges (first sixth + last sixth) ---
  const edgeChunk = Math.floor(n / 6);
  const edgeLen = 2 * edgeChunk;
  const leftEdgeHits = countHits(steps, 0, edgeChunk);
  const rightEdgeHits = countHits(steps, n - edgeChunk, n);
  const edgeDensity = safeDensity(leftEdgeHits + rightEdgeHits, edgeLen);

  // --- Deltas ---
  const halfDelta = secondHalfDensity - firstHalfDensity;
  const centerEdgeDelta = centerDensity - edgeDensity;
  const absHalfDelta = Math.abs(halfDelta);
  const absCenterEdgeDelta = Math.abs(centerEdgeDelta);

  // --- Short-circuit for tiny patterns ---
  if (n < MIN_LENGTH_FOR_DIRECTION) {
    return {
      direction: "uniform",
      confidence: clamp01(Math.max(absHalfDelta, absCenterEdgeDelta)),
      firstHalfDensity,
      secondHalfDensity,
      centerDensity,
      edgeDensity,
    };
  }

  // --- Classification (priority: half-pair first, then center-edge) ---
  let direction: FlowDirection;
  let confidence: number;

  if (absHalfDelta > DELTA_THRESHOLD) {
    direction = halfDelta > 0 ? "forward" : "backward";
    confidence = absHalfDelta;
  } else if (absCenterEdgeDelta > DELTA_THRESHOLD) {
    direction = centerEdgeDelta > 0 ? "center-out" : "edges-in";
    confidence = absCenterEdgeDelta;
  } else {
    direction = "uniform";
    confidence = Math.max(absHalfDelta, absCenterEdgeDelta);
  }

  return {
    direction,
    confidence: clamp01(confidence),
    firstHalfDensity,
    secondHalfDensity,
    centerDensity,
    edgeDensity,
  };
}
