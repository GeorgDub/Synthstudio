/**
 * tests/features/macros.test.ts
 *
 * Unit-Tests fuer useMacroStore.
 * Stubt localStorage + window (fuer CustomEvent-Dispatch in setMacroValue).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

// window.dispatchEvent + CustomEvent Stub fuer setMacroValue
const dispatched: Array<{ type: string; detail: unknown }> = [];
class FakeCustomEvent<T = unknown> {
  type: string;
  detail: T;
  constructor(type: string, init?: { detail: T }) {
    this.type = type;
    this.detail = (init?.detail as T)!;
  }
}
Object.defineProperty(globalThis, "CustomEvent", {
  value: FakeCustomEvent,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: {
    dispatchEvent: (ev: FakeCustomEvent<unknown>) => {
      dispatched.push({ type: ev.type, detail: ev.detail });
      return true;
    },
  },
  writable: true,
  configurable: true,
});

import {
  MACRO_COUNT,
  MACRO_COLORS,
  setMacroValue,
  setMacroLabel,
  addMacroBinding,
  removeMacroBinding,
  resetMacros,
  getMacros,
  mapMacroValue,
  applyMacroBindings,
  setMacroMode,
  setMacroScriptId,
  setMacroTriggerKind,
  setMacroPadIndex,
  triggerMacroButton,
  type MacroBinding,
  type Macro,
  type MacroRouteSetters,
} from "../../client/src/store/useMacroStore";

const STORAGE_KEY = "ss-macros:v1";

describe("useMacroStore – Konstanten und Defaults", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("MACRO_COUNT ist 8", () => {
    expect(MACRO_COUNT).toBe(8);
  });

  it("MACRO_COLORS hat 8 Farben", () => {
    expect(MACRO_COLORS).toHaveLength(8);
  });

  it("getMacros liefert 8 Macros mit Default-Werten", () => {
    const macros = getMacros();
    expect(macros).toHaveLength(8);
    macros.forEach((m, i) => {
      expect(m.index).toBe(i);
      expect(m.label).toBe(`Macro ${i + 1}`);
      expect(m.value).toBe(0);
      expect(m.bindings).toEqual([]);
      expect(m.color).toBe(MACRO_COLORS[i]);
    });
  });
});

describe("useMacroStore – Setter", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("setMacroValue klemmt Werte auf 0..1", () => {
    setMacroValue(0, 1.5);
    expect(getMacros()[0].value).toBe(1);
    setMacroValue(0, -0.3);
    expect(getMacros()[0].value).toBe(0);
    setMacroValue(0, 0.42);
    expect(getMacros()[0].value).toBeCloseTo(0.42);
  });

  it("setMacroValue dispatcht ein 'macro:change' Custom Event", () => {
    setMacroValue(2, 0.7);
    expect(dispatched.length).toBeGreaterThanOrEqual(1);
    const evt = dispatched[dispatched.length - 1];
    expect(evt.type).toBe("macro:change");
    expect(evt.detail).toMatchObject({ index: 2, value: 0.7 });
  });

  it("setMacroLabel aktualisiert nur das Label", () => {
    setMacroLabel(3, "Cutoff");
    expect(getMacros()[3].label).toBe("Cutoff");
    expect(getMacros()[2].label).toBe("Macro 3"); // unveraendert
  });

  it("addMacroBinding fuegt Binding hinzu und vergibt eindeutige ID", () => {
    const binding: Omit<MacroBinding, "id"> = {
      target: "channel-vol",
      partId: "kick",
      partName: "Kick",
      minValue: 0,
      maxValue: 1,
    };
    addMacroBinding(0, binding);
    addMacroBinding(0, binding);
    const m = getMacros()[0];
    expect(m.bindings).toHaveLength(2);
    expect(m.bindings[0].id).not.toBe(m.bindings[1].id);
    expect(m.bindings[0].target).toBe("channel-vol");
  });

  it("removeMacroBinding entfernt Binding anhand der ID", () => {
    addMacroBinding(1, {
      target: "channel-pan",
      partId: "snare",
      minValue: -1,
      maxValue: 1,
    });
    const id = getMacros()[1].bindings[0].id;
    removeMacroBinding(1, id);
    expect(getMacros()[1].bindings).toHaveLength(0);
  });

  it("resetMacros setzt alle Macros auf Default zurueck", () => {
    setMacroLabel(0, "Custom");
    setMacroValue(1, 0.5);
    addMacroBinding(2, {
      target: "master-vol",
      minValue: 0,
      maxValue: 1,
    });
    resetMacros();
    const macros = getMacros();
    expect(macros[0].label).toBe("Macro 1");
    expect(macros[1].value).toBe(0);
    expect(macros[2].bindings).toHaveLength(0);
  });

  it("persistiert Labels und Bindings in localStorage", () => {
    setMacroLabel(0, "Persistent");
    addMacroBinding(0, {
      target: "bpm",
      minValue: 80,
      maxValue: 160,
    });
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].label).toBe("Persistent");
    expect(parsed[0].bindings).toHaveLength(1);
    expect(parsed[0].bindings[0].target).toBe("bpm");
  });
});

// ─── Routing-Tests (TASK-100) ────────────────────────────────────────────────
// Diese Tests verifizieren das Audio-Routing: Wenn ein Macro auf einen
// Parameter gemappt ist und sein Wert geändert wird, müssen die passenden
// Setter aufgerufen werden. Vorher war der Store eine UI-State-Insel.

describe("mapMacroValue – lineare Interpolation", () => {
  const b = (minValue: number, maxValue: number): MacroBinding => ({
    id: "bx",
    target: "bpm",
    minValue,
    maxValue,
  });

  it("liefert minValue bei 0", () => {
    expect(mapMacroValue(b(80, 160), 0)).toBe(80);
  });

  it("liefert maxValue bei 1", () => {
    expect(mapMacroValue(b(80, 160), 1)).toBe(160);
  });

  it("interpoliert linear in der Mitte", () => {
    expect(mapMacroValue(b(80, 160), 0.5)).toBe(120);
  });

  it("klemmt input <0 auf 0", () => {
    expect(mapMacroValue(b(80, 160), -0.5)).toBe(80);
  });

  it("klemmt input >1 auf 1", () => {
    expect(mapMacroValue(b(80, 160), 1.5)).toBe(160);
  });

  it("funktioniert mit invertiertem Bereich (max < min)", () => {
    // z.B. negativer Pan
    expect(mapMacroValue(b(1, -1), 0)).toBe(1);
    expect(mapMacroValue(b(1, -1), 1)).toBe(-1);
    expect(mapMacroValue(b(1, -1), 0.5)).toBe(0);
  });

  it("funktioniert mit Floating-Point-Range (z.B. send 0..0.85)", () => {
    expect(mapMacroValue(b(0, 0.85), 0.4)).toBeCloseTo(0.34);
  });
});

describe("applyMacroBindings – Audio-Routing", () => {
  function makeMacro(bindings: MacroBinding[]): Macro {
    return {
      index: 0,
      label: "Test",
      value: 0,
      bindings,
      color: "#fff",
    };
  }

  function makeBinding(overrides: Partial<MacroBinding>): MacroBinding {
    return {
      id: "b1",
      target: "master-vol",
      minValue: 0,
      maxValue: 1,
      ...overrides,
    };
  }

  it("ruft setMasterVolume mit gemapptem Wert auf", () => {
    const calls: number[] = [];
    const setters: MacroRouteSetters = {
      setMasterVolume: (v) => calls.push(v),
    };
    const macro = makeMacro([makeBinding({ target: "master-vol", minValue: 0, maxValue: 1 })]);
    applyMacroBindings(macro, 0.5, setters);
    expect(calls).toEqual([0.5]);
  });

  it("ruft setBpm mit gerundetem Wert auf (Math.round)", () => {
    const calls: number[] = [];
    const setters: MacroRouteSetters = {
      setBpm: (v) => calls.push(v),
    };
    const macro = makeMacro([makeBinding({ target: "bpm", minValue: 80, maxValue: 160 })]);
    applyMacroBindings(macro, 0.5, setters);
    expect(calls).toEqual([120]);
    applyMacroBindings(macro, 0.123, setters);
    // 80 + 0.123 * 80 = 89.84 → 90
    expect(calls[1]).toBe(90);
  });

  it("ruft setChannelVolume mit partId auf, wenn target=channel-vol", () => {
    const calls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setChannelVolume: (id, v) => calls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "channel-vol", partId: "kick-1", minValue: 0, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0.7, setters);
    expect(calls).toEqual([["kick-1", 0.7]]);
  });

  it("ruft setChannelPan korrekt mit partId und mapped Wert auf (-1..1)", () => {
    const calls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setChannelPan: (id, v) => calls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "channel-pan", partId: "snare", minValue: -1, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0, setters);
    applyMacroBindings(macro, 0.5, setters);
    applyMacroBindings(macro, 1, setters);
    expect(calls).toEqual([
      ["snare", -1],
      ["snare", 0],
      ["snare", 1],
    ]);
  });

  it("ruft setChannelSend mit korrektem Bus auf (reverb)", () => {
    const calls: Array<[string, string, number]> = [];
    const setters: MacroRouteSetters = {
      setChannelSend: (id, bus, v) => calls.push([id, bus, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "channel-send-rev", partId: "hat", minValue: 0, maxValue: 0.5 }),
    ]);
    applyMacroBindings(macro, 1, setters);
    expect(calls).toEqual([["hat", "reverb", 0.5]]);
  });

  it("ruft setChannelSend mit korrektem Bus auf (delay)", () => {
    const calls: Array<[string, string, number]> = [];
    const setters: MacroRouteSetters = {
      setChannelSend: (id, bus, v) => calls.push([id, bus, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "channel-send-dly", partId: "perc", minValue: 0, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0.25, setters);
    expect(calls).toEqual([["perc", "delay", 0.25]]);
  });

  it("propagiert ein Macro mit MEHREREN Bindings an alle Setter", () => {
    const masterCalls: number[] = [];
    const bpmCalls: number[] = [];
    const volCalls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setMasterVolume: (v) => masterCalls.push(v),
      setBpm: (v) => bpmCalls.push(v),
      setChannelVolume: (id, v) => volCalls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ id: "b1", target: "master-vol", minValue: 0, maxValue: 1 }),
      makeBinding({ id: "b2", target: "bpm", minValue: 100, maxValue: 200 }),
      makeBinding({ id: "b3", target: "channel-vol", partId: "kick", minValue: 0, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0.5, setters);
    expect(masterCalls).toEqual([0.5]);
    expect(bpmCalls).toEqual([150]);
    expect(volCalls).toEqual([["kick", 0.5]]);
  });

  it("ignoriert channel-* Bindings ohne partId stillschweigend", () => {
    const calls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setChannelVolume: (id, v) => calls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "channel-vol", partId: undefined, minValue: 0, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0.5, setters);
    expect(calls).toEqual([]);
  });

  it("ist no-op wenn macro keine Bindings hat", () => {
    let called = false;
    const setters: MacroRouteSetters = {
      setMasterVolume: () => { called = true; },
    };
    applyMacroBindings(makeMacro([]), 0.5, setters);
    expect(called).toBe(false);
  });

  it("ist no-op wenn ein Setter fehlt (kein Crash, kein Aufruf)", () => {
    const macro = makeMacro([
      makeBinding({ target: "master-vol", minValue: 0, maxValue: 1 }),
    ]);
    // Empty setters — Funktion darf nicht werfen
    expect(() => applyMacroBindings(macro, 0.5, {})).not.toThrow();
  });

  it("ruft onUnhandled für lfo-rate auf, solange setLfoRate fehlt", () => {
    const unhandled: MacroBinding[] = [];
    const setters: MacroRouteSetters = {
      onUnhandled: (b) => unhandled.push(b),
    };
    const macro = makeMacro([
      makeBinding({ target: "lfo-rate", partId: "lead", minValue: 0.1, maxValue: 20 }),
    ]);
    applyMacroBindings(macro, 0.5, setters);
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0].target).toBe("lfo-rate");
  });

  it("ruft setLfoRate auf, wenn vorhanden (statt onUnhandled)", () => {
    const unhandled: MacroBinding[] = [];
    const lfoCalls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setLfoRate: (id, v) => lfoCalls.push([id, v]),
      onUnhandled: (b) => unhandled.push(b),
    };
    const macro = makeMacro([
      makeBinding({ target: "lfo-rate", partId: "lead", minValue: 0, maxValue: 10 }),
    ]);
    applyMacroBindings(macro, 1, setters);
    expect(lfoCalls).toEqual([["lead", 10]]);
    expect(unhandled).toHaveLength(0);
  });
});

// ─── Integrationstest: store + routing zusammen (TASK-100) ───────────────────
// Verifiziert, dass setMacroValue() ein Event dispatcht, dessen Detail-Wert
// von applyMacroBindings auf die richtigen Setter geroutet wird. Simuliert
// damit was App.tsx tatsächlich tut, ohne React-Render zu brauchen.

describe("Macro → Audio Routing (End-to-End ohne DOM)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("setMacroValue → CustomEvent → applyMacroBindings → AudioEngine-Mock", () => {
    // 1. Setup: Macro 0 bekommt eine Binding auf Master-Volume (Range 0..1)
    addMacroBinding(0, {
      target: "master-vol",
      minValue: 0,
      maxValue: 1,
    });

    // 2. Mock AudioEngine + Setters
    const masterCalls: number[] = [];
    const setters: MacroRouteSetters = {
      setMasterVolume: (v) => masterCalls.push(v),
    };

    // 3. Simuliere App.tsx Subscriber: lies Event-Detail, hole macro, route
    const handler = (detail: { index: number; value: number }) => {
      const macro = getMacros()[detail.index];
      applyMacroBindings(macro, detail.value, setters);
    };

    // 4. setMacroValue dispatcht ein 'macro:change' Event
    setMacroValue(0, 0.42);
    const ev = dispatched[dispatched.length - 1];
    expect(ev.type).toBe("macro:change");
    handler(ev.detail as { index: number; value: number });

    // 5. Routing-Verifikation: 0.42 erreicht den Setter
    expect(masterCalls).toEqual([0.42]);
  });

  it("BPM-Binding routet gerundete BPM (80..160 @ 0.5 → 120)", () => {
    addMacroBinding(1, {
      target: "bpm",
      minValue: 80,
      maxValue: 160,
    });
    const bpmCalls: number[] = [];
    const setters: MacroRouteSetters = { setBpm: (v) => bpmCalls.push(v) };

    setMacroValue(1, 0.5);
    const ev = dispatched[dispatched.length - 1];
    const detail = ev.detail as { index: number; value: number };
    applyMacroBindings(getMacros()[detail.index], detail.value, setters);
    expect(bpmCalls).toEqual([120]);
  });

  it("channel-vol routet auf richtige partId mit korrektem Volume", () => {
    addMacroBinding(2, {
      target: "channel-vol",
      partId: "kick-id-xyz",
      partName: "Kick",
      minValue: 0,
      maxValue: 1,
    });
    const volCalls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setChannelVolume: (id, v) => volCalls.push([id, v]),
    };

    setMacroValue(2, 0.8);
    const ev = dispatched[dispatched.length - 1];
    const detail = ev.detail as { index: number; value: number };
    applyMacroBindings(getMacros()[detail.index], detail.value, setters);
    expect(volCalls).toEqual([["kick-id-xyz", 0.8]]);
  });
});

// ─── Button-Mode (TASK-103 / C3) ─────────────────────────────────────────────
// Erweitert das Macro-Schema um discriminated union "knob" | "button":
//   - Default-Modus aus alten localStorage-Daten ist "knob"
//   - setMacroMode wechselt zwischen Modi, ohne bindings/scriptId zu löschen
//   - setMacroScriptId hängt ein Script an (für Button-Mode)
//   - triggerMacroButton dispatcht macro:button:trigger Event
//   - Persistenz-Round-Trip mit mode + scriptId

describe("Macro – Button-Mode Schema-Erweiterung", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("Default-Modus aller Macros ist 'knob'", () => {
    const all = getMacros();
    all.forEach(m => expect(m.mode).toBe("knob"));
  });

  it("setMacroMode wechselt auf 'button' und persistiert", () => {
    setMacroMode(0, "button");
    expect(getMacros()[0].mode).toBe("button");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as Macro[];
    expect(parsed[0].mode).toBe("button");
  });

  it("setMacroMode 'knob' → 'button' LÖSCHT NICHT die existing bindings", () => {
    addMacroBinding(0, {
      target: "master-vol",
      minValue: 0,
      maxValue: 1,
    });
    expect(getMacros()[0].bindings).toHaveLength(1);
    setMacroMode(0, "button");
    expect(getMacros()[0].mode).toBe("button");
    expect(getMacros()[0].bindings).toHaveLength(1); // defensiv preserviert
  });

  it("setMacroMode 'button' → 'knob' LÖSCHT NICHT die scriptId", () => {
    setMacroMode(0, "button");
    setMacroScriptId(0, "sc-test-1");
    expect(getMacros()[0].scriptId).toBe("sc-test-1");
    setMacroMode(0, "knob");
    expect(getMacros()[0].mode).toBe("knob");
    expect(getMacros()[0].scriptId).toBe("sc-test-1");
  });

  it("setMacroMode ist no-op bei out-of-range index", () => {
    setMacroMode(-1, "button");
    setMacroMode(99, "button");
    getMacros().forEach(m => expect(m.mode).toBe("knob"));
  });

  it("setMacroMode ist no-op bei invalid mode-string", () => {
    setMacroMode(0, "knob");
    // Mit Cast um TS zu umgehen — Laufzeit-Robustheit
    setMacroMode(0, "invalid" as unknown as "button");
    expect(getMacros()[0].mode).toBe("knob");
  });

  it("setMacroScriptId setzt die scriptId und persistiert", () => {
    setMacroScriptId(2, "sc-abc-123");
    expect(getMacros()[2].scriptId).toBe("sc-abc-123");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as Macro[];
    expect(parsed[2].scriptId).toBe("sc-abc-123");
  });

  it("setMacroScriptId(null) entfernt die scriptId", () => {
    setMacroScriptId(2, "sc-abc-123");
    expect(getMacros()[2].scriptId).toBe("sc-abc-123");
    setMacroScriptId(2, null);
    expect(getMacros()[2].scriptId).toBeUndefined();
  });

  it("setMacroScriptId ist no-op bei out-of-range index", () => {
    setMacroScriptId(-1, "sc-x");
    setMacroScriptId(99, "sc-x");
    getMacros().forEach(m => expect(m.scriptId).toBeUndefined());
  });
});

describe("triggerMacroButton – Event-Dispatch", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("dispatcht 'macro:button:trigger' wenn mode=button + scriptId gesetzt", () => {
    setMacroMode(3, "button");
    setMacroScriptId(3, "sc-button-1");
    const result = triggerMacroButton(3);
    expect(result).toBe("sc-button-1");
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({ macroIndex: 3, scriptId: "sc-button-1" });
  });

  it("ist no-op wenn mode=knob (kein Event)", () => {
    setMacroScriptId(0, "sc-1");
    // mode bleibt knob (default)
    const result = triggerMacroButton(0);
    expect(result).toBeNull();
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeUndefined();
  });

  it("ist no-op wenn mode=button aber keine scriptId", () => {
    setMacroMode(1, "button");
    const result = triggerMacroButton(1);
    expect(result).toBeNull();
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeUndefined();
  });

  it("ist no-op bei out-of-range index", () => {
    expect(triggerMacroButton(-1)).toBeNull();
    expect(triggerMacroButton(99)).toBeNull();
    expect(dispatched.find(d => d.type === "macro:button:trigger")).toBeUndefined();
  });
});

// ─── Migration: Old-Format Compat (TASK-103 / C3) ────────────────────────────
// Dieser Test verifiziert, dass localStorage-Daten ohne `mode`-Feld (pre-v1.16)
// beim Laden auf mode="knob" defaulten. Da der Store ein Module-Singleton ist
// und Load nur einmal beim Modul-Import passiert, dynImporten wir das Modul
// neu mit vi.resetModules.

describe("Macro – Persistence Migration (Old-Format Compat)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
  });

  it("alte Daten OHNE mode-Feld defaulten auf 'knob' beim Load", async () => {
    // Schreibe pre-v1.16 Format: keine mode/triggerMode/scriptId Felder.
    const oldFormat = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      label: `Macro ${i + 1}`,
      value: 0,
      bindings: [],
      color: MACRO_COLORS[i],
      // mode FEHLT
      // triggerMode FEHLT
    }));
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(oldFormat));

    // Modul neu laden, damit load() den Storage neu liest.
    vi.resetModules();
    const reimported = await import("../../client/src/store/useMacroStore");
    const macros = reimported.getMacros();
    expect(macros).toHaveLength(8);
    macros.forEach(m => {
      expect(m.mode).toBe("knob");
      expect(m.triggerMode).toBe("edge");
      expect(m.scriptId).toBeUndefined();
    });
  });

  it("addMacro mit mode='button' + scriptId überlebt einen Reload-Roundtrip", async () => {
    // 1. Lade Modul + setze einen Button-Macro
    vi.resetModules();
    const m1 = await import("../../client/src/store/useMacroStore");
    m1.resetMacros();
    m1.setMacroMode(4, "button");
    m1.setMacroScriptId(4, "sc-persist-xyz");

    // 2. Simuliere Neuladen: Modul-Cache wegwerfen, Store re-import.
    vi.resetModules();
    const m2 = await import("../../client/src/store/useMacroStore");
    const reloaded = m2.getMacros();
    expect(reloaded[4].mode).toBe("button");
    expect(reloaded[4].scriptId).toBe("sc-persist-xyz");
  });

  it("invalides mode-Feld (z.B. 'foo') wird auf 'knob' korrigiert", async () => {
    const corrupted = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      label: `Macro ${i + 1}`,
      value: 0,
      bindings: [],
      color: MACRO_COLORS[i],
      mode: i === 0 ? "foo" : "knob", // erstes mode kaputt
    }));
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(corrupted));
    vi.resetModules();
    const reimported = await import("../../client/src/store/useMacroStore");
    const macros = reimported.getMacros();
    expect(macros[0].mode).toBe("knob");
  });
});

// ─── Trigger-Kind: Script vs Pad (TASK-112 / v1.20.x) ────────────────────────
// Erweitert die Button-Mode discriminated union um triggerKind="script"|"pad"
// (Default "script" für Backwards-Compat) und padIndex (0..15).
//
//   - setMacroTriggerKind(idx, "pad") setzt das Feld und persistiert.
//   - setMacroPadIndex(idx, 0..15) setzt einen Pad-Index.
//   - setMacroPadIndex(idx, null) löscht den Pad-Index.
//   - setMacroPadIndex out-of-range / non-integer → no-op.
//   - triggerMacroButton (mode=button + triggerKind=pad + padIndex set) dispatcht
//     macro:button:trigger mit { macroIndex, triggerKind, scriptId?, padIndex }.

describe("Macro – Trigger-Kind Schema (Script vs Pad)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("Default-triggerKind aller Macros ist 'script'", () => {
    const all = getMacros();
    all.forEach(m => expect(m.triggerKind).toBe("script"));
  });

  it("setMacroTriggerKind wechselt auf 'pad' und persistiert", () => {
    setMacroTriggerKind(0, "pad");
    expect(getMacros()[0].triggerKind).toBe("pad");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Macro[];
    expect(parsed[0].triggerKind).toBe("pad");
  });

  it("setMacroTriggerKind wechselt 'pad' → 'script' zurück, padIndex bleibt erhalten", () => {
    setMacroTriggerKind(2, "pad");
    setMacroPadIndex(2, 5);
    expect(getMacros()[2].padIndex).toBe(5);
    setMacroTriggerKind(2, "script");
    expect(getMacros()[2].triggerKind).toBe("script");
    // Defensiv preserviert (kein Datenverlust beim Hin- und Her-Wechsel)
    expect(getMacros()[2].padIndex).toBe(5);
  });

  it("setMacroTriggerKind ist no-op bei out-of-range index", () => {
    setMacroTriggerKind(-1, "pad");
    setMacroTriggerKind(99, "pad");
    getMacros().forEach(m => expect(m.triggerKind).toBe("script"));
  });

  it("setMacroTriggerKind ist no-op bei invalid kind-string", () => {
    setMacroTriggerKind(0, "script");
    setMacroTriggerKind(0, "invalid" as unknown as "pad");
    expect(getMacros()[0].triggerKind).toBe("script");
  });

  it("setMacroPadIndex setzt padIndex und persistiert", () => {
    setMacroPadIndex(3, 7);
    expect(getMacros()[3].padIndex).toBe(7);
    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as Macro[];
    expect(parsed[3].padIndex).toBe(7);
  });

  it("setMacroPadIndex(idx, null) entfernt padIndex (→ undefined)", () => {
    setMacroPadIndex(3, 7);
    expect(getMacros()[3].padIndex).toBe(7);
    setMacroPadIndex(3, null);
    expect(getMacros()[3].padIndex).toBeUndefined();
  });

  it("setMacroPadIndex ist no-op bei out-of-range padIndex (>=16)", () => {
    setMacroPadIndex(0, 99);
    expect(getMacros()[0].padIndex).toBeUndefined();
    setMacroPadIndex(0, 16); // genau auf Grenze
    expect(getMacros()[0].padIndex).toBeUndefined();
  });

  it("setMacroPadIndex ist no-op bei negativen padIndex", () => {
    setMacroPadIndex(0, -1);
    expect(getMacros()[0].padIndex).toBeUndefined();
  });

  it("setMacroPadIndex ist no-op bei non-integer padIndex", () => {
    setMacroPadIndex(0, 2.5);
    expect(getMacros()[0].padIndex).toBeUndefined();
    setMacroPadIndex(0, NaN);
    expect(getMacros()[0].padIndex).toBeUndefined();
  });

  it("setMacroPadIndex ist no-op bei out-of-range macroIndex", () => {
    setMacroPadIndex(-1, 3);
    setMacroPadIndex(99, 3);
    getMacros().forEach(m => expect(m.padIndex).toBeUndefined());
  });

  it("setMacroPadIndex akzeptiert beide Grenzen 0 und 15", () => {
    setMacroPadIndex(0, 0);
    expect(getMacros()[0].padIndex).toBe(0);
    setMacroPadIndex(0, 15);
    expect(getMacros()[0].padIndex).toBe(15);
  });
});

describe("triggerMacroButton – Pad-Mode", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("dispatcht 'macro:button:trigger' mit triggerKind='pad' + padIndex", () => {
    setMacroMode(2, "button");
    setMacroTriggerKind(2, "pad");
    setMacroPadIndex(2, 4);
    const result = triggerMacroButton(2);
    expect(result).toBe("pad:4");
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({
      macroIndex: 2,
      triggerKind: "pad",
      padIndex: 4,
    });
  });

  it("ist no-op wenn triggerKind='pad' aber padIndex fehlt", () => {
    setMacroMode(0, "button");
    setMacroTriggerKind(0, "pad");
    // padIndex bewusst NICHT gesetzt
    const result = triggerMacroButton(0);
    expect(result).toBeNull();
    expect(dispatched.find(d => d.type === "macro:button:trigger")).toBeUndefined();
  });

  it("ist no-op wenn mode='knob' obwohl triggerKind='pad' gesetzt", () => {
    setMacroTriggerKind(0, "pad");
    setMacroPadIndex(0, 3);
    // mode bleibt "knob" (default)
    const result = triggerMacroButton(0);
    expect(result).toBeNull();
    expect(dispatched.find(d => d.type === "macro:button:trigger")).toBeUndefined();
  });

  it("Script-Mode Event enthält weiterhin scriptId + triggerKind='script'", () => {
    setMacroMode(1, "button");
    // triggerKind bleibt "script" (default)
    setMacroScriptId(1, "sc-abc-999");
    const result = triggerMacroButton(1);
    expect(result).toBe("sc-abc-999");
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({
      macroIndex: 1,
      triggerKind: "script",
      scriptId: "sc-abc-999",
    });
  });

  it("Pad-Mode-Event enthält weiterhin scriptId NICHT zwingend (kann undefined sein)", () => {
    setMacroMode(0, "button");
    setMacroTriggerKind(0, "pad");
    setMacroPadIndex(0, 7);
    triggerMacroButton(0);
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeDefined();
    const detail = ev!.detail as { scriptId?: string; padIndex: number };
    expect(detail.padIndex).toBe(7);
    expect(detail.scriptId).toBeUndefined();
  });

  it("Wechsel pad → script ohne scriptId macht trigger zu no-op", () => {
    setMacroMode(0, "button");
    setMacroTriggerKind(0, "pad");
    setMacroPadIndex(0, 1);
    dispatched.length = 0;
    setMacroTriggerKind(0, "script");
    // jetzt fehlt scriptId, trotz padIndex
    const result = triggerMacroButton(0);
    expect(result).toBeNull();
    expect(dispatched.find(d => d.type === "macro:button:trigger")).toBeUndefined();
  });
});

describe("Macro – Pad-Mode Persistence + Migration", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
  });

  it("triggerKind + padIndex überleben einen Reload-Roundtrip", async () => {
    vi.resetModules();
    const m1 = await import("../../client/src/store/useMacroStore");
    m1.resetMacros();
    m1.setMacroMode(5, "button");
    m1.setMacroTriggerKind(5, "pad");
    m1.setMacroPadIndex(5, 11);

    vi.resetModules();
    const m2 = await import("../../client/src/store/useMacroStore");
    const reloaded = m2.getMacros();
    expect(reloaded[5].mode).toBe("button");
    expect(reloaded[5].triggerKind).toBe("pad");
    expect(reloaded[5].padIndex).toBe(11);
  });

  it("alte v1.17-Daten OHNE triggerKind defaulten auf 'script'", async () => {
    // Schreibe v1.17 Button-Format: mode="button" + scriptId, KEIN triggerKind/padIndex.
    const v117Format = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      label: `Macro ${i + 1}`,
      value: 0,
      bindings: [],
      color: MACRO_COLORS[i],
      mode: i === 0 ? "button" : "knob",
      scriptId: i === 0 ? "sc-legacy-xyz" : undefined,
      // triggerKind FEHLT
      // padIndex FEHLT
    }));
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v117Format));

    vi.resetModules();
    const reimported = await import("../../client/src/store/useMacroStore");
    const macros = reimported.getMacros();
    macros.forEach(m => {
      expect(m.triggerKind).toBe("script");
      expect(m.padIndex).toBeUndefined();
    });
    // ScriptId überlebt unverändert
    expect(macros[0].scriptId).toBe("sc-legacy-xyz");
  });

  it("invalides triggerKind (z.B. 'foo') wird beim Load auf 'script' korrigiert", async () => {
    const corrupted = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      label: `Macro ${i + 1}`,
      value: 0,
      bindings: [],
      color: MACRO_COLORS[i],
      mode: "button",
      triggerKind: i === 0 ? "foo" : "pad",
      padIndex: i === 0 ? 99 : 3, // erstes padIndex out-of-range
    }));
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(corrupted));

    vi.resetModules();
    const reimported = await import("../../client/src/store/useMacroStore");
    const macros = reimported.getMacros();
    expect(macros[0].triggerKind).toBe("script");
    expect(macros[0].padIndex).toBeUndefined(); // out-of-range gefiltert
    expect(macros[1].triggerKind).toBe("pad");
    expect(macros[1].padIndex).toBe(3);
  });

  it("non-integer padIndex (z.B. 2.5) wird beim Load auf undefined gesetzt", async () => {
    const data = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      label: `Macro ${i + 1}`,
      value: 0,
      bindings: [],
      color: MACRO_COLORS[i],
      mode: "button",
      triggerKind: "pad",
      padIndex: i === 0 ? 2.5 : 7,
    }));
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));

    vi.resetModules();
    const reimported = await import("../../client/src/store/useMacroStore");
    const macros = reimported.getMacros();
    expect(macros[0].padIndex).toBeUndefined();
    expect(macros[1].padIndex).toBe(7);
  });
});
