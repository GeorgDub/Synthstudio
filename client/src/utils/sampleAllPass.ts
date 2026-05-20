/**
 * Synthstudio – sampleAllPass.ts (v3.202.0)
 *
 * Pure-Helper für Biquad-All-Pass-Filter (RBJ Audio EQ Cookbook):
 *
 *   ω₀ = 2π · centerHz / sampleRate
 *   α  = sin(ω₀) / (2 · q)
 *
 *   b0 = 1 - α,    b1 = -2·cos(ω₀),  b2 = 1 + α
 *   a0 = 1 + α,    a1 = -2·cos(ω₀),  a2 = 1 - α
 *
 *   y[n] = (b0/a0)·x[n] + (b1/a0)·x[n-1] + (b2/a0)·x[n-2]
 *          - (a1/a0)·y[n-1] - (a2/a0)·y[n-2]
 *
 * Ein All-Pass hat |H(ω)| = 1 für alle ω, aber eine frequenzabhängige
 * Phasenverschiebung — Magnitude bleibt erhalten, Phase wird verschoben.
 * Bei centerHz hat ein single-stage Biquad-All-Pass exakt -180° Phase.
 * Mehrere Stages werden hintereinander kaskadiert (jedes Sample
 * durchläuft stages-mal die Biquad-Section, single-pass single-output).
 *
 * Foundation für Phaser-FX (LFO-modulierter Allpass), Stereo-Widening
 * (Allpass auf einem Channel), Drum-Phase-Alignment u.a.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - empty / null Buffer        → empty AudioBufferLike (fallback sampleRate=48000)
 * - centerHz ≤ 0 / NaN / undef / Infinity → 1000 Hz
 * - centerHz > sampleRate/2    → sampleRate/2 (Nyquist-Clamp)
 * - q ≤ 0 / NaN / undef        → 0.707 (Butterworth-Q)
 * - q > 10                     → 10 (Soft-Cap)
 * - stages < 1 / NaN / undef   → 1
 * - stages > 8                 → 8 (Performance-Cap)
 * - stages werden via Math.floor zu Integers
 * - Per-Channel + per-Stage frischer State (x1=x2=y1=y2=0) — kein
 *   Cross-Channel-Coupling, kein Cross-Stage-Coupling beim Init.
 * - Input wird nie mutiert; alle Writes in fresh Float32Arrays
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-all-pass.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface AllPassOptions {
  /** Mitten-Frequenz in Hz (0..Nyquist). Default 1000. */
  centerHz?: number;
  /** Q-Faktor (0.1..10). Default 0.707. */
  q?: number;
  /** Anzahl Stages (1..8). Default 1. */
  stages?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_CENTER_HZ = 1000;
export const DEFAULT_Q = 0.707;
export const DEFAULT_STAGES = 1;
const MIN_Q = 0.1;
const MAX_Q = 10;
const MIN_STAGES = 1;
const MAX_STAGES = 8;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function resolveCenterHz(value: number | undefined, sampleRate: number): number {
  if (value === undefined || value === null) return DEFAULT_CENTER_HZ;
  if (typeof value !== "number") return DEFAULT_CENTER_HZ;
  if (!Number.isFinite(value)) return DEFAULT_CENTER_HZ;
  if (value <= 0) return DEFAULT_CENTER_HZ;
  const nyquist = sampleRate / 2;
  if (value > nyquist) return nyquist;
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

function resolveStages(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_STAGES;
  if (typeof value !== "number") return DEFAULT_STAGES;
  if (!Number.isFinite(value)) return DEFAULT_STAGES;
  const intVal = Math.floor(value);
  if (intVal < MIN_STAGES) return MIN_STAGES;
  if (intVal > MAX_STAGES) return MAX_STAGES;
  return intVal;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet einen kaskadierten Biquad-All-Pass-Filter auf den Buffer an.
 * Gibt einen NEUEN Buffer zurück (Input wird nicht mutiert).
 *
 * Magnitude-preserving: |H(ω)|=1 für alle Frequenzen, aber Phase wird
 * frequency-dependent verschoben. Bei centerHz ist die Phasenverschiebung
 * pro Stage = -180°.
 *
 * Edge-Cases:
 *   - empty / null buffer    → empty buffer
 *   - centerHz ≥ Nyquist     → Nyquist-Clamp
 *   - stages = 0             → 1 (min)
 *   - q sehr klein           → MIN_Q clamp (sin/2q würde sonst riesig)
 */
export function applyAllPass(
  buffer: AudioBufferLike,
  options: AllPassOptions = {},
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

  const centerHz = resolveCenterHz(options.centerHz, sampleRate);
  const q = resolveQ(options.q);
  const stages = resolveStages(options.stages);

  // RBJ All-Pass Coefficients
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  const a0 = 1 + alpha;
  // Pre-normalize: divide all by a0
  const b0n = (1 - alpha) / a0;
  const b1n = (-2 * cosW0) / a0;
  const b2n = (1 + alpha) / a0;
  const a1n = (-2 * cosW0) / a0;
  const a2n = (1 - alpha) / a0;

  // Note: For RBJ all-pass, b0/a0 = (1-α)/(1+α), b2/a0 = (1+α)/(1+α) = 1
  // and b1/a0 = -2cos(w0)/(1+α). So b2n simplifies to 1.0 numerically —
  // but we keep the formula explicit for clarity / future-proofing.

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    // State per stage: x1, x2, y1, y2 (4 vars per stage)
    const x1 = new Float64Array(stages);
    const x2 = new Float64Array(stages);
    const y1 = new Float64Array(stages);
    const y2 = new Float64Array(stages);

    for (let i = 0; i < len; i++) {
      let sample = src[i];

      // Run sample through all stages in series.
      for (let s = 0; s < stages; s++) {
        const x = sample;
        const y =
          b0n * x +
          b1n * x1[s] +
          b2n * x2[s] -
          a1n * y1[s] -
          a2n * y2[s];

        x2[s] = x1[s];
        x1[s] = x;
        y2[s] = y1[s];
        y1[s] = y;

        sample = y;
      }

      dst[i] = sample;
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
 * Curated Phase-Shift Presets. Bewusst plain object literal (statt readonly
 * Array) — matched HIGHPASS_PRESETS-Konvention.
 */
export const ALLPASS_PRESETS = {
  /** Sanfter Phase-Schubs für leichte Bewegung. */
  subtle: { centerHz: 800, q: 0.5, stages: 1 },
  /** Klassische 4-Stage Phaser-Topologie. */
  phaser: { centerHz: 1000, q: 1.5, stages: 4 },
  /** Tief & breit — markante Phase-Verschiebung im Low-Mid-Bereich. */
  deep: { centerHz: 400, q: 2, stages: 6 },
  /** Hoher Q-Resonance-Sweep um obere Mitten. */
  resonant: { centerHz: 2000, q: 5, stages: 2 },
} as const;
