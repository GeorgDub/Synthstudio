/**
 * Synthstudio – sampleBandPass.ts (v3.201.0)
 *
 * Pure-Helper für Band-Pass-Filter — Pendant zu sampleLowPass (v3.198)
 * und sampleHighPass (v3.199). Realisiert als Cascade aus High-Pass und
 * Low-Pass:
 *
 *   lowCutoff  = centerHz + bandwidthHz/2     (clamped ≤ Nyquist)
 *   highCutoff = max(1, centerHz - bandwidthHz/2)
 *   bandpassed = applyLowPass(applyHighPass(buffer, highCutoff), lowCutoff)
 *
 * Mit resonance > 0 wird die Band-Komponente parallel zum Signal gemixt —
 * (bandpassed) · boost · mix on top of the bandpassed result selbst (analog
 * zu den Peak-Bumpern in LowPass / HighPass).
 *
 * Foundation für Telephone / Vocal-Presence / Resonant-Sweep Pad-FX im
 * SampleBrowser + Mid-Range-Knob im SampleTransformDialog.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - empty / null Buffer            → empty AudioBufferLike (fallback sampleRate=48000)
 * - centerHz ≤ 0 / NaN / Infinity  → 1000 Hz
 * - centerHz > Nyquist             → sampleRate/2
 * - bandwidthHz ≤ 0 / NaN / Inf    → 500 Hz
 * - bandwidthHz < 10               → 10 Hz (Minimum, sehr resonant)
 * - bandwidthHz > Nyquist          → sampleRate/2
 * - resonance ≤ 0 / NaN / undef    → 0 (kein Boost)
 * - resonance > 1                  → 1 (Soft-Cap @ +6 dB)
 * - Input wird nie mutiert; alle Writes in fresh Float32Arrays
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-band-pass.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";
import { applyHighPass } from "./sampleHighPass";
import { applyLowPass } from "./sampleLowPass";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface BandPassOptions {
  /** Center-Frequenz in Hz. Default 1000. Clamped auf [1, sampleRate/2]. */
  centerHz?: number;
  /** Bandbreite in Hz. Default 500. Clamped auf [10, sampleRate/2]. */
  bandwidthHz?: number;
  /** Resonance 0..1 — fügt bis zu +6 dB Boost auf das Band hinzu. Default 0. */
  resonance?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_CENTER_HZ = 1000;
export const DEFAULT_BANDWIDTH_HZ = 500;
export const DEFAULT_RESONANCE = 0;
const MIN_BANDWIDTH_HZ = 10;
const MIN_RESONANCE = 0;
const MAX_RESONANCE = 1;
const RESONANCE_BOOST_DB = 6;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function resolveCenter(value: number | undefined, sampleRate: number): number {
  if (value === undefined || value === null) return DEFAULT_CENTER_HZ;
  if (typeof value !== "number") return DEFAULT_CENTER_HZ;
  if (!Number.isFinite(value)) return DEFAULT_CENTER_HZ;
  if (value <= 0) return DEFAULT_CENTER_HZ;
  const nyquist = sampleRate / 2;
  if (value > nyquist) return nyquist;
  return value;
}

function resolveBandwidth(value: number | undefined, sampleRate: number): number {
  if (value === undefined || value === null) return DEFAULT_BANDWIDTH_HZ;
  if (typeof value !== "number") return DEFAULT_BANDWIDTH_HZ;
  if (!Number.isFinite(value)) return DEFAULT_BANDWIDTH_HZ;
  if (value <= 0) return DEFAULT_BANDWIDTH_HZ;
  const nyquist = sampleRate / 2;
  if (value < MIN_BANDWIDTH_HZ) return MIN_BANDWIDTH_HZ;
  if (value > nyquist) return nyquist;
  return value;
}

function resolveResonance(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_RESONANCE;
  if (typeof value !== "number") return DEFAULT_RESONANCE;
  if (!Number.isFinite(value)) return DEFAULT_RESONANCE;
  if (value < MIN_RESONANCE) return MIN_RESONANCE;
  if (value > MAX_RESONANCE) return MAX_RESONANCE;
  return value;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet ein Band-Pass-Filter via Cascade (HighPass → LowPass) auf den Buffer
 * an. Gibt einen NEUEN Buffer zurück (Input wird nicht mutiert). Jeder Channel
 * hat frischen Filter-State.
 *
 * Edge-Cases:
 *   - empty / null buffer    → empty buffer
 *   - centerHz < bandwidth/2 → highCutoff clamped auf 1 Hz (sehr weiter Pass)
 *   - centerHz + bw/2 ≥ Ny   → lowCutoff clamped auf Nyquist (kein Top-Cut)
 *   - resonance > 0          → parallele bandpass·6dB-Boost-Komponente
 */
export function applyBandPass(
  buffer: AudioBufferLike,
  options: BandPassOptions = {},
): AudioBufferLike {
  const sampleRate = buffer?.sampleRate ?? 48000;
  const chCount = buffer?.numberOfChannels ?? 0;
  const len = buffer?.length ?? 0;

  // Empty-Buffer-Shortcut
  if (!buffer || len === 0 || chCount === 0) {
    return {
      sampleRate,
      numberOfChannels: chCount,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  const centerHz = resolveCenter(options.centerHz, sampleRate);
  const bandwidthHz = resolveBandwidth(options.bandwidthHz, sampleRate);
  const resonance = resolveResonance(options.resonance);

  const nyquist = sampleRate / 2;
  const rawLow = centerHz + bandwidthHz / 2;
  const rawHigh = centerHz - bandwidthHz / 2;
  const lowCutoff = Math.min(nyquist, rawLow);
  const highCutoff = Math.max(1, rawHigh);

  // Cascade: HighPass first, then LowPass — both resonance=0 (the band-emphasis
  // is applied separately on top of the cascade output, not via per-stage
  // resonance, to keep the response predictable).
  const hp = applyHighPass(buffer, { cutoffHz: highCutoff, resonance: 0 });
  const bandpassed = applyLowPass(hp, { cutoffHz: lowCutoff, resonance: 0 });

  if (resonance <= 0) {
    return bandpassed;
  }

  // Parallel boost: out = bandpassed + bandpassed · (boostLinear - 1) · mix
  //                     = bandpassed · (1 + (boostLinear-1) · mix)
  // This is mathematically equivalent to a scalar gain on the bandpassed
  // output, but the explicit channel loop keeps the structure symmetric with
  // the LowPass/HighPass implementations and makes the per-channel immutability
  // obvious.
  const boostLinear = dbToLinear(resonance * RESONANCE_BOOST_DB);
  const boostMix = resonance;
  const gain = 1 + (boostLinear - 1) * boostMix;

  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = bandpassed.getChannelData(c);
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      dst[i] = src[i] * gain;
    }
    channels.push(dst);
  }

  return {
    sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) {
        throw new RangeError(`channel ${c} out of range (0..${chCount - 1})`);
      }
      return channels[c];
    },
  };
}

// ─── Presets ─────────────────────────────────────────────────────────────────

/**
 * Curated Presets: Telephone (lo-fi), Vocal-Presence (3 kHz Boost-Band),
 * Bass (sub-low Resonance-Pocket), Resonant (schmaler 800 Hz Peak).
 * Stable Order für Dropdown-Rendering.
 */
export const BANDPASS_PRESETS = {
  telephone: { centerHz: 1500, bandwidthHz: 2000 },
  vocalPresence: { centerHz: 3000, bandwidthHz: 2000 },
  bass: { centerHz: 200, bandwidthHz: 200 },
  resonant: { centerHz: 800, bandwidthHz: 100 },
} as const;
