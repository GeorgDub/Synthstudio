/**
 * Synthstudio – autoSaveEngine.ts (v3.56.0)
 *
 * Isomorpher AutoSave-Backend für Projekt-Versionen.
 *
 *  - Electron-Path: IPC `autosave:write|list|restore|delete` → schreibt
 *    in `app.getPath('userData')/autosave/<projectId>/<timestamp>.synth`.
 *  - Browser-Path: IndexedDB-DB `synthstudio-autosave`, ObjectStore `versions`,
 *    Index `by-project` (projectId+timestamp).
 *
 * Rolling: Max 10 Versionen pro Projekt — älteste wird gerollt.
 * Defensive: Größer als AUTOSAVE_MAX_VERSION_BYTES (50 MB) → skip mit warning.
 *
 * Public-API:
 *   writeAutoSaveVersion(projectId, json, opts?)  → { success, versionId?, error? }
 *   listAutoSaveVersions(projectId)               → AutoSaveVersionMeta[]
 *   restoreAutoSaveVersion(projectId, versionId)  → { success, json?, error? }
 *   deleteAutoSaveVersion(projectId, versionId)   → { success, error? }
 *
 * Pure-fn-Helpers (test-friendly):
 *   sanitizeProjectId(raw):string|null  — alphanumeric + - + _ , 1..64 chars
 *   isValidVersionTimestamp(name):boolean — `\d{13}` epoch-ms
 *   pickVersionsForRolling(versions, max) — gibt veraltete IDs zurück
 */
import {
  AUTOSAVE_MAX_VERSION_BYTES,
  AUTOSAVE_MAX_VERSIONS,
} from "@/store/useAutoSaveStore";

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface AutoSaveVersionMeta {
  /** Eindeutige Version-ID. In Browser+Electron = `<timestamp>` (epoch ms). */
  versionId: string;
  /** Epoch ms zum Sortieren. */
  timestamp: number;
  /** Byte-Größe der gespeicherten JSON-Quelle. */
  size: number;
  /** Optional, vom User vergeben (z.B. "manual save before plugin change"). */
  label?: string;
  /** Optional, kommt aus dem JSON: projectName. */
  projectName?: string;
}

export interface WriteResult {
  success: boolean;
  versionId?: string;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  json?: string;
  meta?: AutoSaveVersionMeta;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

// ─── Pure-fn-Helpers (zentral für Validation / Tests) ────────────────────────

const PROJECT_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_ID_REGEX = /^\d{13,16}$/;

/**
 * Akzeptiert Project-IDs aus alphanumerischen + - + _, 1..64 Zeichen.
 * Liefert die saubere ID zurück oder null bei invalid.
 * Wird in Renderer + Main (über IPC-Validator) konsistent geprüft.
 */
export function sanitizeProjectId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!PROJECT_ID_REGEX.test(raw)) return null;
  return raw;
}

/** Strikte Whitelist für Version-Filenames (nur Timestamps). */
export function isValidVersionTimestamp(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return VERSION_ID_REGEX.test(raw);
}

/**
 * Liefert die IDs der zu löschenden Versionen wenn die Liste > max wird.
 * Versionen sortiert DESC (newest first), die ältesten werden gerollt.
 * Pure-fn, deterministisch.
 */
export function pickVersionsForRolling(
  versions: AutoSaveVersionMeta[],
  max: number = AUTOSAVE_MAX_VERSIONS,
): string[] {
  if (versions.length <= max) return [];
  const sorted = [...versions].sort((a, b) => b.timestamp - a.timestamp);
  return sorted.slice(max).map((v) => v.versionId);
}

// ─── Electron-Detection ──────────────────────────────────────────────────────

interface ElectronAutoSaveAPI {
  autoSaveWrite?: (
    projectId: string,
    versionId: string,
    json: string,
    label?: string,
  ) => Promise<WriteResult>;
  autoSaveList?: (projectId: string) => Promise<{ success: boolean; versions?: AutoSaveVersionMeta[]; error?: string }>;
  autoSaveRestore?: (projectId: string, versionId: string) => Promise<RestoreResult>;
  autoSaveDelete?: (projectId: string, versionId: string) => Promise<DeleteResult>;
}

let _testElectronOverride: ElectronAutoSaveAPI | null = null;

