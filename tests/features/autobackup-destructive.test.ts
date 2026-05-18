/**
 * tests/features/autobackup-destructive.test.ts
 *
 * v3.65.0 — Pre-Action AutoBackup. Vor destructive User-Actions
 * (Clear Pattern, Delete Pattern, Apply Template, Compact ESX-Bank)
 * wird eine markierte AutoSave-Version geschrieben. Schützt vor
 * Daten-Verlust zwischen 5-Minuten-AutoSave-Ticks.
 *
 * Coverage:
 *   - Pure-fn-Helpers (buildAutoBackupLabel, isAutoBackupLabel, stripAutoBackupPrefix)
 *   - autoBackupBeforeAction Happy-Path → Label in History
 *   - Fail-Silent: bei Engine-Error wird die Action trotzdem ausgeführt
 *   - Registry-Pattern: registerAutoBackup + getRegisteredAutoBackup
 *   - History-Filter: nur Labels (Pre-Action + manuelle) sichtbar bleiben
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────

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
  autoBackupBeforeAction,
  buildAutoBackupLabel,
  isAutoBackupLabel,
  stripAutoBackupPrefix,
  registerAutoBackup,
  getRegisteredAutoBackup,
  __resetAutoBackupRegistryForTests,
  AUTO_BACKUP_LABEL_PREFIX,
} from "../../client/src/utils/autoBackupController";

import {
  listAutoSaveVersions,
  __setAutoSaveElectronOverrideForTests,
  __resetAutoSaveEngineForTests,
  type AutoSaveVersionMeta,
} from "../../client/src/utils/autoSaveEngine";

// ─── In-Memory Electron Backend ──────────────────────────────────────────────

function makeMemoryElectronBackend(opts: { failWrites?: boolean } = {}) {
  const records = new Map<
    string,
    { projectId: string; versionId: string; timestamp: number; size: number; label?: string; json: string }
  >();
  return {
    records,
    api: {
      autoSaveWrite: vi.fn(async (projectId: string, versionId: string, json: string, label?: string) => {
        if (opts.failWrites) return { success: false, error: "backend forced fail" };
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
  __resetAutoBackupRegistryForTests();
  __resetAutoSaveEngineForTests();
  __setAutoSaveElectronOverrideForTests(null);
});

// ─── (1) Pure-fn-Label-Helpers ───────────────────────────────────────────────

describe("v3.65.0 AutoBackup — Label-Helpers", () => {
  it("buildAutoBackupLabel präfixt 'Before: '", () => {
    expect(buildAutoBackupLabel("Clear Pattern")).toBe("Before: Clear Pattern");
    expect(buildAutoBackupLabel("Delete Pattern")).toBe("Before: Delete Pattern");
  });

  it("buildAutoBackupLabel ist idempotent (doppel-Präfix wird vermieden)", () => {
    const once = buildAutoBackupLabel("Clear Pattern");
    const twice = buildAutoBackupLabel(once);
    expect(twice).toBe(once);
    expect(twice).toBe("Before: Clear Pattern");
  });

  it("buildAutoBackupLabel defensive bei leerem Input → Fallback 'Before: Action'", () => {
    expect(buildAutoBackupLabel("")).toBe("Before: Action");
    expect(buildAutoBackupLabel("   ")).toBe("Before: Action");
    // Non-string Input (forced cast)
    expect(buildAutoBackupLabel(undefined as unknown as string)).toBe("Before: Action");
    expect(buildAutoBackupLabel(null as unknown as string)).toBe("Before: Action");
  });

  it("buildAutoBackupLabel cappt sehr lange Labels", () => {
    const long = "x".repeat(300);
    const out = buildAutoBackupLabel(long);
    expect(out.startsWith(AUTO_BACKUP_LABEL_PREFIX)).toBe(true);
    // Ohne Präfix max 150 chars.
    expect(out.length - AUTO_BACKUP_LABEL_PREFIX.length).toBeLessThanOrEqual(150);
  });

  it("isAutoBackupLabel erkennt Pre-Action-Labels", () => {
    expect(isAutoBackupLabel("Before: Clear Pattern")).toBe(true);
    expect(isAutoBackupLabel("Before: Delete Pattern: Drums")).toBe(true);
    expect(isAutoBackupLabel("manual save")).toBe(false);
    expect(isAutoBackupLabel("")).toBe(false);
    expect(isAutoBackupLabel(null)).toBe(false);
    expect(isAutoBackupLabel(undefined)).toBe(false);
  });

  it("stripAutoBackupPrefix entfernt 'Before: ' für UI-Display", () => {
    expect(stripAutoBackupPrefix("Before: Clear Pattern")).toBe("Clear Pattern");
    expect(stripAutoBackupPrefix("manual")).toBe("manual"); // pass-through
    expect(stripAutoBackupPrefix(null)).toBe("");
    expect(stripAutoBackupPrefix(undefined)).toBe("");
  });
});

// ─── (2) autoBackupBeforeAction Happy-Path ───────────────────────────────────

describe("v3.65.0 AutoBackup — autoBackupBeforeAction", () => {
  it("schreibt Version mit 'Before: <label>'-Label in History", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const json = JSON.stringify({ projectName: "MyProject", bpm: 120 });
    const res = await autoBackupBeforeAction(
      "Clear Pattern",
      "test-proj-1",
      () => json,
    );

    expect(res.success).toBe(true);
    expect(res.label).toBe("Before: Clear Pattern");
    expect(res.versionId).toBeTruthy();

    // Backend wurde mit Label gerufen.
    expect(backend.api.autoSaveWrite).toHaveBeenCalledTimes(1);
    const callArgs = backend.api.autoSaveWrite.mock.calls[0];
    expect(callArgs[0]).toBe("test-proj-1");
    expect(callArgs[3]).toBe("Before: Clear Pattern");

    // Version landet in der Liste mit dem korrekten Label.
    const list = await listAutoSaveVersions("test-proj-1");
    expect(list.length).toBe(1);
    expect(list[0].label).toBe("Before: Clear Pattern");
  });

  it("multiple Pre-Action-Backups landen alle in History (Label-sichtbar)", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    let t = 1_700_000_000_000;
    const json = JSON.stringify({ projectName: "P" });

    // Drei unterschiedliche Pre-Action-Backups.
    await autoBackupBeforeAction("Clear Pattern", "pid-x", () => json);
    // Forciere unique versionId via Override (writeAutoSaveVersion nutzt
    // Date.now() — wir lassen es einfach laufen, real-time genügt).
    await new Promise((r) => setTimeout(r, 2));
    await autoBackupBeforeAction("Delete Pattern: Drums", "pid-x", () => json);
    await new Promise((r) => setTimeout(r, 2));
    await autoBackupBeforeAction("Apply Template: KORG-1", "pid-x", () => json);

    const list = await listAutoSaveVersions("pid-x");
    expect(list.length).toBe(3);
    const labels = list.map((v) => v.label).sort();
    expect(labels).toEqual([
      "Before: Apply Template: KORG-1",
      "Before: Clear Pattern",
      "Before: Delete Pattern: Drums",
    ]);
    // Alle Labels sind als Pre-Action erkennbar.
    expect(list.every((v) => isAutoBackupLabel(v.label))).toBe(true);
    // unused t to keep tsconfig happy
    expect(t).toBeGreaterThan(0);
  });
});

// ─── (3) Fail-Silent (Action darf nie blockiert werden) ──────────────────────

describe("v3.65.0 AutoBackup — Fail-Silent (kein Action-Block)", () => {
  it("missing projectId → success=false, ABER kein Throw", async () => {
    const res = await autoBackupBeforeAction(
      "Clear Pattern",
      null as unknown as string,
      () => JSON.stringify({ x: 1 }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/projectId/i);
    // Label wird trotzdem zurückgegeben (für Konsistenz beim Caller).
    expect(res.label).toBe("Before: Clear Pattern");
  });

  it("Snapshot-Provider wirft → success=false, KEIN Re-Throw", async () => {
    const res = await autoBackupBeforeAction(
      "Clear Pattern",
      "pid-y",
      () => {
        throw new Error("boom");
      },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/snapshot-throw|boom/i);
  });

  it("empty snapshot → success=false, kein Backend-Call", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const res = await autoBackupBeforeAction(
      "Clear Pattern",
      "pid-y",
      () => "",
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/empty snapshot/i);
    expect(backend.api.autoSaveWrite).not.toHaveBeenCalled();
  });

  it("Backend write fail → success=false, kein Throw, Engine-Error im Result", async () => {
    const backend = makeMemoryElectronBackend({ failWrites: true });
    __setAutoSaveElectronOverrideForTests(backend.api);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const res = await autoBackupBeforeAction(
        "Clear Pattern",
        "pid-z",
        () => JSON.stringify({ projectName: "P" }),
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/backend forced fail/);
      // Backend WURDE gerufen.
      expect(backend.api.autoSaveWrite).toHaveBeenCalledTimes(1);
      // console.warn wurde defensive geloggt.
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ─── (4) Registry-Pattern (App.tsx ↔ DrumMachine.tsx) ────────────────────────

describe("v3.65.0 AutoBackup — Registry (registerAutoBackup)", () => {
  it("getRegisteredAutoBackup → safe no-op wenn nichts registriert", async () => {
    const fn = getRegisteredAutoBackup();
    const res = await fn("Clear Pattern");
    // No-op returnt success=false, aber wirft nicht — Aktion läuft normal weiter.
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no backup registered/);
    expect(res.label).toBe("Before: Clear Pattern");
  });

  it("registerAutoBackup + getRegisteredAutoBackup ruft die echte Fn", async () => {
    const calls: string[] = [];
    registerAutoBackup(async (label) => {
      calls.push(label);
      return { success: true, label: `Before: ${label}` };
    });

    const fn = getRegisteredAutoBackup();
    const res = await fn("Clear Pattern");
    expect(res.success).toBe(true);
    expect(calls).toEqual(["Clear Pattern"]);
  });

  it("registerAutoBackup(null) deaktiviert (z.B. App-Unmount)", async () => {
    registerAutoBackup(async () => ({ success: true, label: "Before: x" }));
    registerAutoBackup(null);
    const fn = getRegisteredAutoBackup();
    const res = await fn("Clear Pattern");
    expect(res.success).toBe(false);
  });
});

// ─── (5) History-Filter (Label-only) ─────────────────────────────────────────

describe("v3.65.0 AutoBackup — History-Filter (Label-only)", () => {
  it("Pre-Action-Labels + manuelle Labels passieren den Filter, unlabeled nicht", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    // 3 Versionen — Mix: 1 auto (no label), 1 pre-action, 1 manual.
    const json = JSON.stringify({ projectName: "P" });
    await import("../../client/src/utils/autoSaveEngine").then(async (mod) => {
      await mod.writeAutoSaveVersion("hist-1", json, { now: 1_700_000_000_001 }); // no label
      await mod.writeAutoSaveVersion("hist-1", json, {
        now: 1_700_000_000_002,
        label: "Before: Clear Pattern",
      });
      await mod.writeAutoSaveVersion("hist-1", json, {
        now: 1_700_000_000_003,
        label: "manual save before plugin change",
      });
    });

    const all = await listAutoSaveVersions("hist-1");
    expect(all.length).toBe(3);

    // Filter-Logik (wie im Modal):
    const labeled = all.filter(
      (v) => typeof v.label === "string" && v.label.length > 0,
    );
    expect(labeled.length).toBe(2);
    expect(labeled.map((v) => v.label).sort()).toEqual([
      "Before: Clear Pattern",
      "manual save before plugin change",
    ]);

    // Pre-Action-Subfilter
    const preAction = labeled.filter((v) => isAutoBackupLabel(v.label));
    expect(preAction.length).toBe(1);
    expect(preAction[0].label).toBe("Before: Clear Pattern");
  });

  it("nach autoBackupBeforeAction ist die Version im Filter sichtbar", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    // Erst eine 5min-Auto-Save (kein Label).
    const eng = await import("../../client/src/utils/autoSaveEngine");
    await eng.writeAutoSaveVersion(
      "hist-2",
      JSON.stringify({ projectName: "P" }),
      { now: 1_700_000_000_000 },
    );

    // Dann Pre-Action-Backup.
    await autoBackupBeforeAction(
      "Apply Template: KORG-Tribe",
      "hist-2",
      () => JSON.stringify({ projectName: "P", patched: true }),
    );

    const all = await listAutoSaveVersions("hist-2");
    expect(all.length).toBe(2);

    const labeled = all.filter((v) => typeof v.label === "string" && v.label.length > 0);
    expect(labeled.length).toBe(1);
    expect(labeled[0].label).toBe("Before: Apply Template: KORG-Tribe");

    // Anzeige in UI: stripAutoBackupPrefix gibt das User-readable Label.
    expect(stripAutoBackupPrefix(labeled[0].label)).toBe("Apply Template: KORG-Tribe");
  });
});
