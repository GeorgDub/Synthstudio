/**
 * Synthstudio – sampleAutoNormalize.ts (v3.132.0)
 *
 * Pure-Helpers für Auto-Normalize-Workflows in der Sample-Library / Transform-
 * Dialog.  Berechnet aktuelle Peak (sample-peak oder True-Peak via FIR) und
 * schlägt einen Gain-Wert vor um auf einen Ziel-dBTP zu kommen — typischerweise
 * -1 dBTP für Streaming-Compliance (Spotify/Apple Music) oder -0.1 dBTP für
 * "lautmöglich ohne clipping".
 *
 * Verwendet:
 *  - truePeak (v3.102) für intersample-aware Detection
 *  - dB ↔ linear Gain Konvertierung (Standard 20*log10)
 *
 * Public API:
 *  - analyzeSamplePeak(buffer, options) → SampleAnalysis
 *  - computeNormalizeGain(currentDbTp, targetDbTp) → number (linear factor)
 *  - applyGainToBuffer(buffer, gainLinear) → AudioBufferLike (new copy)
 *  - DEFAULT_NORMALIZE_TARGET_DBTP = -1.0
 *
 * Pure & Node-testbar (DOM-frei).
 */

import { truePeak } from "@/audio/TruePeakMeter";
import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/**
 * Streaming-Standard für True-Peak. Spotify und Apple Music verlangen
 * -1 dBTP für sauberes Loudness-Mastering.
 */
export const DEFAULT_NORMALIZE_TARGET_DBTP = -1.0;

/**
 * Max-Boost-Cap für die Suggestion. Bei sehr leisen Samples würde die Math
 * sonst beliebig große Gain-Werte vorschlagen (+60 dB Quasi-Silence-Boost).
 * Wir cappen bei +24 dB pragmatisch.
 */
export const MAX_NORMALIZE_BOOST_DB = 24;

/**
 * Untergrenze für Peak — Samples mit weniger als -90 dBTP gelten als Silence
 * und liefern KEINE Suggestion (Caller soll dann disablen).
 */
export const SILENCE_THRESHOLD_DBTP = -90;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface AnalyzeSampleOptions {
  /** 1 = sample-peak only, 4 (default) = ITU-R BS.1770-4 True-Peak. */
  oversampling?: number;
  /** Channel-Strategy: "max" (peak of all), "left", "right" (mono). */
  channelMode?: "max" | "left" | "right";
}

export interface SampleAnalysis {
  /** Maximum sample-amplitude (peak nach optional oversample) — linear, 0..∞. */
  peakLinear: number;
  /** dBTP — -Infinity bei Silence. */
  peakDbTp: number;
  /** True wenn unterhalb SILENCE_THRESHOLD_DBTP. */
  isSilence: boolean;
  /** Anzahl Channels die analysiert wurden (1 oder 2). */
  channelsAnalyzed: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analysiert einen AudioBuffer und liefert Peak-Statistik.
 * Defensive bei leerem Buffer, 0 Channels, NaN-Samples.
 */
export function analyzeSamplePeak(
  buffer: AudioBufferLike,
  options: AnalyzeSampleOptions = {},
): SampleAnalysis {
  const oversampling = options.oversampling ?? 4;
  const channelMode = options.channelMode ?? "max";

  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      peakLinear: 0,
      peakDbTp: -Infinity,
      isSilence: true,
      channelsAnalyzed: 0,
    };
  }

  let channelsToCheck = 0;
  let maxDbTp = -Infinity;

  // Mono oder Stereo Strategie
  const chCount = Math.min(2, buffer.numberOfChannels);
  if (channelMode === "left") {
    const db = truePeak(buffer.getChannelData(0), oversampling);
    maxDbTp = db;
    channelsToCheck = 1;
  } else if (channelMode === "right") {
    const ch = Math.min(1, buffer.numberOfChannels - 1);
    const db = truePeak(buffer.getChannelData(ch), oversampling);
    maxDbTp = db;
    channelsToCheck = 1;
  } else {
    // "max": max of all available channels (mono = 1, stereo = 2).
    for (let c = 0; c < chCount; c++) {
      const db = truePeak(buffer.getChannelData(c), oversampling);
      if (db > maxDbTp) maxDbTp = db;
    }
    channelsToCheck = chCount;
  }

  const peakLinear = maxDbTp === -Infinity ? 0 : Math.pow(10, maxDbTp / 20);
  return {
    peakLinear,
    peakDbTp: maxDbTp,
    isSilence: maxDbTp < SILENCE_THRESHOLD_DBTP,
    channelsAnalyzed: channelsToCheck,
  };
}

