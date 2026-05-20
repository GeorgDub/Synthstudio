/**
 * patternEnergyCurve.ts - v3.211
 * ------------------------------------------------------------------------
 * Pure-Helper: Energy-Curve eines Drum-Patterns ueber Step-Zeit-Achse.
 * Berechnet einen Sliding-Window-Energy-Verlauf, identifiziert den
 * Peak, den Durchschnitt und die uebergeordnete Trend-Richtung
 * (rising / falling / flat / wave).
 *
 * Foundation fuer:
 *   - Pattern-Build-Detection (Riser/Drop-Erkennung im Arrangement-Mode)
 *   - Auto-Mix automation (Volume/Filter rises mit Pattern-Energy)
 *   - Visualisierung als Spark-Line im Pattern-Header (v3.212+)
 *
 * --- Algorithmus ---
 *   1. raw_energy[i] = sum( velocity_j fuer aktive Step j in Fenster ) /
 *                      windowSize / 127
 *      wobei velocity_j im Bereich 0..127 erwartet wird.
 *      Inaktive Steps tragen 0 bei; aktive ohne velocity-Feld 127 (Full-Hit).
 *
 *   2. Fenster-Konvention: TRAILING-Window
 *        [max(0, i - windowSize + 1), ..., i]
 *      Damit ein einzelner Hit bei Step k den Peak EXAKT bei Step k
 *      ergibt (kein Forward-Smear). Pinned via Test 'Single hit -> peak
 *      at that step'.
 *
 *   3. peakEnergy = max(raw_energy[i]) ueber alle i
 *      points[i].energy = raw_energy[i] / peakEnergy
 *        -> normalisiert so dass mind. 1 Punkt energy === 1 hat.
 *      averageEnergy = mean(points[i].energy)   (NACH der Normalisierung)
 *
 *   4. detectTrend(points) ueber Reihenfolge:
 *      - linear-Regression-Slope (x = stepIndex, y = energy)
 *           slope >  0.05 -> 'rising'
 *           slope < -0.05 -> 'falling'
 *      - max(y) - min(y) < 0.1 -> 'flat'
 *      - sonst -> 'wave'
 *      Reihenfolge ist wichtig: ein Pattern mit max-min=0.05 und
 *      slope=0.06 ist 'rising' (slope-Check zuerst), nicht 'flat'.
 *
 * --- Defensiv ---
 *   - empty steps           -> points=[], peakEnergy=0, peakStepIndex=-1,
 *                              averageEnergy=0, trend='flat'
 *   - all-inactive non-empty -> dito (peakStepIndex=-1, alle 0, 'flat')
 *   - windowSize undefined/NaN/<1 -> Default 4
 *   - windowSize non-integer       -> floored (3.7 -> 3)
 *   - windowSize > steps.length    -> auf steps.length geclamped
 *                                     (Divisor verwendet GECLAMPTE Size,
 *                                      damit Werte nicht inflated werden)
 *   - velocity NaN / undefined / non-finite -> 127 (Full-Hit-Default,
 *                                     analog patternTension v3.208)
 *   - velocity < 0          -> 0
 *   - velocity > 127        -> 127
 *
 * Reine Funktionen: kein Mutate, kein Date.now(), kein Math.random().
 *
 * Owner: frontend (pattern utility - analog patternTension v3.208,
 *                  patternEntropy v3.206).
 */

// --- Public Types ----------------------------------------------------------

export interface EnergyStepLike {
  active: boolean;
  velocity?: number;
}

export interface EnergyPoint {
  /** Step-Index (0-basiert) auf der Pattern-Zeit-Achse. */
  stepIndex: number;
  /** Energy-Wert 0..1 (normiert: mind. ein Punkt === 1, ausser leer). */
  energy: number;
}

export type EnergyTrend = "rising" | "falling" | "flat" | "wave";

export interface EnergyCurveResult {
  /** Pro-Step normierte Energy-Werte. Leer bei steps=[]. */
  points: EnergyPoint[];
  /** Maximaler RAW-Energy-Wert vor Normalisierung (0..1). */
  peakEnergy: number;
  /** Step-Index des Peaks; -1 wenn keine aktiven Hits. */
  peakStepIndex: number;
  /** Mittelwert ueber alle normierten points[i].energy. */
  averageEnergy: number;
  /** Trend-Richtung (rising/falling/flat/wave). */
  trend: EnergyTrend;
}

// --- Constants -------------------------------------------------------------

