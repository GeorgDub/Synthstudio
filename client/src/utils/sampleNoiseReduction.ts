/**
 * sampleNoiseReduction.ts (v3.218)
 *
 * Pure-Helper fuer Background-Noise-Removal via spectral subtraction
 * (simplified block-wise variant): lernt ein Noise-Profil aus den ersten
 * noiseProfileMs des Buffers (RMS-Energie), und attenuiert anschliessend
 * jeden 1024-Sample-Block dessen RMS unterhalb eines abgeleiteten Threshold
 * liegt.
 *
 * Foundation fuer:
 * - Remove-Hum / Remove-Hiss FX-Karte im SampleTransformDialog,
 * - Bulk-NoiseReduce im SampleBrowser (Cleanup vor Sample-Pack-Export),
 * - Field-Recording-Reinigung vor Slice-Detection / Auto-Tune-Workflows.
 *
 * Algorithmus (vereinfachte Variante per Spec - block-wise, nicht
 * per-sample-soft-knee):
 *  1) noiseProfile = RMS der ersten noiseProfileMs Samples pro Channel.
 *  2) threshold = noiseRms * (1 - reduction).
 *  3) Pro 1024-Sample-Block (letzter Block ggf. kuerzer):
 *     - blockRms = sqrt(mean(x^2))
 *     - if blockRms < threshold: factor = spectralFloor
 *       else:                     factor = 1 - reduction * exp(-(blockRms - threshold) * 10)
 *     - output[i] = clamp(input[i] * factor, -1, 1)
 *
 * Spezialfaelle:
 *  - reduction === 0  -> Identity (frueher Exit nach Sanitizer-Klar)
 *  - Buffer < noiseProfile -> ganzer Buffer wird als Noise-Profil verwendet
 *
 * Pure und DOM-frei.  Einzige Abhaengigkeit: AudioBufferLike-Type aus
 * sampleEmbedding.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Public Types -----------------------------------------------------------

export interface NoiseReductionOptions {
  /** Laenge des Noise-Lern-Fensters in ms.  10..500 typisch, hart-clamped 10..2000.  Default 100. */
  noiseProfileMs?: number;
  /** Wie stark unterhalb der Schwelle attenuiert wird.  0..1, default 0.7. */
  reduction?: number;
  /** Minimal-Faktor fuer below-threshold-Bloecke (keine voellige Stille).  0..1, default 0.1. */
  spectralFloor?: number;
}

// --- Konstanten -------------------------------------------------------------

const DEFAULT_NOISE_PROFILE_MS = 100;
const MIN_NOISE_PROFILE_MS = 10;
const MAX_NOISE_PROFILE_MS = 2000;

const DEFAULT_REDUCTION = 0.7;
const MIN_REDUCTION = 0;
const MAX_REDUCTION = 1;

const DEFAULT_SPECTRAL_FLOOR = 0.1;
const MIN_SPECTRAL_FLOOR = 0;
const MAX_SPECTRAL_FLOOR = 1;

const BLOCK_SIZE = 1024;
const FALLBACK_SAMPLE_RATE = 48000;

/**
 * Default-Werte als gefrorenes Re-Export-Objekt damit Caller / Tests die
 * exakten Defaults referenzieren koennen ohne Magic-Numbers zu duplizieren.
 */
export const NOISE_REDUCTION_DEFAULTS = Object.freeze({
  noiseProfileMs: DEFAULT_NOISE_PROFILE_MS,
  reduction: DEFAULT_REDUCTION,
  spectralFloor: DEFAULT_SPECTRAL_FLOOR,
});

// --- Sanitizers -------------------------------------------------------------

function sanitizeNoiseProfileMs(v: unknown): number {
  // Spec: NaN/<10 -> 100 (default), >2000 -> 2000 (clamp).
  if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_NOISE_PROFILE_MS) {
    return DEFAULT_NOISE_PROFILE_MS;
  }
  if (v > MAX_NOISE_PROFILE_MS) return MAX_NOISE_PROFILE_MS;
  return v;
}

function sanitizeReduction(v: unknown): number {
  // Spec interpretation: NaN/undefined -> default 0.7 (ungueltig -> default).
  // <0 -> 0 (explizit zu klein -> low-clamp = Identity-Pfad).
  // >1 -> 1 (high-clamp).
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return DEFAULT_REDUCTION;
  }
  if (v < MIN_REDUCTION) return MIN_REDUCTION;
  if (v > MAX_REDUCTION) return MAX_REDUCTION;
  return v;
}

function sanitizeSpectralFloor(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return DEFAULT_SPECTRAL_FLOOR;
  }
  if (v < MIN_SPECTRAL_FLOOR) return MIN_SPECTRAL_FLOOR;
  if (v > MAX_SPECTRAL_FLOOR) return MAX_SPECTRAL_FLOOR;
  return v;
}

