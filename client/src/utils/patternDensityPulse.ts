/**
 * client/src/utils/patternDensityPulse.ts (v3.199)
 *
 * Pure-Helper: Density-Pulse-Detection. Findet Bursts hoher Hit-Dichte in
 * kurzem Zeitfenster ueber ein boolean-Pattern. Foundation fuer Pattern-
 * Visualisierung, Auto-Fill-Trigger und Energy-Map-UI.
 *
 * Konzept:
 *   - Sliding-Window der Groesse `windowSize` ueber `steps[]`.
 *   - Window an Position i ∈ [0, length-windowSize] "qualifiziert", wenn
 *     density = hits/windowSize >= minDensity.
 *   - Aufeinanderfolgende qualifizierende Windows werden zu EINEM Pulse
 *     zusammengefuehrt. Die Pulse-Grenzen werden anschliessend auf die
 *     tatsaechlich enthaltenen Hits getrimmt — sonst lieferte ein Burst
 *     [T,T,T,T,F,F,...] mit windowSize=4 + minDensity=0.75 einen Pulse
 *     [0,4], obwohl Index 4 kein Hit ist.
 *   - Pulses mit (endStep - startStep + 1) < minLength werden verworfen.
 *
 * Defensive Sanitizers:
 *   - windowSize: NaN/non-finite/<=0  -> default 4
 *   - minDensity: NaN/non-finite      -> default 0.75; <0 -> 0; >1 -> 1
 *   - minLength:  NaN/non-finite/<=0  -> default 2
 *
 * Edge-Cases:
 *   - empty steps               -> []
 *   - windowSize > steps.length -> []
 *   - all-false                 -> []
 *
 * Pure: source wird nie mutiert; alle Returns sind frische Arrays/Objects.
 *
 * Tests: tests/features/pattern-density-pulse.test.ts
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface DensityPulse {
  /** Erster Step-Index mit Hit innerhalb der zusammenhaengenden Qualifying-Span. */
  startStep: number;
  /** Letzter Step-Index mit Hit innerhalb der Span (inclusive). */
  endStep: number;
  /** Anzahl true-Steps in [startStep..endStep]. */
  hits: number;
  /** hits / (endStep-startStep+1) — 0..1. */
  density: number;
}

export interface PulseDetectionOptions {
  /** Sliding-Window-Groesse. Default 4. */
  windowSize?: number;
  /** Min-Density 0..1 fuer Window-Qualifikation. Default 0.75 (3/4 hits). */
  minDensity?: number;
  /** Pulse-Mindestlaenge in Steps. Default 2. */
  minLength?: number;
}

// Constants

const DEFAULT_WINDOW_SIZE = 4;
const DEFAULT_MIN_DENSITY = 0.75;
const DEFAULT_MIN_LENGTH = 2;

// Sanitizers

function sanitizeWindowSize(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    return DEFAULT_WINDOW_SIZE;
  }
  return Math.floor(v);
}

function sanitizeMinDensity(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_MIN_DENSITY;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sanitizeMinLength(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    return DEFAULT_MIN_LENGTH;
  }
  return Math.floor(v);
}

// Internals

function buildPulse(
  steps: readonly boolean[],
  firstWindowStart: number,
  lastWindowStart: number,
  windowSize: number,
): DensityPulse | null {
  const spanStart = firstWindowStart;
  const spanEnd = Math.min(steps.length - 1, lastWindowStart + windowSize - 1);

  let firstHit = -1;
  let lastHit = -1;
  let hits = 0;
  for (let i = spanStart; i <= spanEnd; i++) {
    if (steps[i]) {
      if (firstHit === -1) firstHit = i;
      lastHit = i;
      hits++;
    }
  }

  if (firstHit === -1) return null;

  const length = lastHit - firstHit + 1;
  return {
    startStep: firstHit,
    endStep: lastHit,
    hits,
    density: hits / length,
  };
}

// Public API

export function detectDensityPulses(
  steps: readonly boolean[],
  options?: PulseDetectionOptions,
): DensityPulse[] {
  if (steps.length === 0) return [];

  const windowSize = sanitizeWindowSize(options?.windowSize);
  const minDensity = sanitizeMinDensity(options?.minDensity);
  const minLength = sanitizeMinLength(options?.minLength);

  if (windowSize > steps.length) return [];

  const pulses: DensityPulse[] = [];

  let runStart = -1;
  let runLast = -1;

  const lastValidStart = steps.length - windowSize;

  for (let i = 0; i <= lastValidStart; i++) {
    let hits = 0;
    for (let j = 0; j < windowSize; j++) {
      if (steps[i + j]) hits++;
    }
    const density = hits / windowSize;
    const qualifies = density >= minDensity;

    if (qualifies) {
      if (runStart === -1) {
        runStart = i;
      }
      runLast = i;
    } else if (runStart !== -1) {
      const pulse = buildPulse(steps, runStart, runLast, windowSize);
      if (pulse !== null) {
        const len = pulse.endStep - pulse.startStep + 1;
        if (len >= minLength) pulses.push(pulse);
      }
      runStart = -1;
      runLast = -1;
    }
  }

  if (runStart !== -1) {
    const pulse = buildPulse(steps, runStart, runLast, windowSize);
    if (pulse !== null) {
      const len = pulse.endStep - pulse.startStep + 1;
      if (len >= minLength) pulses.push(pulse);
    }
  }

  return pulses;
}

export function mergePulses(pulses: readonly DensityPulse[]): DensityPulse[] {
  if (pulses.length === 0) return [];
  if (pulses.length === 1) {
    return [{ ...pulses[0] }];
  }

  const sorted = pulses
    .map((p) => ({ ...p }))
    .sort((a, b) => a.startStep - b.startStep);

  const merged: DensityPulse[] = [];
  let cur = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (cur.endStep + 1 >= next.startStep) {
      const newStart = Math.min(cur.startStep, next.startStep);
      const newEnd = Math.max(cur.endStep, next.endStep);
      const overlap = cur.endStep >= next.startStep;
      const newHits = overlap
        ? Math.max(cur.hits, next.hits)
        : cur.hits + next.hits;
      const newLen = newEnd - newStart + 1;
      cur = {
        startStep: newStart,
        endStep: newEnd,
        hits: newHits,
        density: Math.min(1, newHits / newLen),
      };
    } else {
      merged.push(cur);
      cur = next;
    }
  }
  merged.push(cur);
  return merged;
}

export function pulseCoverage(
  pulses: readonly DensityPulse[],
  totalSteps: number,
): number {
  if (
    typeof totalSteps !== "number" ||
    !Number.isFinite(totalSteps) ||
    totalSteps <= 0
  ) {
    return 0;
  }
  if (pulses.length === 0) return 0;

  const covered = new Array<boolean>(totalSteps).fill(false);
  for (const p of pulses) {
    const start = Math.max(0, Math.floor(p.startStep));
    const end = Math.min(totalSteps - 1, Math.floor(p.endStep));
    for (let i = start; i <= end; i++) covered[i] = true;
  }
  let count = 0;
  for (const c of covered) if (c) count++;
  const ratio = count / totalSteps;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}
