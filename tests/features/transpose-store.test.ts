/**
 * tests/features/transpose-store.test.ts (TASK-CVG-TRANSPOSE-STORE / v2.64)
 *
 * Unit-Tests für useTransposeStore (Modul-Singleton).
 * Stubt localStorage und nutzt __resetForTests für deterministischen Zustand.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (vor Store-Import!) ───────────────────────────────────

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
  getSemitones,
  setSemitones,
  incSemitones,
  resetTranspose,
  __resetForTests,
} from "@/store/useTransposeStore";

const STORAGE_KEY = "ss-global-transpose";

describe("useTransposeStore – Basic Setter/Getter", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("getSemitones startet bei 0", () => {
    expect(getSemitones()).toBe(0);
  });

  it("setSemitones(5) → getSemitones liefert 5", () => {
    setSemitones(5);
    expect(getSemitones()).toBe(5);
  });

  it("setSemitones(-7) → -7", () => {
    setSemitones(-7);
    expect(getSemitones()).toBe(-7);
  });
});

describe("useTransposeStore – Clamping via clampSemitones", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("setSemitones(50) wird auf +24 gecampt", () => {
    setSemitones(50);
    expect(getSemitones()).toBe(24);
  });

  it("setSemitones(-100) wird auf -24 gecampt", () => {
    setSemitones(-100);
    expect(getSemitones()).toBe(-24);
  });

  it("setSemitones(3.7) wird auf 4 gerundet", () => {
    setSemitones(3.7);
    expect(getSemitones()).toBe(4);
  });

  it("setSemitones(NaN) bleibt bei aktuellem Wert (clampSemitones → 0)", () => {
    setSemitones(NaN);
    expect(getSemitones()).toBe(0);
  });
});

describe("useTransposeStore – incSemitones", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("incSemitones(+3) von 0 → 3", () => {
    incSemitones(3);
    expect(getSemitones()).toBe(3);
  });

  it("incSemitones(-2) von 5 → 3", () => {
    setSemitones(5);
    incSemitones(-2);
    expect(getSemitones()).toBe(3);
  });

  it("incSemitones kumuliert: 1+1+1 = 3", () => {
    incSemitones(1);
    incSemitones(1);
    incSemitones(1);
    expect(getSemitones()).toBe(3);
  });

  it("incSemitones clampt: 24 + 5 → 24 (kein Overflow)", () => {
    setSemitones(24);
    incSemitones(5);
    expect(getSemitones()).toBe(24);
  });
});

describe("useTransposeStore – resetTranspose", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("setzt auf 0 zurück", () => {
    setSemitones(10);
    resetTranspose();
    expect(getSemitones()).toBe(0);
  });

  it("auch nach extremen Werten", () => {
    setSemitones(-24);
    resetTranspose();
    expect(getSemitones()).toBe(0);
  });
});

describe("useTransposeStore – Persistenz", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("setSemitones schreibt in localStorage", () => {
    setSemitones(7);
    expect(localStorageMock.getItem(STORAGE_KEY)).toBe("7");
  });

  it("setSemitones(0) → wird trotzdem persistiert (aber initial = 0 → idempotent)", () => {
    setSemitones(5);
    setSemitones(0);
    expect(localStorageMock.getItem(STORAGE_KEY)).toBe("0");
  });

  it("Setzen auf gleichen Wert: kein extra Notify (NO-Op-Check via storage)", () => {
    setSemitones(3);
    localStorageMock.clear(); // Storage leeren
    setSemitones(3); // gleicher Wert → kein write
    expect(localStorageMock.getItem(STORAGE_KEY)).toBeNull();
  });

  it("__resetForTests löscht den localStorage-Eintrag", () => {
    setSemitones(7);
    __resetForTests();
    expect(localStorageMock.getItem(STORAGE_KEY)).toBeNull();
  });
});
