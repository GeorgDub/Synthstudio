/**
 * tests/transpose.test.ts
 *
 * Unit-Tests für Global-Transpose Utilities + Store.
 * Reine Logik – mock localStorage für Store.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

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
  TRANSPOSE_MIN,
  TRANSPOSE_MAX,
  MIDI_MIN,
  MIDI_MAX,
  clampSemitones,
  transposeNote,
  semitoneLabel,
} from "../client/src/utils/transpose";
import {
  getSemitones,
  setSemitones,
  incSemitones,
  resetTranspose,
  __resetForTests,
} from "../client/src/store/useTransposeStore";

// ─── Utility-Tests ────────────────────────────────────────────────────────────

describe("clampSemitones", () => {
  it("erlaubt Werte im Bereich -24..+24", () => {
    expect(clampSemitones(0)).toBe(0);
    expect(clampSemitones(12)).toBe(12);
    expect(clampSemitones(-12)).toBe(-12);
    expect(clampSemitones(24)).toBe(24);
    expect(clampSemitones(-24)).toBe(-24);
  });

  it("clampt Out-of-Range-Werte", () => {
    expect(clampSemitones(100)).toBe(TRANSPOSE_MAX);
    expect(clampSemitones(-100)).toBe(TRANSPOSE_MIN);
  });

  it("rundet Fließkommawerte", () => {
    expect(clampSemitones(2.4)).toBe(2);
    expect(clampSemitones(2.6)).toBe(3);
    expect(clampSemitones(-2.6)).toBe(-3);
  });

  it("liefert 0 für NaN/Infinity", () => {
    expect(clampSemitones(NaN)).toBe(0);
    expect(clampSemitones(Infinity)).toBe(0);
    expect(clampSemitones(-Infinity)).toBe(0);
  });
});

describe("transposeNote", () => {
  it("addiert Halbtöne korrekt", () => {
    expect(transposeNote(60, 0)).toBe(60);
    expect(transposeNote(60, 12)).toBe(72);
    expect(transposeNote(60, -12)).toBe(48);
    expect(transposeNote(60, 5)).toBe(65);
  });

  it("clampt auf den MIDI-Bereich 0-127", () => {
    expect(transposeNote(120, 24)).toBe(MIDI_MAX);
    expect(transposeNote(5, -24)).toBe(MIDI_MIN);
  });

  it("respektiert MIDI_MIN/MIDI_MAX-Grenzen", () => {
    expect(transposeNote(127, 1)).toBe(127);
    expect(transposeNote(0, -1)).toBe(0);
  });
});

describe("semitoneLabel", () => {
  it("formatiert 0 ohne Vorzeichen", () => {
    expect(semitoneLabel(0)).toBe("0");
  });

  it("formatiert positive Werte mit +", () => {
    expect(semitoneLabel(5)).toBe("+5");
    expect(semitoneLabel(1)).toBe("+1");
  });

  it("formatiert negative Werte mit -", () => {
    expect(semitoneLabel(-5)).toBe("-5");
    expect(semitoneLabel(-7)).toBe("-7");
  });

  it("fügt 8va/8vb-Annotation für Oktaven hinzu", () => {
    expect(semitoneLabel(12)).toContain("8va");
    expect(semitoneLabel(-12)).toContain("8vb");
    expect(semitoneLabel(24)).toContain("15ma");
    expect(semitoneLabel(-24)).toContain("15mb");
  });
});

// ─── Store-Tests ──────────────────────────────────────────────────────────────

describe("useTransposeStore – Logik-Funktionen", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("Default-Wert ist 0", () => {
    expect(getSemitones()).toBe(0);
  });

  it("setSemitones aktualisiert den Wert", () => {
    setSemitones(5);
    expect(getSemitones()).toBe(5);
  });

  it("setSemitones clampt auf ±24", () => {
    setSemitones(100);
    expect(getSemitones()).toBe(24);
    setSemitones(-100);
    expect(getSemitones()).toBe(-24);
  });

  it("incSemitones addiert delta", () => {
    setSemitones(5);
    incSemitones(3);
    expect(getSemitones()).toBe(8);
    incSemitones(-10);
    expect(getSemitones()).toBe(-2);
  });

  it("incSemitones clampt am Bereichsende", () => {
    setSemitones(22);
    incSemitones(10);
    expect(getSemitones()).toBe(24);
  });

  it("resetTranspose setzt auf 0", () => {
    setSemitones(15);
    resetTranspose();
    expect(getSemitones()).toBe(0);
  });

  it("persistiert in localStorage", () => {
    setSemitones(7);
    expect(localStorageMock.getItem("ss-global-transpose")).toBe("7");
  });

  it("setSemitones gleicher Wert: keine doppelte Persistenz nötig (kein Crash)", () => {
    setSemitones(3);
    setSemitones(3); // no-op
    expect(getSemitones()).toBe(3);
  });
});
