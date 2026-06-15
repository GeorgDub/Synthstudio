/**
 * tests/features/sub-mix-bus-selector.test.ts (TASK-264)
 *
 * Testet die additive Per-Bus-Selektor-Subscription `useSubMixBus(busId)` /
 * `useSubMixSelector()` von useSubMixStore. Perf-Hebel: SubMixBusStrip
 * abonnierte bisher seinen Bus per Prop aus MixerViews voller Store-
 * Subscription → JEDE Bus-Mutation re-renderte ALLE Strips. Mit der per-Bus-
 * Subscription re-rendert ein Strip nur bei Mutation SEINES eigenen Bus.
 *
 * `commit()` weist pro Mutation ein frisches `buses`-Array zu, aber die Setter
 * (`buses.map(b => b.id===id ? {...b} : b)`) behalten die Referenz unveränderter
 * Buses — daher bailt `busesEqual` für Fremd-Bus-Mutationen.
 *
 * Verifiziert: (a) Slice-Korrektheit (liefert richtigen Bus), (b) Bail-out
 * (Fremd-Bus-Mutation → kein Re-Notify, eigene Mutation → genau ein Rerender),
 * (c) Subscribe/Unsubscribe + undefined-Handling (removed bus).
 *
 * 8 Tests in 3 describes.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useSubMixBus,
  useSubMixSelector,
  busesEqual,
  subscribeSubMix,
  createBus,
  setBusVolume,
  setBusMute,
  setBusEq3,
  removeBus,
  getBusById,
  getBuses,
  __resetSubMixStoreForTests,
  type SubMixBus,
} from "@/store/useSubMixStore";

beforeEach(() => {
  __resetSubMixStoreForTests();
});

// ─── (a) Slice-Korrektheit ────────────────────────────────────────────────────

describe("useSubMixBus – Slice-Korrektheit (a)", () => {
  it("liefert genau den Bus mit der angefragten id", () => {
    const idA = createBus("A")!;
    const idB = createBus("B")!;
    const { result: rA } = renderHook(() => useSubMixBus(idA));
    const { result: rB } = renderHook(() => useSubMixBus(idB));
    expect(rA.current?.id).toBe(idA);
    expect(rA.current?.name).toBe("A");
    expect(rB.current?.id).toBe(idB);
    // exakt die Store-Referenz (kein deep-Clone)
    expect(rA.current).toBe(getBusById(idA));
  });

  it("spiegelt eine Mutation des eigenen Bus im Slice wider", () => {
    const id = createBus("Drums")!;
    const { result } = renderHook(() => useSubMixBus(id));
    expect(result.current?.volume).toBe(0.85);
    act(() => setBusVolume(id, 1.4));
    expect(result.current?.volume).toBe(1.4);
  });

  it("useSubMixSelector kann eine beliebige Scheibe lesen (Bus-Count)", () => {
    const { result } = renderHook(() => useSubMixSelector((s) => s.buses.length));
    expect(result.current).toBe(0);
    act(() => { createBus("X"); });
    expect(result.current).toBe(1);
  });
});

// ─── (b) Equality-Bail-out ────────────────────────────────────────────────────

describe("useSubMixBus – Equality-Bail-out (b)", () => {
  it("gibt eine STABILE Referenz zurück wenn ein ANDERER Bus mutiert", () => {
    const idA = createBus("A")!;
    const idB = createBus("B")!;
    const { result, rerender } = renderHook(() => useSubMixBus(idA));
    const before = result.current;
    act(() => setBusVolume(idB, 1.9)); // mutiert NUR Bus B
    rerender();
    expect(result.current).toBe(before); // busesEqual-Bail-out → gleiche Referenz
  });

  it("rendert einen Strip-artigen Consumer NICHT neu bei Fremd-Bus-Mutationen", () => {
    const idA = createBus("A")!;
    const idB = createBus("B")!;
    let renders = 0;
    renderHook(() => {
      renders++;
      return useSubMixBus(idA);
    });
    const start = renders;
    act(() => setBusVolume(idB, 0.2)); // Fremd-Bus
    act(() => setBusMute(idB, true));  // Fremd-Bus
    expect(renders).toBe(start);
  });

  it("rendert genau einmal neu bei echter Mutation des eigenen Bus", () => {
    const id = createBus("A")!;
    createBus("B"); // Rauschen
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useSubMixBus(id);
    });
    const start = renders;
    act(() => setBusMute(id, true));
    expect(renders).toBe(start + 1);
    expect(result.current?.mute).toBe(true);
  });

  it("rendert neu bei fx-Mutation des eigenen Bus (fx-Referenz-Contract)", () => {
    const id = createBus("A")!;
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useSubMixBus(id);
    });
    const start = renders;
    act(() => setBusEq3(id, { lowGain: 6 })); // erzeugt frische fx-Referenz
    expect(renders).toBe(start + 1);
    expect(result.current?.fx?.eq3.lowGain).toBe(6);
  });

  it("busesEqual: skalare Felder per Object.is, channelIds/fx per Referenz, undefined-sicher", () => {
    expect(busesEqual(undefined, undefined)).toBe(true);
    const base = getBusById(createBus("A")!)!;
    expect(busesEqual(base, undefined)).toBe(false);
    expect(busesEqual(base, base)).toBe(true);
    // gleiche Felder + gleiche channelIds/fx-Referenz → equal
    const clone: SubMixBus = { ...base };
    expect(busesEqual(base, clone)).toBe(true);
    // ein skalares Feld unterscheidet sich → not equal
    expect(busesEqual(base, { ...base, volume: base.volume + 0.1 })).toBe(false);
    // neue channelIds-Array-Referenz (echte Mutation) → not equal
    expect(busesEqual(base, { ...base, channelIds: [...base.channelIds] })).toBe(false);
  });
});

// ─── (c) Subscribe/Unsubscribe + undefined-Handling ───────────────────────────

describe("useSubMixBus – Subscribe/Unsubscribe + undefined (c)", () => {
  it("subscribeSubMix registriert + unsubscribed sauber, kein Notify nach unsubscribe", () => {
    const id = createBus("A")!;
    let calls = 0;
    const unsub = subscribeSubMix(() => { calls++; });
    setBusVolume(id, 1.1);
    expect(calls).toBe(1);
    unsub();
    setBusVolume(id, 1.2);
    expect(calls).toBe(1); // kein weiterer Call nach unsubscribe
  });

  it("liefert undefined wenn der Bus entfernt wurde (Post-Remove-Frame)", () => {
    const id = createBus("A")!;
    const { result } = renderHook(() => useSubMixBus(id));
    expect(result.current?.id).toBe(id);
    act(() => removeBus(id));
    expect(result.current).toBeUndefined();
    expect(getBuses()).toHaveLength(0);
  });

  it("undefined → undefined bailt (keine Endlosschleife, stabile Referenz)", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useSubMixBus("nonexistent-id");
    });
    expect(result.current).toBeUndefined();
    const start = renders;
    act(() => { createBus("Other"); }); // unrelated bus
    expect(result.current).toBeUndefined();
    expect(renders).toBe(start); // busesEqual(undefined, undefined) → kein Rerender
  });
});
