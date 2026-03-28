/**
 * mod-matrix.test.ts
 *
 * Tests für Modulationsmatrix-Routing-Logik (Phase 6)
 */
import { describe, it, expect } from "vitest";
import type { ModMatrixEntry, ModSource, ModTarget } from "../../client/src/audio/AudioEngine";

// ─── Isolierte Routing-Logik ──────────────────────────────────────────────────

function makeEntryId() {
  return `mm-${Math.random().toString(36).slice(2, 8)}`;
}

interface ModMatrixStore {
  entries: ModMatrixEntry[];
  addEntry: (entry: Omit<ModMatrixEntry, "id">) => string;
  removeEntry: (id: string) => void;
  updateEntry: (id: string, update: Partial<ModMatrixEntry>) => void;
}

function createModMatrixStore(): ModMatrixStore {
  let entries: ModMatrixEntry[] = [];
  return {
    get entries() { return entries; },
    addEntry(entry) {
      const id = makeEntryId();
      entries = [...entries, { ...entry, id }];
      return id;
    },
    removeEntry(id) {
      entries = entries.filter(e => e.id !== id);
    },
    updateEntry(id, update) {
      entries = entries.map(e => e.id === id ? { ...e, ...update } : e);
    },
  };
}

function applyModMatrix(
  entries: ModMatrixEntry[],
  getSourceValue: (source: ModSource) => number,
  targetValues: Map<string, number>
): Map<string, number> {
  const result = new Map(targetValues);
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const sourceValue = getSourceValue(entry.source);
    const targetKey = `${entry.target.type}:${
      entry.target.type === "channelFx" ? entry.target.partId + ":" + entry.target.param
        : entry.target.type !== "random" ? entry.target.partId : "random"
    }`;
    const current = result.get(targetKey) ?? 0;
    result.set(targetKey, current + sourceValue * entry.amount);
  }
  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ModMatrix – Routing-Logik", () => {
  it("addEntry() fügt Entry mit eindeutiger ID hinzu", () => {
    const store = createModMatrixStore();
    const source: ModSource = { type: "random" };
    const target: ModTarget = { type: "volume", partId: "part-1" };
    const id = store.addEntry({ source, target, amount: 0.5, enabled: true });
    expect(id).toBeTruthy();
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].id).toBe(id);
  });

  it("removeEntry() entfernt korrekt", () => {
    const store = createModMatrixStore();
    const source: ModSource = { type: "random" };
    const target: ModTarget = { type: "pitch", partId: "part-1" };
    const id = store.addEntry({ source, target, amount: 0.5, enabled: true });
    store.removeEntry(id);
    expect(store.entries).toHaveLength(0);
  });

  it("disabled Entry hat keine Auswirkung auf Audio-Parameter", () => {
    const entries: ModMatrixEntry[] = [{
      id: "e1",
      source: { type: "random" },
      target: { type: "volume", partId: "p1" },
      amount: 1.0,
      enabled: false,  // deaktiviert
    }];
    const targetValues = new Map([["volume:p1", 0.5]]);
    const result = applyModMatrix(entries, () => 1.0, targetValues);
    // Disabled → kein Einfluss
    expect(result.get("volume:p1")).toBe(0.5);
  });

  it("amount=0 hat keine Auswirkung", () => {
    const entries: ModMatrixEntry[] = [{
      id: "e1",
      source: { type: "random" },
      target: { type: "volume", partId: "p1" },
      amount: 0,
      enabled: true,
    }];
    const targetValues = new Map([["volume:p1", 0.5]]);
    const result = applyModMatrix(entries, () => 1.0, targetValues);
    expect(result.get("volume:p1")).toBe(0.5);
  });

  it("amount=1 addiert Maximum (sourceValue=1) zum Ziel-Parameter", () => {
    const entries: ModMatrixEntry[] = [{
      id: "e1",
      source: { type: "random" },
      target: { type: "volume", partId: "p1" },
      amount: 1,
      enabled: true,
    }];
    const targetValues = new Map([["volume:p1", 0.5]]);
    const result = applyModMatrix(entries, () => 1.0, targetValues);
    expect(result.get("volume:p1")).toBeCloseTo(1.5);
  });

  it("amount=-1 subtrahiert Maximum vom Ziel-Parameter", () => {
    const entries: ModMatrixEntry[] = [{
      id: "e1",
      source: { type: "random" },
      target: { type: "volume", partId: "p1" },
      amount: -1,
      enabled: true,
    }];
    const targetValues = new Map([["volume:p1", 0.5]]);
    const result = applyModMatrix(entries, () => 1.0, targetValues);
    expect(result.get("volume:p1")).toBeCloseTo(-0.5);
  });

  it("mehrere Entries auf dasselbe Ziel werden summiert", () => {
    const entries: ModMatrixEntry[] = [
      {
        id: "e1",
        source: { type: "random" },
        target: { type: "volume", partId: "p1" },
        amount: 0.3,
        enabled: true,
      },
      {
        id: "e2",
        source: { type: "random" },
        target: { type: "volume", partId: "p1" },
        amount: 0.2,
        enabled: true,
      },
    ];
    const targetValues = new Map([["volume:p1", 0.0]]);
    const result = applyModMatrix(entries, () => 1.0, targetValues);
    // 0.3 + 0.2 = 0.5
    expect(result.get("volume:p1")).toBeCloseTo(0.5);
  });

  it("updateEntry() ändert amount eines bestehenden Entries", () => {
    const store = createModMatrixStore();
    const source: ModSource = { type: "random" };
    const target: ModTarget = { type: "pan", partId: "p1" };
    const id = store.addEntry({ source, target, amount: 0.5, enabled: true });
    store.updateEntry(id, { amount: 0.9 });
    expect(store.entries[0].amount).toBe(0.9);
  });

  it("zwei getrennte IDs für zwei addEntry()-Aufrufe", () => {
    const store = createModMatrixStore();
    const source: ModSource = { type: "random" };
    const target: ModTarget = { type: "volume", partId: "p1" };
    const id1 = store.addEntry({ source, target, amount: 0.5, enabled: true });
    const id2 = store.addEntry({ source, target, amount: 0.3, enabled: true });
    expect(id1).not.toBe(id2);
    expect(store.entries).toHaveLength(2);
  });
});
