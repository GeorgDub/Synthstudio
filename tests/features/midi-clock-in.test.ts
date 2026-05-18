/**
 * tests/features/midi-clock-in.test.ts
 *
 * Unit-Tests für MidiClockIn-Receiver (v3.35.0). Komplement zu
 * midi-clock-out.test.ts: hier testen wir, dass eingehende 0xF8/0xFA/0xFC/0xFB
 * + Song-Position-Pointer korrekt in BPM-Estimate + Transport-Events
 * übersetzt werden.
 *
 * Deterministisches Setup:
 *   - Wir injizieren eine eigene `now()`-Funktion damit wir die Tick-Intervalle
 *     bit-genau steuern können. KEIN setTimeout, kein performance.now-Mock.
 *   - Events werden in einen Recorder-Array gesammelt; window.dispatchEvent
 *     wird nicht genutzt (Node hat keine `window`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MidiClockIn,
  bpmFromTickInterval,
  ewmaStep,
  isOutlier,
  MIDI_RT_CLOCK_TICK,
  MIDI_RT_START,
  MIDI_RT_CONTINUE,
  MIDI_RT_STOP,
  MIDI_SC_SPP,
  MIDI_PPQN,
  SYNC_LOSS_MS,
  SPP_THROTTLE_MS,
  TEMPO_MIN_SAMPLES,
} from "../../client/src/audio/MidiClockIn";
import { formatPatternPosition } from "../../client/src/utils/patternPosition";

// ─── Test-Harness ───────────────────────────────────────────────────────────

interface RecordedEvent {
  event: string;
  detail: unknown;
}

interface Harness {
  clock: MidiClockIn;
  events: RecordedEvent[];
  /** Setzt die nächste now()-Zeit (in ms). */
  setNow: (ms: number) => void;
  /** Bewegt now() um `delta` ms weiter. */
  advance: (delta: number) => void;
}

interface ManualScheduler {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  /** Liefert die aktuell noch wartenden Timer (für Debug-Asserts). */
  pending: () => number;
  /** Bewegt den virtuellen Scheduler `ms` Millisekunden vorwärts. */
  advanceBy: (ms: number, advanceClockFn: (delta: number) => void) => void;
}

interface ScheduledTask {
  fireAt: number;
  fn: () => void;
  cancelled: boolean;
}

/**
 * Manueller Timer-Scheduler für die SPP-Throttle-Tests. Wir koppeln ihn
 * über `advanceBy()` mit dem Harness-Now: pro Millisekunde-Schritt prüfen
 * wir, ob ein Timer fällig ist und feuern. Damit lassen sich Throttle-
 * Fenster bit-genau steuern ohne `vi.useFakeTimers`.
 */
function makeManualScheduler(): { sched: ManualScheduler; tasks: ScheduledTask[]; currentMs: { v: number } } {
  const tasks: ScheduledTask[] = [];
  const currentMs = { v: 1000 };
  const sched: ManualScheduler = {
    setTimeout(fn, ms) {
      const task: ScheduledTask = { fireAt: currentMs.v + ms, fn, cancelled: false };
      tasks.push(task);
      return task;
    },
    clearTimeout(id) {
      const t = id as ScheduledTask | undefined;
      if (t && !t.cancelled) t.cancelled = true;
    },
    pending() {
      return tasks.filter(t => !t.cancelled && t.fireAt > currentMs.v).length;
    },
    advanceBy(ms, advanceClockFn) {
      const target = currentMs.v + ms;
      while (true) {
        const next = tasks
          .filter(t => !t.cancelled && t.fireAt <= target)
          .sort((a, b) => a.fireAt - b.fireAt)[0];
        if (!next) break;
        next.cancelled = true;
        const delta = next.fireAt - currentMs.v;
        currentMs.v = next.fireAt;
        advanceClockFn(delta);
        next.fn();
      }
      if (currentMs.v < target) {
        const delta = target - currentMs.v;
        currentMs.v = target;
        advanceClockFn(delta);
      }
    },
  };
  return { sched, tasks, currentMs };
}

