/**
 * Synthstudio – sampleSpectralCentroid.ts (v3.177.0)
 *
 * Pure-Helper für die Berechnung des Spectral-Centroid eines Audio-Samples.
 * Der Spectral-Centroid ist der "Frequenz-Schwerpunkt" im Magnituden-Spektrum
 * und korreliert stark mit der wahrgenommenen Helligkeit / Brightness:
 *
 *   - tiefe Werte  → dunkel  (Kick, Bass, Sub-Booms)
 *   - hohe  Werte  → hell    (Hi-Hat, Cymbal, Noise, Air)
 *
 * Foundation für künftige Sample-Browser-Features:
 *   - "Brightness"-Spalte / Filter (Auto-Kategorisierung)
 *   - Sortierung nach Frequenz-Charakter
 *   - Kit-Bau-Helfer ("ein heller Hi-Hat-Sound fehlt")
 *
 * ─── Algorithmus ────────────────────────────────────────────────────────────
 *
 *   1. Sample → Mono-Downmix (oder selektiv L/R)
 *   2. Frame-Loop mit 50%-Overlap, fftSize-Frames
 *   3. Window-Function (Hann / Hamming / Rect)
 *   4. Naive DFT → Magnitude-Spectrum (siehe Caveat unten)
 *   5. Pro Frame:  centroid = Σ(f * mag) / Σ(mag)
 *                  spread   = sqrt(Σ((f - centroid)² * mag) / Σ(mag))
 *   6. Average über alle nicht-leeren Frames
 *   7. Kategorische Brightness-Zuordnung
 *
 * ─── Performance-Caveat ─────────────────────────────────────────────────────
 *
 * Diese Implementierung nutzt ABSICHTLICH eine naive O(n²)-DFT statt einer
 * echten O(n log n)-FFT. Hintergrund:
 *   - Tests-friendly (kein zusätzlicher Lib-Import, deterministisch)
 *   - fftSize=1024 ist in Tests vertretbar (~1 M ops pro Frame)
 *   - In production (z.B. Sample-Browser live) sollte ein echter FFT
 *     (fft.js, dsp.js o.ä.) genutzt werden — der Aufrufer kann dafür
 *     einen eigenen Wrapper bauen, die Brightness-Mapping-Schicht bleibt
 *     wiederverwendbar (siehe categorizeBrightness).
 *
 * ─── Pure & Node-testbar (DOM-frei) ─────────────────────────────────────────
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default-FFT-Size. Muss Power-of-2 sein (1024 = guter Test/Live-Kompromiss). */
export const DEFAULT_FFT_SIZE = 1024;

/** Brightness-Schwellen in Hz (Centroid). */
export const BRIGHTNESS_THRESHOLDS = {
  dark:    500,
  warm:    1500,
  neutral: 3500,
  bright:  7000,
} as const;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface CentroidOptions {
  /** FFT-Size. Default 1024. Muss Power-of-2 sein. */
  fftSize?: number;
  /** Window-Function. Default "hann". */
  window?: "hann" | "hamming" | "rect";
  /** Channel-Strategy: "mix" (mono-downmix), "left", "right". Default "mix". */
  channelMode?: "mix" | "left" | "right";
}

export interface CentroidResult {
  /** Spectral centroid in Hz. */
  centroidHz: number;
  /** Spectral spread (variance around centroid) in Hz. */
  spreadHz: number;
  /** Kategorische Brightness-Einordnung. */
  brightness: "dark" | "warm" | "neutral" | "bright" | "harsh";
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Hann-Window-Function. Reine Pure-Utility.
 *   w(n) = 0.5 * (1 - cos(2π * n / (N - 1)))
 */
export function hannWindow(n: number, length: number): number {
  if (length <= 1) return 1;
  return 0.5 * (1 - Math.cos((2 * Math.PI * n) / (length - 1)));
}

/**
 * Hamming-Window — flacher als Hann, bessere Side-Lobe-Suppression.
 *   w(n) = 0.54 - 0.46 * cos(2π * n / (N - 1))
 */
function hammingWindow(n: number, length: number): number {
  if (length <= 1) return 1;
  return 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (length - 1));
}

