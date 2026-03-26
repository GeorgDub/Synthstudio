/**
 * tests/melodic-part.test.ts
 *
 * Unit-Tests für useMelodicPartStore (Phase 2 – Piano Roll).
 * Umgebung: Node (kein DOM) → sessionStorage wird gemockt.
 * Getestet werden die exportierten Logik-Funktionen ohne React-Renderer.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── Mock-Setup ───────────────────────────────────────────────────────────────

function createSessionStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string): string | null => store[key] ?? null,
    setItem:    (key: string, value: string): void => { store[key] = value; },
    removeItem: (key: string): void => { delete store[key]; },
    clear:      (): void => { store = {}; },
  };
}

const sessionStorageMock = createSessionStorageMock();

Object.defineProperty(globalThis, "sessionStorage", {
  value:        sessionStorageMock,
  writable:     true,
  configurable: true,
});

Object.defineProperty(globalThis, "window", {
  value:        {},
  writable:     true,
  configurable: true,
});

// Erst NACH den Global-Mocks importieren
import {
  initPart,
  toggleStep,
  setNote,
  setVelocity,
  setBaseNote,
  clearPart,
  getPattern,
  __resetForTests,
} from "../client/src/store/useMelodicPartStore";

// ─── Hilfsfunktion ───────────────────────────────────────────────────────────

function reset() {
  sessionStorageMock.clear();
  __resetForTests();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useMelodicPartStore – Logik-Funktionen", () => {
  beforeEach(reset);

  it("1. initPart erstellt 16 Steps mit active = false", () => {
    initPart("part-1");
    const pattern = getPattern("part-1");
    expect(pattern).toBeDefined();
    expect(pattern!.steps).toHaveLength(16);
    expect(pattern!.steps.every((s) => s.active === false)).toBe(true);
  });

  it("2. toggleStep aktiviert einen Step", () => {
    initPart("part-2");
    toggleStep("part-2", 0);
    expect(getPattern("part-2")!.steps[0].active).toBe(true);
  });

  it("3. toggleStep deaktiviert einen aktiven Step", () => {
    initPart("part-3");
    toggleStep("part-3", 5);
    toggleStep("part-3", 5);
    expect(getPattern("part-3")!.steps[5].active).toBe(false);
  });

  it("4. setNote setzt die MIDI-Note eines Steps und aktiviert ihn", () => {
    initPart("part-4");
    setNote("part-4", 3, 64);
    const step = getPattern("part-4")!.steps[3];
    expect(step.note).toBe(64);
    expect(step.active).toBe(true);
  });

  it("5. setVelocity setzt die Velocity und clampt auf 0–127", () => {
    initPart("part-5");
    setVelocity("part-5", 0, 200);           // über Maximum → klemmen auf 127
    expect(getPattern("part-5")!.steps[0].velocity).toBe(127);
    setVelocity("part-5", 1, -10);           // unter Minimum → klemmen auf 0
    expect(getPattern("part-5")!.steps[1].velocity).toBe(0);
    setVelocity("part-5", 2, 80);            // normaler Wert
    expect(getPattern("part-5")!.steps[2].velocity).toBe(80);
  });

  it("6. setBaseNote ändert den Grundton des Parts", () => {
    initPart("part-6");
    setBaseNote("part-6", 48);

    const pattern = getPattern("part-6");
    expect(pattern!.baseNote).toBe(48);
  });

  it("7. clearPart setzt alle Steps auf active = false", () => {
    initPart("part-7");
    toggleStep("part-7", 0);
    toggleStep("part-7", 7);
    toggleStep("part-7", 15);

    clearPart("part-7");

    expect(getPattern("part-7")!.steps.every((s) => s.active === false)).toBe(true);
  });

  it("8. getPattern gibt undefined zurück, wenn der Part nicht existiert", () => {
    expect(getPattern("nonexistent")).toBeUndefined();
  });

  it("9. getPattern gibt Pattern mit korrekter partId und baseNote zurück", () => {
    initPart("part-9");
    const pattern = getPattern("part-9");
    expect(pattern).toBeDefined();
    expect(pattern!.partId).toBe("part-9");
    expect(pattern!.baseNote).toBe(60);   // Default C4
  });

  it("10. setNote ohne vorherige initPart: Part wird implizit initialisiert", () => {
    // "implicit-part" wurde nie über initPart angelegt
    setNote("implicit-part", 7, 55);

    const pattern = getPattern("implicit-part");
    expect(pattern).toBeDefined();
    expect(pattern!.steps).toHaveLength(16);
    expect(pattern!.steps[7].note).toBe(55);
    expect(pattern!.steps[7].active).toBe(true);
  });
});
