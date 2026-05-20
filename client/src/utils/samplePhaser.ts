/**
 * Synthstudio - samplePhaser.ts (v3.215.0)
 *
 * Pure-Helper fuer Phaser-Effekt: Kaskadierte modulierte All-Pass-Stages
 * mit LFO-Sweep, Feedback-Loop und Wet/Dry-Mix.
 *
 * --- Abgrenzung zu sampleAllPass.ts (v3.202) ---
 *
 * sampleAllPass.applyAllPass: STATIC centerHz, kein LFO, kein Feedback,
 * kein Mix - reine Phasenverschiebung mit Magnitude-Erhalt.  Foundation.
 *
 * samplePhaser.applyPhaser: zusaetzlich LFO-MODULIERTER centerHz_t,
 * Feedback-Loop und Wet/Dry-Mix.  Damit entsteht das klassische
 * Phaser-Klangbild (notches sweepen ueber das Spektrum).  Wir
 * implementieren die Biquad-Coefficient-Logik inline mit BLOCK-basierter
 * Coefficient-Update (alle BLOCK_SIZE samples neu) - siehe Spec, gut
 * genug fuer Phaser-Effekt und vermeidet O(N*stages) trigonometrische
 * Berechnungen pro Sample.
 *
 * --- DSP-Modell ---
 *
 * Pro Channel laeuft eigene Filter-State (per Stage), aber LFO-Phase
 * + Coefficient-Updates sind SHARED ueber alle Channels.
 *
 *   block_start_t   = blockIdx / sampleRate
 *   lfo_t           = sin(2*pi*rate*block_start_t)   in [-1, 1]
 *   centerHz_t      = baseFreq * (1 + depth * lfo_t) in [50, sr/2]
 *
 *   RBJ all-pass coefficients with Q = 0.707 (Butterworth):
 *     omega = 2*pi*centerHz_t / sampleRate
 *     alpha = sin(omega) / (2 * Q)
 *     a0    = 1 + alpha
 *     b0/a0 = (1 - alpha) / a0
 *     b1/a0 = -2*cos(omega) / a0
 *     b2/a0 = (1 + alpha) / a0
 *     a1/a0 = -2*cos(omega) / a0
 *     a2/a0 = (1 - alpha) / a0
 *
 *   Pro Sample i innerhalb eines Blocks:
 *     in_i      = dry[i] + feedback * last_phaser_output
 *     wet_i     = cascade_N_stages(in_i)
 *     last_phaser_output = wet_i
 *     out[i]    = (1 - mix) * dry[i] + mix * wet_i
 *
 * --- Defensive Defaults ---
 *
 *   rateHz    undefined / NaN / <=0 / non-finite   -> 0.5
 *             > 10                                 -> 10
 *   depth     undefined                            -> 0.6
 *             NaN / <0 / non-finite                -> 0
 *             > 1                                  -> 1
 *   baseFreq  undefined / NaN / <50 / non-finite   -> 800
 *             > 5000                               -> 5000
 *   stages    undefined                            -> 4
 *             NaN / <2 / non-finite                -> 2
 *             > 12                                 -> 12
 *             non-integer                          -> floor
 *   mix       undefined                            -> 0.5
 *             NaN / <0 / non-finite                -> 0
 *             > 1                                  -> 1
 *   feedback  undefined                            -> 0
 *             NaN / <-0.95 / non-finite            -> 0
 *             > 0.95                               -> 0.95
 *
 * Empty buffer -> empty output mit fallback sampleRate=48000.
 * Input wird NIE mutiert.  Output-Laenge == Input-Laenge.
 *
 * --- Finiteness ---
 *
 * Feedback ist stability-capped auf |feedback| <= 0.95.  Die kaskadierte
 * Allpass-Section ist Magnitude-Preserving (|H(omega)|=1).
 * Sanitizer fangen NaN/Inf in Options ab.  Zusaetzliche per-Sample
 * NaN-Guard ersetzt akkumulierte NaN durch 0.
 *
 * Pure & DOM-frei.  Pattern angelehnt an sampleFlanger.ts (v3.206).
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Konstanten ---

const DEFAULT_RATE_HZ = 0.5;
const DEFAULT_DEPTH = 0.6;
const DEFAULT_BASE_FREQ = 800;
const DEFAULT_STAGES = 4;
const DEFAULT_MIX = 0.5;
const DEFAULT_FEEDBACK = 0;

const MAX_RATE_HZ = 10;
const MIN_BASE_FREQ = 50;
const MAX_BASE_FREQ = 5000;
const MIN_STAGES = 2;
const MAX_STAGES = 12;
const MIN_FEEDBACK = -0.95;
const MAX_FEEDBACK = 0.95;
const MIN_CENTER_HZ_FLOOR = 50;

/** Block-Groesse fuer Coefficient-Update.  Spec erlaubt block-basiert. */
const BLOCK_SIZE = 64;

