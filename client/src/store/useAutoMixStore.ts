/**
 * Synthstudio – useAutoMixStore.ts  (v3.122.0)
 *
 * State + Persistenz fuer "Smart Auto-Mix" (LUFS-driven Gain-Staging).
 *
 *  - Per-Channel Target-LUFS (override pro partId)
 *  - Default-Targets pro Drum-Kategorie (Kick:-10, Snare:-12, Hat:-15, …)
 *  - Mess-Dauer pro Channel (10–60s typisch; clamped 5–120s)
 *
 * Custom-Observer-Pattern (kein Zustand-NPM), localStorage-Persistenz unter
 * "ss-auto-mix:v1". Reset-Hook fuer Tests.
 */

import { useEffect, useReducer } from "react";

// ─── Konstanten ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-auto-mix:v1";

/** Min-/Max-Bounds fuer die Mess-Dauer (Safety + sinnvolle Range). */
export const MEASUREMENT_DURATION_MIN_MS = 5_000;
export const MEASUREMENT_DURATION_MAX_MS = 120_000;
export const MEASUREMENT_DURATION_DEFAULT_MS = 20_000;

/**
 * v3.122.0: Drum-Kategorien aus sampleClassifier — fuer Auto-Defaults bei
 * der Target-LUFS-Empfehlung.
 *
 * Wir importieren NICHT aus sampleClassifier (vermeidet Circular-Risk + erhaelt
 * Tests in Node ohne AudioContext lauffaehig). Stattdessen spiegeln wir die
 * Category-Liste hier — bleibt minimal in sync mit SAMPLE_CATEGORIES.
 */
export type DrumCategoryLike =
  | "kick"
  | "snare"
  | "hihat-closed"
  | "hihat-open"
  | "clap"
  | "cymbal"
  | "perc"
  | "loop"
  | "bass"
  | "synth"
  | "vocal"
  | "fx"
  | "unknown";

/**
 * Standard-Target-LUFS pro Kategorie (Mastering-Erfahrungs-Werte fuer Modern-
 * Drum-Mixes). User kann diese pro Channel ueberschreiben.
 *
 *  Kick   -10 LUFS (Frequenz-fundament, lautest)
 *  Bass   -10 LUFS (zusammen mit Kick)
 *  Snare  -12 LUFS (snare-pop, etwas leiser als Kick)
 *  Clap   -12 LUFS (analog Snare)
 *  Perc   -14 LUFS (Geister/Color-Layer)
 *  Hats   -15 LUFS (high-frequency, Wahrnehmungs-laut bei niedrigerem LUFS)
 *  Synth  -14 LUFS (typisch Lead/Pad-Background)
 *  Vocal  -12 LUFS (Vorne im Mix)
 *  FX     -16 LUFS (Atmosphaere)
 *  Loop   -12 LUFS (full-frequency)
 *  Cymbal -15 LUFS (analog Hat)
 *  Unknown-14 LUFS (Mittelwert)
 */
export const DEFAULT_TARGET_BY_CATEGORY: Record<DrumCategoryLike, number> = {
  "kick":         -10,
  "snare":        -12,
  "hihat-closed": -15,
  "hihat-open":   -15,
  "clap":         -12,
  "cymbal":       -15,
  "perc":         -14,
  "loop":         -12,
  "bass":         -10,
  "synth":        -14,
  "vocal":        -12,
  "fx":           -16,
  "unknown":      -14,
};

// ─── Persisted-State ────────────────────────────────────────────────────────

export interface AutoMixState {
  /** Per-Channel Override: Map<partId, targetLufs>. */
  channelTargets: Record<string, number>;
  /** Mess-Dauer pro Channel in Millisekunden (clamped 5_000..120_000). */
  measurementDurationMs: number;
  /** Defaults pro Kategorie (User kann anpassen, persisted). */
  defaultTargetByCategory: Record<DrumCategoryLike, number>;
}

function defaultState(): AutoMixState {
  return {
    channelTargets: {},
    measurementDurationMs: MEASUREMENT_DURATION_DEFAULT_MS,
    defaultTargetByCategory: { ...DEFAULT_TARGET_BY_CATEGORY },
  };
}

// ─── Singleton-State (Custom-Observer) ──────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
let state: AutoMixState = loadState();

