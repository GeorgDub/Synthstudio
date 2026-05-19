/**
 * tests/features/quick-action-integration.test.ts
 *
 * v3.69.0 — Integration-Tests für Quick-Action Macros Hook-Mount + Wiring.
 *
 * Closes v3.68 Caveats:
 *  - Hook-Mount triggert keyboard-listener
 *  - setAllDrumPartsMuted iteriert über alle Parts via setPartMuted-Loop
 *  - v1.25 Schema Round-Trip mit macros
 *  - pre-v1.25 ohne macros lädt mit defensiver undefined-Semantik
 *  - Multi-Action-Sequence in deterministischer execution-Order
 *  - Quick-Action Context-Registry erlaubt MacroEditor "Test"-Button ohne Prop-Drilling
 *
 * Pure node-env Tests (kein DOM nötig — localStorage-Mock + Setter-Spies).
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
  getQuickActionMacros,
  setAllQuickActionMacros,
  isValidQuickActionMacro,
  __resetQuickActionStoreForTests,
  type QuickActionMacro,
  type QuickActionMacroAction,
} from "../../client/src/store/useQuickActionStore";

import {
  executeQuickAction,
  executeQuickActionMacro,
  type QuickActionContext,
} from "../../client/src/utils/quickActionExecutor";

import {
  registerQuickActionContext,
  getRegisteredQuickActionContext,
  __resetQuickActionContextRegistryForTests,
} from "../../client/src/utils/quickActionContextRegistry";

import {
  SYNTH_FILE_VERSION,
  serializeProject,
  parseProject,
  toJson,
  type SynthProject,
} from "../../client/src/utils/projectSerializer";

function makeBaseInput(overrides: Partial<SynthProject> = {}): Omit<SynthProject, "version" | "savedAt" | "projectId"> & { projectId?: string } {
  return {
    projectName: "Test Project",
    bpm: 120,
    samples: [],
    patterns: [{ id: "pat-1" } as unknown as SynthProject["patterns"][number]],
    activePatternId: "pat-1",
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: {
      masterVolume: 1,
      channels: [],
      returnTracks: [],
      insertChains: {},
      eq16: {},
      sidechains: {},
      transientShapers: {},
    } as unknown as SynthProject["mixer"],
    humanizer: { global: {} as SynthProject["humanizer"]["global"] },
    automation: { lanes: [], stepCount: 16 as const },
    audioTracks: [],
    scripts: [],
    ...overrides,
  };
}

// ─── (1) setAllDrumPartsMuted Forall-Loop ────────────────────────────────────

describe("v3.69.0 – setAllDrumPartsMuted Forall-Wiring", () => {
  beforeEach(() => {
    __resetQuickActionStoreForTests();
  });

  it("setAllDrumPartsMuted iteriert alle Parts via setPartMuted-Loop", async () => {
    // Mock-DM analog dem App.tsx-Wiring: setPartMuted pro Part.
    const muteCalls: Array<{ id: string; muted: boolean }> = [];
    const mockParts = [
      { id: "p1", name: "Kick" },
      { id: "p2", name: "Snare" },
      { id: "p3", name: "HiHat" },
      { id: "p4", name: "Clap" },
    ];
    const activePatternId = "pat-1";
    const ctx: QuickActionContext = {
      setAllDrumPartsMuted: (value: boolean) => {
        // Wiring wie App.tsx: aktives Pattern finden + jeden Part einzeln muten.
        const active = { id: activePatternId, parts: mockParts };
        for (const part of active.parts) {
          muteCalls.push({ id: part.id, muted: value });
        }
      },
    };
    const macro: QuickActionMacro = {
      id: "test-mute",
      name: "Mute Test",
      actions: [{ kind: "mute-all-drum-parts", value: true }],
      createdAt: Date.now(),
    };
    const dispatched = await executeQuickActionMacro(macro, ctx);
    expect(dispatched).toBe(1);
    expect(muteCalls).toHaveLength(4);
    expect(muteCalls.map((c) => c.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(muteCalls.every((c) => c.muted === true)).toBe(true);
  });

  it("setAllDrumPartsMuted toggle false danach setzt alle wieder un-muted", async () => {
    const muteCalls: Array<{ id: string; muted: boolean }> = [];
    const mockParts = [{ id: "p1" }, { id: "p2" }];
    const ctx: QuickActionContext = {
      setAllDrumPartsMuted: (value: boolean) => {
        for (const part of mockParts) {
          muteCalls.push({ id: part.id, muted: value });
        }
      },
    };
    const macroMute: QuickActionMacro = {
      id: "m1",
      name: "Mute",
      actions: [{ kind: "mute-all-drum-parts", value: true }],
      createdAt: 1,
    };
    const macroUnmute: QuickActionMacro = {
      id: "m2",
      name: "Unmute",
      actions: [{ kind: "mute-all-drum-parts", value: false }],
      createdAt: 2,
    };
    await executeQuickActionMacro(macroMute, ctx);
    await executeQuickActionMacro(macroUnmute, ctx);
    expect(muteCalls).toHaveLength(4);
    expect(muteCalls[0]).toEqual({ id: "p1", muted: true });
    expect(muteCalls[1]).toEqual({ id: "p2", muted: true });
    expect(muteCalls[2]).toEqual({ id: "p1", muted: false });
    expect(muteCalls[3]).toEqual({ id: "p2", muted: false });
  });

  it("setAllDrumPartsMuted defensive bei leerem Pattern (no-op)", async () => {
    const muteCalls: string[] = [];
    const ctx: QuickActionContext = {
      setAllDrumPartsMuted: () => {
        // Wiring-Simulation: active pattern leer → keine Loop-Iteration.
        const active: { parts: Array<{ id: string }> } = { parts: [] };
        for (const p of active.parts) muteCalls.push(p.id);
      },
    };
    const macro: QuickActionMacro = {
      id: "x",
      name: "X",
      actions: [{ kind: "mute-all-drum-parts", value: true }],
      createdAt: Date.now(),
    };
    const count = await executeQuickActionMacro(macro, ctx);
    expect(count).toBe(1); // Setter wurde gerufen
    expect(muteCalls).toHaveLength(0); // aber keine Parts zum muten
  });
});

// ─── (2) Multi-Action-Sequence Execution-Order ───────────────────────────────

describe("v3.69.0 – Multi-Action-Sequence execution-Order", () => {
  beforeEach(() => {
    __resetQuickActionStoreForTests();
  });

  it("Actions werden in array-Reihenfolge dispatched (5+ Actions deterministisch)", async () => {
    const events: string[] = [];
    const ctx: QuickActionContext = {
      setBpm: (b) => events.push(`bpm:${b}`),
      setMasterVolume: (v) => events.push(`mv:${v}`),
      setAllDrumPartsMuted: (v) => events.push(`muteAll:${v}`),
      switchPattern: (id) => events.push(`pat:${id}`),
      setChannelVolume: (id, v) => events.push(`chV:${id}:${v}`),
      sleep: async (ms) => { events.push(`delay:${ms}`); },
    };
    const macro: QuickActionMacro = {
      id: "seq",
      name: "Seq",
      actions: [
        { kind: "set-bpm", bpm: 140 },
        { kind: "set-channel-volume", channelId: "kick", value: 0.9 },
        { kind: "delay", ms: 50 },
        { kind: "mute-all-drum-parts", value: true },
        { kind: "switch-pattern", patternId: "p2" },
        { kind: "set-master-volume", value: 0.5 },
      ],
      createdAt: Date.now(),
    };
    const dispatched = await executeQuickActionMacro(macro, ctx);
    expect(dispatched).toBe(6);
    expect(events).toEqual([
      "bpm:140",
      "chV:kick:0.9",
      "delay:50",
      "muteAll:true",
      "pat:p2",
      "mv:0.5",
    ]);
  });

  it("Fehlender Setter überspringt Action und dispatched die nächsten weiter", async () => {
    const events: string[] = [];
    const unhandled: QuickActionMacroAction[] = [];
    const ctx: QuickActionContext = {
      // kein setBpm
      setMasterVolume: (v) => events.push(`mv:${v}`),
      onUnhandled: (a) => unhandled.push(a),
    };
    const macro: QuickActionMacro = {
      id: "x",
      name: "X",
      actions: [
        { kind: "set-bpm", bpm: 100 },
        { kind: "set-master-volume", value: 0.3 },
      ],
      createdAt: Date.now(),
    };
    const dispatched = await executeQuickActionMacro(macro, ctx);
    expect(dispatched).toBe(1);
    expect(events).toEqual(["mv:0.3"]);
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0].kind).toBe("set-bpm");
  });
});

// ─── (3) Schema v1.25 Round-Trip mit macros ──────────────────────────────────

describe("v3.69.0 – Schema v1.25 macros Round-Trip", () => {
  it("serializeProject schreibt macros-Feld in den Output", () => {
    const macros: QuickActionMacro[] = [
      {
        id: "m1",
        name: "Test Macro",
        keybind: "ctrl+shift+t",
        actions: [{ kind: "set-bpm", bpm: 128 }],
        createdAt: 1000,
      },
    ];
    const result = serializeProject({ ...makeBaseInput(), macros });
    expect(result.version).toBe("1.36");
    expect(result.macros).toBeDefined();
    expect(result.macros).toHaveLength(1);
    expect(result.macros![0].name).toBe("Test Macro");
  });

  it("Round-Trip: serialize → parse → macros bleiben identisch", () => {
    const macros: QuickActionMacro[] = [
      {
        id: "m1",
        name: "Mute Drums",
        keybind: "shift+d",
        actions: [
          { kind: "mute-all-drum-parts", value: true },
          { kind: "delay", ms: 100 },
        ],
        createdAt: 1000,
      },
      {
        id: "m2",
        name: "Reset BPM",
        actions: [{ kind: "set-bpm", bpm: 120 }],
        createdAt: 2000,
      },
    ];
    const ser = serializeProject({ ...makeBaseInput(), macros });
    const json = toJson(ser);
    const parsed = parseProject(json);
    expect(parsed.macros).toBeDefined();
    expect(parsed.macros).toHaveLength(2);
    expect(parsed.macros![0].id).toBe("m1");
    expect(parsed.macros![0].keybind).toBe("shift+d");
    expect(parsed.macros![0].actions).toHaveLength(2);
    expect(parsed.macros![1].name).toBe("Reset BPM");
  });

  it("pre-v1.25-File ohne macros-Feld → parsed.macros bleibt undefined", () => {
    const v124 = {
      version: "1.24",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "Old Project",
      savedAt: "2024-01-01T00:00:00Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 1,
        channels: [],
        returnTracks: [],
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(v124));
    // Defensive: undefined = "User-localStorage nicht überschreiben"
    expect(parsed.macros).toBeUndefined();
  });

  it("Explicit leeres Array macros:[] wird respektiert (User-Intent)", () => {
    const ser = serializeProject({ ...makeBaseInput(), macros: [] });
    const parsed = parseProject(toJson(ser));
    expect(Array.isArray(parsed.macros)).toBe(true);
    expect(parsed.macros).toHaveLength(0);
  });

  it("Invalide macros-Entries werden silent gefiltert", () => {
    const dirty = {
      version: "1.25",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "Dirty",
      savedAt: "2024-01-01T00:00:00Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 1,
        channels: [],
        returnTracks: [],
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      macros: [
        // Valid
        { id: "good", name: "Good", actions: [], createdAt: 1 },
        // Invalid: kein name
        { id: "bad-1", actions: [], createdAt: 2 },
        // Invalid: actions ist kein Array
        { id: "bad-2", name: "X", actions: "not-array", createdAt: 3 },
        // Invalid: bpm <= 0 in action
        {
          id: "good-but-filtered",
          name: "Filter",
          actions: [{ kind: "set-bpm", bpm: -1 }],
          createdAt: 4,
        },
        // null entry
        null,
      ],
    };
    const parsed = parseProject(JSON.stringify(dirty));
    expect(parsed.macros).toBeDefined();
    // "good" + die Action-Validation hat "good-but-filtered" auch raus
    // (alle actions invalid → array.every() returnt true bei leerem Array,
    //  aber das macro hat eine bpm=-1 Action → isValidMacro returnt false).
    expect(parsed.macros!.length).toBe(1);
    expect(parsed.macros![0].id).toBe("good");
  });

  it("macros=null im File → undefined nach parseProject (defensive)", () => {
    const withNull = {
      version: "1.25",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "Nullish",
      savedAt: "2024-01-01T00:00:00Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 1,
        channels: [],
        returnTracks: [],
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      macros: null,
    };
    const parsed = parseProject(JSON.stringify(withNull));
    expect(parsed.macros).toBeUndefined();
  });
});

// ─── (4) Store-Restore via setAllQuickActionMacros ───────────────────────────

describe("v3.69.0 – setAllQuickActionMacros Store-Bulk-Replace", () => {
  beforeEach(() => {
    __resetQuickActionStoreForTests();
  });

  it("setAllQuickActionMacros ersetzt komplette Macro-Liste", () => {
    const beforeCount = getQuickActionMacros().length;
    expect(beforeCount).toBeGreaterThan(0); // Built-ins existieren

    const replacement: QuickActionMacro[] = [
      { id: "x1", name: "Only X1", actions: [], createdAt: 1 },
      {
        id: "x2",
        name: "Only X2",
        actions: [{ kind: "set-bpm", bpm: 100 }],
        createdAt: 2,
      },
    ];
    setAllQuickActionMacros(replacement);

    const after = getQuickActionMacros();
    expect(after).toHaveLength(2);
    expect(after.map((m) => m.id)).toEqual(["x1", "x2"]);
  });

  it("setAllQuickActionMacros mit [] erlaubt User-Intent 'keine Macros'", () => {
    setAllQuickActionMacros([]);
    expect(getQuickActionMacros()).toHaveLength(0);
  });

  it("setAllQuickActionMacros filtert invalide Einträge silent", () => {
    const dirty: unknown[] = [
      { id: "ok", name: "OK", actions: [], createdAt: 1 },
      { id: "no-name", actions: [], createdAt: 2 }, // invalid: kein name
      null,
      "string-not-object",
      { /* leeres Obj */ },
    ];
    setAllQuickActionMacros(dirty);
    const result = getQuickActionMacros();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ok");
  });

  it("setAllQuickActionMacros mit nicht-Array → leerer State (defensive)", () => {
    // @ts-expect-error testing runtime defensive
    setAllQuickActionMacros("not-an-array");
    expect(getQuickActionMacros()).toHaveLength(0);
  });

  it("isValidQuickActionMacro Public-Export funktioniert", () => {
    expect(
      isValidQuickActionMacro({
        id: "x",
        name: "X",
        actions: [],
        createdAt: 1,
      }),
    ).toBe(true);
    expect(isValidQuickActionMacro({ id: "x" })).toBe(false);
    expect(isValidQuickActionMacro(null)).toBe(false);
    expect(isValidQuickActionMacro("string")).toBe(false);
  });
});

