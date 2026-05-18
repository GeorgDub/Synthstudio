/**
 * tests/features/autosave.test.ts
 *
 * v3.56.0 — Project AutoSave + Version-History (DAW-Standard Datenschutz).
 *
 * Coverage:
 *   - Pure-fn Helpers (sanitizeProjectId, isValidVersionTimestamp, pickVersionsForRolling)
 *   - Store-Settings (load/persist/clampInterval/lastSaveAt)
 *   - Engine (Electron-Pfad via Override): write/list/restore/delete
 *   - Rolling: max 10 Versionen, älteste rotiert
 *   - Pause/Resume Race-Schutz
 *   - LocalStorage-Persistenz
 *   - IPC-Validators (projectId/versionId/label/json)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock (für Store-Tests) ─────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  __resetAutoSaveStoreForTests,
  getAutoSaveSettings,
  setAutoSaveEnabled,
  setAutoSaveInterval,
  markAutoSaveCompleted,
  pauseAutoSave,
  resumeAutoSave,
  isAutoSavePaused,
  clampInterval,
  formatLastSave,
  AUTOSAVE_DEFAULT_INTERVAL_MIN,
  AUTOSAVE_MAX_INTERVAL_MIN,
  AUTOSAVE_MIN_INTERVAL_MIN,
  AUTOSAVE_MAX_VERSIONS,
} from "../../client/src/store/useAutoSaveStore";

import {
  sanitizeProjectId,
  isValidVersionTimestamp,
  pickVersionsForRolling,
  writeAutoSaveVersion,
  listAutoSaveVersions,
  restoreAutoSaveVersion,
  deleteAutoSaveVersion,
  __setAutoSaveElectronOverrideForTests,
  __resetAutoSaveEngineForTests,
  type AutoSaveVersionMeta,
} from "../../client/src/utils/autoSaveEngine";

import {
  validateAutoSaveProjectId,
  validateAutoSaveVersionId,
  validateAutoSaveJson,
  validateAutoSaveLabel,
  guardAutoSavePath,
  AUTOSAVE_MAX_JSON_BYTES,
} from "../../electron/ipcValidators";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-autosave-settings:v1";

function makeMemoryElectronBackend() {
  // In-memory backend that mimics the Electron IPC handlers — enough to
  // exercise the Engine end-to-end without IndexedDB.
  const records = new Map<
    string,
    { projectId: string; versionId: string; timestamp: number; size: number; label?: string; json: string }
  >();
  return {
    records,
    api: {
      autoSaveWrite: vi.fn(async (projectId: string, versionId: string, json: string, label?: string) => {
        const key = `${projectId}:${versionId}`;
        records.set(key, {
          projectId,
          versionId,
          timestamp: parseInt(versionId, 10),
          size: json.length,
          label,
          json,
        });
        return { success: true, versionId };
      }),
      autoSaveList: vi.fn(async (projectId: string) => {
        const versions: AutoSaveVersionMeta[] = [];
        for (const rec of records.values()) {
          if (rec.projectId === projectId) {
            versions.push({
              versionId: rec.versionId,
              timestamp: rec.timestamp,
              size: rec.size,
              label: rec.label,
            });
          }
        }
        return { success: true, versions };
      }),
      autoSaveRestore: vi.fn(async (projectId: string, versionId: string) => {
        const rec = records.get(`${projectId}:${versionId}`);
        if (!rec) return { success: false, error: "Version nicht gefunden" };
        return {
          success: true,
          json: rec.json,
          meta: { versionId: rec.versionId, timestamp: rec.timestamp, size: rec.size },
        };
      }),
      autoSaveDelete: vi.fn(async (projectId: string, versionId: string) => {
        records.delete(`${projectId}:${versionId}`);
        return { success: true };
      }),
    },
  };
}

beforeEach(() => {
  localStorageMock.clear();
  __resetAutoSaveStoreForTests();
  __resetAutoSaveEngineForTests();
  __setAutoSaveElectronOverrideForTests(null);
});

// ─── (1) Pure-fn Helpers ─────────────────────────────────────────────────────

describe("AutoSave pure-fn helpers", () => {
  it("sanitizeProjectId akzeptiert alphanumeric + - + _", () => {
    expect(sanitizeProjectId("Project-1")).toBe("Project-1");
    expect(sanitizeProjectId("ABC_xyz_123")).toBe("ABC_xyz_123");
    expect(sanitizeProjectId("a")).toBe("a");
  });

  it("sanitizeProjectId weist Path-Traversal + Sonderzeichen ab", () => {
    expect(sanitizeProjectId("")).toBeNull();
    expect(sanitizeProjectId("../etc/passwd")).toBeNull();
    expect(sanitizeProjectId("a/b")).toBeNull();
    expect(sanitizeProjectId("a\\b")).toBeNull();
    expect(sanitizeProjectId("a.b")).toBeNull(); // Punkt ist NICHT erlaubt (Verzeichnis-Trenner-Risiko)
    expect(sanitizeProjectId("a b")).toBeNull(); // Space
    expect(sanitizeProjectId(null as unknown)).toBeNull();
    expect(sanitizeProjectId(undefined as unknown)).toBeNull();
    expect(sanitizeProjectId(123 as unknown)).toBeNull();
    expect(sanitizeProjectId("x".repeat(65))).toBeNull(); // > 64 chars
  });

  it("isValidVersionTimestamp prüft 13..16-stelligen Decimal-String", () => {
    expect(isValidVersionTimestamp("1747512345678")).toBe(true); // 13 chars
    expect(isValidVersionTimestamp("17475123456789")).toBe(true); // 14
    expect(isValidVersionTimestamp("1234567890123456")).toBe(true); // 16
    expect(isValidVersionTimestamp("123")).toBe(false);
    expect(isValidVersionTimestamp("17475123456789012345")).toBe(false); // > 16
    expect(isValidVersionTimestamp("abc")).toBe(false);
    expect(isValidVersionTimestamp("../1234567890123")).toBe(false);
    expect(isValidVersionTimestamp(123 as unknown)).toBe(false);
  });

  it("pickVersionsForRolling liefert die ältesten IDs zum Löschen", () => {
    const versions: AutoSaveVersionMeta[] = [
      { versionId: "1747512345678", timestamp: 1747512345678, size: 100 },
      { versionId: "1747512345679", timestamp: 1747512345679, size: 100 },
      { versionId: "1747512345680", timestamp: 1747512345680, size: 100 },
    ];
    // Mit max=10 keine Rollung.
    expect(pickVersionsForRolling(versions, 10)).toEqual([]);
    // Mit max=2 wird die älteste gerollt.
    const rolled = pickVersionsForRolling(versions, 2);
    expect(rolled).toEqual(["1747512345678"]);
    // Mit max=1 werden zwei gerollt (die ältesten).
    expect(pickVersionsForRolling(versions, 1).sort()).toEqual([
      "1747512345678",
      "1747512345679",
    ]);
  });

  it("clampInterval clampt auf 1..60 mit fallback bei NaN", () => {
    expect(clampInterval(5)).toBe(5);
    expect(clampInterval(0)).toBe(AUTOSAVE_MIN_INTERVAL_MIN);
    expect(clampInterval(-5)).toBe(AUTOSAVE_MIN_INTERVAL_MIN);
    expect(clampInterval(100)).toBe(AUTOSAVE_MAX_INTERVAL_MIN);
    expect(clampInterval(NaN)).toBe(AUTOSAVE_DEFAULT_INTERVAL_MIN);
    expect(clampInterval("foo" as unknown)).toBe(AUTOSAVE_DEFAULT_INTERVAL_MIN);
    expect(clampInterval(3.7)).toBe(4); // rundet
  });

  it("formatLastSave liefert menschen-lesbare Strings", () => {
    expect(formatLastSave(null)).toBe("noch nie");
    const now = 1_000_000_000;
    expect(formatLastSave(now - 1000, now)).toBe("vor 1 s");
    expect(formatLastSave(now - 60_000, now)).toBe("vor 1 min");
    expect(formatLastSave(now - 3_600_000, now)).toBe("vor 1 h");
    expect(formatLastSave(now - 86_400_000, now)).toBe("vor 1 d");
    expect(formatLastSave(now - 100, now)).toBe("gerade eben");
  });
});

// ─── (2) Store Settings + Persistenz ─────────────────────────────────────────

describe("AutoSave Store — Settings + LocalStorage-Persistenz", () => {
  it("Defaults: enabled=true, interval=5, lastSaveAt=null", () => {
    const s = getAutoSaveSettings();
    expect(s.enabled).toBe(true);
    expect(s.intervalMin).toBe(5);
    expect(s.lastSaveAt).toBeNull();
  });

  it("setAutoSaveEnabled persistiert in localStorage", () => {
    setAutoSaveEnabled(false);
    expect(getAutoSaveSettings().enabled).toBe(false);
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).enabled).toBe(false);
  });

  it("setAutoSaveInterval clampt + persistiert", () => {
    setAutoSaveInterval(15);
    expect(getAutoSaveSettings().intervalMin).toBe(15);
    setAutoSaveInterval(0); // -> 1 (clamp)
    expect(getAutoSaveSettings().intervalMin).toBe(1);
    setAutoSaveInterval(9999); // -> 60 (clamp)
    expect(getAutoSaveSettings().intervalMin).toBe(60);
  });

  it("markAutoSaveCompleted setzt lastSaveAt", () => {
    expect(getAutoSaveSettings().lastSaveAt).toBeNull();
    markAutoSaveCompleted(42);
    expect(getAutoSaveSettings().lastSaveAt).toBe(42);
  });

  it("Pause/Resume Flag funktioniert", () => {
    expect(isAutoSavePaused()).toBe(false);
    pauseAutoSave();
    expect(isAutoSavePaused()).toBe(true);
    resumeAutoSave();
    expect(isAutoSavePaused()).toBe(false);
  });

  it("Defensive load: korruptes JSON in localStorage → fallback auf defaults", () => {
    localStorageMock.setItem(STORAGE_KEY, "not-json{");
    __resetAutoSaveStoreForTests();
    const s = getAutoSaveSettings();
    expect(s.enabled).toBe(true);
    expect(s.intervalMin).toBe(5);
  });
});

// ─── (3) Engine — Electron-Pfad via Override ─────────────────────────────────

describe("AutoSave Engine — write/list/restore (Electron-Pfad)", () => {
  it("writeAutoSaveVersion schreibt + listAutoSaveVersions liefert DESC", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const r1 = await writeAutoSaveVersion("proj-1", JSON.stringify({ projectName: "A" }), {
      now: 1_700_000_000_000,
    });
    expect(r1.success).toBe(true);
    expect(r1.versionId).toBe("1700000000000");

    const r2 = await writeAutoSaveVersion("proj-1", JSON.stringify({ projectName: "A" }), {
      now: 1_700_000_001_000,
      label: "before plugin change",
    });
    expect(r2.success).toBe(true);

    const versions = await listAutoSaveVersions("proj-1");
    expect(versions).toHaveLength(2);
    // DESC sortiert
    expect(versions[0].versionId).toBe("1700000001000");
    expect(versions[0].label).toBe("before plugin change");
    expect(versions[1].versionId).toBe("1700000000000");
  });

  it("restoreAutoSaveVersion liefert die korrekte JSON-Quelle", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const payload = JSON.stringify({ projectName: "Restored", bpm: 128 });
    await writeAutoSaveVersion("proj-1", payload, { now: 1_700_000_000_000 });

    const res = await restoreAutoSaveVersion("proj-1", "1700000000000");
    expect(res.success).toBe(true);
    expect(res.json).toBe(payload);
  });

  it("Invalid projectId wird abgelehnt — kein Backend-Call", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const res = await writeAutoSaveVersion("../etc/passwd", "{}", { now: 1_700_000_000_000 });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Ungültige projectId");
    expect(backend.api.autoSaveWrite).not.toHaveBeenCalled();
  });

  it("Übergroße JSON (>50MB) wird abgelehnt", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    // Erzeuge dummy 51 MB string. Wir nutzen repeat, nicht den TextEncoder direkt.
    const big = "x".repeat(AUTOSAVE_MAX_JSON_BYTES + 1);
    const res = await writeAutoSaveVersion("proj-1", big, { now: 1_700_000_000_000 });
    expect(res.success).toBe(false);
    expect(res.error).toContain("zu groß");
    expect(backend.api.autoSaveWrite).not.toHaveBeenCalled();
  });

  it("Max 10 Versionen — älteste rotiert automatisch (rolling)", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    // 12 Versionen schreiben.
    for (let i = 0; i < 12; i++) {
      await writeAutoSaveVersion("proj-1", JSON.stringify({ idx: i }), {
        now: 1_700_000_000_000 + i * 1000,
      });
    }

    const versions = await listAutoSaveVersions("proj-1");
    expect(versions.length).toBeLessThanOrEqual(AUTOSAVE_MAX_VERSIONS);
    expect(versions[0].timestamp).toBe(1_700_000_000_000 + 11 * 1000); // newest first
    // Älteste sollten weg sein (idx 0 und 1, also Timestamp +0 und +1000).
    const ts = versions.map((v) => v.timestamp);
    expect(ts).not.toContain(1_700_000_000_000);
    expect(ts).not.toContain(1_700_000_001_000);
  });

  it("deleteAutoSaveVersion entfernt + idempotent", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    await writeAutoSaveVersion("proj-1", "{}", { now: 1_700_000_000_000 });
    expect(await listAutoSaveVersions("proj-1")).toHaveLength(1);

    const r1 = await deleteAutoSaveVersion("proj-1", "1700000000000");
    expect(r1.success).toBe(true);
    expect(await listAutoSaveVersions("proj-1")).toHaveLength(0);

    // Doppel-Delete = idempotent.
    const r2 = await deleteAutoSaveVersion("proj-1", "1700000000000");
    expect(r2.success).toBe(true);
  });

  it("Defensive restore: invalid versionId wird abgelehnt", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const res = await restoreAutoSaveVersion("proj-1", "../etc/passwd");
    expect(res.success).toBe(false);
    expect(res.error).toContain("versionId");
    expect(backend.api.autoSaveRestore).not.toHaveBeenCalled();
  });
});

// ─── (4) IPC Validators ──────────────────────────────────────────────────────

describe("IPC Validators (autosave:*)", () => {
  it("validateAutoSaveProjectId — happy + path-traversal", () => {
    expect(validateAutoSaveProjectId("proj-1")).toEqual({ ok: true, value: "proj-1" });
    expect(validateAutoSaveProjectId("a_b-c_123")).toEqual({ ok: true, value: "a_b-c_123" });

    const traversal = validateAutoSaveProjectId("../etc");
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) expect(traversal.error).toMatch(/unzulässig|alphanumerisch/);

    const slash = validateAutoSaveProjectId("a/b");
    expect(slash.ok).toBe(false);

    const nul = validateAutoSaveProjectId("a\0b");
    expect(nul.ok).toBe(false);
  });

  it("validateAutoSaveVersionId — happy + reject", () => {
    expect(validateAutoSaveVersionId("1700000000000")).toEqual({
      ok: true,
      value: "1700000000000",
    });
    expect(validateAutoSaveVersionId("abc").ok).toBe(false);
    expect(validateAutoSaveVersionId("../1700000000000").ok).toBe(false);
    expect(validateAutoSaveVersionId("").ok).toBe(false);
    expect(validateAutoSaveVersionId("12345").ok).toBe(false); // < 13
  });

  it("validateAutoSaveJson — happy + size-cap + invalid-JSON", () => {
    expect(validateAutoSaveJson('{"a":1}').ok).toBe(true);
    expect(validateAutoSaveJson("").ok).toBe(false);
    expect(validateAutoSaveJson("not-json{").ok).toBe(false);
    expect(validateAutoSaveJson(123 as unknown).ok).toBe(false);
    // Übergroß — Buffer-Allokation, aber String-Repeat braucht echte Bytes.
    const big = "x".repeat(AUTOSAVE_MAX_JSON_BYTES + 1);
    expect(validateAutoSaveJson(big).ok).toBe(false);
  });

  it("validateAutoSaveLabel — null/undefined ok, zu lang + NUL reject", () => {
    expect(validateAutoSaveLabel(null)).toEqual({ ok: true, value: null });
    expect(validateAutoSaveLabel(undefined)).toEqual({ ok: true, value: null });
    expect(validateAutoSaveLabel("hello")).toEqual({ ok: true, value: "hello" });
    expect(validateAutoSaveLabel("x".repeat(300)).ok).toBe(false);
    expect(validateAutoSaveLabel("a\0b").ok).toBe(false);
    expect(validateAutoSaveLabel(42 as unknown).ok).toBe(false);
  });

  it("guardAutoSavePath blocks traversal", () => {
    const ok = guardAutoSavePath("/tmp/autosave", "proj-1", "1700000000000.synth");
    expect(ok.ok).toBe(true);

    // Wenn projectId Slashes/Backslashes hätte (sollte nie vorkommen, defense-in-depth):
    const bad = guardAutoSavePath("/tmp/autosave", "..", "1700000000000.synth");
    expect(bad.ok).toBe(false);
  });
});
