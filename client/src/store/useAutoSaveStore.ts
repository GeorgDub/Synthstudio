/**
 * Synthstudio – useAutoSaveStore (v3.56.0)
 *
 * Project AutoSave Settings + Status (DAW-Standard Datenschutz).
 *
 * VERANTWORTLICH:
 *  - Settings: enabled (bool), intervalMin (int 1..60), lastSaveAt (timestamp).
 *  - LocalStorage-Persistenz für Settings (Key: `ss-autosave-settings:v1`).
 *  - Pause-Signal für aktive Manual-Saves (verhindert Race-Conditions).
 *
 * NICHT VERANTWORTLICH:
 *  - Das eigentliche Schreiben von Versionen (das macht `autoSaveEngine.ts`).
 *  - Listing/Restore (ebenfalls `autoSaveEngine.ts`).
 *
 * Defensive: AutoSave-Fehler dürfen nicht crashen — alle async-Fehler werden
 * gefangen, lastSaveAt bleibt unverändert, Toast/Console gibt Hinweis.
 *
 * Custom Observer Pattern (kein Zustand-NPM, gleicher Stil wie der Rest).
 */
import { useEffect, useReducer } from "react";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-autosave-settings:v1";

/** Default-Intervall 5 Minuten (DAW-üblich: 3-10 min). */
export const AUTOSAVE_DEFAULT_INTERVAL_MIN = 5;
/** Min/Max der Intervall-Range (clamping defensiv). */
export const AUTOSAVE_MIN_INTERVAL_MIN = 1;
export const AUTOSAVE_MAX_INTERVAL_MIN = 60;

/** Hard cap pro Version-Blob (50 MB). Größere Files werden mit Warnung skipped. */
export const AUTOSAVE_MAX_VERSION_BYTES = 50 * 1024 * 1024;

/** Max-Versionen pro Projekt (rolling, älteste wird rotiert). */
export const AUTOSAVE_MAX_VERSIONS = 10;

// ─── Settings-State ──────────────────────────────────────────────────────────

export interface AutoSaveSettings {
  /** Master-Schalter (default true). */
  enabled: boolean;
  /** Intervall in Minuten, 1..60. */
  intervalMin: number;
  /** Timestamp des letzten erfolgreichen AutoSaves (epoch ms). null wenn nie. */
  lastSaveAt: number | null;
}

function defaults(): AutoSaveSettings {
  return {
    enabled: true,
    intervalMin: AUTOSAVE_DEFAULT_INTERVAL_MIN,
    lastSaveAt: null,
  };
}

/** Defensive Clamper — saubere Werte für Intervall. */
export function clampInterval(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return AUTOSAVE_DEFAULT_INTERVAL_MIN;
  const i = Math.round(n);
  if (i < AUTOSAVE_MIN_INTERVAL_MIN) return AUTOSAVE_MIN_INTERVAL_MIN;
  if (i > AUTOSAVE_MAX_INTERVAL_MIN) return AUTOSAVE_MAX_INTERVAL_MIN;
  return i;
}

/** Defensive Loader — wirft NIE, fällt auf defaults() zurück. */
function load(): AutoSaveSettings {
  try {
    if (typeof localStorage === "undefined") return defaults();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const base = defaults();
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : base.enabled,
      intervalMin: clampInterval(parsed.intervalMin),
      lastSaveAt:
        typeof parsed.lastSaveAt === "number" && Number.isFinite(parsed.lastSaveAt)
          ? parsed.lastSaveAt
          : null,
    };
  } catch {
    return defaults();
  }
}

function persist(s: AutoSaveSettings) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore — disk-quota / private-mode */
  }
}

// ─── Module-Singleton ────────────────────────────────────────────────────────

let _state: AutoSaveSettings = load();
/** Pause-Flag während Manual-Save läuft (race-protection). Nicht persistiert. */
let _paused = false;
const _listeners = new Set<() => void>();
function notify() { _listeners.forEach((l) => l()); }

// ─── Public-API ──────────────────────────────────────────────────────────────

export function getAutoSaveSettings(): AutoSaveSettings {
  return _state;
}

export function setAutoSaveEnabled(enabled: boolean): void {
  _state = { ..._state, enabled };
  persist(_state);
  notify();
}

export function setAutoSaveInterval(minutes: number): void {
  _state = { ..._state, intervalMin: clampInterval(minutes) };
  persist(_state);
  notify();
}

export function markAutoSaveCompleted(at: number = Date.now()): void {
  _state = { ..._state, lastSaveAt: at };
  persist(_state);
  notify();
}

/** Pause AutoSave während ein Manual-Save läuft. */
export function pauseAutoSave(): void {
  _paused = true;
}
export function resumeAutoSave(): void {
  _paused = false;
}
export function isAutoSavePaused(): boolean {
  return _paused;
}

// ─── Test-Helpers ────────────────────────────────────────────────────────────

export function __resetAutoSaveStoreForTests(): void {
  _state = defaults();
  _paused = false;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useAutoSaveStore(): AutoSaveSettings {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

// ─── Hilfen für UI / Toast ───────────────────────────────────────────────────

/**
 * Liefert ein menschen-lesbares "vor 2 Min." aus einem Timestamp.
 * Pure-fn, ohne Date-Mock-Side-Effekt.
 */
export function formatLastSave(ts: number | null, now: number = Date.now()): string {
  if (ts === null || !Number.isFinite(ts)) return "noch nie";
  const diffMs = now - ts;
  if (diffMs < 1000) return "gerade eben";
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return `vor ${diffSec} s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  return `vor ${diffD} d`;
}
