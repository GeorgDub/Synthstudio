/**
 * tests/features/script-keybindings.test.ts
 *
 * Unit-Tests für die pure Konflikt-Logik in useScriptKeyBindings.
 *
 * Abgedeckt (Pflicht, mind. 6 Tests):
 *  - findKeyConflict: combo trifft Action → returns { kind: "action", id }
 *  - findKeyConflict: combo trifft Script → returns { kind: "script", id }
 *  - findKeyConflict: kein Konflikt → null
 *  - enabled=false Script → kein Trigger via Conflict-Lookup
 *  - enabled=true ohne keyBinding → kein Trigger via Conflict-Lookup
 *  - Doppel-Konflikt (action UND script) → action gewinnt
 *
 * Zusätzlich:
 *  - eventToScriptCombo: Lowercase-Normalisierung + Modifier-Mapping
 *  - findMatchingAction: User-Override beats Default
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── DOM-Stubs für Node (KeyboardEvent existiert in jsdom-Tests, aber wir
// laufen unit-tests in node-Env; bauen Mock-Events).────────────────────────

interface MockKeyboardEvent {
  key: string;
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

// localStorage-Mock damit useScriptStore in Node läuft.
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
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

import {
  findKeyConflict,
  findMatchingAction,
  eventToScriptCombo,
} from "../../client/src/hooks/useScriptKeyBindings";
import type {
  KeyCombo as ActionKeyCombo,
} from "../../client/src/hooks/keyboardActionDefs";
import {
  addScript,
  __resetForTests,
  DEFAULT_MAX_RUNTIME_MS,
  type Script,
  type KeyCombo as ScriptKeyCombo,
} from "../../client/src/store/useScriptStore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockEvent(
  partial: Partial<MockKeyboardEvent> & { key: string; code: string },
): KeyboardEvent {
  return {
    key: partial.key,
    code: partial.code,
    ctrlKey: !!partial.ctrlKey,
    shiftKey: !!partial.shiftKey,
    altKey: !!partial.altKey,
    metaKey: !!partial.metaKey,
  } as unknown as KeyboardEvent;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("eventToScriptCombo", () => {
  it("normalises single-char keys to lowercase", () => {
    const e = mockEvent({ key: "B", code: "KeyB", shiftKey: true });
    const combo = eventToScriptCombo(e);
    expect(combo.key).toBe("b");
    expect(combo.shift).toBe(true);
    expect(combo.ctrl).toBeUndefined();
  });

  it("preserves multi-char keys (F1, ArrowUp, Enter)", () => {
    expect(eventToScriptCombo(mockEvent({ key: "F1", code: "F1" })).key).toBe("F1");
    expect(eventToScriptCombo(mockEvent({ key: "ArrowUp", code: "ArrowUp" })).key).toBe("ArrowUp");
    expect(eventToScriptCombo(mockEvent({ key: "Enter", code: "Enter" })).key).toBe("Enter");
  });

  it("maps all modifiers correctly", () => {
    const e = mockEvent({
      key: "k", code: "KeyK",
      ctrlKey: true, shiftKey: true, altKey: true, metaKey: true,
    });
    const combo = eventToScriptCombo(e);
    expect(combo).toEqual({ key: "k", ctrl: true, shift: true, alt: true, meta: true });
  });
});

describe("findMatchingAction", () => {
  it("matches a default-bound action (Space → play-stop)", () => {
    const combo: ActionKeyCombo = { code: "Space" };
    expect(findMatchingAction(combo, {})).toBe("play-stop");
  });

  it("matches a user-override beating the default", () => {
    // Override "play-stop" auf Ctrl+P
    const overrides: Record<string, ActionKeyCombo> = {
      "play-stop": { code: "KeyP", ctrl: true },
    };
    expect(findMatchingAction({ code: "KeyP", ctrl: true }, overrides)).toBe("play-stop");
    // Space matcht nicht mehr Space → das Default wurde überschrieben, aber
    // ACTIONS[].defaultCombo bleibt — d.h. Space matcht weiterhin "play-stop"
    // weil der Override-Mechanismus pro action ist (Space ist überschrieben
    // worden, aber Default des Action play-stop bleibt im Loop). Korrekt
    // hier: Space matcht "play-stop" über defaultCombo solange overrides
    // nicht play-stop deaktivieren. → wir vergleichen mit defaultCombo NUR
    // wenn KEIN override gesetzt; ist override gesetzt, gilt der Override.
    // Daher: Space matcht nichts mehr.
    expect(findMatchingAction({ code: "Space" }, overrides)).toBeNull();
  });

  it("returns null when no action matches", () => {
    const combo: ActionKeyCombo = { code: "KeyQ", ctrl: true, alt: true, shift: true };
    expect(findMatchingAction(combo, {})).toBeNull();
  });
});

describe("findKeyConflict", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("returns { kind: 'action', id } when combo matches an action (default binding)", () => {
    // Space matched play-stop per default
    const actionCombo: ActionKeyCombo = { code: "Space" };
    const scriptCombo: ScriptKeyCombo = { key: " " };
    const result = findKeyConflict(actionCombo, scriptCombo, [], {});
    expect(result).toEqual({ kind: "action", id: "play-stop" });
  });

  it("returns { kind: 'script', id } when combo matches a script and no action", () => {
    const scriptId = addScript({
      name: "Beats",
      code: "ss.log('hi')",
      scope: "app",
      enabled: true,
      maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      keyBinding: { key: "b", ctrl: true, shift: true },
    });
    const scripts: Script[] = [
      {
        id: scriptId,
        name: "Beats",
        code: "ss.log('hi')",
        scope: "app",
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
        keyBinding: { key: "b", ctrl: true, shift: true },
      },
    ];
    // Ctrl+Shift+B trifft KEINE Default-Action
    const actionCombo: ActionKeyCombo = { code: "KeyB", ctrl: true, shift: true };
    const scriptCombo: ScriptKeyCombo = { key: "b", ctrl: true, shift: true };
    const result = findKeyConflict(actionCombo, scriptCombo, scripts, {});
    expect(result).toEqual({ kind: "script", id: scriptId });
  });

  it("returns null when neither action nor script matches", () => {
    // Eine sehr ungewöhnliche Combo, die nicht im ACTIONS-Default ist
    const actionCombo: ActionKeyCombo = { code: "KeyQ", ctrl: true, alt: true, shift: true };
    const scriptCombo: ScriptKeyCombo = { key: "q", ctrl: true, alt: true, shift: true };
    const result = findKeyConflict(actionCombo, scriptCombo, [], {});
    expect(result).toBeNull();
  });

  it("does NOT match a disabled script (enabled=false)", () => {
    const disabled: Script = {
      id: "sc-test-1",
      name: "Disabled",
      code: "ss.log('off')",
      scope: "app",
      enabled: false,
      createdAt: 0,
      updatedAt: 0,
      maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      keyBinding: { key: "b", ctrl: true, shift: true },
    };
    const actionCombo: ActionKeyCombo = { code: "KeyB", ctrl: true, shift: true };
    const scriptCombo: ScriptKeyCombo = { key: "b", ctrl: true, shift: true };
    const result = findKeyConflict(actionCombo, scriptCombo, [disabled], {});
    expect(result).toBeNull();
  });

  it("does NOT match an enabled script without keyBinding", () => {
    const noBinding: Script = {
      id: "sc-test-2",
      name: "Macro only",
      code: "ss.log('m')",
      scope: "app",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      macroButtonIndex: 3,
      // explicit: no keyBinding
    };
    const actionCombo: ActionKeyCombo = { code: "KeyB", ctrl: true, shift: true };
    const scriptCombo: ScriptKeyCombo = { key: "b", ctrl: true, shift: true };
    const result = findKeyConflict(actionCombo, scriptCombo, [noBinding], {});
    expect(result).toBeNull();
  });

  it("prefers action over script when both match the same combo", () => {
    // Skript an Space gebunden → kollidiert mit play-stop default
    const collide: Script = {
      id: "sc-collide",
      name: "Collider",
      code: "ss.log('x')",
      scope: "app",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      keyBinding: { key: " " }, // Space
    };
    const actionCombo: ActionKeyCombo = { code: "Space" };
    const scriptCombo: ScriptKeyCombo = { key: " " };
    const result = findKeyConflict(actionCombo, scriptCombo, [collide], {});
    expect(result).toEqual({ kind: "action", id: "play-stop" });
  });

  it("respects strict modifier matching (Ctrl+B ≠ Ctrl+Shift+B)", () => {
    const script: Script = {
      id: "sc-mod-strict",
      name: "Mod Strict",
      code: "ss.log('y')",
      scope: "app",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      keyBinding: { key: "b", ctrl: true, shift: true },
    };
    // Nur Ctrl+B (ohne Shift) → kein Match
    const result = findKeyConflict(
      { code: "KeyB", ctrl: true },
      { key: "b", ctrl: true },
      [script],
      {},
    );
    expect(result).toBeNull();
  });

  it("can match script via user-overridden script-combo (independent of actions)", () => {
    // Script an Alt+J → keine Action default
    const script: Script = {
      id: "sc-altj",
      name: "Alt J",
      code: "ss.log('z')",
      scope: "app",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      keyBinding: { key: "j", alt: true },
    };
    const result = findKeyConflict(
      { code: "KeyJ", alt: true },
      { key: "j", alt: true },
      [script],
      {},
    );
    expect(result).toEqual({ kind: "script", id: "sc-altj" });
  });
});
