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
  setMacroTriggerMode,
  setMacroPadIndex,
  triggerMacroButton,
  triggerMacroButtonRelease,
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

  // ─── LFO-Rate/Depth (TASK-117) ──────────────────────────────────────────────

  it("setLfoRate erhält gemappten Wert (min=1, max=10 @ 0.5 → 5.5)", () => {
    const lfoCalls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setLfoRate: (id, v) => lfoCalls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "lfo-rate", partId: "k", minValue: 1, maxValue: 10 }),
    ]);
    applyMacroBindings(macro, 0.5, setters);
    expect(lfoCalls).toEqual([["k", 5.5]]);
  });

  it("setLfoDepth erhält gemappten Wert (min=0, max=0.8 @ 1 → 0.8)", () => {
    const lfoCalls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setLfoDepth: (id, v) => lfoCalls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "lfo-depth", partId: "k", minValue: 0, maxValue: 0.8 }),
    ]);
    applyMacroBindings(macro, 1, setters);
    expect(lfoCalls).toEqual([["k", 0.8]]);
  });

  it("setLfoDepth interpoliert in der Mitte (0..1 @ 0.5 → 0.5)", () => {
    const lfoCalls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setLfoDepth: (id, v) => lfoCalls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "lfo-depth", partId: "lead", minValue: 0, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0.5, setters);
    expect(lfoCalls).toEqual([["lead", 0.5]]);
  });

  it("lfo-depth fällt zurück auf onUnhandled, wenn setLfoDepth fehlt (Backwards-Compat)", () => {
    const unhandled: MacroBinding[] = [];
    const setters: MacroRouteSetters = {
      onUnhandled: (b) => unhandled.push(b),
    };
    const macro = makeMacro([
      makeBinding({ target: "lfo-depth", partId: "lead", minValue: 0, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0.7, setters);
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0].target).toBe("lfo-depth");
  });

  it("lfo-rate/lfo-depth ohne partId werden stillschweigend ignoriert", () => {
    const lfoRateCalls: Array<[string, number]> = [];
    const lfoDepthCalls: Array<[string, number]> = [];
    const setters: MacroRouteSetters = {
      setLfoRate: (id, v) => lfoRateCalls.push([id, v]),
      setLfoDepth: (id, v) => lfoDepthCalls.push([id, v]),
    };
    const macro = makeMacro([
      makeBinding({ target: "lfo-rate", partId: undefined, minValue: 0, maxValue: 10 }),
      makeBinding({ target: "lfo-depth", partId: undefined, minValue: 0, maxValue: 1 }),
    ]);
    applyMacroBindings(macro, 0.5, setters);
    expect(lfoRateCalls).toEqual([]);
    expect(lfoDepthCalls).toEqual([]);
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

// ─── Trigger-Mode: Edge vs Hold (TASK-118 / v1.22.0) ─────────────────────────
// Erweitert das Schema um triggerMode="edge"|"hold" (Default "edge" für
// Backwards-Compat zu pre-v1.22-Daten).
//
//   - Default-triggerMode aller Macros ist "edge".
//   - setMacroTriggerMode(idx, "hold") setzt das Feld und persistiert.
//   - setMacroTriggerMode out-of-range / invalid → no-op.
//   - Persistence-Round-Trip mit hold überlebt Reload.
//   - Migration: alte Daten ohne triggerMode → "edge".
//   - Migration: invalides triggerMode (z.B. "loop") → "edge".
//   - triggerMacroButton-Event-Detail enthält triggerMode.
//   - triggerMacroButtonRelease dispatcht macro:button:release Event.

describe("Macro – Trigger-Mode Schema (Edge vs Hold)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("Default-triggerMode aller Macros ist 'edge'", () => {
    const all = getMacros();
    all.forEach(m => expect(m.triggerMode).toBe("edge"));
  });

  it("setMacroTriggerMode wechselt auf 'hold' und persistiert", () => {
    setMacroTriggerMode(0, "hold");
    expect(getMacros()[0].triggerMode).toBe("hold");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Macro[];
    expect(parsed[0].triggerMode).toBe("hold");
  });

  it("setMacroTriggerMode wechselt 'hold' → 'edge' zurück und persistiert", () => {
    setMacroTriggerMode(1, "hold");
    expect(getMacros()[1].triggerMode).toBe("hold");
    setMacroTriggerMode(1, "edge");
    expect(getMacros()[1].triggerMode).toBe("edge");
  });

  it("setMacroTriggerMode ist no-op bei out-of-range index", () => {
    setMacroTriggerMode(-1, "hold");
    setMacroTriggerMode(99, "hold");
    getMacros().forEach(m => expect(m.triggerMode).toBe("edge"));
  });

  it("setMacroTriggerMode ist no-op bei invalid mode-string", () => {
    setMacroTriggerMode(0, "edge");
    setMacroTriggerMode(0, "invalid" as unknown as "hold");
    expect(getMacros()[0].triggerMode).toBe("edge");
    setMacroTriggerMode(0, "loop" as unknown as "hold");
    expect(getMacros()[0].triggerMode).toBe("edge");
  });

  it("setMacroTriggerMode beeinflusst andere Felder nicht (Defensiv-Test)", () => {
    setMacroMode(0, "button");
    setMacroTriggerKind(0, "pad");
    setMacroPadIndex(0, 4);
    setMacroTriggerMode(0, "hold");
    const m = getMacros()[0];
    expect(m.mode).toBe("button");
    expect(m.triggerKind).toBe("pad");
    expect(m.padIndex).toBe(4);
    expect(m.triggerMode).toBe("hold");
  });
});

