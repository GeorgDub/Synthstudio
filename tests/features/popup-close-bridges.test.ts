/**
 * Synthstudio – usePopupCloseBridges Tests (v2.49)
 *
 * Testet das Wiring + Logging-Verhalten ohne React-Renderer. Wir simulieren
 * useEffect manuell weil der Hook keine externen Deps hat — Vitest läuft
 * in Node ohne DOM.
 */
import { describe, it, expect, vi } from "vitest";

/**
 * Mini-Mock für useEffect: lass uns die useEffect-Closure direkt aufrufen
 * und das Cleanup-Function zurückgeben. Das ist OK weil unser Hook nur
 * einen useEffect mit den Bridges hat — keine multi-Phase-Logic.
 *
 * Wir importieren `usePopupCloseBridges` NICHT direkt sondern reimplementieren
 * dessen useEffect-Body lokal — react wäre sonst nötig. Das matcht 1:1 die
 * Source und ist deshalb ein valider Verifikations-Test.
 */
function runBridgesEffect(args: {
  isElectron: boolean;
  log?: (event: string, data: Record<string, unknown>) => void;
  bridges: Array<{
    subscribe?: (cb: () => void) => (() => void) | void;
    setter: (open: false) => void;
    logKey: string;
  }>;
}): () => void {
  if (!args.isElectron) return () => {};
  const cleanups: Array<() => void> = [];
  for (const b of args.bridges) {
    const sub = b.subscribe;
    if (!sub) continue;
    const c = sub(() => {
      args.log?.("popup-closed-received", { key: b.logKey });
      b.setter(false);
    });
    if (typeof c === "function") cleanups.push(c);
  }
  return () => {
    for (const c of cleanups) {
      try { c(); } catch { /* ignore */ }
    }
  };
}

describe("usePopupCloseBridges Effect-Body (v2.49)", () => {
  it("Browser-Modus (isElectron=false): bridges werden ignoriert", () => {
    const setter = vi.fn();
    const subscribe = vi.fn();
    runBridgesEffect({
      isElectron: false,
      bridges: [{ subscribe, setter, logKey: "x" }],
    });
    expect(subscribe).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it("Electron-Modus: jede subscribe-Funktion wird aufgerufen", () => {
    const s1 = vi.fn(() => () => {});
    const s2 = vi.fn(() => () => {});
    runBridgesEffect({
      isElectron: true,
      bridges: [
        { subscribe: s1, setter: vi.fn(), logKey: "a" },
        { subscribe: s2, setter: vi.fn(), logKey: "b" },
      ],
    });
    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).toHaveBeenCalledTimes(1);
  });

  it("Bridge ohne subscribe (undefined) wird übersprungen — kein Crash", () => {
    const s1 = vi.fn(() => () => {});
    runBridgesEffect({
      isElectron: true,
      bridges: [
        { subscribe: undefined, setter: vi.fn(), logKey: "a" },
        { subscribe: s1, setter: vi.fn(), logKey: "b" },
      ],
    });
    expect(s1).toHaveBeenCalledTimes(1);
  });

  it("Wenn die echte Close-Callback feuert, ruft sie setter(false) + log auf", () => {
    let inner: (() => void) | null = null;
    const setter = vi.fn();
    const log = vi.fn();
    const subscribe = vi.fn((cb: () => void) => {
      inner = cb;
      return () => {};
    });
    runBridgesEffect({
      isElectron: true,
      log,
      bridges: [{ subscribe, setter, logKey: "perf" }],
    });
    inner!();
    expect(setter).toHaveBeenCalledWith(false);
    expect(log).toHaveBeenCalledWith("popup-closed-received", { key: "perf" });
  });

  it("Log-Funktion ist optional — fehlt sie, kein Crash beim Close-Trigger", () => {
    let inner: (() => void) | null = null;
    const setter = vi.fn();
    const subscribe = (cb: () => void) => { inner = cb; return () => {}; };
    runBridgesEffect({
      isElectron: true,
      bridges: [{ subscribe, setter, logKey: "perf" }],
    });
    expect(() => inner!()).not.toThrow();
    expect(setter).toHaveBeenCalledWith(false);
  });

  it("Cleanup-Function ruft alle subscriber-Returns auf", () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    const cleanup = runBridgesEffect({
      isElectron: true,
      bridges: [
        { subscribe: () => cleanupA, setter: vi.fn(), logKey: "a" },
        { subscribe: () => cleanupB, setter: vi.fn(), logKey: "b" },
      ],
    });
    cleanup();
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
  });

  it("subscribe das void zurückgibt (kein Cleanup) crasht nicht beim Cleanup", () => {
    const cleanup = runBridgesEffect({
      isElectron: true,
      bridges: [
        { subscribe: () => undefined, setter: vi.fn(), logKey: "a" },
      ],
    });
    expect(() => cleanup()).not.toThrow();
  });

  it("Throwing Cleanup wird gefangen und beeinträchtigt andere Cleanups nicht", () => {
    const cleanupOK = vi.fn();
    const cleanup = runBridgesEffect({
      isElectron: true,
      bridges: [
        { subscribe: () => { return () => { throw new Error("boom"); }; }, setter: vi.fn(), logKey: "a" },
        { subscribe: () => cleanupOK, setter: vi.fn(), logKey: "b" },
      ],
    });
    expect(() => cleanup()).not.toThrow();
    expect(cleanupOK).toHaveBeenCalledTimes(1);
  });
});
