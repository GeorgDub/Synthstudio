/**
 * tests/features/tempo-map-integration.test.ts (v3.96.0)
 *
 * Integration-Tests fuer den v3.96.0-Wire-Up der Tempo-Map:
 *   1. Resolver-Callback liefert korrekte BPM ueber den Pure-Helper.
 *   2. restoreProject-Logik (data.tempoMap -> replaceEvents) lädt Events
 *      und respektiert das Pre-v1.35 "undefined"-Signal (localStorage
 *      bleibt unangetastet, wenn das Feld nicht im File ist).
 *   3. Playhead-Update-Mechanismus: currentBar wird aus currentStep/16
 *      abgeleitet und triggert NUR bei Bar-Wechsel ein Update (keine
 *      unnoetigen Re-Renders).
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (vor Store-Import) ────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  addEvent,
  replaceEvents,
  getTempoMapState,
  __resetTempoMapForTests,
  type TempoEvent,
} from "../../client/src/store/useTempoMapStore";

import { getCurrentBpm } from "../../client/src/utils/tempoMap";

// ─── 1. Resolver-Callback liefert korrekte BPM ───────────────────────────────

describe("v3.96.0 Wire-Up – setTempoMapResolver callback", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetTempoMapForTests();
  });

  it("Resolver-Closure liefert das aktuelle BPM aus dem Store", () => {
    // Setup: Store-Events, Resolver-Closure wie in App.tsx useEffect.
    addEvent(0, 120);
    addEvent(16, 140);
    const resolver = (atBar: number) =>
      getCurrentBpm(getTempoMapState().events, atBar);

    expect(resolver(0)).toBe(120);
    expect(resolver(8)).toBe(120);
    expect(resolver(16)).toBe(140);
    expect(resolver(32)).toBe(140);
  });

  it("Resolver gibt null bei leerer Map → Engine nutzt Fallback-BPM", () => {
    const resolver = (atBar: number) =>
      getCurrentBpm(getTempoMapState().events, atBar);
    expect(resolver(0)).toBe(null);
    expect(resolver(100)).toBe(null);
  });

  it("Resolver folgt Live-Updates (Store-Mutation reflektiert sich sofort)", () => {
    const resolver = (atBar: number) =>
      getCurrentBpm(getTempoMapState().events, atBar);
    expect(resolver(0)).toBe(null);
    addEvent(0, 100);
    expect(resolver(0)).toBe(100);
    addEvent(0, 150); // overrideId same bar -> update
    expect(resolver(0)).toBe(150);
  });

  it("Resolver respektiert ramp-Interpolation (linear)", () => {
    addEvent(0, 100);
    addEvent(10, 200, true);
    const resolver = (atBar: number) =>
      getCurrentBpm(getTempoMapState().events, atBar);
    expect(resolver(5)).toBe(150);
  });
});

// ─── 2. restoreProject lädt tempoMap-Events ──────────────────────────────────

describe("v3.96.0 Wire-Up – restoreProject lädt tempoMap-Events", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetTempoMapForTests();
  });

  it("setAllTempoEvents([...]) überschreibt komplette Map (wie im Restore-Pfad)", () => {
    // Seed: existierende Events im Store
    addEvent(0, 100);
    addEvent(8, 110);
    expect(getTempoMapState().events).toHaveLength(2);

    // Restore-Pfad: data.tempoMap aus .synth-File wird durch replaceEvents
    // geladen (analog setAllMidiFxNodes / loadAudioTracks-Pattern).
    const restored: TempoEvent[] = [
      { atBar: 0, bpm: 120 },
      { atBar: 16, bpm: 130, ramp: true },
      { atBar: 32, bpm: 140 },
    ];
    replaceEvents(restored);

    const state = getTempoMapState();
    expect(state.events).toHaveLength(3);
    expect(state.events[0].bpm).toBe(120);
    expect(state.events[1].ramp).toBe(true);
    expect(state.events[2].atBar).toBe(32);
  });

  it("Pre-v1.35-Pfad: kein replaceEvents-Aufruf bei undefined → localStorage intakt", () => {
    addEvent(8, 135);
    const beforeRestore = getTempoMapState().events.length;

    // Simulation der App.tsx-Logik: if (data.tempoMap !== undefined) setAll...
    const data: { tempoMap?: TempoEvent[] } = {};
    if (data.tempoMap !== undefined) {
      replaceEvents(data.tempoMap);
    }

    expect(getTempoMapState().events.length).toBe(beforeRestore);
    expect(getTempoMapState().events[0].bpm).toBe(135);
  });

  it("Explicit [] respektieren → Map wird geleert (User-Intent)", () => {
    addEvent(0, 120);
    const data: { tempoMap?: TempoEvent[] } = { tempoMap: [] };
    if (data.tempoMap !== undefined) {
      replaceEvents(data.tempoMap);
    }
    expect(getTempoMapState().events).toHaveLength(0);
  });
});

// ─── 3. Playhead-Update-Mechanismus ─────────────────────────────────────────

describe("v3.96.0 Wire-Up – currentBar Update-Mechanism", () => {
  it("currentBar = floor(currentStep / 16) korrekt berechnet", () => {
    // Pattern: 16 Steps = 1 Bar (Default)
    const stepToBar = (step: number) => Math.floor(step / 16);
    expect(stepToBar(0)).toBe(0);
    expect(stepToBar(7)).toBe(0);
    expect(stepToBar(15)).toBe(0);
    expect(stepToBar(16)).toBe(1);
    expect(stepToBar(31)).toBe(1);
    expect(stepToBar(32)).toBe(2);
  });

  it("currentBar update triggert NUR bei Bar-Wechsel (keine spurious updates)", () => {
    // Simuliert die useState((prev) => prev === bar ? prev : bar) Optimierung
    let lastBar = -1;
    let updateCount = 0;
    const setBar = (bar: number) => {
      if (lastBar !== bar) {
        lastBar = bar;
        updateCount++;
      }
    };
    // 32 Steps lang ticken (= 2 Bars), erwartet exakt 2 Updates (Bar 0 + Bar 1).
    for (let step = 0; step < 32; step++) {
      const bar = Math.floor(step / 16);
      setBar(bar);
    }
    expect(updateCount).toBe(2);
    expect(lastBar).toBe(1);
  });

  it("Bar-Wechsel + Resolver liefert das richtige BPM zur richtigen Zeit", () => {
    addEvent(0, 100);
    addEvent(4, 200);
    const resolver = (bar: number) =>
      getCurrentBpm(getTempoMapState().events, bar);
    // Playhead schiebt durch Bars 0..6, jedes Mal die effektive BPM lesen.
    const series = [0, 1, 2, 3, 4, 5, 6].map((b) => resolver(b));
    expect(series).toEqual([100, 100, 100, 100, 200, 200, 200]);
  });
});