const DEFAULT_WINDOW_SIZE = 4;
const VELOCITY_MAX = 127;
const VELOCITY_DEFAULT = 127;
const SLOPE_THRESHOLD = 0.05;
const FLAT_RANGE_THRESHOLD = 0.1;

// --- Internal Helpers ------------------------------------------------------

function resolveWindowSize(raw: number | undefined, stepCount: number): number {
  let ws: number;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
    ws = DEFAULT_WINDOW_SIZE;
  } else {
    ws = Math.floor(raw);
  }
  if (ws < 1) ws = 1;
  if (ws > stepCount) ws = stepCount;
  return ws;
}

function resolveVelocity(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return VELOCITY_DEFAULT;
  }
  if (raw < 0) return 0;
  if (raw > VELOCITY_MAX) return VELOCITY_MAX;
  return raw;
}

// --- Public Helpers --------------------------------------------------------

/**
 * Klassifiziert den Energy-Verlauf einer Punkt-Sequenz.
 * Reihenfolge: slope -> range -> wave (siehe File-JSDoc).
 *
 * Empty / single-point input -> 'flat'.
 */
export function detectTrend(points: readonly EnergyPoint[]): EnergyTrend {
  const n = points.length;
  if (n < 2) return "flat";

  // Linear regression slope over (stepIndex, energy)
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let yMin = points[0].energy;
  let yMax = points[0].energy;
  for (let i = 0; i < n; i++) {
    const x = points[i].stepIndex;
    const y = points[i].energy;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const denom = n * sumXX - sumX * sumX;
  let slope = 0;
  if (denom !== 0 && Number.isFinite(denom)) {
    slope = (n * sumXY - sumX * sumY) / denom;
  }

  if (slope > SLOPE_THRESHOLD) return "rising";
  if (slope < -SLOPE_THRESHOLD) return "falling";
  if (yMax - yMin < FLAT_RANGE_THRESHOLD) return "flat";
  return "wave";
}

// --- Public API ------------------------------------------------------------

/**
 * Berechnet die Sliding-Window-Energy-Kurve eines Step-Patterns.
 * Siehe File-JSDoc fuer Algorithmus + Defensiv-Verhalten.
 */
export function computeEnergyCurve(
  steps: readonly EnergyStepLike[],
  windowSize?: number,
): EnergyCurveResult {
  const n = steps.length;
  if (n === 0) {
    return {
      points: [],
      peakEnergy: 0,
      peakStepIndex: -1,
      averageEnergy: 0,
      trend: "flat",
    };
  }

  const ws = resolveWindowSize(windowSize, n);

  // Build velocity-contribution array: 0 if inactive, sanitized velocity if active.
  const contrib = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const s = steps[i];
    if (!s || !s.active) {
      contrib[i] = 0;
    } else {
      contrib[i] = resolveVelocity(s.velocity);
    }
  }

  // Sliding TRAILING window sum -> raw energy in [0, 1].
  const raw = new Array<number>(n);
  let windowSum = 0;
  for (let i = 0; i < n; i++) {
    windowSum += contrib[i];
    if (i >= ws) windowSum -= contrib[i - ws];
    // divisor = resolved window size (NOT the original requested one)
    raw[i] = windowSum / ws / VELOCITY_MAX;
  }

  // Find peak (first occurrence wins on ties).
  let peakEnergy = 0;
  let peakStepIndex = -1;
  for (let i = 0; i < n; i++) {
    if (raw[i] > peakEnergy) {
      peakEnergy = raw[i];
      peakStepIndex = i;
    }
  }

  // All-zero case: emit zero-points, peakStepIndex stays -1.
  if (peakEnergy === 0) {
    const points: EnergyPoint[] = [];
    for (let i = 0; i < n; i++) {
      points.push({ stepIndex: i, energy: 0 });
    }
    return {
      points,
      peakEnergy: 0,
      peakStepIndex: -1,
      averageEnergy: 0,
      trend: "flat",
    };
  }

  // Normalize so peak === 1.
  const points: EnergyPoint[] = [];
  let energySum = 0;
  for (let i = 0; i < n; i++) {
    const normalized = raw[i] / peakEnergy;
    points.push({ stepIndex: i, energy: normalized });
    energySum += normalized;
  }
  const averageEnergy = energySum / n;
  const trend = detectTrend(points);

  return {
    points,
    peakEnergy,
    peakStepIndex,
    averageEnergy,
    trend,
  };
}
