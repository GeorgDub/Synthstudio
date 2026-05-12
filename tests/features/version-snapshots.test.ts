/**
 * tests/features/version-snapshots.test.ts
 *
 * Unit-Tests fuer useVersionSnapshotStore.
 * HINWEIS zu den Namen: Der Store exportiert die imperativen Funktionen
 * als saveSnapshot, deleteSnapshot und getSnapshot (Einzelabruf). Eine
 * Funktion namens "getSnapshots" gibt es nicht; die Liste wird ueber den
 * Hook (useVersionSnapshotStore()) gelesen. Hier umgehen wir den Hook
 * indem wir die Snapshots direkt aus localStorage zurueck-parsen.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

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
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  saveSnapshot,
  deleteSnapshot,
  getSnapshot,
  useVersionSnapshotStore,
  type VersionSnapshot,
} from "../../client/src/store/useVersionSnapshotStore";

const STORAGE_KEY = "ss-version-snapshots:v1";

function readSnapshots(): VersionSnapshot[] {
  const raw = localStorageMock.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function clearAllSnapshots() {
  let snaps = readSnapshots();
  while (snaps.length > 0) {
    deleteSnapshot(snaps[0].id);
    snaps = readSnapshots();
  }
}

describe("useVersionSnapshotStore", () => {
  beforeEach(() => {
    clearAllSnapshots();
    localStorageMock.clear();
  });

  it("saveSnapshot legt einen Snapshot mit ID, Label und Pattern-JSON an", () => {
    const id = saveSnapshot({ pattern: [1, 0, 1, 0] }, "MyProject");
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^snap-/);

    const snaps = readSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe(id);
    expect(snaps[0].projectName).toBe("MyProject");
    expect(snaps[0].label).toMatch(/^Auto-Save /);
    expect(JSON.parse(snaps[0].patternsJson)).toEqual({ pattern: [1, 0, 1, 0] });
  });

  it("saveSnapshot akzeptiert ein optionales Label", () => {
    const id = saveSnapshot({}, "X", "Vor Mix-Bounce");
    const snap = getSnapshot(id);
    expect(snap?.label).toBe("Vor Mix-Bounce");
  });

  it("saveSnapshot stellt neueste Snapshots an Position 0", () => {
    const id1 = saveSnapshot({ v: 1 }, "P", "First");
    const id2 = saveSnapshot({ v: 2 }, "P", "Second");
    const snaps = readSnapshots();
    expect(snaps[0].id).toBe(id2);
    expect(snaps[1].id).toBe(id1);
  });

  it("saveSnapshot rotiert: max 10 Snapshots, aelteste fallen raus", () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(saveSnapshot({ v: i }, "P", `Label ${i}`));
    }
    const snaps = readSnapshots();
    expect(snaps).toHaveLength(10);
    // Neueste 10 (i = 11 → i = 2) sind erhalten
    expect(snaps[0].label).toBe("Label 11");
    expect(snaps[9].label).toBe("Label 2");
    // i=0 und i=1 wurden rotiert
    expect(snaps.find((s) => s.label === "Label 0")).toBeUndefined();
    expect(snaps.find((s) => s.label === "Label 1")).toBeUndefined();
  });

  it("deleteSnapshot entfernt Snapshot anhand der ID", () => {
    const a = saveSnapshot({}, "P", "A");
    const b = saveSnapshot({}, "P", "B");
    deleteSnapshot(a);
    const snaps = readSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe(b);
  });

  it("getSnapshot liefert Snapshot per ID, sonst undefined", () => {
    const id = saveSnapshot({ data: 42 }, "P", "Test");
    const snap = getSnapshot(id);
    expect(snap).toBeDefined();
    expect(snap?.id).toBe(id);
    expect(JSON.parse(snap!.patternsJson)).toEqual({ data: 42 });

    expect(getSnapshot("does-not-exist")).toBeUndefined();
  });

  it("Snapshot timestamp ist eine plausible Unix-Time", () => {
    const before = Date.now();
    const id = saveSnapshot({}, "P");
    const after = Date.now();
    const snap = getSnapshot(id);
    expect(snap?.timestamp).toBeGreaterThanOrEqual(before);
    expect(snap?.timestamp).toBeLessThanOrEqual(after);
  });

  it("exportiert useVersionSnapshotStore Hook-Funktion", () => {
    expect(typeof useVersionSnapshotStore).toBe("function");
  });
});