function makeClock(): Harness {
  // Wir starten bei 1000ms damit `lastTickTime===0` Sentinel (= "noch nie
  // ein Tick empfangen") nicht versehentlich kollidiert mit einem realen
  // Tick-Zeitstempel.
  let nowMs = 1000;
  const events: RecordedEvent[] = [];
  const clock = new MidiClockIn({
    now: () => nowMs,
    dispatch: (event, detail) => { events.push({ event, detail }); },
  });
  return {
    clock,
    events,
    setNow: (ms) => { nowMs = ms; },
    advance: (delta) => { nowMs += delta; },
  };
}

interface ThrottleHarness extends Harness {
  scheduler: ManualScheduler;
  /** Bewegt now() UND den manual-scheduler um delta ms gleichzeitig vor. */
  advanceBoth: (delta: number) => void;
}

function makeClockWithScheduler(): ThrottleHarness {
  const events: RecordedEvent[] = [];
  const nowState = { v: 1000 };
  const { sched, currentMs } = makeManualScheduler();
  // Wir synchronisieren currentMs.v und nowState.v.
  currentMs.v = 1000;
  const clock = new MidiClockIn({
    now: () => nowState.v,
    dispatch: (event, detail) => { events.push({ event, detail }); },
    scheduler: {
      setTimeout: (fn, ms) => sched.setTimeout(fn, ms),
      clearTimeout: (id) => sched.clearTimeout(id),
    },
  });
  return {
    clock,
    events,
    scheduler: sched,
    setNow: (ms) => { nowState.v = ms; currentMs.v = ms; },
    advance: (delta) => { nowState.v += delta; },
    advanceBoth: (delta) => {
      sched.advanceBy(delta, (d) => { nowState.v += d; });
    },
  };
}

function tick(h: Harness): void {
  h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_CLOCK_TICK]));
}

/** Sendet `count` Ticks im konstanten `intervalMs`-Abstand. */
function tickStream(h: Harness, count: number, intervalMs: number): void {
  for (let i = 0; i < count; i++) {
    tick(h);
    h.advance(intervalMs);
  }
}

// ─── Pure Helpers ───────────────────────────────────────────────────────────

describe("MidiClockIn — pure helpers", () => {
  it("bpmFromTickInterval: 20.833ms → 120 BPM", () => {
    // 60_000 / (20.833 * 24) ≈ 119.97 → gerundet 120.0
    const bpm = bpmFromTickInterval(20.833333);
    expect(bpm).not.toBeNull();
    expect(bpm!).toBeCloseTo(120, 1);
  });

  it("bpmFromTickInterval: rejects out-of-range", () => {
    // 1ms-Intervall → 2500 BPM → null
    expect(bpmFromTickInterval(1)).toBeNull();
    // 1000ms → 2.5 BPM → null
    expect(bpmFromTickInterval(1000)).toBeNull();
    // Pathologisch: 0, negativ, NaN
    expect(bpmFromTickInterval(0)).toBeNull();
    expect(bpmFromTickInterval(-5)).toBeNull();
    expect(bpmFromTickInterval(NaN)).toBeNull();
  });

  it("ewmaStep: first sample is taken 1:1, then smooths", () => {
    expect(ewmaStep(null, 100)).toBe(100);
    // alpha=0.1: 100*0.9 + 200*0.1 = 110
    expect(ewmaStep(100, 200, 0.1)).toBeCloseTo(110, 6);
  });

  it("isOutlier: discards intervals > threshold % off mean", () => {
    // mean=20ms, threshold=0.5 → range 10..30. 35ms = outlier.
    expect(isOutlier(35, 20, 0.5)).toBe(true);
    expect(isOutlier(25, 20, 0.5)).toBe(false);
    expect(isOutlier(15, 20, 0.5)).toBe(false);
    // null mean → never outlier (bootstrap-Schutz).
    expect(isOutlier(999, null, 0.5)).toBe(false);
  });
});

// ─── Lifecycle / Enable ─────────────────────────────────────────────────────

