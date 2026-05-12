/**
 * Synthstudio – timeStretch.ts
 *
 * Zeit-Dehnung / -Stauchung über Web Audio API:
 * playbackRate steuert Abspielgeschwindigkeit, detune kompensiert die Tonhöhe.
 *
 * Mathematik:
 *   stretchRatio 2.0 → doppelt so lang, gleiche Tonhöhe
 *   stretchRatio 0.5 → halb so lang, gleiche Tonhöhe
 *   detune = -log2(stretchRatio) × 1200 Cents
 *
 * Qualität: Linear-Interpolation (keine Phase Vocoder / WSOLA).
 * Für professionelle Qualität wäre ein AudioWorklet mit WSOLA nötig.
 * Praxistauglich für ±50% Stretch (0.5x–2.0x).
 */

export const STRETCH_MIN = 0.25;
export const STRETCH_MAX = 4.0;
export const STRETCH_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

export interface StretchedPlayback {
  /** Faktischer Stretch-Faktor (1.0 = Original) */
  stretchRatio: number;
  /** playbackRate für AudioBufferSourceNode */
  playbackRate: number;
  /** detune in Cents für AudioBufferSourceNode */
  detune: number;
  /** Effektive Dauer des Samples nach Stretch in Sekunden */
  effectiveDuration: number;
}

/**
 * Berechnet playbackRate + detune für Zeit-Dehnung ohne Pitch-Änderung.
 * @param stretchRatio  1.0 = Original, 2.0 = doppelt so lang, 0.5 = halb so lang
 * @param originalDuration Originale Sample-Dauer in Sekunden
 */
export function computeStretch(
  stretchRatio: number,
  originalDuration: number,
): StretchedPlayback {
  const ratio = Math.max(STRETCH_MIN, Math.min(STRETCH_MAX, stretchRatio));
  const playbackRate = 1 / ratio;                          // langsamer = länger
  const detune = -Math.log2(playbackRate) * 1200;          // Tonhöhe zurückkorrigieren
  return {
    stretchRatio:      ratio,
    playbackRate,
    detune,
    effectiveDuration: originalDuration * ratio,
  };
}

/**
 * Wendet Time-Stretch auf einen AudioBufferSourceNode an.
 */
export function applyStretch(
  src: AudioBufferSourceNode,
  stretch: StretchedPlayback,
): void {
  src.playbackRate.value = stretch.playbackRate;
  src.detune.value = stretch.detune;
}

/** Formatiert einen Stretch-Faktor als lesbaren String (z.B. "1.5×"). */
export function formatStretch(ratio: number): string {
  if (Math.abs(ratio - 1) < 0.01) return "1× (Original)";
  return `${ratio.toFixed(2)}×`;
}

/** Berechnet Stretch-Ratio aus BPM-Original und BPM-Ziel. */
export function stretchFromBpm(originalBpm: number, targetBpm: number): number {
  if (originalBpm <= 0 || targetBpm <= 0) return 1;
  return originalBpm / targetBpm;
}
