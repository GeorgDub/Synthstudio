/**
 * tests/features/macros.test.ts
 *
 * Unit-Tests fuer useMacroStore.
 * Stubt localStorage + window (fuer CustomEvent-Dispatch in setMacroValue).
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
  type MacroBinding,
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
