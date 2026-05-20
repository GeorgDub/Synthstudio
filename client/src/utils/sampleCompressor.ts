/**
 * Synthstudio - sampleCompressor.ts (v3.188.0)
 *
 * Pure-DSP classic downward Compressor:
 *   Reduces signal amplitude above a configurable threshold by `ratio`-to-1,
 *   with smoothed gain-reduction envelope (attack + release in ms), optional
 *   soft-knee region (kneeDb), and optional makeup-gain (dB).
 *
 * Algorithm (per sample, per channel):
 *   level_db   = 20 * log10(|s| + epsilon)
 *   target_gr  = soft-knee piecewise:
 *     - if level_db > threshold + knee/2   -> hard-knee: (level - threshold) * (1 - 1/ratio)
 *     - elif level_db > threshold - knee/2 -> soft-knee: ((level - (threshold-knee/2))^2 / (2*knee)) * (1 - 1/ratio)
 *     - else                               -> 0 (no reduction)
 *   coef      = (target > envelope) ? attack_coef : release_coef
 *   envelope  = envelope * coef + target * (1 - coef)
 *   out[i]    = s * 10^(-envelope/20) * 10^(makeup/20)
 *
 * Pure & DOM-frei -> Node-testbar. Eingaben werden nie mutiert.
 * Per-channel state: each channel has its own envelope follower — no
 * cross-channel coupling.
 *
 * --- Design Notes ---------------------------------------------------------
 *
 * The "envelope" here is the GAIN-REDUCTION envelope (in dB, non-negative),
 *   NOT a signal envelope of |s|. The per-sample input goes directly into
 *   `level_db = 20*log10(|s| + EPS)` with no input smoothing — only the
 *   gain-reduction itself is smoothed via the one-pole follower. This
 *   matches the classic feed-forward compressor topology.
 *
 * knee=0 safety: the conditional is structured so the soft-knee branch
 *   (which divides by `2*knee`) never executes when knee==0. The hard-knee
 *   branch handles the boundary cleanly.
 *
 * Ratio clamp: ratio<1 makes no physical sense (expansion), so we clamp
 *   ratio>=1. ratio=1 yields zero reduction (1 - 1/1 = 0).
 *
 * Tests: tests/features/sample-compressor.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface CompressorOptions {
  /** Threshold in dBFS. Default -18. */
  thresholdDb?: number;
  /** Compression ratio (n:1). Default 4. Clamped to >=1. */
  ratio?: number;
  /** Attack time in ms. Default 5. */
  attackMs?: number;
  /** Release time in ms. Default 100. */
  releaseMs?: number;
  /** Soft-knee width in dB. Default 6. 0 = hard-knee. */
  kneeDb?: number;
  /** Make-up gain in dB applied after compression. Default 0. */
  makeupGainDb?: number;
}

// ─── Constants / Defaults ────────────────────────────────────────────────────

export const DEFAULT_THRESHOLD_DB = -18;
export const DEFAULT_RATIO = 4;
export const DEFAULT_ATTACK_MS = 5;
export const DEFAULT_RELEASE_MS = 100;
export const DEFAULT_KNEE_DB = 6;
export const DEFAULT_MAKEUP_GAIN_DB = 0;

/** Floor for log10 to avoid -Infinity on silent samples. */
const LEVEL_EPSILON = 1e-10;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function sanitizeFinite(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function sanitizeRatio(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RATIO;
  if (!Number.isFinite(value)) return DEFAULT_RATIO;
  if (value <= 0) return DEFAULT_RATIO;
  // Clamp <1 to 1 (no expansion; ratio=1 yields zero reduction).
  if (value < 1) return 1;
  return value;
}

function sanitizeNonNegativeMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  // Allow very small values (e.g. 0.1ms for Limiter preset) but not <=0.
  if (value <= 0) return 0.001;
  return value;
}

