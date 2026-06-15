/**
 * tests/features/metronome-selector.test.ts (TASK-263)
 *
 * Testet die additive Selektor-Subscription `useMetronomeCustomDownbeatUrl()` /
 * `useMetronomeCustomBeatUrl()` / `useMetronomeSelector()` von useMetronomeStore.
 * Perf-Hebel: App.tsx (~5000 Zeilen) abonnierte via `useMetronomeStore()` das
 * komplette State-Objekt, liest aber nur die zwei Custom-Sound-URLs für die
 * AudioEngine-Sync-Effects — jeder Volume-/Tone-/Accent-/BeatsPerBar-Slider-Drag
 * (`updateMetronome` notifyt immer) löste einen App-Tree-Rerender aus.
 *
 * Verifiziert: (a) Slice-Korrektheit, (b) Equality-Short-Circuit (kein
 * spuriöser Rerender bei Nicht-URL-Feldern), (c) Verhalten/Persistenz unverändert.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useMetronomeCustomDownbeatUrl,
  useMetronomeCustomBeatUrl,
  useMetronomeSelector,
  updateMetronome,
  resetMetronome,
  getMetronomeState,
} from "@/store/useMetronomeStore";

beforeEach(() => {
  resetMetronome();
});

describe("useMetronomeCustomDownbeatUrl – Slice-Korrektheit (a)", () => {
  it("liefert initial null und reflektiert updateMetronome", () => {
    const { result } = renderHook(() => useMetronomeCustomDownbeatUrl());
    expect(result.current).toBe(null);
    act(() => updateMetronome({ customDownbeatUrl: "data:audio/wav;base64,AAA" }));
    expect(result.current).toBe("data:audio/wav;base64,AAA");
    expect(getMetronomeState().customDownbeatUrl).toBe("data:audio/wav;base64,AAA");
  });

  it("useMetronomeCustomBeatUrl liest die Beat-URL unabhängig vom Downbeat", () => {
    const { result } = renderHook(() => useMetronomeCustomBeatUrl());
    expect(result.current).toBe(null);
    act(() => updateMetronome({ customBeatUrl: "data:audio/wav;base64,BBB" }));
    expect(result.current).toBe("data:audio/wav;base64,BBB");
  });

  it("useMetronomeSelector kann eine beliebige Scheibe lesen (volume)", () => {
    const { result } = renderHook(() => useMetronomeSelector((s) => s.volume));
    expect(result.current).toBe(0.5);
    act(() => updateMetronome({ volume: 0.8 }));
    expect(result.current).toBe(0.8);
  });
});

describe("useMetronomeCustomDownbeatUrl – Equality-Short-Circuit (b)", () => {
  it("rendert NICHT neu wenn sich nur Nicht-URL-Felder ändern", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useMetronomeCustomDownbeatUrl();
    });
    const start = renders;
    // volume/tone/accent/beatsPerBar betreffen die Downbeat-URL nicht → Object.is
    act(() => updateMetronome({ volume: 0.9 }));
    act(() => updateMetronome({ tone: 0.2 }));
    act(() => updateMetronome({ accent: 1.5 }));
    act(() => updateMetronome({ beatsPerBar: 3 }));
    expect(renders).toBe(start);
    expect(result.current).toBe(null);
  });

  it("rendert genau einmal neu bei echtem URL-Wechsel", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useMetronomeCustomDownbeatUrl();
    });
    const start = renders;
    act(() => updateMetronome({ customDownbeatUrl: "data:audio/wav;base64,CCC" }));
    expect(renders).toBe(start + 1);
  });
});

describe("useMetronomeCustomDownbeatUrl – Verhalten/Persistenz unverändert (c)", () => {
  it("getMetronomeState bleibt mit dem Selektor konsistent (Volume-Edit ändert URL nicht)", () => {
    const { result } = renderHook(() => useMetronomeCustomDownbeatUrl());
    act(() => updateMetronome({ volume: 0.33 }));
    expect(getMetronomeState().volume).toBe(0.33);
    expect(result.current).toBe(getMetronomeState().customDownbeatUrl);
  });

  it("resetMetronome setzt die URL zurück und benachrichtigt den Selektor-Consumer", () => {
    const { result } = renderHook(() => useMetronomeCustomDownbeatUrl());
    act(() => updateMetronome({ customDownbeatUrl: "data:audio/wav;base64,DDD" }));
    expect(result.current).toBe("data:audio/wav;base64,DDD");
    act(() => resetMetronome());
    expect(result.current).toBe(null);
  });
});
