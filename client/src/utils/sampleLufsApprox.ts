/**
 * Synthstudio – sampleLufsApprox.ts (v3.182.0)
 *
 * Pure-Helper für eine Approximation der Integrated Loudness in LUFS
 * (Loudness Units Full-Scale) nach EBU R128 / ITU BS.1770-4 — vereinfacht
 * (Mono-Downmix statt 5-Channel-Weight, fixe 48k-Filter-Koeffizienten
 * statt sampleRate-abhängiger bilinearer Transformation, kein True-Peak-
 * Oversampling).
 *
 * Verwendung primär für UI-Anzeigen ("Sample ist −14 LUFS, geeignet für
 * Streaming-Master"), Loudness-Vergleich beim Bulk-Import, Auto-Normalize
 * gegen LUFS-Ziel (statt nur Peak).  Nicht für Broadcast-Compliance.
 *
 * ─── Algorithmus ────────────────────────────────────────────────────────────
 *
 *   1. Mono-Downmix (arith. Mittelwert aller Kanäle)
 *   2. K-Weighting via Biquad-Cascade:
 *        Pre-Filter (≈ High-Shelf @1681 Hz, +4 dB)
 *        RLB-Filter (≈ High-Pass @38 Hz)
 *   3. Block-Loop:
 *        blockSize = sampleRate * blockSizeSec
 *        hop       = blockSize * (1 - overlap)
 *        pro Block: meanSquare = Σ(x²) / blockSize
 *   4. Absolute Gating: blockLufs >= -70 LUFS (default)
 *   5. Ungated-Mean (von meanSquares der absolut-gegateten Blöcke)
 *        ungatedLufs = -0.691 + 10*log10(mean(meanSquares))
 *   6. Relative Gating: blockLufs >= ungatedLufs + relativeGateDb (-10)
 *   7. integratedLufs = -0.691 + 10 * log10(mean(meanSquares passed))
 *   8. truePeak = 20 * log10(max|x|) auf dem ORIGINAL (vor K-Weighting)
 *
 *   WICHTIG: "Integrated Loudness" ist NICHT der Mittelwert der Block-LUFS,
 *   sondern -0.691 + 10*log10(MEAN of meanSquares).  Häufige Falle.
 *
 * ─── K-Weighting Koeffizienten ──────────────────────────────────────────────
 *
 * ITU BS.1770-4 nennt die Koeffizienten explizit nur für 48 kHz. Andere
 * sampleRates verlangen eine bilineare Transformation des prototype-
 * Filters — das übersteigt den Scope dieser Approximation. Wir liefern
 * für alle sampleRates die 48k-Koeffizienten und nehmen die kleine
 * Frequenzgang-Verschiebung in Kauf (für UI-Loudness-Anzeigen tolerabel).
 *
 * ─── Pure & Node-testbar (DOM-frei) ─────────────────────────────────────────
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default block size in seconds (EBU R128 = 400 ms). */
export const DEFAULT_BLOCK_SIZE_SEC = 0.4;

/** Default overlap factor (75% per EBU R128). */
export const DEFAULT_OVERLAP = 0.75;

/** Default absolute gate threshold in LUFS. */
export const DEFAULT_ABSOLUTE_GATE_DB = -70;

/** Default relative gate offset in dB (vs. ungated mean). */
export const DEFAULT_RELATIVE_GATE_DB = -10;

/** Konstante aus BS.1770: integrated LUFS = -0.691 + 10*log10(meanSquare). */
const LUFS_OFFSET = -0.691;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface LufsApproxOptions {
  /** Block-Size in seconds. Default 0.4 (400ms = EBU R128). */
  blockSizeSec?: number;
  /** Overlap-Faktor 0..1. Default 0.75 (75% overlap). */
  overlap?: number;
  /** Absolute gate threshold dB. Default -70 LUFS. */
  absoluteGateDb?: number;
  /** Relative gate offset (vs ungated mean). Default -10 dB. */
  relativeGateDb?: number;
}

export interface LufsResult {
  /** Integrated Loudness in LUFS (-Infinity bei silence). */
  integratedLufs: number;
  /** Number of blocks that passed gating. */
  passedBlocks: number;
  /** Total number of blocks. */
  totalBlocks: number;
  /** True-Peak in dBFS (separat, einfach). */
  truePeakDbFS: number;
}

export interface KWeightingCoeffs {
  preFilter: { b: number[]; a: number[] };
  rlbFilter: { b: number[]; a: number[] };
}

// ─── Internal: Sanitization ──────────────────────────────────────────────────

function sanitizeBlockSizeSec(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || (v as number) <= 0) return DEFAULT_BLOCK_SIZE_SEC;
  return v as number;
}

function sanitizeOverlap(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_OVERLAP;
  let x = v as number;
  if (x < 0) x = 0;
  if (x > 0.99) x = 0.99;
  return x;
}

function sanitizeAbsoluteGate(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_ABSOLUTE_GATE_DB;
  return v as number;
}

