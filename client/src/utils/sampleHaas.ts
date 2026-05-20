/**
 * Synthstudio - sampleHaas.ts (v3.223.0)
 *
 * Pure-Helper fuer den Haas-Effekt (Stereo-Widening via kurze L/R-Delay).
 *
 * Der Haas-Effekt (auch Precedence-Effekt) nutzt eine Verzoegerung von
 * 5-30 ms zwischen den beiden Stereo-Kanaelen, um eine breite,
 * "outside-the-headphones" Stereoabbildung zu erzeugen, ohne dass das
 * menschliche Gehoer den Delay als getrenntes Echo wahrnimmt.
 *
 * --- DSP-Modell --------------------------------------------------------
 *
 * 1) Mono-Quelle: input wird in beide Stereo-Kanaele kopiert.
 *    Stereo-Quelle: (L+R)/2 wird in beide Kanaele kopiert, damit der
 *    Haas-Trick auf einer monophonen Quelle wirkt (sonst wuerde die
 *    Phase-Beziehung des Inputs den Effekt verwaessern).
 * 2) Ein Channel ("side") wird verzoegert: erste N Samples (= delayMs *
 *    sampleRate / 1000) sind 0, danach folgt das verschobene Signal.
 *    Der andere Channel bleibt unveraendert (immediate).
 * 3) Output ist IMMER 2-channel, gleiche Laenge wie Input (das Ende des
 *    delayed-Channels wird abgeschnitten -- das ist Haas-Konvention,
 *    weil 30 ms am Ende keinen wahrnehmbaren Verlust darstellen).
 *
 * Beispiel (delayMs=15, side="right", sampleRate=48000):
 *   delaySamples = 720
 *   outL[i] = monoMix[i]                       fuer alle i
 *   outR[i] = 0                                fuer i < 720
 *   outR[i] = monoMix[i - 720]                 fuer i >= 720
 *
 * --- Defensive Defaults ------------------------------------------------
 *
 * - delayMs NaN/<=0                    -> 15 (Haas-Classic).
 *           >50 (inkl. +Infinity)      -> 50 (Clamp, hartes Maximum).
 *           Die Spec-Range 1..40 ist die musikalische Empfehlung; der
 *           Runtime-Clamp geht etwas weiter (bis 50) damit Audio-Code
 *           nicht abstuerzt, aber 50 ms wird hoerbar als Echo wahrgenommen.
 * - side unbekannt / undefined          -> "right".
 *
 * Empty buffer (length=0 || numberOfChannels=0) -> empty AudioBufferLike
 * mit numberOfChannels=0.  Input wird nie mutiert.  Output-Laenge ==
 * Input-Laenge.
 *
 * --- Finiteness --------------------------------------------------------
 *
 * Haas ist eine reine Sample-Copy/Shift-Operation -- kein Multiply,
 * kein Feedback.  Solange Input finite ist, ist Output garantiert finite.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Konstanten -------------------------------------------------------------

const DEFAULT_DELAY_MS = 15;
const DEFAULT_SIDE: HaasSide = "right";

const MAX_DELAY_MS = 50;

// --- Public Types -----------------------------------------------------------

export type HaasSide = "left" | "right";

export interface HaasOptions {
  /**
   * Delay in Millisekunden (1..40 musikalische Empfehlung).  Runtime-Clamp
   * faengt bei >50 (Defensive) bzw. <=0 (-> Default) ab.  Default 15.
   */
  delayMs?: number;
  /**
   * Welcher Channel verzoegert wird.  "right" = Rechter Channel ist delayed,
   * Linker ist immediate (klassische Haas-Variante).  "left" = umgekehrt.
   * Default "right".
   */
  side?: HaasSide;
}

// --- Helpers (intern) -------------------------------------------------------

function sanitizeDelayMs(v: number | undefined): number {
  if (v === undefined) return DEFAULT_DELAY_MS;
  if (Number.isNaN(v)) return DEFAULT_DELAY_MS;
  if (v <= 0) return DEFAULT_DELAY_MS; // faengt auch -Infinity ab
  if (v > MAX_DELAY_MS) return MAX_DELAY_MS; // faengt +Infinity ab
  return v;
}

