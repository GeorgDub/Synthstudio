/**
 * Synthstudio – sliceAutoDetector.ts (v3.135.0)
 *
 * Pure transient-detection v2 für auto-chopping samples (z.B. Drum-Loops in
 * Kick/Snare/Hat-Slices aufspalten).  Ergänzt das existierende
 * `transientDetection.ts` (v2.62, amplitude-delta-basiert) um einen RMS-Energy-
 * basierten ODF (Onset Detection Function) mit adaptive threshold + minDistance.
 *
 * Use-Cases:
 *   - Drum-Loop in Slices zerteilen (Snare-Hits)
 *   - Sample-Pack-Browser auto-slicen
 *   - Drum-Replacer (each detected slice → individual sound)
 *
 * Algorithmus:
 *   1. Slice signal in frames (default frame=512 samples, hop=256)
 *   2. Berechne pro Frame RMS-Energie
 *   3. Compute HW-rectified energy-diff: flux = max(0, E_n - E_(n-1))
 *   4. Detect peaks im flux-signal (mean + (2-2·sensitivity)×stdDev threshold)
 *   5. Local-max check (compare ±2 frames)
 *   6. minDistance via minSliceMs
 *
 * Public API:
 *   - detectSlicePoints(buffer, options) → number[] sample-indices
 *   - sliceAtPoints(buffer, points) → AudioBufferLike[]
 *
 * Pure & Node-testbar.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Constants ───────────────────────────────────────────────────────────────

export const SLICE_FRAME_SIZE = 512;
export const SLICE_HOP_SIZE = 256;
export const SLICE_DEFAULT_SENSITIVITY = 0.5;
export const SLICE_DEFAULT_MIN_MS = 50;
const SILENCE_FLOOR = 0.005;

export interface SliceDetectOptions {
  /** Frame size in samples. Default 512 (10.7ms@48k). */
  frameSize?: number;
  /** Hop size in samples. Default 256 (50% overlap). */
  hopSize?: number;
  /** Sensitivity 0..1. Default 0.5. Higher = more slices. */
  sensitivity?: number;
  /** Minimum slice duration in ms. Default 50. */
  minSliceMs?: number;
  /** Channel strategy: "mix" (mean), "left", "right". Default "mix". */
  channelMode?: "mix" | "left" | "right";
}

// ─── Pure Helpers ────────────────────────────────────────────────────────────

/** RMS-Energie eines Frames. */
export function sliceFrameRms(samples: Float32Array, start: number, length: number): number {
  const end = Math.min(samples.length, start + length);
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i];
    if (Number.isFinite(v)) {
      sum += v * v;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** Channel-Mean (downmix all channels). */
export function sliceDownmixMono(buffer: AudioBufferLike): Float32Array {
  const len = buffer.length;
  const result = new Float32Array(len);
  const chCount = buffer.numberOfChannels;
  if (chCount === 0) return result;
  for (let c = 0; c < chCount; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) result[i] += ch[i] / chCount;
  }
  return result;
}

function getInputSignal(buffer: AudioBufferLike, mode: "mix" | "left" | "right"): Float32Array {
  if (buffer.numberOfChannels === 0) return new Float32Array(0);
  if (mode === "left") return buffer.getChannelData(0);
  if (mode === "right") {
    const c = Math.min(1, buffer.numberOfChannels - 1);
    return buffer.getChannelData(c);
  }
  return sliceDownmixMono(buffer);
}

/**
 * Detektiert slice-points im Buffer (sortierte sample-indices).
 *
 *  - Index 0 ist immer enthalten (Start des Samples).
 *  - Bei sehr kurzen Samples → [0].
 *
 * Returns sorted ascending number[].
 */
export function detectSlicePoints(
  buffer: AudioBufferLike,
  options: SliceDetectOptions = {},
): number[] {
  if (!buffer || buffer.length === 0) return [];

  const frameSize = Math.max(64, Math.floor(options.frameSize ?? SLICE_FRAME_SIZE));
  const hopSize = Math.max(1, Math.floor(options.hopSize ?? SLICE_HOP_SIZE));
  const sensitivity = Math.max(0, Math.min(1, options.sensitivity ?? SLICE_DEFAULT_SENSITIVITY));
  const minSliceMs = Math.max(1, options.minSliceMs ?? SLICE_DEFAULT_MIN_MS);
  const channelMode = options.channelMode ?? "mix";

  const signal = getInputSignal(buffer, channelMode);
  if (signal.length < frameSize) return [0];

  const minSliceSamples = Math.floor((minSliceMs / 1000) * buffer.sampleRate);
  const nFrames = Math.floor((signal.length - frameSize) / hopSize) + 1;
  if (nFrames < 2) return [0];

  const energies = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    energies[f] = sliceFrameRms(signal, f * hopSize, frameSize);
  }

  const flux = new Float32Array(nFrames);
  for (let f = 1; f < nFrames; f++) {
    const diff = energies[f] - energies[f - 1];
    flux[f] = diff > 0 ? diff : 0;
  }

  let sum = 0;
  let sumSq = 0;
  for (let f = 0; f < nFrames; f++) {
    sum += flux[f];
    sumSq += flux[f] * flux[f];
  }
  const mean = sum / nFrames;
  const variance = Math.max(0, sumSq / nFrames - mean * mean);
  const stdDev = Math.sqrt(variance);

  const thresholdMult = 2.0 * (1 - sensitivity);
  const threshold = Math.max(SILENCE_FLOOR, mean + thresholdMult * stdDev);

  const points: number[] = [0];
  // lastPick = 0 (Start) — verhindert dass first transient zu nah am Start landet.
  let lastPick = 0;

  for (let f = 2; f < nFrames - 2; f++) {
    if (flux[f] < threshold) continue;
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    if (flux[f] < flux[f - 2] || flux[f] < flux[f + 2]) continue;
    const samplePos = f * hopSize;
    if (samplePos - lastPick < minSliceSamples) continue;
    points.push(samplePos);
    lastPick = samplePos;
  }
  return points;
}

/**
 * Slice buffer at given sample-points. Returns new buffer chunks (immutable).
 * Sortiert + filtert invalid points defensively.  Auto-prepends 0 wenn fehlend.
 */
export function sliceAtPoints(
  buffer: AudioBufferLike,
  points: readonly number[],
): AudioBufferLike[] {
  if (!buffer || buffer.length === 0 || !Array.isArray(points)) return [];
  if (points.length === 0) return [buffer];

  const sorted = points
    .filter((p) => Number.isFinite(p) && p >= 0 && p < buffer.length)
    .map((p) => Math.floor(p))
    .sort((a, b) => a - b);

  const allPoints = sorted.length === 0 || sorted[0] !== 0 ? [0, ...sorted] : sorted;

  const slices: AudioBufferLike[] = [];
  for (let i = 0; i < allPoints.length; i++) {
    const start = allPoints[i];
    const end = i + 1 < allPoints.length ? allPoints[i + 1] : buffer.length;
    if (end <= start) continue;

    const len = end - start;
    const chCount = buffer.numberOfChannels;
    const channels: Float32Array[] = [];
    for (let c = 0; c < chCount; c++) {
      const src = buffer.getChannelData(c);
      const dst = new Float32Array(len);
      for (let j = 0; j < len; j++) dst[j] = src[start + j];
      channels.push(dst);
    }
    slices.push({
      sampleRate: buffer.sampleRate,
      numberOfChannels: chCount,
      length: len,
      getChannelData: (c: number) => {
        if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
        return channels[c];
      },
    });
  }
  return slices;
}
