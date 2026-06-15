/**
 * tests/features/performance-selector.test.ts (TASK-263)
 *
 * Testet die additive Selektor-Subscription `usePerformancePads()` /
 * `usePerformanceSelector()` von usePerformanceStore. Perf-Hebel: MacroPanel
 * abonnierte via `usePerformanceStore()` den kompletten View, liest aber nur
 * `.pads` — jeder `queuePattern`/`clearQueue`/`setQuantizeMode` löste einen
 * unnötigen Rerender aus, weil diese `notify`en ohne `_pads` zu ändern.
 *
 * Verifiziert: (a) Slice-Korrektheit, (b) Equality-Short-Circuit (stabile
 * Referenz + kein spuriöser Rerender bei Queue-/Quantize-Changes), (c)
 * Verhalten/Persistenz unverändert.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  usePerformancePads,
  usePerformanceSelector,
  setPadAt,
  queuePattern,
  clearQueue,
  setQuantizeMode,
  getPads,
  __resetPerformanceStoreForTests,
  PAD_COUNT,
} from "@/store/usePerformanceStore";

beforeEach(() => {
  __resetPerformanceStoreForTests();
});

describe("usePerformancePads – Slice-Korrektheit (a)", () => {
  it("liefert genau die PAD_COUNT Slots aus dem Store", () => {
    const { result } = renderHook(() => usePerformancePads());
    expect(result.current).toHaveLength(PAD_COUNT);
    expect(result.current).toBe(getPads());
  });

  it("spiegelt einen setPadAt-Change im Slice wider", () => {
    const { result } = renderHook(() => usePerformancePads());
    act(() => setPadAt(3, { kind: "pattern", patternId: "p-1" }));
    expect(result.current[3]?.patternId).toBe("p-1");
  });

  it("usePerformanceSelector kann eine beliebige Scheibe lesen (quantizeMode)", () => {
    const { result } = renderHook(() => usePerformanceSelector((s) => s.quantizeMode));
    expect(result.current).toBe("bar");
    act(() => setQuantizeMode("beat"));
    expect(result.current).toBe("beat");
  });
});

describe("usePerformancePads – Equality-Short-Circuit (b)", () => {
  it("gibt eine STABILE Referenz zurück wenn sich kein Pad ändert (queuePattern)", () => {
    const { result, rerender } = renderHook(() => usePerformancePads());
    const before = result.current;
    act(() => queuePattern("p-queue")); // berührt nur _queuedPatternId, nicht _pads
    rerender();
    expect(result.current).toBe(before); // Object.is-Bail-out
  });

  it("rendert MacroPanel-artigen Consumer NICHT neu bei Queue-/Quantize-Changes", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return usePerformancePads();
    });
    const start = renders;
    act(() => queuePattern("p-1"));     // queue → _pads unverändert
    act(() => clearQueue());            // queue clear → _pads unverändert
    act(() => setQuantizeMode("step")); // quantize → _pads unverändert
    expect(renders).toBe(start);
  });

  it("rendert genau einmal neu bei echtem Pad-Change", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return usePerformancePads();
    });
    const start = renders;
    act(() => setPadAt(0, { kind: "pattern", patternId: "p-x" }));
    expect(renders).toBe(start + 1);
    expect(result.current[0]?.patternId).toBe("p-x");
  });
});

describe("usePerformancePads – Verhalten/Persistenz unverändert (c)", () => {
  it("getPads() (Pull-Pfad) bleibt mit dem Selektor-Slice konsistent", () => {
    const { result } = renderHook(() => usePerformancePads());
    act(() => setPadAt(5, { kind: "pattern", patternId: "p-5" }));
    expect(result.current).toBe(getPads());
    expect(result.current[5]?.patternId).toBe("p-5");
  });

  it("setQuantizeMode validiert weiterhin (invalider Mode = no-op)", () => {
    const { result } = renderHook(() => usePerformanceSelector((s) => s.quantizeMode));
    act(() => setQuantizeMode("beat"));
    // @ts-expect-error invalider Mode wird defensiv ignoriert
    act(() => setQuantizeMode("nope"));
    expect(result.current).toBe("beat");
  });
});
