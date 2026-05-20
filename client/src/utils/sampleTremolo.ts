/**
 * Synthstudio – sampleTremolo.ts (v3.207.0)
 *
 * Pure-Helper fuer einen Tremolo-Effekt: Amplitude-Modulation per LFO.
 *
 * ─── Modell ─────────────────────────────────────────────────────────────────
 *
 * Im Gegensatz zu Chorus/Flanger (modulierte Delay-Line) moduliert ein
 * Tremolo nur die AMPLITUDE des Signals via LFO ohne Delay/Pitch-Effekt.
 *
 *   t          = i / sampleRate                         // Zeit in s
 *   waveform_t = LFO-Wert(t)                            // [0..1] unipolar
 *   gain_t     = 1 - depth + depth * waveform_t         // [1-depth..1]
 *   output[i]  = input[i] * gain_t
 *
 * Bei depth=0 ist gain_t konstant 1 -> identity.
 * Bei depth=1 schwankt gain_t zwischen 0 und 1.
 * Sub-Unity-Gain (immer <=1) verhindert Clipping; klassisches Tremolo-Verhalten.
 *
 * ─── Waveforms ──────────────────────────────────────────────────────────────
 *
 * Alle Waveforms liefern Werte in [0, 1] (unipolar), so dass gain_t
 * deterministisch in [1-depth, 1] bleibt — kein Clipping, kein Phase-Flip.
 *
 *   sine:     (sin(2*pi*rate*t) + 1) / 2
 *   triangle: gleichphasige 0..1..0-Dreieck-Welle, Periode 1/rate
 *             phase = (rate*t) mod 1 in [0,1)
 *             val   = phase < 0.5 ? phase*2 : 2 - phase*2
 *   square:   (rate*t) mod 1 < 0.5 ? 1 : 0
 *
 * Alle Waveforms haben dieselbe Periode (1/rate) und denselben Mittelwert (0.5).
 *
 * ─── LFO-Phase pro Channel ──────────────────────────────────────────────────
 *
 * SHARED LFO ueber alle Channels — Stereo-Sample mit identischen Channels
 * liefert identischen Output (analog Chorus/Flanger). Es gibt keinen
 * pro-Channel-State (kein Delay-Buffer).
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - rateHz   NaN/non-finite/<=0 -> 5,   >50 -> 50
 * - depth    NaN/non-finite/<0  -> 0,   >1  -> 1
 * - waveform unknown / undefined -> 'sine'
 *
 * Empty buffer -> empty output (numberOfChannels=0).  Input wird nie mutiert.
 * Output-Laenge == Input-Laenge.
 *
 * ─── Finiteness ─────────────────────────────────────────────────────────────
 *
 * Tremolo ist ein einfacher Multiply-Operator (gain_t * input[i]). Solange
 * input finite ist, ist output finite. Keine IIR-Stabilitaets-Probleme.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_RATE_HZ = 5;
const DEFAULT_DEPTH = 0.5;
const DEFAULT_WAVEFORM: TremoloWaveform = "sine";

const MAX_RATE_HZ = 50;

// ─── Public Types ────────────────────────────────────────────────────────────

export type TremoloWaveform = "sine" | "triangle" | "square";

export interface TremoloOptions {
  /** LFO-Rate in Hz (0.1..20 typ, 0.1..50 erlaubt). Default 5. */
  rateHz?: number;
  /** Modulations-Tiefe (0..1). Default 0.5. 0 = identity, 1 = full mod. */
  depth?: number;
  /** LFO-Waveform. Default "sine". */
  waveform?: TremoloWaveform;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

function sanitizeRate(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_RATE_HZ;
  if (v > MAX_RATE_HZ) return MAX_RATE_HZ;
  return v;
}

function sanitizeDepth(v: number | undefined): number {
  if (v === undefined) return DEFAULT_DEPTH;
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sanitizeWaveform(v: TremoloWaveform | string | undefined): TremoloWaveform {
  if (v === "sine" || v === "triangle" || v === "square") return v;
  return DEFAULT_WAVEFORM;
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

/** Unipolar LFO value at time t (seconds), result in [0, 1]. */
function lfoValue(waveform: TremoloWaveform, t: number, rateHz: number): number {
  switch (waveform) {
    case "sine": {
      return (Math.sin(2 * Math.PI * rateHz * t) + 1) / 2;
    }
    case "triangle": {
      const phase = ((rateHz * t) % 1 + 1) % 1;
      return phase < 0.5 ? phase * 2 : 2 - phase * 2;
    }
    case "square": {
      const phase = ((rateHz * t) % 1 + 1) % 1;
      return phase < 0.5 ? 1 : 0;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet einen Tremolo-Effekt (Amplitude-Modulation via LFO) auf einen
 * Sample-Buffer an.
 *
 * Algorithmus: pro Sample wird ein gain-Faktor aus einem unipolaren LFO
 * (sine/triangle/square in [0,1]) berechnet:
 *   gain = 1 - depth + depth * lfo  (in [1-depth, 1])
 *   output[i] = input[i] * gain
 * Sub-Unity-Gain verhindert Clipping. LFO-Phase ist SHARED ueber Channels
 * (kein pro-Channel-State).
 *
 * Defensive: NaN / out-of-range Optionen fallen auf Defaults zurueck oder
 * werden geclamped (siehe Modul-JSDoc).  Empty buffer -> empty output.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl & Laenge wie input.
 */
export function applyTremolo(
  buffer: AudioBufferLike,
  opts: TremoloOptions = {},
): AudioBufferLike {
  const rateHz = sanitizeRate(opts.rateHz);
  const depth = sanitizeDepth(opts.depth);
  const waveform = sanitizeWaveform(opts.waveform);

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

  const oneMinusDepth = 1 - depth;

  // Pre-compute gain envelope once (shared across channels)
  const gainEnv = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const lfo = lfoValue(waveform, t, rateHz);
    gainEnv[i] = oneMinusDepth + depth * lfo;
  }

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = dry[i] * gainEnv[i];
    }
    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Tremolo-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:   dezent (langsam, schwach)
 * - classic:  Default-Tremolo
 * - pulse:    schnelle harte Modulation via square
 * - vintage:  warmer triangle, mittlere Tiefe
 */
export const TREMOLO_PRESETS = {
  subtle: { rateHz: 3, depth: 0.3, waveform: "sine" },
  classic: { rateHz: 5, depth: 0.5, waveform: "sine" },
  pulse: { rateHz: 8, depth: 0.8, waveform: "square" },
  vintage: { rateHz: 6, depth: 0.7, waveform: "triangle" },
} as const;

