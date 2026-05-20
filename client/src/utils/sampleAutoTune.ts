/**
 * Synthstudio – sampleAutoTune.ts (v3.187.0)
 *
 * Pure-Helper für Sample-AutoTune: erkennt die dominante Tonhöhe (Pitch) eines
 * Audio-Samples via Autocorrelation und snappt das Ergebnis auf die nächste
 * Note in einer Target-Scale (z.B. C-Dur). Foundation für künftige
 * Sample-Browser-Features:
 *
 *   - "Tune"-Spalte (detected note pro Sample im Browser)
 *   - "Tune-to-Scale"-Batch-Operation für Drum-Kits
 *   - Performance-Mode "Auto-Tune Pad" beim Sample-Trigger
 *
 * ─── Algorithmus ────────────────────────────────────────────────────────────
 *
 *   1. Sample → Mono-Downmix (Channel 0, defensiv)
 *   2. Autocorrelation r(τ) = Σ s[i] * s[i+τ]  für τ ∈ [minLag, maxLag]
 *      mit  minLag = floor(sampleRate / maxFreq)
 *           maxLag = ceil(sampleRate / minFreq)
 *   3. Peak in r(τ) suchen → hz = sampleRate / peakLag
 *   4. confidence = peak_r / r(0)   (clamped to [0, 1])
 *   5. midi = 69 + 12 * log2(hz / 440)
 *   6. Snap auf nearest Scale-Note via SCALE_INTERVALS (mit Octave-Wrap)
 *
 * ─── Konventionen ───────────────────────────────────────────────────────────
 *
 *   - Liefert NUR die Analysis-Result — keine actual pitch-shifting des Audios.
 *     Für echte Pitch-Manipulation Caller nutzt sampleTransform o.ä. mit
 *     dem zurückgelieferten semitoneShift.
 *   - detectedHz === -1  ↔  "nicht erkannt" (silent / zu kurz / no peak)
 *     In diesem Fall ist detectedMidi ebenfalls -1, targetMidi = rootMidi,
 *     semitoneShift = 0.
 *   - confidence ∈ [0, 1]; 0 wenn nicht erkannt, ~1.0 für perfekte Sine.
 *
 * ─── Pure & Node-testbar (DOM-frei) ─────────────────────────────────────────
 */

import type { AudioBufferLike } from "./sampleEmbedding";
import { SCALE_INTERVALS, type ScaleType } from "./randomChordGenerator";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default-Minimum-Frequency für die Pitch-Detection (untere Grenze). */
export const DEFAULT_MIN_FREQ = 80;

/** Default-Maximum-Frequency für die Pitch-Detection (obere Grenze). */
export const DEFAULT_MAX_FREQ = 1000;

/** Default-Root-Note (MIDI 60 = C4). */
export const DEFAULT_ROOT_MIDI = 60;

/** Default-Scale für den Snap. */
export const DEFAULT_SCALE: ScaleType = "major";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface AutoTuneOptions {
  /** Target-Scale für den Snap. Default "major". */
  scale?: ScaleType;
  /** Root-Note der Scale (MIDI 0..127). Default 60 (C4). */
  rootMidi?: number;
  /** Min frequency to detect (Hz). Default 80. */
  minFreq?: number;
  /** Max frequency to detect (Hz). Default 1000. */
  maxFreq?: number;
}

export interface AutoTuneResult {
  /** Detected pitch in Hz (-1 if not detected). */
  detectedHz: number;
  /** MIDI-Note des detected pitch (-1 if not detected). */
  detectedMidi: number;
  /** Target-Note nach Snap. */
  targetMidi: number;
  /** Pitch-Shift in semitones (target - detected). 0 wenn nicht erkannt. */
  semitoneShift: number;
  /** Confidence 0..1 of detection. */
  confidence: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect pitch via Autocorrelation und snap zu nearest Scale-Note.
 *
 * Defensive Defaults:
 *  - empty / silent buffer → detectedHz=-1, confidence=0, targetMidi=rootMidi
 *  - invalid scale → "major"
 *  - invalid rootMidi → 60
 *  - minFreq/maxFreq invalid → 80/1000
 */
export function analyzeAutoTune(
  buffer: AudioBufferLike,
  options?: AutoTuneOptions,
): AutoTuneResult {
  const scale = normalizeScale(options?.scale);
  const rootMidi = normalizeRootMidi(options?.rootMidi);
  const minFreq = normalizeMinFreq(options?.minFreq);
  const maxFreq = normalizeMaxFreq(options?.maxFreq);

  // ── Edge: leeres / fehlendes Buffer ────────────────────────────────────────
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return makeMissDetection(rootMidi);
  }

  // ── Mono-Downmix (Channel 0 — kein Mix-Average nötig für Pitch-Detection) ──
  const mono = buffer.getChannelData(0);

  // ── Autocorrelation-basiertes Pitch-Detection ──────────────────────────────
  const { hz, confidence } = detectPitchAutocorrelation(
    mono,
    buffer.sampleRate,
    minFreq,
    maxFreq,
  );

  if (hz <= 0 || !Number.isFinite(hz)) {
    return makeMissDetection(rootMidi);
  }

  // ── MIDI-Konvertierung + Snap-to-Scale ─────────────────────────────────────
  const detectedMidi = hzToMidi(hz);
  const targetMidi = snapToScale(detectedMidi, rootMidi, scale);
  const semitoneShift = targetMidi - detectedMidi;

  return {
    detectedHz: hz,
    detectedMidi,
    targetMidi,
    semitoneShift,
    confidence,
  };
}