function getElectronAutoSaveAPI(): ElectronAutoSaveAPI | null {
  if (_testElectronOverride) return _testElectronOverride;
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: { isElectron?: boolean } & ElectronAutoSaveAPI }).electronAPI;
  if (!api?.isElectron) return null;
  if (!api.autoSaveWrite || !api.autoSaveList || !api.autoSaveRestore || !api.autoSaveDelete) {
    return null;
  }
  return api;
}

// ─── IndexedDB-Wrapper (Browser-Fallback) ────────────────────────────────────

const DB_NAME = "synthstudio-autosave";
const DB_VERSION = 1;
const STORE_NAME = "versions";

interface IdbRecord {
  /** Composite key `<projectId>:<versionId>`. */
  key: string;
  projectId: string;
  versionId: string;
  timestamp: number;
  size: number;
  label?: string;
  projectName?: string;
  /** Volle JSON-Quelle. */
  json: string;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB nicht verfügbar"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("by-project", "projectId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return _dbPromise;
}

function makeKey(projectId: string, versionId: string): string {
  return `${projectId}:${versionId}`;
}

async function idbWrite(rec: IdbRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(rec);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB put failed"));
  });
}

async function idbListByProject(projectId: string): Promise<IdbRecord[]> {
  const db = await openDb();
  return new Promise<IdbRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("by-project");
    const req = idx.getAll(projectId);
    req.onsuccess = () => resolve((req.result as IdbRecord[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error("IDB list failed"));
  });
}

async function idbGet(key: string): Promise<IdbRecord | null> {
  const db = await openDb();
  return new Promise<IdbRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as IdbRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IDB get failed"));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB delete failed"));
  });
}

function recordToMeta(rec: IdbRecord): AutoSaveVersionMeta {
  return {
    versionId: rec.versionId,
    timestamp: rec.timestamp,
    size: rec.size,
    label: rec.label,
    projectName: rec.projectName,
  };
}

// ─── Public-API ──────────────────────────────────────────────────────────────

export interface WriteOptions {
  /** Optional, vom User vergeben. */
  label?: string;
  /** Override für Test-Determinismus. */
  now?: number;
}

/**
 * Speichert eine Projekt-Version. Stille No-Op + return error wenn:
 *   - projectId invalid
 *   - json size > AUTOSAVE_MAX_VERSION_BYTES
 *   - Backend unavailable
 *
 * Nach Write wird automatisch gerollt (max 10 Versionen pro Projekt).
 */
export async function writeAutoSaveVersion(
  projectIdRaw: string,
  json: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  const projectId = sanitizeProjectId(projectIdRaw);
  if (!projectId) return { success: false, error: "Ungültige projectId" };
  if (typeof json !== "string" || json.length === 0) {
    return { success: false, error: "Leerer JSON-Inhalt" };
  }

  // UTF-16 → Bytes approximation (saubere Größe schwer ohne TextEncoder, das ist
  // aber in beiden Targets vorhanden). 50MB-Cap defensiv.
  const size = typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(json).byteLength
    : json.length;
  if (size > AUTOSAVE_MAX_VERSION_BYTES) {
    return {
      success: false,
      error: `Projekt zu groß (${(size / 1024 / 1024).toFixed(1)} MB > 50 MB)`,
    };
  }

  const now = opts.now ?? Date.now();
  const versionId = String(now);

  // Best-effort projectName extraction (nur fürs UI, defensive).
  let projectName: string | undefined;
  try {
    const parsed = JSON.parse(json) as { projectName?: unknown };
    if (typeof parsed.projectName === "string") projectName = parsed.projectName;
  } catch {
    /* ignore — versuche es trotzdem zu speichern */
  }

  // ── Electron-Pfad ───────────────────────────────────────────────────────────
  const eAPI = getElectronAutoSaveAPI();
  if (eAPI && eAPI.autoSaveWrite) {
    try {
      const res = await eAPI.autoSaveWrite(projectId, versionId, json, opts.label);
      if (res.success) {
        await rollOldVersions(projectId);
      }
      return res;
    } catch (err) {
      return { success: false, error: `Electron-IPC-Fehler: ${String(err)}` };
    }
  }

  // ── Browser-Pfad (IndexedDB) ───────────────────────────────────────────────
  try {
    await idbWrite({
      key: makeKey(projectId, versionId),
      projectId,
      versionId,
      timestamp: now,
      size,
      label: opts.label,
      projectName,
      json,
    });
    await rollOldVersions(projectId);
    return { success: true, versionId };
  } catch (err) {
    return { success: false, error: `IndexedDB-Fehler: ${String(err)}` };
  }
}

