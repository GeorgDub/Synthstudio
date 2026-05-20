/**
 * Synthstudio – sampleStereoWidth.ts (v3.184.0)
 *
 * Pure-Helper für die Analyse der Stereo-Width eines Samples via M/S-
 * Decomposition (Mid/Side).
 *
 *   mid[i]  = (L[i] + R[i]) / 2     // mono content (sums correlate)
 *   side[i] = (L[i] - R[i]) / 2     // stereo content (differences)
 *
 *   midRms     = sqrt(Σ mid² / N)
 *   sideRms    = sqrt(Σ side² / N)
 *   widthRatio = sideRms / midRms   // 0 = mono, > 1 = sehr breit
 *   monoCompat = midRms / (midRms + sideRms)  // 1 = pure mono, 0 = pure side
 *
 * ─── Heuristik: Kategorien ──────────────────────────────────────────────────
 *
 *   ratio < 0.05  → "mono"      (effektiv kein Side-Anteil)
 *   ratio < 0.35  → "narrow"    (typischer Mono-leaning Mix)
 *   ratio < 0.75  → "balanced"  (klassischer Stereo-Pop-Mix)
 *   ratio < 1.5   → "wide"      (z. B. Pad mit Reverb, Hass-Decorrelation)
 *   ratio ≥ 1.5   → "extreme"   (Side > Mid, oft Phase-Cancellation-Risiko)
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - 1-Channel-Buffer (Mono) → width=mono, side=0, ratio=0, monoCompat=1
 * - Empty / null Buffer    → alles 0, monoCompat=1
 * - midRms = 0 && sideRms > 0 → ratio wird auf 10 geclampt (statt +Infinity)
 * - midRms = 0 && sideRms = 0 → ratio=0, monoCompat=1
 * - NaN ratio (defensiv)   → kategorisiert als "mono"
 * - >2 Channels: nimm Channel 0 und 1, ignoriere Rest.
 *
 * ─── Pure & Node-testbar (DOM-frei) ─────────────────────────────────────────
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Obergrenze für widthRatio, falls midRms ≈ 0 und sideRms > 0. */
const MAX_WIDTH_RATIO = 10;

/** Schwellen für categorizeWidth. */
const T_MONO = 0.05;
const T_NARROW = 0.35;
const T_BALANCED = 0.75;
const T_WIDE = 1.5;

// ─── Public Types ────────────────────────────────────────────────────────────

export type StereoWidthCategory = "mono" | "narrow" | "balanced" | "wide" | "extreme";

export interface StereoWidthResult {
  /** Width-Ratio: side_rms / mid_rms. 0 = mono, > 1 = sehr breit. */
  widthRatio: number;
  /** Mid-RMS amplitude. */
  midRms: number;
  /** Side-RMS amplitude. */
  sideRms: number;
  /** Mono-Compatibility-Score 0..1 (1 = vollständig mono-kompatibel, kein Phase-Cancellation). */
  monoCompat: number;
  /** Kategorische Einordnung. */
  width: StereoWidthCategory;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analysiert die Stereo-Width via M/S-Decomposition.  Liefert RMS-Werte für
 * Mid und Side, das Width-Ratio (side/mid), den Mono-Compatibility-Score
 * sowie eine kategorische Einordnung.
 */
export function analyzeStereoWidth(
  buffer: AudioBufferLike | null | undefined,
): StereoWidthResult {
  // Empty / invalid buffer → neutral defaults (mono)
  if (
    !buffer ||
    buffer.length <= 0 ||
    buffer.numberOfChannels <= 0
  ) {
    return {
      widthRatio: 0,
      midRms: 0,
      sideRms: 0,
      monoCompat: 1,
      width: "mono",
    };
  }

  // Mono-Buffer (1 channel) → kein Side
  if (buffer.numberOfChannels < 2) {
    const data = buffer.getChannelData(0);
    let ss = 0;
    const n = buffer.length;
    for (let i = 0; i < n; i++) {
      const v = data[i] ?? 0;
      ss += v * v;
    }
    const midRms = n > 0 ? Math.sqrt(ss / n) : 0;
    return {
      widthRatio: 0,
      midRms,
      sideRms: 0,
      monoCompat: 1,
      width: "mono",
    };
  }

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const n = buffer.length;

  let midSs = 0;
  let sideSs = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    midSs += m * m;
    sideSs += s * s;
  }

  const midRms = n > 0 ? Math.sqrt(midSs / n) : 0;
  const sideRms = n > 0 ? Math.sqrt(sideSs / n) : 0;

  let widthRatio: number;
  let monoCompat: number;

  if (midRms <= 0 && sideRms <= 0) {
    widthRatio = 0;
    monoCompat = 1;
  } else if (midRms <= 0) {
    // pure side (extreme phase opposite) → clamp ratio, monoCompat=0
    widthRatio = MAX_WIDTH_RATIO;
    monoCompat = 0;
  } else {
    const raw = sideRms / midRms;
    widthRatio = Number.isFinite(raw) ? Math.min(raw, MAX_WIDTH_RATIO) : MAX_WIDTH_RATIO;
    monoCompat = midRms / (midRms + sideRms);
  }

  return {
    widthRatio,
    midRms,
    sideRms,
    monoCompat,
    width: categorizeWidth(widthRatio),
  };
}

/**
 * Kategorisiert ein Width-Ratio in eine semantische Bucket-Klasse.
 *
 *   < 0.05 → "mono"
 *   < 0.35 → "narrow"
 *   < 0.75 → "balanced"
 *   < 1.5  → "wide"
 *   ≥ 1.5  → "extreme"
 *
 * NaN / nicht-finite Werte → "mono" (defensiv).
 */
export function categorizeWidth(ratio: number): StereoWidthCategory {
  if (!Number.isFinite(ratio) || Number.isNaN(ratio)) return "mono";
  if (ratio < T_MONO) return "mono";
  if (ratio < T_NARROW) return "narrow";
  if (ratio < T_BALANCED) return "balanced";
  if (ratio < T_WIDE) return "wide";
  return "extreme";
}
