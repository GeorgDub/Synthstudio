/**
 * Synthstudio – sampleResampler.ts (v3.203.0)
 *
 * Pure-Helper für Linear-Interpolation-Sample-Rate-Konversion. Wandelt einen
 * AudioBufferLike auf eine neue sampleRate / länge um — ohne DOM, ohne
 * OfflineAudioContext.
 *
 * ─── Anwendungsfälle ────────────────────────────────────────────────────────
 *
 *  - resampleBuffer(buf, { targetSampleRate: 44100 }) — SR-Konversion,
 *    Pitch ändert sich proportional (preservePitch=false, Default).
 *  - resampleBuffer(buf, { targetLengthSamples: N })  — Override mit fixer
 *    Output-Länge (targetSampleRate wird ignoriert wenn gesetzt).
 *  - changeSpeedRatio(buf, ratio) — convenience: ratio=2 → halbe Länge
 *    (= "doppelte Geschwindigkeit", Oktave höher beim Playback ohne
 *    preservePitch); ratio=0.5 → doppelte Länge.
 *
 * ─── Algorithmus ────────────────────────────────────────────────────────────
 *
 * Endpunkt-inklusive Linear-Interpolation:
 *
 *   srcPos = i * (srcLen - 1) / (outLen - 1)         // outLen > 1
 *   lo     = floor(srcPos)
 *   frac   = srcPos - lo
 *   hi     = min(lo + 1, srcLen - 1)
 *   out[i] = src[lo] + frac * (src[hi] - src[lo])
 *
 * Diese Formel mappt out[0] exakt auf src[0] und out[outLen-1] exakt auf
 * src[srcLen-1] — Endpunkte bleiben erhalten. Beispiel:
 *
 *   src = [0, 1],  outLen = 3  →  out = [0.0, 0.5, 1.0]
 *
 * Abgrenzung zu samplePitchShift.ts: dort wird srcPos = i * ratio benutzt
 * (für Decimation-Style Resample bei Pitch-Shift); hier endpunkt-inklusiv
 * (für SR-Konversion-Style Resample).
 *
 * preservePitch=true ist in v3.203 ein STUB — es wird identische Linear-
 * Interpolation angewendet (Pitch ändert sich tatsächlich mit). Echtes
 * Time-Stretch (Phase-Vocoder, OLA) folgt in einer späteren Iteration.
 * JSDoc markiert das explizit als Approximation.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 *  - empty / null Buffer                 → empty mit same numCh + sampleRate
 *  - targetSampleRate NaN/Inf/≤0/undef   → identity (= source sampleRate)
 *  - targetLengthSamples NaN/Inf/<0      → ignoriert (fallback targetSR)
 *  - targetLengthSamples = 0             → leeren Buffer derselben SR
 *  - ratio NaN/Inf/≤0                    → 1 (identity)
 *  - Input wird nie mutiert
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-resampler.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ResampleOptions {
  /**
   * Ziel-Sample-Rate in Hz. Default = source sampleRate (identity).
   * Wird ignoriert wenn targetLengthSamples explizit gesetzt ist.
   */
  targetSampleRate?: number;
  /**
   * Optional: Ziel-Länge in Samples. Wenn gesetzt, hat Vorrang vor
   * targetSampleRate — output.length = targetLengthSamples,
   * output.sampleRate = targetSampleRate ?? source.sampleRate.
   */
  targetLengthSamples?: number;
  /**
   * Wenn true: Pitch soll erhalten bleiben (Time-Stretch-Stub).
   * v3.203 ist das eine Approximation (gleiche Linear-Interp); echtes
   * Phase-Vocoder-Time-Stretch folgt später.
   * Default false (Pitch ändert sich mit Length).
   */
  preservePitch?: boolean;
}

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

/**
 * Bestimmt die endgültige Output-Sample-Rate. NaN/Inf/<=0/undef → fallback.
 */
function sanitizeSampleRate(value: unknown, fallback: number): number {
  if (typeof value !== "number") return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return fallback;
  return value;
}

/**
 * Liefert die Output-Länge (Samples). targetLengthSamples hat Vorrang vor
 * der SR-basierten Längen-Berechnung.
 *
 *   outLen = floor(srcLen * targetSR / srcSR)
 *
 * targetLengthSamples NaN/Inf/<0 → Caller fällt auf SR-Berechnung zurück.
 */
function resolveOutputLength(
  srcLen: number,
  srcSampleRate: number,
  targetSampleRate: number,
  targetLengthSamples: unknown,
): number {
  // Explicit override hat Vorrang
  if (typeof targetLengthSamples === "number" &&
      Number.isFinite(targetLengthSamples) &&
      targetLengthSamples >= 0) {
    return Math.floor(targetLengthSamples);
  }
  if (srcLen <= 0) return 0;
  const ratio = targetSampleRate / srcSampleRate;
  if (!Number.isFinite(ratio) || ratio <= 0) return srcLen;
  return Math.floor(srcLen * ratio);
}

/**
 * Sanitiert Speed-Ratio. NaN/Inf/≤0 → 1 (identity).
 */