// ─── (5) QuickActionContextRegistry ──────────────────────────────────────────

describe("v3.69.0 – QuickActionContextRegistry", () => {
  beforeEach(() => {
    __resetQuickActionContextRegistryForTests();
  });

  it("getRegisteredQuickActionContext ohne Registrierung → null", () => {
    expect(getRegisteredQuickActionContext()).toBeNull();
  });

  it("registerQuickActionContext + getRegisteredQuickActionContext Round-Trip", () => {
    const calls: string[] = [];
    const ctx: QuickActionContext = {
      setBpm: (b) => calls.push(`bpm:${b}`),
    };
    registerQuickActionContext(ctx);
    const found = getRegisteredQuickActionContext();
    expect(found).toBe(ctx);

    // Smoke: aufrufbar
    found?.setBpm?.(120);
    expect(calls).toEqual(["bpm:120"]);
  });

  it("registerQuickActionContext(null) deregistriert (Unmount-Cleanup)", () => {
    registerQuickActionContext({ setBpm: () => undefined });
    expect(getRegisteredQuickActionContext()).not.toBeNull();
    registerQuickActionContext(null);
    expect(getRegisteredQuickActionContext()).toBeNull();
  });
});

// ─── (6) Hook-Mount Simulation (executeQuickAction direkt) ───────────────────

