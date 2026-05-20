/**
 * Synthstudio – onsetDetector.ts (v3.177.0)
 *
 * Pure Onset-Detection-Helper für AudioBuffer-Onsets via Energy-based ODF
 * (Onset-Detection-Function).  Findet plötzliche Energie-Anstiege im Signal —
 * Foundation für künftige Auto-Slice-, Beat-Track- oder Sample-Trigger-Features.
 *
 * Verwandt zu:
 *   - `transientDetection.ts` (v2.62, amplitude-delta auf single sample)
 *   - `sliceAutoDetector.ts` (v3.135, RMS-Energy → slice-points inkl. Start-Marker)
 *
 * Unterschied dieser Helper:
 *   - Liefert echte Onset-Events (samplePos/timeSec/strength), KEIN automatischer
 *     Start-Marker bei Index 0.
 *   - Threshold-Formel = mean + (1 - 2·sensitivity)·stdDev (Spec-konform).
 *   - Peak-Picking-Window = ±1 Frame (kompakt, single-pass).
 *
 * Algorithmus (Spec):
 *   1. Frame-RMS-Energy berechnen (frameSize / hopSize).
 *   2. Energy-Diff (rectified): flux[f] = max(0, E_n − E_(n−1)).
 *   3. threshold = mean(flux) + (1 − 2·sensitivity)·stdDev(flux).
 *   4. Peak-Picking: flux[f] > threshold UND > flux[f−1] UND > flux[f+1].
 *   5. minDistance-Filter via minDistanceSamples (Default sampleRate·0.05).
 *   6. strength = clamp01((flux[f] − threshold) / (max(flux) − threshold)).
 *
 * Pure & Node-testbar.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Constants ───────────────────────────────────────────────────────────────

export const ONSET_DEFAULT_FRAME_SIZE = 512;
export const ONSET_DEFAULT_HOP_SIZE = 256;
export const ONSET_DEFAULT_SENSITIVITY = 0.5;
/** Default-min-distance in Sekunden, sofern Option fehlt/NaN. */
export const ONSET_DEFAULT_MIN_DISTANCE_SEC = 0.05;
/** Minimum allowed frameSize (defensive floor). */
const ONSET_MIN_FRAME_SIZE = 64;
/** Epsilon für divide-by-zero-Guard. */
const STRENGTH_DENOMINATOR_EPS = 1e-9;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface OnsetDetectorOptions {
  /** Frame-Size in samples. Default 512. */
  frameSize?: number;
  /** Hop-Size in samples. Default 256. */
  hopSize?: number;
  /** Sensitivity 0..1. Höher = mehr onsets. Default 0.5. */
  sensitivity?: number;
  /** Min-Distance zwischen Onsets in samples. Default sampleRate * 0.05 (50ms). */
  minDistanceSamples?: number;
}

export interface DetectedOnset {
  /** Sample-Position des Onsets. */
  samplePos: number;
  /** Zeit in Sekunden. */
  timeSec: number;
  /** Onset-Strength 0..1 (relative). */
  strength: number;
}

// ─── Pure Helpers ────────────────────────────────────────────────────────────

/**
 * RMS-Energie eines Frame-Slice.  NaN-Werte werden übersprungen (nicht in
 * count und nicht in sum).  Leere Range → 0.
 */
