/**
 * Synthstudio – usePatternCrossfadeStore (v3.123.0)
 * ============================================================
 * Globale Crossfade-Konfig fuer Pattern-Switches.
 *
 * Persistenz: localStorage `ss-pattern-crossfade:v1` —
 *   {enabled:boolean, lengthSteps:number, curve:CrossfadeCurve}.
 *
 * Single config (kein per-pattern override) — pragmatischer
 * Default fuer v3.123.0. Future: pro Song-Step override.
 *
 * Pattern: Custom-Observer-Store (kein Zustand-NPM).
 * ============================================================
 */
import { useEffect, useReducer } from "react";
import {
  type CrossfadeConfig,
  type CrossfadeCurve,
  DEFAULT_CONFIG,
  clampLength,
  sanitizeConfig,
  sanitizeCurve,
} from "@/utils/patternCrossfade";

const STORAGE_KEY = "ss-pattern-crossfade:v1";

type Listener = () => void;

function load(): CrossfadeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeConfig(parsed);
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

function persist(cfg: CrossfadeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

let _state: CrossfadeConfig = load();
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach(l => l());
}

// ─── Pure Getters ────────────────────────────────────────────────────────────

export function getPatternCrossfadeState(): CrossfadeConfig {
  return _state;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export function setEnabled(enabled: boolean): void {
  _state = { ..._state, enabled: !!enabled };
  persist(_state);
  notify();
}

export function setLength(lengthSteps: number): void {
  _state = { ..._state, lengthSteps: clampLength(lengthSteps) };
  persist(_state);
  notify();
}

export function setCurve(curve: CrossfadeCurve): void {
  _state = { ..._state, curve: sanitizeCurve(curve) };
  persist(_state);
  notify();
}

export function resetCrossfade(): void {
  _state = { ...DEFAULT_CONFIG };
  persist(_state);
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function usePatternCrossfadeStore(): CrossfadeConfig {
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

export function __resetPatternCrossfadeStoreForTests(): void {
  _state = { ...DEFAULT_CONFIG };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export type { CrossfadeConfig, CrossfadeCurve };
