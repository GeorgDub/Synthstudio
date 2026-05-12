/**
 * tests/features/chord-memory.test.ts
 *
 * Unit-Tests fuer useChordMemoryStore und die pure Funktion buildChordNotes.
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
  buildChordNotes,
  setChordMemoryEnabled,
  setChordType,
  setChordVoicing,
  setChordSpread,
  getChordMemoryState,
  CHORD_INTERVALS,
  CHORD_LABELS,
  type ChordMemoryState,
} from "../../client/src/store/useChordMemoryStore";

const STORAGE_KEY = "ss-chord-memory:v1";

describe("buildChordNotes (pure)", () => {
  const baseState: ChordMemoryState = {
    enabled: true,
    chordType: "major",
    voicing: 0,
    spread: 0,
  };

  it("baut Dur-Akkord (C4 = 60) korrekt: [60, 64, 67]", () => {
    const notes = buildChordNotes(60, baseState);
    expect(notes).toEqual([60, 64, 67]);
  });

  it("baut Moll-Akkord (C4): [60, 63, 67]", () => {
    const notes = buildChordNotes(60, { ...baseState, chordType: "minor" });
    expect(notes).toEqual([60, 63, 67]);
  });

  it("baut Dom7 (C4): [60, 64, 67, 70]", () => {
    const notes = buildChordNotes(60, { ...baseState, chordType: "dom7" });
    expect(notes).toEqual([60, 64, 67, 70]);
  });

  it("power-chord hat nur 2 Noten: [60, 67]", () => {
    const notes = buildChordNotes(60, { ...baseState, chordType: "power" });
    expect(notes).toEqual([60, 67]);
  });

  it("Voicing 1 (1. Umkehrung) verschiebt Grundton um Oktave nach oben", () => {
    const notes = buildChordNotes(60, { ...baseState, voicing: 1 });
    // Dur [60,64,67] → 1. Umkehrung: [64, 67, 72]
    expect(notes).toEqual([64, 67, 72]);
  });

  it("Voicing 2 verschiebt zwei Grundtoene um Oktave nach oben", () => {
    const notes = buildChordNotes(60, { ...baseState, voicing: 2 });
    // [60,64,67] → 2× rotiert: [67, 72, 76]
    expect(notes).toEqual([67, 72, 76]);
  });

  it("Spread 1 transponiert alle Noten um eine Oktave nach oben", () => {
    const notes = buildChordNotes(60, { ...baseState, spread: 1 });
    expect(notes).toEqual([72, 76, 79]);
  });

  it("filtert Noten ausserhalb 0–127", () => {
    // Oktav-Akkord auf MIDI 120 → 132 wuerde abgefiltert
    const notes = buildChordNotes(120, { ...baseState, chordType: "octave" });
    expect(notes).toEqual([120]);
  });
});

describe("CHORD_INTERVALS / CHORD_LABELS", () => {
  it("CHORD_INTERVALS enthaelt alle 13 Akkord-Typen", () => {
    expect(Object.keys(CHORD_INTERVALS)).toHaveLength(13);
  });

  it("Major-Intervalle sind [0, 4, 7]", () => {
    expect(CHORD_INTERVALS.major).toEqual([0, 4, 7]);
  });

  it("CHORD_LABELS hat ein Label fuer jeden Typ", () => {
    for (const key of Object.keys(CHORD_INTERVALS)) {
      expect(CHORD_LABELS).toHaveProperty(key);
      expect(typeof (CHORD_LABELS as Record<string, string>)[key]).toBe("string");
    }
  });
});

describe("useChordMemoryStore – imperative Setter", () => {
  beforeEach(() => {
    localStorageMock.clear();
    // Reset zu Defaults
    setChordMemoryEnabled(false);
    setChordType("major");
    setChordVoicing(0);
    setChordSpread(0);
  });

  it("setChordMemoryEnabled toggelt enabled-Flag", () => {
    setChordMemoryEnabled(true);
    expect(getChordMemoryState().enabled).toBe(true);
    setChordMemoryEnabled(false);
    expect(getChordMemoryState().enabled).toBe(false);
  });

  it("setChordType wechselt den Akkord-Typ", () => {
    setChordType("min7");
    expect(getChordMemoryState().chordType).toBe("min7");
    setChordType("sus4");
    expect(getChordMemoryState().chordType).toBe("sus4");
  });

  it("setChordVoicing akzeptiert 0/1/2", () => {
    setChordVoicing(1);
    expect(getChordMemoryState().voicing).toBe(1);
    setChordVoicing(2);
    expect(getChordMemoryState().voicing).toBe(2);
  });

  it("setChordSpread klemmt Werte auf 0..2", () => {
    setChordSpread(5);
    expect(getChordMemoryState().spread).toBe(2);
    setChordSpread(-1);
    expect(getChordMemoryState().spread).toBe(0);
    setChordSpread(1);
    expect(getChordMemoryState().spread).toBe(1);
  });

  it("persistiert State in localStorage", () => {
    setChordMemoryEnabled(true);
    setChordType("aug");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(true);
    expect(parsed.chordType).toBe("aug");
  });
});
