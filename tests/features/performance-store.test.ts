/**
 * tests/features/performance-store.test.ts
 *
 * Unit-Tests für die persistierte usePerformanceStore-API (v1.20.0+).
 * Deckt setPadAt / setPadColor / setPadLabel / movePad / clearPad /
 * queuePattern / clearQueue / setQuantizeMode + localStorage-Persistierung
 * + Backwards-Compatible-Loading von altem Datenformat.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock (analog macros.test.ts) ───────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
    _peek: () => store,
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// window-Stub (Store dispatcht keine Events, aber wir bleiben defensiv)
Object.defineProperty(globalThis, "window", {
  value: { dispatchEvent: () => true },
  writable: true,
  configurable: true,
});

const STORAGE_KEY = "ss-performance:v1";

import {
  PAD_COUNT,
  getPads,
  getQuantizeMode,
  getQueuedPatternId,
  setPads,
  setPadAt,
  setPadColor,
  setPadLabel,
  movePad,
  clearPad,
  queuePattern,
  clearQueue,
  setQuantizeMode,
  __resetPerformanceStoreForTests,
  type PerformancePad,
} from "../../client/src/store/usePerformanceStore";

beforeEach(() => {
  localStorageMock.clear();
  __resetPerformanceStoreForTests();
});

describe("usePerformanceStore — Defaults", () => {
  it("hat PAD_COUNT === 16 Slots, alle leer", () => {
    const pads = getPads();
    expect(pads.length).toBe(PAD_COUNT);
    expect(PAD_COUNT).toBe(16);
    expect(pads.every(p => p === null)).toBe(true);
  });

  it("quantizeMode default = 'bar'", () => {
    expect(getQuantizeMode()).toBe("bar");
  });

  it("queuedPatternId default = null", () => {
    expect(getQueuedPatternId()).toBeNull();
  });
});

describe("usePerformanceStore — setPadAt", () => {
  it("setzt einen Pad-Slot mit patternId", () => {
    setPadAt(0, { patternId: "p1" });
    const pads = getPads();
    expect(pads[0]).not.toBeNull();
    expect(pads[0]!.patternId).toBe("p1");
  });

  it("setPadAt(5, null) entfernt den Slot", () => {
    setPadAt(5, { patternId: "p2" });
    expect(getPads()[5]).not.toBeNull();
    setPadAt(5, null);
    expect(getPads()[5]).toBeNull();
  });

  it("ignoriert out-of-range index (negative)", () => {
    setPadAt(-1, { patternId: "p1" });
    expect(getPads().every(p => p === null)).toBe(true);
  });

  it("ignoriert out-of-range index (>= PAD_COUNT)", () => {
    setPadAt(16, { patternId: "p1" });
    setPadAt(99, { patternId: "p1" });
    expect(getPads().every(p => p === null)).toBe(true);
  });

  it("ignoriert pad ohne patternId", () => {
    // @ts-expect-error — bewusst invalides Input testen
    setPadAt(0, { patternId: "" });
    // @ts-expect-error
    setPadAt(0, {});
    expect(getPads()[0]).toBeNull();
  });

  it("überschreibt vorhandenen Slot vollständig", () => {
    setPadAt(0, { patternId: "p1", color: "#abc", label: "Old" });
    setPadAt(0, { patternId: "p2" });
    const pad = getPads()[0]!;
    expect(pad.patternId).toBe("p2");
    expect(pad.color).toBeUndefined();
    expect(pad.label).toBeUndefined();
  });
});

describe("usePerformanceStore — setPadColor / setPadLabel", () => {
  it("setPadColor patcht nur Farbe, label bleibt", () => {
    setPadAt(2, { patternId: "p1", label: "Verse", color: "#111" });
    setPadColor(2, "#ff0000");
    const pad = getPads()[2]!;
    expect(pad.color).toBe("#ff0000");
    expect(pad.label).toBe("Verse");
    expect(pad.patternId).toBe("p1");
  });

  it("setPadLabel patcht nur Label, color bleibt", () => {
    setPadAt(3, { patternId: "p2", color: "#abc" });
    setPadLabel(3, "Bridge");
    const pad = getPads()[3]!;
    expect(pad.label).toBe("Bridge");
    expect(pad.color).toBe("#abc");
  });

  it("setPadColor auf leerem Slot ist no-op", () => {
    setPadColor(4, "#fff");
    expect(getPads()[4]).toBeNull();
  });

  it("setPadLabel auf leerem Slot ist no-op", () => {
    setPadLabel(4, "Test");
    expect(getPads()[4]).toBeNull();
  });

  it("setPadColor out-of-range ist no-op", () => {
    setPadAt(0, { patternId: "p1" });
    setPadColor(99, "#fff");
    expect(getPads()[0]!.color).toBeUndefined();
  });
});

describe("usePerformanceStore — movePad", () => {
  it("vertauscht zwei belegte Slots", () => {
    setPadAt(0, { patternId: "pA", label: "A" });
    setPadAt(3, { patternId: "pB", label: "B" });
    movePad(0, 3);
    const pads = getPads();
    expect(pads[0]!.patternId).toBe("pB");
    expect(pads[0]!.label).toBe("B");
    expect(pads[3]!.patternId).toBe("pA");
    expect(pads[3]!.label).toBe("A");
  });

  it("vertauscht belegten mit leerem Slot (Slot wandert)", () => {
    setPadAt(1, { patternId: "pX" });
    movePad(1, 7);
    expect(getPads()[1]).toBeNull();
    expect(getPads()[7]!.patternId).toBe("pX");
  });

  it("movePad(x, x) ist no-op", () => {
    setPadAt(2, { patternId: "pY" });
    movePad(2, 2);
    expect(getPads()[2]!.patternId).toBe("pY");
  });

  it("movePad mit out-of-range Index ist no-op", () => {
    setPadAt(0, { patternId: "pZ" });
    movePad(0, 99);
    movePad(-1, 0);
    movePad(0, -1);
    movePad(99, 0);
    expect(getPads()[0]!.patternId).toBe("pZ");
  });
});

describe("usePerformanceStore — clearPad", () => {
  it("clearPad entfernt nur den angegebenen Slot", () => {
    setPadAt(0, { patternId: "pA" });
    setPadAt(1, { patternId: "pB" });
    setPadAt(2, { patternId: "pC" });
    clearPad(1);
    const pads = getPads();
    expect(pads[0]!.patternId).toBe("pA");
    expect(pads[1]).toBeNull();
    expect(pads[2]!.patternId).toBe("pC");
  });
});

describe("usePerformanceStore — queuePattern / clearQueue (Runtime, kein Persist)", () => {
  it("queuePattern setzt queuedPatternId", () => {
    queuePattern("p1");
    expect(getQueuedPatternId()).toBe("p1");
  });

  it("zweimaliges queuePattern(p1) toggelt Queue → null", () => {
    queuePattern("p1");
    expect(getQueuedPatternId()).toBe("p1");
    queuePattern("p1");
    expect(getQueuedPatternId()).toBeNull();
  });

  it("queuePattern(p2) nach p1 ersetzt durch p2", () => {
    queuePattern("p1");
    queuePattern("p2");
    expect(getQueuedPatternId()).toBe("p2");
  });

  it("clearQueue setzt zurück auf null", () => {
    queuePattern("pX");
    clearQueue();
    expect(getQueuedPatternId()).toBeNull();
  });

  it("queuedPatternId wird NICHT persistiert", () => {
    queuePattern("p1");
    const stored = localStorageMock.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.queuedPatternId).toBeUndefined();
    }
  });
});

describe("usePerformanceStore — setQuantizeMode", () => {
  it("setzt erlaubte Modi", () => {
    setQuantizeMode("beat");
    expect(getQuantizeMode()).toBe("beat");
    setQuantizeMode("step");
    expect(getQuantizeMode()).toBe("step");
    setQuantizeMode("bar");
    expect(getQuantizeMode()).toBe("bar");
  });

  it("ignoriert invalide Modi", () => {
    setQuantizeMode("beat");
    // @ts-expect-error invalid mode test
    setQuantizeMode("invalid");
    expect(getQuantizeMode()).toBe("beat");
  });
});

describe("usePerformanceStore — setPads bulk", () => {
  it("bulk-replace mit gültiger Liste", () => {
    setPads([
      { patternId: "a" },
      { patternId: "b", color: "#fff" },
      null,
      { patternId: "d" },
    ]);
    const pads = getPads();
    expect(pads[0]!.patternId).toBe("a");
    expect(pads[1]!.color).toBe("#fff");
    expect(pads[2]).toBeNull();
    expect(pads[3]!.patternId).toBe("d");
    // Restliche Slots leer + Länge bleibt PAD_COUNT
    expect(pads.length).toBe(PAD_COUNT);
    expect(pads.slice(4).every(p => p === null)).toBe(true);
  });

  it("filtert Items ohne patternId raus", () => {
    setPads([
      // @ts-expect-error invalid
      { patternId: "" },
      { patternId: "ok" },
    ]);
    const pads = getPads();
    expect(pads[0]).toBeNull();
    expect(pads[1]!.patternId).toBe("ok");
  });
});

describe("usePerformanceStore — Persistierung (localStorage round-trip)", () => {
  it("setPadAt schreibt in localStorage", () => {
    setPadAt(0, { patternId: "pX", color: "#abc", label: "Test" });
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.pads[0]).toMatchObject({ patternId: "pX", color: "#abc", label: "Test" });
  });

  it("quantizeMode wird persistiert", () => {
    setQuantizeMode("step");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.quantizeMode).toBe("step");
  });

  it("Reload via vi.resetModules: Pads + quantizeMode kommen zurück", async () => {
    setPadAt(0, { patternId: "p1", label: "Drum" });
    setPadAt(5, { patternId: "p2", color: "#f00" });
    setQuantizeMode("beat");

    // Neu importieren (frischer Module-State, der aus localStorage lädt)
    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    const pads = reloaded.getPads();
    expect(pads[0]).toMatchObject({ patternId: "p1", label: "Drum" });
    expect(pads[5]).toMatchObject({ patternId: "p2", color: "#f00" });
    expect(reloaded.getQuantizeMode()).toBe("beat");
    expect(reloaded.getQueuedPatternId()).toBeNull(); // Runtime-state, nicht persistiert
  });

  it("queuedPatternId überlebt Reload NICHT", async () => {
    queuePattern("p1");
    expect(getQueuedPatternId()).toBe("p1");
    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    expect(reloaded.getQueuedPatternId()).toBeNull();
  });
});

describe("usePerformanceStore — Migration & Toleranz", () => {
  it("lädt alte Daten ohne color/label tolerant", async () => {
    // Simulate altes localStorage-Format mit minimalen Pads
    const old = {
      pads: [
        { patternId: "old1" },
        { patternId: "old2" },
        null,
      ],
      quantizeMode: "step",
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(old));

    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    const pads = reloaded.getPads();
    expect(pads[0]).toMatchObject({ patternId: "old1" });
    expect(pads[0]!.color).toBeUndefined();
    expect(pads[0]!.label).toBeUndefined();
    expect(pads[1]!.patternId).toBe("old2");
    expect(reloaded.getQuantizeMode()).toBe("step");
  });

  it("invalide quantizeMode aus altem Storage → bar", async () => {
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify({
      pads: [],
      quantizeMode: "nonsense",
    }));
    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    expect(reloaded.getQuantizeMode()).toBe("bar");
  });

  it("kompletter Müll im localStorage → Defaults, kein Crash", async () => {
    localStorageMock.setItem(STORAGE_KEY, "{{ broken json");
    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    expect(reloaded.getPads().every(p => p === null)).toBe(true);
    expect(reloaded.getQuantizeMode()).toBe("bar");
  });

  it("pads ist kein Array → Defaults", async () => {
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify({ pads: "string", quantizeMode: "bar" }));
    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    expect(reloaded.getPads().every(p => p === null)).toBe(true);
  });

  it("Pad-Items mit nicht-string patternId werden gefiltert", async () => {
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify({
      pads: [
        { patternId: 123 },
        { patternId: "ok" },
        "string-not-object",
        { other: "field" },
      ],
      quantizeMode: "bar",
    }));
    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    const pads = reloaded.getPads();
    expect(pads[0]).toBeNull();
    expect(pads[1]!.patternId).toBe("ok");
    expect(pads[2]).toBeNull();
    expect(pads[3]).toBeNull();
  });
});

describe("usePerformanceStore — Type-Surface", () => {
  it("PerformancePad-Typ erlaubt optionale Felder", () => {
    const p1: PerformancePad = { patternId: "a" };
    const p2: PerformancePad = { patternId: "b", color: "#fff" };
    const p3: PerformancePad = { patternId: "c", label: "X" };
    const p4: PerformancePad = { patternId: "d", color: "#abc", label: "Y" };
    expect([p1, p2, p3, p4].every(p => typeof p.patternId === "string")).toBe(true);
  });
});
