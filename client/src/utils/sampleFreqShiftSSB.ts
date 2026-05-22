/**
 * Synthstudio – sampleFreqShiftSSB.ts (v3.232.0)
 *
 * Pure-Helper fuer ECHTES Single-Sideband (SSB) Frequency-Shifting via
 * Hilbert-Transform-Approximation.
 *
 * ─── Abgrenzung zu v3.225 sampleFreqShift ─────────────────────────────────
 *
 * v3.225 sampleFreqShift nutzt nur cos-Carrier-Multiplikation. Da cos eine
 * GERADE Funktion ist (cos(x)=cos(-x)), produziert die Methode IDENTISCHEN
 * Output fuer +/- shiftHz und spaltet jede Eingangsfrequenz f in ZWEI
 * Seitenbaender bei (f+shiftHz) UND (f-shiftHz) (Ring-Modulation, NICHT
 * echte Frequenz-Verschiebung).
 *
 * Dieses Modul implementiert echtes SSB-Shifting via 90-Grad-Phasenversatz
 * durch eine kurze Hilbert-FIR. Damit wird EINE der beiden Seitenbaender
 * isoliert und der Output ist asymmetrisch in +/- shiftHz.
 *
 * ─── Algorithmus ──────────────────────────────────────────────────────────
 *
 * 1. Hilbert-FIR der Laenge 31 (windowed mit Blackman):
 *      h[n] mit k = n - center (center = 15)
 *      - gerade k -> h[n] = 0
 *      - ungerade k -> h[n] = (2 / (PI * k)) * blackman[n]
 *    Resultat ist eine antisymmetrische FIR; bei Faltung mit dem Input
 *    entsteht ein ~90-Grad-phasenverschobenes Signal mit konstanter
 *    Gruppenlaufzeit (length-1)/2 = 15 samples.
 *
 * 2. Pro sample n (0..len-1):
 *      I_delayed[n] = input[n - 15] (zero-padded am Anfang)
 *      Q[n]         = convolve(input, h)[n]
 *      omega        = 2*PI * shiftHz / sampleRate
 *      cosV         = cos(omega * n)
 *      sinV         = sin(omega * n)
 *
 *      shifted_upper = I_delayed[n] * cosV - Q[n] * sinV
 *      shifted_lower = I_delayed[n] * cosV + Q[n] * sinV
 *      output[n] = sideBand === "upper" ? shifted_upper : shifted_lower
 *
 *    Die ersten ~15 Samples sind eine "warmup ramp" (Hilbert-FIR baut sich
 *    aus Null-Padding auf). Tests beruecksichtigen diese Latenz.
 *
 * ─── Defensive Defaults ───────────────────────────────────────────────────
 *
 * - shiftHz  undefined -> 50
 *            NaN/non-finite -> 0 (Identity-ish, output=I_delayed[n])
 *            > 5000  -> 5000 (clamp)
 *            < -5000 -> -5000 (clamp)
 * - sideBand undefined oder !== "lower" -> "upper"
 *
 * Empty buffer -> empty output. Input wird NIE mutiert. Output-Laenge ==
 * Input-Laenge. Output garantiert finite.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_SHIFT_HZ = 50;
const DEFAULT_SIDEBAND: "upper" | "lower" = "upper";

const MAX_SHIFT_HZ = 5000;
const MIN_SHIFT_HZ = -5000;

const FALLBACK_SAMPLE_RATE = 48000;

/** Hilbert-FIR-Laenge (ungerade, fuer integer Gruppenlaufzeit). */
const HILBERT_LEN = 31;
const HILBERT_CENTER = (HILBERT_LEN - 1) / 2; // 15

// ─── Public Types ────────────────────────────────────────────────────────────

export interface FreqShiftSSBOptions {
  /**
   * Verschiebungs-Frequenz in Hz. Default 50.
   * Musikalischer Bereich -500..500; Runtime-Clamp -5000..5000.
   * Positive Werte = upward shift (echtes SSB - unterscheidet sich von
   * negativem Wert).
   * NaN/Inf -> 0 (kein shift, Output = delayed input).
   */
  shiftHz?: number;

  /**
   * "upper" (default) oder "lower" Seitenband.
   * upper: I*cos - Q*sin
   * lower: I*cos + Q*sin
   * Unbekannter Wert -> "upper".
   */
  sideBand?: "upper" | "lower";
}

// ─── Hilbert-FIR Coefficient Builder ─────────────────────────────────────────

/**
 * Berechnet die FIR-Koeffizienten fuer einen 90-Grad-Phasenversatz-Filter
 * (Hilbert-Transform-Approximation). Antisymmetrisch um center.
 * Blackman-Window zur Reduktion von Truncation-Ripple.
 *
 * Bei FIR-Laenge 31 ist die Gruppenlaufzeit (length-1)/2 = 15 samples.
 */