// --- Buffer-Wrapper (analog samplePhaser / sampleClickRemover) --------------

function wrapBuffer(
  channels: Float32Array[],
  length: number,
  sampleRate: number,
): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length,
    getChannelData(ch: number): Float32Array {
      const data = channels[ch];
      if (!data) throw new RangeError("channel " + ch + " out of range");
      return data;
    },
  };
}

function emptyResult(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData(ch: number): Float32Array {
      throw new RangeError("channel " + ch + " out of range");
    },
  };
}

// --- DSP-Helpers ------------------------------------------------------------

function rmsOfRange(samples: Float32Array, start: number, end: number): number {
  // end ist exklusiv.  Liefert 0 wenn range invalid / empty.
  if (end <= start) return 0;
  let sumSq = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    const x = samples[i];
    const xs = Number.isFinite(x) ? x : 0;
    sumSq += xs * xs;
    count++;
  }
  if (count === 0) return 0;
  return Math.sqrt(sumSq / count);
}

function clampSample(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function copyChannelClamped(src: Float32Array): Float32Array {
  // Identity-Pfad bei reduction=0: kopiere + clamp + finite-Guard.
  const len = src.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = clampSample(src[i], -1, 1);
  }
  return out;
}

// --- Public API -------------------------------------------------------------

/**
 * Wendet Block-RMS-basiertes Noise-Reduction auf einen Sample-Buffer an.
 *
 * @param buffer  Input-Buffer.  Empty/null -> emptyResult mit Fallback-SR.
 * @param opts    NoiseReductionOptions (alle optional).
 * @returns       NEUER AudioBufferLike gleicher Laenge / Channel-Anzahl.
 *                Input wird NIE mutiert.
 */
export function reduceNoise(
  buffer: AudioBufferLike,
  opts?: NoiseReductionOptions,
): AudioBufferLike {
  if (!buffer) return emptyResult(FALLBACK_SAMPLE_RATE);
  const numCh = buffer.numberOfChannels | 0;
  const len = buffer.length | 0;
  const rawSr = buffer.sampleRate;
  const sr =
    typeof rawSr === "number" && Number.isFinite(rawSr) && rawSr > 0
      ? rawSr
      : FALLBACK_SAMPLE_RATE;
  if (numCh <= 0 || len <= 0) return emptyResult(sr);

  const noiseProfileMs = sanitizeNoiseProfileMs(opts?.noiseProfileMs);
  const reduction = sanitizeReduction(opts?.reduction);
  const spectralFloor = sanitizeSpectralFloor(opts?.spectralFloor);

  // reduction === 0 -> Identity-Copy (frueher Exit).  Clamp + finite-Guard
  // bleiben erhalten (sonst koennte ein NaN-Input durch identity-Pfad).
  if (reduction <= 0) {
    const outChannelsId: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) {
      outChannelsId.push(copyChannelClamped(buffer.getChannelData(c)));
    }
    return wrapBuffer(outChannelsId, len, sr);
  }

  // Noise-Profil-Laenge in Samples; Buffer-kuerzer-Fall: ganzer Buffer.
  const profileSamplesDesired = Math.max(1, Math.round((noiseProfileMs * sr) / 1000));
  const profileEnd = Math.min(len, profileSamplesDesired);

  const outChannels: Float32Array[] = [];

  for (let c = 0; c < numCh; c++) {
    const inCh = buffer.getChannelData(c);

    // Pro Channel eigenes Noise-Profil (Pin #6 aus Pre-Check).
    const noiseRms = rmsOfRange(inCh, 0, profileEnd);
    const threshold = noiseRms * (1 - reduction);

    const out = new Float32Array(len);

    // Block-Loop.  Letzter Block ggf. kuerzer (Pin #5).
    for (let blockStart = 0; blockStart < len; blockStart += BLOCK_SIZE) {
      const blockEnd = Math.min(blockStart + BLOCK_SIZE, len);
      const blockRms = rmsOfRange(inCh, blockStart, blockEnd);

      let factor: number;
      if (blockRms < threshold) {
        factor = spectralFloor;
      } else {
        // Soft-knee oberhalb der Schwelle: nahe der Schwelle staerker reduziert,
        // weit oberhalb fast unveraendert.
        const knee = Math.exp(-(blockRms - threshold) * 10);
        factor = 1 - reduction * knee;
      }
      if (!Number.isFinite(factor)) factor = 0;

      for (let i = blockStart; i < blockEnd; i++) {
        const v = inCh[i] * factor;
        out[i] = clampSample(v, -1, 1);
      }
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, len, sr);
}
