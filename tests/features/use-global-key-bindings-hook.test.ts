// @vitest-environment jsdom
/**
 * tests/features/use-global-key-bindings-hook.test.ts (TASK-CVG-KEYBINDINGS / v2.68)
 *
 * Unit-Coverage für useGlobalKeyBindings — globaler keydown-Listener der
 * konfigurierbare Actions als CustomEvent("kb:action") dispatcht.
 *
 * Mock-Strategie: useKeyboardBindingsStore.getAllBindings ist gemockt
 * (kontrollierte User-Overrides), keyboardActionDefs bleibt echt
 * (pure-helper). Tests dispatchen synthetische KeyboardEvents auf window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

// ─── Mock vor Hook-Import ────────────────────────────────────────────────────

const bindingsRef = { current: {} as Record<string, { code: string; ctrl?: boolean; shift?: boolean; alt?: boolean }> };

vi.mock("@/store/useKeyboardBindingsStore", () => ({
  getAllBindings: vi.fn(() => bindingsRef.current),
}));

import { useGlobalKeyBindings, KB_ACTION_EVENT } from "@/hooks/useGlobalKeyBindings";

// ─── Test-Helper ─────────────────────────────────────────────────────────────

const dispatchedActions: string[] = [];

function trackKbActions() {
  const handler = (e: Event) => {
    dispatchedActions.push((e as CustomEvent<string>).detail);
  };
  window.addEventListener(KB_ACTION_EVENT, handler);
  return () => window.removeEventListener(KB_ACTION_EVENT, handler);
}

function pressKey(opts: {
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget;
}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    code: opts.code,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  // jsdom: KeyboardEvent.target ist read-only via dispatch — wir nutzen ein
  // Element als source wenn nötig.
  if (opts.target) {
    (opts.target as EventTarget).dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
  return event;
}

beforeEach(() => {
  dispatchedActions.length = 0;
  bindingsRef.current = {}; // keine Overrides
  document.body.innerHTML = "";
});

let cleanupTracker: (() => void) | null = null;
afterEach(() => {
  cleanupTracker?.();
  cleanupTracker = null;
  // Wichtig: jeder renderHook() mountet einen React-Root mit window-Listener.
  // Ohne cleanup() bleiben sie über Test-Grenzen aktiv → Action wird N-fach
  // dispatched. cleanup() unmounted alle gerenderten Hooks.
  cleanup();
});

// ─── enabled-Flag ────────────────────────────────────────────────────────────

describe("useGlobalKeyBindings – enabled-Flag", () => {
  it("enabled=false: keydown wird NICHT abgefangen", () => {
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings(false));
    pressKey({ code: "Space" });
    expect(dispatchedActions).toEqual([]);
  });

  it("enabled=true (default): Space dispatcht play-stop", () => {
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings());
    pressKey({ code: "Space" });
    expect(dispatchedActions).toEqual(["play-stop"]);
  });

  it("Übergang enabled false → true: Listener wird nachgerüstet", () => {
    cleanupTracker = trackKbActions();
    const { rerender } = renderHook(({ enabled }) => useGlobalKeyBindings(enabled), {
      initialProps: { enabled: false },
    });
    pressKey({ code: "Space" });
    expect(dispatchedActions).toHaveLength(0);

    rerender({ enabled: true });
    pressKey({ code: "Space" });
    expect(dispatchedActions).toEqual(["play-stop"]);
  });
});

// ─── Default-Combos für jede Action-Kategorie ────────────────────────────────

describe("useGlobalKeyBindings – Default-Combos", () => {
  beforeEach(() => {
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings());
  });

  it("Ctrl+R → record", () => {
    pressKey({ code: "KeyR", ctrlKey: true });
    expect(dispatchedActions).toEqual(["record"]);
  });

  it("Alt+R → toggle-note-repeat (NICHT record — Ctrl-Flag ist different)", () => {
    pressKey({ code: "KeyR", altKey: true });
    expect(dispatchedActions).toEqual(["toggle-note-repeat"]);
  });

  it("Ctrl+Shift+R → pattern-randomize (NICHT record)", () => {
    pressKey({ code: "KeyR", ctrlKey: true, shiftKey: true });
    expect(dispatchedActions).toEqual(["pattern-randomize"]);
  });

  it("F1 → tab-sequencer", () => {
    pressKey({ code: "F1" });
    expect(dispatchedActions).toEqual(["tab-sequencer"]);
  });

  it("ArrowUp ohne Modifier → part-up", () => {
    pressKey({ code: "ArrowUp" });
    expect(dispatchedActions).toEqual(["part-up"]);
  });

  it("Ctrl+ArrowRight → pattern-next (NICHT part-up Kollision)", () => {
    pressKey({ code: "ArrowRight", ctrlKey: true });
    expect(dispatchedActions).toEqual(["pattern-next"]);
  });

  it("Shift+Equal → bpm-up-10 (NICHT bpm-up)", () => {
    pressKey({ code: "Equal", shiftKey: true });
    expect(dispatchedActions).toEqual(["bpm-up-10"]);
  });

  it("Equal ohne Modifier → bpm-up", () => {
    pressKey({ code: "Equal" });
    expect(dispatchedActions).toEqual(["bpm-up"]);
  });
});

// ─── User-Overrides via getAllBindings ───────────────────────────────────────

describe("useGlobalKeyBindings – User-Override", () => {
  it("User-Override beats default combo", () => {
    // User mappt "play-stop" auf KeyP
    bindingsRef.current = { "play-stop": { code: "KeyP" } };
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings());

    pressKey({ code: "KeyP" });
    expect(dispatchedActions).toEqual(["play-stop"]);

    // Space (alter Default) triggert play-stop nicht mehr — aber Space ist
    // sonst auch keine andere Action, also kein Crash
    dispatchedActions.length = 0;
    pressKey({ code: "Space" });
    expect(dispatchedActions).toEqual([]);
  });

  it("User-Override mit Modifier-Kombo", () => {
    bindingsRef.current = { "tap-tempo": { code: "KeyB", ctrl: true, alt: true } };
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings());

    pressKey({ code: "KeyB", ctrlKey: true, altKey: true });
    expect(dispatchedActions).toEqual(["tap-tempo"]);
  });

  it("KeyT (Default für tap-tempo) wird ignoriert wenn Override greift", () => {
    bindingsRef.current = { "tap-tempo": { code: "KeyB" } };
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings());

    pressKey({ code: "KeyT" });
    expect(dispatchedActions).toEqual([]);
  });
});

// ─── Input-Element-Bypass ────────────────────────────────────────────────────

describe("useGlobalKeyBindings – Input-Bypass", () => {
  beforeEach(() => {
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings());
  });

  it("HTMLInputElement focus: keydown wird NICHT abgefangen", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    pressKey({ code: "Space", target: input });
    expect(dispatchedActions).toEqual([]);
  });

  it("HTMLTextAreaElement focus: keydown wird NICHT abgefangen", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    pressKey({ code: "Space", target: ta });
    expect(dispatchedActions).toEqual([]);
  });

  it("contentEditable=true Element: keydown wird NICHT abgefangen", () => {
    // jsdom: isContentEditable wird über die Property gesetzt, nicht das Attribut.
    // Wir overriden die getter, weil jsdom isContentEditable nicht voll
    // unterstützt (issue #6027).
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(div);
    pressKey({ code: "Space", target: div });
    expect(dispatchedActions).toEqual([]);
  });

  it("Normales <button>-Element: keydown wird abgefangen (kein Bypass)", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    pressKey({ code: "Space", target: btn });
    expect(dispatchedActions).toEqual(["play-stop"]);
  });
});

// ─── preventDefault + Single-Action-pro-Keystroke ────────────────────────────

describe("useGlobalKeyBindings – preventDefault + No-Overlap", () => {
  beforeEach(() => {
    cleanupTracker = trackKbActions();
    renderHook(() => useGlobalKeyBindings());
  });

  it("Matching key: preventDefault wird aufgerufen", () => {
    const event = pressKey({ code: "Space" });
    expect(event.defaultPrevented).toBe(true);
  });

  it("Non-matching key: preventDefault wird NICHT aufgerufen", () => {
    const event = pressKey({ code: "KeyW" }); // keine Action gemappt
    expect(event.defaultPrevented).toBe(false);
    expect(dispatchedActions).toEqual([]);
  });

  it("Nur die ERSTE matching action wird dispatched (return early)", () => {
    // KeyR mit ctrl+shift matcht 'pattern-randomize', NICHT auch record (das wäre nur ctrl)
    // → 1 Action dispatched
    pressKey({ code: "KeyR", ctrlKey: true, shiftKey: true });
    expect(dispatchedActions).toHaveLength(1);
  });
});

// ─── Unmount ─────────────────────────────────────────────────────────────────

describe("useGlobalKeyBindings – Unmount", () => {
  it("Listener wird beim Unmount entfernt", () => {
    cleanupTracker = trackKbActions();
    const { unmount } = renderHook(() => useGlobalKeyBindings());
    pressKey({ code: "Space" });
    expect(dispatchedActions).toEqual(["play-stop"]);

    unmount();
    dispatchedActions.length = 0;
    pressKey({ code: "Space" });
    expect(dispatchedActions).toEqual([]);
  });
});

// ─── CustomEvent-Detail ──────────────────────────────────────────────────────

describe("useGlobalKeyBindings – CustomEvent-Detail", () => {
  it("KB_ACTION_EVENT trägt action.id in event.detail", () => {
    const received: unknown[] = [];
    const handler = (e: Event) => received.push((e as CustomEvent).detail);
    window.addEventListener(KB_ACTION_EVENT, handler);
    try {
      renderHook(() => useGlobalKeyBindings());
      pressKey({ code: "F2" });
      expect(received).toEqual(["tab-mixer"]);
    } finally {
      window.removeEventListener(KB_ACTION_EVENT, handler);
    }
  });

  it("Event-Name ist exakt 'kb:action'", () => {
    expect(KB_ACTION_EVENT).toBe("kb:action");
  });
});