/** Q-Faktor (Butterworth) fuer alle Stages - pinned per Spec. */
const Q_FACTOR = 0.707;

const FALLBACK_SAMPLE_RATE = 48000;

// --- Public Types ---

export interface PhaserOptions {
  /** LFO-Rate in Hz (0.05..5 typisch, 0..10 erlaubt). Default 0.5. */
  rateHz?: number;
  /** Modulations-Tiefe (0..1). Default 0.6. */
  depth?: number;
  /** Center-Frequenz in Hz (200..3000 typisch, 50..5000 erlaubt). Default 800. */
  baseFreq?: number;
  /** Anzahl All-Pass-Stages (2..12). Default 4. */
  stages?: number;
  /** Wet/Dry-Mix (0..1). Default 0.5. */
  mix?: number;
  /** Feedback-Resonanz (-0.95..0.95). Default 0. */
  feedback?: number;
}

// --- Helpers (intern) ---

function sanitizeRate(v: number | undefined): number {
  if (v === undefined) return DEFAULT_RATE_HZ;
  if (!Number.isFinite(v)) return DEFAULT_RATE_HZ;
  if ((v as number) <= 0) return DEFAULT_RATE_HZ;
  if ((v as number) > MAX_RATE_HZ) return MAX_RATE_HZ;
  return v as number;
}

function sanitizeDepth(v: number | undefined): number {
  // Spec: undefined -> 0.6 (Default), NaN/<0 -> 0, >1 -> 1
  if (v === undefined) return DEFAULT_DEPTH;
  if (!Number.isFinite(v)) return 0;
  if ((v as number) < 0) return 0;
  if ((v as number) > 1) return 1;
  return v as number;
}

function sanitizeBaseFreq(v: number | undefined): number {
  // Spec: undefined / NaN / <50 -> 800, >5000 -> 5000
  if (v === undefined) return DEFAULT_BASE_FREQ;
  if (!Number.isFinite(v)) return DEFAULT_BASE_FREQ;
  if ((v as number) < MIN_BASE_FREQ) return DEFAULT_BASE_FREQ;
  if ((v as number) > MAX_BASE_FREQ) return MAX_BASE_FREQ;
  return v as number;
}

function sanitizeStages(v: number | undefined): number {
  // Spec: undefined -> 4, NaN/<2 -> 2, >12 -> 12, non-int floor
  if (v === undefined) return DEFAULT_STAGES;
  if (!Number.isFinite(v)) return MIN_STAGES;
  const intVal = Math.floor(v as number);
  if (intVal < MIN_STAGES) return MIN_STAGES;
  if (intVal > MAX_STAGES) return MAX_STAGES;
  return intVal;
}

function sanitizeMix(v: number | undefined): number {
  // Spec: undefined -> 0.5, NaN/<0 -> 0, >1 -> 1
  if (v === undefined) return DEFAULT_MIX;
  if (!Number.isFinite(v)) return 0;
  if ((v as number) < 0) return 0;
  if ((v as number) > 1) return 1;
  return v as number;
}

function sanitizeFeedback(v: number | undefined): number {
  // Spec: undefined -> 0, NaN / <-0.95 -> 0, >0.95 -> 0.95
  if (v === undefined) return DEFAULT_FEEDBACK;
  if (!Number.isFinite(v)) return 0;
  if ((v as number) < MIN_FEEDBACK) return 0;
  if ((v as number) > MAX_FEEDBACK) return MAX_FEEDBACK;
  return v as number;
}

function clampCenterHz(value: number, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  if (!Number.isFinite(value)) return MIN_CENTER_HZ_FLOOR;
  if (value < MIN_CENTER_HZ_FLOOR) return MIN_CENTER_HZ_FLOOR;
  if (value > nyquist) return nyquist;
  return value;
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
 * Berechnet die normalisierten RBJ-All-Pass-Coefficients fuer einen
 * gegebenen centerHz + sampleRate.  Q ist gepinnt auf Q_FACTOR.
 *
 * Returns [b0n, b1n, b2n, a1n, a2n] (alle bereits durch a0 dividiert).
 */
function allPassCoefficients(
  centerHz: number,
  sampleRate: number,
): [number, number, number, number, number] {
  const omega = (2 * Math.PI * centerHz) / sampleRate;
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);
  const alpha = sinW / (2 * Q_FACTOR);
  const a0 = 1 + alpha;
  const b0n = (1 - alpha) / a0;
  const b1n = (-2 * cosW) / a0;
  const b2n = (1 + alpha) / a0;
  const a1n = (-2 * cosW) / a0;
  const a2n = (1 - alpha) / a0;
  return [b0n, b1n, b2n, a1n, a2n];
}

