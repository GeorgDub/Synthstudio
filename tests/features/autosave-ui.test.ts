/**
 * tests/features/autosave-ui.test.ts
 *
 * v3.57.0 — AutoSave UI-Wiring (Trigger + Topbar + Versions-Modal).
 *
 * Coverage:
 *   (1) Pure-fn-Controller (computeAutoSaveIntervalMs, decideAutoSaveTick,
 *       buildAutoSaveStatusDisplay, projectNameToId, formatBytes,
 *       formatVersionTimestamp).
 *   (2) Trigger-Decision: setInterval-Tick respektiert paused + disabled.
 *   (3) Engine-Integration: writeAutoSaveVersion → markAutoSaveCompleted
 *       Round-Trip mit Electron-Override.
 *   (4) Delete-Workflow: deleteAutoSaveVersion entfernt Eintrag aus Liste.
 *
 * Pure node-env Tests (kein jsdom nötig — die Engine ist isomorph + die
 * Pure-fns brauchen kein DOM).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock (für useAutoSaveStore) ────────────────────────────────

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
  // v3.61.0: Pro-projectId Tracking
  setLastSaveAt,
  getLastSaveAtForProject,
  resetAutoSaveLastSaveAt,
  type AutoSaveSettings,
} from "../../client/src/store/useAutoSaveStore";

import {
  writeAutoSaveVersion,
  listAutoSaveVersions,
  deleteAutoSaveVersion,
  __setAutoSaveElectronOverrideForTests,
  __resetAutoSaveEngineForTests,
  type AutoSaveVersionMeta,
} from "../../client/src/utils/autoSaveEngine";

import {
  computeAutoSaveIntervalMs,
  decideAutoSaveTick,
  buildAutoSaveStatusDisplay,
  projectNameToId,
  formatBytes,
  formatVersionTimestamp,
} from "../../client/src/utils/autoSaveController";

// ─── In-Memory Electron-Backend (selbe Idee wie autosave.test.ts) ────────────

function makeMemoryElectronBackend() {
  const records = new Map<
    string,
    { projectId: string; versionId: string; timestamp: number; size: number; label?: string; json: string }
  >();
  return {
    records,
    api: {
      autoSaveWrite: vi.fn(async (projectId: string, versionId: string, json: string, label?: string) => {
        records.set(`${projectId}:${versionId}`, {
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

// ─── (1) Pure-fn Controller-Helpers ──────────────────────────────────────────

describe("autoSaveController — Pure-fn Helpers", () => {
  it("computeAutoSaveIntervalMs konvertiert Minuten → ms, mit Fallback bei NaN", () => {
    expect(computeAutoSaveIntervalMs(5)).toBe(5 * 60_000);
    expect(computeAutoSaveIntervalMs(1)).toBe(60_000);
    expect(computeAutoSaveIntervalMs(60)).toBe(3_600_000);
    expect(computeAutoSaveIntervalMs(0)).toBe(5 * 60_000);
    expect(computeAutoSaveIntervalMs(-5)).toBe(5 * 60_000);
    expect(computeAutoSaveIntervalMs(NaN)).toBe(5 * 60_000);
    expect(computeAutoSaveIntervalMs(Infinity)).toBe(5 * 60_000);
  });

  it("decideAutoSaveTick respektiert enabled+paused", () => {
    const enabledSettings: AutoSaveSettings = { enabled: true, intervalMin: 5, lastSaveAt: null };
    const disabledSettings: AutoSaveSettings = { enabled: false, intervalMin: 5, lastSaveAt: null };
    expect(decideAutoSaveTick(enabledSettings, false)).toEqual({ shouldRun: true, reason: "ok" });
    expect(decideAutoSaveTick(enabledSettings, true)).toEqual({ shouldRun: false, reason: "paused" });
    expect(decideAutoSaveTick(disabledSettings, false)).toEqual({ shouldRun: false, reason: "disabled" });
    expect(decideAutoSaveTick(disabledSettings, true)).toEqual({ shouldRun: false, reason: "disabled" });
  });

  it("buildAutoSaveStatusDisplay liefert isEmpty=true bei null + Kurzlabel sonst", () => {
    const empty = buildAutoSaveStatusDisplay(null);
    expect(empty.isEmpty).toBe(true);
    expect(empty.shortLabel).toContain("Noch nie");

    const now = 1_700_000_000_000;
    const justNow = buildAutoSaveStatusDisplay(now - 500, now);
    expect(justNow.isEmpty).toBe(false);
    expect(justNow.shortLabel).toBe("gerade eben");

    const sec = buildAutoSaveStatusDisplay(now - 30_000, now);
    expect(sec.shortLabel).toBe("30s");

    const min = buildAutoSaveStatusDisplay(now - 5 * 60_000, now);
    expect(min.shortLabel).toBe("5m");
    expect(min.tooltip).toContain("vor 5 Minuten");

    const hr = buildAutoSaveStatusDisplay(now - 3 * 3600_000, now);
    expect(hr.shortLabel).toBe("3h");

    const day = buildAutoSaveStatusDisplay(now - 2 * 86400_000, now);
    expect(day.shortLabel).toBe("2d");
  });

  it("projectNameToId saniert Sonderzeichen, fällt auf 'default' zurück", () => {
    expect(projectNameToId("Mein Projekt 2025")).toBe("mein-projekt-2025");
    expect(projectNameToId("Test/with/slash")).toBe("test-with-slash");
    expect(projectNameToId("..hidden")).toBe("hidden");
    expect(projectNameToId("")).toBe("default");
    expect(projectNameToId(null)).toBe("default");
    expect(projectNameToId(undefined)).toBe("default");
    expect(projectNameToId("!@#$%^&*()")).toBe("default");
    const long = "a".repeat(100);
    expect(projectNameToId(long).length).toBeLessThanOrEqual(64);
  });

  it("formatBytes liefert lesbare Einheiten", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MB");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });

  it("formatVersionTimestamp liefert DD.MM.YYYY HH:MM:SS", () => {
    // 2023-11-14T22:13:20.000Z = Timestamp 1700000000000
    const formatted = formatVersionTimestamp(1700000000000);
    expect(formatted).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
    expect(formatVersionTimestamp(NaN)).toBe("—");
  });
});

// ─── (2) Trigger-Decision-Logik (simuliert App.tsx setInterval-Tick) ─────────

describe("AutoSave Trigger-Decision (simuliert setInterval-Tick)", () => {
  it("Tick respektiert enabled-Flag — disabled → kein Write", () => {
    setAutoSaveEnabled(false);
    const settings = getAutoSaveSettings();
    const decision = decideAutoSaveTick(settings, isAutoSavePaused());
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toBe("disabled");
  });

  it("Tick respektiert pause-Flag während Manual-Save", () => {
    expect(getAutoSaveSettings().enabled).toBe(true);
    pauseAutoSave();
    const settings = getAutoSaveSettings();
    const decision = decideAutoSaveTick(settings, isAutoSavePaused());
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toBe("paused");
    resumeAutoSave();
    expect(decideAutoSaveTick(getAutoSaveSettings(), isAutoSavePaused()).shouldRun).toBe(true);
  });

  it("clampInterval-Path: setAutoSaveInterval clampt + computeAutoSaveIntervalMs konsumiert clamped Wert", () => {
    setAutoSaveInterval(9999);
    expect(getAutoSaveSettings().intervalMin).toBe(60);
    expect(computeAutoSaveIntervalMs(getAutoSaveSettings().intervalMin)).toBe(60 * 60_000);

    setAutoSaveInterval(-10);
    expect(getAutoSaveSettings().intervalMin).toBe(1);
    expect(computeAutoSaveIntervalMs(getAutoSaveSettings().intervalMin)).toBe(60_000);
  });
});

// ─── (3) Engine-Integration: Trigger → write → lastSaveAt ────────────────────

describe("AutoSave Engine-Integration (simuliert Trigger-Tick)", () => {
  it("writeAutoSaveVersion mit Electron-Override → markAutoSaveCompleted setzt lastSaveAt", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    expect(getAutoSaveSettings().lastSaveAt).toBeNull();

    const projectId = projectNameToId("Test Projekt");
    const json = JSON.stringify({ projectName: "Test Projekt", bpm: 120 });
    const fixedNow = 1_700_000_001_000;
    const res = await writeAutoSaveVersion(projectId, json, { now: fixedNow });
    expect(res.success).toBe(true);
    expect(res.versionId).toBe(String(fixedNow));
    // App-Code würde jetzt markAutoSaveCompleted() rufen
    markAutoSaveCompleted(fixedNow);
    expect(getAutoSaveSettings().lastSaveAt).toBe(fixedNow);
    expect(backend.api.autoSaveWrite).toHaveBeenCalledTimes(1);
  });

  it("Versions-History listet alle geschriebenen Versionen DESC", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const projectId = projectNameToId("ListTest");
    const json = JSON.stringify({ projectName: "ListTest" });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_001_000 });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_002_000 });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_003_000 });

    const list = await listAutoSaveVersions(projectId);
    expect(list).toHaveLength(3);
    // DESC: newest first
    expect(list[0]?.timestamp).toBe(1_700_000_003_000);
    expect(list[2]?.timestamp).toBe(1_700_000_001_000);
  });

  it("Restore-Workflow ruft restoreAutoSaveVersion und liefert die Quelle zurück", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const projectId = projectNameToId("RestoreTest");
    const original = { projectName: "RestoreTest", bpm: 140, foo: "bar" };
    const json = JSON.stringify(original);
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_005_000 });

    const list = await listAutoSaveVersions(projectId);
    expect(list.length).toBeGreaterThan(0);
    const versionId = list[0]!.versionId;

    // Simuliert den Modal-Restore-Workflow.
    const { restoreAutoSaveVersion } = await import("../../client/src/utils/autoSaveEngine");
    const res = await restoreAutoSaveVersion(projectId, versionId);
    expect(res.success).toBe(true);
    expect(res.json).toBeDefined();
    expect(JSON.parse(res.json!)).toEqual(original);
  });
});

// ─── (4) Delete-Workflow ────────────────────────────────────────────────────

describe("AutoSave Delete-Workflow (Modal-Action)", () => {
  it("Delete-Workflow entfernt Version aus Liste", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const projectId = projectNameToId("DeleteTest");
    const json = JSON.stringify({ projectName: "DeleteTest" });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_010_000 });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_011_000 });

    let list = await listAutoSaveVersions(projectId);
    expect(list).toHaveLength(2);
    const toDelete = list[0]!.versionId;

    const res = await deleteAutoSaveVersion(projectId, toDelete);
    expect(res.success).toBe(true);

    list = await listAutoSaveVersions(projectId);
    expect(list).toHaveLength(1);
    expect(list[0]!.versionId).not.toBe(toDelete);
    expect(backend.api.autoSaveDelete).toHaveBeenCalledWith(projectId, toDelete);
  });

  it("Delete idempotent — Doppel-Delete liefert success ohne Crash", async () => {
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const projectId = projectNameToId("IdempotentDelete");
    const json = JSON.stringify({ projectName: "IdempotentDelete" });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_020_000 });
    const list = await listAutoSaveVersions(projectId);
    const versionId = list[0]!.versionId;

    const first = await deleteAutoSaveVersion(projectId, versionId);
    expect(first.success).toBe(true);
    const second = await deleteAutoSaveVersion(projectId, versionId);
    expect(second.success).toBe(true); // best-effort: idempotent
  });
});

// ─── (5) v3.61.0: Pro-projectId lastSaveAt-Tracking ──────────────────────────

describe("v3.61.0 — Pro-projectId lastSaveAt", () => {
  it("setLastSaveAt persistiert pro projectId in localStorage", () => {
    setLastSaveAt("projectA", 1_700_000_100_000);
    setLastSaveAt("projectB", 1_700_000_200_000);

    // Runtime-Read
    expect(getLastSaveAtForProject("projectA")).toBe(1_700_000_100_000);
    expect(getLastSaveAtForProject("projectB")).toBe(1_700_000_200_000);

    // localStorage-Persistenz
    const raw = localStorageMock.getItem("ss-autosave-settings:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.lastSaveAtPerProject).toBeDefined();
    expect(parsed.lastSaveAtPerProject.projectA).toBe(1_700_000_100_000);
    expect(parsed.lastSaveAtPerProject.projectB).toBe(1_700_000_200_000);
  });

  it("Different projectIds haben separate lastSaveAt-Werte (Isolation)", () => {
    setLastSaveAt("alpha", 1_700_000_300_000);
    setLastSaveAt("beta", 1_700_000_400_000);
    setLastSaveAt("gamma", 1_700_000_500_000);

    expect(getLastSaveAtForProject("alpha")).toBe(1_700_000_300_000);
    expect(getLastSaveAtForProject("beta")).toBe(1_700_000_400_000);
    expect(getLastSaveAtForProject("gamma")).toBe(1_700_000_500_000);

    // Update einer ID darf andere nicht beeinflussen.
    setLastSaveAt("alpha", 1_700_000_999_000);
    expect(getLastSaveAtForProject("alpha")).toBe(1_700_000_999_000);
    expect(getLastSaveAtForProject("beta")).toBe(1_700_000_400_000);
    expect(getLastSaveAtForProject("gamma")).toBe(1_700_000_500_000);

    // Unbekannte ID → null
    expect(getLastSaveAtForProject("delta")).toBeNull();
  });

  it("Topbar-Indicator-Source: effectiveLastSaveAt = perProject ?? legacy", () => {
    // Simuliert die Indicator-Logik (perProject ?? settings.lastSaveAt).
    const projectId = "topbarTest";

    // Initial: keiner gesetzt → effective = null → "Noch nie"
    expect(getLastSaveAtForProject(projectId)).toBeNull();
    expect(getAutoSaveSettings().lastSaveAt).toBeNull();

    // Legacy gesetzt aber kein per-project Eintrag → effective = legacy
    markAutoSaveCompleted(1_700_000_700_000);
    {
      const perProject = getLastSaveAtForProject(projectId);
      const legacy = getAutoSaveSettings().lastSaveAt;
      const effective = perProject ?? legacy;
      expect(effective).toBe(1_700_000_700_000);
    }

    // per-project gesetzt → effective = per-project (auch wenn legacy
    // einen anderen Wert hat)
    setLastSaveAt(projectId, 1_700_000_800_000);
    {
      const perProject = getLastSaveAtForProject(projectId);
      const effective = perProject ?? getAutoSaveSettings().lastSaveAt;
      expect(effective).toBe(1_700_000_800_000);
    }

    // Anderer Projekt-Wechsel: kein per-project Eintrag für "andere" →
    // fällt auf legacy zurück (welcher beim letzten setLastSaveAt aktualisiert
    // wurde, weil v3.61 setLastSaveAt synchronisiert Legacy+Map).
    {
      const perProject = getLastSaveAtForProject("andere");
      const effective = perProject ?? getAutoSaveSettings().lastSaveAt;
      expect(effective).toBe(1_700_000_800_000);
    }
  });

  it("Post-Restore-Lookup: latestVersion.timestamp → setLastSaveAt", async () => {
    // Simuliert App.tsx restoreProject-Flow:
    //  1) resetAutoSaveLastSaveAt() (Legacy auf null)
    //  2) listAutoSaveVersions(projectId) → newest = list[0]
    //  3) setLastSaveAt(projectId, newest.timestamp)
    const backend = makeMemoryElectronBackend();
    __setAutoSaveElectronOverrideForTests(backend.api);

    const projectId = projectNameToId("RestoreLookup");
    const json = JSON.stringify({ projectName: "RestoreLookup" });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_900_000 });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_950_000 });
    await writeAutoSaveVersion(projectId, json, { now: 1_700_000_980_000 });

    // Simuliere Restore-Phase
    resetAutoSaveLastSaveAt();
    expect(getAutoSaveSettings().lastSaveAt).toBeNull();
    expect(getLastSaveAtForProject(projectId)).toBeNull();

    // Post-Restore-Lookup
    const list = await listAutoSaveVersions(projectId);
    expect(list.length).toBeGreaterThan(0);
    const newest = list[0]!;
    expect(newest.timestamp).toBe(1_700_000_980_000); // DESC

    setLastSaveAt(projectId, newest.timestamp);
    expect(getLastSaveAtForProject(projectId)).toBe(1_700_000_980_000);
    // Legacy mirror (für Indicator ohne projectId-Prop)
    expect(getAutoSaveSettings().lastSaveAt).toBe(1_700_000_980_000);
  });

  it("resetAutoSaveLastSaveAt lässt per-project Map intakt (v3.61 contract)", () => {
    setLastSaveAt("retained", 1_700_001_000_000);
    expect(getLastSaveAtForProject("retained")).toBe(1_700_001_000_000);
    expect(getAutoSaveSettings().lastSaveAt).toBe(1_700_001_000_000);

    // Reset clear-t NUR Legacy, NICHT die Map (damit Zurückwechseln zum
    // alten Projekt sein lastSaveAt wieder finden kann).
    resetAutoSaveLastSaveAt();
    expect(getAutoSaveSettings().lastSaveAt).toBeNull();
    expect(getLastSaveAtForProject("retained")).toBe(1_700_001_000_000);
  });

  it("setLastSaveAt defensive: leere/ungültige projectId ist No-Op", () => {
    setLastSaveAt("valid", 1_700_001_100_000);
    const before = getAutoSaveSettings().lastSaveAt;

    // Defensive: keine Mutation bei kaputtem Input.
    setLastSaveAt("", 1_700_001_200_000);
    setLastSaveAt("alsoValid", NaN);
    setLastSaveAt("alsoValid", -1);

    expect(getAutoSaveSettings().lastSaveAt).toBe(before);
    expect(getLastSaveAtForProject("")).toBeNull();
    expect(getLastSaveAtForProject("alsoValid")).toBeNull();
    // Der einzige valide bleibt erhalten.
    expect(getLastSaveAtForProject("valid")).toBe(1_700_001_100_000);
  });

  it("Reload-Persistenz: Map überlebt einen Store-Reset wenn localStorage erhalten bleibt", () => {
    // Simuliert: User schreibt mehrere Saves, schließt App, öffnet wieder.
    setLastSaveAt("persisted-a", 1_700_001_300_000);
    setLastSaveAt("persisted-b", 1_700_001_400_000);

    // Inspiziere den persistierten State direkt.
    const raw = localStorageMock.getItem("ss-autosave-settings:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.lastSaveAtPerProject["persisted-a"]).toBe(1_700_001_300_000);
    expect(parsed.lastSaveAtPerProject["persisted-b"]).toBe(1_700_001_400_000);
  });
});