/**
 * Kategorische Einordnung des Centroid-Werts in Brightness-Stufen.
 *
 * Schwellen (in Hz):
 *  - dark:    < 500
 *  - warm:    500 .. 1500
 *  - neutral: 1500 .. 3500
 *  - bright:  3500 .. 7000
 *  - harsh:   ≥ 7000
 *
 * Defensive: NaN / negativ → "dark".
 */
export function categorizeBrightness(
  centroidHz: number,
): "dark" | "warm" | "neutral" | "bright" | "harsh" {
  if (!Number.isFinite(centroidHz) || centroidHz < 0) return "dark";
  if (centroidHz < BRIGHTNESS_THRESHOLDS.dark) return "dark";
  if (centroidHz < BRIGHTNESS_THRESHOLDS.warm) return "warm";
  if (centroidHz < BRIGHTNESS_THRESHOLDS.neutral) return "neutral";
  if (centroidHz < BRIGHTNESS_THRESHOLDS.bright) return "bright";
  return "harsh";
}

/**
 * Berechnet den Spectral-Centroid für ein gesamtes Sample (averaged
 * über alle nicht-leeren Frames).
 *
 * Defensive Defaults:
 *  - empty / silent buffer → { centroidHz: 0, spreadHz: 0, brightness: "dark" }
 *  - Sample kürzer als fftSize → ein zero-padded Single-Frame
 *  - ungültiger channelMode bei mono → fallback auf Channel 0
 */
