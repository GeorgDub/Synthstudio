/**
 * tests/features/note-repeat-store.test.ts (TASK-CVG-NR-STORE / v2.65)
 *
 * Unit-Tests für useNoteRepeatStore. enabled + rate mit
 * localStorage-Persistenz + ValidRate-Guard.
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
  isNoteRepeatEnabled,
  getNoteRepeatRate,
  setNoteRepeatEnabled,
  toggleNoteRepeat,
  setNoteRepeatRate,
  resetNoteRepeat,
  __resetForTests,
} from "@/store/useNoteRepeatStore";
import type { NoteRepeatRate } from "@/utils/noteRepeat";

const STORAGE_KEY_ENABLED = "ss-note-repeat-enabled";
const STORAGE_KEY_RATE = "ss-note-repeat-rate";

describe("useNoteRepeatStore – Default + Getter", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("startet mit enabled=false", () => {
    expect(isNoteRepeatEnabled()).toBe(false);
  });

  it("Default rate ist '1/16'", () => {
    expect(getNoteRepeatRate()).toBe("1/16");
  });
});

describe("useNoteRepeatStore – setNoteRepeatEnabled + toggle", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("setNoteRepeatEnabled(true) → isEnabled=true", () => {
    setNoteRepeatEnabled(true);
    expect(isNoteRepeatEnabled()).toBe(true);
  });

  it("setNoteRepeatEnabled idempotent (gleicher Wert → kein extra write)", () => {
    setNoteRepeatEnabled(true);
    localStorageMock.clear();
    setNoteRepeatEnabled(true); // sollte nicht schreiben
    expect(localStorageMock.getItem(STORAGE_KEY_ENABLED)).toBeNull();
  });

  it("toggleNoteRepeat flippt", () => {
    expect(isNoteRepeatEnabled()).toBe(false);
    toggleNoteRepeat();
    expect(isNoteRepeatEnabled()).toBe(true);
    toggleNoteRepeat();
    expect(isNoteRepeatEnabled()).toBe(false);
  });
});

describe("useNoteRepeatStore – setNoteRepeatRate Valid-Guard", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("wechselt auf gültige Rate '1/8'", () => {
    setNoteRepeatRate("1/8");
    expect(getNoteRepeatRate()).toBe("1/8");
  });

  it("wechselt auf Triplet '1/8T'", () => {
    setNoteRepeatRate("1/8T");
    expect(getNoteRepeatRate()).toBe("1/8T");
  });

  it("Invalid rate wird IGNORIERT, alte Rate bleibt", () => {
    setNoteRepeatRate("1/4");
    setNoteRepeatRate("nonsense" as NoteRepeatRate);
    expect(getNoteRepeatRate()).toBe("1/4");
  });

  it("Identity check: gleicher Rate-Wert → kein extra write", () => {
    setNoteRepeatRate("1/8");
    localStorageMock.clear();
    setNoteRepeatRate("1/8");
    expect(localStorageMock.getItem(STORAGE_KEY_RATE)).toBeNull();
  });
});

describe("useNoteRepeatStore – resetNoteRepeat (BUG-013)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("setzt enabled=false + rate=DEFAULT", () => {
    setNoteRepeatEnabled(true);
    setNoteRepeatRate("1/4T");
    resetNoteRepeat();
    expect(isNoteRepeatEnabled()).toBe(false);
    expect(getNoteRepeatRate()).toBe("1/16");
  });

  it("löscht beide localStorage-Einträge", () => {
    setNoteRepeatEnabled(true);
    setNoteRepeatRate("1/8");
    resetNoteRepeat();
    expect(localStorageMock.getItem(STORAGE_KEY_ENABLED)).toBeNull();
    expect(localStorageMock.getItem(STORAGE_KEY_RATE)).toBeNull();
  });
});

describe("useNoteRepeatStore – localStorage-Persistenz", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("setNoteRepeatEnabled(true) schreibt '1'", () => {
    setNoteRepeatEnabled(true);
    expect(localStorageMock.getItem(STORAGE_KEY_ENABLED)).toBe("1");
  });

  it("setNoteRepeatEnabled(false) schreibt '0'", () => {
    setNoteRepeatEnabled(true);
    setNoteRepeatEnabled(false);
    expect(localStorageMock.getItem(STORAGE_KEY_ENABLED)).toBe("0");
  });

  it("setNoteRepeatRate persistiert den Rate-String", () => {
    setNoteRepeatRate("1/32T");
    expect(localStorageMock.getItem(STORAGE_KEY_RATE)).toBe("1/32T");
  });
});

describe("useNoteRepeatStore – __resetForTests Alias", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("verhält sich identisch zu resetNoteRepeat", () => {
    setNoteRepeatEnabled(true);
    setNoteRepeatRate("1/4");
    __resetForTests();
    expect(isNoteRepeatEnabled()).toBe(false);
    expect(getNoteRepeatRate()).toBe("1/16");
  });
});
