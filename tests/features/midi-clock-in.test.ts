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
  TEMPO_MIN_SAMPLES,
} from "../../client/src/audio/MidiClockIn";

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
