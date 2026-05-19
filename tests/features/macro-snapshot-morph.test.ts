/**
 * Synthstudio – Macro-Snapshot-Morph Tests (v3.115.0)
 *
 * Deckt ab:
 *  - Pure-Helper morphValues / normalizeMacroValues
 *  - Store-CRUD addSnapshot / updateSnapshot / removeSnapshot
 *  - Morph-Slot-Management setMorphA / setMorphB / setMorphAmount
 *  - Recall-Helper recallSnapshot
 *  - Persistence (localStorage Roundtrip)
 *  - Fallback bei A=null / B=null
 *
 * jsdom-frei: nutzt lokalen localStorage-Mock damit der Store in Node läuft.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  MACRO_VALUES_LENGTH,
  morphValues,
  normalizeMacroValues,
} from "../../client/src/utils/macroMorph";

// ─── localStorage-Mock (vor Store-Import nötig) ──────────────────────────────
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  get length(): number { return this.store.size; }
}
(globalThis as unknown as { localStorage: LocalStorageMock }).localStorage = new LocalStorageMock();

import {
  __resetMacroSnapshotStoreForTests,
  addSnapshot,
  getCurrentMorphedValues,
  getMacroSnapshotState,
  recallSnapshot,
  removeSnapshot,
  setMorphA,
  setMorphAmount,
  setMorphB,
  updateSnapshot,
} from "../../client/src/store/useMacroSnapshotStore";

beforeEach(() => {
  __resetMacroSnapshotStoreForTests();
});

// ─── normalizeMacroValues ────────────────────────────────────────────────────
describe("normalizeMacroValues", () => {
  it("padded mit 0 wenn Array kürzer als MACRO_VALUES_LENGTH", () => {
    const out = normalizeMacroValues([0.5, 0.7]);
    expect(out.length).toBe(MACRO_VALUES_LENGTH);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(0.7);
    for (let i = 2; i < MACRO_VALUES_LENGTH; i++) expect(out[i]).toBe(0);
  });

  it("truncated wenn Array länger als MACRO_VALUES_LENGTH", () => {
    const long = Array.from({ length: 12 }, (_, i) => i / 11);
    const out = normalizeMacroValues(long);
    expect(out.length).toBe(MACRO_VALUES_LENGTH);
    expect(out[0]).toBeCloseTo(long[0]);
    expect(out[7]).toBeCloseTo(long[7]);
  });

  it("clamp 0..1 + NaN/Infinity → 0", () => {
    const out = normalizeMacroValues([-0.5, 1.5, NaN, Infinity, 0.3, 0, 1, 0.99]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(0);
    expect(out[4]).toBeCloseTo(0.3);
    expect(out[5]).toBe(0);
    expect(out[6]).toBe(1);
    expect(out[7]).toBeCloseTo(0.99);
  });

  it("null/undefined input → 8 Nullen", () => {
    expect(normalizeMacroValues(null)).toEqual(new Array(MACRO_VALUES_LENGTH).fill(0));
    expect(normalizeMacroValues(undefined)).toEqual(new Array(MACRO_VALUES_LENGTH).fill(0));
  });
});

// ─── morphValues ─────────────────────────────────────────────────────────────
describe("morphValues", () => {
  const A = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 0.0, 0.5];
  const B = [1.0, 0.8, 0.6, 0.4, 0.2, 0.0, 1.0, 0.5];

  it("amount=0 → A", () => {
    const out = morphValues(A, B, 0);
    for (let i = 0; i < MACRO_VALUES_LENGTH; i++) expect(out[i]).toBeCloseTo(A[i]);
  });

  it("amount=1 → B", () => {
    const out = morphValues(A, B, 1);
    for (let i = 0; i < MACRO_VALUES_LENGTH; i++) expect(out[i]).toBeCloseTo(B[i]);
  });

  it("amount=0.5 → midpoint", () => {
    const out = morphValues(A, B, 0.5);
    for (let i = 0; i < MACRO_VALUES_LENGTH; i++) {
      expect(out[i]).toBeCloseTo((A[i] + B[i]) / 2);
    }
  });

  it("amount > 1 wird auf 1 geclampt", () => {
    const out = morphValues(A, B, 5);
    for (let i = 0; i < MACRO_VALUES_LENGTH; i++) expect(out[i]).toBeCloseTo(B[i]);
  });

  it("amount < 0 wird auf 0 geclampt", () => {
    const out = morphValues(A, B, -2);
    for (let i = 0; i < MACRO_VALUES_LENGTH; i++) expect(out[i]).toBeCloseTo(A[i]);
  });

  it("amount NaN → 0 (= pure A)", () => {
    const out = morphValues(A, B, NaN);
    for (let i = 0; i < MACRO_VALUES_LENGTH; i++) expect(out[i]).toBeCloseTo(A[i]);
  });

  it("unterschiedliche Längen werden gepaddet (kürzere = 0)", () => {
    const short = [1.0, 1.0];
    const out = morphValues(short, A, 0); // amount=0 → short padded mit 0
    expect(out[0]).toBeCloseTo(1.0);
    expect(out[1]).toBeCloseTo(1.0);
    for (let i = 2; i < MACRO_VALUES_LENGTH; i++) expect(out[i]).toBe(0);
  });

  it("ergebnis ist immer 0..1 geclampt", () => {
    // Selbst wenn A/B vorher illegal — normalizeMacroValues clampt schon
    const bad = [-1, 2, NaN, Infinity, 0.5, 0, 1, -0];
    const out = morphValues(bad, bad, 0.5);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Store: addSnapshot ──────────────────────────────────────────────────────
describe("store addSnapshot", () => {
  it("legt Snapshot mit normalisierten Values + ID an", () => {
    const id = addSnapshot("Clean", [0.1, 0.2, 0.3]);
    const s = getMacroSnapshotState();
    expect(s.snapshots).toHaveLength(1);
    expect(s.snapshots[0].id).toBe(id);
    expect(s.snapshots[0].name).toBe("Clean");
    expect(s.snapshots[0].values.length).toBe(MACRO_VALUES_LENGTH);
    expect(s.snapshots[0].values[0]).toBeCloseTo(0.1);
    expect(s.snapshots[0].values[3]).toBe(0); // padded
  });

  it("fallback-name bei leerem Input → 'Snapshot N'", () => {
    addSnapshot("", [0, 0, 0, 0, 0, 0, 0, 0]);
    addSnapshot("   ", [0, 0, 0, 0, 0, 0, 0, 0]);
    const s = getMacroSnapshotState();
    expect(s.snapshots[0].name).toBe("Snapshot 1");
    expect(s.snapshots[1].name).toBe("Snapshot 2");
  });

  it("persistiert über localStorage", () => {
    const id = addSnapshot("Wet", [1, 1, 1, 1, 1, 1, 1, 1]);
    const raw = (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage.getItem(
      "ss-macro-snapshots:v1",
    );
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.snapshots.length).toBe(1);
    expect(parsed.snapshots[0].id).toBe(id);
  });
});

// ─── Store: updateSnapshot ───────────────────────────────────────────────────
describe("store updateSnapshot", () => {
  it("ändert Name/Color/Values partiell", () => {
    const id = addSnapshot("Foo", [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    updateSnapshot(id, { name: "Bar", color: "#abcdef" });
    const s = getMacroSnapshotState().snapshots[0];
    expect(s.name).toBe("Bar");
    expect(s.color).toBe("#abcdef");
    expect(s.values[0]).toBeCloseTo(0.5); // values bleiben
  });

  it("leeren Namen ignoriert (kein Datenverlust)", () => {
    const id = addSnapshot("Keep", [0, 0, 0, 0, 0, 0, 0, 0]);
    updateSnapshot(id, { name: "  " });
    expect(getMacroSnapshotState().snapshots[0].name).toBe("Keep");
  });

  it("no-op bei unbekannter ID", () => {
    addSnapshot("X", [0, 0, 0, 0, 0, 0, 0, 0]);
    updateSnapshot("does-not-exist", { name: "Foo" });
    expect(getMacroSnapshotState().snapshots[0].name).toBe("X");
  });
});

// ─── Store: removeSnapshot ───────────────────────────────────────────────────
describe("store removeSnapshot", () => {
  it("entfernt Snapshot + cleared morphA/morphB falls referenziert", () => {
    const idA = addSnapshot("A", [0, 0, 0, 0, 0, 0, 0, 0]);
    const idB = addSnapshot("B", [1, 1, 1, 1, 1, 1, 1, 1]);
    setMorphA(idA);
    setMorphB(idB);
    setMorphAmount(0.5);

    removeSnapshot(idA);
    const s = getMacroSnapshotState();
    expect(s.snapshots).toHaveLength(1);
    expect(s.snapshots[0].id).toBe(idB);
    expect(s.morphA).toBeNull(); // cleared!
    expect(s.morphB).toBe(idB);  // unverändert
  });

  it("entfernt nur betroffenen Slot wenn beide referenziert", () => {
    const idA = addSnapshot("A", [0, 0, 0, 0, 0, 0, 0, 0]);
    setMorphA(idA);
    setMorphB(idA);
    removeSnapshot(idA);
    const s = getMacroSnapshotState();
    expect(s.morphA).toBeNull();
    expect(s.morphB).toBeNull();
  });

  it("no-op bei unbekannter ID", () => {
    addSnapshot("X", [0, 0, 0, 0, 0, 0, 0, 0]);
    removeSnapshot("ghost");
    expect(getMacroSnapshotState().snapshots).toHaveLength(1);
  });
});

// ─── Store: Morph-Slots ──────────────────────────────────────────────────────
describe("store morph slots", () => {
  it("setMorphA + setMorphB akzeptiert valide IDs, ghost = no-op", () => {
    const idA = addSnapshot("A", [0, 0, 0, 0, 0, 0, 0, 0]);
    setMorphA(idA);
    setMorphA("ghost-id");
    expect(getMacroSnapshotState().morphA).toBe(idA);
    setMorphA(null);
    expect(getMacroSnapshotState().morphA).toBeNull();
  });

  it("setMorphAmount clamp 0..1", () => {
    setMorphAmount(0.5);
    expect(getMacroSnapshotState().morphAmount).toBeCloseTo(0.5);
    setMorphAmount(2);
    expect(getMacroSnapshotState().morphAmount).toBe(1);
    setMorphAmount(-1);
    expect(getMacroSnapshotState().morphAmount).toBe(0);
    setMorphAmount(NaN);
    expect(getMacroSnapshotState().morphAmount).toBe(0);
  });
});

// ─── Store: getCurrentMorphedValues ──────────────────────────────────────────
describe("store getCurrentMorphedValues", () => {
  it("A=B identisch → identische Werte (kein NaN)", () => {
    const id = addSnapshot("Same", [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    setMorphA(id);
    setMorphB(id);
    setMorphAmount(0.5);
    const out = getCurrentMorphedValues();
    expect(out).not.toBeNull();
    expect(out![0]).toBeCloseTo(0.1);
    expect(out![7]).toBeCloseTo(0.8);
  });

  it("keine A oder B → null (Fallback: current macros bleiben)", () => {
    expect(getCurrentMorphedValues()).toBeNull();

    const idA = addSnapshot("A", [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    setMorphA(idA);
    // nur A, kein B → liefert A
    const out = getCurrentMorphedValues();
    expect(out).not.toBeNull();
    expect(out![0]).toBeCloseTo(0.5);
  });

  it("nur B gesetzt → liefert B", () => {
    const idB = addSnapshot("B", [1, 1, 1, 1, 1, 1, 1, 1]);
    setMorphB(idB);
    const out = getCurrentMorphedValues();
    expect(out![0]).toBeCloseTo(1);
  });

  it("beide gesetzt + amount=0.5 → midpoint", () => {
    const idA = addSnapshot("A", [0, 0, 0, 0, 0, 0, 0, 0]);
    const idB = addSnapshot("B", [1, 1, 1, 1, 1, 1, 1, 1]);
    setMorphA(idA);
    setMorphB(idB);
    setMorphAmount(0.5);
    const out = getCurrentMorphedValues();
    expect(out![0]).toBeCloseTo(0.5);
    expect(out![7]).toBeCloseTo(0.5);
  });
});

// ─── Store: recallSnapshot ───────────────────────────────────────────────────
describe("store recallSnapshot", () => {
  it("setzt A=B=id, amount=0 → output = snapshot.values", () => {
    const id = addSnapshot("Recall", [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const ok = recallSnapshot(id);
    expect(ok).toBe(true);
    const s = getMacroSnapshotState();
    expect(s.morphA).toBe(id);
    expect(s.morphB).toBe(id);
    expect(s.morphAmount).toBe(0);
    const out = getCurrentMorphedValues();
    expect(out![0]).toBeCloseTo(0.1);
    expect(out![7]).toBeCloseTo(0.8);
  });

  it("ghost-ID → false + no state change", () => {
    addSnapshot("X", [0, 0, 0, 0, 0, 0, 0, 0]);
    const ok = recallSnapshot("ghost");
    expect(ok).toBe(false);
    expect(getMacroSnapshotState().morphA).toBeNull();
  });
});

// ─── Persistence Roundtrip ──────────────────────────────────────────────────
describe("persistence", () => {
  it("garbage-localStorage → defaults", () => {
    (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage.setItem(
      "ss-macro-snapshots:v1",
      "{not json",
    );
    __resetMacroSnapshotStoreForTests();
    // Erzeuge State neu (reset cleared aber)
    const s = getMacroSnapshotState();
    expect(s.snapshots).toEqual([]);
    expect(s.morphA).toBeNull();
    expect(s.morphB).toBeNull();
    expect(s.morphAmount).toBe(0);
  });
});
