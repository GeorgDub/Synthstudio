import { describe, it, expect } from "vitest";
import {
  MidiThroughputMeter,
  MidiThroughputByDevice,
} from "../../client/src/utils/midiThroughput";

describe("MidiThroughputMeter (pure, deterministic)", () => {
  it("counts messages within the window as perSec (1s window)", () => {
    const m = new MidiThroughputMeter(1000);
    for (let i = 0; i < 10; i++) m.record(i * 10); // 10 msgs in 100 ms
    // Alle 10 liegen im 1-s-Fenster relativ zu now=90.
    const s = m.snapshot(90);
    expect(s.windowCount).toBe(10);
    expect(s.perSec).toBe(10);
    expect(s.total).toBe(10);
  });

  it("drops stamps older than the window", () => {
    const m = new MidiThroughputMeter(1000);
    m.record(0);
    m.record(100);
    m.record(200);
    // Bei now=1050 ist cutoff=50: Stempel 0 (<50) draußen, 100+200 drin.
    const s = m.snapshot(1050);
    expect(s.windowCount).toBe(2);
    expect(s.total).toBe(3); // total zählt lebenslang weiter
  });

  it("normalises to per-second for sub-second windows", () => {
    const m = new MidiThroughputMeter(500); // 0.5 s Fenster
    m.record(0);
    m.record(100);
    m.record(200);
    // 3 Nachrichten im 0,5-s-Fenster → 3 * (1000/500) = 6/s
    expect(m.snapshot(400).perSec).toBe(6);
  });

  it("tracks peak across the lifetime even after the rate drops", () => {
    const m = new MidiThroughputMeter(1000);
    for (let i = 0; i < 50; i++) m.record(i); // Burst: 50 in 50 ms
    const peak = m.snapshot(49).perSec;
    expect(peak).toBe(50);
    // Lange später: Fenster leer, perSec 0, aber peak bleibt erhalten.
    const s = m.snapshot(10_000);
    expect(s.perSec).toBe(0);
    expect(s.peakPerSec).toBe(50);
  });

  it("reset clears window, total and peak", () => {
    const m = new MidiThroughputMeter(1000);
    for (let i = 0; i < 5; i++) m.record(i);
    m.reset();
    const s = m.snapshot(1000);
    expect(s.total).toBe(0);
    expect(s.perSec).toBe(0);
    expect(s.peakPerSec).toBe(0);
  });

  it("caps retained samples defensively without losing total count", () => {
    const m = new MidiThroughputMeter(1000, 100); // Cap 100
    for (let i = 0; i < 500; i++) m.record(i * 0.1); // 500 Stempel eng gepackt
    const s = m.snapshot(49.9);
    expect(s.total).toBe(500); // total unbeeinflusst
    expect(s.windowCount).toBeLessThanOrEqual(100); // aber Fenster gedeckelt
  });
});

describe("MidiThroughputByDevice", () => {
  it("aggregates per device and total", () => {
    const agg = new MidiThroughputByDevice(1000);
    agg.record("Akai", 0);
    agg.record("Akai", 10);
    agg.record("Akai", 20);
    agg.record("Electribe", 30);
    expect(agg.totalSnapshot(30).windowCount).toBe(4);
    const rows = agg.perDevice(30);
    expect(rows[0].key).toBe("Akai"); // höchster Durchsatz zuerst
    expect(rows[0].windowCount).toBe(3);
    expect(rows[1].key).toBe("Electribe");
    expect(rows[1].windowCount).toBe(1);
  });

  it("lists all seen device keys", () => {
    const agg = new MidiThroughputByDevice(1000);
    agg.record("A", 0);
    agg.record("B", 0);
    expect(agg.keys().sort()).toEqual(["A", "B"]);
  });

  it("reset clears every device and the total", () => {
    const agg = new MidiThroughputByDevice(1000);
    agg.record("A", 0);
    agg.reset();
    expect(agg.keys()).toEqual([]);
    expect(agg.totalSnapshot(0).total).toBe(0);
  });
});