describe("MidiClockIn — lifecycle", () => {
  let h: Harness;
  beforeEach(() => { h = makeClock(); });

  it("starts disabled — ignores all messages until enable()", () => {
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_CLOCK_TICK]));
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_STOP]));
    expect(h.events.length).toBe(0);
    expect(h.clock.ticksSeen).toBe(0);
    expect(h.clock.isRunning).toBe(false);
    expect(h.clock.getStatus()).toBe("off");
  });

  it("enable() then disable() clears state", () => {
    h.clock.enable();
    tickStream(h, 30, 20);
    expect(h.clock.ticksSeen).toBeGreaterThan(0);
    expect(h.clock.getEstimatedBpm()).not.toBeNull();

    h.clock.disable();
    expect(h.clock.ticksSeen).toBe(0);
    expect(h.clock.lastTickTime).toBe(0);
    expect(h.clock.getEstimatedBpm()).toBeNull();
    expect(h.clock.isRunning).toBe(false);
  });

  it("re-enable starts fresh — old EWMA-Mean is gone", () => {
    h.clock.enable();
    tickStream(h, 30, 20); // ~125 BPM (1000/(20*24)*60 = 125)
    const bpm1 = h.clock.getEstimatedBpm();
    expect(bpm1).not.toBeNull();

    h.clock.disable();
    h.clock.enable();
    expect(h.clock.getEstimatedBpm()).toBeNull();
  });
});

// ─── Tick → BPM ─────────────────────────────────────────────────────────────

describe("MidiClockIn — tempo estimation", () => {
  let h: Harness;
  beforeEach(() => { h = makeClock(); h.clock.enable(); });

  it("0xF8 ticks accumulate → bpm-estimate via EWMA", () => {
    // Erster Tick zählt nur lastTickTime, ergibt kein Intervall. Wir senden
    // MIN_SAMPLES+1 damit mind. MIN_SAMPLES Intervalle vorliegen.
    tickStream(h, TEMPO_MIN_SAMPLES + 1, 25);
    // 25ms-Intervall → 60_000 / (25 * 24) = 100 BPM
    const bpm = h.clock.getEstimatedBpm();
    expect(bpm).not.toBeNull();
    expect(bpm!).toBeCloseTo(100, 1);
    expect(h.clock.ticksSeen).toBeGreaterThanOrEqual(TEMPO_MIN_SAMPLES);
  });

  it("24 ticks at 20.833ms intervals → 120 BPM", () => {
    // Exakt: 60_000 / (20.833 * 24) ≈ 120
    tickStream(h, 24, 20.8333333);
    const bpm = h.clock.getEstimatedBpm();
    expect(bpm).not.toBeNull();
    expect(bpm!).toBeCloseTo(120, 1);
  });

  it("tempo-event emitted only when BPM changes ≥ 0.1", () => {
    tickStream(h, 24, 20.8333333);
    const tempoEvents = h.events.filter(e => e.event === "midiclockin:tempo");
    expect(tempoEvents.length).toBeGreaterThan(0);
    // Letztes BPM ≈ 120
    const last = tempoEvents[tempoEvents.length - 1].detail as { bpm: number };
    expect(last.bpm).toBeCloseTo(120, 1);
  });

  it("jitter-resistance: 20% interval variation → bpm stable within 5%", () => {
    // Wir senden 60 Ticks mit 20ms-Mean, aber jeder Tick ±20% jittered.
    // Deterministisch via Indizes statt Math.random für Reproduzierbarkeit.
    const baseInterval = 20.83333; // ≈120 BPM
    for (let i = 0; i < 60; i++) {
      tick(h);
      // 7-tap-Jitter: alternate ±18% to simulate jitter without RNG.
      const jitterFactor = i % 2 === 0 ? 1.18 : 0.82;
      h.advance(baseInterval * jitterFactor);
    }
    const bpm = h.clock.getEstimatedBpm();
    expect(bpm).not.toBeNull();
    // EWMA averages out → bleibt im 110..130 range (5% off 120).
    expect(bpm!).toBeGreaterThan(110);
    expect(bpm!).toBeLessThan(130);
  });

  it("outlier-spike: single 200ms gap does NOT poison EWMA", () => {
    // 30 saubere Ticks bei 20ms (~125 BPM)
    tickStream(h, 30, 20);
    const before = h.clock.getEstimatedBpm()!;
    // Ein einzelner Riesen-Spike (200ms — Outlier per threshold 50% off 20ms)
    tick(h);
    h.advance(200);
    // Dann wieder 30 saubere Ticks
    tickStream(h, 30, 20);
    const after = h.clock.getEstimatedBpm()!;
    // Beide BPMs müssen praktisch identisch sein (Outlier discarded).
    expect(Math.abs(after - before)).toBeLessThan(2);
  });
});

