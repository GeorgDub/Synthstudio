/**
 * Synthstudio – sampleSaturator.ts (v3.195.0)
 *
 * Analog-warmth Saturator via mehrere Shaping-Curves.  Pure-Helper ohne
 * Web-Audio-Abhaengigkeit (DOM-frei testbar via AudioBufferLike).
 *
 * ─── Konzept ────────────────────────────────────────────────────────────────
 *
 * Sample wird durch eine nicht-lineare Transferfunktion (tanh / soft-clip /
 * tube / tape) geschickt.  Pro Sample: x' = sample * drive, dann Shaping,
 * dann *outputGain (zum Kompensieren des Drive-Boosts).
 *
 * Foundation fuer kuenftige FX-Chain analog-feel (Tape-Saturation auf Bus,
 * Tube-Drive vor Compressor, sanftes Soft-Clip statt Hard-Clip).
 *
 * ─── Curves ─────────────────────────────────────────────────────────────────
 *
 * - "tanh":      out = tanh(x*drive) * outputGain
 *                Symmetric, bounded |out| < outputGain.
 * - "soft-clip": polynomial fuer |x*drive| < 1 ergibt 1.5x - 0.5x^3,
 *                sonst sign(x).  Soft-Knee, smooth.
 * - "tube":      asymmetric — positive Halbwelle: tanh(x*drive),
 *                negative Halbwelle: tanh(x*drive*0.7) (weniger aggressiv).
 *                Simuliert 2nd-harmonic-erzeugende Trioden-Roehre.
 * - "tape":      tanh(x*drive) + one-pole low-pass via Averaging mit prev
 *                Sample (HF-Daempfung wie auf Magnetband).
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - drive NaN / non-number  → DEFAULT_DRIVE (1.5)
 * - drive < 0               → 0 (silence-Output)
 * - outputGain NaN          → DEFAULT_OUTPUT_GAIN (0.7)
 * - type ungueltig          → "tanh"
 * - empty buffer            → empty AudioBufferLike (numberOfChannels=0)
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const DEFAULT_DRIVE = 1.5;
export const DEFAULT_OUTPUT_GAIN = 0.7;

// ─── Public Types ────────────────────────────────────────────────────────────

export type SaturationType = "tanh" | "soft-clip" | "tube" | "tape";

const VALID_TYPES: ReadonlySet<SaturationType> = new Set<SaturationType>([
  "tanh",
  "soft-clip",
  "tube",
  "tape",
]);

export interface SaturatorOptions {
  type?: SaturationType;
  drive?: number;
  outputGain?: number;
}

interface ResolvedOptions {
  type: SaturationType;
  drive: number;
  outputGain: number;
}

// ─── Sanitizers ──────────────────────────────────────────────────────────────

function resolveType(type: SaturationType | undefined): SaturationType {
  if (type && VALID_TYPES.has(type)) return type;
  return "tanh";
}

function resolveDrive(drive: number | undefined): number {
  if (typeof drive !== "number" || Number.isNaN(drive)) return DEFAULT_DRIVE;
  if (drive < 0) return 0;
  return drive;
}

function resolveOutputGain(gain: number | undefined): number {
  if (typeof gain !== "number" || Number.isNaN(gain)) return DEFAULT_OUTPUT_GAIN;
  return gain;
}

function resolveOptions(opts?: SaturatorOptions): ResolvedOptions {
  return {
    type: resolveType(opts?.type),
    drive: resolveDrive(opts?.drive),
    outputGain: resolveOutputGain(opts?.outputGain),
  };
}

// ─── Shaping-Funktionen ──────────────────────────────────────────────────────

function shapeTanh(x: number): number {
  return Math.tanh(x);
}

function shapeSoftClip(x: number): number {
  if (x >= 1) return 1;
  if (x <= -1) return -1;
  return 1.5 * x - 0.5 * x * x * x;
}

function shapeTube(x: number): number {
  // Asymmetric: positive uses normal tanh, negative is gentler.
  if (x >= 0) return Math.tanh(x);
  return Math.tanh(x * 0.7);
}

// ─── Empty-Buffer-Helper ─────────────────────────────────────────────────────

function emptyBuffer(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet eine Saturator-Curve auf den Buffer an.  Pro Channel pro Sample:
 *   x' = sample * drive
 *   shaped = curve(x')
 *   out    = shaped * outputGain (fuer "tape" zusaetzlich HF-Damping)
 *
 * Original-Buffer wird nicht mutiert (fresh Float32Arrays).  Laenge,
 * numberOfChannels und sampleRate bleiben erhalten.
 */
export function applySaturator(
  buffer: AudioBufferLike,
  options?: SaturatorOptions,
): AudioBufferLike {
  const { type, drive, outputGain } = resolveOptions(options);

  if (!buffer || buffer.length <= 0 || buffer.numberOfChannels <= 0) {
    return emptyBuffer(buffer?.sampleRate ?? 48000);
  }

  const channels: Float32Array[] = [];

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(src.length);

    if (type === "tape") {
      // tanh + one-pole low-pass (Averaging mit prev). Simuliert HF-Damping
      // von Magnetband.  Coefficient 0.5/0.5 → -6dB/oct ab Nyquist/2.
      let prev = 0;
      for (let i = 0; i < src.length; i++) {
        const shaped = shapeTanh(src[i] * drive);
        const lp = 0.5 * shaped + 0.5 * prev;
        dst[i] = lp * outputGain;
        prev = shaped;
      }
    } else if (type === "soft-clip") {
      for (let i = 0; i < src.length; i++) {
        dst[i] = shapeSoftClip(src[i] * drive) * outputGain;
      }
    } else if (type === "tube") {
      for (let i = 0; i < src.length; i++) {
        dst[i] = shapeTube(src[i] * drive) * outputGain;
      }
    } else {
      // "tanh" (default + fallback)
      for (let i = 0; i < src.length; i++) {
        dst[i] = shapeTanh(src[i] * drive) * outputGain;
      }
    }

    channels.push(dst);
  }

  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(0),
  };
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export const SATURATOR_PRESETS = [
  { id: "subtle", name: "Subtle Warmth", type: "tanh", drive: 1.2, outputGain: 0.85 },
  { id: "tube", name: "Tube Warm", type: "tube", drive: 2, outputGain: 0.7 },
  { id: "tape", name: "Tape Glue", type: "tape", drive: 1.5, outputGain: 0.75 },
  { id: "hard-clip", name: "Hard Drive", type: "soft-clip", drive: 3.5, outputGain: 0.5 },
] as const satisfies readonly {
  id: string;
  name: string;
  type: SaturationType;
  drive: number;
  outputGain: number;
}[];
