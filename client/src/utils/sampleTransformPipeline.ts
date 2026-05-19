/**
 * Synthstudio – sampleTransformPipeline.ts (v3.136.0)
 *
 * Pure-Helper für die Sample-Transform-Dialog UI: kombiniert die vier Operationen
 * (Trim, Reverse, Fade-In, Fade-Out, Normalize) in einer deterministischen
 * Pipeline-Reihenfolge:
 *
 *   Trim-Silence → Reverse → Fade-In → Fade-Out → Auto-Normalize
 *
 * Stretch+Pitch läuft separat im Dialog VOR dieser Pipeline (combinedTransformAsync
 * im Worker) — das ändern wir hier NICHT.
 *
 * Closes v3.132 + v3.133 + v3.135 UI-Wiring-Caveats: bündelt die Pure-Helpers aus
 *  - sampleAutoNormalize.ts (autoNormalizeSample)
 *  - sampleFadeReverse.ts   (trimSilence, reverseSample, fadeInSample, fadeOutSample)
 *
 * Pure, DOM-frei, Node-testbar.  Tests: tests/features/sample-transform-pipeline.test.ts.
 */

import type { AudioBufferLike } from "./sampleEmbedding";
import { autoNormalizeSample, DEFAULT_NORMALIZE_TARGET_DBTP } from "./sampleAutoNormalize";
import {
  reverseSample,
  fadeInSample,
  fadeOutSample,
  trimSilence,
  DEFAULT_TRIM_THRESHOLD,
  type FadeCurve,
} from "./sampleFadeReverse";
import { applyBeatRepeat, rateSamplesFromBpm } from "./beatRepeat";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface TransformPipelineOptions {
  /** Trim-Silence am Anfang + Ende vor allen anderen Ops. Default false. */
  trimSilence?: boolean;
  /** Linear amplitude threshold für trimSilence. Default 0.001 (≈ -60 dB). */
  trimThreshold?: number;
  /** Reverse-Sample nach trim. Default false. */
  reverse?: boolean;
  /** Fade-In-Dauer in ms (0 = disabled). Default 0. */
  fadeInMs?: number;
  /** Fade-Out-Dauer in ms (0 = disabled). Default 0. */
  fadeOutMs?: number;
  /** Fade-Curve für In + Out. Default "linear". */
  fadeCurve?: FadeCurve;
  /** Auto-Normalize auf normalizeTargetDbTp. Default false. */
  normalize?: boolean;
  /** Ziel-True-Peak für Normalize. Default -1 dBTP (Streaming-Standard). */
  normalizeTargetDbTp?: number;
  /** v3.143: Beat-Repeat (Stutter) anwenden. Default false. */
  beatRepeat?: boolean;
  /**
   * v3.143: Beat-Repeat Rate als BPM-Division (z.B. "1/8", "1/16"). Mit beatRepeatBpm
   * wird daraus die Sample-Count berechnet. Default "1/8".
   */
  beatRepeatDivision?: number;
  /** v3.143: BPM für Beat-Repeat Rate-Berechnung. Default 120. */
  beatRepeatBpm?: number;
  /** v3.143: Feedback 0..1 (jeder Repeat damped). Default 0. */
  beatRepeatFeedback?: number;
  /** v3.143: Crossfade in ms an Loop-Boundary. Default 0. */
  beatRepeatCrossfadeMs?: number;
}

export interface TransformPipelineResult {
  /** Transformierter Buffer (immutable, neue Float32Array-Kopien pro Op). */
  buffer: AudioBufferLike;
  /** Angewandter Normalize-Gain in dB (0 wenn normalize=false oder Silence). */
  normalizeGainDb: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet die Pipeline-Ops in deterministischer Reihenfolge an.
 *
 * Reihenfolge (fix):
 *   1. trimSilence    (wenn options.trimSilence)
 *   2. beatRepeat     (wenn options.beatRepeat — v3.143)
 *   3. reverseSample  (wenn options.reverse)
 *   4. fadeInSample   (wenn options.fadeInMs > 0)
 *   5. fadeOutSample  (wenn options.fadeOutMs > 0)
 *   6. autoNormalize  (wenn options.normalize)
 *
 * Nur aktive Ops werden angewandt — andere passen den Buffer 1:1 durch.
 * Bei `options = {}` (alle off) wird der Original-Buffer-Inhalt unverändert
 * zurückgegeben (length/channels/sampleRate match, channelData identisch).
 *
 * Pure & deterministisch.
 */
export function applyTransformPipeline(
  buffer: AudioBufferLike,
  options: TransformPipelineOptions = {},
): TransformPipelineResult {
  let current: AudioBufferLike = buffer;
  let normalizeGainDb = 0;

  if (options.trimSilence) {
    const thresh = Number.isFinite(options.trimThreshold)
      ? (options.trimThreshold as number)
      : DEFAULT_TRIM_THRESHOLD;
    current = trimSilence(current, thresh);
  }

  // v3.143: Beat-Repeat NACH Trim aber VOR Reverse — so kann der User
  // Stutter+Reverse als Combo verwenden, was musikalisch interessanter ist.
  if (options.beatRepeat) {
    const bpm = options.beatRepeatBpm ?? 120;
    const division = options.beatRepeatDivision ?? 0.5; // 1/8 default
    const rate = rateSamplesFromBpm(bpm, current.sampleRate, division);
    const crossfadeSamples = options.beatRepeatCrossfadeMs
      ? Math.floor((options.beatRepeatCrossfadeMs / 1000) * current.sampleRate)
      : 0;
    current = applyBeatRepeat(current, {
      rateSamples: rate,
      feedback: options.beatRepeatFeedback ?? 0,
      crossfadeSamples,
    });
  }

  if (options.reverse) {
    current = reverseSample(current);
  }

  if (typeof options.fadeInMs === "number" && options.fadeInMs > 0) {
    const curve: FadeCurve = options.fadeCurve ?? "linear";
    current = fadeInSample(current, options.fadeInMs, curve);
  }

  if (typeof options.fadeOutMs === "number" && options.fadeOutMs > 0) {
    const curve: FadeCurve = options.fadeCurve ?? "linear";
    current = fadeOutSample(current, options.fadeOutMs, curve);
  }

  if (options.normalize) {
    const target = Number.isFinite(options.normalizeTargetDbTp)
      ? (options.normalizeTargetDbTp as number)
      : DEFAULT_NORMALIZE_TARGET_DBTP;
    const normResult = autoNormalizeSample(current, { targetDbTp: target });
    current = normResult.buffer;
    normalizeGainDb = normResult.gainAppliedDb;
  }

  return {
    buffer: current,
    normalizeGainDb,
  };
}
