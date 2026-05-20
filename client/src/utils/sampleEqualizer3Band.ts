/**
 * Synthstudio – sampleEqualizer3Band.ts (v3.181.0)
 *
 * Pure-DSP 3-Band Parametric Equalizer:
 *   Low-Shelf -> Mid-Peak -> High-Shelf  (sequential biquad chain)
 *
 * Biquad-Koeffizienten nach Audio EQ Cookbook (Robert Bristow-Johnson):
 *   https://www.w3.org/TR/audio-eq-cookbook/
 *
 * Direct-Form-I Implementierung pro Channel (eigene State-History pro Band
 * und pro Channel — keine Cross-Channel-Bleeds).
 *
 * Alle Funktionen pure & DOM-frei → Node-testbar.
 *
 * Tests: tests/features/sample-equalizer-3band.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface EqBand {
  /** Frequenz in Hz. */
  freq: number;
  /** Gain in dB (-24..+24). */
  gainDb: number;
  /** Q-Factor (0.1..10). Default 0.707 (= sqrt(2)/2). */
  q?: number;
}

export interface Equalizer3BandOptions {
  /** Low-Shelf-Band. Default { freq: 200, gainDb: 0 }. */
  low?: EqBand;
  /** Mid-Peak-Band. Default { freq: 1000, gainDb: 0, q: 0.707 }. */
  mid?: EqBand;
  /** High-Shelf-Band. Default { freq: 5000, gainDb: 0 }. */
  high?: EqBand;
}

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

// ─── Constants / Defaults ────────────────────────────────────────────────────

/** Default Q für Mid-Peak (Butterworth-Style ≈ 1/sqrt(2)). */
export const DEFAULT_Q = 0.7071067811865475;

/** Default Low-Shelf-Frequenz. */
export const DEFAULT_LOW_FREQ = 200;
/** Default Mid-Peak-Frequenz. */
export const DEFAULT_MID_FREQ = 1000;
/** Default High-Shelf-Frequenz. */
export const DEFAULT_HIGH_FREQ = 5000;

/** Fallback-Frequenz bei NaN / <=0. */
const FALLBACK_FREQ = 1000;
/** Fallback-Q bei NaN / <=0. */
const FALLBACK_Q = DEFAULT_Q;
/** Fallback-Gain bei NaN. */
const FALLBACK_GAIN = 0;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function sanitizeFreq(freq: number): number {
  if (!Number.isFinite(freq) || freq <= 0) return FALLBACK_FREQ;
  return freq;
}

function sanitizeGain(gainDb: number): number {
  if (!Number.isFinite(gainDb)) return FALLBACK_GAIN;
  return gainDb;
}

function sanitizeQ(q: number | undefined): number {
  if (q === undefined) return FALLBACK_Q;
  if (!Number.isFinite(q) || q <= 0) return FALLBACK_Q;
  return q;
}

// ─── Biquad Coefficient Builders (Audio EQ Cookbook) ─────────────────────────

/**
 * Peaking (Bell) EQ coefficients — für Mid-Band.
 *
 * Pure formula:
 *   A   = 10^(gainDb/40)
 *   w0  = 2pi · freq / sampleRate
 *   alpha = sin(w0) / (2·Q)
 *   b0  = 1 + alpha·A
 *   b1  = -2·cos(w0)
 *   b2  = 1 - alpha·A
 *   a0  = 1 + alpha/A
 *   a1  = -2·cos(w0)
 *   a2  = 1 - alpha/A
 */
