/**
 * Synthstudio sampleRmsEnvelope.ts (v3.178.0)
 *
 * Pure-Helper fuer die frame-weise Berechnung der RMS-Envelope (Huellkurve)
 * eines Audio-Samples. RMS (Root-Mean-Square) ist eine robuste Energie-
 * Metrik und sehr nahe an der menschlichen Lautheitswahrnehmung.
 *
 * Foundation fuer:
 *   - Waveform-Display (energy-bars statt Peak-min/max-bars)
 *   - Auto-Fade-Detection (Onset / Tail-Decay Punkte)
 *   - Auto-Trim-Silence (Head + Tail)
 *   - Envelope-Follower-Visualisierung
 *   - Adaptive Slice-Detection mit RMS-Energy
 *
 * Algorithmus:
 *   1. Sample Mono-Downmix (oder selektiv L/R)
 *   2. Frame-Loop:
 *        for each frame_start = 0, hop, 2*hop, ...
 *          rms[i] = sqrt( Sigma(x[frame_start..frame_start+frameSize]^2) / frameSize )
 *   3. samplePositions[i] = i * hopSize
 *   4. peakRms = max(envelope), meanRms = sum(envelope) / count
 *
 * Defensive Defaults:
 *   - empty buffer leerer Output (peak=0, mean=0)
 *   - frameSize < 64 64 (verhindert nutzlose 1-Sample-Frames)
 *   - hopSize  < 1  1
 *   - threshold NaN / <0 / >1 0.1 (Default)
 *
 * Pure und Node-testbar (DOM-frei).
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// Konstanten

/** Default-Frame-Size. 1024 Samples ~ 21 ms bei 48 kHz. */
export const DEFAULT_FRAME_SIZE = 1024;

/** Default-Hop-Size (50% Overlap). */
export const DEFAULT_HOP_SIZE = 512;

/** Untere Grenze fuer frameSize (verhindert Ein-Sample-Frames). */
export const MIN_FRAME_SIZE = 64;

/** Default-Threshold fuer Onset/FadeOut-Detection (10% Peak). */
export const DEFAULT_THRESHOLD = 0.1;

// Public Types

export interface RmsEnvelopeOptions {
  /** Frame-Size samples. Default 1024. */
  frameSize?: number;
  /** Hop-Size samples. Default 512 (50% overlap). */
  hopSize?: number;
  /** Channel-Strategy. Default "mix". */
  channelMode?: "mix" | "left" | "right";
}

export interface RmsEnvelopeResult {
  /** Envelope-Werte (linear amplitude, 0..1). */
  envelope: Float32Array;
  /** Sample-Position jedes Envelope-Werts. */
  samplePositions: Int32Array;
  /** Peak-Wert in envelope. */
  peakRms: number;
  /** Mean-RMS. */
  meanRms: number;
  /** Frame-Size verwendet. */
  frameSize: number;
  /** Hop-Size verwendet. */
  hopSize: number;
}

// Public API

/**
 * Berechnet die RMS-Envelope eines Samples frame-weise.
 *
 * Defensive Defaults:
 *  - empty / fehlendes Buffer { envelope: empty, peakRms: 0, meanRms: 0 }
 *  - frameSize < MIN_FRAME_SIZE MIN_FRAME_SIZE (64)
 *  - hopSize  < 1 1
 *  - Sample kuerzer als frameSize ein einzelnes Frame
 */
export function computeRmsEnvelope(
  buffer: AudioBufferLike,
  options?: RmsEnvelopeOptions,
): RmsEnvelopeResult {
  const frameSize = Math.max(
    MIN_FRAME_SIZE,
    Math.floor(options?.frameSize ?? DEFAULT_FRAME_SIZE),
  );
  const hopSize = Math.max(1, Math.floor(options?.hopSize ?? DEFAULT_HOP_SIZE));
  const channelMode = options?.channelMode ?? "mix";

  // Edge: leeres / fehlendes Buffer
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      envelope: new Float32Array(0),
      samplePositions: new Int32Array(0),
      peakRms: 0,
      meanRms: 0,
      frameSize,
      hopSize,
    };
  }

  // Channel-Auswahl / Downmix
  const mono = extractMonoChannel(buffer, channelMode);
  const n = mono.length;

  // Anzahl Frames bestimmen.
  //   - falls Sample kuerzer als frameSize: genau 1 Frame
  //   - sonst: 1 + floor((n - frameSize) / hopSize)
  let frameCount: number;
  if (n < frameSize) {
    frameCount = 1;
  } else {
    frameCount = 1 + Math.floor((n - frameSize) / hopSize);
  }

  const envelope = new Float32Array(frameCount);
  const samplePositions = new Int32Array(frameCount);

  let peakRms = 0;
  let sumRms = 0;

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    samplePositions[f] = start;

    // Sum of squares wir teilen IMMER durch frameSize (auch wenn zero-padded),
    // damit kurze Tail-Frames konsistent mit Volltreffer-Frames skaliert sind.
    let sumSq = 0;
    const end = Math.min(start + frameSize, n);
    for (let i = start; i < end; i++) {
      const v = mono[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / frameSize);
    envelope[f] = rms;
    if (rms > peakRms) peakRms = rms;
    sumRms += rms;
  }

  const meanRms = frameCount > 0 ? sumRms / frameCount : 0;

  return {
    envelope,
    samplePositions,
    peakRms,
    meanRms,
    frameSize,
    hopSize,
  };
}