/** Listet alle Versionen für ein Projekt (DESC nach timestamp). */
export async function listAutoSaveVersions(
  projectIdRaw: string,
): Promise<AutoSaveVersionMeta[]> {
  const projectId = sanitizeProjectId(projectIdRaw);
  if (!projectId) return [];

  const eAPI = getElectronAutoSaveAPI();
  if (eAPI && eAPI.autoSaveList) {
    try {
      const res = await eAPI.autoSaveList(projectId);
      if (res.success && Array.isArray(res.versions)) {
        return [...res.versions].sort((a, b) => b.timestamp - a.timestamp);
      }
      return [];
    } catch {
      return [];
    }
  }

  try {
    const recs = await idbListByProject(projectId);
    return recs.map(recordToMeta).sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/** Lädt eine Version. Liefert die JSON-Quelle für `parseProject`. */
export async function restoreAutoSaveVersion(
  projectIdRaw: string,
  versionId: string,
): Promise<RestoreResult> {
  const projectId = sanitizeProjectId(projectIdRaw);
  if (!projectId) return { success: false, error: "Ungültige projectId" };
  if (!isValidVersionTimestamp(versionId)) {
    return { success: false, error: "Ungültige versionId" };
  }

  const eAPI = getElectronAutoSaveAPI();
  if (eAPI && eAPI.autoSaveRestore) {
    try {
      return await eAPI.autoSaveRestore(projectId, versionId);
    } catch (err) {
      return { success: false, error: `Electron-IPC-Fehler: ${String(err)}` };
    }
  }

  try {
    const rec = await idbGet(makeKey(projectId, versionId));
    if (!rec) return { success: false, error: "Version nicht gefunden" };
    return { success: true, json: rec.json, meta: recordToMeta(rec) };
  } catch (err) {
    return { success: false, error: `IndexedDB-Fehler: ${String(err)}` };
  }
}

/** Löscht eine Version. Idempotent (no-op wenn nicht vorhanden). */
export async function deleteAutoSaveVersion(
  projectIdRaw: string,
  versionId: string,
): Promise<DeleteResult> {
  const projectId = sanitizeProjectId(projectIdRaw);
  if (!projectId) return { success: false, error: "Ungültige projectId" };
  if (!isValidVersionTimestamp(versionId)) {
    return { success: false, error: "Ungültige versionId" };
  }

  const eAPI = getElectronAutoSaveAPI();
  if (eAPI && eAPI.autoSaveDelete) {
    try {
      return await eAPI.autoSaveDelete(projectId, versionId);
    } catch (err) {
      return { success: false, error: `Electron-IPC-Fehler: ${String(err)}` };
    }
  }

  try {
    await idbDelete(makeKey(projectId, versionId));
    return { success: true };
  } catch (err) {
    return { success: false, error: `IndexedDB-Fehler: ${String(err)}` };
  }
}

// ─── Rolling-Cleanup ─────────────────────────────────────────────────────────

async function rollOldVersions(projectId: string): Promise<void> {
  try {
    const versions = await listAutoSaveVersions(projectId);
    const toDelete = pickVersionsForRolling(versions, AUTOSAVE_MAX_VERSIONS);
    for (const id of toDelete) {
      await deleteAutoSaveVersion(projectId, id).catch(() => {
        /* best-effort */
      });
    }
  } catch {
    /* best-effort, never crash AutoSave */
  }
}

// ─── Test-Helpers ────────────────────────────────────────────────────────────

export function __resetAutoSaveEngineForTests(): void {
  _dbPromise = null;
}

/** Direkt-Mock-Override für Electron-Tests (bypasst window.electronAPI lookup). */
export function __setAutoSaveElectronOverrideForTests(api: ElectronAutoSaveAPI | null): void {
  _testElectronOverride = api;
}
/** Test-Inspector — true wenn der Engine den Electron-Pfad nutzt. */
export function __getElectronAutoSaveAPIForTests(): ElectronAutoSaveAPI | null {
  return getElectronAutoSaveAPI();
}