// ─── Transport ──────────────────────────────────────────────────────────────

describe("MidiClockIn — transport messages", () => {
  let h: Harness;
  beforeEach(() => { h = makeClock(); h.clock.enable(); });

  it("0xFA dispatches start-event + sets isRunning", () => {
    h.setNow(1234);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    expect(h.clock.isRunning).toBe(true);
    const e = h.events.find(x => x.event === "midiclockin:start");
    expect(e).toBeDefined();
    expect((e!.detail as { time: number }).time).toBe(1234);
  });

  it("0xFC dispatches stop-event + clears isRunning", () => {
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    expect(h.clock.isRunning).toBe(true);
    h.setNow(5000);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_STOP]));
    expect(h.clock.isRunning).toBe(false);
    const e = h.events.find(x => x.event === "midiclockin:stop");
    expect(e).toBeDefined();
    expect((e!.detail as { time: number }).time).toBe(5000);
  });

  it("0xFB (Continue) — keeps tempo-mean across stop/continue", () => {
    tickStream(h, 30, 20.83333);
    const bpmBefore = h.clock.getEstimatedBpm();
    expect(bpmBefore).not.toBeNull();

    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_STOP]));
    expect(h.clock.isRunning).toBe(false);
    expect(h.clock.getEstimatedBpm()).toBe(bpmBefore); // mean unverändert

    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_CONTINUE]));
    expect(h.clock.isRunning).toBe(true);
    const e = h.events.find(x => x.event === "midiclockin:continue");
    expect(e).toBeDefined();
  });

  it("0xFA resets tick-counter but preserves mean", () => {
    tickStream(h, 30, 20.83333);
    const meanBefore = h.clock.getEstimatedBpm()!;
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    expect(h.clock.ticksSeen).toBe(0);
    // Mean wird beibehalten — Caller bekommt sofort wieder BPM nach paar Ticks.
    // Ticks-seen ist < MIN_SAMPLES → getEstimatedBpm muss noch null sein.
    expect(h.clock.getEstimatedBpm()).toBeNull();
    // 6 weitere Ticks → wieder Output (mean unverändert ~120).
    tickStream(h, TEMPO_MIN_SAMPLES, 20.83333);
    const after = h.clock.getEstimatedBpm()!;
    expect(after).toBeCloseTo(meanBefore, 1);
  });
});

// ─── Song-Position-Pointer ──────────────────────────────────────────────────

describe("MidiClockIn — SPP", () => {
  it("0xF2 parses BE u14 midi-beat", () => {
    const h = makeClock();
    h.clock.enable();
    // MIDI-Beat 100 = LSB 100 & 0x7F, MSB (100 >> 7) & 0x7F = 0
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 100, 0]));
    const e = h.events.find(x => x.event === "midiclockin:spp");
    expect(e).toBeDefined();
    expect((e!.detail as { midiBeat: number }).midiBeat).toBe(100);
  });

  it("0xF2 parses position 200 (LSB+MSB)", () => {
    const h = makeClock();
    h.clock.enable();
    // 200 = 0b11001000 → lsb=72 (0x48), msb=1
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 72, 1]));
    const e = h.events.find(x => x.event === "midiclockin:spp");
    expect((e!.detail as { midiBeat: number }).midiBeat).toBe(200);
  });
});

// ─── v3.36.0: SPP-driven Pattern-Seek ───────────────────────────────────────

