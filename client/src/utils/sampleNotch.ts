/**
 * Synthstudio - sampleNotch.ts (v3.229.0)
 *
 * Pure-Helper fuer Notch-Filter (Band-Reject) via direkter RBJ-Biquad-
 * Implementierung. Gegenstueck zu sampleBandPass (v3.201) - statt eine
 * schmale Frequenz durchzulassen, wird sie unterdrueckt.
 *
 * Typische Anwendungen: 50/60Hz Hum-Removal, Resonanz-Spitzen aus Raum-
 * Aufnahmen entfernen, ueberlauernde Mitten-Frequenzen ausblenden.
 *
 * DSP-Modell (RBJ Audio EQ Cookbook, Notch):
 *
 *   omega = 2*PI * freqHz / sampleRate
 *   alpha = sin(omega) / (2 * q)
 *   b0 = 1
 *   b1 = -2 * cos(omega)
 *   b2 = 1
 *   a0 = 1 + alpha
 *   a1 = -2 * cos(omega)
 *   a2 = 1 - alpha
 *
 *   y[n] = (b0/a0)*x[n] + (b1/a0)*x[n-1] + (b2/a0)*x[n-2]
 *        - (a1/a0)*y[n-1] - (a2/a0)*y[n-2]
 *
 * Eigenschaften des Notch-Filters:
 *   - H(freqHz)  ~= 0  (Stop-Band)
 *   - H(DC)       = 1  (passes DC im Steady-State)
 *   - H(Nyquist)  = 1
 *   - hoeheres q     -> schmaleres Notch (Quality-Factor, INVERSE zur Bandbreite)
 *
 * Per-Channel-State unabhaengig (frischer x[-1]/x[-2]/y[-1]/y[-2] = 0).
 *
 * --- Defensive Defaults --------------------------------------------------
 *
 * - empty / null Buffer         -> empty AudioBufferLike (fallback sr=48000)
 * - freqHz NaN/<10/non-number   -> 1000 Hz Default
 * - freqHz > Nyquist            -> Nyquist/2 (Spec)
 * - q NaN/<0.1/non-number       -> 5 Default
 * - q > 50                      -> 50 Clamp
 * - Input wird NIE mutiert; alle Writes in fresh Float32Arrays.
 * - Output garantiert finite (RBJ Notch ist BIBO-stable fuer q>0).
 *
 * Sanitizer-Ordering (Pin): Default-Substitution ZUERST, dann Nyquist-Clamp.
 * Beispiel sr=1500 (degenerate), freqHz=NaN -> Default 1000 > Nyquist=750
 * -> wird nachgeschaltet auf Nyquist/2 = 375 geclampt.
 *
 * --- Tests ---------------------------------------------------------------
 *
 * Siehe tests/features/sample-notch.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Public Types ---------------------------------------------------------

export interface NotchOptions {
  /** Notch-Center-Frequenz in Hz. Default 1000. > Nyquist -> Nyquist/2. */
  freqHz?: number;
  /** Quality-Factor (hoeher = schmaler). Default 5. Clamped auf [0.1, 50]. */
  q?: number;
}

// --- Constants ------------------------------------------------------------

export const DEFAULT_FREQ_HZ = 1000;
export const DEFAULT_Q = 5;
export const MIN_FREQ_HZ = 10;
export const MIN_Q = 0.1;
export const MAX_Q = 50;
const FALLBACK_SAMPLE_RATE = 48000;

// --- Internal Sanitizers --------------------------------------------------

function resolveFreq(value: number | undefined, sampleRate: number): number {
  let v: number;
  if (value === undefined || value === null) v = DEFAULT_FREQ_HZ;
  else if (typeof value !== "number") v = DEFAULT_FREQ_HZ;
  else if (!Number.isFinite(value)) v = DEFAULT_FREQ_HZ;
  else if (value < MIN_FREQ_HZ) v = DEFAULT_FREQ_HZ;
  else v = value;
  const nyquist = sampleRate / 2;
  if (v > nyquist) return nyquist / 2;
  return v;
}

function resolveQ(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_Q;
  if (typeof value !== "number") return DEFAULT_Q;
  if (!Number.isFinite(value)) return DEFAULT_Q;
  if (value < MIN_Q) return DEFAULT_Q;
  if (value > MAX_Q) return MAX_Q;
  return value;
}

// --- Public API -----------------------------------------------------------

/**
 * Wendet einen Biquad-Notch-Filter auf den Buffer an. Gibt einen NEUEN
 * Buffer zurueck (Input wird nicht mutiert). Jeder Channel hat frischen
 * Filter-State.
 *
 * Edge-Cases:
 *   - empty / null buffer -> empty buffer mit fallback sr=48000
 *   - freqHz invalid      -> 1000 Hz Default
 *   - freqHz > Nyquist    -> Nyquist/2 per Spec
 *   - q invalid           -> 5 Default; > 50 -> 50
 */
export function applyNotch(
  buffer: AudioBufferLike,
  options: NotchOptions = {},
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

  const freqHz = resolveFreq(options.freqHz, sampleRate);
  const q = resolveQ(options.q);

  // RBJ Biquad Notch coefficients (normalized by a0)
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);
  const alpha = sinW / (2 * q);

  const a0 = 1 + alpha;
  const b0 = 1 / a0;
  const b1 = (-2 * cosW) / a0;
  const b2 = 1 / a0;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;

  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    let xm1 = 0;
    let xm2 = 0;
    let ym1 = 0;
    let ym2 = 0;
    for (let i = 0; i < len; i++) {
      const x = src[i];
      const y = b0 * x + b1 * xm1 + b2 * xm2 - a1 * ym1 - a2 * ym2;
      dst[i] = y;
      xm2 = xm1;
      xm1 = x;
      ym2 = ym1;
      ym1 = y;
    }
    channels.push(dst);
  }

  return {
    sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) {
        throw new RangeError(
          "channel " + c + " out of range (0.." + (chCount - 1) + ")",
        );
      }
      return channels[c];
    },
  };
}

// --- Presets --------------------------------------------------------------

/**
 * Curated Presets fuer haeufige Notch-Anwendungen:
 *   - hum50 / hum60: schmaler Notch fuer Netz-Hum (EU / US)
 *   - midReject:     1 kHz mit moderater Bandbreite (Boxiness raus)
 *   - presence:      3 kHz Notch (zu helle Hi-Mids daempfen)
 */
export const NOTCH_PRESETS = {
  hum50: { freqHz: 50, q: 30 },
  hum60: { freqHz: 60, q: 30 },
  midReject: { freqHz: 1000, q: 5 },
  presence: { freqHz: 3000, q: 8 },
} as const;
