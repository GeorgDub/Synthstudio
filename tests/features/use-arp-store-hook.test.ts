// @vitest-environment jsdom
/**
 * tests/features/use-arp-store-hook.test.ts (TASK-CVG-HOOK-SETUP / v2.66)
 *
 * Zweiter jsdom-Hook-Test (nach use-transpose-store-hook.test.ts) — beweist
 * dass das Setup für arbiträre Singleton-Observer-Stores wiederverwendbar
 * ist. useArpStore hat ein anderes Pattern als useTransposeStore:
 *   - useReducer-basierter Re-Render statt useState
 *   - State-Snapshot direkt zurückgegeben (keine Action-Funktionen im Hook)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useArpStore,
  setArpEnabled,
  setArpMode,
  setArpNotes,
  setArpVelocityPattern,
  getArpSteps,
  __resetArpForTests,
} from "@/store/useArpStore";

describe("useArpStore – Hook-Layer (jsdom)", () => {
  beforeEach(() => {
    __resetArpForTests();
  });

  it("liefert initial Default-State", () => {
    const { result } = renderHook(() => useArpStore());
    expect(result.current.enabled).toBe(false);
    expect(result.current.mode).toBe("up");
    expect(result.current.notes).toEqual([60, 64, 67]);
    expect(result.current.stepCount).toBe(16);
  });

  it("re-rendert bei externer setArpEnabled-Mutation", () => {
    const { result } = renderHook(() => useArpStore());
    expect(result.current.enabled).toBe(false);
    act(() => {
      setArpEnabled(true);
    });
    expect(result.current.enabled).toBe(true);
  });

  it("re-rendert bei setArpMode-Wechsel", () => {
    const { result } = renderHook(() => useArpStore());
    act(() => {
      setArpMode("down");
    });
    expect(result.current.mode).toBe("down");
  });

  it("re-rendert bei setArpNotes (Array-Update)", () => {
    const { result } = renderHook(() => useArpStore());
    act(() => {
      setArpNotes([72, 76, 79]);
    });
    expect(result.current.notes).toEqual([72, 76, 79]);
  });

  it("Mehrere Hook-Instanzen sehen gleichen Module-State", () => {
    const a = renderHook(() => useArpStore());
    const b = renderHook(() => useArpStore());
    act(() => {
      setArpMode("random");
    });
    expect(a.result.current.mode).toBe("random");
    expect(b.result.current.mode).toBe("random");
  });

  it("velocityPattern: Default 'flat', setArpVelocityPattern re-rendert", () => {
    const { result } = renderHook(() => useArpStore());
    expect(result.current.velocityPattern).toBe("flat");
    act(() => {
      setArpVelocityPattern("accent24");
    });
    expect(result.current.velocityPattern).toBe("accent24");
  });

  it("velocityPattern wirkt auf getArpSteps (vorher tot: UI-Buttons waren no-op)", () => {
    // 'flat' → alle aktiven Steps gleiche Velocity.
    setArpVelocityPattern("flat");
    const flat = getArpSteps().filter((s) => s.active).map((s) => s.velocity);
    expect(new Set(flat).size).toBe(1);

    // 'crescendo' → ansteigende Velocity, also mehrere verschiedene Werte.
    setArpVelocityPattern("crescendo");
    const cres = getArpSteps().filter((s) => s.active).map((s) => s.velocity);
    expect(new Set(cres).size).toBeGreaterThan(1);
  });

  it("Unmount entfernt Listener — keine Re-Renders nach Cleanup", () => {
    const { result, unmount } = renderHook(() => useArpStore());
    act(() => {
      setArpEnabled(true);
    });
    expect(result.current.enabled).toBe(true);

    unmount();

    // Listener weg → result.current bleibt mit dem letzten Render-State
    act(() => {
      setArpEnabled(false);
    });
    expect(result.current.enabled).toBe(true); // frozen seit unmount
  });
});
