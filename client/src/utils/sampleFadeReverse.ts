/**
 * Synthstudio – sampleFadeReverse.ts (v3.133.0)
 *
 * Pure-Helpers für Sample-Transformations:
 *  - reverseSample(buffer)           → AudioBufferLike (reversed)
 *  - fadeInSample(buffer, ms, curve) → AudioBufferLike (linear/exp/equal-power)
 *  - fadeOutSample(buffer, ms, curve)→ AudioBufferLike
 *  - trimSilence(buffer, threshold?) → AudioBufferLike (head + tail silence trimmed)
 *
 * Alle immutable: liefern neue Buffer-Kopien. Pure & Node-testbar.
 *
 * Tests: tests/features/sample-fade-reverse.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Constants ───────────────────────────────────────────────────────────────

export type FadeCurve = "linear" | "exp" | "equal-power";

export const FADE_CURVES: readonly FadeCurve[] = ["linear", "exp", "equal-power"];

/** Default fade-Dauer wenn kein Wert angegeben. */
export const DEFAULT_FADE_MS = 10;

/** Default trim-Silence-Threshold (linear amplitude). -60dB ≈ 0.001. */
export const DEFAULT_TRIM_THRESHOLD = 0.001;

// ─── Pure Helpers ────────────────────────────────────────────────────────────

/**
 * Reversed Buffer: alle Channels in umgekehrter Reihenfolge.
 * Edge: empty buffer → empty buffer (same shape).
 */
export function reverseSample(buffer: AudioBufferLike): AudioBufferLike {
  if (!buffer || buffer.length === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }
  const chCount = buffer.numberOfChannels;
  const len = buffer.length;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i];
    channels.push(dst);
  }
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}

/**
 * Fade-Curve-Funktion: maps t∈[0,1] → gain∈[0,1].
 * Pure, used by fadeIn/fadeOut.
 *
 *  - linear:       y = t
 *  - exp:          y = t² (slow start)
 *  - equal-power:  y = sin(t × π/2) (DJ-Crossfade-Standard)
 */
export function fadeCurveAt(t: number, curve: FadeCurve = "linear"): number {
  if (!Number.isFinite(t)) return 0;
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (curve) {
    case "exp":
      return tt * tt;
    case "equal-power":
      return Math.sin(tt * Math.PI * 0.5);
    case "linear":
    default:
      return tt;
  }
}

/**
 * Konvertiert ms zu sample-Count (clamp 0..buffer.length).
 */
export function msToSampleCount(ms: number, sampleRate: number, maxLen: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const n = Math.floor((ms / 1000) * sampleRate);
  return Math.max(0, Math.min(maxLen, n));
}

/**
 * Fade-In: rampt die ersten N Samples (durationMs) von 0 → 1 mit der gegebenen Curve.
 * Restlicher Buffer bleibt unverändert.
 */
export function fadeInSample(
  buffer: AudioBufferLike,
  durationMs: number = DEFAULT_FADE_MS,
  curve: FadeCurve = "linear",
): AudioBufferLike {
  if (!buffer || buffer.length === 0) return reverseSample(buffer); // edge: empty
  const len = buffer.length;
  const fadeLen = msToSampleCount(durationMs, buffer.sampleRate, len);
  const chCount = buffer.numberOfChannels;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      if (i < fadeLen) {
        const t = fadeLen > 0 ? i / fadeLen : 1;
        dst[i] = src[i] * fadeCurveAt(t, curve);
      } else {
        dst[i] = src[i];
      }
    }
    channels.push(dst);
  }
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}

/**
 * Fade-Out: rampt die letzten N Samples (durationMs) von 1 → 0 mit der gegebenen Curve.
 */
export function fadeOutSample(
  buffer: AudioBufferLike,
  durationMs: number = DEFAULT_FADE_MS,
  curve: FadeCurve = "linear",
): AudioBufferLike {
  if (!buffer || buffer.length === 0) return reverseSample(buffer);
  const len = buffer.length;
  const fadeLen = msToSampleCount(durationMs, buffer.sampleRate, len);
  const fadeStart = len - fadeLen;
  const chCount = buffer.numberOfChannels;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      if (i >= fadeStart && fadeLen > 0) {
        const t = (len - 1 - i) / fadeLen;
        dst[i] = src[i] * fadeCurveAt(t, curve);
      } else {
        dst[i] = src[i];
      }
    }
    channels.push(dst);
  }
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}

/**
 * Trim-Silence: entfernt Silence am Anfang + Ende des Buffers.
 *
 * Algorithmus:
 *  - Iteriere von vorne bis zum ersten Sample > threshold → trimStart
 *  - Iteriere von hinten bis zum ersten Sample > threshold → trimEnd
 *  - Slice channels[trimStart..trimEnd+1]
 *
 * Bei rein silence → empty buffer (length=0).
 *
 * @param threshold Linear amplitude threshold (default 0.001 = -60dB)
 */
export function trimSilence(
  buffer: AudioBufferLike,
  threshold: number = DEFAULT_TRIM_THRESHOLD,
): AudioBufferLike {
  if (!buffer || buffer.length === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }
  const len = buffer.length;
  const chCount = buffer.numberOfChannels;
  const thresh = Math.abs(Number.isFinite(threshold) ? threshold : DEFAULT_TRIM_THRESHOLD);

  // Find first non-silence sample (across all channels).
  let trimStart = len;
  for (let i = 0; i < len; i++) {
    let max = 0;
    for (let c = 0; c < chCount; c++) {
      const v = Math.abs(buffer.getChannelData(c)[i]);
      if (v > max) max = v;
    }
    if (max > thresh) {
      trimStart = i;
      break;
    }
  }

  if (trimStart >= len) {
    // Pure silence.
    return {
      sampleRate: buffer.sampleRate,
      numberOfChannels: chCount,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  let trimEnd = -1;
  for (let i = len - 1; i >= 0; i--) {
    let max = 0;
    for (let c = 0; c < chCount; c++) {
      const v = Math.abs(buffer.getChannelData(c)[i]);
      if (v > max) max = v;
    }
    if (max > thresh) {
      trimEnd = i;
      break;
    }
  }

  const newLen = trimEnd - trimStart + 1;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) dst[i] = src[trimStart + i];
    channels.push(dst);
  }
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: newLen,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}
