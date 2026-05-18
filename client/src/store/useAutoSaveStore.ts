/**
 * Synthstudio – useAutoSaveStore (v3.61.0)
 *
 * Project AutoSave Settings + Status (DAW-Standard Datenschutz).
 *
 * VERANTWORTLICH:
 *  - Settings: enabled (bool), intervalMin (int 1..60), lastSaveAt (timestamp).
 *  - v3.61.0: lastSaveAtPerProject: Record<projectId, number> — pro-projectId
 *    Tracking damit der Topbar-Indikator beim Projektwechsel den dortigen
 *    letzten Save zeigt statt "Noch nie".
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
 * Backward-Compat (v3.61.0):
 *  - `lastSaveAt` (globaler Wert) bleibt als Legacy-Feld erhalten und wird von
 *    `markAutoSaveCompleted()` synchron mit dem per-project-Eintrag aktualisiert.
 *    Bestehende UI-Konsumenten (Indikator + Tests) brechen NICHT.
 *  - Neue UI-Konsumenten nutzen `getLastSaveAtForProject(projectId)` oder
 *    `setLastSaveAt(projectId, ts)` für pro-projektbezogene Reads/Writes.
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
  /**
   * Timestamp des letzten erfolgreichen AutoSaves (epoch ms). null wenn nie.
   * v3.61.0: Bleibt als Legacy-Feld synchron mit `lastSaveAtPerProject` für
   * den jeweils letzten gespeicherten projectId — damit Komponenten, die noch
   * keinen projectId-Context haben, weiterhin einen sinnvollen Wert sehen.
   */
  lastSaveAt: number | null;
  /**
   * v3.61.0: Pro-projectId-Tracking. Beim Projektwechsel kann der Indikator
   * den project-spezifischen letzten Save anzeigen statt "Noch nie".
   * Schlüssel = sanitized projectId, Wert = epoch ms.
   */
  lastSaveAtPerProject: Record<string, number>;
}

function defaults(): AutoSaveSettings {
  return {
    enabled: true,
    intervalMin: AUTOSAVE_DEFAULT_INTERVAL_MIN,
    lastSaveAt: null,
    lastSaveAtPerProject: {},
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

/**
 * Defensive Sanitizer für die per-project Map. Filtert ungültige Keys/Values
 * heraus, damit korrupte localStorage-Einträge nicht in den Runtime-State
 * geraten.
 */
function sanitizePerProjectMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > 128) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    out[k] = v;
  }
  return out;
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
      lastSaveAtPerProject: sanitizePerProjectMap(parsed.lastSaveAtPerProject),
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

/**
 * Legacy-API (pre-v3.61.0): Setzt nur den globalen lastSaveAt. Wird vom
 * AutoSave-Trigger gerufen, der noch keinen projectId-Context hat oder
 * absichtlich projektunabhängig signalisieren will.
 *
 * v3.61.0+ Konsumenten sollten `setLastSaveAt(projectId, ts)` rufen — dann
 * wird sowohl Legacy-Feld als auch per-project Map konsistent gesetzt.
 */
export function markAutoSaveCompleted(at: number = Date.now()): void {
  _state = { ..._state, lastSaveAt: at };
  persist(_state);
  notify();
}

/**
 * v3.61.0: Setzt den letzten Save-Zeitpunkt für eine bestimmte projectId und
 * spiegelt ihn ins Legacy-`lastSaveAt`. Bevorzugte API für neue Konsumenten.
 *
 * Defensive: leere/ungültige projectId → No-Op + Legacy-Feld bleibt unangetastet
 * damit eine versehentliche "" nicht den globalen Wert verfälscht.
 */
export function setLastSaveAt(projectId: string, at: number = Date.now()): void {
  if (typeof projectId !== "string" || projectId.length === 0) return;
  if (!Number.isFinite(at) || at <= 0) return;
  const nextMap = { ..._state.lastSaveAtPerProject, [projectId]: at };
  _state = { ..._state, lastSaveAt: at, lastSaveAtPerProject: nextMap };
  persist(_state);
  notify();
}

/**
 * v3.61.0: Liest den letzten Save-Zeitpunkt für eine projectId. Liefert null
 * wenn dieses Projekt noch nie gespeichert wurde (oder die ID unbekannt ist).
 *
 * Pure-Read — keine Side-Effects, kein Notify.
 */
export function getLastSaveAtForProject(projectId: string | null | undefined): number | null {
  if (typeof projectId !== "string" || projectId.length === 0) return null;
  const v = _state.lastSaveAtPerProject[projectId];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/**
 * v3.60.0: Setzt lastSaveAt explizit auf null zurück. Wird nach einem
 * restoreProject() gerufen, weil dann eine "frische" AutoSave-History
 * beginnt — die letzten Saves galten dem vorherigen Projekt.
 *
 * v3.61.0: Wirkt NUR auf das Legacy-Feld — die per-project Map bleibt
 * unangetastet, damit beim Zurückwechseln zu einem Projekt sein echter
 * letzter Save weiterhin angezeigt werden kann. Der Caller (App.tsx) soll
 * nach dem Reset über setLastSaveAt(projectId, latestVersion.timestamp)
 * den project-spezifischen Wert nachladen.
 *
 * Defensive: persistiert sofort, damit ein Browser-Reload nicht den
 * alten Stand zurücklädt.
 */
export function resetAutoSaveLastSaveAt(): void {
  _state = { ..._state, lastSaveAt: null };
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
