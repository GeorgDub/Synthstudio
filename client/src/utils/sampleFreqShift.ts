/**
 * Synthstudio – sampleFreqShift.ts (v3.225.0)
 *
 * Pure-Helper fuer Frequency-Shifting via "Single-Sideband-aehnliche"
 * Cos-Carrier-Multiplikation (vereinfachte Approximation).
 *
 * ─── Modell ─────────────────────────────────────────────────────────────────
 *
 * Echte SSB-Frequenz-Verschiebung (Bode Frequency Shifter) benoetigt einen
 * Hilbert-Transform, der das Signal in zwei um 90 Grad phasenversetzte
 * Versionen aufteilt. Dadurch kann die UNTERE oder OBERE Seitenband-
 * Komponente isoliert werden, sodass alle Frequenzen exakt um +shiftHz
 * verschoben werden (asymmetrisch).
 *
 * Diese Implementierung VEREINFACHT auf reine cos-Carrier-Multiplikation
 * ohne Hilbert-Transform:
 *
 *   t            = i / sampleRate                            // Zeit in s
 *   carrier_cos  = cos(2*PI * shiftHz * t)                   // [-1..1] gerade
 *   shifted[i]   = input[i] * carrier_cos                    // ring-mod
 *   output[i]    = mix * shifted[i] + (1 - mix) * input[i]   // Dry/Wet
 *
 * Effekt: jede Eingangsfrequenz f wird in zwei Seitenbaender bei (f+shiftHz)
 * UND (f-shiftHz) aufgespalten (Produkt-zu-Summen-Identitaet). Das ist
 * eigentlich Ring-Modulation (bipolarer Carrier), NICHT echte
 * Frequency-Shifting. Dokumentiert als Approximation.
 *
 * ─── Konsequenz der cos-Symmetrie ───────────────────────────────────────────
 *
 * cos ist eine GERADE Funktion: cos(x) == cos(-x). Daher gilt:
 *   applyFreqShift(buf, {shiftHz:+50}) == applyFreqShift(buf, {shiftHz:-50})
 * Sample-fuer-Sample identisch. Die Aufwaertsverschiebung und
 * Abwaertsverschiebung sind in dieser Approximation NICHT unterscheidbar
 * (Spec-Vorgabe akzeptiert das ausdruecklich).
 *
 * ─── shiftHz=0 -> Identity ──────────────────────────────────────────────────
 *
 * cos(0)=1 fuer alle Samples. wet[i] = input[i] * 1 = input[i]. Damit ist
 * output[i] = mix * input[i] + (1-mix) * input[i] = input[i].
 * shiftHz=0 ist Identity unabhaengig von mix.
 *
 * ─── Carrier-Phase pro Channel ──────────────────────────────────────────────
 *
 * SHARED CARRIER ueber alle Channels (analog Ring-Mod v3.213). Es gibt
 * keinen pro-Channel-State.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - shiftHz  undefined -> 50 (Default-Aufwaertsverschiebung)
 *            NaN / non-finite -> 0 (Identity, NICHT Default — Spec-Vorgabe
 *            "shiftHz NaN/Inf -> 0")
 *            > 5000  -> 5000 (Clamp, hartes Maximum)
 *            < -5000 -> -5000 (Clamp, hartes Minimum)
 * - mix      undefined -> 1 (Default = full wet)
 *            NaN / non-finite -> 0 (Clamp-low = dry pass-through)
 *            < 0  -> 0
 *            > 1  -> 1
 *
 * Empty buffer -> empty output (numberOfChannels=0). Input wird nie mutiert.
 * Output-Laenge == Input-Laenge. Output garantiert finite (reine
 * Multiply-Operation, kein Feedback).
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_SHIFT_HZ = 50;
const DEFAULT_MIX = 1;

const MAX_SHIFT_HZ = 5000;
const MIN_SHIFT_HZ = -5000;

const FALLBACK_SAMPLE_RATE = 48000;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface FreqShiftOptions {
  /**
   * Verschiebungs-Frequenz in Hz. Default 50.
   * Musikalischer Bereich -500..500; Runtime-Clamp -5000..5000.
   * 0 -> Identity (cos(0)=1).
   * Hinweis: Aufgrund der cos-Symmetrie liefern +n und -n IDENTISCHEN
   * Output (siehe Modul-JSDoc).
   */
  shiftHz?: number;

  /**
   * Dry/Wet-Mix (0..1). Default 1 = full wet. 0 = identity (dry).
   */
  mix?: number;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

function sanitizeShift(v: number | undefined): number {
  if (v === undefined) return DEFAULT_SHIFT_HZ;
  if (!Number.isFinite(v)) return 0;
  if (v > MAX_SHIFT_HZ) return MAX_SHIFT_HZ;
  if (v < MIN_SHIFT_HZ) return MIN_SHIFT_HZ;
  return v;
}

function sanitizeMix(v: number | undefined): number {
  if (v === undefined) return DEFAULT_MIX;
  if (!Number.isFinite(v) || v < 0) return 0;
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
 * Wendet eine Frequency-Shift-Approximation (cos-Carrier-Multiplikation)
 * auf einen Sample-Buffer an.
 *
 * Algorithmus: pro Sample wird ein cos-Carrier in [-1..1] berechnet:
 *   carrier_cos = cos(2*PI * shiftHz * i / sampleRate)
 *   shifted     = input[i] * carrier_cos
 *   output[i]   = mix * shifted + (1-mix) * input[i]
 *
 * Carrier-Phase ist SHARED ueber Channels (kein pro-Channel-State).
 *
 * Defensive: NaN/Infinity Optionen werden zu Identitaet (shiftHz=0) bzw.
 * Dry (mix=0); out-of-range Werte werden geclamped. Empty buffer -> empty.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl & Laenge wie input.
 */
export function applyFreqShift(
  buffer: AudioBufferLike,
  opts: FreqShiftOptions = {},
): AudioBufferLike {
  const shiftHz = sanitizeShift(opts.shiftHz);
  const mix = sanitizeMix(opts.mix);

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
  const omega = (2 * Math.PI * shiftHz) / sampleRate;

  // Pre-compute carrier values once (shared across channels)
  const carrier = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    carrier[i] = Math.cos(omega * i);
  }

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const shifted = dry[i] * carrier[i];
      out[i] = mix * shifted + oneMinusMix * dry[i];
    }
    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}
