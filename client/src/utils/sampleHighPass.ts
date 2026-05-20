/**
 * Synthstudio – sampleHighPass.ts (v3.199.0)
 *
 * Pure-Helper für One-Pole-Highpass-Filter — Pendant zu sampleLowPass (v3.198).
 *
 *   alpha = exp(-2π · cutoffHz / sampleRate)
 *   y[n]  = alpha · (y[n-1] + x[n] - x[n-1])
 *
 * Klassisches Single-Pole-IIR-Highpass mit -6 dB/Oct unterhalb der Cutoff.
 * DC-Input → y[n] → 0 (vollständige DC-Eliminierung). Sub-Cutoff-Energie
 * attenuiert, oberhalb Cutoff fast pass-through. Per-Channel mit frischem
 * State (y[n-1]=x[n-1]=0 zu Beginn; kein Cross-Channel-Coupling).
 *
 * Optional ein simpler Resonance-Boost im Bereich der Cutoff-Frequenz —
 * realisiert über parallele Band-Komponente (y - lowpassed(y)) · boost · mix.
 * Kein echter biquad/SVF, sondern eine billige Peak-Emphasis für UI-Feedback.
 *
 * Foundation für Rumble-Removal / Air-Knob im SampleTransformDialog +
 * Vocal-Cleanup-Pad-FX im SampleBrowser.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - empty / null Buffer        → empty AudioBufferLike (fallback sampleRate=48000)
 * - cutoffHz ≤ 0 / NaN / undef → 200 Hz (typische Rumble-Removal)
 * - cutoffHz > sampleRate/2    → sampleRate/2 (Nyquist-Clamp)
 * - resonance ≤ 0 / NaN / undef → 0 (kein Boost)
 * - resonance > 1              → 1 (Soft-Cap @ +6 dB)
 * - Per Channel frischer y[n-1]=x[n-1]=0 — kein Cross-Channel-Coupling
 * - Input wird nie mutiert; alle Writes in fresh Float32Arrays
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-high-pass.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface HighPassOptions {
  /** Cutoff-Frequenz in Hz. Default 200. Clamped auf [1, sampleRate/2]. */
  cutoffHz?: number;
  /** Resonance 0..1 — fügt bis zu +6 dB Boost um die Cutoff hinzu. Default 0. */
  resonance?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_CUTOFF_HZ = 200;
export const DEFAULT_RESONANCE = 0;
const MIN_RESONANCE = 0;
const MAX_RESONANCE = 1;
const RESONANCE_BOOST_DB = 6;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function resolveCutoff(value: number | undefined, sampleRate: number): number {
  if (value === undefined || value === null) return DEFAULT_CUTOFF_HZ;
  if (typeof value !== "number") return DEFAULT_CUTOFF_HZ;
  if (!Number.isFinite(value)) return DEFAULT_CUTOFF_HZ;
  if (value <= 0) return DEFAULT_CUTOFF_HZ;
  const nyquist = sampleRate / 2;
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
 * Wendet ein one-pole Highpass-Filter auf den Buffer an. Gibt einen NEUEN
 * Buffer zurück (Input wird nicht mutiert). Jeder Channel hat frischen
 * Filter-State (y[n-1]=x[n-1]=0 zu Beginn).
 *
 * Edge-Cases:
 *   - empty / null buffer    → empty buffer
 *   - cutoffHz sehr klein    → near-identity (alpha sehr nahe 1, kaum Attenuation)
 *   - cutoffHz ≥ Nyquist     → starke Attenuation aller Energie
 *   - DC-Input               → konvergiert gegen 0 (DC entfernt)
 *   - resonance > 0          → parallele +resonance·6dB Band-Emphasis
 */
export function applyHighPass(
  buffer: AudioBufferLike,
  options: HighPassOptions = {},
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

  const cutoffHz = resolveCutoff(options.cutoffHz, sampleRate);
  const resonance = resolveResonance(options.resonance);

  // One-pole highpass coefficient: alpha = exp(-2π · fc / fs)
  // y[n] = alpha · (y[n-1] + x[n] - x[n-1])
  const alpha = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);

  // Parallel low-pass for resonance band-emphasis (matches lowpass coefficient
  // shape so the peak sits roughly at cutoff).
  const lpAlpha = 1 - alpha; // = 1 - exp(-2π fc / fs)
  const lpOneMinus = 1 - lpAlpha;

  const boostLinear = resonance > 0 ? dbToLinear(resonance * RESONANCE_BOOST_DB) : 1;
  const boostMix = resonance > 0 ? resonance : 0;

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    let yPrev = 0; // fresh per channel
    let xPrev = 0; // fresh per channel
    let lpPrev = 0; // parallel low-pass state for resonance

    for (let i = 0; i < len; i++) {
      const x = src[i];

      // One-pole high-pass:
      const y = alpha * (yPrev + x - xPrev);

      yPrev = y;
      xPrev = x;

      if (boostMix > 0) {
        // Parallel low-pass on the high-passed signal y → emphasises band
        // around cutoff: (y - lowpassed(y)) · (boost-1) · mix.
        const lp = lpAlpha * y + lpOneMinus * lpPrev;
        lpPrev = lp;
        const band = y - lp;
        dst[i] = y + band * (boostLinear - 1) * boostMix;
      } else {
        dst[i] = y;
      }
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
 * Curated Presets von Sub-Rumble-Cleanup bis Air/Brightener. Stable Order
 * für Dropdown-Rendering. Resonance bewusst 0 — die meisten Cleanup-Use-Cases
 * wollen sauber gefiltertes Audio, nicht resonante Sweeps.
 */
export const HIGHPASS_PRESETS = {
  rumble: { cutoffHz: 80 },   // remove sub-bass rumble
  vocal: { cutoffHz: 100 },   // vocal cleanup
  thin: { cutoffHz: 300 },    // remove low-end
  airy: { cutoffHz: 600 },    // make airy
} as const;
