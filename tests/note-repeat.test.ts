/**
 * tests/note-repeat.test.ts
 *
 * Unit-Tests für Note-Repeat: Util + Store.
 * Hook-Tests (useNoteRepeat) befinden sich in note-repeat-hook.test.ts,
 * da sie React + fake timers brauchen.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string): string | null => store[key] ?? null,
    setItem:    (key: string, value: string): void => { store[key] = value; },
    removeItem: (key: string): void => { delete store[key]; },
    clear:      (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();

Object.defineProperty(globalThis, "localStorage", {
  value:        localStorageMock,
  writable:     true,
  configurable: true,
});

import {
  NOTE_REPEAT_RATES,
  rateToIntervalMs,
  safeIntervalMs,
  getRateDef,
  MIN_INTERVAL_MS,
} from "../client/src/utils/noteRepeat";

import {
  isNoteRepeatEnabled,
  getNoteRepeatRate,
  setNoteRepeatEnabled,
  toggleNoteRepeat,
  setNoteRepeatRate,
  __resetForTests,
} from "../client/src/store/useNoteRepeatStore";

// ─── Util-Tests ───────────────────────────────────────────────────────────────

describe("Note-Repeat Util: NOTE_REPEAT_RATES", () => {
  it("definiert genau 8 Rates", () => {
    expect(NOTE_REPEAT_RATES).toHaveLength(8);
  });

  it("alle Raten haben eindeutige IDs", () => {
    const ids = new Set(NOTE_REPEAT_RATES.map((r) => r.rate));
    expect(ids.size).toBe(NOTE_REPEAT_RATES.length);
  });

  it("alle Raten haben positive beats-Werte", () => {
    for (const r of NOTE_REPEAT_RATES) {
      expect(r.beats).toBeGreaterThan(0);
    }
  });
});

describe("getRateDef", () => {
  it("liefert die Definition für eine bekannte Rate", () => {
    expect(getRateDef("1/16").label).toBe("1/16");
    expect(getRateDef("1/8T").label).toBe("1/8T");
  });

  it("wirft bei unbekannter Rate", () => {
    expect(() => getRateDef("1/9999" as never)).toThrow();
  });
});

describe("rateToIntervalMs", () => {
  it("liefert 500ms für 1/8 bei 120 BPM", () => {
    // 1/8 = 0.5 Beats, 120 BPM → 500ms / Beat → 250ms / 1/8
    expect(rateToIntervalMs("1/8", 120)).toBe(250);
  });

  it("liefert 125ms für 1/16 bei 120 BPM", () => {
    expect(rateToIntervalMs("1/16", 120)).toBe(125);
  });

  it("liefert 500ms für 1/4 bei 120 BPM", () => {
    expect(rateToIntervalMs("1/4", 120)).toBe(500);
  });

  it("skaliert linear mit BPM", () => {
    const at120 = rateToIntervalMs("1/16", 120);
    const at60  = rateToIntervalMs("1/16", 60);
    expect(at60).toBeCloseTo(at120 * 2, 5);
  });

  it("Triplets liefern 2/3 des Standard-Intervalls", () => {
    const std   = rateToIntervalMs("1/8", 120);
    const trip  = rateToIntervalMs("1/8T", 120);
    expect(trip).toBeCloseTo(std * (2 / 3), 5);
  });

  it("wirft bei BPM ≤ 0", () => {
    expect(() => rateToIntervalMs("1/16", 0)).toThrow();
    expect(() => rateToIntervalMs("1/16", -1)).toThrow();
  });
});

describe("safeIntervalMs", () => {
  it("liefert mindestens MIN_INTERVAL_MS", () => {
    // Extreme: 1/32T bei 600 BPM → < 10ms
    expect(safeIntervalMs("1/32T", 600)).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  it("liefert das berechnete Intervall wenn ≥ MIN_INTERVAL_MS", () => {
    expect(safeIntervalMs("1/16", 120)).toBe(125);
  });
});

// ─── Store-Tests ──────────────────────────────────────────────────────────────

describe("useNoteRepeatStore – Logik-Funktionen", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("Defaults: enabled=false, rate='1/16'", () => {
    expect(isNoteRepeatEnabled()).toBe(false);
    expect(getNoteRepeatRate()).toBe("1/16");
  });

  it("setNoteRepeatEnabled aktualisiert den Wert", () => {
    setNoteRepeatEnabled(true);
    expect(isNoteRepeatEnabled()).toBe(true);
    setNoteRepeatEnabled(false);
    expect(isNoteRepeatEnabled()).toBe(false);
  });

  it("toggleNoteRepeat schaltet um", () => {
    toggleNoteRepeat();
    expect(isNoteRepeatEnabled()).toBe(true);
    toggleNoteRepeat();
    expect(isNoteRepeatEnabled()).toBe(false);
  });

  it("setNoteRepeatRate akzeptiert nur valide Rates", () => {
    setNoteRepeatRate("1/8T");
    expect(getNoteRepeatRate()).toBe("1/8T");

    // Invalide Rate wird ignoriert
    setNoteRepeatRate("foo" as never);
    expect(getNoteRepeatRate()).toBe("1/8T");
  });

  it("persistiert enabled in localStorage", () => {
    setNoteRepeatEnabled(true);
    expect(localStorageMock.getItem("ss-note-repeat-enabled")).toBe("1");
    setNoteRepeatEnabled(false);
    expect(localStorageMock.getItem("ss-note-repeat-enabled")).toBe("0");
  });

  it("persistiert rate in localStorage", () => {
    setNoteRepeatRate("1/32");
    expect(localStorageMock.getItem("ss-note-repeat-rate")).toBe("1/32");
  });

  it("doppelte setNoteRepeatRate für gleichen Wert ist No-Op (kein Crash)", () => {
    setNoteRepeatRate("1/8");
    setNoteRepeatRate("1/8");
    expect(getNoteRepeatRate()).toBe("1/8");
  });
});
