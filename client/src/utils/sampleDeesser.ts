/**
 * Synthstudio - sampleDeesser.ts (v3.227.0)
 *
 * Pure-Helper fuer De-Essing — suppress harsh sibilants im 4-10 kHz Bereich.
 * Vereinfachte Implementation per Spec: HP one-pole at freqHz -> tanh -> envelope
 * follower -> subtract scaled sibilant component from original signal.
 *
 * Algorithm (per sample, per channel):
 *
 *   sib[n]     = tanh(HP(in[n]))               // sibilant band, bounded to (-1,1)
 *   env[n]     = max(|sib[n]|, env[n-1] * RC)  // peak envelope w/ release
 *   gainRed    = (env > threshold)
 *                  ? max(0, 1 - (env - threshold) * (1 - 1/ratio))
 *                  : 1
 *   out[n]     = in[n] - sib[n] * (1 - gainRed)
 *
 * Wichtige Eigenschaften:
 *
 * - ratio=1     -> 1 - 1/1 = 0 -> gainRed === 1 -> out === in (transparent).
 * - threshold=1 -> env <= |sib| <= 1 (tanh-Bound), env never STRICTLY crosses 1
 *                  -> gainRed === 1 -> transparent unabhaengig vom Input.
 *                  (Wir nutzen strict > Vergleich damit der Threshold-Boundary
 *                  als no-op behandelt wird.)
 * - threshold=0 -> jedes nicht-stille sibilant-Sample triggert Reduktion.
 *
 * tanh ist symmetrisch, monoton, garantiert |sib| < 1 unabhaengig vom Input-
 * Pegel — das ist warum threshold=1 sauber als no-op funktioniert. Eine reine
 * HP-without-tanh-Variante koennte env > 1 produzieren und den threshold=1
 * Test sprengen.
 *
 * Envelope: instant attack + one-pole release (RELEASE_MS = 50 ms).
 * release_coef = exp(-1 / (RELEASE_MS * sampleRate / 1000)).
 * Per-Channel frischer env-State (env=0 zu Beginn) + frischer HP-State
 * (y[n-1]=x[n-1]=0) — kein Cross-Channel-Coupling, analog sampleHighPass
 * (v3.199) / sampleCompressor (v3.188) / sampleExciter (v3.224).
 *
 * Length-Preservation + Channel-Preservation (output.numberOfChannels ===
 * input.numberOfChannels — kein mono->stereo-Upmix wie Haas/AutoPan).
 *
 * Foundation fuer SampleTransformDialog FX-Karte 'De-Esser' (v3.227+ Wire-Up),
 * Bulk-Deesser-Action im SampleBrowser (Vocal-Cleanup-Workflow), und Insert-FX
 * im Mixer fuer Live-Vocal-Spuren.
 *
 * --- Defensive Defaults ----------------------------------------------------
 *
 * - empty / null Buffer       -> empty AudioBufferLike (fallback sampleRate=48000,
 *                                numberOfChannels=0)
 * - freqHz NaN / <500 / undef -> 6000 (Default-Fallback, NICHT Clamp)
 * - freqHz > 20000            -> 20000 (Clamp-high)
 * - freqHz +Infinity          -> 20000 (Clamp-high)
 * - freqHz -Infinity          -> 6000 (Default via <500-Pfad)
 * - threshold NaN/undef       -> 0.3 (Default)
 * - threshold <0              -> 0 (Clamp-low)
 * - threshold >1              -> 1 (Clamp-high)
 * - ratio NaN/undef           -> 4 (Default)
 * - ratio <1                  -> 4 (Default-Fallback per Spec)
 * - ratio >50                 -> 50 (Clamp-high)
 * - Input wird NIE mutiert; alle Writes in fresh Float32Arrays.
 *
 * --- Tests ----------------------------------------------------------------
 *
 * Siehe tests/features/sample-deesser.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Public Types ------------------------------------------------------------

export interface DeesserOptions {
  /** Sibilance center frequency in Hz. 3000..12000 musikalisch (Runtime-Clamp 500..20000). Default 6000. */
  freqHz?: number;
  /** Threshold 0..1 — above this envelope level the sibilant component is compressed. Default 0.3. */
  threshold?: number;
  /** Compression ratio 1..20 (Runtime-Clamp 1..50). Default 4. */
  ratio?: number;
}

// --- Constants / Defaults ----------------------------------------------------

export const DEFAULT_FREQ_HZ = 6000;
export const DEFAULT_THRESHOLD = 0.3;
export const DEFAULT_RATIO = 4;

const MIN_FREQ_HZ = 500;
const MAX_FREQ_HZ = 20000;
const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 1;
const MIN_RATIO = 1;
const MAX_RATIO = 50;
const FALLBACK_SAMPLE_RATE = 48000;

/** One-pole release time in ms. Not exposed in the public API per spec. */
const RELEASE_MS = 50;

