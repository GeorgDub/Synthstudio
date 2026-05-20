/**
 * Synthstudio – sampleGainEnvelope.ts (v3.212.0)
 *
 * Pure-Helper fuer ADSR-Gain-Envelope auf Sample-Ebene. Wendet eine klassische
 * 4-Stage-Huellkurve (Attack -> Decay -> Sustain -> Release) als
 * Multiplikator-Curve auf einen AudioBufferLike an.
 *
 * --- ADSR-Modell -------------------------------------------------------
 *
 * Pro Sample i in [0, totalSamples):
 *   - if i < attackSamples:
 *       env = i / attackSamples                            (linear 0 -> 1)
 *   - elif i < attackSamples + decaySamples:
 *       t = (i - attackSamples) / decaySamples
 *       env = 1 + (sustainLevel - 1) * t                   (linear 1 -> sustain)
 *   - elif i < totalSamples - releaseSamples:
 *       env = sustainLevel                                 (sustain hold)
 *   - else:
 *       t = (i - (totalSamples - releaseSamples)) / releaseSamples
 *       env = sustainLevel * (1 - t)                       (linear sustain -> 0)
 *
 * output[i] = input[i] * env
 *
 * Wenn attackSamples == 0: die "i < 0"-Bedingung trifft NIE -> branch 1 wird
 * uebersprungen (kein i/0). Dito decay/release. Identity-Fall:
 * attackMs=0/sustain=1/releaseMs=0 (decay beliebig) -> env=1 ueberall, weil
 * bei sustainLevel=1 die decay-Branch env = 1 + (1-1)*t = 1 liefert.
 *
 * Wenn attackSamples + decaySamples + releaseSamples > totalSamples: alle drei
 * werden proportional skaliert (factor = totalSamples / (a+d+r)). Bei
 * totalSamples=0 wird factor=0 -> alle drei = 0 (degenerat, aber kein Crash).
 *
 * --- Wichtige Designentscheidungen -------------------------------------
 *
 * 1) Per-Channel-Loop, aber pro Sample der gleiche env-Wert ueber alle
 *    Channels (mono envelope, stereo signal preserved). Symmetric.
 *
 * 2) Output-Laenge == Input-Laenge (im Gegensatz zu Stutter v3.211 das die
 *    Buffer-Laenge aendert). numberOfChannels preserved (im Gegensatz zu
 *    AutoPan v3.209 das immer Stereo liefert).
 *
 * 3) Empty buffer (length=0 oder numberOfChannels=0) -> empty Result mit
 *    numberOfChannels=0 + fallback sampleRate=48000 (Tremolo/Stutter-Konvention).
 *
 * 4) Input wird NIE mutiert. Output garantiert finite.
 *
 * --- Defensive Defaults ------------------------------------------------
 *
 * - attackMs    NaN/<0/-Infinity -> 10    (Default), >10000 / +Infinity -> 10000.
 * - decayMs     NaN/<0/-Infinity -> 100   (Default), >10000 / +Infinity -> 10000.
 * - sustainLevel undefined        -> 0.7  (Default).
 *                NaN/<0/-Infinity -> 0    (Clamp-low, NICHT Default).
 *                >1 / +Infinity   -> 1    (Clamp-high).
 * - releaseMs   NaN/<0/-Infinity -> 200   (Default), >20000 / +Infinity -> 20000.
 *
 * Beachte: releaseMs MAX ist 20000, nicht 10000 wie attack/decay (Spec).
 *
 * Pure & DOM-frei.
 *
 * Tests: tests/features/sample-gain-envelope.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public API Types ────────────────────────────────────────────────────────

export interface AdsrOptions {
  /** Attack-Dauer in ms. Range 0..10000. Default 10. */
  attackMs?: number;
  /** Decay-Dauer in ms. Range 0..10000. Default 100. */
  decayMs?: number;
  /** Sustain-Pegel in [0,1]. Default 0.7. */
  sustainLevel?: number;
  /** Release-Dauer in ms. Range 0..20000. Default 200. */
  releaseMs?: number;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const DEFAULT_ATTACK_MS = 10;
export const DEFAULT_DECAY_MS = 100;
export const DEFAULT_SUSTAIN_LEVEL = 0.7;
export const DEFAULT_RELEASE_MS = 200;

export const MAX_ATTACK_MS = 10000;
export const MAX_DECAY_MS = 10000;
export const MAX_RELEASE_MS = 20000;

export const FALLBACK_SAMPLE_RATE = 48000;

/**
 * Standard-Presets fuer typische musikalische Envelopes.
 *
 *  - pluck: scharfer Attack, schnelles Decay, niedriger Sustain -> Pizzicato/Pluck.
 *  - pad:   langer Attack, hoher Sustain, langes Release -> Streicher/Pad.
 *  - stab:  schneller Attack, kurzes Decay, mittlerer Sustain -> Brass-Stab.
 *  - drone: sehr langer Attack, fast voller Sustain, langer Release -> Drone.
 */