function sanitizeSide(v: HaasSide | string | undefined): HaasSide {
  if (v === "left" || v === "right") return v;
  return DEFAULT_SIDE;
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

// --- Public API -------------------------------------------------------------

/**
 * Wendet den Haas-Stereo-Widening-Effekt auf einen Sample-Buffer an.
 *
 * Algorithmus:
 *   1) Empty buffer -> empty result (numberOfChannels=0).
 *   2) monoMix-Quelle berechnen: bei numberOfChannels===1 ist monoMix
 *      direkt ch[0]; bei numberOfChannels>=2 ist monoMix=(L+R)/2.
 *      (Stereo-Quelle wird zu mono ge-downmixed, damit der Haas-Effekt
 *      auf einer monophonen Quelle wirkt.)
 *   3) delaySamples = floor(delayMs * sampleRate / 1000).
 *   4) immediate-channel[i] = monoMix[i] fuer alle i.
 *      delayed-channel[i]   = 0 fuer i < delaySamples,
 *                             monoMix[i - delaySamples] sonst.
 *   5) Output ist IMMER 2-channel.
 *
 * Defensive: NaN/out-of-range Optionen fallen auf Defaults zurueck oder
 * werden geclamped.  Input wird nie mutiert.  Liefert AudioBufferLike
 * mit Laenge == Input-Laenge und numberOfChannels==2.
 *
 * Edge-Case empty: empty input -> empty output mit numberOfChannels=0.
 * Edge-Case delaySamples >= len: delayed-channel ist komplett 0.
 */
export function applyHaas(
  buffer: AudioBufferLike,
  opts: HaasOptions = {},
): AudioBufferLike {
  const delayMs = sanitizeDelayMs(opts.delayMs);
  const side = sanitizeSide(opts.side);

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

  // monoMix-Quelle berechnen.  KOPIEREN bewusst in eigenes Float32Array,
  // damit Input nie mutiert wird.
  const monoMix = new Float32Array(len);
  if (numCh === 1) {
    const src = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) monoMix[i] = src[i];
  } else {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    for (let i = 0; i < len; i++) monoMix[i] = (L[i] + R[i]) * 0.5;
  }

  // Delay-Samples = floor(delayMs * sampleRate / 1000).  Floor weil wir
  // ganze Samples brauchen; sub-Sample-Interpolation ist fuer Haas
  // ueberfluessig (5-30 ms sind weit ueber Single-Sample-Aufloesung).
  const delaySamples = Math.floor((delayMs * sampleRate) / 1000);

  const outL = new Float32Array(len);
  const outR = new Float32Array(len);

  if (side === "right") {
    // L = immediate, R = delayed
    for (let i = 0; i < len; i++) {
      outL[i] = monoMix[i];
      if (i >= delaySamples) outR[i] = monoMix[i - delaySamples];
      // else outR[i] bleibt 0 (Float32Array-Default)
    }
  } else {
    // side === "left": L = delayed, R = immediate
    for (let i = 0; i < len; i++) {
      outR[i] = monoMix[i];
      if (i >= delaySamples) outL[i] = monoMix[i - delaySamples];
      // else outL[i] bleibt 0
    }
  }

  return wrapBuffer([outL, outR], sampleRate);
}

/**
 * Vorgefertigte Haas-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:      5 ms Delay right (sanftes Widening, kaum hoerbar als Effekt)
 * - classic:    15 ms Delay right (Standard-Haas, deutliches Widening)
 * - wide:       25 ms Delay right (extremes Widening, knapp unter Echo-Schwelle)
 * - reverseWide: 25 ms Delay left (Wide-Variante, anderer Channel verzoegert)
 */
export const HAAS_PRESETS = {
  subtle: { delayMs: 5, side: "right" },
  classic: { delayMs: 15, side: "right" },
  wide: { delayMs: 25, side: "right" },
  reverseWide: { delayMs: 25, side: "left" },
} as const;
