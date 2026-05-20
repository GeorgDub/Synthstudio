/**
 * Synthstudio – sampleChorus.ts (v3.205.0)
 *
 * Pure-Helper fuer einen single-voice Chorus-Effekt via modulierten
 * Delay-Line (kein Feedback, kein FFT, keine externe DSP-Lib).
 *
 * ─── Modell ─────────────────────────────────────────────────────────────────
 *
 * Pro Channel laeuft eine eigene Delay-Line, deren Lese-Position via LFO
 * (Sinus) um eine Center-Delay moduliert wird:
 *
 *   t           = i / sampleRate                        // Zeit in s
 *   lfo         = (sin(2*pi*rate*t) + 1) / 2 * depthMs  // in [0, depthMs]
 *   modDelayMs  = delayMs + (lfo - depthMs/2)           // [delayMs-h, delayMs+h]
 *   delaySamples_t = max(1, modDelayMs * sampleRate/1000)
 *   lookup ueber linear-interpolierte delay-buffer-Position (i - delaySamples_t)
 *   output[i]   = mix * delayed + (1 - mix) * dry[i]
 *
 * LFO ist um delayMs zentriert (NICHT um delayMs/2 — die Spec-Parenthese
 * "centered around delayMs/2" beschreibt die LFO-Range, nicht das Delay).
 *
 * ─── LFO-Phase pro Channel ──────────────────────────────────────────────────
 *
 * Idiomatisches single-voice Chorus: SHARED LFO-Phase ueber alle Channels.
 * Stereo-Sample erhaelt also dieselbe Modulation links/rechts.  Wer mehr
 * Stereo-Breite will, soll danach via sampleStereoEnhancer aufweiten.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - rateHz   NaN/<0.05 -> 1   (clamp <0.05),  >20 -> 20
 * - depthMs  NaN/<0.1  -> 5,   >50 -> 50
 * - delayMs  NaN/<1    -> 15,  >100 -> 100
 * - mix      NaN/<0    -> 0,   >1  -> 1
 *
 * Empty buffer -> empty output (numberOfChannels=0).  Input wird nie mutiert.
 * Output-Laenge == Input-Laenge (kein Tail wie bei sampleDelay).  Erste
 * Samples (vor i = delaySamples) lesen aus dem zero-prefilled Delay-Buffer
 * — dort ist mix=1 nicht identitaet zu dry[0], sondern 0.  Per Design.
 *
 * ─── Finiteness ─────────────────────────────────────────────────────────────
 *
 * Algorithmus erzeugt KEINE NaN/Inf, wenn Inputs finite sind.  Sanitizer
 * fangen NaN/Inf-Optionen.  Sample-Werte werden nicht geclipped (Caller
 * darf via sampleAutoNormalize aufraeumen).
 *
 * Pure & DOM-frei.  Pattern angelehnt an sampleDelay.ts (v3.191), aber
 * ohne Feedback und ohne Tail.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_RATE_HZ = 1;
const DEFAULT_DEPTH_MS = 5;
const DEFAULT_DELAY_MS = 15;
const DEFAULT_MIX = 0.5;

const MIN_RATE_HZ = 0.05;
const MAX_RATE_HZ = 20;
const MIN_DEPTH_MS = 0.1;
const MAX_DEPTH_MS = 50;
const MIN_DELAY_MS = 1;
const MAX_DELAY_MS = 100;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ChorusOptions {
  /** LFO-Rate in Hz (0.1..10 typ, 0.05..20 erlaubt). Default 1. */
  rateHz?: number;
  /** Modulations-Tiefe in ms (1..20 typ, 0.1..50 erlaubt). Default 5. */
  depthMs?: number;
  /** Center-Delay in ms (5..30 typ, 1..100 erlaubt). Default 15. */
  delayMs?: number;
  /** Wet/Dry-Mix (0..1). Default 0.5. */
  mix?: number;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

function sanitizeRate(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < MIN_RATE_HZ) return DEFAULT_RATE_HZ;
  if (v > MAX_RATE_HZ) return MAX_RATE_HZ;
  return v;
}

function sanitizeDepth(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < MIN_DEPTH_MS) return DEFAULT_DEPTH_MS;
  if (v > MAX_DEPTH_MS) return MAX_DEPTH_MS;
  return v;
}

