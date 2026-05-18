/**
 * Synthstudio – autoSaveController.ts (v3.59.0)
 *
 * UI-Wiring-Logik für AutoSave — Pure-fn-Helper für die Trigger-
 * und Topbar-Status-Berechnung. Trennt die UI-Komponenten (App.tsx,
 * Topbar, Versions-Modal) sauber von der Engine + dem Store ab.
 *
 * Die echte Side-Effect-Ausführung (setInterval + writeAutoSaveVersion)
 * liegt im Hook `useAutoSaveTrigger` in App.tsx — hier sind nur die
 * Pure-Funktionen, damit sie deterministisch getestet werden können.
 *
 * v3.59.0: Run-Once-Tracking + projectId-Cache.
 */
import type { AutoSaveSettings } from "@/store/useAutoSaveStore";

// ─── v3.59.0: localStorage Keys ──────────────────────────────────────────────

/** Set von projectIds für die der Legacy-Migrations-Check bereits gelaufen ist. */
export const MIGRATION_CHECKED_STORAGE_KEY = "synthstudio:autosave-migration-checked";

/** Letzte gesehene projectId für Reload-Persistenz (verhindert ephemere UUID). */
export const LAST_PROJECT_ID_STORAGE_KEY = "synthstudio:last-projectid";

/**
 * Berechnet die Trigger-Periode in Millisekunden.
 * Defensive: NaN/0/neg → 5min default.
 */
export function computeAutoSaveIntervalMs(intervalMin: number): number {
  if (typeof intervalMin !== "number" || !Number.isFinite(intervalMin) || intervalMin <= 0) {
    return 5 * 60_000;
  }
  return Math.round(intervalMin * 60_000);
}

/**
 * Entscheidet ob der Tick einen AutoSave auslösen soll.
 *
 *  - Wenn der Store-Schalter `enabled=false` ist → no-op.
 *  - Wenn ein Manual-Save gerade läuft (`paused=true`) → skip (Race-Schutz).
 *  - Wenn isDirty=false → trotzdem speichern (User-Erwartung: jeder Tick
 *    macht eine Version, auch wenn nichts geändert wurde — vereinfacht
 *    Recovery).
 *
 * Pure-fn, kein Side-Effect. Wird vom useAutoSaveTrigger-Hook gerufen.
 */
export interface AutoSaveTickDecision {
  shouldRun: boolean;
  reason: "ok" | "disabled" | "paused";
}

export function decideAutoSaveTick(
  settings: AutoSaveSettings,
  paused: boolean,
): AutoSaveTickDecision {
  if (!settings.enabled) return { shouldRun: false, reason: "disabled" };
  if (paused) return { shouldRun: false, reason: "paused" };
  return { shouldRun: true, reason: "ok" };
}

/**
 * Formatiert die "Letzter AutoSave" Topbar-Anzeige.
 * Liefert sowohl einen Kurz-Label für den Indikator ("vor 2 min") als
 * auch ein absolut-Tooltip-Text ("Letzter AutoSave: 14:23:05").
 */
export interface AutoSaveStatusDisplay {
  /** Kurze Beschreibung relativ zur jetzigen Zeit. */
  shortLabel: string;
  /** Vollständiges Tooltip mit absoluter Zeit. */
  tooltip: string;
  /** True wenn noch nie gespeichert (lastSaveAt=null). */
  isEmpty: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function buildAutoSaveStatusDisplay(
  lastSaveAt: number | null,
  now: number = Date.now(),
): AutoSaveStatusDisplay {
  if (lastSaveAt === null || !Number.isFinite(lastSaveAt)) {
    return { shortLabel: "Noch nie", tooltip: "AutoSave: noch nie", isEmpty: true };
  }
  const d = new Date(lastSaveAt);
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const diffMs = now - lastSaveAt;
  if (diffMs < 1000) {
    return {
      shortLabel: "gerade eben",
      tooltip: `Letzter AutoSave: ${hms}`,
      isEmpty: false,
    };
  }
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) {
    return {
      shortLabel: `${diffSec}s`,
      tooltip: `Letzter AutoSave: ${hms} (vor ${diffSec} Sekunden)`,
      isEmpty: false,
    };
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return {
      shortLabel: `${diffMin}m`,
      tooltip: `Letzter AutoSave: ${hms} (vor ${diffMin} Minuten)`,
      isEmpty: false,
    };
  }
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return {
      shortLabel: `${diffH}h`,
      tooltip: `Letzter AutoSave: ${hms} (vor ${diffH} Stunden)`,
      isEmpty: false,
    };
  }
  const diffD = Math.floor(diffH / 24);
  return {
    shortLabel: `${diffD}d`,
    tooltip: `Letzter AutoSave: ${hms} (vor ${diffD} Tagen)`,
    isEmpty: false,
  };
}

/**
 * Leitet eine stabile projectId aus dem Projektnamen ab — alphanumerisch
 * + - + _, max 64 chars. Defensive: Wenn der Name leer/ungültig ist,
 * fällt der Helper auf eine Default-ID "default" zurück, damit AutoSave
 * trotzdem läuft.
 */
