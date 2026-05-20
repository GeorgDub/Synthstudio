/**
 * Synthstudio – sampleTimeStretch.ts (v3.219.0)
 *
 * Pure-Helper für Time-Stretching ohne Pitch-Änderung via OLA (Overlap-Add).
 *
 * Konzept:
 *   stretchFactor=1   → identity-ähnliche Ausgabe (gleiche Länge)
 *   stretchFactor=2   → output ≈ 2× so lang (langsamer, Pitch erhalten)
 *   stretchFactor=0.5 → output ≈ 0.5× so lang (schneller, Pitch erhalten)
 *
 * Algorithmus (Overlap-Add, OLA):
 *   1. grainSamples   = floor(grainSizeMs * sampleRate / 1000)
 *   2. hopAnalysis    = floor(grainSamples * (1 - overlap))   (>= 1)
 *   3. hopSynthesis   = round(hopAnalysis * stretchFactor)    (>= 1)
 *   4. Pro Grain bei sourcePos (= grainIdx * hopAnalysis):
 *        - Fenster: Hann (N = grainSamples)
 *        - outputPos = grainIdx * hopSynthesis
 *        - out[outputPos + n] += windowed(src[sourcePos + n])
 *   5. outputLength = ceil(inputLength * stretchFactor) (mind. lastGrainEnd)
 *
 * Abgrenzung:
 *  - samplePitchShift.ts (v3.194): Resample-Pitch-Shift OHNE Length-Erhalt.
 *  - sampleResampler.ts  (v3.203): SR-Konversion; preservePitch ist Stub.
 *  - DIESER Helper:               Length-Änderung OHNE Pitch-Änderung.
 *
 * Bekannte Trade-offs:
 *  - OLA OHNE Phase-Vocoder produziert hörbare Phasing-Artifacts bei
 *    stretchFactor weit von 1 (z.B. 4× oder 0.25×). Bewusste Vereinfachung;
 *    ein echter Phase-Vocoder bleibt eine spätere Variante.
 *  - Amplitude bei overlap=0.5 + Hann erfüllt die COLA-Bedingung (Constant
 *    Overlap-Add). Bei anderen Overlaps variiert die Amplitude.
 *
 * Tests: tests/features/sample-time-stretch.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// Konstanten ------------------------------------------------------------------

export const DEFAULT_STRETCH_FACTOR = 1;
export const MAX_STRETCH_FACTOR = 10;

export const DEFAULT_GRAIN_SIZE_MS = 50;
export const MIN_GRAIN_SIZE_MS = 10;
export const MAX_GRAIN_SIZE_MS = 500;

export const DEFAULT_OVERLAP = 0.5;
export const MIN_OVERLAP = 0;
export const MAX_OVERLAP = 0.95;

const FALLBACK_SAMPLE_RATE = 48000;

// Public Types ---------------------------------------------------------------

export interface TimeStretchOptions {
  /**
   * Faktor um den die Output-Länge gegenüber dem Input wächst.
   *  1   = identity-ähnlich (gleiche Länge)
   *  2   = output ≈ 2× so lang
   *  0.5 = output ≈ 0.5× so lang
   * Default 1; NaN/<=0 → 1; >10 → 10.
   */
  stretchFactor?: number;
  /**
   * Grain-Länge in Millisekunden. Default 50. Außer [10, 500] → Clamp,
   * NaN → Default.
   */
  grainSizeMs?: number;
  /**
   * Overlap-Fraktion zwischen aufeinanderfolgenden Grains. Default 0.5
   * (siehe Default-Konstante; Sanitizer-Fallback bei NaN ist 0). Clamp [0, 0.95].
   */
  overlap?: number;
}

// Sanitizers -----------------------------------------------------------------

function sanitizeStretchFactor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_STRETCH_FACTOR;
  }
  if (value > MAX_STRETCH_FACTOR) return MAX_STRETCH_FACTOR;
  return value;
}

function sanitizeGrainSizeMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GRAIN_SIZE_MS;
  }
  if (value < MIN_GRAIN_SIZE_MS) return DEFAULT_GRAIN_SIZE_MS;
  if (value > MAX_GRAIN_SIZE_MS) return MAX_GRAIN_SIZE_MS;
  return value;
}