export const ADSR_PRESETS = {
  pluck: { attackMs: 1, decayMs: 50, sustainLevel: 0.3, releaseMs: 100 },
  pad: { attackMs: 500, decayMs: 200, sustainLevel: 0.8, releaseMs: 1000 },
  stab: { attackMs: 5, decayMs: 30, sustainLevel: 0.5, releaseMs: 100 },
  drone: { attackMs: 2000, decayMs: 500, sustainLevel: 0.95, releaseMs: 2000 },
} as const;

// ─── Defensive Sanitizers ────────────────────────────────────────────────────

/**
 * NaN / <0 / -Infinity -> default. +Infinity / >max -> max.
 * +Infinity wird ZUERST gefangen (vor !isFinite), damit es zum Clamp und nicht
 * zum Default-Pfad geht (analog AutoPan v3.209 / Stutter v3.211).
 */
function sanitizeMs(value: number | undefined, def: number, max: number): number {
  if (value === undefined) return def;
  if (value > max) return max; // catches +Infinity and >max
  if (Number.isNaN(value) || value < 0) return def; // catches NaN and -Infinity (<0)
  return value;
}

/**
 * sustainLevel: undefined -> default (0.7).
 * NaN/<0/-Infinity -> 0 (Clamp-low, NICHT default).
 * +Infinity / >1 -> 1 (Clamp-high).
 */
function sanitizeSustain(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SUSTAIN_LEVEL;
  if (value > 1) return 1; // catches +Infinity and >1
  if (Number.isNaN(value) || value < 0) return 0; // catches NaN and -Infinity
  return value;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msToSamples(ms: number, sampleRate: number): number {
  return Math.floor((ms * sampleRate) / 1000);
}

function emptyResult(sampleRate: number): AudioBufferLike {
  return {
    sampleRate: sampleRate > 0 ? sampleRate : FALLBACK_SAMPLE_RATE,
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
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet eine ADSR-Gain-Envelope auf einen AudioBufferLike an.
 *
 * Identity-Fall: attackMs=0, sustainLevel=1, releaseMs=0 (decayMs egal,
 * weil bei sustainLevel=1 die decay-Branch env=1 liefert) -> Output == Input
 * (sample-genau).
 *
 * @param buffer Eingabe-Buffer. Wird NIE mutiert.
 * @param opts   ADSR-Optionen. Alle Felder optional; jedes individuell sanitized.
 * @returns Neuer AudioBufferLike mit identischer Laenge / numberOfChannels.
 */
export function applyAdsr(
  buffer: AudioBufferLike,
  opts?: AdsrOptions,
): AudioBufferLike {
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return emptyResult(buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE);
  }

  const attackMs = sanitizeMs(opts?.attackMs, DEFAULT_ATTACK_MS, MAX_ATTACK_MS);
  const decayMs = sanitizeMs(opts?.decayMs, DEFAULT_DECAY_MS, MAX_DECAY_MS);
  const sustainLevel = sanitizeSustain(opts?.sustainLevel);
  const releaseMs = sanitizeMs(opts?.releaseMs, DEFAULT_RELEASE_MS, MAX_RELEASE_MS);

  const sampleRate = buffer.sampleRate > 0 ? buffer.sampleRate : FALLBACK_SAMPLE_RATE;
  const totalSamples = buffer.length;
  const chCount = buffer.numberOfChannels;

  // Sample-counts berechnen, dann ggf. proportional clampen.
  let attackSamples = msToSamples(attackMs, sampleRate);
  let decaySamples = msToSamples(decayMs, sampleRate);
  let releaseSamples = msToSamples(releaseMs, sampleRate);

  const sumPhases = attackSamples + decaySamples + releaseSamples;
  if (sumPhases > totalSamples) {
    const factor = sumPhases > 0 ? totalSamples / sumPhases : 0;
    attackSamples = Math.floor(attackSamples * factor);
    decaySamples = Math.floor(decaySamples * factor);
    releaseSamples = Math.floor(releaseSamples * factor);
  }

  const releaseStart = totalSamples - releaseSamples;
  const decayEnd = attackSamples + decaySamples;

  const out: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      let env: number;
      if (i < attackSamples) {
        // attack: 0 -> 1
        env = i / attackSamples;
      } else if (i < decayEnd) {
        // decay: 1 -> sustain
        const t = (i - attackSamples) / decaySamples;
        env = 1 + (sustainLevel - 1) * t;
      } else if (i < releaseStart) {
        // sustain hold
        env = sustainLevel;
      } else {
        // release: sustain -> 0
        const t = (i - releaseStart) / releaseSamples;
        env = sustainLevel * (1 - t);
      }
      dst[i] = (src[i] ?? 0) * env;
    }
    out.push(dst);
  }

  return wrapBuffer(out, sampleRate, totalSamples);
}