// --- Public API ---

/**
 * Wendet einen Phaser-Effekt auf einen Sample-Buffer an.
 *
 * Algorithmus: pro Channel kaskadierte N-Stage Biquad-All-Pass-Sections
 * mit BLOCK-basiert moduliertem centerHz (LFO sin), Feedback-Loop und
 * Wet/Dry-Mix.  LFO-Phase + Coefficients sind SHARED ueber alle Channels.
 *
 * Block-Update: alle BLOCK_SIZE (=64) Samples werden die Coefficients
 * neu berechnet - vermeidet O(N*stages) sin/cos pro Sample, erhaelt das
 * Phaser-Klangbild (LFO-Rate bis 10 Hz -> 64 Samples bei 48k = 1.3 ms,
 * vollkommen ausreichend).
 *
 * Defensive: NaN / out-of-range Optionen fallen auf Defaults zurueck oder
 * werden geclamped (siehe Modul-JSDoc).  Empty buffer -> empty output.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl + Laenge wie Input.
 */
export function applyPhaser(
  buffer: AudioBufferLike,
  opts: PhaserOptions = {},
): AudioBufferLike {
  const rateHz = sanitizeRate(opts.rateHz);
  const depth = sanitizeDepth(opts.depth);
  const baseFreq = sanitizeBaseFreq(opts.baseFreq);
  const stages = sanitizeStages(opts.stages);
  const mix = sanitizeMix(opts.mix);
  const feedback = sanitizeFeedback(opts.feedback);

  // empty input -> empty output (Channel-Anzahl bleibt 0)
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
  const oneMinusMix = 1 - mix;
  const twoPiRate = 2 * Math.PI * rateHz;

  // Pre-compute coefficient table per block.  Shared across Channels.
  const numBlocks = Math.ceil(len / BLOCK_SIZE);
  const blockCoeffs: Array<[number, number, number, number, number]> = new Array(numBlocks);
  for (let blk = 0; blk < numBlocks; blk++) {
    const blockStartIdx = blk * BLOCK_SIZE;
    const t = blockStartIdx / sampleRate;
    const lfo = Math.sin(twoPiRate * t);              // [-1, 1]
    const rawCenter = baseFreq * (1 + depth * lfo);
    const centerHz = clampCenterHz(rawCenter, sampleRate);
    blockCoeffs[blk] = allPassCoefficients(centerHz, sampleRate);
  }

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(len);

    // State pro Stage: x1, x2, y1, y2 (Float64 fuer Numerik-Stabilitaet)
    const x1 = new Float64Array(stages);
    const x2 = new Float64Array(stages);
    const y1 = new Float64Array(stages);
    const y2 = new Float64Array(stages);

    // Feedback state: letzter Wet-Output
    let lastWet = 0;

    let curBlock = -1;
    let b0n = 0, b1n = 0, b2n = 0, a1n = 0, a2n = 0;

    for (let i = 0; i < len; i++) {
      const blk = (i / BLOCK_SIZE) | 0; // integer block index
      if (blk !== curBlock) {
        curBlock = blk;
        const c5 = blockCoeffs[blk];
        b0n = c5[0]; b1n = c5[1]; b2n = c5[2]; a1n = c5[3]; a2n = c5[4];
      }

      const drySample = dry[i];
      // Feedback in den Filter-Input einspeisen
      let sample = drySample + feedback * lastWet;

      // Cascade N stages
      for (let s = 0; s < stages; s++) {
        const x = sample;
        const y =
          b0n * x +
          b1n * x1[s] +
          b2n * x2[s] -
          a1n * y1[s] -
          a2n * y2[s];
        x2[s] = x1[s];
        x1[s] = x;
        y2[s] = y1[s];
        y1[s] = y;
        sample = y;
      }

      // Belt-and-suspenders gegen akkumulierten NaN bei extremen Edge-Cases.
      if (!Number.isFinite(sample)) sample = 0;

      lastWet = sample;
      out[i] = oneMinusMix * drySample + mix * sample;
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Phaser-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:  dezent, langsame Bewegung, schmaler Mix-Anteil
 * - classic: Default-Phaser (Spec-Defaults)
 * - deep:    tiefe Modulation, 8 Stages - markante notches
 * - jet:     schnell + max-depth + Feedback fuer jet-plane-Effekt
 */
export const PHASER_PRESETS = {
  subtle: { rateHz: 0.2, depth: 0.3, stages: 4, mix: 0.4 },
  classic: { rateHz: 0.5, depth: 0.6, stages: 4, mix: 0.5 },
  deep: { rateHz: 0.3, depth: 0.8, stages: 8, mix: 0.6 },
  jet: { rateHz: 1, depth: 1, stages: 6, mix: 0.7, feedback: 0.5 },
} as const;