export function frameRms(samples: Float32Array, start: number, length: number): number {
  if (!samples || samples.length === 0 || length <= 0) return 0;
  const begin = Math.max(0, Math.floor(start));
  const end = Math.min(samples.length, begin + Math.floor(length));
  let sum = 0;
  let count = 0;
  for (let i = begin; i < end; i++) {
    const v = samples[i];
    if (Number.isFinite(v)) {
      sum += v * v;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** Downmix all channels to mono (mean of channels). */
function downmixMono(buffer: AudioBufferLike): Float32Array {
  const len = buffer.length;
  const result = new Float32Array(len);
  const chCount = buffer.numberOfChannels;
  if (chCount === 0 || len === 0) return result;
  if (chCount === 1) {
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) result[i] = ch[i];
    return result;
  }
  for (let c = 0; c < chCount; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) result[i] += ch[i] / chCount;
  }
  return result;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detektiert Onsets in einem AudioBuffer via Energy-based ODF.
 *
 *  - leerer Buffer → []
 *  - kein automatischer Start-Marker bei 0
 *  - sortiert ascending nach samplePos
 *
 * Siehe Module-Doc für Algorithmus-Details.
 */
export function detectOnsets(
  buffer: AudioBufferLike,
  options: OnsetDetectorOptions = {},
): DetectedOnset[] {
  if (!buffer || buffer.length === 0) return [];

  const sampleRate = buffer.sampleRate > 0 ? buffer.sampleRate : 48000;

  const frameSizeRaw = Math.floor(options.frameSize ?? ONSET_DEFAULT_FRAME_SIZE);
  const frameSize = Number.isFinite(frameSizeRaw)
    ? Math.max(ONSET_MIN_FRAME_SIZE, frameSizeRaw)
    : ONSET_DEFAULT_FRAME_SIZE;

  const hopSizeRaw = Math.floor(options.hopSize ?? ONSET_DEFAULT_HOP_SIZE);
  const hopSize = Number.isFinite(hopSizeRaw) && hopSizeRaw >= 1
    ? hopSizeRaw
    : ONSET_DEFAULT_HOP_SIZE;

  const sensRaw = options.sensitivity ?? ONSET_DEFAULT_SENSITIVITY;
  const sensitivity = Number.isFinite(sensRaw)
    ? Math.max(0, Math.min(1, sensRaw))
    : ONSET_DEFAULT_SENSITIVITY;

  const minDistRaw = options.minDistanceSamples;
  const minDistanceSamples = Number.isFinite(minDistRaw as number) && (minDistRaw as number) >= 0
    ? Math.floor(minDistRaw as number)
    : Math.floor(sampleRate * ONSET_DEFAULT_MIN_DISTANCE_SEC);

  const signal = downmixMono(buffer);
  if (signal.length < frameSize) return [];

  const nFrames = Math.floor((signal.length - frameSize) / hopSize) + 1;
  if (nFrames < 3) return [];

  // 1. Frame-RMS-Energy
  const energies = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    energies[f] = frameRms(signal, f * hopSize, frameSize);
  }

  // 2. Rectified energy-diff (flux)
  const flux = new Float32Array(nFrames);
  for (let f = 1; f < nFrames; f++) {
    const diff = energies[f] - energies[f - 1];
    flux[f] = diff > 0 ? diff : 0;
  }

  // 3. mean + stdDev
  let sum = 0;
  let sumSq = 0;
  let maxFlux = 0;
  for (let f = 0; f < nFrames; f++) {
    const v = flux[f];
    sum += v;
    sumSq += v * v;
    if (v > maxFlux) maxFlux = v;
  }
  const mean = sum / nFrames;
  const variance = Math.max(0, sumSq / nFrames - mean * mean);
  const stdDev = Math.sqrt(variance);

  // 4. Threshold (spec-formula: mean + (1 - 2·sensitivity)·stdDev)
  const threshold = mean + (1 - 2 * sensitivity) * stdDev;

  // Strict >: ensures silent / all-zero signal produces no onsets
  // (flux=0 everywhere, threshold=0, no f satisfies flux[f] > 0).

  // 5. Peak-Picking mit ±1-Window + minDistance
  const denom = Math.max(STRENGTH_DENOMINATOR_EPS, maxFlux - threshold);
  const onsets: DetectedOnset[] = [];
  let lastOnsetPos = -Infinity;

  for (let f = 1; f < nFrames - 1; f++) {
    const v = flux[f];
    if (!(v > threshold)) continue;
    if (!(v > flux[f - 1])) continue;
    if (!(v > flux[f + 1])) continue;

    const samplePos = f * hopSize;
    if (samplePos - lastOnsetPos < minDistanceSamples) continue;

    const strength = clamp01((v - threshold) / denom);
    onsets.push({
      samplePos,
      timeSec: samplePos / sampleRate,
      strength,
    });
    lastOnsetPos = samplePos;
  }

  return onsets;
}
