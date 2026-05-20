/**
 * Synthstudio – sampleAutoPan.ts (v3.209.0)
 *
 * Pure-Helper fuer Stereo-Autopan: das Sample wird in Stereo ueber den
 * Stereo-Pan-Raum (L-R) per LFO moduliert.  Im Gegensatz zu Tremolo
 * (v3.207 Amplitude-Modulation) und Vibrato (v3.208 Pitch-Modulation via
 * Doppler-Delay) bewegt AutoPan das Signal periodisch zwischen Hard-Left
 * und Hard-Right ohne Lautstaerke- oder Tonhoehen-Veraenderung.
 *
 * --- DSP-Modell --------------------------------------------------------
 *
 * BIPOLARER LFO (im Gegensatz zu Tremolo dessen LFO unipolar in [0,1] ist):
 *   sine:     sin(2*pi*rate*t)
 *   triangle: phase=(rate*t)%1, phase<0.5 ? 4*phase-1 : 3-4*phase  (-1..+1..-1)
 *   square:   phase=(rate*t)%1, phase<0.5 ? +1 : -1
 *
 * pan_t = depth * LFO_t   in [-depth, +depth]
 *   pan_t = -1  -> hard left
 *   pan_t =  0  -> center
 *   pan_t = +1  -> hard right
 *
 * Equal-power crossfade (energy-preservation):
 *   leftGain  = sqrt((1 - pan_t) / 2)
 *   rightGain = sqrt((1 + pan_t) / 2)
 *   -> leftGain^2 + rightGain^2 = 1
 *
 * Mono-Source:
 *   monoMix = input[i]
 * Stereo-Source (oder mehr Channels):
 *   monoMix = (input_left[i] + input_right[i]) / 2
 *   (das zerstoert das Input-Stereo-Image absichtlich -- AutoPan ist als
 *    "platzier-mono-im-stereo-Raum" definiert, nicht als "rotiere existierendes Stereo".)
 *
 * Output:
 *   output_left[i]  = monoMix[i] * leftGain
 *   output_right[i] = monoMix[i] * rightGain
 *
 * Output ist immer 2-channel (auch wenn Input mono war).
 *
 * --- Wichtige Designentscheidungen -------------------------------------
 *
 * 1) depth=0 ist NICHT identity (im Gegensatz zu Tremolo).  Bei pan_t=0 ist
 *    leftGain=rightGain=sqrt(0.5)~0.7071.  Output L == R, beide auf ca.
 *    70.7% des monoMix-Pegels.  Das ist gewollt: equal-power-center.
 *
 * 2) Stereo-Input -> mono-Downmix bevor neu gepanned wird.  Das vernichtet
 *    das Input-Stereo-Image absichtlich (AutoPan ist nicht "rotate
 *    existing stereo").
 *
 * 3) Output IMMER 2-channel (numberOfChannels=2), auch bei mono input.
 *    Ausnahme: empty buffer -> numberOfChannels=0 (degenerat).
 *
 * 4) LFO-Phase SHARED ueber Channels (egal ob input mono oder stereo).
 *    Es gibt keinen pro-Channel-State (kein Delay-Buffer, kein Feedback).
 *
 * --- Defensive Defaults ------------------------------------------------
 *
 * - rateHz   NaN/-Infinity/<=0   -> 0.5  (Default).
 *            >20 (inkl. +Infinity) -> 20 (Clamp).
 *            Die API-JSDoc-Range 0.05..10 ist die empfohlene musikalische
 *            Range; der Runtime-Clamp ist groesser (bis 20).
 * - depth    undefined           -> 1.0  (Default = full L-R).
 *            NaN                 -> 0    (kein pan, equal-power center).
 *            <0 (inkl. -Infinity)-> 0    (kein pan).
 *            >1 (inkl. +Infinity)-> 1    (Clamp = max-pan).
 * - waveform unknown / undefined -> "sine".
 *
 * Empty buffer (length=0 || numberOfChannels=0) -> empty AudioBufferLike
 * mit numberOfChannels=0 (Tremolo-Konvention, "2-channel empty" waere
 * degenerat).  Input wird nie mutiert.  Output-Laenge == Input-Laenge.
 *
 * --- Finiteness --------------------------------------------------------
 *
 * AutoPan ist eine reine Multiply-Operation (gain * monoMix).  Es gibt keine
 * IIR-Schleife und keinen Feedback-Pfad.  Solange Input finite ist, ist
 * Output garantiert finite.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Konstanten -------------------------------------------------------------

const DEFAULT_RATE_HZ = 0.5;
const DEFAULT_DEPTH = 1.0;
const DEFAULT_WAVEFORM: AutoPanWaveform = "sine";

const MAX_RATE_HZ = 20;

// --- Public Types -----------------------------------------------------------

export type AutoPanWaveform = "sine" | "triangle" | "square";

export interface AutoPanOptions {
  /**
   * LFO-Rate in Hz.  Empfohlene musikalische Range 0.05..10.  Runtime-Clamp
   * faengt bei >20 (Defensive) bzw. <=0 (-> Default) ab.  Default 0.5.
   */
  rateHz?: number;
  /**
   * Pan-Tiefe 0..1.  0 = kein pan (equal-power center, L == R),
   * 1 = full L-R-Schwingung.  Default 1.
   */
  depth?: number;
  /** LFO-Waveform.  Default "sine". */
  waveform?: AutoPanWaveform;
}

