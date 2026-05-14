/**
 * Synthstudio – Performance-Recorder Tests (v2.15)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  startRecording,
  stopRecording,
  recordEvent,
  clearRecording,
  startPlayback,
  stopPlayback,
  exportRecording,
  importRecording,
  getRecorderState,
  __resetPerformanceRecorderForTests,
} from "../../client/src/store/usePerformanceRecorder";

beforeEach(() => {
  __resetPerformanceRecorderForTests();
});

describe("usePerformanceRecorder (v2.15)", () => {
  it("startRecording setzt isRecording=true und legt einen current-Buffer an", () => {
    startRecording("Test");
    const s = getRecorderState();
    expect(s.isRecording).toBe(true);
    expect(s.current?.name).toBe("Test");
    expect(s.current?.events).toEqual([]);
  });

  it("startRecording ist No-op wenn bereits läuft", () => {
    startRecording("A");
    startRecording("B");
    expect(getRecorderState().current?.name).toBe("A");
  });

  it("recordEvent fügt nur während Aufnahme hinzu", () => {
    recordEvent("pattern", { id: "ignored" });
    expect(getRecorderState().current).toBeNull();

    startRecording();
    recordEvent("pattern", { id: "p1" });
    expect(getRecorderState().current?.events.length).toBe(1);
    expect(getRecorderState().current?.events[0].type).toBe("pattern");
    expect(getRecorderState().current?.events[0].data).toEqual({ id: "p1" });
  });

  it("stopRecording schließt die Aufnahme ab und setzt last", () => {
    startRecording();
    recordEvent("scene", { id: "s1" });
    const finished = stopRecording();
    expect(finished).not.toBeNull();
    expect(getRecorderState().isRecording).toBe(false);
    expect(getRecorderState().current).toBeNull();
    expect(getRecorderState().last?.events.length).toBe(1);
  });

  it("stopRecording ohne aktive Aufnahme → null", () => {
    expect(stopRecording()).toBeNull();
  });

  it("Events haben relative Zeitstempel ab Aufnahmestart", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    startRecording();
    vi.setSystemTime(1500);
    recordEvent("macro", { index: 0, value: 0.5 });
    vi.setSystemTime(2000);
    recordEvent("macro", { index: 0, value: 1.0 });
    const finished = stopRecording();
    expect(finished?.events[0].t).toBe(500);
    expect(finished?.events[1].t).toBe(1000);
    expect(finished?.durationMs).toBe(1000);
    vi.useRealTimers();
  });

  it("startPlayback dispatcht jedes Event nach Delay", async () => {
    vi.useFakeTimers();
    startRecording();
    recordEvent("play");
    vi.setSystemTime(Date.now() + 100);
    recordEvent("pattern", { id: "p1" });
    stopRecording();

    const dispatched: Array<{ type: string; data?: Record<string, unknown> }> = [];
    startPlayback((ev) => dispatched.push({ type: ev.type, data: ev.data }));
    expect(getRecorderState().isPlaying).toBe(true);

    await vi.advanceTimersByTimeAsync(150);
    expect(dispatched.length).toBe(2);
    expect(dispatched[0].type).toBe("play");
    expect(dispatched[1].type).toBe("pattern");
    vi.useRealTimers();
  });

  it("startPlayback ist No-op wenn keine last vorhanden", () => {
    const dispatched: unknown[] = [];
    startPlayback(() => dispatched.push(1));
    expect(getRecorderState().isPlaying).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it("stopPlayback bricht das Playback ab", async () => {
    vi.useFakeTimers();
    startRecording();
    recordEvent("play");
    vi.setSystemTime(Date.now() + 1000);
    recordEvent("stop");
    stopRecording();

    const dispatched: string[] = [];
    startPlayback((ev) => dispatched.push(ev.type));
    stopPlayback();
    await vi.advanceTimersByTimeAsync(2000);
    // Wenn das Playback sofort abgebrochen wird, hängen die noch nicht gefeuerten
    // setTimeouts auch geklärt werden — beide Events feuern NICHT.
    expect(dispatched.length).toBe(0);
    expect(getRecorderState().isPlaying).toBe(false);
    vi.useRealTimers();
  });

  it("exportRecording / importRecording ist round-trip stabil", () => {
    startRecording("Round");
    recordEvent("pattern", { id: "p1" });
    recordEvent("scene", { id: "s2" });
    stopRecording();

    const json = exportRecording();
    expect(json).not.toBeNull();

    __resetPerformanceRecorderForTests();
    const ok = importRecording(json!);
    expect(ok).toBe(true);
    const last = getRecorderState().last;
    expect(last?.events.length).toBe(2);
    expect(last?.events[0].type).toBe("pattern");
    expect(last?.events[1].data).toEqual({ id: "s2" });
  });

  it("importRecording lehnt invalides JSON ab", () => {
    expect(importRecording("nicht-json")).toBe(false);
    expect(importRecording("{}")).toBe(false);
    expect(getRecorderState().last).toBeNull();
  });

  it("clearRecording löscht den Last-Slot", () => {
    startRecording();
    recordEvent("pattern", { id: "x" });
    stopRecording();
    expect(getRecorderState().last).not.toBeNull();
    clearRecording();
    expect(getRecorderState().last).toBeNull();
  });
});
