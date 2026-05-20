/**
 * Synthstudio sampleSilenceDetector.ts (v3.179.0)
 *
 * Pure-Helper fuer das Auffinden silenter Regionen in einem Audio-Sample.
 * Foundation fuer:
 *   - Auto-Trim-Silence (head + tail + interior dead-zones)
 *   - Sample-Cleanup-Workflows (interior silence -> Multi-Slice-Split)
 *   - Loop-Optimization (Detektion eines "tail silence" Bereichs zum Cutten)
 *   - UI-Overlay im Sample-Browser: "Silence X.YYs erkannt"
 *
 * Algorithmus:
 *   1. Mono-Downmix (arith. Mittelwert aller Kanaele).
 *   2. Linear-Scan: track "current run" of silence.
 *      - sample.abs < threshold     -> verlaengere current-run
 *      - sample.abs >= threshold    -> if current-run >= minRegionSamples
 *                                        push Region; reset run.
 *   3. Nach dem Loop: flush, falls die letzte run noch offen + >= min ist.
 *
 * Defensive Defaults:
 *   - empty / null buffer      -> []
 *   - threshold !finite / <0   -> 0.005 (~-46 dBFS)
 *   - minRegionSamples !finite / <1 -> 4800 (100 ms bei 48 kHz)
 *
 * Pure & DOM-frei (Node-testbar). Importiert nur den AudioBufferLike-Type aus
 * sampleEmbedding.ts (kein circular import dadurch).
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// Konstanten

/** Default Threshold (linear amplitude). 0.005 ~ -46 dBFS. */
export const DEFAULT_THRESHOLD = 0.005;

/** Default Min-Region-Length in Samples. 4800 @ 48 kHz = 100 ms. */
export const DEFAULT_MIN_REGION_SAMPLES = 4800;

// Public Types

export interface SilenceRegion {
  /** Erstes Sample-Index der Region (inclusive). */
  startSample: number;
  /** Letztes Sample-Index +1 (exclusive). */
  endSample: number;
  /** Anzahl Samples in der Region (= endSample - startSample). */
  durationSamples: number;
  /** Sekunden ab Buffer-Start. */
  startSec: number;
  /** Sekunden ab Buffer-Start (exclusive). */
  endSec: number;
}

export interface SilenceDetectorOptions {
  /** Threshold linear amplitude. Default 0.005 (-46 dBFS). */
  threshold?: number;
  /** Min-Region-Length in samples. Default 4800 (100ms @ 48k). */
  minRegionSamples?: number;
}

// Internal Sanitizers

function sanitizeThreshold(value: number | undefined): number {
  if (value === undefined) return DEFAULT_THRESHOLD;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_THRESHOLD;
  return value;
}

function sanitizeMinRegionSamples(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MIN_REGION_SAMPLES;
  if (!Number.isFinite(value) || value < 1) return DEFAULT_MIN_REGION_SAMPLES;
  return Math.floor(value);
}

/**
 * Mono-Downmix per Sample-Index. Arith. Mittelwert aller Kanaele.
 * Single-channel passthrough.
 */
function readMonoSample(
  buffer: AudioBufferLike,
  channels: Float32Array[],
  index: number,
): number {
  if (channels.length === 1) {
    return channels[0][index];
  }
  let sum = 0;
  for (let c = 0; c < channels.length; c++) {
    sum += channels[c][index];
  }
  return sum / channels.length;
}

// Public API

/**
 * Findet alle silenten Regionen im Buffer, deren Laenge >= minRegionSamples
 * ist. Mono-Downmix; jeder Sample-Wert mit Math.abs < threshold gilt als
 * "silent".
 *
 * Defensive: empty/null buffer -> []. threshold und minRegionSamples werden
 * via sanitize-Helper geclampt (NaN/Infinity/negativ -> Default).
 */
export function detectSilenceRegions(
  buffer: AudioBufferLike,
  options?: SilenceDetectorOptions,
): SilenceRegion[] {
  const threshold = sanitizeThreshold(options?.threshold);
  const minRegionSamples = sanitizeMinRegionSamples(options?.minRegionSamples);

  // Edge: leeres / fehlendes Buffer
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return [];
  }

  const length = buffer.length;
  const sampleRate = buffer.sampleRate > 0 ? buffer.sampleRate : 48000;

  // Cache Channel-Data-Arrays (vermeidet getChannelData-Call pro Sample)
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  const regions: SilenceRegion[] = [];
  let runStart = -1; // -1 = keine offene run

  for (let i = 0; i < length; i++) {
    const mono = readMonoSample(buffer, channels, i);
    const isSilent = Math.abs(mono) < threshold;

    if (isSilent) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      const runLength = i - runStart;
      if (runLength >= minRegionSamples) {
        regions.push(makeRegion(runStart, i, sampleRate));
      }
      runStart = -1;
    }
  }

  // Trailing-silence flush: falls Buffer mit silence endet.
  if (runStart >= 0) {
    const runLength = length - runStart;
    if (runLength >= minRegionSamples) {
      regions.push(makeRegion(runStart, length, sampleRate));
    }
  }

  return regions;
}

/**
 * Helper: Total Silence-Duration in Sekunden (Summe ueber alle Regionen).
 * Nutzt endSec - startSec; keine sampleRate-Division noetig.
 */
export function totalSilenceSec(regions: readonly SilenceRegion[]): number {
  let total = 0;
  for (const r of regions) {
    total += r.endSec - r.startSec;
  }
  return total;
}

/**
 * Helper: Liefert die laengste Silence-Region (per durationSamples) oder null
 * falls die Liste leer ist.
 */
export function longestSilenceRegion(
  regions: readonly SilenceRegion[],
): SilenceRegion | null {
  if (regions.length === 0) return null;
  let best = regions[0];
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].durationSamples > best.durationSamples) {
      best = regions[i];
    }
  }
  return best;
}

// Internal Helpers

function makeRegion(
  startSample: number,
  endSample: number,
  sampleRate: number,
): SilenceRegion {
  return {
    startSample,
    endSample,
    durationSamples: endSample - startSample,
    startSec: startSample / sampleRate,
    endSec: endSample / sampleRate,
  };
}