describe("triggerMacroButton – Hold-Mode-Event-Detail", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("triggerMacroButton dispatcht Event mit triggerMode='hold' für Script", () => {
    setMacroMode(0, "button");
    setMacroScriptId(0, "sc-hold-script");
    setMacroTriggerMode(0, "hold");
    triggerMacroButton(0);
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({
      macroIndex: 0,
      triggerKind: "script",
      triggerMode: "hold",
      scriptId: "sc-hold-script",
    });
  });

  it("triggerMacroButton dispatcht Event mit triggerMode='hold' für Pad", () => {
    setMacroMode(1, "button");
    setMacroTriggerKind(1, "pad");
    setMacroPadIndex(1, 9);
    setMacroTriggerMode(1, "hold");
    triggerMacroButton(1);
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({
      macroIndex: 1,
      triggerKind: "pad",
      triggerMode: "hold",
      padIndex: 9,
    });
  });

  it("triggerMacroButton dispatcht Event mit triggerMode='edge' als Default (Backwards-Compat)", () => {
    setMacroMode(2, "button");
    setMacroScriptId(2, "sc-edge-default");
    // triggerMode NICHT gesetzt
    triggerMacroButton(2);
    const ev = dispatched.find(d => d.type === "macro:button:trigger");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({
      macroIndex: 2,
      triggerMode: "edge",
    });
  });
});

describe("triggerMacroButtonRelease – Release-Event", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
    resetMacros();
  });

  it("dispatcht 'macro:button:release' Event mit korrektem macroIndex", () => {
    triggerMacroButtonRelease(3);
    const ev = dispatched.find(d => d.type === "macro:button:release");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({ macroIndex: 3 });
  });

  it("dispatcht Release-Event auch bei nicht-Hold-Mode (App.tsx prüft selbst)", () => {
    // Hier ist macro nicht im Hold-Mode, aber Release wird trotzdem gefeuert.
    // Die Logik in App.tsx macht ohne aktive Loop selbst no-op.
    setMacroMode(0, "button");
    setMacroScriptId(0, "sc-x");
    triggerMacroButtonRelease(0);
    const ev = dispatched.find(d => d.type === "macro:button:release");
    expect(ev).toBeDefined();
    expect(ev!.detail).toMatchObject({ macroIndex: 0 });
  });

  it("ist no-op bei out-of-range index (kein Event)", () => {
    triggerMacroButtonRelease(-1);
    triggerMacroButtonRelease(99);
    expect(dispatched.find(d => d.type === "macro:button:release")).toBeUndefined();
  });

  it("fired Release dispatched genau ein Event pro Aufruf (nicht stacking)", () => {
    triggerMacroButtonRelease(0);
    triggerMacroButtonRelease(0);
    triggerMacroButtonRelease(0);
    const events = dispatched.filter(d => d.type === "macro:button:release");
    expect(events).toHaveLength(3);
    events.forEach(e => expect(e.detail).toMatchObject({ macroIndex: 0 }));
  });
});