/**
 * Findet den Sample-Index, an dem die Envelope (rueckwaerts vom Ende
 * betrachtet) zuletzt ueber `threshold * peakRms` lag.
 *
 * Nuetzlich fuer Auto-Trim-Tail-Silence: alles NACH diesem Punkt ist
 * im Wesentlichen Stille / Fade-Out-Schwanz.
 *
 * @param threshold Anteil des Peak-RMS (0..1). Default 0.1. Defensive:
 *                  NaN / <0 / >1 0.1.
 * @returns Sample-Index oder -1 wenn keine Envelope-Werte / peakRms = 0.
 */
export function findFadeOutPoint(
  envelope: RmsEnvelopeResult,
  threshold: number = DEFAULT_THRESHOLD,
): number {
  const env = envelope.envelope;
  if (env.length === 0 || envelope.peakRms <= 0) return -1;

  const t = sanitizeThreshold(threshold);
  const limit = t * envelope.peakRms;

  // Rueckwaerts: erster Frame, der >= limit ist.
  for (let i = env.length - 1; i >= 0; i--) {
    if (env[i] >= limit) {
      return envelope.samplePositions[i];
    }
  }
  return -1;
}

/**
 * Findet den ersten Sample-Index, an dem die Envelope >= `threshold * peakRms`
 * steigt also den Onset / Beginn relevanter Energie.
 *
 * Nuetzlich fuer Auto-Trim-Head-Silence.
 *
 * @param threshold Anteil des Peak-RMS (0..1). Default 0.1. Defensive:
 *                  NaN / <0 / >1 0.1.
 * @returns Sample-Index oder -1 wenn keine Envelope-Werte / peakRms = 0.
 */
export function findOnsetPoint(
  envelope: RmsEnvelopeResult,
  threshold: number = DEFAULT_THRESHOLD,
): number {
  const env = envelope.envelope;
  if (env.length === 0 || envelope.peakRms <= 0) return -1;

  const t = sanitizeThreshold(threshold);
  const limit = t * envelope.peakRms;

  for (let i = 0; i < env.length; i++) {
    if (env[i] >= limit) {
      return envelope.samplePositions[i];
    }
  }
  return -1;
}

// Internals

/**
 * Extrahiert einen Mono-Float32-Array aus dem Buffer gemaess channelMode.
 *   - "mix":   Mittelwert aller Channels
 *   - "left":  Channel 0
 *   - "right": Channel 1 (fallback auf 0 wenn mono)
 */
function extractMonoChannel(
  buffer: AudioBufferLike,
  mode: "mix" | "left" | "right",
): Float32Array {
  const n = buffer.length;
  if (n === 0) return new Float32Array(0);

  if (mode === "left") {
    return new Float32Array(buffer.getChannelData(0));
  }
  if (mode === "right") {
    const ch = buffer.numberOfChannels >= 2 ? 1 : 0;
    return new Float32Array(buffer.getChannelData(ch));
  }

  // "mix" Mittelwert aller Kanaele.
  const channels = buffer.numberOfChannels;
  if (channels === 1) return new Float32Array(buffer.getChannelData(0));

  const out = new Float32Array(n);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const inv = 1 / channels;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

/**
 * Defensive-Wrapper fuer den Threshold-Parameter.
 * NaN / <0 / >1 DEFAULT_THRESHOLD (0.1).
 */
function sanitizeThreshold(t: number): number {
  if (!Number.isFinite(t)) return DEFAULT_THRESHOLD;
  if (t < 0 || t > 1) return DEFAULT_THRESHOLD;
  return t;
}