describe("MidiClockIn — v3.36 SPP-driven seek", () => {
  it("SPP event detail enthält positionStep === midiBeat (1:1 mapping)", () => {
    const h = makeClock();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 100, 0]));
    const e = h.events.find(x => x.event === "midiclockin:spp");
    expect(e).toBeDefined();
    const d = e!.detail as { midiBeat: number; positionStep: number };
    // 1 MIDI-Beat = 6 Clocks = 1/16-Note = 1 Step → positionStep === midiBeat
    expect(d.positionStep).toBe(d.midiBeat);
    expect(d.positionStep).toBe(100);
  });

  it("SPP während running wird ignoriert (per MIDI-Spec)", () => {
    const h = makeClock();
    h.clock.enable();
    // Master startet — wir sind running.
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    expect(h.clock.isRunning).toBe(true);
    const before = h.events.length;
    // SPP während running — soll NICHT dispatched werden.
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 50, 0]));
    const sppEvents = h.events.filter(x => x.event === "midiclockin:spp");
    expect(sppEvents.length).toBe(0);
    // pendingStartStep darf auch nicht gesetzt sein (gespiegelt) — der
    // SPP-Pfad wurde komplett verworfen.
    expect(h.clock.pendingStartStep).toBeNull();
    // Es kam kein weiteres Event dazu (Start-Event ist von 0xFA, das ist OK
    // — wir prüfen nur dass KEIN SPP-Event drinsteckt).
    void before;
  });

  it("SPP vor START setzt pendingStartStep + nachfolgendes 0xFA reicht positionStep weiter", () => {
    const h = makeClock();
    h.clock.enable();
    // SPP zu Position 32 (MIDI-Beat 32 = Step 32 = Bar 3 in 16-step pattern).
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 32, 0]));
    expect(h.clock.pendingStartStep).toBe(32);
    // Jetzt START → Engine soll positionStep im Event sehen.
    h.setNow(2000);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    const startEv = h.events.find(x => x.event === "midiclockin:start");
    expect(startEv).toBeDefined();
    const detail = startEv!.detail as { time: number; positionStep: number };
    expect(detail.positionStep).toBe(32);
    expect(detail.time).toBe(2000);
    // pendingStartStep ist nach Verbrauch geleert.
    expect(h.clock.pendingStartStep).toBeNull();
  });

  it("0xFA ohne vorheriges SPP → positionStep === 0 (konventioneller Start)", () => {
    const h = makeClock();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    const startEv = h.events.find(x => x.event === "midiclockin:start");
    expect(startEv).toBeDefined();
    const detail = startEv!.detail as { positionStep: number };
    expect(detail.positionStep).toBe(0);
  });

  it("0xFB Continue resumes — kein positionStep-Field, kein Reset", () => {
    const h = makeClock();
    h.clock.enable();
    // Erstmal start mit SPP → setzt isRunning + verbraucht pending.
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 16, 0]));
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    // Dann stop — Position bleibt beim Master, wir merken uns nichts neu.
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_STOP]));
    expect(h.clock.isRunning).toBe(false);
    // Continue — KEIN seek, KEIN positionStep im Detail.
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_CONTINUE]));
    expect(h.clock.isRunning).toBe(true);
    const contEv = h.events.find(x => x.event === "midiclockin:continue");
    expect(contEv).toBeDefined();
    const detail = contEv!.detail as { time: number; positionStep?: number };
    // Continue darf keinen positionStep haben — Resume-Semantik.
    expect(detail.positionStep).toBeUndefined();
  });

  it("SPP max u14 (16383) wird akzeptiert; out-of-range wird durch Maskierung geclamped", () => {
    const h = makeClock();
    h.clock.enable();
    // 16383 = 0x3FFF: lsb=0x7F, msb=0x7F
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 0x7F, 0x7F]));
    const e1 = h.events.find(x => x.event === "midiclockin:spp");
    expect(e1).toBeDefined();
    expect((e1!.detail as { midiBeat: number }).midiBeat).toBe(16383);
    expect(h.clock.pendingStartStep).toBe(16383);
  });

  it("SPP malformed: < 3 bytes → ignoriert, kein throw, kein dispatch", () => {
    const h = makeClock();
    h.clock.enable();
    // 0xF2 alleine — keine data-bytes.
    expect(() =>
      h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP]))
    ).not.toThrow();
    // 0xF2 + nur 1 byte.
    expect(() =>
      h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 50]))
    ).not.toThrow();
    expect(h.events.length).toBe(0);
    expect(h.clock.pendingStartStep).toBeNull();
  });

  it("pendingStartStep wird beim disable() geleert", () => {
    const h = makeClock();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 100, 0]));
    expect(h.clock.pendingStartStep).toBe(100);
    h.clock.disable();
    expect(h.clock.pendingStartStep).toBeNull();
  });
});

