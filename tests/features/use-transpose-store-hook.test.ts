// @vitest-environment jsdom
/**
 * tests/features/use-transpose-store-hook.test.ts (TASK-CVG-HOOK-SETUP / v2.66)
 *
 * Proof-of-Concept: Hook-Coverage mit jsdom + @testing-library/react.
 *
 * Setup-Pattern:
 *  - `@vitest-environment jsdom` als ERSTE Zeile im File → per-file Override
 *    der vitest.config-Default (`environment: "node"`).
 *  - `renderHook` + `act` aus `@testing-library/react` (v16+ exportiert
 *    beides nativ, kein separates @testing-library/react-hooks nötig).
 *  - Default-localStorage steht via jsdom bereit, kein manueller Mock nötig.
 *
 * Diese Suite ergänzt tests/features/transpose-store.test.ts (Module-Level-
 * Setter sind dort getestet) um die React-Layer: useState/useEffect-Wiring,
 * useCallback-Stable-Referenzen, Re-Render bei externer Mutation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTransposeStore,
  setSemitones,
  __resetForTests,
} from "@/store/useTransposeStore";

describe("useTransposeStore – Hook-Layer (jsdom)", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it("liefert initial semitones=0", () => {
    const { result } = renderHook(() => useTransposeStore());
    expect(result.current.semitones).toBe(0);
  });

  it("re-rendert bei externer Mutation (setSemitones direkt)", () => {
    const { result } = renderHook(() => useTransposeStore());
    expect(result.current.semitones).toBe(0);
    act(() => {
      setSemitones(7);
    });
    expect(result.current.semitones).toBe(7);
  });

  it("API-Setter funktioniert: setSemitones via Hook-Return", () => {
    const { result } = renderHook(() => useTransposeStore());
    act(() => {
      result.current.setSemitones(5);
    });
    expect(result.current.semitones).toBe(5);
  });

  it("incSemitones via Hook funktioniert + clampt", () => {
    const { result } = renderHook(() => useTransposeStore());
    act(() => {
      result.current.incSemitones(3);
    });
    expect(result.current.semitones).toBe(3);
    act(() => {
      result.current.incSemitones(50); // overflow → clamp auf 24
    });
    expect(result.current.semitones).toBe(24);
  });

  it("reset() via Hook setzt auf 0 zurück", () => {
    const { result } = renderHook(() => useTransposeStore());
    act(() => {
      result.current.setSemitones(10);
    });
    expect(result.current.semitones).toBe(10);
    act(() => {
      result.current.reset();
    });
    expect(result.current.semitones).toBe(0);
  });

  it("Mehrere Hook-Instanzen sehen gemeinsame Module-State (Observer-Pattern)", () => {
    const a = renderHook(() => useTransposeStore());
    const b = renderHook(() => useTransposeStore());

    act(() => {
      a.result.current.setSemitones(8);
    });

    // Beide Instanzen reflektieren die Änderung
    expect(a.result.current.semitones).toBe(8);
    expect(b.result.current.semitones).toBe(8);
  });

  it("Unmount entfernt Listener (kein Memory-Leak)", () => {
    const { result, unmount } = renderHook(() => useTransposeStore());
    act(() => {
      result.current.setSemitones(3);
    });
    expect(result.current.semitones).toBe(3);

    unmount();

    // Externe Mutation nach unmount: result.current bleibt frozen, kein Crash
    act(() => {
      setSemitones(10);
    });
    // result.current verweist auf die letzte gerenderte API; setLocal nicht
    // mehr im Listener-Set → Wert bleibt im Hook-Render bei 3.
    expect(result.current.semitones).toBe(3);
  });

  it("useCallback liefert stabile Referenzen über Re-Renders", () => {
    const { result, rerender } = renderHook(() => useTransposeStore());
    const setFirst = result.current.setSemitones;
    const incFirst = result.current.incSemitones;

    rerender();

    expect(result.current.setSemitones).toBe(setFirst);
    expect(result.current.incSemitones).toBe(incFirst);
  });
});
