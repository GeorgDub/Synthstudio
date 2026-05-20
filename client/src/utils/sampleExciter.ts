/**
 * Synthstudio - sampleExciter.ts (v3.224.0)
 *
 * Pure-Helper fuer Hochfrequenz-Anreicherung (Aural Exciter / Enhancer).
 *
 * Ein "Exciter" erzeugt zusaetzliche Obertoene auf den hohen Frequenzen
 * eines Signals: man hochpasst das Eingangssignal, jagt das Resultat
 * durch eine nichtlineare Funktion (tanh) -- die dabei entstehenden
 * Harmonics liegen oberhalb der Cutoff -- und mischt das Ergebnis zum
 * Original (DRY!) zurueck.  Das Original bleibt unangetastet, der
 * Exciter ist rein additiv.  Foundation fuer "Air"/"Presence"/"Brightener"
 * FX im SampleTransformDialog + Bulk-Exciter im SampleBrowser.
 *
 * --- DSP-Modell --------------------------------------------------------
 *
 *   wet[n] = tanh(HP(dry[n]))                 // harmonic generation
 *   out[n] = dry[n] + amount * wet[n]         // additiv zum DRY
 *
 * Der High-Pass ist ein simples one-pole IIR-Filter:
 *
 *   alpha = exp(-2*pi*freq / sampleRate)
 *   y[n]  = alpha * (y[n-1] + x[n] - x[n-1])
 *
 * (Eigene Coefficient-Berechnung -- bewusst NICHT applyHighPass importiert,
 * weil wir nur die HP'd Branch brauchen ohne Resonance, ohne Output-Wrapper.
 * Pin: minimaler Footprint, keine Allokation eines Zwischen-AudioBufferLike.)
 *
 * tanh ist die Standard-Soft-Saturation; sie ist symmetrisch (kein DC-Drift),
 * monoton, stetig differenzierbar -- und ihr Output ist garantiert in
 * [-1, +1].  Damit ist out[n] in [-1 - amount, +1 + amount]: NICHT von
 * vornherein clipped auf [-1, +1].  Spec verlangt "Output clipped +-1" als
 * nachtraegliches Soft-Cap; wir clampen die SUMME zum Schluss via
 * Math.max(-1, Math.min(1, ...)).
 *
 * --- Defensive Defaults ------------------------------------------------
 *
 * - amount NaN/<0           -> 0    (kein Exciter-Anteil)
 *          >1                -> 1
 *          undefined         -> 0.3 (Default)
 * - freq   NaN/<100          -> 3000 (Default, klassischer Air-Bereich)
 *          >20000            -> 20000 (Clamp gegen +Infinity)
 *          undefined         -> 3000
 *
 * Empty buffer (length=0 || numberOfChannels=0) -> empty AudioBufferLike
 * mit numberOfChannels=0 + fallback sampleRate=48000.  Input wird NIE
 * mutiert.  Per-Channel frischer HP-State (y[n-1]=x[n-1]=0; kein
 * Cross-Channel-Coupling).
 *
 * --- Identity-Fall ----------------------------------------------------
 *
 * amount=0 -> output ist GENAU dry (kein HP, kein tanh, kein Mix).
 * Fast-Path: einfach jede Channel-Probe kopieren.  Das ist semantisch
 * wichtig, weil Caller-UIs oft "amount=0" als "FX bypassed" interpretieren
 * und exakte Identitaet erwarten.
 *
 * --- Finiteness --------------------------------------------------------
 *
 * Solange Input finite ist:
 * - HP-Stage ist IIR mit alpha in [0,1] -> Bounded-Input-Bounded-Output.
 * - tanh() ist garantiert in [-1, +1].
 * - Multiply mit amount in [0,1] bleibt in [-1,+1].
 * - Summe dry+wet*amount bleibt finite; clamp auf [-1,+1] am Ende.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Konstanten ------------------------------------------------------------

const DEFAULT_AMOUNT = 0.3;
const DEFAULT_FREQ = 3000;

const MIN_AMOUNT = 0;
const MAX_AMOUNT = 1;

const MIN_FREQ = 100;
const MAX_FREQ = 20000;

const FALLBACK_SAMPLE_RATE = 48000;

// --- Public Types ----------------------------------------------------------

export interface ExciterOptions {
  /**
   * Mischanteil des Exciter-Signals (additiv zum Dry).
   * 0..1, default 0.3.  0 = exakt Identity (Bypass).
   */
  amount?: number;
  /**
   * High-Pass-Cutoff in Hz.  Frequenzen unterhalb werden vom
   * Saturator-Pfad ausgenommen.  500..8000 ist die musikalisch sinnvolle
   * Range; Runtime-Clamp 100..20000.  Default 3000.
   */
  freq?: number;
}

