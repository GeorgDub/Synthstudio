/**
 * Synthstudio – sampleRingMod.ts (v3.213.0)
 *
 * Pure-Helper fuer einen Ring-Modulation-Effekt: Signal x Sine-Carrier.
 *
 * ─── Modell ─────────────────────────────────────────────────────────────────
 *
 * Klassische Ring-Modulation multipliziert das Signal Sample-fuer-Sample mit
 * einem Sinus-Carrier:
 *
 *   t          = i / sampleRate                               // Zeit in s
 *   carrier_t  = sin(2*PI * carrierHz * t)                    // [-1..1] bipolar
 *   wet[i]     = input[i] * carrier_t                         // RingMod-Output
 *   output[i]  = mix * wet[i] + (1 - mix) * input[i]          // Dry/Wet-Blend
 *
 * Bei mix=0 ist output[i] = input[i] -> identity (dry).
 * Bei mix=1 ist output[i] = input[i] * carrier_t -> full ring mod.
 *
 * Im Gegensatz zur Tremolo-Implementation (v3.207) ist der Carrier hier
 * BIPOLAR — das ist die Definition von Ring-Modulation und produziert die
 * charakteristischen Glocken-/Alien-/Metallic-Klaenge durch
 * Spektrum-Verschiebung (Summe + Differenz der Frequenzen).
 *
 * ─── Carrier-Phase pro Channel ──────────────────────────────────────────────
 *
 * SHARED CARRIER ueber alle Channels — Stereo-Sample mit identischen Channels
 * liefert identischen Output (analog Tremolo/Vibrato). Es gibt keinen
 * pro-Channel-State.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - carrierHz  NaN/non-finite/<=0 -> 440 (A4 — musikalischer Default)
 *              >20000             -> 20000 (Nyquist-Limit fuer 40k+ Sample-Rates)
 * - mix        NaN/non-finite/<0  -> 0 (dry)
 *              >1                 -> 1 (full wet)
 *              undefined          -> 1 (full ring mod — siehe Spec)
 *
 * Empty buffer -> empty output (numberOfChannels=0).  Input wird nie mutiert.
 * Output-Laenge == Input-Laenge.
 *
 * ─── Finiteness ─────────────────────────────────────────────────────────────
 *
 * Ring-Modulation ist ein einfacher Multiply-Operator (carrier_t * input[i]).
 * Solange input finite ist, ist output finite. Keine IIR-Stabilitaets-Probleme.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_CARRIER_HZ = 440;
const DEFAULT_MIX = 1;

const MIN_CARRIER_HZ = 1;
const MAX_CARRIER_HZ = 20000;

const FALLBACK_SAMPLE_RATE = 48000;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface RingModOptions {
  /** Carrier-Frequenz in Hz (1..20000 erlaubt). Default 440 (A4). */
  carrierHz?: number;
  /** Dry/Wet-Mix (0..1). Default 1 = full ring mod. 0 = identity. */
  mix?: number;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

function sanitizeCarrier(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_CARRIER_HZ;
  if (v < MIN_CARRIER_HZ) return DEFAULT_CARRIER_HZ;
  if (v > MAX_CARRIER_HZ) return MAX_CARRIER_HZ;
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
 * Wendet einen Ring-Modulation-Effekt (Signal x Sine-Carrier) auf einen
 * Sample-Buffer an.
 *
 * Algorithmus: pro Sample wird ein Sinus-Carrier in [-1..1] berechnet:
 *   carrier_t = sin(2*PI * carrierHz * i / sampleRate)
 *   wet       = input[i] * carrier_t
 *   output[i] = mix * wet + (1 - mix) * input[i]
 *
 * Carrier-Phase ist SHARED ueber Channels (kein pro-Channel-State).
 *
 * Defensive: NaN / out-of-range Optionen fallen auf Defaults zurueck oder
 * werden geclamped (siehe Modul-JSDoc).  Empty buffer -> empty output.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl & Laenge wie input.
 */
export function applyRingMod(
  buffer: AudioBufferLike,
  opts: RingModOptions = {},
): AudioBufferLike {
  const carrierHz = sanitizeCarrier(opts.carrierHz);
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
  const omega = (2 * Math.PI * carrierHz) / sampleRate;

  // Pre-compute carrier values once (shared across channels)
  const carrier = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    carrier[i] = Math.sin(omega * i);
  }

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const wet = dry[i] * carrier[i];
      out[i] = mix * wet + oneMinusMix * dry[i];
    }
    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Ring-Mod-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - bell:     Glockenartig (hoher Carrier @ 880, kraeftiger Mix 0.8)
 * - alien:    Alien-FX (1500 Hz Carrier, full ring mod)
 * - metallic: Metallischer Klang (600 Hz Carrier, mittlerer Mix)
 * - bass:     Bass-Bereich Modulation (100 Hz Carrier, halber Mix)
 */
export const RINGMOD_PRESETS = {
  bell: { carrierHz: 880, mix: 0.8 },
  alien: { carrierHz: 1500, mix: 1 },
  metallic: { carrierHz: 600, mix: 0.7 },
  bass: { carrierHz: 100, mix: 0.5 },
} as const;
