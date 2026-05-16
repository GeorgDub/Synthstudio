// @vitest-environment jsdom
/**
 * tests/features/use-midi-step-input-hook.test.ts (TASK-CVG-USE-MIDISTEP / v2.75)
 *
 * Hook-Coverage für useMidiStepInput — Step-Eingabe via MIDI-Keyboard.
 * Lauscht auf 'stepinput:noteon' CustomEvent (von useMidi dispatched) und
 * dispatched seinerseits 'stepinput:note' mit aktueller Cursor-Position.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useMidiStepInput } from "@/hooks/useMidiStepInput";

interface StepInputDetail {
  partId: string;
  stepIndex: number;
  note: number;
  velocity: number;
}

const dispatched: StepInputDetail[] = [];
let unsub: (() => void) | null = null;

function trackStepInputEvents() {
  const handler = (e: Event) => {
    dispatched.push((e as CustomEvent<StepInputDetail>).detail);
  };
  window.addEventListener("stepinput:note", handler);
  unsub = () => window.removeEventListener("stepinput:note", handler);
}

function fireNoteOn(note: number, velocity = 100) {
  window.dispatchEvent(new CustomEvent("stepinput:noteon", {
    detail: { note, velocity },
  }));
}

beforeEach(() => {
  dispatched.length = 0;
  trackStepInputEvents();
});

afterEach(() => {
  unsub?.();
  unsub = null;
  cleanup();
});

// ─── Initial-State ───────────────────────────────────────────────────────────

describe("useMidiStepInput – Initial-State", () => {
  it("cursor startet bei 0", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    expect(result.current.cursor).toBe(0);
  });
});

// ─── enabled-Guard ───────────────────────────────────────────────────────────

describe("useMidiStepInput – enabled-Guard", () => {
  it("enabled=false: noteon-Event triggert KEIN dispatch", () => {
    renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: false,
    }));
    fireNoteOn(60);
    expect(dispatched).toEqual([]);
  });

  it("enabled=true + partId=null: noteon-Event triggert KEIN dispatch", () => {
    renderHook(() => useMidiStepInput({
      partId: null, stepCount: 16, enabled: true,
    }));
    fireNoteOn(60);
    expect(dispatched).toEqual([]);
  });

  it("enabled false→true: Listener wird angefügt", () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useMidiStepInput({ partId: "p1", stepCount: 16, enabled }),
      { initialProps: { enabled: false } },
    );
    fireNoteOn(60);
    expect(dispatched).toEqual([]);

    rerender({ enabled: true });
    fireNoteOn(64);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].note).toBe(64);
  });
});

// ─── Note-On Dispatch ────────────────────────────────────────────────────────

describe("useMidiStepInput – Note-On Dispatch", () => {
  it("dispatcht 'stepinput:note' mit detail.{partId, stepIndex, note, velocity}", () => {
    renderHook(() => useMidiStepInput({
      partId: "drum-kick", stepCount: 16, enabled: true,
    }));
    fireNoteOn(60, 110);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual({
      partId: "drum-kick",
      stepIndex: 0,
      note: 60,
      velocity: 110,
    });
  });

  it("Cursor rückt nach jedem Trigger einen Step vor", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    expect(result.current.cursor).toBe(0);

    act(() => fireNoteOn(60));
    expect(result.current.cursor).toBe(1);
    expect(dispatched[0].stepIndex).toBe(0);

    act(() => fireNoteOn(64));
    expect(result.current.cursor).toBe(2);
    expect(dispatched[1].stepIndex).toBe(1);
  });

  it("Wrap-around bei stepCount-Erreichen: stepCount-1 → 0", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 4, enabled: true,
    }));
    act(() => fireNoteOn(60));
    act(() => fireNoteOn(60));
    act(() => fireNoteOn(60));
    expect(result.current.cursor).toBe(3);
    expect(dispatched[2].stepIndex).toBe(2);

    act(() => fireNoteOn(60));
    expect(result.current.cursor).toBe(0); // wrap
    expect(dispatched[3].stepIndex).toBe(3);
  });
});

// ─── resetCursor + moveCursor ────────────────────────────────────────────────

describe("useMidiStepInput – Cursor-API", () => {
  it("resetCursor setzt cursor auf 0", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    act(() => fireNoteOn(60));
    act(() => fireNoteOn(60));
    expect(result.current.cursor).toBe(2);
    act(() => result.current.resetCursor());
    expect(result.current.cursor).toBe(0);
  });

  it("moveCursor(+5) bewegt um +5", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    act(() => result.current.moveCursor(5));
    expect(result.current.cursor).toBe(5);
  });

  it("moveCursor(-3) mit cursor=0 wrappt auf stepCount-3", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    act(() => result.current.moveCursor(-3));
    expect(result.current.cursor).toBe(13);
  });

  it("moveCursor(stepCount) ist no-op-Wrap auf gleiche Position", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    act(() => result.current.moveCursor(5));
    act(() => result.current.moveCursor(16));
    expect(result.current.cursor).toBe(5);
  });

  it("moveCursor(+20) mit stepCount=16 wrappt korrekt", () => {
    const { result } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    act(() => result.current.moveCursor(20));
    expect(result.current.cursor).toBe(4); // 0+20 mod 16 = 4
  });
});

// ─── Unmount ─────────────────────────────────────────────────────────────────

describe("useMidiStepInput – Unmount", () => {
  it("Window-Listener wird beim Unmount entfernt", () => {
    const { result, unmount } = renderHook(() => useMidiStepInput({
      partId: "p1", stepCount: 16, enabled: true,
    }));
    act(() => fireNoteOn(60));
    expect(dispatched).toHaveLength(1);
    expect(result.current.cursor).toBe(1);

    unmount();
    fireNoteOn(64);
    expect(dispatched).toHaveLength(1); // KEIN weiterer dispatch nach unmount
  });
});
