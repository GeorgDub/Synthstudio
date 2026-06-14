/**
 * tests/features/macro-selector.test.ts (TASK-253)
 *
 * Testet die additive Selektor-Subscription `useMacroValues()` / `useMacroSelector()`
 * von useMacroStore — der Perf-Hebel, der App.tsx (~5000 Zeilen) entkoppelt:
 * App abonniert nur noch die abgeleiteten Macro-WERTE statt des kompletten
 * macros-Arrays und re-rendert nicht mehr bei Label-/Binding-/Mode-Änderungen.
 *
 * Verifiziert: (a) Slice-Korrektheit, (b) Equality-Short-Circuit (stabile
 * Referenz + kein spurioser Rerender), (c) Verhalten/Persistenz unverändert.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useMacroValues,
  useMacroSelector,
  setMacroValue,
  setMacroLabel,
  resetMacros,
  getMacros,
  MACRO_COUNT,
} from "@/store/useMacroStore";

beforeEach(() => {
  resetMacros();
});

describe("useMacroValues – Slice-Korrektheit (a)", () => {
  it("liefert genau die MACRO_COUNT Werte aus dem Store", () => {
    const { result } = renderHook(() => useMacroValues());
    expect(result.current).toHaveLength(MACRO_COUNT);
    expect(result.current).toEqual(getMacros().map((m) => m.value));
  });

  it("spiegelt einen setMacroValue-Change im Slice wider", () => {
    const { result } = renderHook(() => useMacroValues());
    act(() => setMacroValue(2, 0.75));
    expect(result.current[2]).toBe(0.75);
  });
});

describe("useMacroValues – Equality-Short-Circuit (b)", () => {
  it("gibt eine STABILE Referenz zurück wenn sich kein Wert ändert (Label-Edit)", () => {
    const { result, rerender } = renderHook(() => useMacroValues());
    const before = result.current;
    // Label-Change ändert KEINEN Wert → Slice muss referenziell stabil bleiben.
    act(() => setMacroLabel(0, "Neues Label"));
    rerender();
    expect(result.current).toBe(before); // Object.is-Bail-out → kein Rerender
  });

  it("rendert den Consumer NICHT neu bei einem Label-Edit, aber schon bei Wert-Change", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useMacroValues();
    });
    const initialRenders = renders;
    act(() => setMacroLabel(1, "X")); // Wert unverändert → kein Rerender
    expect(renders).toBe(initialRenders);
    act(() => setMacroValue(1, 0.5)); // echter Wert-Change → genau ein Rerender
    expect(renders).toBe(initialRenders + 1);
    expect(result.current[1]).toBe(0.5);
  });

  it("useMacroSelector mit skalarem Selektor nutzt Object.is-Bail-out", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useMacroSelector((macros) => macros[0].value);
    });
    const start = renders;
    act(() => setMacroValue(3, 0.9)); // anderer Index → Selektor-Wert unverändert
    expect(renders).toBe(start);
    expect(result.current).toBe(0);
  });
});

describe("useMacroValues – Verhalten/Persistenz unverändert (c)", () => {
  it("setMacroValue clamped weiterhin auf 0..1 (Slice respektiert das)", () => {
    const { result } = renderHook(() => useMacroValues());
    act(() => setMacroValue(0, 2.5));
    expect(result.current[0]).toBe(1);
    act(() => setMacroValue(0, -1));
    expect(result.current[0]).toBe(0);
  });

  it("getMacros() (Pull-Pfad) bleibt mit dem Selektor-Slice konsistent", () => {
    const { result } = renderHook(() => useMacroValues());
    act(() => setMacroValue(4, 0.33));
    expect(result.current).toEqual(getMacros().map((m) => m.value));
  });
});