describe("Macro – Hold-Mode Persistence + Migration", () => {
  beforeEach(() => {
    localStorageMock.clear();
    dispatched.length = 0;
  });

  it("triggerMode='hold' überlebt einen Reload-Roundtrip", async () => {
    vi.resetModules();
    const m1 = await import("../../client/src/store/useMacroStore");
    m1.resetMacros();
    m1.setMacroMode(3, "button");
    m1.setMacroScriptId(3, "sc-hold-persist");
    m1.setMacroTriggerMode(3, "hold");

    vi.resetModules();
    const m2 = await import("../../client/src/store/useMacroStore");
    const reloaded = m2.getMacros();
    expect(reloaded[3].mode).toBe("button");
    expect(reloaded[3].triggerMode).toBe("hold");
    expect(reloaded[3].scriptId).toBe("sc-hold-persist");
  });

  it("alte Daten OHNE triggerMode defaulten auf 'edge' (Backwards-Compat zu v1.21)", async () => {
    // Schreibe v1.21 Button-Format: mode="button" + scriptId, KEIN triggerMode.
    const v121Format = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      label: `Macro ${i + 1}`,
      value: 0,
      bindings: [],
      color: MACRO_COLORS[i],
      mode: i === 0 ? "button" : "knob",
      scriptId: i === 0 ? "sc-v121-legacy" : undefined,
      triggerKind: "script",
      // triggerMode FEHLT
    }));
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v121Format));

    vi.resetModules();
    const reimported = await import("../../client/src/store/useMacroStore");
    const macros = reimported.getMacros();
    macros.forEach(m => {
      expect(m.triggerMode).toBe("edge");
    });
    expect(macros[0].scriptId).toBe("sc-v121-legacy");
  });

  it("invalides triggerMode (z.B. 'loop') wird beim Load auf 'edge' korrigiert", async () => {
    const corrupted = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      label: `Macro ${i + 1}`,
      value: 0,
      bindings: [],
      color: MACRO_COLORS[i],
      mode: "button",
      triggerMode: i === 0 ? "loop" : (i === 1 ? "hold" : "edge"),
    }));
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(corrupted));

    vi.resetModules();
    const reimported = await import("../../client/src/store/useMacroStore");
    const macros = reimported.getMacros();
    expect(macros[0].triggerMode).toBe("edge"); // "loop" → "edge"
    expect(macros[1].triggerMode).toBe("hold"); // legit hold
    expect(macros[2].triggerMode).toBe("edge"); // legit edge
  });
});

// ─── Hold-Loop Utility Tests (TASK-118) ──────────────────────────────────────
// Die Hold-Loop selbst lebt in client/src/utils/macroHoldLoop.ts. Wir testen
// hier nur die Public API + No-Stacking-Garantie mit injiziertem Scheduler.

