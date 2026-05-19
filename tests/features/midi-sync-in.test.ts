/**
 * tests/features/midi-sync-in.test.ts (v3.111.0)
 *
 * Unit-Tests fuer MidiSyncIn — KORG-Master-Sync / Hardware-Master-Sync.
 * Schlankere Façade neben MidiClockIn — callback-basiert statt Window-
 * Event-Dispatch, voll Node-tauglich.
 *
 * Test-Setup:
 *   - Pure-Helpers (bpmFromClockIntervalMs / bpmFromIntervals / smoothBpm)
 *     direkt mit Zahlen.
 *   - Klasse mit explizit gesetzten Timestamps + Event-Recorder.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (Node-Test-Setup) ────────────────────────────────────
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => (k in store ? store[k] : null),
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
  MidiSyncIn,
  bpmFromClockIntervalMs,
  bpmFromIntervals,
  smoothBpm,
  PPQN,
  DEFAULT_WINDOW_SIZE,
  MIN_STABLE_SAMPLES,
  RT_CLOCK,
  RT_START,
  RT_STOP,
  RT_CONTINUE,
  RT_ACTIVE_SENSING,
  RT_SYSTEM_RESET,
  type MidiSyncEvent,
  type MidiSyncEventDetail,
} from "../../client/src/audio/MidiSyncIn";
import {
  __resetMidiSyncInStoreForTests,
  getMidiSyncInState,
  setMidiSyncInEnabled,
  setMidiSyncInInputDevice,
  setMidiSyncInAutoStartStop,
  setMidiSyncInSyncTempo,
  setMidiSyncInDetectedBpm,
} from "../../client/src/store/useMidiSyncInStore";

// ─── Pure-Helper-Tests ──────────────────────────────────────────────────────

describe("bpmFromClockIntervalMs", () => {
  it("20.83ms (1 clock @ 120 BPM) → ~120 BPM", () => {
    // 60_000 / (intervalMs * 24) = bpm → intervalMs @120BPM = 60000/(120*24) = 20.833…
    const bpm = bpmFromClockIntervalMs(20.833333);
    expect(bpm).not.toBeNull();
    expect(bpm).toBeCloseTo(120, 1);
  });

  it("10.4167ms (1 clock @ 240 BPM) → ~240 BPM", () => {
    const interval = 60_000 / (240 * PPQN);
    const bpm = bpmFromClockIntervalMs(interval);
    expect(bpm).not.toBeNull();
    expect(bpm).toBeCloseTo(240, 1);
  });

  it("Negative / Zero / NaN → null", () => {
    expect(bpmFromClockIntervalMs(0)).toBeNull();
    expect(bpmFromClockIntervalMs(-5)).toBeNull();
    expect(bpmFromClockIntervalMs(NaN)).toBeNull();
    expect(bpmFromClockIntervalMs(Infinity)).toBeNull();
  });

  it("Out-of-range (extrem niedrig) → null", () => {
    // 1ms-Intervall → 2500 BPM → out-of-range.
    expect(bpmFromClockIntervalMs(1)).toBeNull();
    // 10s-Intervall → 0.25 BPM → out-of-range.
    expect(bpmFromClockIntervalMs(10_000)).toBeNull();
  });
});

describe("bpmFromIntervals", () => {
  it("Empty array → null", () => {
    expect(bpmFromIntervals([])).toBeNull();
  });

  it("Below MIN_STABLE_SAMPLES → null", () => {
    // 5 samples < MIN_STABLE_SAMPLES (6).
    const arr = new Array(MIN_STABLE_SAMPLES - 1).fill(20.833);
    expect(bpmFromIntervals(arr)).toBeNull();
  });

  it("Stable 120 BPM samples → ~120", () => {
    const arr = new Array(16).fill(20.833333);
    const bpm = bpmFromIntervals(arr);
    expect(bpm).not.toBeNull();
    expect(bpm).toBeCloseTo(120, 0);
  });

  it("Window slicing: nur letzte N Werte zaehlen", () => {
    // Erste Haelfte mit unsinnigen Werten, letzte Haelfte stable @ 120.
    const arr = [
      ...new Array(8).fill(100),       // wuerde ~25 BPM ergeben
      ...new Array(16).fill(20.833333),
    ];
    const bpm = bpmFromIntervals(arr, 16);
    expect(bpm).not.toBeNull();
    expect(bpm).toBeCloseTo(120, 0);
  });

  it("Mixed valid+invalid: filtered correctly", () => {
    const arr = [20.833, -1, NaN, Infinity, 20.833, 20.833, 20.833, 20.833, 20.833, 20.833];
    const bpm = bpmFromIntervals(arr, 16);
    expect(bpm).not.toBeNull();
    expect(bpm).toBeCloseTo(120, 0);
  });
});

describe("smoothBpm (EWMA)", () => {
  it("prevBpm===null → returns raw 1:1 (bootstrap)", () => {
    expect(smoothBpm(120, null, 0.2)).toBe(120);
  });

  it("alpha=0 → returns prev (no change)", () => {
    expect(smoothBpm(240, 120, 0)).toBeCloseTo(120, 5);
  });

  it("alpha=1 → returns raw (no smoothing)", () => {
    expect(smoothBpm(240, 120, 1)).toBeCloseTo(240, 5);
  });

  it("alpha=0.1, jump 120→240 → smooth transition", () => {
    // Erster Schritt: 120 * 0.9 + 240 * 0.1 = 132.
    const step1 = smoothBpm(240, 120, 0.1);
    expect(step1).toBeCloseTo(132, 1);
    // Zweiter Schritt: 132 * 0.9 + 240 * 0.1 = 142.8.
    const step2 = smoothBpm(240, step1, 0.1);
    expect(step2).toBeCloseTo(142.8, 1);
    // Nach 50 Iterationen mit alpha=0.1 sollte der Wert > 239 sein
    // (asymptotisch → 240; (1-0.1)^50 ≈ 0.005 · 120 = 0.6 BPM Rest-Lag).
    let cur: number | null = 120;
    for (let i = 0; i < 50; i++) cur = smoothBpm(240, cur, 0.1);
    expect(cur).not.toBeNull();
    expect(cur!).toBeGreaterThan(239);
    // Plausibilitaet: monotoner Anstieg (nie wieder unter Startwert).
    expect(cur!).toBeLessThanOrEqual(240);
  });

  it("Invalid raw → returns prev fallback", () => {
    expect(smoothBpm(NaN, 120, 0.2)).toBe(120);
    expect(smoothBpm(Infinity, 120, 0.2)).toBe(120);
  });

  it("Alpha out-of-range geclamt (z.B. 2.0 → 1)", () => {
    // alpha=2 wird auf 1 geclamt → raw uebernommen.
    expect(smoothBpm(240, 120, 2)).toBeCloseTo(240, 5);
  });
});

// ─── MidiSyncIn-Klasse-Tests ────────────────────────────────────────────────

interface TestEvent {
  event: MidiSyncEvent;
  detail?: MidiSyncEventDetail;
}

function newSync(opts?: ConstructorParameters<typeof MidiSyncIn>[0]): {
  sync: MidiSyncIn;
  events: TestEvent[];
} {
  const events: TestEvent[] = [];
  const sync = new MidiSyncIn(opts);
  sync.onSyncEvent = (event, detail) => events.push({ event, detail });
  return { sync, events };
}

describe("MidiSyncIn — handleClock accumulates intervals", () => {
  it("Akkumuliert Intervalle und stellt Sample-Count bereit", () => {
    const { sync } = newSync();
    sync.enabled = true;
    // 10 Ticks bei 20.833ms (= 120 BPM).
    let t = 1000;
    for (let i = 0; i < 10; i++) {
      sync.handleClock(t);
      t += 20.833;
    }
    // Erster Tick: nur Zeit gemerkt, kein Intervall.
    // Folgende 9: jeweils ein Intervall berechnet.
    expect(sync.getSampleCount()).toBe(9);
  });

  it("Disabled → handleClock no-op", () => {
    const { sync, events } = newSync();
    sync.enabled = false;
    let t = 1000;
    for (let i = 0; i < 30; i++) {
      sync.handleClock(t);
      t += 20.833;
    }
    expect(sync.getSampleCount()).toBe(0);
    expect(sync.getDetectedBpm()).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("Window-Cap haelt maximal windowSize Eintraege", () => {
    const { sync } = newSync({ windowSize: 8 });
    sync.enabled = true;
    let t = 1000;
    for (let i = 0; i < 50; i++) {
      sync.handleClock(t);
      t += 20.833;
    }
    expect(sync.getSampleCount()).toBe(8);
  });

  it("Stable Clock @ 120 BPM → getDetectedBpm() ~ 120", () => {
    const { sync } = newSync({ smoothAlpha: 1 }); // keine EWMA-Glaettung fuer praezisen Test
    sync.enabled = true;
    let t = 1000;
    for (let i = 0; i < 30; i++) {
      sync.handleClock(t);
      t += 60_000 / (120 * PPQN);
    }
    const bpm = sync.getDetectedBpm();
    expect(bpm).not.toBeNull();
    expect(bpm!).toBeCloseTo(120, 0);
  });

  it("BPM-changed wird nur bei signifikanter Aenderung emittiert", () => {
    const { sync, events } = newSync({ smoothAlpha: 1, bpmChangeThreshold: 0.5 });
    sync.enabled = true;
    let t = 1000;
    const dt = 60_000 / (120 * PPQN);
    for (let i = 0; i < 30; i++) {
      sync.handleClock(t);
      t += dt;
    }
    const bpmEvents = events.filter((e) => e.event === "bpm-changed");
    // Bei stabilem Tempo erwarten wir 1 Initial-Event danach kaum Aenderungen.
    expect(bpmEvents.length).toBeGreaterThanOrEqual(1);
    expect(bpmEvents.length).toBeLessThan(5);
  });
});

describe("MidiSyncIn — transport events", () => {
  it("handleStart emits 'start' event", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleStart();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("start");
  });

  it("handleStop emits 'stop' event", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleStop();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("stop");
  });

  it("handleContinue emits 'continue' event", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleContinue();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("continue");
  });

  it("handleStart resettet _lastClockTime (kein 0-Interval-Spike)", () => {
    const { sync } = newSync();
    sync.enabled = true;
    sync.handleClock(1000);
    sync.handleClock(1020.833);
    expect(sync.getLastClockTime()).toBeCloseTo(1020.833, 1);
    sync.handleStart();
    expect(sync.getLastClockTime()).toBe(0);
  });

  it("Disabled → transport handler sind no-op", () => {
    const { sync, events } = newSync();
    sync.enabled = false;
    sync.handleStart();
    sync.handleStop();
    sync.handleContinue();
    expect(events).toHaveLength(0);
  });
});

describe("MidiSyncIn — reset()", () => {
  it("clears intervals + detectedBpm + listener bleibt", () => {
    const { sync, events } = newSync({ smoothAlpha: 1 });
    sync.enabled = true;
    let t = 1000;
    for (let i = 0; i < 30; i++) {
      sync.handleClock(t);
      t += 20.833;
    }
    expect(sync.getDetectedBpm()).not.toBeNull();
    expect(sync.getSampleCount()).toBeGreaterThan(0);
    const beforeEventCount = events.length;
    sync.reset();
    expect(sync.getDetectedBpm()).toBeNull();
    expect(sync.getSampleCount()).toBe(0);
    expect(sync.getLastClockTime()).toBe(0);
    expect(sync.enabled).toBe(true); // enabled bleibt
    // Reset selber emittiert keine Events.
    expect(events.length).toBe(beforeEventCount);
  });
});

describe("MidiSyncIn — handleMessage dispatch", () => {
  it("Status-Byte 0xF8 → handleClock", () => {
    const { sync } = newSync();
    sync.enabled = true;
    sync.handleMessage([RT_CLOCK], 1000);
    sync.handleMessage([RT_CLOCK], 1020.833);
    expect(sync.getSampleCount()).toBe(1);
  });

  it("Status-Byte 0xFA → 'start'-Event", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleMessage([RT_START], 1000);
    expect(events.map((e) => e.event)).toEqual(["start"]);
  });

  it("Status-Byte 0xFC → 'stop'-Event", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleMessage([RT_STOP], 1000);
    expect(events.map((e) => e.event)).toEqual(["stop"]);
  });

  it("Status-Byte 0xFB → 'continue'-Event", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleMessage([RT_CONTINUE], 1000);
    expect(events.map((e) => e.event)).toEqual(["continue"]);
  });

  it("0xFE Active Sensing wird ignoriert", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleMessage([RT_ACTIVE_SENSING], 1000);
    expect(events).toHaveLength(0);
    expect(sync.getSampleCount()).toBe(0);
  });

  it("0xFF System Reset wird ignoriert", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleMessage([RT_SYSTEM_RESET], 1000);
    expect(events).toHaveLength(0);
  });

  it("Empty / null bytes → no-op (defensive)", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    // @ts-expect-error null als bytes
    sync.handleMessage(null, 1000);
    sync.handleMessage([], 1000);
    expect(events).toHaveLength(0);
  });
});

// ─── Store-Tests ────────────────────────────────────────────────────────────

describe("useMidiSyncInStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetMidiSyncInStoreForTests();
  });

  it("Default-State korrekt", () => {
    const s = getMidiSyncInState();
    expect(s.enabled).toBe(false);
    expect(s.inputDeviceId).toBeNull();
    expect(s.autoStartStop).toBe(true);
    expect(s.syncTempo).toBe(true);
    expect(s.detectedBpm).toBeNull();
  });

  it("setMidiSyncInEnabled persists to localStorage", () => {
    setMidiSyncInEnabled(true);
    expect(getMidiSyncInState().enabled).toBe(true);
    const raw = localStorage.getItem("ss-midi-sync-in:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(true);
    // detectedBpm darf NICHT persistiert sein.
    expect(parsed.detectedBpm).toBeUndefined();
  });

  it("setMidiSyncInInputDevice normalisiert leeren String → null", () => {
    setMidiSyncInInputDevice("dev-1");
    expect(getMidiSyncInState().inputDeviceId).toBe("dev-1");
    setMidiSyncInInputDevice("");
    expect(getMidiSyncInState().inputDeviceId).toBeNull();
  });

  it("setMidiSyncInAutoStartStop + setMidiSyncInSyncTempo toggles", () => {
    setMidiSyncInAutoStartStop(false);
    setMidiSyncInSyncTempo(false);
    const s = getMidiSyncInState();
    expect(s.autoStartStop).toBe(false);
    expect(s.syncTempo).toBe(false);
  });

  it("setMidiSyncInDetectedBpm: identical value is no-op", () => {
    let renders = 0;
    const fn = () => renders++;
    // Hook-like Listener registration:
    const listeners = (globalThis as unknown as { __ss_listeners?: Set<() => void> });
    // Wir testen ueber detected-BPM-Threshold ohne echte React-Render.
    setMidiSyncInDetectedBpm(120);
    const first = getMidiSyncInState().detectedBpm;
    expect(first).toBe(120);
    // Aenderung um 0.01 BPM ist unter Threshold (0.05) → kein Update.
    setMidiSyncInDetectedBpm(120.01);
    expect(getMidiSyncInState().detectedBpm).toBe(120);
    // Aenderung um 0.1 BPM ist ueber Threshold.
    setMidiSyncInDetectedBpm(120.1);
    expect(getMidiSyncInState().detectedBpm).toBe(120.1);
    // null clear:
    setMidiSyncInDetectedBpm(null);
    expect(getMidiSyncInState().detectedBpm).toBeNull();
    // suppress unused-var warnings.
    void fn;
    void listeners;
  });

  it("Disable clears detectedBpm", () => {
    setMidiSyncInEnabled(true);
    setMidiSyncInDetectedBpm(140);
    expect(getMidiSyncInState().detectedBpm).toBe(140);
    setMidiSyncInEnabled(false);
    expect(getMidiSyncInState().detectedBpm).toBeNull();
  });

  it("Persistence round-trip via Storage-Reload", () => {
    setMidiSyncInEnabled(true);
    setMidiSyncInInputDevice("dev-xyz");
    setMidiSyncInAutoStartStop(false);
    setMidiSyncInSyncTempo(false);
    // Simuliere reload — reset internen Singleton durch direkt-Load.
    const raw = localStorage.getItem("ss-midi-sync-in:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(true);
    expect(parsed.inputDeviceId).toBe("dev-xyz");
    expect(parsed.autoStartStop).toBe(false);
    expect(parsed.syncTempo).toBe(false);
  });
});

// ─── Engine-Integration-Smoke (Pure-Layer) ──────────────────────────────────

describe("AudioEngine Integration (pure facade)", () => {
  // Wir testen NICHT echte AudioEngine-Konstruktion (Browser-only AudioContext).
  // Stattdessen: stell sicher dass MidiSyncIn-Callback korrekt das DetectedBpm
  // an einen Listener weitergibt — die echte Engine wired denselben Callback
  // gegen applyDetectedBpm/applyExternalStart.

  it("Callback empfaengt 'bpm-changed' mit korrektem Wert (applyDetectedBpm-equivalent)", () => {
    const { sync, events } = newSync({ smoothAlpha: 1, bpmChangeThreshold: 0.1 });
    sync.enabled = true;
    let t = 1000;
    for (let i = 0; i < 20; i++) {
      sync.handleClock(t);
      t += 60_000 / (140 * PPQN);
    }
    const bpmEvents = events.filter((e) => e.event === "bpm-changed");
    expect(bpmEvents.length).toBeGreaterThan(0);
    const last = bpmEvents[bpmEvents.length - 1];
    expect(last.detail?.bpm).not.toBeNull();
    expect(last.detail?.bpm!).toBeCloseTo(140, 0);
  });

  it("'start'-Event triggert applyExternalStart-Aequivalent", () => {
    const { sync, events } = newSync();
    sync.enabled = true;
    sync.handleStart();
    expect(events.find((e) => e.event === "start")).toBeTruthy();
  });
});
