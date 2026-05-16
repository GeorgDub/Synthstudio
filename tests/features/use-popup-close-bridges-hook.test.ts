// @vitest-environment jsdom
/**
 * tests/features/use-popup-close-bridges-hook.test.ts (TASK-CVG-USE-POPUP / v2.73)
 *
 * Hook-Coverage für usePopupCloseBridges via renderHook (komplementär zu
 * tests/features/popup-close-bridges.test.ts der den Effect-Body 1:1 als
 * Reimplementierung testet — der echte Hook-Code wurde dort nie importiert).
 *
 * Verifiziert über die echte useEffect-Pipeline:
 *  - Browser-Modus (isElectron=false) → keine subscribes
 *  - Electron-Modus → subscribe per Bridge, Cleanup beim Unmount
 *  - Subscribe-Callback dispatched log + setter(false)
 *  - Bridges ohne subscribe übersprungen
 *  - Subscribe der void zurückgibt: kein cleanup, kein Crash
 *  - Multiple Bridges = independent subscribers
 *  - log ist optional
 *  - useEffect-Dep [isElectron]: false→true triggert re-subscribe,
 *    bridges-Mutation NICHT (intentional eingebaute "wire-once"-Semantik)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  usePopupCloseBridges,
  type PopupCloseBridge,
} from "@/hooks/usePopupCloseBridges";

afterEach(() => cleanup());

// ─── Browser-Fallback ────────────────────────────────────────────────────────

describe("usePopupCloseBridges – Browser-Modus", () => {
  it("isElectron=false: subscribe wird NIE aufgerufen", () => {
    const subscribe = vi.fn(() => () => {});
    const setter = vi.fn();
    renderHook(() => usePopupCloseBridges({
      isElectron: false,
      bridges: [{ subscribe, setter, logKey: "x" }],
    }));
    expect(subscribe).not.toHaveBeenCalled();
  });
});

// ─── Electron-Modus: subscribe ───────────────────────────────────────────────

describe("usePopupCloseBridges – Electron-Modus", () => {
  it("Eine Bridge: subscribe wird genau einmal aufgerufen", () => {
    const subscribe = vi.fn(() => () => {});
    renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [{ subscribe, setter: vi.fn(), logKey: "k" }],
    }));
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(typeof subscribe.mock.calls[0][0]).toBe("function");
  });

  it("Multi-Bridge: jeder subscribe wird einmal aufgerufen", () => {
    const subs = [vi.fn(() => () => {}), vi.fn(() => () => {}), vi.fn(() => () => {})];
    const bridges: PopupCloseBridge[] = subs.map((s, i) => ({
      subscribe: s,
      setter: vi.fn(),
      logKey: `k${i}`,
    }));
    renderHook(() => usePopupCloseBridges({ isElectron: true, bridges }));
    subs.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
  });

  it("Bridge ohne subscribe (undefined): wird übersprungen, andere bleiben aktiv", () => {
    const subActive = vi.fn(() => () => {});
    renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [
        { subscribe: undefined, setter: vi.fn(), logKey: "skip" },
        { subscribe: subActive, setter: vi.fn(), logKey: "active" },
      ],
    }));
    expect(subActive).toHaveBeenCalledTimes(1);
  });
});

// ─── Callback-Verhalten: log + setter ────────────────────────────────────────

describe("usePopupCloseBridges – Callback-Verhalten", () => {
  it("Trigger des subscribe-Callbacks ruft log + setter(false)", () => {
    let captured: (() => void) | null = null;
    const subscribe = vi.fn((cb: () => void) => {
      captured = cb;
      return () => {};
    });
    const setter = vi.fn();
    const log = vi.fn();
    renderHook(() => usePopupCloseBridges({
      isElectron: true,
      log,
      bridges: [{ subscribe, setter, logKey: "perf" }],
    }));

    expect(captured).not.toBeNull();
    act(() => captured!());
    expect(log).toHaveBeenCalledWith("popup-closed-received", { key: "perf" });
    expect(setter).toHaveBeenCalledWith(false);
  });

  it("Setter wird mit literalem `false` aufgerufen (nicht 0/null/undefined)", () => {
    let captured: (() => void) | null = null;
    const setter = vi.fn();
    renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [{
        subscribe: (cb) => { captured = cb; return () => {}; },
        setter,
        logKey: "k",
      }],
    }));
    act(() => captured!());
    expect(setter).toHaveBeenCalledWith(false);
    expect(setter.mock.calls[0][0]).toBe(false);
  });

  it("log ist optional — fehlender log crasht nicht", () => {
    let captured: (() => void) | null = null;
    const setter = vi.fn();
    renderHook(() => usePopupCloseBridges({
      isElectron: true,
      // kein log
      bridges: [{
        subscribe: (cb) => { captured = cb; return () => {}; },
        setter,
        logKey: "k",
      }],
    }));
    expect(() => act(() => captured!())).not.toThrow();
    expect(setter).toHaveBeenCalledWith(false);
  });

  it("logKey wird pro Bridge separat geforwarded (nicht gemixt)", () => {
    const captures: Array<() => void> = [];
    const subscribe = (cb: () => void) => {
      captures.push(cb);
      return () => {};
    };
    const log = vi.fn();
    renderHook(() => usePopupCloseBridges({
      isElectron: true,
      log,
      bridges: [
        { subscribe, setter: vi.fn(), logKey: "perf" },
        { subscribe, setter: vi.fn(), logKey: "mixer" },
      ],
    }));
    act(() => captures[0]());
    act(() => captures[1]());
    expect(log).toHaveBeenNthCalledWith(1, "popup-closed-received", { key: "perf" });
    expect(log).toHaveBeenNthCalledWith(2, "popup-closed-received", { key: "mixer" });
  });

  it("Independent setters: Bridge-A trigger setzt nur setter-A nicht setter-B", () => {
    const captures: Array<() => void> = [];
    const subscribe = (cb: () => void) => {
      captures.push(cb);
      return () => {};
    };
    const setterA = vi.fn();
    const setterB = vi.fn();
    renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [
        { subscribe, setter: setterA, logKey: "a" },
        { subscribe, setter: setterB, logKey: "b" },
      ],
    }));
    act(() => captures[0]());
    expect(setterA).toHaveBeenCalledTimes(1);
    expect(setterB).not.toHaveBeenCalled();
  });
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

describe("usePopupCloseBridges – Cleanup beim Unmount", () => {
  it("Cleanup-Function aus subscribe wird beim Unmount aufgerufen", () => {
    const cleanupSpy = vi.fn();
    const { unmount } = renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [{
        subscribe: () => cleanupSpy,
        setter: vi.fn(),
        logKey: "k",
      }],
    }));
    expect(cleanupSpy).not.toHaveBeenCalled();
    unmount();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it("Multi-Bridge Cleanups werden alle aufgerufen", () => {
    const c1 = vi.fn();
    const c2 = vi.fn();
    const c3 = vi.fn();
    const { unmount } = renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [
        { subscribe: () => c1, setter: vi.fn(), logKey: "1" },
        { subscribe: () => c2, setter: vi.fn(), logKey: "2" },
        { subscribe: () => c3, setter: vi.fn(), logKey: "3" },
      ],
    }));
    unmount();
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
    expect(c3).toHaveBeenCalledTimes(1);
  });

  it("Subscribe ohne return-Function (void): kein cleanup, kein Crash beim Unmount", () => {
    const { unmount } = renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [{
        subscribe: () => { /* void return */ },
        setter: vi.fn(),
        logKey: "k",
      }],
    }));
    expect(() => unmount()).not.toThrow();
  });

  it("Cleanup einer Bridge wirft → andere Cleanups laufen trotzdem (try/catch)", () => {
    const c1 = vi.fn(() => { throw new Error("boom"); });
    const c2 = vi.fn();
    const { unmount } = renderHook(() => usePopupCloseBridges({
      isElectron: true,
      bridges: [
        { subscribe: () => c1, setter: vi.fn(), logKey: "broken" },
        { subscribe: () => c2, setter: vi.fn(), logKey: "fine" },
      ],
    }));
    expect(() => unmount()).not.toThrow();
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
  });
});

