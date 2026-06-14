/**
 * tests/features/arp-selector.test.ts (TASK-253)
 *
 * Testet die additive Selektor-Subscription `useArpEnabled()` / `useArpSelector()`
 * von useArpStore. Perf-Hebel: die 4495-Zeilen-DrumMachine abonnierte via
 * `useArpStore()` das KOMPLETTE Arp-State-Objekt, liest aber nur `enabled` —
 * jeder setArpNotes/setArpMode/… löste einen Full-Rerender aus. Mit dem
 * skalaren `enabled`-Selektor entfällt das.
 *
 * Verifiziert: (a) Slice-Korrektheit, (b) Equality-Short-Circuit (kein
 * spuriöser Rerender bei nicht-enabled-Feldern), (c) Verhalten unverändert.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useArpEnabled,
  useArpSelector,
  setArpEnabled,
  setArpMode,
  setArpNotes,
  setArpOctaves,
  resetArp,
  getArpState,
} from "@/store/useArpStore";

beforeEach(() => {
  resetArp();
});

describe("useArpEnabled – Slice-Korrektheit (a)", () => {
  it("liefert initial false und reflektiert setArpEnabled", () => {
    const { result } = renderHook(() => useArpEnabled());
    expect(result.current).toBe(false);
    act(() => setArpEnabled(true));
    expect(result.current).toBe(true);
    expect(getArpState().enabled).toBe(true);
  });

  it("useArpSelector kann eine beliebige Scheibe lesen (mode)", () => {
    const { result } = renderHook(() => useArpSelector((s) => s.mode));
    expect(result.current).toBe("up");
    act(() => setArpMode("down"));
    expect(result.current).toBe("down");
  });
});

describe("useArpEnabled – Equality-Short-Circuit (b)", () => {
  it("rendert NICHT neu wenn sich nur Nicht-enabled-Felder ändern", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useArpEnabled();
    });
    const start = renders;
    // notes/octaves/mode betreffen `enabled` nicht → kein Rerender (Object.is)
    act(() => setArpNotes([60, 63, 67]));
    act(() => setArpOctaves(2));
    act(() => setArpMode("random"));
    expect(renders).toBe(start);
    expect(result.current).toBe(false);
  });

  it("rendert genau einmal neu bei echtem enabled-Wechsel", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useArpEnabled();
    });
    const start = renders;
    act(() => setArpEnabled(true));
    expect(renders).toBe(start + 1);
  });
});

describe("useArpEnabled – Verhalten unverändert (c)", () => {
  it("getArpState bleibt mit dem Selektor konsistent (Notes-Edit ändert enabled nicht)", () => {
    const { result } = renderHook(() => useArpEnabled());
    act(() => setArpNotes([48, 52, 55, 59]));
    expect(getArpState().notes).toEqual([48, 52, 55, 59]);
    expect(result.current).toBe(getArpState().enabled);
  });

  it("resetArp setzt enabled zurück und benachrichtigt den Selektor-Consumer", () => {
    const { result } = renderHook(() => useArpEnabled());
    act(() => setArpEnabled(true));
    expect(result.current).toBe(true);
    act(() => resetArp());
    expect(result.current).toBe(false);
  });
});
