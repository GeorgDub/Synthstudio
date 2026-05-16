/**
 * tests/features/pattern-variations-store.test.ts (TASK-CVG-VARS-STORE / v2.65)
 *
 * Unit-Tests für usePatternVariationsStore (A/B/C/D Variation-Slots).
 */
import { describe, it, expect, beforeEach } from "vitest";

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
  createVariationSet,
  updateVariationSlot,
  setActiveVariation,
  removeVariationSet,
  getVariationSet,
} from "@/store/usePatternVariationsStore";

const STORAGE_KEY = "ss-pattern-variations:v1";

function getAllSets() {
  // Lese direkt aus localStorage zur Cross-Verifikation
  const raw = localStorageMock.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function clearAllSets() {
  // Cleanup: gehe alle bekannten Sets durch und remove
  for (const s of getAllSets()) {
    removeVariationSet(s.basePatternId);
  }
  localStorageMock.clear();
}

describe("usePatternVariationsStore – createVariationSet", () => {
  beforeEach(clearAllSets);

  it("erzeugt Set mit basePattern + active=A + Slot A gefüllt", () => {
    const set = createVariationSet("pat-1", "My Set", "var-A");
    expect(set.basePatternId).toBe("pat-1");
    expect(set.name).toBe("My Set");
    expect(set.activeSlot).toBe("A");
    expect(set.slots).toEqual({ A: "var-A", B: null, C: null, D: null });
  });

  it("Zwei verschiedene baseIds → zwei Sets nebeneinander", () => {
    createVariationSet("pat-1", "Set 1", "A1");
    createVariationSet("pat-2", "Set 2", "A2");
    expect(getVariationSet("pat-1")).toBeDefined();
    expect(getVariationSet("pat-2")).toBeDefined();
  });
});

describe("usePatternVariationsStore – updateVariationSlot", () => {
  beforeEach(clearAllSets);

  it("Slot B mit Pattern füllen", () => {
    createVariationSet("base", "Set", "A");
    updateVariationSlot("base", "B", "B1");
    expect(getVariationSet("base")!.slots.B).toBe("B1");
  });

  it("Slot C mit null leeren", () => {
    createVariationSet("base", "Set", "A");
    updateVariationSlot("base", "C", "C1");
    updateVariationSlot("base", "C", null);
    expect(getVariationSet("base")!.slots.C).toBeNull();
  });

  it("Update auf unbekannter baseId → no-op (kein neues Set erzeugen)", () => {
    updateVariationSlot("unknown", "B", "x");
    expect(getVariationSet("unknown")).toBeUndefined();
  });

  it("Update touched nur das matching Set (andere bleiben)", () => {
    createVariationSet("p1", "S1", "A1");
    createVariationSet("p2", "S2", "A2");
    updateVariationSlot("p1", "B", "B1");
    expect(getVariationSet("p1")!.slots.B).toBe("B1");
    expect(getVariationSet("p2")!.slots.B).toBeNull();
  });
});

describe("usePatternVariationsStore – setActiveVariation", () => {
  beforeEach(clearAllSets);

  it("wechselt activeSlot von A nach C", () => {
    createVariationSet("base", "Set", "A");
    setActiveVariation("base", "C");
    expect(getVariationSet("base")!.activeSlot).toBe("C");
  });

  it("setActive auf unbekannter baseId → no-op", () => {
    setActiveVariation("unknown", "B");
    expect(getVariationSet("unknown")).toBeUndefined();
  });
});

describe("usePatternVariationsStore – removeVariationSet", () => {
  beforeEach(clearAllSets);

  it("entfernt das Set komplett", () => {
    createVariationSet("base", "Set", "A");
    removeVariationSet("base");
    expect(getVariationSet("base")).toBeUndefined();
  });

  it("remove auf unbekannter baseId → no-op", () => {
    createVariationSet("base", "Set", "A");
    removeVariationSet("nope");
    expect(getVariationSet("base")).toBeDefined();
  });
});

describe("usePatternVariationsStore – localStorage-Persistenz", () => {
  beforeEach(clearAllSets);

  it("create persistiert", () => {
    createVariationSet("base", "Set", "A");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
  });

  it("update persistiert", () => {
    createVariationSet("base", "Set", "A");
    updateVariationSlot("base", "B", "B1");
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed[0].slots.B).toBe("B1");
  });

  it("remove persistiert (Set ist weg)", () => {
    createVariationSet("base", "Set", "A");
    removeVariationSet("base");
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed).toEqual([]);
  });
});

describe("usePatternVariationsStore – Full-Slot-Cycle", () => {
  beforeEach(clearAllSets);

  it("A → B → C → D vollständig durchlaufen", () => {
    createVariationSet("base", "Set", "patA");
    updateVariationSlot("base", "B", "patB");
    updateVariationSlot("base", "C", "patC");
    updateVariationSlot("base", "D", "patD");
    const slots = getVariationSet("base")!.slots;
    expect(slots.A).toBe("patA");
    expect(slots.B).toBe("patB");
    expect(slots.C).toBe("patC");
    expect(slots.D).toBe("patD");
  });
});
