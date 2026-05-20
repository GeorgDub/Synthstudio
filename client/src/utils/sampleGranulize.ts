/**
 * Synthstudio - sampleGranulize.ts (v3.217.0)
 *
 * Pure-Helper fuer Granular-Synthesis auf Sample-Ebene: schneidet kleine
 * Grains aus dem Quell-Sample heraus und arrangiert sie neu zu einem
 * Output-Buffer der EXAKT (grainCount * grainSamples) lang ist.
 *
 * Klassisches GranularSynth-Modell, deterministisch via Mulberry32-PRNG:
 *   pro Grain i in [0..grainCount-1]:
 *     sequentialPos = i * grainSamples (mod (inLen - grainSamples + 1))
 *     randomPos     = floor(rng() * (inLen - grainSamples + 1))
 *     startSample   = round(lerp(sequentialPos, randomPos, spread))
 *     -> grain = source[startSample..startSample + grainSamples]
 *     -> halfHann fade-in/out (Klick-Vermeidung an Grain-Boundaries)
 *     -> output[i*grainSamples..(i+1)*grainSamples] = grain
 *
 * --- Abgrenzung -----------------------------------------------------------
 *
 * Orthogonal zu sampleStutterBuffer (v3.211): Stutter wiederholt EINE Slice
 * mit per-Repeat-Amplituden-Decay; Granulize schneidet VIELE kleine Grains
 * aus VERSCHIEDENEN Quell-Positionen heraus und re-arrangiert sie.
 *
 * Orthogonal zu sampleResampler (Pitch-Shift) und sampleAutoTune
 * (Tonhoehen-Korrektur): Granular ist Zeit-Dehnung/-Verschiebung via
 * Re-Arrangement, nicht via Resampling.
 *
 * --- Pinned Choices (Spec-Disambiguation) ---------------------------------
 *
 * Spec gab Bereiche+Defensive an, die teils konfligierten. Per Advisor-
 * Pre-Check sind folgende Choices verbindlich:
 *
 *   #1 grainSizeMs Range: defensive wins. NaN/<5 -> 50 (Default); >500 -> 500
 *      (Clamp; Spec-Comment 5..200 wird vom Defensive-Block ueberschrieben).
 *   #2 grainCount Range: defensive wins. NaN/<1 -> 32 (Default); >500 -> 500
 *      (Clamp; Spec-Comment 1..200 wird vom Defensive-Block ueberschrieben).
 *   #3 randomSeed: NaN/non-finite/<0 -> 12345 (Default); float -> floor.
 *   #4 spread Range: NaN/<0 -> 0; >1 -> 1; in-between explizit erlaubt.
 *   #5 spread-Interpolation: pos = round(lerp(sequentialPos, randomPos, spread))
 *      Linear-blend zwischen sequentieller und zufaelliger Quell-Position.
 *      Pin: spread=0 -> rein sequentiell, spread=1 -> rein zufaellig,
 *      spread=0.5 -> Mittelpunkt der beiden. Mit FESTEM randomSeed
 *      deterministisch testbar.
 *   #6 Output-Position-Jitter: KEINER. Output-Laenge = grainCount*grainSamples
 *      ist invariant; Grains werden exakt back-to-back gelegt.
 *      (Spec-Erwaehnung small_jitter am Target wuerde Laenge brechen.)
 *   #7 Hann-Fade-Laenge: fadeSamples = min(floor(grainSamples/4), 64).
 *      Pro Grain wird ein Half-Hann fade-in (0..fadeSamples) und
 *      Half-Hann fade-out (grainSamples-fadeSamples..grainSamples) appliziert.
 *      gain = 0.5 * (1 - cos(pi * t)) fuer t in (0,1) exklusive Endpunkte.
 *      Pin: Boundary-Samples sind leiser als Mitte (Anti-Klick-Garantie).
 *   #8 Sequential-Wrap: sequentialPos = (i*grainSamples) % (inLen-grainSamples+1).
 *      Wenn das Sample nicht lang genug ist (inLen < grainSamples), wird der
 *      Source-Range auf 1 gesetzt (nur startSample=0) und fehlende Samples
 *      mit 0.0 silence-gepaddet.
 *   #9 Empty-Buffer Konvention: stutter-buffer-style -
 *      {numberOfChannels:0, length:0, sampleRate: buffer?.sampleRate ?? 48000}.
 *  #10 PRNG: Mulberry32 (analog patternMutateRandom v3.197). Same seed +
 *      same opts + same source = deep-equal output (deterministisch).
 *
 * --- Defensive ------------------------------------------------------------
 *
 * Empty input (length=0 oder numberOfChannels=0) -> empty output (siehe #9).
 * Input wird NIE mutiert (Source-Channel-Reads sind read-only).
 * Output ist ein frisches AudioBufferLike mit eigenen Float32Arrays.
 *
 * --- Multi-Channel --------------------------------------------------------
 *
 * Per-Channel preserved: numberOfChannels gleicht Input. Wichtig: die PRNG-
 * Folge wird EINMAL global gezogen (also gleiche Quell-Positionen fuer alle
 * Channels) - sonst wuerde Stereo-Coherence brechen.
 *
 * Pure und DOM-frei. Foundation fuer Granular-FX-Layer im SampleEditor
 * (Cloud / Rhythmic / Texture / Freeze Presets).
 *
 * Tests: tests/features/sample-granulize.test.ts (mind. 15 Tests pro Spec).
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Konstanten -----------------------------------------------------------

const DEFAULT_GRAIN_SIZE_MS = 50;
const DEFAULT_GRAIN_COUNT = 32;
const DEFAULT_RANDOM_SEED = 12345;
const DEFAULT_SPREAD = 1;

const MIN_GRAIN_SIZE_MS = 5;
const MAX_GRAIN_SIZE_MS = 500;
const MIN_GRAIN_COUNT = 1;
const MAX_GRAIN_COUNT = 500;
const MIN_SPREAD = 0;
const MAX_SPREAD = 1;

const MAX_FADE_SAMPLES = 64;
const FADE_FRACTION_DIVISOR = 4;

const FALLBACK_SAMPLE_RATE = 48000;

// --- Public Types ---------------------------------------------------------

export interface GranulizeOptions {
  /** Grain-Laenge in ms (5..500). Default 50ms.
   *  NaN/<5 -> Default; >500 -> Clamp. */
  grainSizeMs?: number;
  /** Anzahl der Grains im Output (1..500). Default 32.
   *  NaN/<1 -> Default; >500 -> Clamp; non-int -> floor. */
  grainCount?: number;
  /** Seed fuer Mulberry32-PRNG. Default 12345.
   *  NaN/non-finite/<0 -> Default; float -> floor. */
  randomSeed?: number;
  /** 0..1 Blend zwischen sequentiell (0) und zufaellig (1). Default 1.
   *  NaN/<0 -> 0; >1 -> 1. */
  spread?: number;
}