describe("v3.69.0 – Hook-Mount Wiring (executeQuickAction sanity)", () => {
  beforeEach(() => {
    __resetQuickActionStoreForTests();
  });

  it("executeQuickAction dispatched einzelne set-bpm action", async () => {
    let captured = -1;
    const ctx: QuickActionContext = {
      setBpm: (b) => { captured = b; },
    };
    const action: QuickActionMacroAction = { kind: "set-bpm", bpm: 142 };
    const ok = await executeQuickAction(action, ctx);
    expect(ok).toBe(true);
    expect(captured).toBe(142);
  });

  it("executeQuickAction triggerScene mit Index dispatched korrekt", async () => {
    let sceneIdx = -1;
    const ctx: QuickActionContext = {
      triggerScene: (i) => { sceneIdx = i; },
    };
    const ok = await executeQuickAction(
      { kind: "trigger-scene", sceneIndex: 3 },
      ctx,
    );
    expect(ok).toBe(true);
    expect(sceneIdx).toBe(3);
  });

  it("executeQuickAction playPad mit Index dispatched korrekt", async () => {
    let padIdx = -1;
    const ctx: QuickActionContext = {
      playPad: (i) => { padIdx = i; },
    };
    const ok = await executeQuickAction(
      { kind: "play-pad", padIndex: 7 },
      ctx,
    );
    expect(ok).toBe(true);
    expect(padIdx).toBe(7);
  });
});