// ─── Dep-Array [isElectron] ──────────────────────────────────────────────────

describe("usePopupCloseBridges – useEffect-Dep [isElectron]", () => {
  it("isElectron false→true: subscribe wird beim re-run aufgerufen", () => {
    const subscribe = vi.fn(() => () => {});
    const { rerender } = renderHook(
      ({ isElectron }: { isElectron: boolean }) =>
        usePopupCloseBridges({
          isElectron,
          bridges: [{ subscribe, setter: vi.fn(), logKey: "k" }],
        }),
      { initialProps: { isElectron: false } },
    );
    expect(subscribe).not.toHaveBeenCalled();
    rerender({ isElectron: true });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("isElectron true→false: cleanup wird ausgeführt (effect-teardown)", () => {
    const cleanupSpy = vi.fn();
    const { rerender } = renderHook(
      ({ isElectron }: { isElectron: boolean }) =>
        usePopupCloseBridges({
          isElectron,
          bridges: [{
            subscribe: () => cleanupSpy,
            setter: vi.fn(),
            logKey: "k",
          }],
        }),
      { initialProps: { isElectron: true } },
    );
    expect(cleanupSpy).not.toHaveBeenCalled();
    rerender({ isElectron: false });
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it("bridges-Mutation OHNE isElectron-Wechsel: NICHT re-subscribed (wire-once)", () => {
    const sub1 = vi.fn(() => () => {});
    const sub2 = vi.fn(() => () => {});
    const { rerender } = renderHook(
      ({ subscribe }: { subscribe: () => () => void }) =>
        usePopupCloseBridges({
          isElectron: true,
          bridges: [{ subscribe, setter: vi.fn(), logKey: "k" }],
        }),
      { initialProps: { subscribe: sub1 } },
    );
    expect(sub1).toHaveBeenCalledTimes(1);

    rerender({ subscribe: sub2 });
    // sub2 NICHT aufgerufen — Effect dep ist nur [isElectron]
    expect(sub2).not.toHaveBeenCalled();
  });
});
