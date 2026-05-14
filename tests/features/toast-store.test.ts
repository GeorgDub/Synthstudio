/**
 * tests/features/toast-store.test.ts
 *
 * v2.5: Toast-Notification-Store Unit-Tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  toast,
  dismissToast,
  clearAllToasts,
  getToasts,
  __resetToastsForTests,
} from "../../client/src/store/useToastStore";

beforeEach(() => {
  __resetToastsForTests();
});

describe("useToastStore (v2.5)", () => {
  it("toast() fügt einen Eintrag hinzu", () => {
    toast("Hello");
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].message).toBe("Hello");
  });

  it("default kind ist 'info', default duration 3000", () => {
    toast("X");
    const t = getToasts()[0];
    expect(t.kind).toBe("info");
    expect(t.duration).toBe(3000);
  });

  it("kind + duration werden übernommen", () => {
    toast("Y", { kind: "success", duration: 5000 });
    const t = getToasts()[0];
    expect(t.kind).toBe("success");
    expect(t.duration).toBe(5000);
  });

  it("Auto-Dismiss nach duration", () => {
    vi.useFakeTimers();
    toast("X", { kind: "info", duration: 1000 });
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(getToasts()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("duration=0 → sticky (kein Auto-Dismiss)", () => {
    vi.useFakeTimers();
    toast("Sticky", { duration: 0 });
    vi.advanceTimersByTime(10000);
    expect(getToasts()).toHaveLength(1);
    vi.useRealTimers();
  });

  it("dismissToast entfernt per ID", () => {
    const id = toast("Z");
    expect(getToasts()).toHaveLength(1);
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
  });

  it("dismissToast mit unbekannter ID → no-op", () => {
    toast("X");
    dismissToast("nicht-existent");
    expect(getToasts()).toHaveLength(1);
  });

  it("clearAllToasts entfernt alle", () => {
    toast("a"); toast("b"); toast("c");
    expect(getToasts()).toHaveLength(3);
    clearAllToasts();
    expect(getToasts()).toHaveLength(0);
  });

  it("max 5 Toasts — älteste werden gedroppt", () => {
    for (let i = 0; i < 10; i++) toast(`T${i}`);
    const list = getToasts();
    expect(list).toHaveLength(5);
    // Älteste (T0..T4) sind weg, neueste (T5..T9) sind drin
    expect(list[0].message).toBe("T5");
    expect(list[4].message).toBe("T9");
  });

  it("jeder Toast bekommt eine eindeutige ID", () => {
    const id1 = toast("a");
    const id2 = toast("b");
    const id3 = toast("c");
    expect(new Set([id1, id2, id3]).size).toBe(3);
  });

  it("toast gibt die neue ID zurück", () => {
    const id = toast("Hi");
    expect(getToasts()[0].id).toBe(id);
  });
});