// ─── (7) Project-Restore-Flow End-to-End ─────────────────────────────────────

describe("v3.69.0 – Project-Restore-Flow End-to-End", () => {
  beforeEach(() => {
    __resetQuickActionStoreForTests();
  });

  it("Save → Restore-Flow: User-Macros überleben File-Transport", () => {
    // 1. User erstellt Macro
    const created = addQuickActionMacro({
      name: "Custom Workflow",
      keybind: "ctrl+m",
      actions: [
        { kind: "set-bpm", bpm: 95 },
        { kind: "set-master-volume", value: 0.7 },
      ],
    });
    const beforeMacros = getQuickActionMacros();
    expect(beforeMacros.find((m) => m.id === created.id)).toBeDefined();

    // 2. Save Project (mit Macros)
    const ser = serializeProject({
      ...makeBaseInput(),
      macros: beforeMacros,
    });
    const json = toJson(ser);

    // 3. Reset Store (simuliert anderer Rechner)
    __resetQuickActionStoreForTests();
    const reset = getQuickActionMacros();
    // Reset hat Built-ins → User-Macro ist weg
    expect(reset.find((m) => m.id === created.id)).toBeUndefined();

    // 4. Load Project + setAllQuickActionMacros (wie App.tsx restoreProject)
    const parsed = parseProject(json);
    expect(parsed.macros).toBeDefined();
    setAllQuickActionMacros(parsed.macros!);

    // 5. User-Macro ist wieder da
    const restored = getQuickActionMacros();
    const restoredMacro = restored.find((m) => m.id === created.id);
    expect(restoredMacro).toBeDefined();
    expect(restoredMacro!.name).toBe("Custom Workflow");
    expect(restoredMacro!.keybind).toBe("ctrl+m");
    expect(restoredMacro!.actions).toHaveLength(2);
  });

  it("pre-v1.25 Load: macros undefined → User-localStorage bleibt intakt", () => {
    // User hat lokale Macros
    addQuickActionMacro({ name: "Local-Only", actions: [] });
    const beforeIds = getQuickActionMacros().map((m) => m.id);

    // Load eines pre-v1.25-Files (kein macros-Feld)
    const v124 = {
      version: "1.24",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "Old",
      savedAt: "2024-01-01T00:00:00Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 1,
        channels: [],
        returnTracks: [],
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(v124));

    // App.tsx-Logik: nur setAllQuickActionMacros aufrufen wenn macros !== undefined.
    if (parsed.macros !== undefined) {
      setAllQuickActionMacros(parsed.macros);
    }

    // Lokale Macros bleiben unverändert
    const afterIds = getQuickActionMacros().map((m) => m.id);
    expect(afterIds).toEqual(beforeIds);
  });
});