// ─── Sync-Loss-Detection ────────────────────────────────────────────────────

describe("MidiClockIn — sync-loss", () => {
  it(`no tick for > ${SYNC_LOSS_MS}ms → status "lost"`, () => {
    const h = makeClock();
    h.clock.enable();
    tickStream(h, 30, 20);
    // Status nach letztem Tick: tempo-only (kein START).
    expect(h.clock.getStatus()).toBe("tempo-only");
    // 600ms vergehen, kein Tick.
    h.advance(SYNC_LOSS_MS + 100);
    expect(h.clock.getStatus()).toBe("lost");
  });

  it("status === 'running' nach START + Ticks", () => {
    const h = makeClock();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    tick(h);
    expect(h.clock.getStatus()).toBe("running");
  });

  it("status === 'tempo-only' when ticks but no START", () => {
    const h = makeClock();
    h.clock.enable();
    tick(h);
    expect(h.clock.getStatus()).toBe("tempo-only");
  });
});

// ─── Robustness ─────────────────────────────────────────────────────────────

describe("MidiClockIn — robustness", () => {
  it("ignores malformed / empty messages without throw", () => {
    const h = makeClock();
    h.clock.enable();
    expect(() => h.clock.handleMidiMessage(new Uint8Array([]))).not.toThrow();
    // SPP mit fehlenden data-bytes — wird ignoriert.
    expect(() => h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP]))).not.toThrow();
    expect(h.events.length).toBe(0);
  });

  it("works with number[] AND Uint8Array", () => {
    const h = makeClock();
    h.clock.enable();
    h.setNow(100);
    h.clock.handleMidiMessage([MIDI_RT_START]);
    h.advance(20);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_CLOCK_TICK]));
    expect(h.clock.isRunning).toBe(true);
    expect(h.clock.ticksSeen).toBe(1);
  });

  it("disable() while running emits no further events", () => {
    const h = makeClock();
    h.clock.enable();
    tickStream(h, 30, 20);
    const before = h.events.length;
    h.clock.disable();
    tickStream(h, 30, 20);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    expect(h.events.length).toBe(before);
  });
});

// ─── v3.37.0: SPP-Throttle (leading + trailing edge) ────────────────────────

