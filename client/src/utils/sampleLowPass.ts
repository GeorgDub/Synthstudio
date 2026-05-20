/**
 * Synthstudio – sampleLowPass.ts (v3.198.0)
 *
 * Pure-Helper für One-Pole-Lowpass-Filter:
 *
 *   alpha = 1 - exp(-2π · cutoffHz / sampleRate)
 *   y[n]  = alpha · x[n] + (1 - alpha) · y[n-1]
 *
 * Klassischer Single-Pole-IIR-Tiefpass mit -6 dB/Oct Steigung — billigster
 * frequency-dependent Smoother. Per-Channel mit frischem State (kein
 * State-Sharing zwischen L/R). Optional ein simpler Resonance-Boost im
 * Bereich der Cutoff-Frequenz (resonance·6 dB) — kein echter biquad/SVF,
 * sondern eine einfache parallele Peak-Bumper für UI-Feedback ohne dass
 * der Helper komplex wird.
 *
 * Foundation für Tone-Knob im SampleTransformDialog + dunkle/helle Pad-FX
 * im SampleBrowser. Analyse-Pendant existiert noch nicht (spectral-centroid
 * deckt Helligkeits-Analyse anders ab).
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - empty / null Buffer → empty AudioBufferLike (fallback sampleRate=48000)
 * - cutoffHz ≤ 0 / NaN / undefined → 2000 Hz (Musikalisch zentriert)
 * - cutoffHz > sampleRate/2          → sampleRate/2 (Nyquist-Clamp)
 * - resonance ≤ 0 / NaN / undefined  → 0  (kein Boost)
 * - resonance > 1                    → 1  (Soft-Cap @ +6 dB)
 * - Per Channel frischer y[n-1]=0 — kein Cross-Channel-Coupling
 * - Input wird nie mutiert; alle Writes in fresh Float32Arrays
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-low-pass.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface LowPassOptions {
  /** Cutoff-Frequenz in Hz. Default 2000. */
  cutoffHz?: number;
  /** Resonance 0..1 — fügt bis zu +6 dB Boost um die Cutoff hinzu. Default 0. */
  resonance?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_CUTOFF_HZ = 2000;
export const DEFAULT_RESONANCE = 0;
const MIN_RESONANCE = 0;
const MAX_RESONANCE = 1;
const RESONANCE_BOOST_DB = 6;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function resolveCutoff(value: number | undefined, sampleRate: number): number {
  // undefined / non-number / NaN / Infinity / ≤0 → default
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
 * Wendet ein one-pole Lowpass-Filter auf den Buffer an. Gibt einen NEUEN
 * Buffer zurück (Input wird nicht mutiert). Jeder Channel hat frischen
 * Filter-State (y[n-1]=0 zu Beginn).
 *
 * Edge-Cases:
 *   - empty / null buffer    → empty buffer (gleiche shape signature)
 *   - cutoffHz ≥ Nyquist     → near-identity (alpha sehr nahe 1)
 *   - cutoffHz sehr klein    → starkes Smoothing, viel hohe-Frequenz-Energie weg
 *   - resonance > 0          → parallele +resonance·6dB Boost-Komponente
 */
export function applyLowPass(
  buffer: AudioBufferLike,
  options: LowPassOptions = {},
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

  // alpha = 1 - exp(-2π · fc / fs)
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  const oneMinusAlpha = 1 - alpha;

  // Resonance peak boost factor (linear gain at the cutoff region).
  // resonance=0 → 1 (kein Boost), resonance=1 → +6 dB ≈ 2.0.
  const boostLinear = resonance > 0 ? dbToLinear(resonance * RESONANCE_BOOST_DB) : 1;
  const boostMix = resonance > 0 ? resonance : 0;

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    let yPrev = 0; // fresh per channel

    for (let i = 0; i < len; i++) {
      const x = src[i];
      // One-pole low-pass:
      const y = alpha * x + oneMinusAlpha * yPrev;
      yPrev = y;

      if (boostMix > 0) {
        // Simple band-emphasis: high-frequency component (x - y) scaled by
        // boost and mixed in. Adds peak-like energy near cutoff without
        // requiring a real biquad. At resonance=0 this term is zero.
        const band = x - y;
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
 * Curated Presets von dunkel/dumpf bis hell/offen. Stable Order für
 * Dropdown-Rendering. Resonance bewusst 0 — die meisten Use-Cases wollen
 * sauber gefiltertes Audio, nicht resonante Sweeps.
 */
export const LOWPASS_PRESETS: readonly {
  id: string;
  name: string;
  cutoffHz: number;
  resonance: number;
}[] = [
  { id: "muffled", name: "Muffled", cutoffHz: 500, resonance: 0 },
  { id: "warm", name: "Warm", cutoffHz: 1500, resonance: 0 },
  { id: "bright", name: "Bright", cutoffHz: 5000, resonance: 0 },
  { id: "open", name: "Open", cutoffHz: 10000, resonance: 0 },
];