/**
 * Vorgefertigte Granulize-Presets fuer UI-Dropdowns.
 *
 * - cloud:    grainSizeMs=50, count=64, spread=1
 * - rhythmic: grainSizeMs=100, count=16, spread=0.3
 * - texture:  grainSizeMs=20, count=100, spread=0.8
 * - freeze:   grainSizeMs=200, count=8, spread=0.1
 */
export const GRANULIZE_PRESETS = {
  cloud: { grainSizeMs: 50, grainCount: 64, spread: 1 },
  rhythmic: { grainSizeMs: 100, grainCount: 16, spread: 0.3 },
  texture: { grainSizeMs: 20, grainCount: 100, spread: 0.8 },
  freeze: { grainSizeMs: 200, grainCount: 8, spread: 0.1 },
} as const;

// --- Helpers (intern) -----------------------------------------------------

/**
 * Mulberry32 PRNG - identisches Verfahren wie in patternMutateRandom v3.197.
 * Deterministisch fuer einen gegebenen Seed.
 */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sanitizeGrainSizeMs(v: number | undefined): number {
  if (v === undefined) return DEFAULT_GRAIN_SIZE_MS;
  if (Number.isNaN(v)) return DEFAULT_GRAIN_SIZE_MS;
  if (v === Number.POSITIVE_INFINITY) return MAX_GRAIN_SIZE_MS;
  if (!Number.isFinite(v) || v < MIN_GRAIN_SIZE_MS) return DEFAULT_GRAIN_SIZE_MS;
  if (v > MAX_GRAIN_SIZE_MS) return MAX_GRAIN_SIZE_MS;
  return v;
}

function sanitizeGrainCount(v: number | undefined): number {
  if (v === undefined) return DEFAULT_GRAIN_COUNT;
  if (Number.isNaN(v)) return DEFAULT_GRAIN_COUNT;
  if (v === Number.POSITIVE_INFINITY) return MAX_GRAIN_COUNT;
  if (!Number.isFinite(v) || v < MIN_GRAIN_COUNT) return DEFAULT_GRAIN_COUNT;
  if (v > MAX_GRAIN_COUNT) return MAX_GRAIN_COUNT;
  return Math.floor(v);
}

function sanitizeRandomSeed(v: number | undefined): number {
  if (v === undefined) return DEFAULT_RANDOM_SEED;
  if (Number.isNaN(v)) return DEFAULT_RANDOM_SEED;
  if (!Number.isFinite(v) || v < 0) return DEFAULT_RANDOM_SEED;
  return Math.floor(v);
}

