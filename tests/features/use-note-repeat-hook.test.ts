// @vitest-environment jsdom
/**
 * tests/features/use-note-repeat-hook.test.ts (TASK-CVG-USE-NR / v2.69)
 *
 * Hook-Coverage für useNoteRepeat — Live-Pad-Player mit MPC-Style
 * Note-Repeat. Pattern: vi.useFakeTimers + vi.advanceTimersByTime, damit
 * setInterval-Ticks deterministisch + synchron getriggert werden.
 *
 * Mock-Strategie: useNoteRepeatStore bleibt echt (Pure-Store, schon
 * getestet in note-repeat-store.test.ts). Externe Dependencies sind
 * sonst nur safeIntervalMs (pure-util).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useNoteRepeat } from "@/hooks/useNoteRepeat";
import {
  setNoteRepeatEnabled,
  setNoteRepeatRate,
  __resetForTests as resetNoteRepeatStore,
} from "@/store/useNoteRepeatStore";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetNoteRepeatStore();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ─── enabled=false (Default): nur Initial-Trigger, kein Interval ─────────────

describe("useNoteRepeat – enabled=false (Default)", () => {
  it("padDown triggert genau einmal — kein Interval", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));

    act(() => result.current.padDown("pad-1"));
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith("pad-1");

    // 500ms vergehen → keine weiteren Trigger
    act(() => { vi.advanceTimersByTime(500); });
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("padUp ohne aktivem Interval ist no-op", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => result.current.padUp("pad-1"));
    // Keine Error, kein Effekt
    expect(trigger).not.toHaveBeenCalled();
  });
});

// ─── enabled=true: Initial-Trigger + Interval-Ticks ──────────────────────────

describe("useNoteRepeat – enabled=true mit Default rate=1/16", () => {
  function setup() {
    const trigger = vi.fn();
    const hook = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));
    return { trigger, hook };
  }

  it("padDown triggert sofort + Interval-Ticks bei 1/16 @ 120 BPM = 125ms", () => {
    const { trigger, hook } = setup();
    act(() => hook.result.current.padDown("pad-1"));
    expect(trigger).toHaveBeenCalledTimes(1); // immediate

    // 125ms → 1 Tick
    act(() => { vi.advanceTimersByTime(125); });
    expect(trigger).toHaveBeenCalledTimes(2);

    // weitere 375ms (gesamt 500) → 3 weitere Ticks (250/375/500)
    act(() => { vi.advanceTimersByTime(375); });
    expect(trigger).toHaveBeenCalledTimes(5); // 1 immediate + 4 ticks
  });

  it("padUp stoppt das Interval", () => {
    const { trigger, hook } = setup();
    act(() => hook.result.current.padDown("pad-1"));
    act(() => { vi.advanceTimersByTime(250); });
    expect(trigger).toHaveBeenCalledTimes(3); // 1 immediate + 2 ticks

    act(() => hook.result.current.padUp("pad-1"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(trigger).toHaveBeenCalledTimes(3); // keine weiteren Trigger
  });

  it("padDown auf gleichen Pad zweimal → alter Interval wird ersetzt (kein Stacking)", () => {
    const { trigger, hook } = setup();
    act(() => hook.result.current.padDown("pad-1"));
    act(() => { vi.advanceTimersByTime(125); });
    expect(trigger).toHaveBeenCalledTimes(2);

    // Zweiter padDown auf den gleichen Pad — alter Interval ersetzt, immediate-trigger
    act(() => hook.result.current.padDown("pad-1"));
    expect(trigger).toHaveBeenCalledTimes(3);

    act(() => { vi.advanceTimersByTime(125); });
    // Nur ein Tick (vom NEUEN Interval), nicht zwei
    expect(trigger).toHaveBeenCalledTimes(4);
  });
});

// ─── Multi-Pad-Support ───────────────────────────────────────────────────────

describe("useNoteRepeat – Multi-Pad", () => {
  it("Zwei Pads gleichzeitig haben unabhängige Intervals", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));

    act(() => result.current.padDown("pad-A"));
    act(() => result.current.padDown("pad-B"));
    expect(trigger).toHaveBeenCalledTimes(2); // beide immediate

    act(() => { vi.advanceTimersByTime(125); });
    // Beide Intervals ticken → 2 weitere Calls
    expect(trigger).toHaveBeenCalledTimes(4);
    expect(trigger).toHaveBeenCalledWith("pad-A");
    expect(trigger).toHaveBeenCalledWith("pad-B");
  });

  it("padUp eines Pads stoppt nur dessen Interval, andere laufen weiter", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));

    act(() => result.current.padDown("pad-A"));
    act(() => result.current.padDown("pad-B"));
    expect(trigger).toHaveBeenCalledTimes(2);

    act(() => result.current.padUp("pad-A"));

    trigger.mockClear();
    act(() => { vi.advanceTimersByTime(125); });
    expect(trigger).toHaveBeenCalledTimes(1); // nur B tickt
    expect(trigger).toHaveBeenCalledWith("pad-B");
  });

  it("stopAll cleared alle aktiven Intervals", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));

    act(() => result.current.padDown("pad-A"));
    act(() => result.current.padDown("pad-B"));
    trigger.mockClear();

    act(() => result.current.stopAll());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(trigger).not.toHaveBeenCalled();
  });
});

// ─── Store-getriebene Resets ─────────────────────────────────────────────────

describe("useNoteRepeat – Store-Mutationen", () => {
  it("Globales Disable (enabled true → false) stoppt alle Repeats", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));
    act(() => result.current.padDown("pad-1"));
    trigger.mockClear();

    act(() => setNoteRepeatEnabled(false));
    act(() => { vi.advanceTimersByTime(500); });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("Rate-Wechsel stoppt laufende Intervals (kein Mismatch zur neuen Rate)", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));
    act(() => result.current.padDown("pad-1"));
    trigger.mockClear();

    act(() => setNoteRepeatRate("1/8")); // 250ms statt 125ms
    // Interval wurde geclearet; ohne erneuten padDown läuft nichts weiter
    act(() => { vi.advanceTimersByTime(500); });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("BPM-Wechsel stoppt laufende Intervals", () => {
    const trigger = vi.fn();
    const { rerender, result } = renderHook(
      ({ bpm }: { bpm: number }) => useNoteRepeat({ trigger, bpm }),
      { initialProps: { bpm: 120 } },
    );
    act(() => setNoteRepeatEnabled(true));
    act(() => result.current.padDown("pad-1"));
    trigger.mockClear();

    rerender({ bpm: 140 });
    act(() => { vi.advanceTimersByTime(500); });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("Neuer Rate-Wert → padDown nutzt neue Rate (1/8 @ 120 BPM = 250ms)", () => {
    const trigger = vi.fn();
    const { result } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));
    act(() => setNoteRepeatRate("1/8"));

    act(() => result.current.padDown("pad-1"));
    expect(trigger).toHaveBeenCalledTimes(1);

    // 125ms (alte rate) → KEIN tick
    act(() => { vi.advanceTimersByTime(125); });
    expect(trigger).toHaveBeenCalledTimes(1);

    // weitere 125ms (gesamt 250) → 1 tick
    act(() => { vi.advanceTimersByTime(125); });
    expect(trigger).toHaveBeenCalledTimes(2);
  });
});

// ─── trigger-Ref Update (latest closure) ─────────────────────────────────────

describe("useNoteRepeat – trigger-Ref", () => {
  it("Trigger-Funktion wird via Ref aktuell gehalten — kein Stale-Closure", () => {
    const trigger1 = vi.fn();
    const trigger2 = vi.fn();
    const { rerender, result } = renderHook(
      ({ trigger }: { trigger: (id: string) => void }) =>
        useNoteRepeat({ trigger, bpm: 120 }),
      { initialProps: { trigger: trigger1 as (id: string) => void } },
    );
    act(() => setNoteRepeatEnabled(true));
    act(() => result.current.padDown("pad-1"));
    expect(trigger1).toHaveBeenCalledTimes(1);

    // Trigger ersetzen — KEIN neues padDown
    rerender({ trigger: trigger2 as (id: string) => void });

    // Next tick: das laufende Interval wurde durch Rate/BPM-Effect gecleart?
    // Nein — trigger ist nicht in den Deps. Interval läuft weiter, ruft via Ref
    // jetzt trigger2 auf.
    act(() => { vi.advanceTimersByTime(125); });
    expect(trigger2).toHaveBeenCalledTimes(1);
  });
});

// ─── Unmount-Cleanup ─────────────────────────────────────────────────────────

describe("useNoteRepeat – Unmount", () => {
  it("Unmount clearet alle aktiven Intervals", () => {
    const trigger = vi.fn();
    const { result, unmount } = renderHook(() => useNoteRepeat({ trigger, bpm: 120 }));
    act(() => setNoteRepeatEnabled(true));
    act(() => result.current.padDown("pad-A"));
    act(() => result.current.padDown("pad-B"));
    trigger.mockClear();

    unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(trigger).not.toHaveBeenCalled();
  });
});
