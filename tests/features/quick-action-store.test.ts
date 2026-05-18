/**
 * tests/features/quick-action-store.test.ts
 *
 * Unit-Tests fuer useQuickActionStore + quickActionExecutor (v3.68.0).
 *
 * Abgedeckt (Pflicht, mind. 5 Tests):
 *  - addQuickActionMacro persistiert + assigned unique id
 *  - executeQuickActionMacro runs actions sequenziell
 *  - delay-Action wartet ms (mit injected sleep)
 *  - findMacroForKeybind matched normalisiert (case + modifier-order)
 *  - Built-in Macros sind on first-load present
 *  - updateQuickActionMacro respektiert action-Validierung
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  addQuickActionMacro,
  removeQuickActionMacro,
  updateQuickActionMacro,
  reorderQuickActionMacro,
  getQuickActionMacros,
  resetQuickActionMacros,
  __resetQuickActionStoreForTests,
  builtInQuickActionMacros,
  normalizeKeybind,
  eventToKeybind,
  findMacroForKeybind,
  type QuickActionMacroAction,
} from "../../client/src/store/useQuickActionStore";

import {
  executeQuickAction,
  executeQuickActionMacro,
  type QuickActionContext,
} from "../../client/src/utils/quickActionExecutor";

const STORAGE_KEY = "ss-quick-action-macros:v1";

function readPersisted(): unknown {
  const raw = localStorageMock.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe("useQuickActionStore", () => {
  beforeEach(() => {
    __resetQuickActionStoreForTests();
  });

  describe("Built-in Macros", () => {
    it("Built-in Macros laden mit erwarteten Namen", () => {
      const macros = getQuickActionMacros();
      // 3 Built-ins
      expect(macros.length).toBeGreaterThanOrEqual(3);
      const names = macros.map((m) => m.name);
      expect(names).toContain("Mute All Drums");
      expect(names).toContain("Unmute All Drums");
      expect(names).toContain("Reset Master Volume");
    });

    it("Built-in Macros werden in localStorage persistiert", () => {
      const persisted = readPersisted() as Array<{ name: string }>;
      expect(Array.isArray(persisted)).toBe(true);
      expect(persisted.length).toBeGreaterThanOrEqual(3);
    });

    it("builtInQuickActionMacros() returns immutable templates", () => {
      const a = builtInQuickActionMacros();
      const b = builtInQuickActionMacros();
      expect(a).not.toBe(b); // verschiedene Array-Instanzen
      expect(a[0].name).toBe(b[0].name);
    });
  });

  describe("addQuickActionMacro", () => {
    it("addMacro persistiert in localStorage", () => {
      const before = getQuickActionMacros().length;
      const created = addQuickActionMacro({
        name: "Test Macro",
        actions: [{ kind: "set-bpm", bpm: 128 }],
      });
      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Test Macro");

      // State & Persistenz konsistent
      const afterState = getQuickActionMacros();
      expect(afterState.length).toBe(before + 1);
      const persisted = readPersisted() as Array<{ id: string }>;
      expect(persisted.length).toBe(afterState.length);
      expect(persisted.find((m) => m.id === created.id)).toBeTruthy();
    });

    it("addMacro normalisiert keybind", () => {
      const created = addQuickActionMacro({
        name: "Capslocked",
        keybind: "Ctrl+Shift+R",
        actions: [],
      });
      expect(created.keybind).toBe("ctrl+shift+r");
    });
  });

  describe("updateQuickActionMacro", () => {
    it("update validiert actions und filtert invalides raus", () => {
      const m = addQuickActionMacro({ name: "X", actions: [] });
      updateQuickActionMacro(m.id, {
        actions: [
          { kind: "set-bpm", bpm: 100 } as QuickActionMacroAction,
          { kind: "set-bpm", bpm: -5 } as QuickActionMacroAction, // invalid (bpm<=0)
          { kind: "delay", ms: 50 } as QuickActionMacroAction,
        ],
      });
      const updated = getQuickActionMacros().find((x) => x.id === m.id);
      expect(updated?.actions.length).toBe(2);
      expect(updated?.actions[0].kind).toBe("set-bpm");
      expect(updated?.actions[1].kind).toBe("delay");
    });

    it("update mit description=undefined entfernt das Feld", () => {
      const m = addQuickActionMacro({ name: "Y", description: "hi", actions: [] });
      expect(m.description).toBe("hi");
      updateQuickActionMacro(m.id, { description: undefined });
      const updated = getQuickActionMacros().find((x) => x.id === m.id);
      expect(updated?.description).toBeUndefined();
    });
  });

  describe("removeQuickActionMacro + reorderQuickActionMacro", () => {
    it("remove löscht aus State + Persistenz", () => {
      const m = addQuickActionMacro({ name: "Z", actions: [] });
      removeQuickActionMacro(m.id);
      expect(getQuickActionMacros().find((x) => x.id === m.id)).toBeUndefined();
      const persisted = readPersisted() as Array<{ id: string }>;
      expect(persisted.find((x) => x.id === m.id)).toBeUndefined();
    });

    it("reorder verschiebt Actions im Array", () => {
      const m = addQuickActionMacro({
        name: "R",
        actions: [
          { kind: "set-bpm", bpm: 100 },
          { kind: "delay", ms: 50 },
          { kind: "set-master-volume", value: 0.5 },
        ],
      });
      reorderQuickActionMacro(m.id, 0, 2);
      const updated = getQuickActionMacros().find((x) => x.id === m.id)!;
      expect(updated.actions[0].kind).toBe("delay");
      expect(updated.actions[1].kind).toBe("set-master-volume");
      expect(updated.actions[2].kind).toBe("set-bpm");
    });
  });
});

// ─── normalizeKeybind / eventToKeybind / findMacroForKeybind ─────────────────

describe("normalizeKeybind", () => {
  it("lower-cased + modifier-order ist deterministisch", () => {
    expect(normalizeKeybind("Ctrl+Shift+R")).toBe("ctrl+shift+r");
    expect(normalizeKeybind("shift+ctrl+r")).toBe("ctrl+shift+r");
    expect(normalizeKeybind("D")).toBe("d");
    expect(normalizeKeybind("CMD+a")).toBe("meta+a");
  });

  it("leerer/ungültiger Input → undefined", () => {
    expect(normalizeKeybind(undefined)).toBeUndefined();
    expect(normalizeKeybind("")).toBeUndefined();
    expect(normalizeKeybind("ctrl+shift+")).toBeUndefined();
  });

  it("eventToKeybind erzeugt normalisierte Form", () => {
    const e = {
      key: "R",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent;
    expect(eventToKeybind(e)).toBe("ctrl+shift+r");
  });
});

describe("findMacroForKeybind", () => {
  beforeEach(() => {
    __resetQuickActionStoreForTests();
  });

  it("Keybind-Match triggert macro (matched normalisiert)", () => {
    const m = addQuickActionMacro({
      name: "TriggerMe",
      keybind: "Shift+1", // wird zu "shift+1"
      actions: [{ kind: "set-bpm", bpm: 140 }],
    });
    const macros = getQuickActionMacros();
    const found = findMacroForKeybind(macros, "shift+1");
    expect(found?.id).toBe(m.id);
    const foundUpper = findMacroForKeybind(macros, "SHIFT+1");
    expect(foundUpper?.id).toBe(m.id);
  });

  it("kein Match → null", () => {
    const found = findMacroForKeybind(getQuickActionMacros(), "ctrl+z");
    expect(found).toBeNull();
  });
});

// ─── Executor ────────────────────────────────────────────────────────────────

describe("executeQuickActionMacro", () => {
  it("Actions sequenziell mit korrekten Settern", async () => {
    const calls: string[] = [];
    const ctx: QuickActionContext = {
      setBpm: (b) => { calls.push(`bpm:${b}`); },
      setMasterVolume: (v) => { calls.push(`mv:${v}`); },
      setAllDrumPartsMuted: (v) => { calls.push(`muteAll:${v}`); },
      switchPattern: (id) => { calls.push(`pat:${id}`); },
    };
    const macro = {
      id: "test",
      name: "Seq",
      actions: [
        { kind: "set-bpm", bpm: 120 } as QuickActionMacroAction,
        { kind: "set-master-volume", value: 0.7 } as QuickActionMacroAction,
        { kind: "mute-all-drum-parts", value: true } as QuickActionMacroAction,
        { kind: "switch-pattern", patternId: "p1" } as QuickActionMacroAction,
      ],
      createdAt: Date.now(),
    };
    const count = await executeQuickActionMacro(macro, ctx);
    expect(count).toBe(4);
    expect(calls).toEqual(["bpm:120", "mv:0.7", "muteAll:true", "pat:p1"]);
  });

  it("Delay-Action wartet ms (mit injected sleep)", async () => {
    let slept = 0;
    const ctx: QuickActionContext = {
      setBpm: () => { /* noop */ },
      sleep: async (ms) => { slept += ms; },
    };
    const macro = {
      id: "test-delay",
      name: "Delay-Test",
      actions: [
        { kind: "set-bpm", bpm: 100 } as QuickActionMacroAction,
        { kind: "delay", ms: 250 } as QuickActionMacroAction,
        { kind: "delay", ms: 50 } as QuickActionMacroAction,
      ],
      createdAt: Date.now(),
    };
    await executeQuickActionMacro(macro, ctx);
    expect(slept).toBe(300);
  });

  it("Fehlender Setter ruft onUnhandled aber bricht NICHT ab", async () => {
    const unhandled: QuickActionMacroAction[] = [];
    const calls: string[] = [];
    const ctx: QuickActionContext = {
      // Kein setBpm, kein setMasterVolume.
      setAllDrumPartsMuted: (v) => { calls.push(`muteAll:${v}`); },
      onUnhandled: (a) => { unhandled.push(a); },
    };
    const macro = {
      id: "missing-setters",
      name: "Mix",
      actions: [
        { kind: "set-bpm", bpm: 110 } as QuickActionMacroAction,
        { kind: "mute-all-drum-parts", value: false } as QuickActionMacroAction,
        { kind: "set-master-volume", value: 0.5 } as QuickActionMacroAction,
      ],
      createdAt: Date.now(),
    };
    const count = await executeQuickActionMacro(macro, ctx);
    // 1 dispatched (mute-all), 2 unhandled.
    expect(count).toBe(1);
    expect(unhandled.length).toBe(2);
    expect(calls).toEqual(["muteAll:false"]);
  });

  it("executeQuickAction returnt false bei fehlendem Setter, true sonst", async () => {
    const ctx: QuickActionContext = {
      setBpm: () => { /* noop */ },
    };
    const ok = await executeQuickAction({ kind: "set-bpm", bpm: 100 }, ctx);
    expect(ok).toBe(true);
    const fail = await executeQuickAction({ kind: "set-master-volume", value: 0.5 }, ctx);
    expect(fail).toBe(false);
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe("resetQuickActionMacros", () => {
  it("resetQuickActionMacros stellt Built-ins wieder her", () => {
    __resetQuickActionStoreForTests();
    // Erst löschen
    for (const m of getQuickActionMacros()) {
      removeQuickActionMacro(m.id);
    }
    expect(getQuickActionMacros().length).toBe(0);
    // Dann resetten
    resetQuickActionMacros();
    expect(getQuickActionMacros().length).toBeGreaterThanOrEqual(3);
  });
});