// --- Internal Sanitizers -----------------------------------------------------

function sanitizeFreq(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_FREQ_HZ;
  if (typeof value !== "number") return DEFAULT_FREQ_HZ;
  if (Number.isNaN(value)) return DEFAULT_FREQ_HZ;
  if (value === Number.POSITIVE_INFINITY) return MAX_FREQ_HZ;
  // -Infinity is < MIN_FREQ_HZ -> default fallback
  if (value < MIN_FREQ_HZ) return DEFAULT_FREQ_HZ;
  if (value > MAX_FREQ_HZ) return MAX_FREQ_HZ;
  return value;
}

function sanitizeThreshold(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_THRESHOLD;
  if (typeof value !== "number") return DEFAULT_THRESHOLD;
  if (Number.isNaN(value)) return DEFAULT_THRESHOLD;
  if (value < MIN_THRESHOLD) return MIN_THRESHOLD;
  if (value > MAX_THRESHOLD) return MAX_THRESHOLD;
  return value;
}

function sanitizeRatio(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_RATIO;
  if (typeof value !== "number") return DEFAULT_RATIO;
  if (Number.isNaN(value)) return DEFAULT_RATIO;
  if (value < MIN_RATIO) return DEFAULT_RATIO;
  if (value > MAX_RATIO) return MAX_RATIO;
  return value;
}

// --- Public API --------------------------------------------------------------

/**
 * Wendet einen De-Esser auf den Buffer an. Gibt einen NEUEN Buffer zurueck
 * (Input wird nicht mutiert). Jeder Channel hat frischen Filter- und
 * Envelope-State.
 *
 * Edge-Cases:
 *   - empty / null buffer        -> empty buffer (numberOfChannels=0)
 *   - ratio=1                    -> identity (gainRed === 1)
 *   - threshold=1                -> identity (env <= 1 dank tanh-Bound)
 *   - threshold=0                -> max compression auf jedes non-zero sibilant
 *   - NaN / undefined options    -> default fallbacks
 */
export function applyDeesser(
  buffer: AudioBufferLike,
  opts: DeesserOptions = {},
): AudioBufferLike {
  const sampleRate = buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE;
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

  const freqHz = sanitizeFreq(opts.freqHz);
  const threshold = sanitizeThreshold(opts.threshold);
  const ratio = sanitizeRatio(opts.ratio);

  // One-pole high-pass coefficient: alpha = exp(-2*PI*fc/fs).
  // y[n] = alpha * (y[n-1] + x[n] - x[n-1])
  const alpha = Math.exp((-2 * Math.PI * freqHz) / sampleRate);

  // One-pole release coefficient: env[n] = max(|sib|, env[n-1] * releaseCoef).
  const releaseSamples = Math.max(1, (RELEASE_MS * sampleRate) / 1000);
  const releaseCoef = Math.exp(-1 / releaseSamples);

  const slope = 1 - 1 / ratio; // 0 when ratio===1 -> gainRed always 1 -> identity

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    // Per-channel state — fresh, no cross-channel coupling.
    let yPrev = 0; // HP y[n-1]
    let xPrev = 0; // HP x[n-1]
    let env = 0;   // peak envelope

    for (let i = 0; i < len; i++) {
      const x = src[i];

      // One-pole high-pass
      const yHp = alpha * (yPrev + x - xPrev);
      yPrev = yHp;
      xPrev = x;

      // Tanh-saturator on HP output: guarantees |sib| < 1 for any finite input.
      const sib = Math.tanh(yHp);

      // Peak envelope with instant attack + one-pole release.
      const absSib = Math.abs(sib);
      const decayed = env * releaseCoef;
      env = absSib > decayed ? absSib : decayed;

      // Gain-reduction factor: 1 = no reduction, 0 = full subtract.
      // Strict > so threshold=1 (with env <= 1) is exactly transparent.
      let gainRed = 1;
      if (env > threshold) {
        gainRed = 1 - (env - threshold) * slope;
        if (gainRed < 0) gainRed = 0;
      }

      // Subtract scaled sibilant component from the original signal.
      dst[i] = x - sib * (1 - gainRed);
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

// --- Presets -----------------------------------------------------------------

/**
 * Curated De-Esser-Presets. Stable Order fuer Dropdown-Rendering.
 *   - light:    sanfte Air/Top-End-Politur
 *   - medium:   Default fuer Vocal-Mix
 *   - heavy:    aggressive Sibilant-Reduktion
 *   - surgical: schmaler, sehr starker Compressor fuer Studio-Mastering
 */
export const DEESSER_PRESETS = {
  light:    { freqHz: 7000, threshold: 0.5, ratio: 2 },
  medium:   { freqHz: 6000, threshold: 0.3, ratio: 4 },
  heavy:    { freqHz: 5000, threshold: 0.2, ratio: 8 },
  surgical: { freqHz: 6500, threshold: 0.4, ratio: 12 },
} as const;