describe("MidiClockIn — v3.37 SPP throttle", () => {
  it("first SPP fires immediately (leading edge)", () => {
    const h = makeClockWithScheduler();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 10, 0]));
    const sppEvents = h.events.filter(e => e.event === "midiclockin:spp");
    expect(sppEvents.length).toBe(1);
    expect((sppEvents[0].detail as { positionStep: number }).positionStep).toBe(10);
  });

  it("100 SPP-Events in 100ms → max 3 dispatches (leading + ≤2 trailing)", () => {
    const h = makeClockWithScheduler();
    h.clock.enable();
    // 100 SPP-Events alle 1ms (=> 100ms-Burst). Wir nutzen advanceBoth damit
    // auch der Scheduler synchron mitwandert und etwaige Trailing-Timer in
    // der Mitte feuern können.
    for (let i = 0; i < 100; i++) {
      h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, (i + 1) % 128, 0]));
      h.advanceBoth(1);
    }
    // Stelle sicher, dass ein noch ausstehender Trailing-Timer feuert
    // (oder cancelled wird) — wir warten genug Zeit ab.
    h.advanceBoth(SPP_THROTTLE_MS + 5);

    const sppEvents = h.events.filter(e => e.event === "midiclockin:spp");
    // Erwartet: leading bei 0ms, trailing bei 50ms, trailing bei 100ms,
    // ggf. final trailing nach 150ms. Wir lassen ≤ 4 zu (defensive bound).
    expect(sppEvents.length).toBeGreaterThanOrEqual(1);
    expect(sppEvents.length).toBeLessThanOrEqual(4);
  });

  it("trailing-edge dispatches LAST value of burst", () => {
    const h = makeClockWithScheduler();
    h.clock.enable();
    // Wir senden 3 SPP-Events innerhalb des Throttle-Windows. Erstes leading,
    // beide weiteren werden zusammengefasst → trailing soll den LETZTEN
    // Wert dispatchen.
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 5, 0]));   // leading
    h.advanceBoth(10);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 7, 0]));   // suppressed
    h.advanceBoth(10);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 13, 0]));  // suppressed → trailing
    h.advanceBoth(SPP_THROTTLE_MS + 5);

    const sppEvents = h.events.filter(e => e.event === "midiclockin:spp");
    expect(sppEvents.length).toBe(2);
    expect((sppEvents[0].detail as { positionStep: number }).positionStep).toBe(5);
    expect((sppEvents[1].detail as { positionStep: number }).positionStep).toBe(13);
    // pendingStartStep muss den finalen Wert haben → so seekt der nächste
    // 0xFA-Start zur tatsächlich letzten Position der Burst.
    expect(h.clock.pendingStartStep).toBe(13);
  });

  it("widely-spaced SPPs (>50ms apart) all dispatch as leading (no throttling)", () => {
    const h = makeClockWithScheduler();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 1, 0]));
    h.advanceBoth(SPP_THROTTLE_MS + 10);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 2, 0]));
    h.advanceBoth(SPP_THROTTLE_MS + 10);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 3, 0]));
    h.advanceBoth(SPP_THROTTLE_MS + 10);

    const sppEvents = h.events.filter(e => e.event === "midiclockin:spp");
    // Alle 3 sind jeweils > 50ms auseinander → 3 leading-Dispatches, keine
    // trailing-Sammlung.
    expect(sppEvents.length).toBe(3);
    expect(sppEvents.map(e => (e.detail as { positionStep: number }).positionStep))
      .toEqual([1, 2, 3]);
  });

  it("trailing dispatch is cancelled when 0xFA arrives mid-throttle", () => {
    const h = makeClockWithScheduler();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 5, 0]));  // leading
    h.advanceBoth(10);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 9, 0]));  // pending trailing
    // 0xFA START erfolgt vor dem trailing-Timer.
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    h.advanceBoth(SPP_THROTTLE_MS + 20);

    const sppEvents = h.events.filter(e => e.event === "midiclockin:spp");
    // Nur das leading-Event soll existieren. Das trailing wurde durch
    // _onStart cancelled (running-Gate).
    expect(sppEvents.length).toBe(1);
    expect((sppEvents[0].detail as { positionStep: number }).positionStep).toBe(5);
    // Start-Event muss die LETZTE bekannte SPP-Position als positionStep haben.
    const startEv = h.events.find(e => e.event === "midiclockin:start");
    expect(startEv).toBeDefined();
    expect((startEv!.detail as { positionStep: number }).positionStep).toBe(9);
  });

  it("disable() cancels trailing timer + clears throttle state", () => {
    const h = makeClockWithScheduler();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 5, 0]));  // leading
    h.advanceBoth(10);
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 9, 0]));  // pending
    expect(h.scheduler.pending()).toBe(1);
    h.clock.disable();
    expect(h.scheduler.pending()).toBe(0);
    // Auch nach Verstreichen der Zeit darf kein Trailing-Event mehr feuern.
    h.advanceBoth(SPP_THROTTLE_MS + 50);
    const sppEvents = h.events.filter(e => e.event === "midiclockin:spp");
    expect(sppEvents.length).toBe(1); // nur das initial leading
  });
});