// --- Helpers (intern) -------------------------------------------------------

function sanitizeRate(v: number | undefined): number {
  if (v === undefined) return DEFAULT_RATE_HZ;
  if (Number.isNaN(v)) return DEFAULT_RATE_HZ;
  if (v <= 0) return DEFAULT_RATE_HZ; // faengt auch -Infinity ab
  if (v > MAX_RATE_HZ) return MAX_RATE_HZ; // faengt +Infinity ab
  return v;
}

function sanitizeDepth(v: number | undefined): number {
  if (v === undefined) return DEFAULT_DEPTH;
  // +Infinity ist >1 -> clamp to 1; NaN faellt durch beide Vergleiche und
  // wird per Number.isNaN gefangen; -Infinity ist <0 -> 0.
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sanitizeWaveform(v: AutoPanWaveform | string | undefined): AutoPanWaveform {
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

/** Bipolar LFO value at time t (seconds), result in [-1, +1]. */
function lfoValue(waveform: AutoPanWaveform, t: number, rateHz: number): number {
  switch (waveform) {
    case "sine": {
      return Math.sin(2 * Math.PI * rateHz * t);
    }
    case "triangle": {
      const phase = ((rateHz * t) % 1 + 1) % 1;
      // phase=0    -> -1
      // phase=0.25 ->  0
      // phase=0.5  -> +1
      // phase=0.75 ->  0
      // phase=1    -> -1
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    }
    case "square": {
      const phase = ((rateHz * t) % 1 + 1) % 1;
      return phase < 0.5 ? 1 : -1;
    }
  }
}

// --- Public API -------------------------------------------------------------

/**
 * Wendet einen Stereo-AutoPan-Effekt auf einen Sample-Buffer an.
 *
 * Algorithmus:
 *   1) Empty buffer -> empty result (numberOfChannels=0).
 *   2) monoMix-Quelle berechnen: bei numberOfChannels===1 ist monoMix
 *      direkt ch[0]; bei numberOfChannels>=2 ist monoMix=(L+R)/2.
 *      (Hoehere Channels werden ignoriert -- sinnvolle Stereo-Quelle ist
 *      L+R; alles drueber waere ein Surround-Mix den AutoPan nicht
 *      sinnvoll handhaben kann.)
 *   3) Pro Sample i:
 *        lfo_t = LFO(waveform, i/sampleRate, rateHz)   in [-1, +1]
 *        pan_t = depth * lfo_t                          in [-depth, +depth]
 *        leftGain  = sqrt((1 - pan_t) / 2)
 *        rightGain = sqrt((1 + pan_t) / 2)
 *        outL[i] = monoMix[i] * leftGain
 *        outR[i] = monoMix[i] * rightGain
 *   4) Output ist IMMER 2-channel.
 *
 * Defensive: NaN/out-of-range Optionen fallen auf Defaults zurueck oder
 * werden geclamped (siehe Modul-JSDoc).  Input wird nie mutiert.  Liefert
 * AudioBufferLike mit Laenge == Input-Laenge und numberOfChannels==2.
 *
 * Edge-Case empty: empty input -> empty output mit numberOfChannels=0.
 */
export function applyAutoPan(
  buffer: AudioBufferLike,
  opts: AutoPanOptions = {},
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

  // monoMix-Quelle: bei mono direkt L, bei stereo+ (L+R)/2 als downmix.
  // Wir KOPIEREN bewusst in ein eigenes Float32Array, damit der Input nie
  // mutiert wird und damit die Schleife pro Sample nur 1 Array-Lookup hat.
  const monoMix = new Float32Array(len);
  if (numCh === 1) {
    const src = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) monoMix[i] = src[i];
  } else {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    for (let i = 0; i < len; i++) monoMix[i] = (L[i] + R[i]) * 0.5;
  }

  const outL = new Float32Array(len);
  const outR = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const lfo = lfoValue(waveform, t, rateHz);
    const pan = depth * lfo; // in [-depth, +depth]
    // Equal-power crossfade.  pan in [-1, +1] -> (1-pan)/2 in [0,1].
    const leftGain = Math.sqrt((1 - pan) / 2);
    const rightGain = Math.sqrt((1 + pan) / 2);
    outL[i] = monoMix[i] * leftGain;
    outR[i] = monoMix[i] * rightGain;
  }

  return wrapBuffer([outL, outR], sampleRate);
}

/**
 * Vorgefertigte AutoPan-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:   langsam, geringe Tiefe (Background-Bewegung)
 * - classic:  Default-AutoPan (mittlere Rate, hohe Tiefe)
 * - fast:     schnelle Triangle-Modulation
 * - trance:   harte square-Modulation (rhythmischer Ping-Pong)
 */
export const AUTOPAN_PRESETS = {
  subtle: { rateHz: 0.2, depth: 0.4, waveform: "sine" },
  classic: { rateHz: 0.5, depth: 0.7, waveform: "sine" },
  fast: { rateHz: 2, depth: 1, waveform: "triangle" },
  trance: { rateHz: 0.5, depth: 1, waveform: "square" },
} as const;
