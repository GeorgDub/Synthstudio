// @vitest-environment jsdom
/**
 * tests/features/use-resizable-panel-hook.test.ts (TASK-CVG-USE-RESIZE / v2.71)
 *
 * Hook-Coverage für useResizablePanel — Drag-Handler + persistent Height
 * via localStorage. Tests dispatchen synthetische MouseEvent auf window
 * (jsdom) und konstruieren ein minimales React.MouseEvent-kompatibles
 * Objekt für den handleMouseDown-Aufruf.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useResizablePanel } from "@/hooks/useResizablePanel";

// ─── Test-Helper ─────────────────────────────────────────────────────────────

interface MinimalReactMouseEvent {
  clientY: number;
  preventDefault: () => void;
}

function makeReactMouseEvent(clientY: number): MinimalReactMouseEvent {
  return { clientY, preventDefault: vi.fn() };
}

function dispatchMouseMove(clientY: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientY, bubbles: true }));
}

function dispatchMouseUp() {
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ─── Initial-Height ──────────────────────────────────────────────────────────

describe("useResizablePanel – Initial-Height", () => {
  it("Ohne storageKey: liefert defaultHeight", () => {
    const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
    expect(result.current.height).toBe(200);
  });

  it("Mit storageKey + leerem localStorage: liefert defaultHeight", () => {
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-1",
    }));
    expect(result.current.height).toBe(200);
  });

  it("Mit gespeichertem Wert IM Range: liefert den gespeicherten Wert", () => {
    localStorage.setItem("panel-1", "300");
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-1",
    }));
    expect(result.current.height).toBe(300);
  });

  it("Stored < minHeight: Fallback auf defaultHeight (Schema-Defensive)", () => {
    localStorage.setItem("panel-1", "10");
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, minHeight: 60, storageKey: "panel-1",
    }));
    expect(result.current.height).toBe(200);
  });

  it("Stored > maxHeight: Fallback auf defaultHeight", () => {
    localStorage.setItem("panel-1", "9999");
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, maxHeight: 600, storageKey: "panel-1",
    }));
    expect(result.current.height).toBe(200);
  });

  it("Stored ist NaN/non-number: Fallback auf defaultHeight", () => {
    localStorage.setItem("panel-1", "not-a-number");
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-1",
    }));
    expect(result.current.height).toBe(200);
  });

  it("Stored exakt am minHeight-Rand: wird akzeptiert", () => {
    localStorage.setItem("panel-1", "60");
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, minHeight: 60, storageKey: "panel-1",
    }));
    expect(result.current.height).toBe(60);
  });

  it("Stored exakt am maxHeight-Rand: wird akzeptiert", () => {
    localStorage.setItem("panel-1", "600");
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, maxHeight: 600, storageKey: "panel-1",
    }));
    expect(result.current.height).toBe(600);
  });
});

// ─── Drag-Verhalten: direction="up" ──────────────────────────────────────────

describe("useResizablePanel – direction='up' (Default, Panel wächst nach oben)", () => {
  it("Maus nach oben gezogen (clientY sinkt) → Panel wächst", () => {
    const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(500) as unknown as React.MouseEvent));
    // Maus von 500 → 400 (100px nach oben). direction="up" → delta = 500-400 = +100
    act(() => dispatchMouseMove(400));
    expect(result.current.height).toBe(300); // 200 + 100
    act(() => dispatchMouseUp());
  });

  it("Maus nach unten gezogen (clientY steigt) → Panel schrumpft", () => {
    const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(300) as unknown as React.MouseEvent));
    // Maus von 300 → 350 (50px nach unten). direction="up" → delta = 300-350 = -50
    act(() => dispatchMouseMove(350));
    expect(result.current.height).toBe(150); // 200 - 50
    act(() => dispatchMouseUp());
  });
});

// ─── Drag-Verhalten: direction="down" ────────────────────────────────────────

describe("useResizablePanel – direction='down' (Panel wächst nach unten)", () => {
  it("Maus nach unten gezogen → Panel wächst", () => {
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, direction: "down",
    }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(300) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(380));
    expect(result.current.height).toBe(280); // 200 + 80
    act(() => dispatchMouseUp());
  });

  it("Maus nach oben gezogen → Panel schrumpft", () => {
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, direction: "down",
    }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(500) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(450));
    expect(result.current.height).toBe(150); // 200 - 50
    act(() => dispatchMouseUp());
  });
});

// ─── Clamping ────────────────────────────────────────────────────────────────

describe("useResizablePanel – Min/Max Clamping", () => {
  it("Mouse-Move clampt nicht unter minHeight", () => {
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 100, minHeight: 60,
    }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(300) as unknown as React.MouseEvent));
    // Riesiger Move nach unten in direction='up' = Panel schrumpft stark
    act(() => dispatchMouseMove(1000));
    expect(result.current.height).toBe(60); // clamped
    act(() => dispatchMouseUp());
  });

  it("Mouse-Move clampt nicht über maxHeight", () => {
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 500, maxHeight: 600,
    }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(500) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(0));
    expect(result.current.height).toBe(600); // clamped
    act(() => dispatchMouseUp());
  });

  it("Default Min/Max: 60 / 600", () => {
    const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(500) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(-1000));
    expect(result.current.height).toBe(600); // hits default max
    act(() => dispatchMouseUp());
  });
});

// ─── preventDefault ──────────────────────────────────────────────────────────

describe("useResizablePanel – preventDefault on Down", () => {
  it("handleMouseDown ruft preventDefault auf dem React-Event", () => {
    const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
    const event = makeReactMouseEvent(300);
    act(() => result.current.handleMouseDown(event as unknown as React.MouseEvent));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    act(() => dispatchMouseUp());
  });
});

// ─── Listener-Cleanup ────────────────────────────────────────────────────────

describe("useResizablePanel – Listener-Cleanup", () => {
  it("Nach MouseUp werden mousemove + mouseup von window entfernt", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
      act(() => result.current.handleMouseDown(makeReactMouseEvent(300) as unknown as React.MouseEvent));
      expect(addSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));

      act(() => dispatchMouseUp());
      expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("Nach MouseUp: weitere MouseMove-Events haben KEINEN Effekt mehr", () => {
    const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(300) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(250));
    const heightDuringDrag = result.current.height;
    act(() => dispatchMouseUp());

    act(() => dispatchMouseMove(0));
    expect(result.current.height).toBe(heightDuringDrag);
  });
});

// ─── localStorage-Persistenz ─────────────────────────────────────────────────

describe("useResizablePanel – Persistenz on Mouse-Up", () => {
  it("Ohne storageKey: localStorage bleibt unverändert", () => {
    const { result } = renderHook(() => useResizablePanel({ defaultHeight: 200 }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(300) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(200));
    act(() => dispatchMouseUp());
    expect(localStorage.length).toBe(0);
  });

  it("Mit storageKey: localStorage wird auf MouseUp mit finaler Drag-Höhe beschrieben", () => {
    const { result } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-test",
    }));
    act(() => result.current.handleMouseDown(makeReactMouseEvent(500) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(400));
    act(() => dispatchMouseUp());
    // Fix (v2.71+): onMove pflegt currentHeight closure-lokal, onUp persistiert die
    // tatsächlich gedragte Höhe statt startHRef.current (Pre-Drag-Wert).
    expect(localStorage.getItem("panel-test")).toBe("300");
  });

  it("Reload nach Drag: gespeicherte Drag-Höhe wird beim nächsten Mount übernommen", () => {
    const { result: r1 } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-reload",
    }));
    act(() => r1.current.handleMouseDown(makeReactMouseEvent(500) as unknown as React.MouseEvent));
    act(() => dispatchMouseMove(400));
    act(() => dispatchMouseUp());
    expect(r1.current.height).toBe(300);

    cleanup();

    const { result: r2 } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-reload",
    }));
    expect(r2.current.height).toBe(300);
  });
});

// ─── Reload-Round-Trip via storageKey ────────────────────────────────────────

describe("useResizablePanel – Reload-Round-Trip", () => {
  it("Hardcoded valid value im localStorage wird beim nächsten Mount wieder gelesen", () => {
    localStorage.setItem("panel-rt", "350");
    const { result: r1 } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-rt",
    }));
    expect(r1.current.height).toBe(350);

    cleanup();

    const { result: r2 } = renderHook(() => useResizablePanel({
      defaultHeight: 200, storageKey: "panel-rt",
    }));
    expect(r2.current.height).toBe(350);
  });
});
