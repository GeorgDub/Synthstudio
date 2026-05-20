/**
 * Synthstudio – samplePitchShift.ts (v3.194.0)
 *
 * Resample-based Pitch-Shift (NO time-stretch) für AudioBufferLike.
 *
 * Konzept:
 *  - Pitch up by N semitones → playback-rate-ratio = 2^(N/12)
 *  - Output ist length / ratio Samples lang (kürzer bei pitch-up, länger
 *    bei pitch-down). Sample-Rate bleibt gleich; nur Sample-Count ändert
 *    sich.
 *  - Lese-Position src_idx = i * ratio mit linearer Interpolation zwischen
 *    floor(src_idx) und ceil(src_idx).
 *
 * Foundation für künftige Sample-Tune-Aktionen (Bulk-Detune, Drag-and-Drop-
 * Pitch-Preview, Stretch-aware Slicing-Targets). Pure & DOM-frei.
 *
 * Abgrenzung:
 *  - Dies ist KEIN Time-Stretch (Länge ändert sich proportional zur Ratio).
 *  - Für tune-erhalten-und-Länge-konstant: künftiges samplePhaseVocoder.ts.
 *
 * Tests: tests/features/sample-pitch-shift.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max absolute Semitone-Shift (clamp boundary). +/-24 = ±2 Oktaven. */
export const MAX_SEMITONES = 24;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface PitchShiftOptions {
  /** Semitone-Shift, geclampt auf -MAX_SEMITONES..+MAX_SEMITONES. NaN → 0. */
  semitones: number;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Sanitiert die Semitone-Eingabe.
 *  - non-number / NaN     → 0 (identity)
 *  - +Infinity            → +MAX_SEMITONES
 *  - -Infinity            → -MAX_SEMITONES
 *  - sonst clamp auf [-MAX_SEMITONES, +MAX_SEMITONES]
 */
function sanitizeSemitones(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value >= MAX_SEMITONES) return MAX_SEMITONES;
  if (value <= -MAX_SEMITONES) return -MAX_SEMITONES;
  return value;
}

/**
 * Erzeugt einen leeren AudioBufferLike (length=0, 0 Channels) — wird für
 * empty-input + reines Silence-Pitch-Output verwendet.
 */
function makeEmpty(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Berechnet die Output-Länge für einen gegebenen Semitone-Shift.
 *
 *   ratio = 2^(semitones/12)
 *   outputLength = floor(inputLength / ratio)
 *
 * Beispiele:
 *   pitchShiftedLength(100,  0)   = 100   (identity)
 *   pitchShiftedLength(100, +12)  = 50    (octave-up → halbe Länge)
 *   pitchShiftedLength(100, -12)  = 200   (octave-down → doppelte Länge)
 *
 * Edge-Cases:
 *   inputLength <= 0  → 0
 *   semitones NaN     → wie 0 (identity)
 *   semitones >  +24  → clamped auf +24
 *   semitones <  -24  → clamped auf -24
 */
export function pitchShiftedLength(inputLength: number, semitones: number): number {
  if (!Number.isFinite(inputLength) || inputLength <= 0) return 0;
  const st = sanitizeSemitones(semitones);
  if (st === 0) return Math.floor(inputLength);
  const ratio = Math.pow(2, st / 12);
  return Math.floor(inputLength / ratio);
}

/**
 * Resample-based pitch shift (no time stretch). Liefert eine NEUE
 * AudioBufferLike-Instanz; Eingabe-Buffer wird nicht mutiert.
 *
 *   ratio = 2^(semitones/12)
 *   outputLength = floor(inputLength / ratio)
 *
 * Pro Channel und Output-Sample i ∈ [0, outputLength):
 *   src_idx = i * ratio
 *   lo      = floor(src_idx)
 *   hi      = min(lo + 1, inputLength - 1)
 *   frac    = src_idx - lo
 *   out[i]  = in[lo] * (1 - frac) + in[hi] * frac
 *
 * Sample-Rate, Channel-Count bleiben erhalten.
 *
 * Edge-Cases:
 *   - leerer/null Buffer       → leerer Buffer (0 Channels, length=0)
 *   - semitones=0              → identity-Kopie (jedoch neue Float32Array-Refs)
 *   - semitones NaN/Infinity   → behandelt wie 0
 *   - semitones beyond ±24     → clamped
 */
export function applyPitchShift(
  buffer: AudioBufferLike,
  options: PitchShiftOptions,
): AudioBufferLike {
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return makeEmpty(buffer?.sampleRate ?? 48000);
  }
  const st = sanitizeSemitones(options?.semitones);
  const chCount = buffer.numberOfChannels;
  const inLen = buffer.length;

  // semitones=0 → identity copy (frische Float32Array-Buffer, kein Aliasing).
  if (st === 0) {
    const channels: Float32Array[] = [];
    for (let c = 0; c < chCount; c++) {
      const src = buffer.getChannelData(c);
      const dst = new Float32Array(inLen);
      dst.set(src);
      channels.push(dst);
    }
    return {
      sampleRate: buffer.sampleRate,
      numberOfChannels: chCount,
      length: inLen,
      getChannelData: (c: number) => {
        if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
        return channels[c];
      },
    };
  }

  const ratio = Math.pow(2, st / 12);
  const outLen = Math.floor(inLen / ratio);
  if (outLen <= 0) {
    return makeEmpty(buffer.sampleRate);
  }

  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      // Bounds: hi darf inLen-1 nicht überschreiten. Bei lo===inLen-1
      // setzen wir hi=lo (frac wird dann i.d.R. 0 sein, aber falls Float-
      // Rundung anders entscheidet → kein Out-of-Range-Read).
      const hi = lo + 1 < inLen ? lo + 1 : inLen - 1;
      const frac = srcIdx - lo;
      dst[i] = src[lo] * (1 - frac) + src[hi] * frac;
    }
    channels.push(dst);
  }

  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: outLen,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}
