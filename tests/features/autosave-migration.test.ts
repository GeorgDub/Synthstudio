/**
 * tests/features/autosave-migration.test.ts
 *
 * v3.59.0 — AutoSave Legacy-Slug-Migration UI + Engine.
 *
 * Coverage:
 *   (1) Engine: migrateLegacyVersions kopiert Legacy → UUID, löscht Legacy,
 *       reportet Progress + Fehler.
 *   (2) Engine: deleteAllVersions räumt einen Legacy-Slot auf.
 *   (3) Controller: Run-Once-Tracking persistiert in localStorage.
 *   (4) Controller: projectId localStorage Cache.
 *   (5) checkLegacySlugMigration (smoke — Detail-Coverage liegt schon
 *       in project-id-migration.test.ts, hier nur als Integration).
 *
 * Pure node-env Tests (localStorage-Mock + In-Memory-Electron-Backend).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
    _peek: () => ({ ...store }),
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  migrateLegacyVersions,
  deleteAllVersions,
  writeAutoSaveVersion,
  listAutoSaveVersions,
  __setAutoSaveElectronOverrideForTests,
  __resetAutoSaveEngineForTests,
  type AutoSaveVersionMeta,
} from "../../client/src/utils/autoSaveEngine";

import {
  checkLegacySlugMigration,
  isMigrationChecked,
  markMigrationChecked,
  loadMigrationCheckedSet,
  __resetMigrationCheckedForTests,
  cacheLastProjectId,
  readLastProjectId,
  LAST_PROJECT_ID_STORAGE_KEY,
  MIGRATION_CHECKED_STORAGE_KEY,
} from "../../client/src/utils/autoSaveController";

// ─── In-Memory Electron-Backend (selbe Idee wie autosave-ui.test.ts) ─────────

function makeMemoryElectronBackend() {
  const records = new Map<
    string,
    {
      projectId: string;
      versionId: string;
      timestamp: number;
      size: number;
      label?: string;
      json: string;
    }
  >();
  return {
    records,
    api: {
      autoSaveWrite: vi.fn(
        async (projectId: string, versionId: string, json: string, label?: string) => {
          records.set(`${projectId}:${versionId}`, {
            projectId,
            versionId,
            timestamp: parseInt(versionId, 10),
            size: json.length,
            label,
            json,
          });
          return { success: true, versionId };
        },
      ),
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
  __resetAutoSaveEngineForTests();
  __setAutoSaveElectronOverrideForTests(null);
  __resetMigrationCheckedForTests();
});

// ─── (1) migrateLegacyVersions ───────────────────────────────────────────────

describe("v3.59.0 – migrateLegacyVersions", () => {
  it("kopiert alle Legacy-Versionen zur UUID, löscht Legacy, reportet Progress", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const legacySlug = "my-beat";
    const uuid = "11111111-2222-4333-8444-555555555555";

    // 3 Legacy-Versionen anlegen
    await writeAutoSaveVersion(legacySlug, JSON.stringify({ a: 1 }), { now: 1_700_000_001_000 });
    await writeAutoSaveVersion(legacySlug, JSON.stringify({ a: 2 }), { now: 1_700_000_002_000 });
    await writeAutoSaveVersion(legacySlug, JSON.stringify({ a: 3 }), { now: 1_700_000_003_000 });

    const progressCalls: Array<{ done: number; total: number }> = [];
    const res = await migrateLegacyVersions(legacySlug, uuid, {
      onProgress: (done, total) => progressCalls.push({ done, total }),
    });

    expect(res.migrated).toBe(3);
    expect(res.errors).toHaveLength(0);
    expect(res.total).toBe(3);
    expect(progressCalls).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);

    // Legacy ist leer, UUID hat 3 Versionen
    const legacyAfter = await listAutoSaveVersions(legacySlug);
    const uuidAfter = await listAutoSaveVersions(uuid);
    expect(legacyAfter).toHaveLength(0);
    expect(uuidAfter).toHaveLength(3);
    // Timestamps preserved
    expect(uuidAfter.map((v) => v.timestamp).sort()).toEqual([
      1_700_000_001_000, 1_700_000_002_000, 1_700_000_003_000,
    ]);
  });

  it("kein Legacy → migrated=0, total=0, keine Fehler", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const res = await migrateLegacyVersions("empty-slug", "11111111-2222-4333-8444-555555555555");
    expect(res.migrated).toBe(0);
    expect(res.total).toBe(0);
    expect(res.errors).toHaveLength(0);
  });

  it("invalid IDs werden mit error result returned", async () => {
    const res = await migrateLegacyVersions("", "11111111-2222-4333-8444-555555555555");
    expect(res.migrated).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].error).toContain("Ungültige");
  });

  it("legacySlug === newUuid → no-op (defensive)", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);
    await writeAutoSaveVersion("same-id", JSON.stringify({ a: 1 }), { now: 1_700_000_001_000 });
    const res = await migrateLegacyVersions("same-id", "same-id");
    expect(res.migrated).toBe(0);
    expect(res.total).toBe(0);
    // Version ist NICHT gelöscht (Source = Target)
    const after = await listAutoSaveVersions("same-id");
    expect(after).toHaveLength(1);
  });

  it("keepLegacy=true behält die alten Versionen", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const legacySlug = "keep-me";
    const uuid = "22222222-3333-4444-8555-666666666666";
    await writeAutoSaveVersion(legacySlug, JSON.stringify({ a: 1 }), { now: 1_700_000_001_000 });

    const res = await migrateLegacyVersions(legacySlug, uuid, { keepLegacy: true });
    expect(res.migrated).toBe(1);
    const legacyAfter = await listAutoSaveVersions(legacySlug);
    expect(legacyAfter).toHaveLength(1);
    const uuidAfter = await listAutoSaveVersions(uuid);
    expect(uuidAfter).toHaveLength(1);
  });
});

// ─── (2) deleteAllVersions ───────────────────────────────────────────────────

describe("v3.59.0 – deleteAllVersions", () => {
  it("löscht alle Versionen einer projectId", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const slug = "discard-me";
    await writeAutoSaveVersion(slug, JSON.stringify({ a: 1 }), { now: 1_700_000_001_000 });
    await writeAutoSaveVersion(slug, JSON.stringify({ a: 2 }), { now: 1_700_000_002_000 });

    const res = await deleteAllVersions(slug);
    expect(res.deleted).toBe(2);
    expect(res.errors).toBe(0);
    const after = await listAutoSaveVersions(slug);
    expect(after).toHaveLength(0);
  });

  it("invalid id → deleted=0, errors=0 (defensive)", async () => {
    const res = await deleteAllVersions("");
    expect(res.deleted).toBe(0);
    expect(res.errors).toBe(0);
  });

  it("idempotent: zweiter Call auf leeren Slot → deleted=0", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);
    await writeAutoSaveVersion("once", JSON.stringify({ a: 1 }), { now: 1_700_000_001_000 });
    await deleteAllVersions("once");
    const second = await deleteAllVersions("once");
    expect(second.deleted).toBe(0);
  });
});

// ─── (3) Run-Once Migration-Tracking (localStorage) ──────────────────────────

describe("v3.59.0 – Run-Once Migration-Tracking", () => {
  it("isMigrationChecked liefert false bei frischem Set", () => {
    expect(isMigrationChecked("11111111-2222-4333-8444-555555555555")).toBe(false);
  });

  it("markMigrationChecked persistiert in localStorage", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    markMigrationChecked(id);
    expect(isMigrationChecked(id)).toBe(true);
    // localStorage muss den Key haben
    const raw = localStorageMock.getItem(MIGRATION_CHECKED_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "[]");
    expect(parsed).toContain(id);
  });

  it("markMigrationChecked ist idempotent (Doppel-Call → 1 Eintrag)", () => {
    const id = "33333333-4444-4555-8666-777777777777";
    markMigrationChecked(id);
    markMigrationChecked(id);
    const set = loadMigrationCheckedSet();
    expect([...set].filter((x) => x === id)).toHaveLength(1);
  });

  it("loadMigrationCheckedSet ist defensive bei korruptem JSON", () => {
    localStorageMock.setItem(MIGRATION_CHECKED_STORAGE_KEY, "not-json{");
    const set = loadMigrationCheckedSet();
    expect(set.size).toBe(0);
  });

  it("loadMigrationCheckedSet filtert non-string Einträge", () => {
    localStorageMock.setItem(MIGRATION_CHECKED_STORAGE_KEY, JSON.stringify(["ok", 42, null, "fine"]));
    const set = loadMigrationCheckedSet();
    expect(set.has("ok")).toBe(true);
    expect(set.has("fine")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("markMigrationChecked ignoriert leere/null projectId", () => {
    markMigrationChecked("");
    expect(loadMigrationCheckedSet().size).toBe(0);
  });
});

// ─── (4) projectId localStorage Cache ────────────────────────────────────────

describe("v3.59.0 – projectId localStorage Cache", () => {
  it("cacheLastProjectId persistiert in localStorage", () => {
    const id = "44444444-5555-4666-8777-888888888888";
    cacheLastProjectId(id);
    expect(localStorageMock.getItem(LAST_PROJECT_ID_STORAGE_KEY)).toBe(id);
    expect(readLastProjectId()).toBe(id);
  });

  it("readLastProjectId liefert null wenn nichts gecached", () => {
    expect(readLastProjectId()).toBeNull();
  });

  it("cacheLastProjectId ignoriert empty + null + undefined", () => {
    cacheLastProjectId("");
    cacheLastProjectId(null);
    cacheLastProjectId(undefined);
    expect(localStorageMock.getItem(LAST_PROJECT_ID_STORAGE_KEY)).toBeNull();
  });

  it("cacheLastProjectId überschreibt vorherige ID", () => {
    cacheLastProjectId("a-id");
    cacheLastProjectId("b-id");
    expect(readLastProjectId()).toBe("b-id");
  });
});

// ─── (5) checkLegacySlugMigration Smoke ──────────────────────────────────────

describe("v3.59.0 – checkLegacySlugMigration (Integration)", () => {
  it("End-to-End: write legacy → check shouldPrompt=true → migrate → check shouldPrompt=false", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const projectName = "My Beat 2024";
    const legacySlug = "my-beat-2024"; // projectNameToId(projectName)
    const uuid = "55555555-6666-4777-8888-999999999999";

    // 2 Legacy-Versionen anlegen
    await writeAutoSaveVersion(legacySlug, JSON.stringify({ a: 1 }), { now: 1_700_000_001_000 });
    await writeAutoSaveVersion(legacySlug, JSON.stringify({ a: 2 }), { now: 1_700_000_002_000 });

    // Vor Migration: shouldPrompt=true
    const before = checkLegacySlugMigration(2, 0, projectName);
    expect(before.shouldPrompt).toBe(true);
    expect(before.reason).toBe("migrate");
    expect(before.legacyCount).toBe(2);
    expect(before.legacySlug).toBe(legacySlug);

    // Migrate
    const res = await migrateLegacyVersions(legacySlug, uuid);
    expect(res.migrated).toBe(2);

    // Nach Migration: legacyCount=0 → no-legacy
    const legacyAfter = await listAutoSaveVersions(legacySlug);
    const uuidAfter = await listAutoSaveVersions(uuid);
    const after = checkLegacySlugMigration(legacyAfter.length, uuidAfter.length, projectName);
    expect(after.shouldPrompt).toBe(false);
    expect(after.reason).toBe("no-legacy");
  });

  it("UUID hat schon History → kein Prompt (uuid-has-history)", () => {
    const check = checkLegacySlugMigration(3, 1, "Some Project");
    expect(check.shouldPrompt).toBe(false);
    expect(check.reason).toBe("uuid-has-history");
    expect(check.legacyCount).toBe(3);
  });
});