function sanitizeSpread(v: number | undefined): number {
  if (v === undefined) return DEFAULT_SPREAD;
  if (Number.isNaN(v)) return MIN_SPREAD;
  if (v === Number.POSITIVE_INFINITY) return MAX_SPREAD;
  if (!Number.isFinite(v) || v < MIN_SPREAD) return MIN_SPREAD;
  if (v > MAX_SPREAD) return MAX_SPREAD;
  return v;
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

function emptyResult(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

/**
 * Half-Hann fade-in/-out fuer einen Grain in-place.
 * t in (0,1) exklusive Endpunkte -> Boundary-Sample bleibt leiser als Mitte.
 * gain = 0.5 * (1 - cos(pi * t)) waechst monoton von 0 -> 1.
 * Pin #7: fadeSamples = min(floor(grainSamples/4), 64).
 */
function applyHannFades(grain: Float32Array, fadeSamples: number): void {
  if (fadeSamples <= 0) return;
  const n = grain.length;
  for (let i = 0; i < fadeSamples && i < n; i++) {
    const t = (i + 1) / (fadeSamples + 1);
    const g = 0.5 * (1 - Math.cos(Math.PI * t));
    grain[i] = grain[i] * g;
  }
  for (let i = 0; i < fadeSamples && i < n; i++) {
    const t = (i + 1) / (fadeSamples + 1);
    const g = 0.5 * (1 - Math.cos(Math.PI * t));
    grain[n - 1 - i] = grain[n - 1 - i] * g;
  }
}

// --- Public API -----------------------------------------------------------

/**
 * Wendet einen Granular-Synthesis-Effekt auf einen Sample-Buffer an: schneidet
 * grainCount kurze Grains (Laenge grainSizeMs) aus verschiedenen Quell-
 * Positionen heraus, applikiert pro Grain einen Half-Hann fade-in/out und
 * arrangiert sie back-to-back in einen neuen Buffer der Laenge
 * (grainCount * grainSamples).
 *
 * Spread-Modell (Pin #5):
 *   sequentialPos = (i * grainSamples) % (inLen - grainSamples + 1)
 *   randomPos     = floor(rng() * (inLen - grainSamples + 1))
 *   startSample   = round(lerp(sequentialPos, randomPos, spread))
 *
 * Multi-Channel preserved. Mulberry32 PRNG (deterministisch via randomSeed).
 * Hann-Fade pro Grain: fadeSamples = min(floor(grainSamples/4), 64) (Pin #7).
 *
 * WICHTIG: Output-Laenge == grainCount * grainSamples, NICHT input.length.
 * Caller muss mit veraenderter Buffer-Laenge umgehen koennen.
 *
 * Defensive: Empty buffer -> empty output. Source kuerzer als ein Grain ->
 * silence-padded Grains (startSample=0, fehlende Samples = 0.0).
 *
 * Pure und DOM-frei. Input wird NIE mutiert.
 */
export function applyGranulize(
  buffer: AudioBufferLike,
  opts: GranulizeOptions = {},
): AudioBufferLike {
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return emptyResult(buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE);
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const inLen = buffer.length;

  const grainSizeMs = sanitizeGrainSizeMs(opts.grainSizeMs);
  const grainCount = sanitizeGrainCount(opts.grainCount);
  const randomSeed = sanitizeRandomSeed(opts.randomSeed);
  const spread = sanitizeSpread(opts.spread);

  const grainSamples = Math.max(
    1,
    Math.round((grainSizeMs * sampleRate) / 1000),
  );
  const outLen = grainCount * grainSamples;

  const sourceSpan = Math.max(1, inLen - grainSamples + 1);

  const rng = makeRng(randomSeed);
  const randomPositions = new Float64Array(grainCount);
  for (let i = 0; i < grainCount; i++) {
    randomPositions[i] = Math.floor(rng() * sourceSpan);
  }

  const fadeSamples = Math.min(
    Math.floor(grainSamples / FADE_FRACTION_DIVISOR),
    MAX_FADE_SAMPLES,
  );

  const outChannels: Float32Array[] = [];

  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(outLen);

    for (let i = 0; i < grainCount; i++) {
      const sequentialPos = (i * grainSamples) % sourceSpan;
      const randomPos = randomPositions[i];
      const startSample = Math.max(
        0,
        Math.min(
          sourceSpan - 1,
          Math.round(sequentialPos + (randomPos - sequentialPos) * spread),
        ),
      );

      const grain = new Float32Array(grainSamples);
      for (let g = 0; g < grainSamples; g++) {
        const srcIdx = startSample + g;
        grain[g] = srcIdx < inLen ? dry[srcIdx] : 0.0;
      }

      applyHannFades(grain, fadeSamples);

      const base = i * grainSamples;
      for (let g = 0; g < grainSamples; g++) {
        out[base + g] = grain[g];
      }
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}