function sanitizeNonNegativeDb(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  return value;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Applies a downward compressor to a buffer. Returns a NEW buffer (input
 * is not mutated). Each channel has independent envelope state.
 *
 * Edge-Cases:
 *   - empty / null buffer            -> empty buffer (same shape signature)
 *   - all-silence input              -> all-silence output
 *   - signal below threshold-knee/2  -> identity (no reduction, no makeup)
 *   - knee=0                         -> hard-knee only (no div-by-zero)
 *   - ratio<=0 / NaN                 -> default 4; ratio<1 clamped to 1
 *   - NaN / undefined options        -> default fallbacks
 */
export function applyCompressor(
  buffer: AudioBufferLike,
  options: CompressorOptions = {},
): AudioBufferLike {
  const sampleRate = buffer?.sampleRate ?? 48000;
  const chCount = buffer?.numberOfChannels ?? 0;
  const len = buffer?.length ?? 0;

  // Empty-Buffer-Shortcut
  if (!buffer || len === 0 || chCount === 0) {
    return {
      sampleRate,
      numberOfChannels: chCount,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  // Resolve + sanitize parameters
  const thresholdDb = sanitizeFinite(options.thresholdDb, DEFAULT_THRESHOLD_DB);
  const ratio = sanitizeRatio(options.ratio);
  const attackMs = sanitizeNonNegativeMs(options.attackMs, DEFAULT_ATTACK_MS);
  const releaseMs = sanitizeNonNegativeMs(options.releaseMs, DEFAULT_RELEASE_MS);
  const kneeDb = sanitizeNonNegativeDb(options.kneeDb, DEFAULT_KNEE_DB);
  const makeupGainDb = sanitizeFinite(options.makeupGainDb, DEFAULT_MAKEUP_GAIN_DB);

  // Pre-compute envelope follower coefficients.
  //   coef = exp(-1 / (ms * sr / 1000))
  // A small floor on the sample-count prevents divide-by-zero for tiny times.
  const attackSamples = Math.max(1, (attackMs * sampleRate) / 1000);
  const releaseSamples = Math.max(1, (releaseMs * sampleRate) / 1000);
  const attackCoef = Math.exp(-1 / attackSamples);
  const releaseCoef = Math.exp(-1 / releaseSamples);

  // Pre-compute makeup-gain in linear domain.
  const makeupLinear = dbToLinear(makeupGainDb);

  // Soft-knee boundary helpers
  const slope = 1 - 1 / ratio; // 0 when ratio==1
  const kneeUpper = thresholdDb + kneeDb / 2;
  const kneeLower = thresholdDb - kneeDb / 2;
  const twoKnee = 2 * kneeDb; // 0 when kneeDb==0 — guarded by branch order

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    // Per-channel gain-reduction envelope (in dB, non-negative).
    let envelope = 0;

    for (let i = 0; i < len; i++) {
      const s = src[i];
      const absS = Math.abs(s);
      const levelDb = 20 * Math.log10(absS + LEVEL_EPSILON);

      // Soft-knee piecewise. Branch order ensures knee=0 cannot divide by zero.
      let targetGr: number;
      if (levelDb > kneeUpper) {
        // Hard-knee region
        targetGr = (levelDb - thresholdDb) * slope;
      } else if (kneeDb > 0 && levelDb > kneeLower) {
        // Soft-knee region (only reachable when kneeDb > 0)
        const x = levelDb - kneeLower;
        targetGr = ((x * x) / twoKnee) * slope;
      } else {
        targetGr = 0;
      }

      // One-pole envelope follower: attack when target rises above current,
      // release otherwise.
      const coef = targetGr > envelope ? attackCoef : releaseCoef;
      envelope = envelope * coef + targetGr * (1 - coef);

      // Total gain in dB: makeup (positive) minus reduction.
      const gainLinear = dbToLinear(-envelope) * makeupLinear;
      dst[i] = s * gainLinear;
    }

    channels.push(dst);
  }

  return {
    sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) {
        throw new RangeError(`channel ${c} out of range (0..${chCount - 1})`);
      }
      return channels[c];
    },
  };
}

// ─── Presets ─────────────────────────────────────────────────────────────────

/**
 * Curated presets covering the most common compression scenarios. Order is
 * stable so UIs can render them as a dropdown.
 */
export const COMPRESSOR_PRESETS: readonly {
  id: string;
  name: string;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupGainDb: number;
}[] = [
  { id: "soft", name: "Soft Glue", thresholdDb: -12, ratio: 2, attackMs: 30, releaseMs: 250, kneeDb: 12, makeupGainDb: 2 },
  { id: "vocal", name: "Vocal", thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 100, kneeDb: 6, makeupGainDb: 3 },
  { id: "drum-bus", name: "Drum-Bus", thresholdDb: -10, ratio: 4, attackMs: 1, releaseMs: 30, kneeDb: 2, makeupGainDb: 4 },
  { id: "limiter", name: "Limiter", thresholdDb: -1, ratio: 20, attackMs: 0.1, releaseMs: 50, kneeDb: 0, makeupGainDb: 0 },
];