function sanitizeDelayMs(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < MIN_DELAY_MS) return DEFAULT_DELAY_MS;
  if (v > MAX_DELAY_MS) return MAX_DELAY_MS;
  return v;
}

function sanitizeMix(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_MIX;
  if (v < 0) return 0;
  if (v > 1) return 1;
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
        throw new RangeError(`getChannelData: index ${channel} out of range`);
      }
      return channels[channel];
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet einen Chorus-Effekt auf einen Sample-Buffer an.
 *
 * Algorithmus single-voice: pro Channel eigener Delay-Buffer, LFO-Phase
 * ist SHARED ueber Channels (gleiche Modulation L/R).  Linear-interpolation
 * fuer fractional delay reads.  Kein Feedback.
 *
 * Defensive: NaN / out-of-range Optionen fallen auf Defaults zurueck
 * oder werden geclamped (siehe Modul-JSDoc).  Empty buffer -> empty output.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl & Laenge wie input.
 */
export function applyChorus(
  buffer: AudioBufferLike,
  opts: ChorusOptions = {},
): AudioBufferLike {
  const rateHz = sanitizeRate(opts.rateHz);
  const depthMs = sanitizeDepth(opts.depthMs);
  const delayMs = sanitizeDelayMs(opts.delayMs);
  const mix = sanitizeMix(opts.mix);

  // empty input -> empty output (Channel-Anzahl bleibt 0)
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;

  // Delay-Buffer-Groesse: max read-window + Guard fuer linear-Interpolation.
  // max delayMs_t = delayMs + depthMs/2.
  const maxDelayMs = delayMs + depthMs / 2;
  const maxDelaySamples = Math.max(
    1,
    Math.ceil((maxDelayMs * sampleRate) / 1000) + 2,
  );

  const oneMinusMix = 1 - mix;
  const twoPiRate = 2 * Math.PI * rateHz;
  const halfDepth = depthMs / 2;

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(len);
    const delayBuffer = new Float32Array(maxDelaySamples);

    // write-index in ring buffer (advances jeden Sample)
    let writeIdx = 0;

    for (let i = 0; i < len; i++) {
      const drySample = dry[i];

      // 1) WRITE dry sample into delay buffer at writeIdx
      delayBuffer[writeIdx] = drySample;

      // 2) Compute modulated read-position
      const t = i / sampleRate;
      const lfoRaw = Math.sin(twoPiRate * t);              // [-1, 1]
      const lfo = ((lfoRaw + 1) * 0.5) * depthMs;          // [0, depthMs]
      const modDelayMs = delayMs + (lfo - halfDepth);      // [delayMs-h, delayMs+h]
      let delaySamplesT = (modDelayMs * sampleRate) / 1000;
      if (delaySamplesT < 1) delaySamplesT = 1;            // safety clamp

      // 3) READ from delay buffer at (writeIdx - delaySamplesT), linear-interp
      const readPos = writeIdx - delaySamplesT;
      let readFloor = Math.floor(readPos);
      const frac = readPos - readFloor;
      // normalize readFloor into [0, maxDelaySamples)
      readFloor = ((readFloor % maxDelaySamples) + maxDelaySamples) % maxDelaySamples;
      const readNext = (readFloor + 1) % maxDelaySamples;
      const a = delayBuffer[readFloor];
      const b = delayBuffer[readNext];
      const delayed = a + (b - a) * frac;

      // 4) Mix wet + dry
      out[i] = mix * delayed + oneMinusMix * drySample;

      // 5) Advance write-index
      writeIdx = (writeIdx + 1) % maxDelaySamples;
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Chorus-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:  dezent, leichte Verbreiterung
 * - classic: Default-Stereo-Chorus
 * - lush:    fett, langsamere/groessere Modulation
 * - shimmer: schneller LFO, drahtig
 */
export const CHORUS_PRESETS = {
  subtle: { rateHz: 0.5, depthMs: 2, mix: 0.3 },
  classic: { rateHz: 1.0, depthMs: 5, mix: 0.5 },
  lush: { rateHz: 0.8, depthMs: 8, mix: 0.7 },
  shimmer: { rateHz: 3.0, depthMs: 3, mix: 0.4 },
} as const;