/**
 * Pure-helper: detect pitch via Autocorrelation.
 *
 * Liefert { hz: -1, confidence: 0 }, wenn:
 *  - samples zu kurz für maxLag
 *  - kein positiver Peak gefunden
 *  - r(0) === 0 (totales Silence)
 *
 * Defensive Defaults für minFreq/maxFreq (≤ 0 oder !isFinite).
 */
export function detectPitchAutocorrelation(
  samples: Float32Array,
  sampleRate: number,
  minFreq?: number,
  maxFreq?: number,
): { hz: number; confidence: number } {
  if (!samples || samples.length === 0 || sampleRate <= 0) {
    return { hz: -1, confidence: 0 };
  }

  const fLow = normalizeMinFreq(minFreq);
  const fHigh = normalizeMaxFreq(maxFreq);

  // Lag-Bereich: hohe Frequenz → kleiner lag, tiefe Frequenz → großer lag.
  const minLag = Math.max(1, Math.floor(sampleRate / fHigh));
  const maxLag = Math.max(minLag + 1, Math.ceil(sampleRate / fLow));

  // Wir brauchen mindestens maxLag+1 samples, sonst können wir τ=maxLag
  // nicht berechnen.
  if (samples.length < maxLag + 1) {
    return { hz: -1, confidence: 0 };
  }

  // r(0) = Σ s[i]²  — Normalisierungsbasis.
  let r0 = 0;
  for (let i = 0; i < samples.length; i++) r0 += samples[i] * samples[i];
  if (r0 <= 0) {
    return { hz: -1, confidence: 0 };
  }

  // Peak-Suche im Lag-Range.
  let peakLag = -1;
  let peakR = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    const end = samples.length - lag;
    for (let i = 0; i < end; i++) {
      r += samples[i] * samples[i + lag];
    }
    if (r > peakR) {
      peakR = r;
      peakLag = lag;
    }
  }

  if (peakLag <= 0 || peakR <= 0) {
    return { hz: -1, confidence: 0 };
  }

  const hz = sampleRate / peakLag;
  // confidence = peak / r(0), clamped to [0, 1].
  let confidence = peakR / r0;
  if (!Number.isFinite(confidence) || confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return { hz, confidence };
}

/**
 * Konvertiert Hz → MIDI-Note (float, nicht gerundet).
 *   midi = 69 + 12 * log2(hz / 440)
 *
 * Defensive: hz ≤ 0 → -1.
 */
export function hzToMidi(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return -1;
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Snap eine erkannte MIDI-Note (float) zur nächstgelegenen Scale-Note,
 * basierend auf rootMidi + SCALE_INTERVALS[scale].
 *
 * Octave-Wrap-Aware: prüft den Abstand zu jedem Interval in der aktuellen
 * Oktave UND eine drunter UND eine drüber, damit z.B. ein detected B
 * (interval 11) bei einer Scale, deren max-interval 10 ist, korrekt zum
 * nächsten Root (next-octave interval 0) snappt statt zur weit-entfernten
 * interval 10.
 *
 * Defensive: detectedMidi=-1 → rootMidi.
 */
export function snapToScale(
  detectedMidi: number,
  rootMidi: number,
  scale: ScaleType,
): number {
  if (!Number.isFinite(detectedMidi) || detectedMidi < 0) {
    return rootMidi;
  }
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.major;
  const diff = detectedMidi - rootMidi;
  const octaveOffset = Math.floor(diff / 12);

  let bestDist = Infinity;
  let bestTarget = rootMidi;

  for (const iv of intervals) {
    // Drei Kandidaten: in der aktuellen Oktave, eine drunter, eine drüber.
    const candidates = [
      rootMidi + octaveOffset * 12 + iv,
      rootMidi + (octaveOffset - 1) * 12 + iv,
      rootMidi + (octaveOffset + 1) * 12 + iv,
    ];
    for (const cand of candidates) {
      const dist = Math.abs(detectedMidi - cand);
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = cand;
      }
    }
  }

  // Auf den nächsten Integer runden — das Ergebnis MUSS eine ganze MIDI-Note
  // sein, auch wenn detectedMidi ein Float zwischen zwei Bins liegt.
  return Math.round(bestTarget);
}

// ─── Internals ───────────────────────────────────────────────────────────────

function normalizeScale(scale: ScaleType | undefined): ScaleType {
  if (scale && Object.prototype.hasOwnProperty.call(SCALE_INTERVALS, scale)) {
    return scale;
  }
  return DEFAULT_SCALE;
}

function normalizeRootMidi(rootMidi: number | undefined): number {
  if (rootMidi === undefined || !Number.isFinite(rootMidi)) return DEFAULT_ROOT_MIDI;
  if (rootMidi < 0 || rootMidi > 127) return DEFAULT_ROOT_MIDI;
  return Math.round(rootMidi);
}

function normalizeMinFreq(freq: number | undefined): number {
  if (freq === undefined || !Number.isFinite(freq) || freq <= 0) {
    return DEFAULT_MIN_FREQ;
  }
  return freq;
}

function normalizeMaxFreq(freq: number | undefined): number {
  if (freq === undefined || !Number.isFinite(freq) || freq <= 0) {
    return DEFAULT_MAX_FREQ;
  }
  return freq;
}

function makeMissDetection(rootMidi: number): AutoTuneResult {
  return {
    detectedHz: -1,
    detectedMidi: -1,
    targetMidi: rootMidi,
    semitoneShift: 0,
    confidence: 0,
  };
}