function loadState(): AutoMixState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<AutoMixState>;
    const base = defaultState();
    return {
      channelTargets: parsed.channelTargets && typeof parsed.channelTargets === "object"
        ? sanitizeNumericRecord(parsed.channelTargets)
        : {},
      measurementDurationMs: clampDuration(
        Number.isFinite(parsed.measurementDurationMs)
          ? (parsed.measurementDurationMs as number)
          : base.measurementDurationMs,
      ),
      defaultTargetByCategory: parsed.defaultTargetByCategory && typeof parsed.defaultTargetByCategory === "object"
        ? { ...base.defaultTargetByCategory, ...sanitizeNumericRecord(parsed.defaultTargetByCategory) }
        : base.defaultTargetByCategory,
    };
  } catch {
    return defaultState();
  }
}

function sanitizeNumericRecord(rec: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) return MEASUREMENT_DURATION_DEFAULT_MS;
  if (ms < MEASUREMENT_DURATION_MIN_MS) return MEASUREMENT_DURATION_MIN_MS;
  if (ms > MEASUREMENT_DURATION_MAX_MS) return MEASUREMENT_DURATION_MAX_MS;
  return ms;
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore localStorage-quota / SSR */ }
}

function notify(): void {
  listeners.forEach(l => { try { l(); } catch { /* ignore listener-error */ } });
}

// ─── Public Actions ─────────────────────────────────────────────────────────

/** Setzt Per-Channel-Target-LUFS. Wert wird NICHT geclampt — User kann
 *  bewusst extreme Targets setzen (z.B. -30 fuer ambient). */
export function setChannelTarget(partId: string, targetLufs: number): void {
  if (!Number.isFinite(targetLufs)) return;
  state = {
    ...state,
    channelTargets: { ...state.channelTargets, [partId]: targetLufs },
  };
  persist();
  notify();
}

/** Loescht einen Per-Channel-Override (faellt auf Category-Default zurueck). */
export function clearChannelTarget(partId: string): void {
  if (!(partId in state.channelTargets)) return;
  const next = { ...state.channelTargets };
  delete next[partId];
  state = { ...state, channelTargets: next };
  persist();
  notify();
}

export function setMeasurementDuration(ms: number): void {
  const clamped = clampDuration(ms);
  if (clamped === state.measurementDurationMs) return;
  state = { ...state, measurementDurationMs: clamped };
  persist();
  notify();
}

export function setDefaultTarget(category: DrumCategoryLike, targetLufs: number): void {
  if (!Number.isFinite(targetLufs)) return;
  state = {
    ...state,
    defaultTargetByCategory: { ...state.defaultTargetByCategory, [category]: targetLufs },
  };
  persist();
  notify();
}

/**
 * Liefert den effektiven Target-LUFS fuer einen Channel:
 *   1. Falls Per-Channel-Override gesetzt: nutze den.
 *   2. Sonst: Category-Default aus `defaultTargetByCategory`.
 *   3. Fallback (unknown category): -14 LUFS.
 */
export function getChannelTarget(
  partId:   string,
  category: DrumCategoryLike,
): number {
  const override = state.channelTargets[partId];
  if (typeof override === "number" && Number.isFinite(override)) return override;
  const def = state.defaultTargetByCategory[category];
  if (typeof def === "number" && Number.isFinite(def)) return def;
  return -14;
}

/** Resettet auf Defaults (auch Channel-Overrides loeschen). */
export function resetAutoMix(): void {
  state = defaultState();
  persist();
  notify();
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Custom-Observer-React-Hook. Subscribet die Komponente an State-Aenderungen
 * und liefert den aktuellen State + die Actions (alles direkt importierbar
 * fuer non-React-Code).
 */
export function useAutoMixStore(): AutoMixState & {
  setChannelTarget:        typeof setChannelTarget;
  clearChannelTarget:      typeof clearChannelTarget;
  setMeasurementDuration:  typeof setMeasurementDuration;
  setDefaultTarget:        typeof setDefaultTarget;
  getChannelTarget:        typeof getChannelTarget;
  resetAutoMix:            typeof resetAutoMix;
} {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);
  return {
    ...state,
    setChannelTarget,
    clearChannelTarget,
    setMeasurementDuration,
    setDefaultTarget,
    getChannelTarget,
    resetAutoMix,
  };
}

// ─── Test-Hooks (NICHT in Production verwenden) ─────────────────────────────

export function __resetAutoMixStoreForTests(): void {
  state = defaultState();
  // Listeners bewusst NICHT clearen — Tests koennen das selbst tun.
}

export function __getAutoMixStateForTests(): AutoMixState {
  return state;
}
