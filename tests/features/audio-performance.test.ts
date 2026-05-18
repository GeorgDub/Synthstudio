/**
 * tests/features/audio-performance.test.ts
 *
 * v3.25.0: Unit-Tests fuer useAudioPerformanceStore.
 *
 * @vitest-environment jsdom
 *
 * Coverage:
 *  - Store-Defaults sind 0
 *  - recordScheduleTick(ms) updates cpuPercent (EWMA) + audioCallbackMs
 *  - Buffer-Underrun-Counter inkrementiert wenn callback > 2x interval
 *  - Glitch-Counter inkrementiert wenn CPU > 90%
 *  - Reset-Counter setzt underrun + glitchEvents auf 0 (cpu bleibt)
 *  - shouldFireWarning throttles auf 1× pro Minute
 *  - updateContextLatency setzt base + output latency
 *  - getPerformanceStatus liefert ok/warn/critical
 *  - Defensive vs NaN/Infinity/negative input
 *  - setSchedulerInterval beeinflusst Underrun-Schwelle
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordScheduleTick,
  resetPerformanceCounters,
  updateContextLatency,
  setSchedulerInterval,
  getSchedulerInterval,
  getPerformanceState,
  getPerformanceStatus,
  shouldFireWarning,
  isPerformanceCritical,
  __resetPerformanceStoreForTests,
  __resetWarningThrottleForTests,
} from "../../client/src/store/useAudioPerformanceStore";

beforeEach(() => {
  __resetPerformanceStoreForTests();
  __resetWarningThrottleForTests();
});

describe("Defaults", () => {
  it("liefert 0 für alle Felder bei frischem Store", () => {
    const s = getPerformanceState();
    expect(s.cpuPercent).toBe(0);
    expect(s.audioCallbackMs).toBe(0);
    expect(s.bufferUnderruns).toBe(0);
    expect(s.outputLatencyMs).toBe(0);
    expect(s.baseLatencyMs).toBe(0);
    expect(s.glitchEvents).toBe(0);
  });

  it("getSchedulerInterval default = 16", () => {
    expect(getSchedulerInterval()).toBe(16);
  });
});

describe("recordScheduleTick", () => {
  it("updates audioCallbackMs (sofort) + cpuPercent (EWMA)", () => {
    setSchedulerInterval(16);
    recordScheduleTick(8); // = 50% Auslastung
    const s = getPerformanceState();
    expect(s.audioCallbackMs).toBe(8);
    expect(s.cpuPercent).toBe(50); // erster Wert direkt
  });

  it("EWMA glättet zwischen Aufrufen — Folge-Werte ändern langsam", () => {
    setSchedulerInterval(16);
    recordScheduleTick(8); // 50%
    recordScheduleTick(16); // 100% — aber EWMA mischt
    const s = getPerformanceState();
    expect(s.cpuPercent).toBeGreaterThan(50);
    expect(s.cpuPercent).toBeLessThan(100);
  });

  it("Buffer-Underrun inkrementiert wenn callback > 2× Interval", () => {
    setSchedulerInterval(16);
    recordScheduleTick(33); // > 32 (= 2× 16)
    expect(getPerformanceState().bufferUnderruns).toBe(1);
    recordScheduleTick(40);
    expect(getPerformanceState().bufferUnderruns).toBe(2);
    recordScheduleTick(20); // unter 32 — nicht inkrementiert
    expect(getPerformanceState().bufferUnderruns).toBe(2);
  });

  it("Glitch-Counter inkrementiert bei CPU > 90%", () => {
    setSchedulerInterval(16);
    // 16ms = 100% Auslastung — über 90% Threshold
    recordScheduleTick(16);
    expect(getPerformanceState().glitchEvents).toBe(1);
    recordScheduleTick(16);
    expect(getPerformanceState().glitchEvents).toBe(2);
  });

  it("defensiv vs NaN/Infinity/negative — keine State-Änderung", () => {
    recordScheduleTick(NaN);
    recordScheduleTick(Infinity);
    recordScheduleTick(-5);
    expect(getPerformanceState().audioCallbackMs).toBe(0);
    expect(getPerformanceState().bufferUnderruns).toBe(0);
  });

  it("clampt cpuPercent auf max 100", () => {
    setSchedulerInterval(16);
    recordScheduleTick(1000); // = 6250% theoretisch
    expect(getPerformanceState().cpuPercent).toBeLessThanOrEqual(100);
  });
});

describe("resetPerformanceCounters", () => {
  it("setzt underrun + glitch auf 0, cpu bleibt erhalten", () => {
    setSchedulerInterval(16);
    recordScheduleTick(50); // verursacht underrun + glitch
    const before = getPerformanceState();
    expect(before.bufferUnderruns).toBeGreaterThan(0);
    expect(before.glitchEvents).toBeGreaterThan(0);
    resetPerformanceCounters();
    const after = getPerformanceState();
    expect(after.bufferUnderruns).toBe(0);
    expect(after.glitchEvents).toBe(0);
    expect(after.cpuPercent).toBe(before.cpuPercent);
  });

  it("idempotent — kein Crash beim zweiten Aufruf", () => {
    resetPerformanceCounters();
    resetPerformanceCounters();
    expect(getPerformanceState().bufferUnderruns).toBe(0);
  });
});

describe("updateContextLatency", () => {
  it("setzt base + output Latency", () => {
    updateContextLatency(5.5, 12.0);
    const s = getPerformanceState();
    expect(s.baseLatencyMs).toBeCloseTo(5.5, 3);
    expect(s.outputLatencyMs).toBeCloseTo(12.0, 3);
  });

  it("defensive vs NaN — keine Änderung", () => {
    updateContextLatency(5, 10);
    updateContextLatency(NaN, NaN);
    expect(getPerformanceState().baseLatencyMs).toBe(5);
    expect(getPerformanceState().outputLatencyMs).toBe(10);
  });

  it("clampt negative Werte auf 0", () => {
    updateContextLatency(-1, -2);
    expect(getPerformanceState().baseLatencyMs).toBe(0);
    expect(getPerformanceState().outputLatencyMs).toBe(0);
  });
});

describe("getPerformanceStatus", () => {
  it("liefert ok bei CPU < 70%", () => {
    expect(getPerformanceStatus({ ...getPerformanceState(), cpuPercent: 50 })).toBe("ok");
  });

  it("liefert warn bei CPU 70-90%", () => {
    expect(getPerformanceStatus({ ...getPerformanceState(), cpuPercent: 75 })).toBe("warn");
  });

  it("liefert critical bei CPU > 90%", () => {
    expect(getPerformanceStatus({ ...getPerformanceState(), cpuPercent: 95 })).toBe("critical");
  });

  it("isPerformanceCritical reflektiert Threshold", () => {
    setSchedulerInterval(16);
    expect(isPerformanceCritical()).toBe(false);
    recordScheduleTick(16); // 100%
    expect(isPerformanceCritical()).toBe(true);
  });
});

describe("shouldFireWarning (Throttle)", () => {
  it("erstes Warning eines Types darf feuern", () => {
    expect(shouldFireWarning("cpu-high", 1000)).toBe(true);
  });

  it("zweites Warning innerhalb 1min wird geblockt", () => {
    shouldFireWarning("cpu-high", 1000);
    expect(shouldFireWarning("cpu-high", 1000 + 30_000)).toBe(false);
  });

  it("Warning nach 60s+ ist wieder erlaubt", () => {
    shouldFireWarning("cpu-high", 1000);
    expect(shouldFireWarning("cpu-high", 1000 + 61_000)).toBe(true);
  });

  it("unterschiedliche Types haben unabhängige Cooldowns", () => {
    shouldFireWarning("cpu-high", 1000);
    expect(shouldFireWarning("underrun", 1000)).toBe(true);
  });
});

describe("setSchedulerInterval", () => {
  it("ändert die Underrun-Schwelle", () => {
    setSchedulerInterval(32); // → underrun-threshold = 64ms
    recordScheduleTick(50); // unter 64ms → kein underrun
    expect(getPerformanceState().bufferUnderruns).toBe(0);
    recordScheduleTick(70);
    expect(getPerformanceState().bufferUnderruns).toBe(1);
  });

  it("ignoriert <=0 und NaN", () => {
    setSchedulerInterval(0);
    expect(getSchedulerInterval()).toBe(16);
    setSchedulerInterval(NaN);
    expect(getSchedulerInterval()).toBe(16);
  });
});