function buildHilbertFir(length: number): Float32Array {
  const taps = new Float32Array(length);
  const center = (length - 1) / 2;
  const Nm1 = length - 1;
  for (let n = 0; n < length; n++) {
    const k = n - center; // offset from center
    if (k === 0 || k % 2 === 0) {
      taps[n] = 0;
      continue;
    }
    // Ideal Hilbert-Coefficient: 2/(pi*k) fuer ungerades k
    const ideal = 2 / (Math.PI * k);
    // Blackman-Window: 0.42 - 0.5*cos(2pi n/(N-1)) + 0.08*cos(4pi n/(N-1))
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * n) / Nm1) +
      0.08 * Math.cos((4 * Math.PI * n) / Nm1);
    taps[n] = ideal * w;
  }
  return taps;
}

// Module-level cache: das FIR ist deterministisch und konstant fuer den fixen
// HILBERT_LEN; einmal bauen, immer wieder nutzen.
const HILBERT_FIR: Float32Array = buildHilbertFir(HILBERT_LEN);

// ─── Helpers (intern) ────────────────────────────────────────────────────────

function sanitizeShift(v: number | undefined): number {
  if (v === undefined) return DEFAULT_SHIFT_HZ;
  if (!Number.isFinite(v)) return 0;
  if (v > MAX_SHIFT_HZ) return MAX_SHIFT_HZ;
  if (v < MIN_SHIFT_HZ) return MIN_SHIFT_HZ;
  return v;
}

function sanitizeSideBand(v: string | undefined): "upper" | "lower" {
  return v === "lower" ? "lower" : DEFAULT_SIDEBAND;
}

function wrapBuffer(channels: Float32Array[], sampleRate: number): AudioBufferLike {
  const ch = channels.length;
  const len = ch === 0 ? 0 : channels[0].length;
  return {
    sampleRate,
    numberOfChannels: ch,
    length: len,
    getChannelData: (channel: number) => {
      if (channel < 0 || channel >= ch) {
        throw new RangeError("getChannelData: index " + channel + " out of range");
      }
      return channels[channel];
    },
  };
}

/**
 * FIR-Convolution mit Zero-Padding am Anfang. Output-Laenge == Input-Laenge.
 * out[n] = sum_{m=0..firLen-1} fir[m] * input[n - m]; input[i<0] = 0.
 */
function convolveFir(input: Float32Array, fir: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  const firLen = fir.length;
  const inLen = input.length;
  for (let n = 0; n < inLen; n++) {
    let acc = 0;
    // Inner loop nutzt nur Indizes m mit 0 <= n-m < inLen
    const mStart = 0;
    const mEnd = Math.min(firLen, n + 1);
    for (let m = mStart; m < mEnd; m++) {
      acc += fir[m] * input[n - m];
    }
    out[n] = acc;
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet ECHTES Single-Sideband Frequency-Shifting auf einen Sample-Buffer an.
 *
 * Im Gegensatz zur cos-Carrier-Methode (v3.225 sampleFreqShift) wird durch
 * Hilbert-Transform-Approximation eine asymmetrische Verschiebung erreicht:
 * + shiftHz produziert anderen Output als - shiftHz.
 *
 * Algorithmus:
 *   1. Q[n] = convolve(input, hilbertFir)[n]
 *   2. I_delayed[n] = input[n - 15] (zero-padded)
 *   3. omega = 2pi * shiftHz / sampleRate
 *   4. output[n] = I_delayed[n] * cos(omega n) -/+ Q[n] * sin(omega n)
 *      (- fuer upper sideband, + fuer lower sideband)
 *
 * Die ersten ~15 Samples sind eine Warmup-Region (FIR-Faltung baut sich aus
 * Null-Padding auf). Output-Laenge bleibt == Input-Laenge.
 *
 * Defensive: NaN/Infinity shiftHz -> 0; out-of-range -> clamp; unbekanntes
 * sideBand -> "upper". Empty buffer -> empty output. Input wird nie mutiert.
 */
export function applyFreqShiftSSB(
  buffer: AudioBufferLike,
  opts: FreqShiftSSBOptions = {},
): AudioBufferLike {
  const shiftHz = sanitizeShift(opts.shiftHz);
  const sideBand = sanitizeSideBand(opts.sideBand as string | undefined);

  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;

  const omega = (2 * Math.PI * shiftHz) / sampleRate;
  const sign = sideBand === "upper" ? -1 : 1;

  // Pre-compute Carrier (shared across channels analog v3.225)
  const cosArr = new Float32Array(len);
  const sinArr = new Float32Array(len);
  for (let n = 0; n < len; n++) {
    const phi = omega * n;
    cosArr[n] = Math.cos(phi);
    sinArr[n] = Math.sin(phi);
  }

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    // Q via Hilbert-FIR convolution; FIR already has 15-sample group delay
    const q = convolveFir(dry, HILBERT_FIR);
    const out = new Float32Array(len);
    for (let n = 0; n < len; n++) {
      // I_delayed[n] = dry[n - HILBERT_CENTER] zero-padded
      const iIdx = n - HILBERT_CENTER;
      const iVal = iIdx >= 0 ? dry[iIdx] : 0;
      out[n] = iVal * cosArr[n] + sign * q[n] * sinArr[n];
    }
    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