function sanitizeRelativeGate(v: number | undefined): number {
  // -Infinity ist hier ABSICHTLICH erlaubt (= effektiv kein Relative-Gate)
  if (v === undefined) return DEFAULT_RELATIVE_GATE_DB;
  if (Number.isNaN(v)) return DEFAULT_RELATIVE_GATE_DB;
  return v as number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Liefert K-Weighting Biquad-Koeffizienten.  ITU BS.1770-4 spezifiziert
 * sie explizit nur für 48 kHz — wir geben sie für alle sampleRates zurück
 * (Approximation).  Cascade-Reihenfolge: pre-filter erst, dann RLB.
 */
export function getKWeightingCoeffs(_sampleRate: number): KWeightingCoeffs {
  // BS.1770-4 reference values for fs = 48000 Hz.
  return {
    preFilter: {
      b: [1.5351249, -2.6916962, 1.1989548],
      a: [1, -1.6906593, 0.7320229],
    },
    rlbFilter: {
      b: [1, -2, 1],
      a: [1, -1.9904743, 0.9904744],
    },
  };
}

/**
 * Berechnet integrated Loudness (LUFS) + True-Peak (dBFS) für einen
 * AudioBuffer.  Approximation nach BS.1770-4.
 */
export function computeLufsApprox(
  buffer: AudioBufferLike | null | undefined,
  options?: LufsApproxOptions,
): LufsResult {
  // Empty / invalid buffer → all-silence result
  if (
    !buffer ||
    buffer.length <= 0 ||
    buffer.numberOfChannels <= 0 ||
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate <= 0
  ) {
    return {
      integratedLufs: -Infinity,
      passedBlocks: 0,
      totalBlocks: 0,
      truePeakDbFS: -Infinity,
    };
  }

  const blockSizeSec = sanitizeBlockSizeSec(options?.blockSizeSec);
  const overlap = sanitizeOverlap(options?.overlap);
  const absoluteGateDb = sanitizeAbsoluteGate(options?.absoluteGateDb);
  const relativeGateDb = sanitizeRelativeGate(options?.relativeGateDb);

  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const numCh = buffer.numberOfChannels;

  // 1) Mono-downmix + collect true-peak on RAW signal
  const mono = new Float32Array(length);
  let truePeakLinear = 0;
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numCh; ch++) channelData.push(buffer.getChannelData(ch));
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let ch = 0; ch < numCh; ch++) sum += channelData[ch][i] ?? 0;
    const v = sum / numCh;
    mono[i] = v;
    const absV = Math.abs(v);
    if (absV > truePeakLinear) truePeakLinear = absV;
  }

  const truePeakDbFS = truePeakLinear > 0 ? 20 * Math.log10(truePeakLinear) : -Infinity;

  // 2) K-Weighting via biquad cascade
  const coeffs = getKWeightingCoeffs(sampleRate);
  const stage1 = applyBiquad(mono, coeffs.preFilter.b, coeffs.preFilter.a);
  const weighted = applyBiquad(stage1, coeffs.rlbFilter.b, coeffs.rlbFilter.a);

  // 3) Block-loop: compute meanSquare per block
  const blockSize = Math.max(1, Math.floor(sampleRate * blockSizeSec));
  const hop = Math.max(1, Math.floor(blockSize * (1 - overlap)));

  if (length < blockSize) {
    return {
      integratedLufs: -Infinity,
      passedBlocks: 0,
      totalBlocks: 0,
      truePeakDbFS,
    };
  }

  const meanSquares: number[] = [];
  for (let start = 0; start + blockSize <= length; start += hop) {
    let ss = 0;
    for (let i = start; i < start + blockSize; i++) {
      const x = weighted[i];
      ss += x * x;
    }
    meanSquares.push(ss / blockSize);
  }
  const totalBlocks = meanSquares.length;

  // 4) Absolute gating
  const absolutePassed: number[] = [];
  for (let i = 0; i < totalBlocks; i++) {
    const ms = meanSquares[i];
    if (ms <= 0) continue; // log10(0) = -Inf → < any finite gate
    const blockLufs = LUFS_OFFSET + 10 * Math.log10(ms);
    if (blockLufs >= absoluteGateDb) absolutePassed.push(ms);
  }

  if (absolutePassed.length === 0) {
    return {
      integratedLufs: -Infinity,
      passedBlocks: 0,
      totalBlocks,
      truePeakDbFS,
    };
  }

  // 5) Ungated-mean (of meanSquares of abs-gated blocks)
  const ungatedMean = mean(absolutePassed);
  const ungatedLufs = LUFS_OFFSET + 10 * Math.log10(ungatedMean);
  const relativeThreshold = ungatedLufs + relativeGateDb;

  // 6) Relative gating
  const finalPassed: number[] = [];
  for (const ms of absolutePassed) {
    const blockLufs = LUFS_OFFSET + 10 * Math.log10(ms);
    if (blockLufs >= relativeThreshold) finalPassed.push(ms);
  }

  if (finalPassed.length === 0) {
    return {
      integratedLufs: -Infinity,
      passedBlocks: 0,
      totalBlocks,
      truePeakDbFS,
    };
  }

  // 7) Integrated = -0.691 + 10*log10(mean of meanSquares of passed blocks)
  const passedMean = mean(finalPassed);
  const integratedLufs = LUFS_OFFSET + 10 * Math.log10(passedMean);

  return {
    integratedLufs,
    passedBlocks: finalPassed.length,
    totalBlocks,
    truePeakDbFS,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Direct-form-I biquad filter.  Coefficients form:
 *   a[0]*y[n] = b[0]*x[n] + b[1]*x[n-1] + b[2]*x[n-2] - a[1]*y[n-1] - a[2]*y[n-2]
 * a[0] is expected = 1 (normalized).
 */
function applyBiquad(input: Float32Array, b: number[], a: number[]): Float32Array {
  const n = input.length;
  const out = new Float32Array(n);
  const b0 = b[0] ?? 0;
  const b1 = b[1] ?? 0;
  const b2 = b[2] ?? 0;
  const a1 = a[1] ?? 0;
  const a2 = a[2] ?? 0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function mean(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}