export function peakingEqCoeffs(
  freq: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoeffs {
  const f = sanitizeFreq(freq);
  const qq = sanitizeQ(q);
  const g = sanitizeGain(gainDb);
  const sr = sanitizeFreq(sampleRate);

  const A = Math.pow(10, g / 40);
  const w0 = (2 * Math.PI * f) / sr;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = sinW / (2 * qq);

  return {
    b0: 1 + alpha * A,
    b1: -2 * cosW,
    b2: 1 - alpha * A,
    a0: 1 + alpha / A,
    a1: -2 * cosW,
    a2: 1 - alpha / A,
  };
}

/**
 * Low-Shelf EQ coefficients (S = 1, shelf slope fest).
 */
export function lowShelfCoeffs(
  freq: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoeffs {
  const f = sanitizeFreq(freq);
  const g = sanitizeGain(gainDb);
  const sr = sanitizeFreq(sampleRate);

  const A = Math.pow(10, g / 40);
  const w0 = (2 * Math.PI * f) / sr;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  // S = 1 -> alpha = sin(w)/2 · sqrt((A + 1/A)·(1/S - 1) + 2) = sin(w)/2 · sqrt(2)
  const alpha = (sinW / 2) * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2);
  const sqrtA = Math.sqrt(A);

  return {
    b0: A * ((A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha),
    b1: 2 * A * ((A - 1) - (A + 1) * cosW),
    b2: A * ((A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha),
    a0: (A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha,
    a1: -2 * ((A - 1) + (A + 1) * cosW),
    a2: (A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha,
  };
}

/**
 * High-Shelf EQ coefficients (S = 1).
 */
export function highShelfCoeffs(
  freq: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoeffs {
  const f = sanitizeFreq(freq);
  const g = sanitizeGain(gainDb);
  const sr = sanitizeFreq(sampleRate);

  const A = Math.pow(10, g / 40);
  const w0 = (2 * Math.PI * f) / sr;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = (sinW / 2) * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2);
  const sqrtA = Math.sqrt(A);

  return {
    b0: A * ((A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha),
    b1: -2 * A * ((A - 1) + (A + 1) * cosW),
    b2: A * ((A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha),
    a0: (A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha,
    a1: 2 * ((A - 1) - (A + 1) * cosW),
    a2: (A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha,
  };
}

// ─── Direct-Form-I Filter Application ────────────────────────────────────────

/**
 * Wendet ein Biquad-Filter auf samples an. Liefert neues Float32Array.
 * Direct Form I — pro Aufruf eigene State-History.
 *
 *   y[n] = (b0/a0)·x[n] + (b1/a0)·x[n-1] + (b2/a0)·x[n-2]
 *        - (a1/a0)·y[n-1] - (a2/a0)·y[n-2]
 */
function applyBiquad(src: Float32Array, coeffs: BiquadCoeffs) {
  const { b0, b1, b2, a0, a1, a2 } = coeffs;
  const len = src.length;
  const dst = new Float32Array(len);

  // Normalisiere durch a0
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < len; i++) {
    const x0 = src[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    dst[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return dst;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet 3-Band EQ auf einen Buffer an. Liefert neuen Buffer.
 *
 * Sequential processing: low-shelf -> mid-peak -> high-shelf.
 * Bands mit gainDb ≈ 0 werden übersprungen (Bypass — keine Filter-Artefakte).
 *
 * Edge-Cases:
 *   - empty buffer -> empty buffer (gleiche Channel-Anzahl & sampleRate)
 *   - alle Bands gainDb=0 -> identity (Float32Array-Kopie, nicht das Original)
 */
export function applyEqualizer3Band(
  buffer: AudioBufferLike,
  options: Equalizer3BandOptions = {},
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

  // Resolve defaults
  const low: EqBand = options.low ?? { freq: DEFAULT_LOW_FREQ, gainDb: 0 };
  const mid: EqBand = options.mid ?? { freq: DEFAULT_MID_FREQ, gainDb: 0, q: DEFAULT_Q };
  const high: EqBand = options.high ?? { freq: DEFAULT_HIGH_FREQ, gainDb: 0 };

  const lowGain = sanitizeGain(low.gainDb);
  const midGain = sanitizeGain(mid.gainDb);
  const highGain = sanitizeGain(high.gainDb);

  // Detect bypass-conditions (gain≈0 -> kein Filter-Run)
  const EPS = 1e-9;
  const doLow = Math.abs(lowGain) > EPS;
  const doMid = Math.abs(midGain) > EPS;
  const doHigh = Math.abs(highGain) > EPS;

  // Pre-compute coefficients (sampleRate konstant über Buffer)
  const lowCoeffs = doLow ? lowShelfCoeffs(low.freq, lowGain, sampleRate) : null;
  const midCoeffs = doMid
    ? peakingEqCoeffs(mid.freq, sanitizeQ(mid.q), midGain, sampleRate)
    : null;
  const highCoeffs = doHigh ? highShelfCoeffs(high.freq, highGain, sampleRate) : null;

  // Process each channel separately (independent biquad state)
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    // Stage 0 — copy (kein Aliasing zwischen In-Buffer und Out).
    // Explizit länge-allokieren und manuell kopieren, damit TS den
    // Float32Array-Backing-Buffer als ArrayBuffer (nicht ArrayBufferLike)
    // inferiert — sonst beißt sich die Reassignment-Inferenz mit
    // applyBiquad's return type.
    let current = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) current[i] = src[i];

    if (lowCoeffs) current = applyBiquad(current, lowCoeffs);
    if (midCoeffs) current = applyBiquad(current, midCoeffs);
    if (highCoeffs) current = applyBiquad(current, highCoeffs);

    channels.push(current);
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
