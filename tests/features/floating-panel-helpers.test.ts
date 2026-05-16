/**
 * Synthstudio – FloatingPanel-Helpers Tests (v2.53)
 *
 * Direct-Unit-Tests für die drei Pure-Helpers loadPosition / persistPosition
 * / clampToViewport. Component selbst wird durch E2E (separat) abgedeckt.
 */
import { describe, it, expect, beforeEach } from "vitest";

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}
const lsMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: lsMock,
  writable: true,
  configurable: true,
});

import {
  loadPosition,
  persistPosition,
  clampToViewport,
  type FloatingPanelPosition,
} from "../../client/src/components/UI/FloatingPanel";

const FALLBACK: FloatingPanelPosition = { x: 120, y: 120, w: 360, h: 480, pinned: false };

beforeEach(() => lsMock.clear());

describe("loadPosition (v2.53)", () => {
  it("Leerer Storage → fallback", () => {
    expect(loadPosition("ss-test:fp", FALLBACK)).toEqual(FALLBACK);
  });

  it("Persistierten Wert vollständig laden", () => {
    lsMock.setItem("ss-test:fp", JSON.stringify({ x: 50, y: 100, w: 400, h: 300, pinned: true }));
    expect(loadPosition("ss-test:fp", FALLBACK)).toEqual({ x: 50, y: 100, w: 400, h: 300, pinned: true });
  });

  it("Partial-Persist: fehlende Felder werden mit Fallback ergänzt", () => {
    lsMock.setItem("ss-test:fp", JSON.stringify({ x: 99 }));
    const result = loadPosition("ss-test:fp", FALLBACK);
    expect(result.x).toBe(99);
    expect(result.y).toBe(FALLBACK.y);
    expect(result.pinned).toBe(FALLBACK.pinned);
  });

  it("Korruptes JSON → fallback (kein Crash)", () => {
    lsMock.setItem("ss-test:fp", "{nicht-json");
    expect(loadPosition("ss-test:fp", FALLBACK)).toEqual(FALLBACK);
  });

  it("JSON aber kein Objekt → fallback", () => {
    lsMock.setItem("ss-test:fp", JSON.stringify(42));
    expect(loadPosition("ss-test:fp", FALLBACK)).toEqual(FALLBACK);
  });

  it("JSON null → fallback", () => {
    lsMock.setItem("ss-test:fp", JSON.stringify(null));
    expect(loadPosition("ss-test:fp", FALLBACK)).toEqual(FALLBACK);
  });

  it("Falscher Typ pro Feld (z.B. x als String) → fallback für genau dieses Feld", () => {
    lsMock.setItem("ss-test:fp", JSON.stringify({ x: "fünfzig", y: 200, pinned: "ja", w: 100, h: 100 }));
    const result = loadPosition("ss-test:fp", FALLBACK);
    expect(result.x).toBe(FALLBACK.x); // String x → fallback
    expect(result.y).toBe(200);        // valider Number y bleibt
    expect(result.pinned).toBe(FALLBACK.pinned); // String pinned → fallback
  });
});

describe("persistPosition (v2.53)", () => {
  it("Round-Trip persist→load liefert identische Position", () => {
    const pos: FloatingPanelPosition = { x: 12, y: 34, w: 567, h: 89, pinned: true };
    persistPosition("ss-test:rt", pos);
    expect(loadPosition("ss-test:rt", FALLBACK)).toEqual(pos);
  });

  it("Mehrfache persist überschreiben den vorherigen Wert", () => {
    persistPosition("ss-test:fp", { x: 1, y: 2, w: 3, h: 4, pinned: false });
    persistPosition("ss-test:fp", { x: 10, y: 20, w: 30, h: 40, pinned: true });
    expect(loadPosition("ss-test:fp", FALLBACK).x).toBe(10);
  });
});

describe("clampToViewport (v2.53)", () => {
  // Tests laufen in node ohne window — wir übergeben viewport explizit.
  const vp = { vw: 1024, vh: 768 };

  it("Position innerhalb Viewport → unverändert", () => {
    const p: FloatingPanelPosition = { x: 200, y: 300, w: 400, h: 200, pinned: false };
    expect(clampToViewport(p, vp)).toEqual(p);
  });

  it("Position weit rechts → wird auf vw-80 geklemmt", () => {
    const p: FloatingPanelPosition = { x: 5000, y: 100, w: 400, h: 200, pinned: false };
    expect(clampToViewport(p, vp).x).toBe(1024 - 80);
  });

  it("Position weit links → wird auf -w+80 geklemmt (mindestens 80px Header sichtbar)", () => {
    const p: FloatingPanelPosition = { x: -5000, y: 100, w: 400, h: 200, pinned: false };
    expect(clampToViewport(p, vp).x).toBe(-400 + 80);
  });

  it("Position unter Viewport → y wird auf vh-32 geklemmt", () => {
    const p: FloatingPanelPosition = { x: 100, y: 9999, w: 400, h: 200, pinned: false };
    expect(clampToViewport(p, vp).y).toBe(768 - 32);
  });

  it("Position über Viewport → y wird auf 0 geklemmt", () => {
    const p: FloatingPanelPosition = { x: 100, y: -500, w: 400, h: 200, pinned: false };
    expect(clampToViewport(p, vp).y).toBe(0);
  });

  it("Width/Height/Pinned bleiben unverändert", () => {
    const p: FloatingPanelPosition = { x: 9999, y: -9999, w: 333, h: 555, pinned: true };
    const result = clampToViewport(p, vp);
    expect(result.w).toBe(333);
    expect(result.h).toBe(555);
    expect(result.pinned).toBe(true);
  });

  it("Viewport 0×0 (kein window) → keine Clamp, Position unverändert", () => {
    const p: FloatingPanelPosition = { x: 9999, y: 9999, w: 400, h: 200, pinned: false };
    expect(clampToViewport(p, { vw: 0, vh: 0 })).toEqual(p);
  });
});