// --- Helpers (intern) -----------------------------------------------------

function sanitizeAmount(v: number | undefined): number {
  if (v === undefined) return DEFAULT_AMOUNT;
  if (typeof v !== "number") return DEFAULT_AMOUNT;
  if (Number.isNaN(v)) return MIN_AMOUNT;
  if (v < MIN_AMOUNT) return MIN_AMOUNT;
  if (v > MAX_AMOUNT) return MAX_AMOUNT;
  return v;
}

function sanitizeFreq(v: number | undefined): number {
  if (v === undefined) return DEFAULT_FREQ;
  if (typeof v !== "number") return DEFAULT_FREQ;
  if (Number.isNaN(v)) return DEFAULT_FREQ;
  if (v < MIN_FREQ) return DEFAULT_FREQ;
  if (v > MAX_FREQ) return MAX_FREQ;
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

// --- Public API -----------------------------------------------------------

/**
 * Wendet einen Aural-Exciter-Effekt auf einen Sample-Buffer an.
 *
 * Algorithmus pro Channel:
 *   1) Empty buffer -> empty result (numberOfChannels=0).
 *   2) amount=0 (nach Sanitize) -> exakte Kopie des Dry (Bypass).
 *   3) alpha = exp(-2*pi*freq / sampleRate).
 *      Per-Channel frischer State (y[n-1]=x[n-1]=0).
 *      Pro Sample:
 *        hp   = alpha * (yPrev + dry - xPrev)
 *        wet  = tanh(hp)
 *        sum  = dry + amount * wet
 *        out  = clamp(sum, -1, +1)
 *
 * Defensiv: NaN/out-of-range Optionen fallen auf Defaults zurueck oder
 * werden geclamped.  Input wird nie mutiert.
 *
 * Length-Preservation: output.length == input.length.
 * Channel-Preservation: output.numberOfChannels == input.numberOfChannels.
 */
export function applyExciter(
  buffer: AudioBufferLike,
  opts: ExciterOptions = {},
): AudioBufferLike {
  const amount = sanitizeAmount(opts.amount);
  const freq = sanitizeFreq(opts.freq);

  // empty input -> empty output
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

  const outChannels: Float32Array[] = new Array(numCh);

  // amount=0 -> exakte Kopie (Bypass-Identity, ohne HP/tanh).
  if (amount === 0) {
    for (let c = 0; c < numCh; c++) {
      const src = buffer.getChannelData(c);
      const dst = new Float32Array(len);
      for (let i = 0; i < len; i++) dst[i] = src[i];
      outChannels[c] = dst;
    }
    return wrapBuffer(outChannels, sampleRate);
  }

  // High-Pass coefficient alpha = exp(-2*pi*freq / sampleRate).
  // Bei sampleRate sehr klein oder freq nahe Nyquist wird alpha sehr klein
  // (starkes Filtering).  Bei freq << sampleRate ist alpha nahe 1
  // (sanftes Filtering, fast all-pass).
  const alpha = Math.exp((-2 * Math.PI * freq) / sampleRate);

  for (let c = 0; c < numCh; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    let yPrev = 0; // HP-State fresh per channel
    let xPrev = 0;

    for (let i = 0; i < len; i++) {
      const dry = src[i];
      // One-pole HP: y[n] = alpha*(y[n-1] + x[n] - x[n-1])
      const hp = alpha * (yPrev + dry - xPrev);
      yPrev = hp;
      xPrev = dry;

      // Harmonic generation via tanh.  Output ist garantiert in [-1, +1].
      const wet = Math.tanh(hp);

      // Additiv mischen.  Soft-Cap auf [-1, +1] am Ende.
      let sum = dry + amount * wet;
      if (sum > 1) sum = 1;
      else if (sum < -1) sum = -1;
      dst[i] = sum;
    }

    outChannels[c] = dst;
  }

  return wrapBuffer(outChannels, sampleRate);
}

// --- Presets --------------------------------------------------------------

/**
 * Vorgefertigte Exciter-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:    20% amount, 4 kHz HP -- leichter Hi-Frequency-Boost
 * - bright:    40% amount, 3 kHz HP -- klassisches "Brightener"-Setting
 * - air:       30% amount, 6 kHz HP -- top-end "Air"-Sparkle ueber 6 kHz
 * - presence:  50% amount, 2.5 kHz HP -- aggressive Vocal-Presence-Anhebung
 */
export const EXCITER_PRESETS = {
  subtle: { amount: 0.2, freq: 4000 },
  bright: { amount: 0.4, freq: 3000 },
  air: { amount: 0.3, freq: 6000 },
  presence: { amount: 0.5, freq: 2500 },
} as const;
