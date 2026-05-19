/**
 * Synthstudio – beatRepeat.ts (v3.142.0)
 *
 * Pure-Helper für Beat-Repeat / Stutter-Live-Effekt:
 *   - Nimmt den ersten "rate"-Samples-langen Chunk vom Input
 *   - Loopt ihn über die volle Länge des Output-Buffers
 *   - Optional: Feedback-Damping pro Repeat, linear Crossfade an Loop-Grenzen
 *
 * Anwendung:
 *   - Live-Stutter: bei Note-On den aktuellen Slice "freezen" und repetieren
 *   - Offline: Sample in einen rhythmischen Stutter-Loop verwandeln
 *
 * Public API:
 *   - applyBeatRepeat(buffer, options) → AudioBufferLike (same length, looped)
 *   - rateSamplesFromBpm(bpm, sampleRate, division) → number
 *   - BEAT_REPEAT_DIVISIONS — Liste der Standard-Divisions
 *
 * Pure & Node-testbar.
 *
 * Tests: tests/features/beat-repeat.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Standard-Note-Divisions für Beat-Repeat-Rate. Map von Display-Name auf
 * Beat-Fraction (1.0 = quarter note).
 */
export const BEAT_REPEAT_DIVISIONS: Record<string, number> = {
  "1/2": 2.0,
  "1/4": 1.0,
  "1/8": 0.5,
  "1/8T": 1 / 3,
  "1/16": 0.25,
  "1/16T": 1 / 6,
  "1/32": 0.125,
};

export const DEFAULT_BEAT_REPEAT_RATE = "1/8";
export const MIN_REPEAT_SAMPLES = 16;

export interface BeatRepeatOptions {
  /** Length of the repeated chunk in samples. Min 16 (defensiv). */
  rateSamples: number;
  /**
   * Feedback 0..1. 0 = no damping (all repeats full volume),
   * 1 = exponential decay (each repeat 50% quieter). Default 0.
   */
  feedback?: number;
  /**
   * Crossfade in samples between loop iterations. Min 0, max rateSamples/2.
   * 0 = hard cut (klicky bei trans. attacks). Default 0.
   */
  crossfadeSamples?: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Berechnet die Sample-Count für eine Note-Division.
 *
 *   beatDuration = 60 / bpm sekunden (Quarter-Note)
 *   division = relative zur Quarter-Note (1/4 = 1.0, 1/8 = 0.5, ...)
 *
 * Returns floor(samples), min MIN_REPEAT_SAMPLES.
 */
export function rateSamplesFromBpm(
  bpm: number,
  sampleRate: number,
  division: number,
): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return MIN_REPEAT_SAMPLES;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return MIN_REPEAT_SAMPLES;
  if (!Number.isFinite(division) || division <= 0) return MIN_REPEAT_SAMPLES;
  const quarterDurationSec = 60 / bpm;
  const durationSec = quarterDurationSec * division;
  const samples = Math.floor(durationSec * sampleRate);
  return Math.max(MIN_REPEAT_SAMPLES, samples);
}

/**
 * Loopt den ersten "rateSamples"-langen Chunk durch den ganzen Buffer.
 *
 * Algorithmus:
 *   1. Source: src[0..rateSamples-1]
 *   2. Output[i] für i in 0..len-1:
 *      repeat = floor(i / rateSamples)
 *      gain = (1 - feedback)^repeat
 *      offset = i % rateSamples
 *      val = src[offset] * gain
 *      bei crossfade: linear interpoliere zwischen Ende des vorigen Repeats
 *        und Start des neuen Repeats über crossfadeSamples
 *
 * Defensive bei kurzem Input: wenn buffer.length < rateSamples, returns
 * unveränderte Kopie (keine Wiederholung möglich).
 */
export function applyBeatRepeat(
  buffer: AudioBufferLike,
  options: BeatRepeatOptions,
): AudioBufferLike {
  if (!buffer || buffer.length === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  const len = buffer.length;
  const chCount = buffer.numberOfChannels;
  const rate = Math.max(MIN_REPEAT_SAMPLES, Math.floor(options.rateSamples));
  const feedback = clamp(options.feedback ?? 0, 0, 1);
  const crossfade = Math.max(0, Math.min(Math.floor(rate / 2), Math.floor(options.crossfadeSamples ?? 0)));

  // Edge: rate >= len → Wiederholung gar nicht aktiv, identische Kopie.
  if (rate >= len) {
    return copyBuffer(buffer);
  }

  // Damping-Faktor pro Repeat: bei feedback=0 → 1.0 (no damp), feedback=1 → 0.5.
  // Logik: gain = (1 - feedback*0.5)^repeatIndex.
  const dampPerRepeat = 1 - feedback * 0.5;

  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const repeatIdx = Math.floor(i / rate);
      const offset = i - repeatIdx * rate;
      const gain = Math.pow(dampPerRepeat, repeatIdx);

      let val = src[offset] * gain;

      // Crossfade: bei den ersten "crossfade" Samples eines neuen Repeats
      // (außer dem ersten Repeat) linear interpoliere mit dem Schwanz des
      // vorigen Repeats.
      if (crossfade > 0 && repeatIdx > 0 && offset < crossfade) {
        const prevRepeatGain = Math.pow(dampPerRepeat, repeatIdx - 1);
        const prevOffset = rate - crossfade + offset; // letzte crossfade-Samples des src
        const prevVal = src[prevOffset] * prevRepeatGain;
        const t = offset / crossfade; // 0 → prev, 1 → cur
        val = prevVal * (1 - t) + val * t;
      }

      dst[i] = val;
    }
    channels.push(dst);
  }

  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

function copyBuffer(buffer: AudioBufferLike): AudioBufferLike {
  const chCount = buffer.numberOfChannels;
  const len = buffer.length;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    dst.set(src);
    channels.push(dst);
  }
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}
