/**
 * Synthstudio – sampleSampleRateReduce.ts (v3.204.0)
 *
 * Sample-Rate-Reduction (Sample-and-Hold) + optional Bit-Depth-Quantization
 * fuer Bitcrush / LoFi-Aesthetik.  Pure-Helper ohne Web-Audio-Abhaengigkeit
 * (DOM-frei testbar via AudioBufferLike).
 *
 * ─── Konzept ────────────────────────────────────────────────────────────────
 *
 * Sample-and-Hold: pro `reductionFactor` Samples wird der erste Wert als
 * Zielwert fuer alle folgenden holdSize Samples uebernommen.  Die effektive
 * Sample-Rate sinkt auf src.sampleRate / reductionFactor; Detail-Verlust =
 * digitale Aliasing-Aesthetik (Bitcrush, LoFi).
 *
 * Optionale Bit-Depth-Quantization: wenn `bitDepth` gesetzt, wird jeder
 * Sample-Wert nach S/H auf 2^bitDepth Stufen gerundet (signed midtread).
 * 2 Bit  → 4 Stufen,  4 Bit  → 16 Stufen, 8 Bit  → 256 Stufen.
 *
 * Wichtig: Buffer-Laenge bleibt unveraendert (kein Resample / Downsample) —
 * nur Detail-Verlust durch Hold + Quantize.  Die `sampleRate`-Property des
 * Output-Buffers bleibt ebenfalls gleich (effektive Rate ist implizit
 * src.sampleRate / reductionFactor, aber wir reportieren weiter die echte
 * physikalische Rate fuer Wiedergabe-Kompatibilitaet).
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - reductionFactor NaN / non-number / <1  → 1 (identity)
 * - reductionFactor > 256                  → 256 (cap)
 * - reductionFactor non-integer            → Math.floor
 * - bitDepth NaN / non-number / <2 / undef → undefined (kein Quantize)
 * - bitDepth > 16                          → 16 (cap)
 * - bitDepth non-integer                   → Math.floor
 * - empty buffer (length=0 || numCh=0)     → empty AudioBufferLike
 *
 * ─── Foundation ─────────────────────────────────────────────────────────────
 *
 * Foundation fuer LoFi-FX (Bitcrush-Channel-Insert), Vintage-Sample-Verfremdung
 * im SampleBrowser, 8-Bit-Drumkit-Aesthetik, kuenftige Vinyl-FX-Chain.
 *
 * Pure & DOM-frei.  Operiert auf AudioBufferLike (sampleEmbedding-Interface).
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const DEFAULT_REDUCTION_FACTOR = 1;
export const MAX_REDUCTION_FACTOR = 256;
export const MIN_BIT_DEPTH = 2;
export const MAX_BIT_DEPTH = 16;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface SampleRateReduceOptions {
  /** 1 = identity, 2 = halve effective rate, 4 = quarter, etc.  Default 1. */
  reductionFactor?: number;
  /** Optional bit-depth reduction 2..16.  Default off (no quantization). */
  bitDepth?: number;
}

interface ResolvedOptions {
  reductionFactor: number;
  bitDepth: number | undefined;
}

// ─── Sanitizers ──────────────────────────────────────────────────────────────

function resolveReductionFactor(factor: number | undefined): number {
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 1) {
    return DEFAULT_REDUCTION_FACTOR;
  }
  if (factor > MAX_REDUCTION_FACTOR) return MAX_REDUCTION_FACTOR;
  return Math.floor(factor);
}

function resolveBitDepth(depth: number | undefined): number | undefined {
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < MIN_BIT_DEPTH) {
    return undefined;
  }
  if (depth > MAX_BIT_DEPTH) return MAX_BIT_DEPTH;
  return Math.floor(depth);
}

function resolveOptions(opts?: SampleRateReduceOptions): ResolvedOptions {
  return {
    reductionFactor: resolveReductionFactor(opts?.reductionFactor),
    bitDepth: resolveBitDepth(opts?.bitDepth),
  };
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

// ─── Quantizer ───────────────────────────────────────────────────────────────

/**
 * Signed midtread quantization auf 2^bitDepth Stufen.
 * v = round(value * levels/2) / (levels/2).
 * Beispiel: bitDepth=2 → levels=4, levels/2=2.  value=0.4 → round(0.8)/2 = 0.5.
 *           bitDepth=4 → levels=16, levels/2=8. value=0.1 → round(0.8)/8 = 0.125.
 */
function quantize(value: number, bitDepth: number): number {
  const levels = Math.pow(2, bitDepth);
  const half = levels / 2;
  return Math.round(value * half) / half;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet Sample-Rate-Reduction (Sample-and-Hold) + optional Bit-Depth-Quantize
 * auf den Buffer an.  Pro Channel pro Sample:
 *   if i % reductionFactor === 0  →  held = src[i]
 *   else                          →  held = held (S/H aus letztem Index)
 *   out[i] = bitDepth ? quantize(held, bitDepth) : held
 *
 * Original-Buffer wird nicht mutiert (fresh Float32Arrays).  Laenge,
 * numberOfChannels und sampleRate bleiben identisch.
 */
export function applySampleRateReduce(
  buffer: AudioBufferLike,
  opts?: SampleRateReduceOptions,
): AudioBufferLike {
  const { reductionFactor, bitDepth } = resolveOptions(opts);

  if (!buffer || buffer.length <= 0 || buffer.numberOfChannels <= 0) {
    return emptyBuffer(buffer?.sampleRate ?? 48000);
  }

  // Fast-Path: identity (factor=1 + kein bitDepth) → copy-only.
  if (reductionFactor === 1 && bitDepth === undefined) {
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      channels.push(new Float32Array(src));
    }
    return {
      sampleRate: buffer.sampleRate,
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      getChannelData: (channel: number) => channels[channel] ?? new Float32Array(0),
    };
  }

  const channels: Float32Array[] = [];

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(src.length);

    let held = 0;
    for (let i = 0; i < src.length; i++) {
      if (i % reductionFactor === 0) {
        held = src[i];
      }
      dst[i] = bitDepth !== undefined ? quantize(held, bitDepth) : held;
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

export const SR_REDUCE_PRESETS = {
  subtle: { reductionFactor: 2 },
  lofi: { reductionFactor: 4, bitDepth: 12 },
  crunch: { reductionFactor: 8, bitDepth: 8 },
  destroy: { reductionFactor: 16, bitDepth: 4 },
} as const;