/**
 * Berechnet den Linear-Gain-Faktor um current-dBTP auf target-dBTP zu hieven.
 *
 *   gainDb = target - current
 *   gainLinear = 10 ^ (gainDb / 20)
 *
 * Sicherheits-Clamps:
 *  - Silence (current = -Infinity) → 1.0 (no-op)
 *  - gainDb > MAX_NORMALIZE_BOOST_DB → cap
 *  - gainDb < -60 → 0 (Quasi-Mute, kein Negativ-Gain-Sinn)
 *
 * Pure & deterministisch.
 */
export function computeNormalizeGain(
  currentDbTp: number,
  targetDbTp: number = DEFAULT_NORMALIZE_TARGET_DBTP,
): number {
  if (!Number.isFinite(currentDbTp)) return 1.0; // Silence → no-op
  if (!Number.isFinite(targetDbTp)) return 1.0;

  let gainDb = targetDbTp - currentDbTp;
  if (gainDb > MAX_NORMALIZE_BOOST_DB) gainDb = MAX_NORMALIZE_BOOST_DB;
  if (gainDb < -60) gainDb = -60;
  return Math.pow(10, gainDb / 20);
}

/**
 * Applied einen Linear-Gain auf alle Channels eines AudioBuffer. Returns
 * eine neue Float32Array-basierte Kopie (immutable). Channels werden 1:1
 * kopiert. Bei gain=1.0 wird trotzdem neuer Buffer erstellt (idempotent).
 *
 * Defensive: NaN-Samples bleiben NaN (kein replace zu 0 — Caller's Pflicht).
 */
export function applyGainToBuffer(
  buffer: AudioBufferLike,
  gainLinear: number,
): AudioBufferLike {
  if (!buffer || buffer.length === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }
  const g = Number.isFinite(gainLinear) ? gainLinear : 1.0;
  const chCount = buffer.numberOfChannels;
  const len = buffer.length;
  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) dst[i] = src[i] * g;
    channels.push(dst);
  }
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (channel: number) => {
      if (channel < 0 || channel >= chCount) {
        throw new RangeError(`getChannelData: index ${channel} out of range`);
      }
      return channels[channel];
    },
  };
}

/**
 * Convenience: analysiert + normalisiert in einem Step.
 * Returns {normalizedBuffer, originalAnalysis, gainApplied}.
 *
 * Bei Silence → originalBuffer unverändert + gainApplied = 1.
 */
export function autoNormalizeSample(
  buffer: AudioBufferLike,
  options: AnalyzeSampleOptions & { targetDbTp?: number } = {},
): {
  buffer: AudioBufferLike;
  originalAnalysis: SampleAnalysis;
  gainApplied: number;
  gainAppliedDb: number;
} {
  const analysis = analyzeSamplePeak(buffer, options);
  if (analysis.isSilence) {
    return {
      buffer,
      originalAnalysis: analysis,
      gainApplied: 1.0,
      gainAppliedDb: 0,
    };
  }
  const gain = computeNormalizeGain(
    analysis.peakDbTp,
    options.targetDbTp ?? DEFAULT_NORMALIZE_TARGET_DBTP,
  );
  const gainDb = 20 * Math.log10(gain);
  return {
    buffer: applyGainToBuffer(buffer, gain),
    originalAnalysis: analysis,
    gainApplied: gain,
    gainAppliedDb: gainDb,
  };
}
