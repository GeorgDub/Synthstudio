/**
 * Synthstudio - sampleClickRemover.ts (v3.214.0)
 *
 * Pure-Helper zur Detektion und Glaettung von Clicks/Pops in Sample-Buffers.
 *
 * --- Modell ------------------------------------------------------------------
 *
 * Ein "Click" oder "Pop" ist eine ploetzliche Diskontinuitaet im Waveform.
 * Der Detector durchlaeuft das Signal und berechnet die absolute Differenz
 * zwischen aufeinanderfolgenden Samples:
 *
 *   delta_i = |samples[i] - samples[i-1]|
 *
 * Wenn delta_i > threshold -> Position i ist ein Click.
 *
 * Die Click-Glaettung interpoliert linear zwischen den unveraenderten
 * Anker-Werten
 *
 *   A = samples[i - 1]
 *   B = samples[i + fadeSamples]
 *
 * und ueberschreibt die Positionen i, i+1, ..., i+fadeSamples-1 mit
 *
 *   out[i + k] = A + (B - A) * (k + 1) / (fadeSamples + 1)
 *
 * fuer k in [0, fadeSamples-1]. Das +1 im Nenner sorgt fuer Stetigkeit.
 *
 * --- Edge Cases --------------------------------------------------------------
 *
 * - Click an Position i=0 wird NIE detektiert (Detection startet bei i=1).
 * - Click an Position i wenn i + fadeSamples >= length: SKIPPED — kein
 *   valider End-Anker. clicksDetected zaehlt ihn NICHT.
 * - Ueberlappende Clicks: detect-all-first auf dem unveraenderten Input,
 *   dann Ramps in einem zweiten Pass anwenden.
 *
 * --- Multi-Channel -----------------------------------------------------------
 *
 * Detection laeuft UNABHAENGIG pro Channel. clicksDetected ist die Summe
 * ueber alle Channels.
 *
 * --- Defensive Defaults ------------------------------------------------------
 *
 * - threshold    NaN/non-finite/<=0  -> 0.3 (Default)
 *                >1                  -> 1 (Clamp)
 * - fadeSamples  NaN/non-finite/<1   -> 32 (Default)
 *                >1000               -> 1000 (Clamp)
 *                non-integer         -> Math.floor
 *
 * Empty buffer -> empty Result, clicksDetected=0. Input wird nie mutiert.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Konstanten -------------------------------------------------------------

const DEFAULT_THRESHOLD = 0.3;
const MAX_THRESHOLD = 1;

const DEFAULT_FADE_SAMPLES = 32;
const MIN_FADE_SAMPLES = 1;
const MAX_FADE_SAMPLES = 1000;

const FALLBACK_SAMPLE_RATE = 48000;

// --- Public Types -----------------------------------------------------------

export interface ClickRemoveOptions {
  /** Jump-Amplitude die als Click zaehlt (0..1). Default 0.3. */
  threshold?: number;
  /** Anzahl Samples ueber die geramped wird (1..1000). Default 32. */
  fadeSamples?: number;
}

export interface ClickRemoveResult {
  buffer: AudioBufferLike;
  /** Summe ueber alle Channels der detektierten und geglaetteten Clicks. */
  clicksDetected: number;
}

// --- Helpers (intern) -------------------------------------------------------

function sanitizeThreshold(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_THRESHOLD;
  if (v > MAX_THRESHOLD) return MAX_THRESHOLD;
  return v;
}

function sanitizeFadeSamples(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < MIN_FADE_SAMPLES) return DEFAULT_FADE_SAMPLES;
  const f = Math.floor(v);
  if (f < MIN_FADE_SAMPLES) return DEFAULT_FADE_SAMPLES;
  if (f > MAX_FADE_SAMPLES) return MAX_FADE_SAMPLES;
  return f;
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

// --- Public API: Detection (standalone) -------------------------------------

/**
 * Detektiert Click-Positionen in einem Float32Array.
 *
 * Detection beginnt bei Index 1 (kein samples[-1] verfuegbar).
 *
 * Defensive: threshold NaN/<=0 -> 0.3, >1 -> 1.
 * Defensive: empty array / null -> [].
 *
 * Liefert die Positionen sortiert in ascending order.
 */
export function detectClickPositions(
  samples: Float32Array,
  threshold?: number,
): number[] {
  if (!samples || samples.length < 2) return [];
  const th = sanitizeThreshold(threshold);
  const positions: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const delta = Math.abs(samples[i] - samples[i - 1]);
    if (delta > th) {
      positions.push(i);
    }
  }
  return positions;
}

// --- Public API: removeClicks -----------------------------------------------

/**
 * Detektiert und glaettet Clicks/Pops in einem Sample-Buffer durch lineare
 * Interpolation zwischen unveraenderten Anker-Samples.
 *
 * Algorithmus pro Channel:
 *   1) Detect: positions = { i : |samples[i] - samples[i-1]| > threshold,
 *                            i + fadeSamples < length }
 *   2) Smooth: fuer jedes i in positions:
 *        A = out[i - 1]   (unchanged)
 *        B = out[i + fadeSamples]   (unchanged)
 *        out[i + k] = A + (B - A) * (k + 1) / (fadeSamples + 1)
 *           fuer k in [0, fadeSamples - 1]
 *
 * Multi-Channel: Detection unabhaengig pro Channel. clicksDetected ist die
 * Summe ueber alle Channels.
 *
 * Defensive: Empty buffer -> empty output, clicksDetected=0. Input wird nie
 * mutiert.
 */
export function removeClicks(
  buffer: AudioBufferLike,
  opts: ClickRemoveOptions = {},
): ClickRemoveResult {
  const threshold = sanitizeThreshold(opts.threshold);
  const fadeSamples = sanitizeFadeSamples(opts.fadeSamples);

  // Empty input -> empty output
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      buffer: {
        sampleRate: buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE,
        numberOfChannels: 0,
        length: 0,
        getChannelData: () => new Float32Array(0),
      },
      clicksDetected: 0,
    };
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;

  let totalClicks = 0;
  const outChannels: Float32Array[] = [];

  for (let c = 0; c < numCh; c++) {
    const inCh = buffer.getChannelData(c);
    // Fresh copy — never mutate input
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = inCh[i];

    // Detect on UNMODIFIED input
    const allPositions = detectClickPositions(inCh, threshold);

    // Filter positions where ramp would extend beyond buffer end
    const validPositions: number[] = [];
    for (const pos of allPositions) {
      if (pos + fadeSamples < len) validPositions.push(pos);
    }

    // Apply ramps (anchors A = out[i-1], B = out[i+fadeSamples] untouched
    // unless a previous ramp wrote into that location).
    for (const i of validPositions) {
      const A = out[i - 1];
      const B = out[i + fadeSamples];
      const denom = fadeSamples + 1;
      for (let k = 0; k < fadeSamples; k++) {
        out[i + k] = A + (B - A) * ((k + 1) / denom);
      }
    }

    totalClicks += validPositions.length;
    outChannels.push(out);
  }

  return {
    buffer: wrapBuffer(outChannels, sampleRate),
    clicksDetected: totalClicks,
  };
}
