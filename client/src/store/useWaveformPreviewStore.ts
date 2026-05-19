/**
 * Synthstudio – useWaveformPreviewStore  (v3.130.0)
 * ============================================================
 * Settings + in-memory cache notifications für Mini-Waveform-
 * Previews im Step-Grid.
 *
 * Persistenz: localStorage `ss-waveform-preview:v1` —
 *   {showStepWaveforms:boolean}.
 * Der eigentliche Waveform-Cache lebt in `utils/waveformPreview.ts`
 * (Map<sampleId|width, number[]>) und ist NICHT persistiert (regenerated
 * on-load — Waveform-Compute ist günstig).
 *
 * Pattern: Custom-Observer-Store (kein Zustand-NPM).
 * ============================================================
 */
import { useEffect, useReducer } from "react";

export interface WaveformPreviewSettings {
  /** Mini-Waveform-Bars im Step-Grid anzeigen? Default: true (visual WOW on by default). */
  showStepWaveforms: boolean;
}

const STORAGE_KEY = "ss-waveform-preview:v1";

const DEFAULT_SETTINGS: WaveformPreviewSettings = {
  showStepWaveforms: true,
};

type Listener = () => void;

function sanitize(input: unknown): WaveformPreviewSettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_SETTINGS };
  const o = input as Record<string, unknown>;
  return {
    showStepWaveforms:
      typeof o.showStepWaveforms === "boolean"
        ? o.showStepWaveforms
        : DEFAULT_SETTINGS.showStepWaveforms,
  };
}

function load(): WaveformPreviewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitize(parsed);
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function persist(s: WaveformPreviewSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let _state: WaveformPreviewSettings = load();
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach(l => l());
}

// ─── Pure Getters ────────────────────────────────────────────────────────────

export function getWaveformPreviewSettings(): WaveformPreviewSettings {
  return _state;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export function setShowStepWaveforms(show: boolean): void {
  _state = { ..._state, showStepWaveforms: !!show };
  persist(_state);
  notify();
}

export function toggleShowStepWaveforms(): void {
  setShowStepWaveforms(!_state.showStepWaveforms);
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useWaveformPreviewStore(): WaveformPreviewSettings {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}

// ─── Test Helper ─────────────────────────────────────────────────────────────

export function __resetWaveformPreviewStoreForTests(): void {
  _state = { ...DEFAULT_SETTINGS };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}