export function computeSpectralCentroid(
  buffer: AudioBufferLike,
  options?: CentroidOptions,
): CentroidResult {
  const fftSize = options?.fftSize ?? DEFAULT_FFT_SIZE;
  const windowType = options?.window ?? "hann";
  const channelMode = options?.channelMode ?? "mix";

  // ── Edge: leeres / fehlendes Buffer ────────────────────────────────────────
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return { centroidHz: 0, spreadHz: 0, brightness: "dark" };
  }

  // ── Channel-Auswahl / Downmix ──────────────────────────────────────────────
  const mono = extractMonoChannel(buffer, channelMode);

  // ── Window-Function-Cache (für die fftSize) ────────────────────────────────
  const windowFn = makeWindow(windowType, fftSize);

  // ── Frame-Loop mit 50%-Overlap ─────────────────────────────────────────────
  const hop = Math.max(1, Math.floor(fftSize / 2));
  const sampleRate = buffer.sampleRate;
  const windowed = new Float32Array(fftSize);

  const centroids: number[] = [];
  const spreads: number[] = [];

  // Wenn Sample kürzer als fftSize, machen wir EIN gepaddetes Frame.
  const lastStart = mono.length >= fftSize ? mono.length - fftSize : 0;

  for (let start = 0; start <= lastStart; start += hop) {
    // Frame in den windowed-Buffer kopieren (zero-padded falls nötig).
    const available = Math.min(fftSize, mono.length - start);
    for (let i = 0; i < available; i++) {
      windowed[i] = mono[start + i] * windowFn[i];
    }
    for (let i = available; i < fftSize; i++) {
      windowed[i] = 0;
    }

    const frameStats = analyseFrame(windowed, fftSize, sampleRate);
    if (frameStats !== null) {
      centroids.push(frameStats.centroidHz);
      spreads.push(frameStats.spreadHz);
    }

    // Wenn das Sample kürzer als fftSize ist, läuft die Loop genau 1×.
    if (mono.length < fftSize) break;
  }

  if (centroids.length === 0) {
    return { centroidHz: 0, spreadHz: 0, brightness: "dark" };
  }

  const centroidHz = average(centroids);
  const spreadHz = average(spreads);
  return {
    centroidHz,
    spreadHz,
    brightness: categorizeBrightness(centroidHz),
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Extrahiert einen Mono-Float32-Array aus dem Buffer gemäß channelMode.
 *   - "mix":   Mittelwert aller Channels
 *   - "left":  Channel 0
 *   - "right": Channel 1 (fallback auf 0 wenn mono)
 */
function extractMonoChannel(
  buffer: AudioBufferLike,
  mode: "mix" | "left" | "right",
): Float32Array {
  const n = buffer.length;
  if (n === 0) return new Float32Array(0);

  if (mode === "left") {
    return new Float32Array(buffer.getChannelData(0));
  }
  if (mode === "right") {
    const ch = buffer.numberOfChannels >= 2 ? 1 : 0;
    return new Float32Array(buffer.getChannelData(ch));
  }

  // "mix" — Mittelwert aller Kanäle.
  const channels = buffer.numberOfChannels;
  if (channels === 1) return new Float32Array(buffer.getChannelData(0));

  const out = new Float32Array(n);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const inv = 1 / channels;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

/** Erstellt das Window-Vektor-Cache passend zur Window-Function. */
function makeWindow(
  type: "hann" | "hamming" | "rect",
  length: number,
): Float32Array {
  const w = new Float32Array(length);
  if (type === "rect") {
    for (let i = 0; i < length; i++) w[i] = 1;
    return w;
  }
  if (type === "hamming") {
    for (let i = 0; i < length; i++) w[i] = hammingWindow(i, length);
    return w;
  }
  // Default: hann
  for (let i = 0; i < length; i++) w[i] = hannWindow(i, length);
  return w;
}

/**
 * Analysiert EINEN Frame (bereits gewindowed):
 *   - naive DFT → Magnitude
 *   - centroid + spread
 * Liefert `null`, wenn die Frame-Energie 0 ist (vermeidet Division-by-Zero).
 */
function analyseFrame(
  windowed: Float32Array,
  fftSize: number,
  sampleRate: number,
): { centroidHz: number; spreadHz: number } | null {
  const { re, im } = naiveDft(windowed, fftSize);
  const halfN = fftSize / 2;

  let sumMag = 0;
  let sumFreqMag = 0;
  const mags = new Float32Array(halfN);
  const freqs = new Float32Array(halfN);

  for (let k = 0; k < halfN; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    const freq = (k * sampleRate) / fftSize;
    mags[k] = mag;
    freqs[k] = freq;
    sumMag += mag;
    sumFreqMag += freq * mag;
  }

  if (sumMag <= 0) return null;

  const centroidHz = sumFreqMag / sumMag;

  // Spread (Standardabweichung der Frequenz, gewichtet nach Magnitude).
  let sumVarMag = 0;
  for (let k = 0; k < halfN; k++) {
    const d = freqs[k] - centroidHz;
    sumVarMag += d * d * mags[k];
  }
  const spreadHz = Math.sqrt(sumVarMag / sumMag);

  return { centroidHz, spreadHz };
}

/**
 * Naive Discrete Fourier Transform — O(n²).
 *
 * Liefert nur die untere Hälfte (k=0..fftSize/2-1) — der Rest ist
 * konjugiert-symmetrisch und für den Magnituden-Spectral-Centroid
 * irrelevant.
 */
function naiveDft(
  samples: Float32Array,
  fftSize: number,
): { re: Float32Array; im: Float32Array } {
  const half = fftSize / 2;
  const re = new Float32Array(half);
  const im = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    let r = 0;
    let i = 0;
    const base = (-2 * Math.PI * k) / fftSize;
    for (let n = 0; n < fftSize; n++) {
      const angle = base * n;
      r += samples[n] * Math.cos(angle);
      i += samples[n] * Math.sin(angle);
    }
    re[k] = r;
    im[k] = i;
  }
  return { re, im };
}

/** Arithmetischer Mittelwert. Defensive: leer → 0. */
function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}
