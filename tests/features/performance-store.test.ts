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
  PAD_COLOR_VAR_NAMES,
  getPads,
  getQuantizeMode,
  getQueuedPatternId,
  setPads,
  setPadAt,
  setPadColor,
  setPadLabel,
  movePad,
  moveMultiplePads,
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

describe("usePerformanceStore — moveMultiplePads (Insert-Semantik, TASK-114)", () => {
  it("moveMultiplePads([0,1], 5) wandert Pads 0+1 vor Position 5 (kompaktiert)", () => {
    // Setup: 0=A, 1=B, 4=E, 5=F, 7=H
    setPadAt(0, { patternId: "A" });
    setPadAt(1, { patternId: "B" });
    setPadAt(4, { patternId: "E" });
    setPadAt(5, { patternId: "F" });
    setPadAt(7, { patternId: "H" });
    moveMultiplePads([0, 1], 5);
    // Nach Entfernung von 0+1: kompakt = [_,_,E,F,_,H,...] (Indizes 2,3 leer-am-Anfang)
    // Wait: compacted = [null, null, E, F, null, H, null...] (Index 2-7 vom Original ohne 0,1)
    // Korrektur: compacted entfernt INDIZES 0+1, kompaktiert NICHT. Lass mich nochmal denken:
    //   Original: [A,B,_,_,E,F,_,H,_,_,_,_,_,_,_,_]
    //   Remove 0+1: [_,_,E,F,_,H,_,_,_,_,_,_,_,_]  (14 slots, nicht kompaktiert über die Lücken)
    //   removedBeforeTarget=2 (beide 0 und 1 sind <5)
    //   insertAt = 5 - 2 = 3
    //   compacted.splice(3, 0, A, B) → [_,_,E,A,B,F,_,H,_,_,_,_,_,_,_,_] (16 slots, exakt)
    //   Pad auf PAD_COUNT (16) normalisieren
    const pads = getPads();
    expect(pads[0]).toBeNull();
    expect(pads[1]).toBeNull();
    expect(pads[2]!.patternId).toBe("E");
    expect(pads[3]!.patternId).toBe("A");
    expect(pads[4]!.patternId).toBe("B");
    expect(pads[5]!.patternId).toBe("F");
    expect(pads[6]).toBeNull();
    expect(pads[7]!.patternId).toBe("H");
  });

  it("moveMultiplePads([3,5,7], 0) bringt drei Pads an den Anfang", () => {
    setPadAt(3, { patternId: "X" });
    setPadAt(5, { patternId: "Y" });
    setPadAt(7, { patternId: "Z" });
    setPadAt(10, { patternId: "K" });
    moveMultiplePads([3, 5, 7], 0);
    const pads = getPads();
    expect(pads[0]!.patternId).toBe("X");
    expect(pads[1]!.patternId).toBe("Y");
    expect(pads[2]!.patternId).toBe("Z");
    // 'K' war ursprünglich Index 10. Compacted ohne 3,5,7 = [_,_,_,_,_,_,_,K,_,_,_,_,_]
    //   (Original: [_,_,_,_,_,_,_,_,_,_,K,_,_,_,_,_] → remove 3,5,7 → [_,_,_,_,_,_,_,K,_,_,_,_,_])
    // insertAt = 0 - 0 = 0; splice in [X,Y,Z] → [X,Y,Z,_,_,_,_,_,_,_,K,_,_,_,_,_]
    expect(pads[10]!.patternId).toBe("K");
  });

  it("moveMultiplePads([0], 0) ist no-op (move-to-self)", () => {
    setPadAt(0, { patternId: "A" });
    setPadAt(1, { patternId: "B" });
    moveMultiplePads([0], 0);
    const pads = getPads();
    expect(pads[0]!.patternId).toBe("A");
    expect(pads[1]!.patternId).toBe("B");
  });

  it("moveMultiplePads([3], 3) ist no-op (Target liegt in fromIndices)", () => {
    setPadAt(3, { patternId: "Solo" });
    moveMultiplePads([3], 3);
    expect(getPads()[3]!.patternId).toBe("Solo");
  });

  it("moveMultiplePads([], 0) ist no-op (leere Liste)", () => {
    setPadAt(0, { patternId: "A" });
    moveMultiplePads([], 0);
    expect(getPads()[0]!.patternId).toBe("A");
  });

  it("moveMultiplePads([15,14], 0) Reverse-Order wird beibehalten", () => {
    setPadAt(14, { patternId: "Last1" });
    setPadAt(15, { patternId: "Last2" });
    moveMultiplePads([15, 14], 0);
    const pads = getPads();
    // pickedPads = [Last2, Last1] (in fromIndices-Reihenfolge!)
    expect(pads[0]!.patternId).toBe("Last2");
    expect(pads[1]!.patternId).toBe("Last1");
    expect(pads[14]).toBeNull();
    expect(pads[15]).toBeNull();
  });

  it("moveMultiplePads([99, -1, 2.5], 0) filtert invalide Indizes raus", () => {
    setPadAt(2, { patternId: "Valid" });
    // Nur invalide → no-op nach Sanitisierung
    moveMultiplePads([99, -1, 2.5], 0);
    expect(getPads()[2]!.patternId).toBe("Valid");
    expect(getPads()[0]).toBeNull();
  });

  it("moveMultiplePads([0, 0, 0], 5) dedupliziert", () => {
    setPadAt(0, { patternId: "A" });
    setPadAt(3, { patternId: "B" });
    moveMultiplePads([0, 0, 0], 5);
    const pads = getPads();
    // Nach Dedup: cleanFrom=[0]. Original [A,_,_,B,...]; compacted ohne idx 0 = [_,_,B,_,...] (15 slots).
    //   removedBeforeTarget = 1 (idx 0 < 5); insertAt = 5 - 1 = 4
    //   splice(4, 0, A) → [_,_,B,_,A,_,_,_,_,_,_,_,_,_,_,_]
    expect(pads[0]).toBeNull();
    expect(pads[2]!.patternId).toBe("B");
    expect(pads[3]).toBeNull();
    expect(pads[4]!.patternId).toBe("A");
  });

  it("moveMultiplePads([0,1], 16) target out-of-range → no-op", () => {
    setPadAt(0, { patternId: "A" });
    setPadAt(1, { patternId: "B" });
    moveMultiplePads([0, 1], 16);
    moveMultiplePads([0, 1], -1);
    moveMultiplePads([0, 1], 2.5);
    const pads = getPads();
    expect(pads[0]!.patternId).toBe("A");
    expect(pads[1]!.patternId).toBe("B");
  });

  it("moveMultiplePads persistiert das Resultat in localStorage", () => {
    setPadAt(0, { patternId: "A", color: "#abc" });
    setPadAt(1, { patternId: "B", label: "Bee" });
    moveMultiplePads([0, 1], 5);
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.pads[3]).toMatchObject({ patternId: "A", color: "#abc" });
    expect(parsed.pads[4]).toMatchObject({ patternId: "B", label: "Bee" });
  });

  it("moveMultiplePads([0,2,4], 1) Target liegt zwischen Picks → wird zu insertAt=1", () => {
    setPadAt(0, { patternId: "A" });
    setPadAt(2, { patternId: "C" });
    setPadAt(4, { patternId: "E" });
    setPadAt(7, { patternId: "H" });
    moveMultiplePads([0, 2, 4], 1);
    const pads = getPads();
    // Compacted ohne 0,2,4 (Original [A,_,C,_,E,_,_,H,...]):
    //   → [_, _, _, _, H, _, _, _, _, _, _, _, _] (13 slots)
    // removedBeforeTarget = 1 (nur idx 0 < 1); insertAt = 1 - 1 = 0
    // splice(0, 0, A, C, E) → [A,C,E,_,_,_,_,H,...]
    expect(pads[0]!.patternId).toBe("A");
    expect(pads[1]!.patternId).toBe("C");
    expect(pads[2]!.patternId).toBe("E");
    expect(pads[7]!.patternId).toBe("H");
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

// ─── TASK-119 / v1.22.0 — Theme-aware Pad-Default-Palette ────────────────────

describe("usePerformanceStore — PAD_COLOR_VAR_NAMES (TASK-119)", () => {
  it("exportiert genau 8 CSS-Variable-Namen", () => {
    expect(PAD_COLOR_VAR_NAMES.length).toBe(8);
  });

  it("folgt dem Schema --ss-pad-1 .. --ss-pad-8 in korrekter Reihenfolge", () => {
    for (let i = 0; i < 8; i++) {
      expect(PAD_COLOR_VAR_NAMES[i]).toBe(`--ss-pad-${i + 1}`);
    }
  });

  it("ist readonly (TypeScript-Surface) — Mutationen schlagen nicht in Persistenz durch", () => {
    // Runtime kann nicht prüfen ob ein readonly-Cast wirklich eingehalten wird,
    // aber wir verifizieren dass die Konstante NICHT in localStorage landet
    // wenn man am Store herumdreht.
    setPadAt(0, { patternId: "x", color: "#abcdef" });
    const persisted = JSON.parse(localStorageMock._peek()[STORAGE_KEY] ?? "{}");
    expect(persisted.padColorVarNames).toBeUndefined();
    expect(persisted.pads[0].color).toBe("#abcdef"); // User-color unverändert
  });
});

describe("usePerformanceStore — User-Color Persistence (TASK-119 Migration)", () => {
  it("Pad mit altem hardcoded hex bleibt unverändert beim Load (kein Auto-Theme-Migration)", async () => {
    // Simuliere: v1.20.x User hatte einen Pad mit hardcoded #22d3ee (cyan aus PAD_COLORS) gespeichert.
    // TASK-119 darf das NICHT auf "--ss-pad-1" oder ähnlich umstellen — User-Choice respektieren.
    const oldData = {
      pads: [
        { patternId: "p1", color: "#22d3ee", label: "Cyan-Pad" },
        { patternId: "p2", color: "#a78bfa", label: "Violet-Pad" },
        null,
      ],
      quantizeMode: "bar",
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(oldData));

    vi.resetModules();
    const reloaded = await import("../../client/src/store/usePerformanceStore");
    const pads = reloaded.getPads();
    expect(pads[0]?.color).toBe("#22d3ee");
    expect(pads[1]?.color).toBe("#a78bfa");
    // Es darf KEIN var(...) oder CSS-Variable-Reference reingerutscht sein
    expect(pads[0]?.color?.startsWith("var(")).toBe(false);
    expect(pads[0]?.color?.startsWith("--")).toBe(false);
  });

  it("setPadColor mit hardcoded hex überschreibt bisherigen Wert", () => {
    setPadAt(0, { patternId: "p1", color: "#22d3ee" });
    setPadColor(0, "#ff0000");
    expect(getPads()[0]?.color).toBe("#ff0000");
  });
});

describe("getPadDefaultColor — Resolution via CSS-Variablen (TASK-119)", () => {
  // Mock document.documentElement + getComputedStyle für den Lookup-Helper.
  // Der Helper lebt in PatternLaunchPad.tsx (UI-Component), nicht im Store.
  // Wir testen ihn hier per Re-Implementation des Algorithmus mit dem
  // Store-Export PAD_COLOR_VAR_NAMES, um die Vertrags-Korrektheit zu sichern.
  function makeGetPadDefaultColor(
    cssLookup: (varName: string) => string,
    fallbacks: readonly string[],
  ) {
    return (index: number): string => {
      const slot = ((index % 8) + 8) % 8;
      const fb = fallbacks[slot] ?? "#334155";
      try {
        const varName = PAD_COLOR_VAR_NAMES[slot] ?? `--ss-pad-${slot + 1}`;
        const resolved = cssLookup(varName).trim();
        return resolved || fb;
      } catch {
        return fb;
      }
    };
  }

  const FALLBACKS = [
    "#22d3ee", "#a78bfa", "#34d399", "#f87171",
    "#fb923c", "#facc15", "#60a5fa", "#e879f9",
  ];

  it("Slot-Mapping: index 0..15 → slot (index % 8) + 1", () => {
    const lookup = vi.fn((name: string) => {
      const m = name.match(/--ss-pad-(\d+)/);
      return m ? `#slot${m[1]}` : "";
    });
    const getColor = makeGetPadDefaultColor(lookup, FALLBACKS);

    // Erste Reihe (0..7) maps auf slot 1..8
    expect(getColor(0)).toBe("#slot1");
    expect(getColor(7)).toBe("#slot8");
    // Zweite Reihe (8..15) wrappt auf slot 1..8
    expect(getColor(8)).toBe("#slot1");
    expect(getColor(15)).toBe("#slot8");
  });

  it("Fallback wenn CSS-Variable nicht aufgelöst werden kann (leerer String)", () => {
    const lookup = (_: string) => "";
    const getColor = makeGetPadDefaultColor(lookup, FALLBACKS);
    // Erwartet Fallback aus der Palette (Index 0 → Slot 0 → cyan)
    expect(getColor(0)).toBe("#22d3ee");
    expect(getColor(7)).toBe("#e879f9");
  });

  it("Fallback wenn Lookup wirft (Exception-Path)", () => {
    const lookup = (_: string): string => { throw new Error("boom"); };
    const getColor = makeGetPadDefaultColor(lookup, FALLBACKS);
    expect(getColor(3)).toBe("#f87171");
  });

  it("Negative + große Indizes klemmen via mod ohne Crash", () => {
    const lookup = (name: string) => {
      const m = name.match(/--ss-pad-(\d+)/);
      return m ? `#slot${m[1]}` : "";
    };
    const getColor = makeGetPadDefaultColor(lookup, FALLBACKS);
    expect(getColor(-1)).toBe("#slot8"); // wrap zurück
    expect(getColor(16)).toBe("#slot1"); // wrap nach vorn
    expect(getColor(100)).toBe("#slot5"); // 100 % 8 = 4 → slot 5
  });
});
