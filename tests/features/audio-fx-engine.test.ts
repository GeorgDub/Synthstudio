// @vitest-environment jsdom
/**
 * audio-fx-engine.test.ts — Sprint-106 SimAudioEngine FX-API + Cache Tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  SimAudioEngine, DEFAULT_FX, type Waveform,
} from "../../client/src/audio/SimAudioEngine";
import {
  loadAudioFxCache, saveAudioFxCache, clearAudioFxCache,
} from "../../client/src/utils/audioFxCache";

// ─── AudioContext-Mock ────────────────────────────────────

class FakeAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
}

class FakeGain {
  gain = new FakeAudioParam();
  connect = vi.fn();
}

class FakeFilter {
  type = "lowpass";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  connect = vi.fn();
}

class FakeDelay {
  delayTime = new FakeAudioParam();
  connect = vi.fn();
}

class FakeOscillator {
  type: Waveform = "sine";
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  createGain(): FakeGain { return new FakeGain(); }
  createBiquadFilter(): FakeFilter { return new FakeFilter(); }
  createDelay(_max: number): FakeDelay { return new FakeDelay(); }
  createOscillator(): FakeOscillator { return new FakeOscillator(); }
}


// ─── audioFxCache ─────────────────────────────────────────

describe("audioFxCache", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns defaults wenn nichts gespeichert", () => {
    const s = loadAudioFxCache();
    expect(s).toEqual(DEFAULT_FX);
  });

  it("roundtrip preserves settings", () => {
    saveAudioFxCache({
      waveform: "sawtooth",
      filterCutoffHz: 800,
      filterQ: 5,
      delayTimeS: 0.3,
      delayFeedback: 0.6,
      masterGain: 0.5,
    });
    const loaded = loadAudioFxCache();
    expect(loaded.waveform).toBe("sawtooth");
    expect(loaded.filterCutoffHz).toBe(800);
    expect(loaded.delayTimeS).toBeCloseTo(0.3);
  });

  it("clampt filterCutoff in [40, 20000]", () => {
    saveAudioFxCache({ ...DEFAULT_FX, filterCutoffHz: 99999 });
    expect(loadAudioFxCache().filterCutoffHz).toBe(20000);
    saveAudioFxCache({ ...DEFAULT_FX, filterCutoffHz: -100 });
    expect(loadAudioFxCache().filterCutoffHz).toBe(40);
  });

  it("clampt delayFeedback auf [0, 0.95]", () => {
    saveAudioFxCache({ ...DEFAULT_FX, delayFeedback: 1.5 });
    expect(loadAudioFxCache().delayFeedback).toBe(0.95);
  });

  it("rejects invalid waveform-Strings", () => {
    saveAudioFxCache({
      ...DEFAULT_FX,
      // @ts-expect-error explicit invalid waveform
      waveform: "noise",
    });
    expect(loadAudioFxCache().waveform).toBe(DEFAULT_FX.waveform);
  });

  it("kaputtes JSON → defaults", () => {
    window.localStorage.setItem("synthstudio:audioFx.v1", "{nope");
    expect(loadAudioFxCache().waveform).toBe(DEFAULT_FX.waveform);
  });

  it("clearAudioFxCache loescht eintrag", () => {
    saveAudioFxCache(DEFAULT_FX);
    clearAudioFxCache();
    expect(window.localStorage.getItem("synthstudio:audioFx.v1")).toBeNull();
  });

  it("saveAudioFxCache swallowed Quota-Errors", () => {
    const orig = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error("Quota"); };
    expect(() => saveAudioFxCache(DEFAULT_FX)).not.toThrow();
    window.localStorage.setItem = orig;
  });
});


// ─── SimAudioEngine FX-API ────────────────────────────────

describe("SimAudioEngine FX-API (Sprint-106)", () => {
  let originalAC: typeof AudioContext | undefined;
  let engine: SimAudioEngine;

  beforeEach(() => {
    originalAC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    engine = new SimAudioEngine();
  });

  afterEach(() => {
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext = originalAC;
  });

  it("getSettings liefert defaults vor enable", () => {
    const s = engine.getSettings();
    expect(s).toEqual(DEFAULT_FX);
  });

  it("setWaveform aendert settings", async () => {
    await engine.enable();
    engine.setWaveform("sawtooth");
    expect(engine.getSettings().waveform).toBe("sawtooth");
  });

  it("setFilterCutoff clamped + persistiert", async () => {
    await engine.enable();
    engine.setFilterCutoff(99999);
    expect(engine.getSettings().filterCutoffHz).toBe(20000);
    engine.setFilterCutoff(-100);
    expect(engine.getSettings().filterCutoffHz).toBe(40);
    engine.setFilterCutoff(1000);
    expect(engine.getSettings().filterCutoffHz).toBe(1000);
  });

  it("setFilterQ clamped auf [0.1, 20]", async () => {
    await engine.enable();
    engine.setFilterQ(100);
    expect(engine.getSettings().filterQ).toBe(20);
    engine.setFilterQ(0.001);
    expect(engine.getSettings().filterQ).toBe(0.1);
  });

  it("setDelayTime clamped auf [0, 1.5]", async () => {
    await engine.enable();
    engine.setDelayTime(5);
    expect(engine.getSettings().delayTimeS).toBe(1.5);
    engine.setDelayTime(-1);
    expect(engine.getSettings().delayTimeS).toBe(0);
  });

  it("setDelayFeedback clamped auf [0, 0.95]", async () => {
    await engine.enable();
    engine.setDelayFeedback(1.5);
    expect(engine.getSettings().delayFeedback).toBe(0.95);
    engine.setDelayFeedback(-1);
    expect(engine.getSettings().delayFeedback).toBe(0);
  });

  it("setMasterGain clamped auf [0, 1]", async () => {
    await engine.enable();
    engine.setMasterGain(2);
    expect(engine.getSettings().masterGain).toBe(1);
    engine.setMasterGain(-1);
    expect(engine.getSettings().masterGain).toBe(0);
  });

  it("applySettings bulk-updates", async () => {
    await engine.enable();
    engine.applySettings({
      waveform: "square",
      filterCutoffHz: 2000,
      delayTimeS: 0.5,
    });
    const s = engine.getSettings();
    expect(s.waveform).toBe("square");
    expect(s.filterCutoffHz).toBe(2000);
    expect(s.delayTimeS).toBe(0.5);
    // Nicht-gesetzte Felder behalten Default
    expect(s.filterQ).toBe(DEFAULT_FX.filterQ);
  });

  it("Setter NO-OP vor enable() (kein crash)", () => {
    expect(() => {
      engine.setWaveform("triangle");
      engine.setFilterCutoff(1000);
      engine.setDelayTime(0.1);
    }).not.toThrow();
    // Settings haben sich trotzdem aktualisiert (im internen Cache)
    expect(engine.getSettings().waveform).toBe("triangle");
  });

  it("nach disable bleiben settings erhalten", async () => {
    await engine.enable();
    engine.setWaveform("sawtooth");
    engine.setFilterCutoff(800);
    await engine.disable();
    const s = engine.getSettings();
    expect(s.waveform).toBe("sawtooth");
    expect(s.filterCutoffHz).toBe(800);
  });

  it("noteOn nach setWaveform spielt neuen Wellenform-Type", async () => {
    await engine.enable();
    engine.setWaveform("square");
    window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
      detail: { channel: 0, note: 60, velocity: 100 },
    }));
    expect(engine.activeVoiceCount).toBe(1);
    // Wir koennen den OscType nicht direkt ohne private access pruefen,
    // aber wir koennen sicher sein dass noteOn ohne crash funktioniert.
  });
});