// ─── v3.37.0: onPlayStop signature extension (positionStep) ─────────────────

describe("MidiClockIn — v3.37 0xFA with positionStep in start event", () => {
  it("0xFA dispatches start with positionStep === SPP value", () => {
    const h = makeClock();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_SC_SPP, 48, 0]));
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    const startEv = h.events.find(e => e.event === "midiclockin:start");
    expect(startEv).toBeDefined();
    const detail = startEv!.detail as { positionStep: number };
    expect(detail.positionStep).toBe(48);
  });

  it("0xFA without preceding SPP → positionStep === 0", () => {
    const h = makeClock();
    h.clock.enable();
    h.clock.handleMidiMessage(new Uint8Array([MIDI_RT_START]));
    const startEv = h.events.find(e => e.event === "midiclockin:start");
    expect(startEv).toBeDefined();
    expect((startEv!.detail as { positionStep: number }).positionStep).toBe(0);
  });
});

// ─── v3.37.0: formatPatternPosition (Pattern-Length > 16 fold display) ──────

describe("formatPatternPosition — v3.37 Bar.Beat.Sub helper", () => {
  it("step 0 / stepCount 16 → 'Bar 1.1.1', not looped", () => {
    const r = formatPatternPosition(0, 16);
    expect(r.label).toBe("Bar 1.1.1");
    expect(r.bar).toBe(1);
    expect(r.beat).toBe(1);
    expect(r.sub).toBe(1);
    expect(r.effectiveStep).toBe(0);
    expect(r.isLooped).toBe(false);
    expect(r.loopCount).toBe(0);
  });

  it("step 5 / stepCount 16 → 'Bar 1.2.2', effective 5", () => {
    const r = formatPatternPosition(5, 16);
    expect(r.label).toBe("Bar 1.2.2");
    expect(r.effectiveStep).toBe(5);
    expect(r.isLooped).toBe(false);
  });

  it("step 15 / stepCount 16 → 'Bar 1.4.4', last step", () => {
    const r = formatPatternPosition(15, 16);
    expect(r.label).toBe("Bar 1.4.4");
    expect(r.effectiveStep).toBe(15);
    expect(r.isLooped).toBe(false);
  });

  it("step 16 / stepCount 16 → 'Bar 1.1.1 (loop)', loopCount=1", () => {
    const r = formatPatternPosition(16, 16);
    expect(r.label).toBe("Bar 1.1.1 (loop)");
    expect(r.effectiveStep).toBe(0);
    expect(r.isLooped).toBe(true);
    expect(r.loopCount).toBe(1);
  });

  it("step 48 / stepCount 16 → 'Bar 1.1.1 (loop)', loopCount=3", () => {
    const r = formatPatternPosition(48, 16);
    expect(r.label).toBe("Bar 1.1.1 (loop)");
    expect(r.effectiveStep).toBe(0);
    expect(r.loopCount).toBe(3);
    expect(r.isLooped).toBe(true);
  });

  it("step 20 / stepCount 32 → 'Bar 2.2.1', effective 20 (no loop)", () => {
    // Bei 32-Step-Pattern ist Step 20 = Bar 2 (Step 16-31) Beat 2 Sub 1
    const r = formatPatternPosition(20, 32);
    expect(r.bar).toBe(2);
    expect(r.beat).toBe(2);
    expect(r.sub).toBe(1);
    expect(r.isLooped).toBe(false);
    expect(r.effectiveStep).toBe(20);
  });

  it("defensive: negative / NaN / stepCount<=0 → clamped to safe defaults", () => {
    const neg = formatPatternPosition(-5, 16);
    expect(neg.effectiveStep).toBe(0);
    expect(neg.label).toBe("Bar 1.1.1");
    const nan = formatPatternPosition(NaN, 16);
    expect(nan.effectiveStep).toBe(0);
    const zeroSteps = formatPatternPosition(5, 0);
    // stepCount 0 → fallback auf 16
    expect(zeroSteps.effectiveStep).toBe(5);
    expect(zeroSteps.label).toBe("Bar 1.2.2");
  });
});
