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
  setScale,
  setScaleLock,
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

  it("11. Default-Pattern hat scaleLockEnabled=false und scaleId=chromatic", () => {
    initPart("part-11");
    const pattern = getPattern("part-11")!;
    expect(pattern.scaleLockEnabled).toBe(false);
    expect(pattern.scaleId).toBe("chromatic");
    expect(pattern.scaleRoot).toBe(0);
  });

  it("12. setScale aktualisiert Root und Skalen-ID", () => {
    initPart("part-12");
    setScale("part-12", 7, "minor");
    const p = getPattern("part-12")!;
    expect(p.scaleRoot).toBe(7);
    expect(p.scaleId).toBe("minor");
  });

  it("13. setScale normalisiert Root außerhalb 0-11", () => {
    initPart("part-13");
    setScale("part-13", 14, "major");
    expect(getPattern("part-13")!.scaleRoot).toBe(2);
    setScale("part-13", -1, "major");
    expect(getPattern("part-13")!.scaleRoot).toBe(11);
  });

  it("14. setScaleLock toggelt das Flag", () => {
    initPart("part-14");
    expect(getPattern("part-14")!.scaleLockEnabled).toBe(false);
    setScaleLock("part-14", true);
    expect(getPattern("part-14")!.scaleLockEnabled).toBe(true);
    setScaleLock("part-14", false);
    expect(getPattern("part-14")!.scaleLockEnabled).toBe(false);
  });

  it("15. setNote ohne Scale-Lock akzeptiert jede Note", () => {
    initPart("part-15");
    setScale("part-15", 0, "major");
    // Scale-Lock NICHT aktiv → C# (61) bleibt C#
    setNote("part-15", 0, 61);
    expect(getPattern("part-15")!.steps[0].note).toBe(61);
  });

  it("16. setNote mit Scale-Lock snapt auf nächste In-Scale-Note", () => {
    initPart("part-16");
    setScale("part-16", 0, "major");
    setScaleLock("part-16", true);
    // C# (61) → C (60) oder D (62) in C-Major
    setNote("part-16", 0, 61);
    const note = getPattern("part-16")!.steps[0].note;
    expect([60, 62]).toContain(note);
  });

  it("17. setNote mit chromatic + Lock akzeptiert jede Note", () => {
    initPart("part-17");
    setScale("part-17", 0, "chromatic");
    setScaleLock("part-17", true);
    setNote("part-17", 0, 61);
    expect(getPattern("part-17")!.steps[0].note).toBe(61);
  });

  it("18. setNote mit Scale-Lock + verschobenem Root snapt korrekt", () => {
    initPart("part-18");
    // G-Major: F# ist erlaubt, F nicht
    setScale("part-18", 7, "major");
    setScaleLock("part-18", true);
    setNote("part-18", 0, 65); // F → muss snappen (in G-Major nicht enthalten)
    const note = getPattern("part-18")!.steps[0].note;
    expect([64, 66]).toContain(note);
  });
});
