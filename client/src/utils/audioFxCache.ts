/**
 * audioFxCache.ts — Sprint-106 Synth-FX Persistence.
 *
 * localStorage-Cache fuer SimAudioEngine.AudioFxSettings.
 * Schema v1, key "synthstudio:audioFx.v1".
 */

import { DEFAULT_FX, type AudioFxSettings, type Waveform } from "../audio/SimAudioEngine";

const CACHE_KEY = "synthstudio:audioFx.v1";

const VALID_WAVEFORMS: Waveform[] = ["sine", "sawtooth", "square", "triangle"];

export function loadAudioFxCache(): AudioFxSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_FX };
  }
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...DEFAULT_FX };
    const parsed = JSON.parse(raw) as Partial<AudioFxSettings>;
    return {
      waveform: VALID_WAVEFORMS.includes(parsed.waveform as Waveform)
        ? (parsed.waveform as Waveform)
        : DEFAULT_FX.waveform,
      filterCutoffHz: clamp(parsed.filterCutoffHz, 40, 20000, DEFAULT_FX.filterCutoffHz),
      filterQ: clamp(parsed.filterQ, 0.1, 20, DEFAULT_FX.filterQ),
      delayTimeS: clamp(parsed.delayTimeS, 0, 1.5, DEFAULT_FX.delayTimeS),
      delayFeedback: clamp(parsed.delayFeedback, 0, 0.95, DEFAULT_FX.delayFeedback),
      masterGain: clamp(parsed.masterGain, 0, 1, DEFAULT_FX.masterGain),
    };
  } catch {
    return { ...DEFAULT_FX };
  }
}

export function saveAudioFxCache(s: AudioFxSettings): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch { /* */ }
}

export function clearAudioFxCache(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try { window.localStorage.removeItem(CACHE_KEY); } catch { /* */ }
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