function sanitizeOverlap(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MIN_OVERLAP;
  }
  if (value < MIN_OVERLAP) return MIN_OVERLAP;
  if (value > MAX_OVERLAP) return MAX_OVERLAP;
  return value;
}

// Internal Helpers -----------------------------------------------------------

/**
 * Standard Hann-Fenster. w[n] = 0.5 * (1 - cos(2*pi*n/(N-1))).
 * Bei N<2 liefert konstant 1.
 */
function makeHannWindow(N: number): Float32Array {
  const w = new Float32Array(N);
  if (N < 2) {
    for (let i = 0; i < N; i++) w[i] = 1;
    return w;
  }
  const denom = N - 1;
  for (let i = 0; i < N; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
  }
  return w;
}

function makeEmpty(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function wrapBuffer(
  channels: Float32Array[],
  sampleRate: number,
  length: number,
): AudioBufferLike {
  const chCount = channels.length;
  return {
    sampleRate,
    numberOfChannels: chCount,
    length,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError("channel " + c + " out of range");
      return channels[c];
    },
  };
}

function finiteGuard(arr: Float32Array): void {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) arr[i] = 0;
  }
}

// Public API ------------------------------------------------------------------

/**
 * Time-Stretching ohne Pitch-Änderung via OLA (Overlap-Add).
 *
 * Liefert eine NEUE AudioBufferLike-Instanz; Input wird nicht mutiert.
 * Sample-Rate + Channel-Count bleiben erhalten.
 *
 * Edge-Cases:
 *  - Empty / null Buffer        → empty result (numberOfChannels=0)
 *  - stretchFactor=1            → output-Länge = inputLength (near-identity)
 *  - inputLength=0              → empty result
 *  - grainSamples > inputLength → grainSamples wird auf inputLength geclampt
 *  - Defensive: alle Optionen werden via sanitize* validiert
 */
export function applyTimeStretch(
  buffer: AudioBufferLike,
  opts?: TimeStretchOptions,
): AudioBufferLike {
  const sr = buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE;
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return makeEmpty(sr);
  }

  const stretchFactor = sanitizeStretchFactor(opts?.stretchFactor);
  const grainSizeMs = sanitizeGrainSizeMs(opts?.grainSizeMs);
  const overlap = sanitizeOverlap(opts?.overlap);

  const inLen = buffer.length;
  const chCount = buffer.numberOfChannels;

  let grainSamples = Math.max(1, Math.floor((grainSizeMs * sr) / 1000));
  if (grainSamples > inLen) grainSamples = inLen;

  const hopAnalysis = Math.max(1, Math.floor(grainSamples * (1 - overlap)));
  const hopSynthesis = Math.max(1, Math.round(hopAnalysis * stretchFactor));

  const outLenNominal = Math.max(1, Math.ceil(inLen * stretchFactor));
  // Anzahl Grains: damit der letzte Grain das Input-Ende inkl. tail-Hann mit-
  // bekommt rechnen wir ceil((inLen - grainSamples)/hopAnalysis) + 1; mind. 1.
  const span = Math.max(0, inLen - grainSamples);
  const numGrains = Math.max(1, Math.ceil(span / hopAnalysis) + 1);
  const lastGrainEnd = (numGrains - 1) * hopSynthesis + grainSamples;
  const outLen = Math.max(outLenNominal, lastGrainEnd);

  const window = makeHannWindow(grainSamples);

  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const out = new Float32Array(outLen);

    for (let g = 0; g < numGrains; g++) {
      const sourcePos = g * hopAnalysis;
      const outputPos = g * hopSynthesis;
      if (sourcePos >= inLen) break;
      for (let n = 0; n < grainSamples; n++) {
        const srcIdx = sourcePos + n;
        const outIdx = outputPos + n;
        if (srcIdx >= inLen) break;
        if (outIdx >= outLen) break;
        out[outIdx] += src[srcIdx] * window[n];
      }
    }

    finiteGuard(out);
    channels.push(out);
  }

  return wrapBuffer(channels, sr, outLen);
}
