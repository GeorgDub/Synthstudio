/**
 * tests/features/pad-bank-persistence.test.ts (TASK-CVG-PADBANK / v2.80)
 *
 * Unit-Coverage für padBankPersistence (v2.80 Pad-Bank Persistenz-Helpers).
 * Pure-Module — kein React, kein DOM (außer localStorage-Mock).
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (vor Modul-Import) ────────────────────────────────────

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
  PAD_BANK_STORAGE_KEY,
  defaultPadBankSlots,
  isValidPadBankSlot,
  loadPadBankSlots,
  savePadBankSlots,
  __resetPadBankForTests,
  type PadBankSlot,
} from "@/utils/padBankPersistence";

beforeEach(() => {
  localStorageMock.clear();
  __resetPadBankForTests();
});

// ─── Default-Slots ───────────────────────────────────────────────────────────

describe("padBankPersistence – defaultPadBankSlots", () => {
  it("liefert 16 Perf-Pad-Slots", () => {
    const slots = defaultPadBankSlots();
    expect(slots).toHaveLength(16);
    for (const s of slots) {
      expect(s.kind).toBe("perf-pad");
    }
  });

  it("Param-Werte sind '0' bis '15'", () => {
    const slots = defaultPadBankSlots();
    expect(slots.map((s) => s.param)).toEqual(
      Array.from({ length: 16 }, (_, i) => String(i)),
    );
  });
});

// ─── isValidPadBankSlot Type-Guard ───────────────────────────────────────────

describe("padBankPersistence – isValidPadBankSlot", () => {
  it("true für alle 4 valide kinds", () => {
    expect(isValidPadBankSlot({ kind: "perf-pad", param: "0" })).toBe(true);
    expect(isValidPadBankSlot({ kind: "macro", param: "3" })).toBe(true);
    expect(isValidPadBankSlot({ kind: "script", param: "scr-1" })).toBe(true);
    expect(isValidPadBankSlot({ kind: "action", param: "playStop" })).toBe(true);
  });

  it("false für unbekannten kind", () => {
    expect(isValidPadBankSlot({ kind: "unknown", param: "0" })).toBe(false);
    expect(isValidPadBankSlot({ kind: "", param: "0" })).toBe(false);
  });

  it("false für non-string param", () => {
    expect(isValidPadBankSlot({ kind: "perf-pad", param: 0 })).toBe(false);
    expect(isValidPadBankSlot({ kind: "perf-pad", param: null })).toBe(false);
  });

  it("false für missing kind oder param", () => {
    expect(isValidPadBankSlot({ kind: "perf-pad" })).toBe(false);
    expect(isValidPadBankSlot({ param: "0" })).toBe(false);
    expect(isValidPadBankSlot({})).toBe(false);
  });

  it("false für non-object (null/undefined/string/array)", () => {
    expect(isValidPadBankSlot(null)).toBe(false);
    expect(isValidPadBankSlot(undefined)).toBe(false);
    expect(isValidPadBankSlot("string")).toBe(false);
    expect(isValidPadBankSlot([])).toBe(false);
  });
});

// ─── loadPadBankSlots ────────────────────────────────────────────────────────

describe("padBankPersistence – loadPadBankSlots", () => {
  it("Leeres localStorage → defaultPadBankSlots (16 Perf-Pads)", () => {
    const slots = loadPadBankSlots();
    expect(slots).toEqual(defaultPadBankSlots());
  });

  it("Invalid JSON → defaultPadBankSlots", () => {
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, "not-json{");
    expect(loadPadBankSlots()).toEqual(defaultPadBankSlots());
  });

  it("Non-Array Value → defaultPadBankSlots", () => {
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, '"a string"');
    expect(loadPadBankSlots()).toEqual(defaultPadBankSlots());
  });

  it("Object statt Array → defaultPadBankSlots", () => {
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, JSON.stringify({ kind: "perf-pad", param: "0" }));
    expect(loadPadBankSlots()).toEqual(defaultPadBankSlots());
  });

  it("Valides Array mit gemischten Kinds wird unverändert übernommen", () => {
    const stored: PadBankSlot[] = [
      { kind: "perf-pad", param: "0" },
      { kind: "macro", param: "3" },
      { kind: "script", param: "scr-xyz" },
      { kind: "action", param: "tapTempo" },
    ];
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, JSON.stringify(stored));
    expect(loadPadBankSlots()).toEqual(stored);
  });

  it("Invalide Items im Array werden gefiltert, valide bleiben", () => {
    const stored = [
      { kind: "perf-pad", param: "0" },           // valid
      { kind: "unknown", param: "x" },             // invalid kind
      { kind: "macro", param: 5 },                  // non-string param
      null,                                          // not an object
      { kind: "script", param: "scr-1" },          // valid
    ];
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, JSON.stringify(stored));
    const result = loadPadBankSlots();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "perf-pad", param: "0" });
    expect(result[1]).toEqual({ kind: "script", param: "scr-1" });
  });

  it("Leeres Array nach Filterung bleibt leer (User-Reset → 0 slots ist valider Zustand)", () => {
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, JSON.stringify([]));
    expect(loadPadBankSlots()).toEqual([]);
  });
});

// ─── savePadBankSlots ────────────────────────────────────────────────────────

describe("padBankPersistence – savePadBankSlots", () => {
  it("Schreibt JSON-Array nach localStorage", () => {
    const slots: PadBankSlot[] = [
      { kind: "macro", param: "0" },
      { kind: "action", param: "playStop" },
    ];
    savePadBankSlots(slots);
    const raw = localStorageMock.getItem(PAD_BANK_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(slots);
  });

  it("Leeres Array wird ebenfalls persistiert (User hat alle Slots gelöscht)", () => {
    savePadBankSlots([]);
    const raw = localStorageMock.getItem(PAD_BANK_STORAGE_KEY);
    expect(raw).toBe("[]");
  });

  it("Späterer Save überschreibt früheren", () => {
    savePadBankSlots([{ kind: "perf-pad", param: "0" }]);
    savePadBankSlots([{ kind: "macro", param: "3" }]);
    const parsed = JSON.parse(localStorageMock.getItem(PAD_BANK_STORAGE_KEY)!);
    expect(parsed).toEqual([{ kind: "macro", param: "3" }]);
  });
});

// ─── Round-Trip ──────────────────────────────────────────────────────────────

describe("padBankPersistence – Round-Trip save → load", () => {
  it("Beliebige valide Slots-Liste überlebt save→load identisch", () => {
    const original: PadBankSlot[] = [
      { kind: "perf-pad", param: "0" },
      { kind: "perf-pad", param: "5" },
      { kind: "macro", param: "0" },
      { kind: "macro", param: "7" },
      { kind: "script", param: "scr-beat-1" },
      { kind: "script", param: "scr-fill-2" },
      { kind: "action", param: "tapTempo" },
      { kind: "action", param: "patternRandomize" },
    ];
    savePadBankSlots(original);
    expect(loadPadBankSlots()).toEqual(original);
  });

  it("Round-Trip mit DefaultSlots ist identitätsgleich", () => {
    const original = defaultPadBankSlots();
    savePadBankSlots(original);
    expect(loadPadBankSlots()).toEqual(original);
  });
});

// ─── __resetPadBankForTests ──────────────────────────────────────────────────

describe("padBankPersistence – __resetPadBankForTests", () => {
  it("Entfernt den localStorage-Eintrag → load liefert wieder Defaults", () => {
    savePadBankSlots([{ kind: "macro", param: "0" }]);
    expect(loadPadBankSlots()).toEqual([{ kind: "macro", param: "0" }]);
    __resetPadBankForTests();
    expect(loadPadBankSlots()).toEqual(defaultPadBankSlots());
  });
});