describe("macroHoldLoop – Pure-Logik-Helfer", () => {
  beforeEach(() => {
    // Helfer hat Module-State (eine Map); zwischen Tests aufräumen
  });

  function createMockScheduler() {
    let nextId = 1;
    const tasks = new Map<number, { fn: () => void; ms: number }>();
    return {
      scheduler: {
        setInterval: (fn: () => void, ms: number) => {
          const id = nextId++;
          tasks.set(id, { fn, ms });
          return id;
        },
        clearInterval: (handle: unknown) => {
          tasks.delete(handle as number);
        },
      },
      /** Triggert ein "Tick" für alle aktiven Tasks. */
      tick: () => {
        for (const { fn } of Array.from(tasks.values())) {
          fn();
        }
      },
      activeTaskCount: () => tasks.size,
    };
  }

  it("startHoldLoop ruft run() sofort einmal auf (erste Iteration)", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    mod.stopAllHoldLoops();
    const { scheduler } = createMockScheduler();
    const calls: number[] = [];
    mod.startHoldLoop(0, () => calls.push(Date.now()), 200, scheduler);
    expect(calls).toHaveLength(1);
    mod.stopAllHoldLoops(scheduler);
  });

  it("Folge-Iterationen werden via Scheduler getriggert", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    mod.stopAllHoldLoops();
    const { scheduler, tick } = createMockScheduler();
    const calls: string[] = [];
    mod.startHoldLoop(0, () => calls.push("run"), 200, scheduler);
    // Nach Start: 1 sofortiger Call
    expect(calls).toHaveLength(1);
    tick();
    expect(calls).toHaveLength(2);
    tick();
    tick();
    expect(calls).toHaveLength(4);
    mod.stopAllHoldLoops(scheduler);
  });

  it("No-Stacking: zweiter startHoldLoop für selben Index ersetzt den ersten", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    mod.stopAllHoldLoops();
    const { scheduler, activeTaskCount } = createMockScheduler();
    mod.startHoldLoop(0, () => {}, 200, scheduler);
    expect(activeTaskCount()).toBe(1);
    mod.startHoldLoop(0, () => {}, 200, scheduler);
    expect(activeTaskCount()).toBe(1); // alte Loop wurde gestoppt
    mod.stopAllHoldLoops(scheduler);
  });

  it("Mehrere Macro-Indizes haben unabhängige Loops", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    mod.stopAllHoldLoops();
    const { scheduler, activeTaskCount } = createMockScheduler();
    mod.startHoldLoop(0, () => {}, 200, scheduler);
    mod.startHoldLoop(1, () => {}, 100, scheduler);
    mod.startHoldLoop(2, () => {}, 200, scheduler);
    expect(activeTaskCount()).toBe(3);
    mod.stopHoldLoop(1, scheduler);
    expect(activeTaskCount()).toBe(2);
    expect(mod.isHoldLoopActive(0)).toBe(true);
    expect(mod.isHoldLoopActive(1)).toBe(false);
    expect(mod.isHoldLoopActive(2)).toBe(true);
    mod.stopAllHoldLoops(scheduler);
  });

  it("stopHoldLoop ist no-op wenn keine Loop aktiv", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    mod.stopAllHoldLoops();
    const { scheduler } = createMockScheduler();
    expect(() => mod.stopHoldLoop(99, scheduler)).not.toThrow();
    expect(mod.isHoldLoopActive(99)).toBe(false);
  });

  it("run-Funktion die wirft bricht die Loop NICHT (defensiv)", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    mod.stopAllHoldLoops();
    const { scheduler, tick } = createMockScheduler();
    let calls = 0;
    mod.startHoldLoop(0, () => {
      calls++;
      throw new Error("test-error");
    }, 200, scheduler);
    expect(calls).toBe(1); // initialer Call
    tick();
    expect(calls).toBe(2); // Loop läuft trotz Error weiter
    tick();
    expect(calls).toBe(3);
    mod.stopAllHoldLoops(scheduler);
  });

  it("stopAllHoldLoops löscht alle Loops gleichzeitig", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    mod.stopAllHoldLoops();
    const { scheduler } = createMockScheduler();
    mod.startHoldLoop(0, () => {}, 200, scheduler);
    mod.startHoldLoop(1, () => {}, 200, scheduler);
    mod.startHoldLoop(2, () => {}, 200, scheduler);
    expect(mod.getActiveHoldLoopCount()).toBe(3);
    mod.stopAllHoldLoops(scheduler);
    expect(mod.getActiveHoldLoopCount()).toBe(0);
  });

  it("Default-Konstanten haben sinnvolle Werte (Script 200ms, Pad 100ms)", async () => {
    vi.resetModules();
    const mod = await import("../../client/src/utils/macroHoldLoop");
    expect(mod.SCRIPT_HOLD_INTERVAL_MS).toBe(200);
    expect(mod.PAD_HOLD_INTERVAL_MS).toBe(100);
  });
});
