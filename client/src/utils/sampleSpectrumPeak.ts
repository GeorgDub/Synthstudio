/**
 * sampleSpectrumPeak.ts (v3.217)
 *
 * Pure-Helper für die Detektion dominanter Frequenz-Komponenten in einem
 * Sample-Buffer mittels des Goertzel-Algorithmus -- KEIN FFT, sondern eine
 * minimale in-Code DFT für EINE bestimmte Frequenz.
 *
 * Vorteil ggü. einer vollen FFT:
 *  - O(N) statt O(N log N) pro Frequenz; bei wenigen interessanten Frequenzen
 *    (z.B. die 7 Default-Bands) schneller und sehr stromsparend.
 *  - Keine externe FFT-Bibliothek nötig, deterministisch testbar in Node.
 *  - Pro Frequenz numerisch stabil; Speicherbedarf O(1) pro Frequenz.
 *
 * Anwendungsfälle:
 *  - Sample-Tagging: erkennt grob ob ein Sample dominante tiefe Bässe (60Hz),
 *    Sub-Bässe, Mid-Range-Body oder Air/Sparkle (>3kHz) hat.
 *  - Kit-Bau-Hilfe: "fehlt ein heller Hi-Hat im aktuellen Kit?".
 *  - Pre-Sort für Sample-Browser nach dominanter Frequenz.
 *
 * Abgrenzung:
 *  - sampleSpectralCentroid.ts (v3.177) liefert EINEN Schwerpunkts-Wert
 *    (centroidHz) über alle FFT-Bins -- also "wie hell" das Sample ist.
 *  - sampleSpectrumPeak.ts liefert AMPLITUDEN für DEFINIERTE Frequenzen
 *    (z.B. die 7 Default-Bands) -- also "wieviel Energie ist in 60Hz,
 *    100Hz, 200Hz ...?".  Orthogonal zueinander.
 *
 * --- Pins (Spec-Klärungen vor Implementation) -------------------------------
 *
 *   Pin #1 -- KEIN Window-Function.  Bare Goertzel pro Spec; sampleSpectral-
 *             Centroid nutzt Hann/Hamming, dieser Helper nicht.
 *   Pin #2 -- Window startet bei Sample 0.  Kein Offset-Parameter.
 *   Pin #3 -- Effektives N = Math.min(buffer.length, windowSize).  Power-
 *             Normalisierung dividiert durch die ECHT verarbeitete Sample-Zahl
 *             (sonst werden Kurz-Buffer artifiziell leise).
 *   Pin #4 -- Frequenz > Nyquist -> wird ÜBERSPRUNGEN (nicht mit Amplitude 0
 *             zurückgegeben).  Die Result-Liste kann also kürzer als die
 *             Input-Liste sein.
 *   Pin #5 -- findPeakFrequencies bewahrt die Reihenfolge von freqsToTest.
 *             Nur topNPeaks sortiert nach Amplitude absteigend.
 *   Pin #6 -- Leeres freqsToTest=[] -> DEFAULTS (analog undefined).  NaN /
 *             negativ / non-numeric Einträge werden still gefiltert.
 *   Pin #7 -- Multi-Channel -> Mittelwert ALLER Kanäle (uniform, kein Stereo-
 *             Special-Case), analog sampleSpectralCentroid.extractMonoChannel
 *             mit channelMode="mix".
 *   Pin #8 -- Amplitude-Formel pro Spec: sqrt(power) / N.  Für eine unit-
 *             amplitude Sinus auf einem exakten Bin liefert Standard-Goertzel
 *             power ~= (N/2)^2, also amplitude ~= 0.5.  Tests asserten
 *             relative Dominanz, NICHT amplitude ~= 1.
 *
 * Pure & DOM-frei.  Einzige Abhängigkeit: AudioBufferLike aus sampleEmbedding.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Public Types -----------------------------------------------------------

export interface PeakFrequency {
  /** Frequenz in Hz (aus dem Input-freqsToTest übernommen). */
  frequencyHz: number;
  /** Normalisierte Amplitude (sqrt(power) / N), grob im Bereich 0..1. */
  amplitude: number;
}

export interface SpectrumOptions {
  /** Frequenzen in Hz, die getestet werden sollen.  Default: 7 Standard-Bands. */
  freqsToTest?: number[];
  /** Window-Größe (Anzahl Samples).  64..4096, Default 1024. */
  windowSize?: number;
}

// --- Konstanten -------------------------------------------------------------

/**
 * Default-Frequenzen -- 7 musikalisch interessante Bänder, die typische
 * Bass/Mid/High-Charakteristika gut erfassen.  60Hz = sub-bass / kick rumble,
 * 100Hz = bass body, 200Hz = low-mid, 440Hz = mid (Konzert-A), 880Hz = upper-
 * mid, 1760Hz = presence, 3520Hz = air / sparkle.
 */
export const DEFAULT_FREQS_TO_TEST: readonly number[] = Object.freeze([
  60, 100, 200, 440, 880, 1760, 3520,
]);

/** Default-Window-Size -- 1024 Samples (analog sampleSpectralCentroid). */
export const DEFAULT_WINDOW_SIZE = 1024;

/** Minimale erlaubte Window-Size. */
export const MIN_WINDOW_SIZE = 64;

/** Maximale erlaubte Window-Size. */
export const MAX_WINDOW_SIZE = 4096;

// --- Sanitizers -------------------------------------------------------------

/**
 * Bereinigt windowSize.  NaN/<MIN -> DEFAULT, >MAX -> clamped, sonst Integer.
 */
function sanitizeWindowSize(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_WINDOW_SIZE;
  if (v < MIN_WINDOW_SIZE) return DEFAULT_WINDOW_SIZE;
  if (v > MAX_WINDOW_SIZE) return MAX_WINDOW_SIZE;
  return Math.floor(v);
}