export function projectNameToId(name: string | null | undefined): string {
  if (typeof name !== "string" || name.length === 0) return "default";
  // Lowercase + alle non-allowed-Zeichen → "-", konsekutiv → 1×, trim
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "default";
}

/**
 * v3.58.0: Prüft ob für einen Project-Name noch Legacy-Slug-Versionen
 * existieren (pre-v1.24-Schema, projectNameToId(name)-Schlüssel) während
 * unter der neuen stable UUID-projectId noch keine Versionen liegen.
 *
 * In dem Fall sollte der User einen Migrations-Prompt sehen:
 *   "<n> Versionen unter altem Namen gefunden — migrieren?"
 *
 * Pure-fn: nimmt zwei Listen + Slug + UUID, entscheidet rein logisch.
 */
export interface LegacySlugMigrationCheck {
  shouldPrompt: boolean;
  legacyCount: number;
  legacySlug: string;
  /** Bei "shouldPrompt: false" gleich legacyCount=0 oder UUID hat schon Verlauf. */
  reason: "no-legacy" | "uuid-has-history" | "migrate";
}

export function checkLegacySlugMigration(
  legacyVersionsCount: number,
  uuidVersionsCount: number,
  projectName: string,
): LegacySlugMigrationCheck {
  const legacySlug = projectNameToId(projectName);
  if (legacyVersionsCount <= 0) {
    return { shouldPrompt: false, legacyCount: 0, legacySlug, reason: "no-legacy" };
  }
  if (uuidVersionsCount > 0) {
    // UUID hat schon AutoSaves → kein Prompt (User würde sonst doppelte
    // History bekommen). Konservative Wahl.
    return {
      shouldPrompt: false,
      legacyCount: legacyVersionsCount,
      legacySlug,
      reason: "uuid-has-history",
    };
  }
  return {
    shouldPrompt: true,
    legacyCount: legacyVersionsCount,
    legacySlug,
    reason: "migrate",
  };
}

/**
 * Wandelt Bytes in eine kurze "MB / KB"-Anzeige um. Pure-fn.
 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Formatiert einen Versions-Timestamp absolut (HH:MM:SS, DD.MM.YYYY).
 */
export function formatVersionTimestamp(ts: number): string {
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ─── v3.59.0: Run-Once Migration-Tracking ────────────────────────────────────

/**
 * Sicheres localStorage-Lookup — defensive bei SSR/Tests ohne localStorage.
 */
function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    /* QuotaExceeded oder Private-Mode — ignorieren */
  }
}

/**
 * Lädt die Set von bereits gecheckten projectIds aus localStorage.
 * Defensive: korruptes JSON → leeres Set, niemals throw.
 */
export function loadMigrationCheckedSet(): Set<string> {
  const raw = safeLocalStorageGet(MIGRATION_CHECKED_STORAGE_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Persistiert die Set von gecheckten projectIds in localStorage.
 */
export function saveMigrationCheckedSet(ids: Set<string>): void {
  safeLocalStorageSet(MIGRATION_CHECKED_STORAGE_KEY, JSON.stringify([...ids]));
}

/**
 * True wenn die projectId schon einen Migration-Check durchlaufen hat.
 */
export function isMigrationChecked(projectId: string): boolean {
  if (typeof projectId !== "string" || projectId.length === 0) return false;
  return loadMigrationCheckedSet().has(projectId);
}

/**
 * Markiert die projectId als bereits gecheckt (idempotent).
 */
export function markMigrationChecked(projectId: string): void {
  if (typeof projectId !== "string" || projectId.length === 0) return;
  const set = loadMigrationCheckedSet();
  if (set.has(projectId)) return;
  set.add(projectId);
  saveMigrationCheckedSet(set);
}

/**
 * Setzt den Tracker für Tests zurück.
 */
export function __resetMigrationCheckedForTests(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(MIGRATION_CHECKED_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

// ─── v3.59.0: projectId localStorage Cache ───────────────────────────────────

/**
 * Persistiert die zuletzt aktive projectId, damit beim Browser-Reload die
 * neue Hook-Instance NICHT eine frische UUID generiert (verlöre die Ver-
 * knüpfung zur AutoSave-History bis loadCachedProject läuft).
 */
export function cacheLastProjectId(projectId: string | null | undefined): void {
  if (typeof projectId !== "string" || projectId.length === 0) return;
  safeLocalStorageSet(LAST_PROJECT_ID_STORAGE_KEY, projectId);
}

/**
 * Liest die zuletzt aktive projectId. Wird beim App-Init benutzt um eine
 * stable UUID zu reaktivieren, falls vorhanden.
 */
export function readLastProjectId(): string | null {
  const v = safeLocalStorageGet(LAST_PROJECT_ID_STORAGE_KEY);
  return typeof v === "string" && v.length > 0 ? v : null;
}