function sanitizeRatio(value: unknown): number {
  if (typeof value !== "number") return 1;
  if (!Number.isFinite(value)) return 1;
  if (value <= 0) return 1;
  return value;
}

// ─── Internal Builder ────────────────────────────────────────────────────────

/**
 * Erzeugt einen leeren AudioBufferLike mit gegebener sampleRate + numCh.
 * length=0, getChannelData liefert leere Float32Arrays.
 */
function makeEmpty(sampleRate: number, numberOfChannels: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

/**
 * Endpoint-inklusive Linear-Interpolation pro Channel.
 *
 *   outLen === 1                    → out[0] = src[0]
 *   outLen >= 2 && srcLen >= 2      → out[0]=src[0], out[outLen-1]=src[srcLen-1]
 *   srcLen === 1                    → alle out[i] = src[0]
 */
function interpolateChannel(src: Float32Array, outLen: number): Float32Array {
  const dst = new Float32Array(outLen);
  const srcLen = src.length;
  if (outLen === 0) return dst;
  if (srcLen === 0) return dst; // Silence-Fill (already 0)
  if (srcLen === 1) {
    dst.fill(src[0]);
    return dst;
  }
  if (outLen === 1) {
    dst[0] = src[0];
    return dst;
  }
  const denom = outLen - 1;
  const span = srcLen - 1;
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * span) / denom;
    const lo = Math.floor(srcPos);
    const frac = srcPos - lo;
    const hi = lo + 1 < srcLen ? lo + 1 : srcLen - 1;
    dst[i] = src[lo] + frac * (src[hi] - src[lo]);
  }
  return dst;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resampled einen AudioBufferLike via Linear-Interpolation auf eine neue
 * Sample-Rate und/oder Länge.
 *
 * Vorrang-Reihenfolge:
 *  1. targetLengthSamples (wenn gesetzt) bestimmt output.length
 *  2. sonst: output.length = floor(input.length * targetSR / input.sampleRate)
 *
 * output.sampleRate = targetSampleRate ?? input.sampleRate.
 *
 * preservePitch=true ist ein STUB in v3.203 — gleiche Linear-Interpolation
 * wird angewendet (Pitch ändert sich tatsächlich auch). Diese Option
 * signalisiert die Intent für künftige Phase-Vocoder-Implementierung; das
 * Verhalten ist aktuell identisch zu preservePitch=false.
 *
 * Edge-Cases:
 *  - leerer Input          → empty Output mit same numCh + sampleRate
 *  - targetSampleRate NaN/Inf/<=0/undef → identity (= source sampleRate)
 *  - targetLengthSamples NaN/Inf/<0     → fallback auf SR-basierte Länge
 *  - targetLengthSamples = 0            → empty Output
 *  - Input wird nicht mutiert; fresh Float32Arrays pro Channel
 */
export function resampleBuffer(
  buffer: AudioBufferLike,
  opts?: ResampleOptions,
): AudioBufferLike {
  if (!buffer || buffer.numberOfChannels === 0) {
    const sr = sanitizeSampleRate(opts?.targetSampleRate, buffer?.sampleRate ?? 48000);
    return makeEmpty(sr, buffer?.numberOfChannels ?? 0);
  }

  const srcSampleRate = buffer.sampleRate;
  const outSampleRate = sanitizeSampleRate(opts?.targetSampleRate, srcSampleRate);
  const outLen = resolveOutputLength(
    buffer.length,
    srcSampleRate,
    outSampleRate,
    opts?.targetLengthSamples,
  );

  if (outLen === 0) {
    return makeEmpty(outSampleRate, buffer.numberOfChannels);
  }

  const chCount = buffer.numberOfChannels;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    channels.push(interpolateChannel(src, outLen));
  }

  return {
    sampleRate: outSampleRate,
    numberOfChannels: chCount,
    length: outLen,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) {
        throw new RangeError(`channel ${c} out of range`);
      }
      return channels[c];
    },
  };
}

/**
 * Convenience-Wrapper: ändert die "Playback-Geschwindigkeit" via Resample.
 *
 *   ratio = 2   → outLen = floor(inLen / 2)   ("doppelt so schnell")
 *   ratio = 0.5 → outLen = floor(inLen / 0.5) ("halb so schnell")
 *   ratio = 1   → identity
 *
 * Sample-Rate bleibt unverändert (nur Länge ändert sich). Beim Playback
 * resultiert das in einer Pitch-Verschiebung (höher bei ratio>1, tiefer
 * bei ratio<1) — analog zu einem Vinyl-Speed-Knob ohne Pitch-Lock.
 *
 * NaN / Infinity / ≤ 0 → ratio = 1 (identity).
 */
export function changeSpeedRatio(
  buffer: AudioBufferLike,
  ratio: number,
): AudioBufferLike {
  const safe = sanitizeRatio(ratio);
  if (!buffer || buffer.numberOfChannels === 0 || buffer.length === 0) {
    return resampleBuffer(buffer);
  }
  const outLen = Math.floor(buffer.length / safe);
  return resampleBuffer(buffer, { targetLengthSamples: outLen });
}