/**
 * Bereinigt die freqsToTest-Liste.  Leer oder undefined -> DEFAULT_FREQS.
 * NaN/negativ/Infinity/non-number-Einträge werden silent gefiltert.
 */
function sanitizeFreqsToTest(v: unknown): number[] {
  if (!Array.isArray(v) || v.length === 0) {
    return DEFAULT_FREQS_TO_TEST.slice();
  }
  const out: number[] = [];
  for (const f of v) {
    if (typeof f === "number" && Number.isFinite(f) && f > 0) {
      out.push(f);
    }
  }
  if (out.length === 0) return DEFAULT_FREQS_TO_TEST.slice();
  return out;
}

// --- Mono-Downmix -----------------------------------------------------------

/**
 * Extrahiert einen Mono-Float32Array aus einem Multi-Channel-Buffer (Mittel-
 * wert aller Kanäle, Pin #7 -- uniform, kein Stereo-Special-Case).
 *
 * Mono-Buffer wird direkt zurückgegeben (keine Kopie nötig -- caller liest
 * nur).
 */
function extractMono(buffer: AudioBufferLike): Float32Array {
  const channels = buffer.numberOfChannels;
  const n = buffer.length;
  if (channels === 1) return buffer.getChannelData(0);

  const out = new Float32Array(n);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const inv = 1 / channels;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

// --- Goertzel ---------------------------------------------------------------

/**
 * Goertzel-Algorithmus für EINE Ziel-Frequenz.  Liefert die normalisierte
 * Amplitude (sqrt(power) / N).
 *
 * Standardformulierung (siehe z.B. Wikipedia "Goertzel algorithm"):
 *   k     = round(N * f / sampleRate)
 *   omega = 2pi * k / N
 *   coeff = 2 cos omega
 *   for each x_n:  s_n = x_n + coeff * s_{n-1} - s_{n-2}
 *   power = s_prev^2 + s_prev2^2 - s_prev * s_prev2 * coeff
 *
 * N entspricht der ECHT verarbeiteten Sample-Zahl (Pin #3).
 */
function goertzelAmplitude(
  samples: Float32Array,
  N: number,
  freqHz: number,
  sampleRate: number,
): number {
  if (N <= 0) return 0;
  // k = round(N * f / sr) -- gewählter "Bin", auf den Goertzel abgestimmt wird.
  const k = Math.round((N * freqHz) / sampleRate);
  const omega = (2 * Math.PI * k) / N;
  const cosOmega = Math.cos(omega);
  const coeff = 2 * cosOmega;

  let sPrev = 0;
  let sPrev2 = 0;
  for (let i = 0; i < N; i++) {
    const s = samples[i] + coeff * sPrev - sPrev2;
    sPrev2 = sPrev;
    sPrev = s;
  }

  const power = sPrev * sPrev + sPrev2 * sPrev2 - sPrev * sPrev2 * coeff;
  if (!Number.isFinite(power) || power <= 0) return 0;
  return Math.sqrt(power) / N;
}

// --- Public API -------------------------------------------------------------

/**
 * Findet die Amplituden der gefragten Frequenzen in einem Sample-Buffer.
 *
 * Pin #5: Reihenfolge des Output-Array == Reihenfolge der gefilterten
 *          freqsToTest (Frequenzen >= Nyquist werden entfernt, Pin #4).
 *
 * Edge-Cases:
 *  - leerer / null-cast Buffer -> [].
 *  - keine sampleRate / sampleRate <= 0 -> [].
 *  - alle freqsToTest >= Nyquist -> [].
 */
export function findPeakFrequencies(
  buffer: AudioBufferLike,
  opts?: SpectrumOptions,
): PeakFrequency[] {
  // Defensive Buffer-Validierung
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return [];
  }
  const sampleRate = buffer.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return [];
  }

  const windowSize = sanitizeWindowSize(opts?.windowSize);
  const freqs = sanitizeFreqsToTest(opts?.freqsToTest);

  // Pin #3 -- effektives N
  const N = Math.min(buffer.length, windowSize);
  if (N <= 0) return [];

  const mono = extractMono(buffer);
  const nyquist = sampleRate / 2;

  const results: PeakFrequency[] = [];
  for (const f of freqs) {
    // Pin #4 -- Skip (nicht 0-Amplitude) wenn >= Nyquist
    if (f >= nyquist) continue;
    const amplitude = goertzelAmplitude(mono, N, f, sampleRate);
    results.push({ frequencyHz: f, amplitude });
  }
  return results;
}

/**
 * Liefert die Top-N peak-Frequenzen, sortiert nach amplitude absteigend.
 *
 * Tie-Break: stabil (gleiche Amplituden behalten die Reihenfolge aus
 * findPeakFrequencies, also die Order von freqsToTest).
 *
 * n <= 0 -> []. n > matches.length -> komplette sortierte Liste.
 * Defensive: NaN-n -> 0 -> [].
 */
export function topNPeaks(
  buffer: AudioBufferLike,
  n: number,
  opts?: SpectrumOptions,
): PeakFrequency[] {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return [];
  const all = findPeakFrequencies(buffer, opts);
  if (all.length === 0) return [];

  // Stabiler Sort: amplitude desc, dann Original-Index asc (= Default-Stabilität
  // von Array.prototype.sort in V8 / modernen Engines).
  const indexed = all.map((p, idx) => ({ p, idx }));
  indexed.sort((a, b) => {
    if (b.p.amplitude !== a.p.amplitude) return b.p.amplitude - a.p.amplitude;
    return a.idx - b.idx;
  });

  const limit = Math.min(Math.floor(n), indexed.length);
  return indexed.slice(0, limit).map((x) => x.p);
}
