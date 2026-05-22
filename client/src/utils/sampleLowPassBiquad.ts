/**
 * Synthstudio – sampleLowPassBiquad.ts (v3.232.0)
 *
 * Pure-Helper für RBJ-Biquad-Lowpass-Filter (-12 dB/Oct, zwei-pol).
 *
 *   RBJ Audio EQ Cookbook — Lowpass:
 *     ω₀ = 2π · cutoffHz / sampleRate
 *     α  = sin(ω₀) / (2 · q)
 *     b0 = (1 - cos(ω₀)) / 2
 *     b1 =  1 - cos(ω₀)
 *     b2 = (1 - cos(ω₀)) / 2
 *     a0 = 1 + α
 *     a1 = -2 · cos(ω₀)
 *     a2 = 1 - α
 *
 *   Direct-Form-I-Differenzgleichung (normalisiert auf a0):
 *     y[n] = (b0/a0)·x[n] + (b1/a0)·x[n-1] + (b2/a0)·x[n-2]
 *          - (a1/a0)·y[n-1] - (a2/a0)·y[n-2]
 *
 * Steiler als die v3.198 1-pole-Variante (-6 dB/Oct) und mit echtem
 * Resonance-Peak über Q. Per-Channel mit frischem State (x[n-1]=x[n-2]=
 * y[n-1]=y[n-2]=0); kein Cross-Channel-Coupling.
 *
 * Koexistiert mit sampleLowPass.ts (1-pole) — gleiche AudioBufferLike-API,
 * unterschiedliche Filter-Topologie/Steilheit.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - empty / null Buffer        → empty AudioBufferLike (fallback sampleRate=48000)
 * - cutoffHz ≤ 0 / NaN / undef → 2000 Hz
 * - cutoffHz ≥ Nyquist         → Nyquist/2 (numerische Stabilität, RBJ wird
 *                                 instabil sehr nah an Nyquist)
 * - q ≤ 0 / NaN / undef         → 0.707 (Butterworth, max-flat)
 * - q > 50                     → 50 (Soft-Cap gegen Selbst-Oszillation)
 * - Per Channel frischer Zustand
 * - Input wird nie mutiert; alle Writes in fresh Float32Arrays
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-lowpass-biquad.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface LowPassBiquadOptions {
  /** Cutoff-Frequenz in Hz. Default 2000. */
  cutoffHz?: number;
  /** Q-Faktor (Resonanz). Default 0.707 (Butterworth). Range 0.1..50. */
  q?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_CUTOFF_HZ = 2000;
export const DEFAULT_Q = 0.707;
const MIN_Q = 0.1;
const MAX_Q = 50;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function resolveCutoff(value: number | undefined, sampleRate: number): number {
  if (value === undefined || value === null) return DEFAULT_CUTOFF_HZ;
  if (typeof value !== "number") return DEFAULT_CUTOFF_HZ;
  if (!Number.isFinite(value)) return DEFAULT_CUTOFF_HZ;
  if (value <= 0) return DEFAULT_CUTOFF_HZ;
  const nyquist = sampleRate / 2;
  if (value >= nyquist) return nyquist / 2;
  return value;
}

function resolveQ(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_Q;
  if (typeof value !== "number") return DEFAULT_Q;
  if (!Number.isFinite(value)) return DEFAULT_Q;
  if (value <= 0) return DEFAULT_Q;
  if (value < MIN_Q) return MIN_Q;
  if (value > MAX_Q) return MAX_Q;
  return value;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet einen RBJ-Biquad-Lowpass (-12 dB/Oct) auf den Buffer an. Gibt einen
 * NEUEN Buffer zurück (Input wird nicht mutiert). Jeder Channel hat frischen
 * Filter-State.
 *
 * Edge-Cases:
 *   - empty / null buffer       → empty buffer
 *   - cutoffHz nahe Nyquist     → wird auf Nyquist/2 geclampt (numerische Stab.)
 *   - cutoffHz sehr klein       → starkes Smoothing (steil -12 dB/Oct)
 *   - q = 0.707                 → Butterworth (max-flat im Pass-Band)
 *   - q hoch                    → ausgeprägter Peak bei cutoff (Resonanz)
 *   - DC-Input                  → passiert ungeändert (LP-Gain @ DC = 1)
 */
export function applyLowPassBiquad(
  buffer: AudioBufferLike,
  options: LowPassBiquadOptions = {},
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
  const q = resolveQ(options.q);

  // RBJ Biquad Lowpass Coefficients
  const omega = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);
  const alpha = sinW / (2 * q);

  const b0 = (1 - cosW) / 2;
  const b1 = 1 - cosW;
  const b2 = (1 - cosW) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;

  // Normalize on a0
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    // Per-Channel fresh state
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let i = 0; i < len; i++) {
      const x = src[i];
      const y = nb0 * x + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      dst[i] = y;
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
 * Curated Presets fuer typische Biquad-LP-Anwendungen. Im Gegensatz zur
 * 1-pole-Variante zeigt der Biquad echte Resonance-Peaks bei höheren Q-Werten.
 */
export const LOWPASS_BIQUAD_PRESETS = {
  muffled: { cutoffHz: 500, q: 0.707 },
  warm: { cutoffHz: 1500, q: 0.707 },
  bright: { cutoffHz: 5000, q: 0.707 },
  resonant: { cutoffHz: 1200, q: 4 },
} as const;
