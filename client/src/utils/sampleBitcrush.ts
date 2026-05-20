/**
 * sampleBitcrush.ts (v3.221)
 *
 * Pure-Helper: Combined Bitcrush — drive (tanh-saturation) → sample-rate-reduce
 * (sample-and-hold) → bit-depth-quantize → wet/dry mix.
 *
 * Closes the "aggressive LoFi" niche between v3.204 sampleSampleRateReduce
 * (no drive) and v3.184 sampleSaturator (no quantize).
 */

import type { AudioBufferLike } from "./sampleEmbedding";

export interface BitcrushOptions {
  bitDepth?: number;
  sampleRateReduction?: number;
  drive?: number;
  mix?: number;
}

export const BITCRUSH_PRESETS = {
  subtle: { bitDepth: 12, sampleRateReduction: 2, drive: 1.5, mix: 0.4 },
  classic: { bitDepth: 8, sampleRateReduction: 4, drive: 2, mix: 0.7 },
  destroy: { bitDepth: 4, sampleRateReduction: 8, drive: 3, mix: 1 },
  videogame: { bitDepth: 6, sampleRateReduction: 6, drive: 1.8, mix: 0.8 },
} as const;

const DEFAULT_BIT_DEPTH = 8;
const DEFAULT_SR_REDUCTION = 4;
const DEFAULT_DRIVE = 1;
const DEFAULT_MIX = 1;

function sanitizeBitDepth(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) return DEFAULT_BIT_DEPTH;
  if (!Number.isFinite(v)) return v > 0 ? 16 : DEFAULT_BIT_DEPTH;
  if (v < 1) return DEFAULT_BIT_DEPTH;
  if (v > 16) return 16;
  return Math.floor(v);
}

function sanitizeSrReduction(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) return DEFAULT_SR_REDUCTION;
  if (!Number.isFinite(v)) return v > 0 ? 32 : DEFAULT_SR_REDUCTION;
  if (v < 1) return DEFAULT_SR_REDUCTION;
  if (v > 32) return 32;
  return Math.floor(v);
}

function sanitizeDrive(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) return DEFAULT_DRIVE;
  if (!Number.isFinite(v)) return v > 0 ? 20 : DEFAULT_DRIVE;
  if (v < 0.1) return DEFAULT_DRIVE;
  if (v > 20) return 20;
  return v;
}

function sanitizeMix(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) return DEFAULT_MIX;
  if (!Number.isFinite(v)) return v > 0 ? 1 : 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function makeBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
  const channels: Float32Array[] = [];
  for (let c = 0; c < numberOfChannels; c++) {
    channels.push(new Float32Array(length));
  }
  return {
    sampleRate,
    numberOfChannels,
    length,
    getChannelData(ch: number): Float32Array {
      if (ch < 0 || ch >= numberOfChannels) {
        throw new RangeError(`channel ${ch} out of bounds`);
      }
      return channels[ch];
    },
  };
}

export function applyBitcrush(buffer: AudioBufferLike, opts: BitcrushOptions = {}): AudioBufferLike {
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return makeBuffer(buffer?.numberOfChannels ?? 0, 0, buffer?.sampleRate ?? 48000);
  }

  const bitDepth = sanitizeBitDepth(opts.bitDepth);
  const srReduction = sanitizeSrReduction(opts.sampleRateReduction);
  const drive = sanitizeDrive(opts.drive);
  const mix = sanitizeMix(opts.mix);

  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const levels = Math.pow(2, bitDepth);
  const half = levels / 2;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    let held = 0;
    for (let i = 0; i < src.length; i++) {
      const dry = src[i];
      if (i % srReduction === 0) {
        const driven = Math.tanh(dry * drive);
        held = Math.round(driven * half) / half;
      }
      let v = mix * held + (1 - mix) * dry;
      if (!Number.isFinite(v)) v = 0;
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      dst[i] = v;
    }
  }
  return out;
}
