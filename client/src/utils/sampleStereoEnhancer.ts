/**
 * Synthstudio – sampleStereoEnhancer.ts (v3.197.0)
 *
 * Pure-Helper für Stereo-Enhancement via Mid/Side (M/S) processing.
 *
 *   M = (L + R) / 2   // sum  – mono component (center info)
 *   S = (L - R) / 2   // diff – stereo component (sides)
 *
 *   L' = M + S * width
 *   R' = M - S * width
 *
 * Pro `width`-Wert:
 *   width = 0  → L' = R' = M           (collapse to mono, side info erased)
 *   width = 1  → L' = L, R' = R         (identity, lossless)
 *   width = 2  → L' = M + 2S = (3L−R)/2,
 *                R' = M − 2S = (3R−L)/2 (extreme wide, kann |out|>1 erzeugen –
 *                Caller muss bei Bedarf clippen/normalisieren).
 *
 * Foundation für Stereo-Width-Slider im SampleTransformDialog + Bulk-Workflow
 * im SampleBrowser.  Analyse-Pendant ist analyzeStereoWidth() aus
 * `sampleStereoWidth.ts` (RMS-basiert, gleiche M/S-Math).
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - empty / null Buffer (length<=0 || numberOfChannels<=0) → empty AudioBufferLike
 * - Mono-Buffer (numberOfChannels === 1) → identity COPY (fresh Float32Array,
 *   nicht aliased zum Original — Caller-Mutation isoliert)
 * - >2 Channels: Ch 0/1 werden M/S-prozessiert, Ch 2+ unverändert KOPIERT
 *   (fresh Float32Array pro Channel — kein Reference-Sharing)
 * - width undefined / NaN → 1 (identity)
 * - width < 0 → 0 (mono collapse)
 * - width > 2 oder Infinity → 2 (extreme wide)
 * - kein Output-Clipping (Math.* roh; bei extremen `width` kann |sample| > 1
 *   sein — bewusste Entscheidung, damit Caller volle Kontrolle hat).
 *
 * Original-Buffer wird NIE mutiert.  Pure & DOM-frei (testbar via Vitest-Node).
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-stereo-enhancer.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const DEFAULT_WIDTH = 1;
export const MIN_WIDTH = 0;
export const MAX_WIDTH = 2;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface StereoEnhanceOptions {
  /** 0..2 (1=unchanged, 0=mono, 2=extreme wide).  NaN / undefined → 1. */
  width?: number;
}

// ─── Sanitizers ──────────────────────────────────────────────────────────────

/**
 * Auflösung der width-Option:
 *   - undefined / null               → DEFAULT_WIDTH (1)
 *   - NaN / non-number               → DEFAULT_WIDTH (1)
 *   - Infinity oder finite > MAX     → MAX_WIDTH (2)
 *   - finite < MIN                   → MIN_WIDTH (0)
 *   - sonst                          → wie eingegeben
 *
 * NaN-Check vor Clamp, weil Math.max/Math.min mit NaN → NaN propagiert.
 */
function resolveWidth(width: number | undefined | null): number {
  if (typeof width !== "number" || Number.isNaN(width)) return DEFAULT_WIDTH;
  if (width > MAX_WIDTH) return MAX_WIDTH;
  if (width < MIN_WIDTH) return MIN_WIDTH;
  return width;
}

// ─── Buffer-Helpers ──────────────────────────────────────────────────────────

function emptyBuffer(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

/**
 * Liefert einen Buffer mit frischen Float32Array-Kopien aller Channels.
 * Wird für Mono-Identity + Pass-Through von Channels ≥2 genutzt.
 */
function copyChannel(buffer: AudioBufferLike, channelIndex: number): Float32Array {
  const src = buffer.getChannelData(channelIndex);
  return new Float32Array(src);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Stereo-Enhancer via M/S-Processing.
 *
 *   width = 0 → mono-collapse (L' = R' = mid)
 *   width = 1 → identity
 *   width = 2 → extreme wide
 *
 * Mono-Buffer wird als Identity-Copy zurückgegeben (fresh Float32Array, nicht
 * aliased).  Buffer mit >2 Channels: Ch 0/1 werden M/S-prozessiert, Ch 2+ als
 * fresh Copy durchgereicht.
 *
 * Original-Buffer wird NICHT mutiert.  Liefert eine neue AudioBufferLike-Hülle.
 */
export function applyStereoEnhance(
  buffer: AudioBufferLike,
  options?: StereoEnhanceOptions,
): AudioBufferLike {
  const width = resolveWidth(options?.width);

  // Empty / invalid buffer → empty result
  if (!buffer || buffer.length <= 0 || buffer.numberOfChannels <= 0) {
    return emptyBuffer(buffer?.sampleRate ?? 48000);
  }

  const channels: Float32Array[] = [];

  // Mono-Buffer: identity copy (fresh Float32Array, NIE aliased zum Original)
  if (buffer.numberOfChannels < 2) {
    channels.push(copyChannel(buffer, 0));
    return {
      sampleRate: buffer.sampleRate,
      numberOfChannels: 1,
      length: buffer.length,
      getChannelData: (c: number) => channels[c] ?? new Float32Array(0),
    };
  }

  // Stereo-Pfad: M/S auf Ch 0/1
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const n = buffer.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    outL[i] = m + s * width;
    outR[i] = m - s * width;
  }

  channels.push(outL, outR);

  // Pass-Through für Ch ≥2 (fresh Copies, KEIN Reference-Sharing)
  for (let c = 2; c < buffer.numberOfChannels; c++) {
    channels.push(copyChannel(buffer, c));
  }

  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    getChannelData: (c: number) => channels[c] ?? new Float32Array(0),
  };
}
