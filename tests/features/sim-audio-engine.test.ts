// @vitest-environment jsdom
/**
 * sim-audio-engine.test.ts — Sprint-102 Web-Audio Synth-Engine Tests.
 *
 * jsdom hat keine echte AudioContext — wir mocken sie minimal damit die
 * Lifecycle-Logik testbar ist (enable/disable, voice-count, note-tracking).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { SimAudioEngine } from "../../client/src/audio/SimAudioEngine";

// ─── Minimal AudioContext-Mock ────────────────────────────

class FakeGainNode {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class FakeOscillator {
  type = "sine";
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
  createGain(): FakeGainNode { return new FakeGainNode(); }
  createOscillator(): FakeOscillator { return new FakeOscillator(); }
}

describe("SimAudioEngine (Sprint-102)", () => {
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

  it("starts disabled", () => {
    expect(engine.isEnabled).toBe(false);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it("enable() switches isEnabled to true", async () => {
    await engine.enable();
    expect(engine.isEnabled).toBe(true);
  });

  it("enable() is idempotent", async () => {
    await engine.enable();
    await engine.enable();
    expect(engine.isEnabled).toBe(true);
  });

  it("noteOn-Event spawns a voice", async () => {
    await engine.enable();
    window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
      detail: { channel: 0, note: 60, velocity: 100 },
    }));
    expect(engine.activeVoiceCount).toBe(1);
  });

  it("noteOff-Event releases the voice", async () => {
    await engine.enable();
    window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
      detail: { channel: 0, note: 60, velocity: 100 },
    }));
    expect(engine.activeVoiceCount).toBe(1);
    window.dispatchEvent(new CustomEvent("omnitribe:noteOff", {
      detail: { channel: 0, note: 60 },
    }));
    expect(engine.activeVoiceCount).toBe(0);
  });

  it("chord-trigger (3 noteOns) spawns 3 voices", async () => {
    await engine.enable();
    for (const note of [60, 64, 67]) {
      window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
        detail: { channel: 0, note, velocity: 100 },
      }));
    }
    expect(engine.activeVoiceCount).toBe(3);
  });

  it("disable() releases all active voices", async () => {
    await engine.enable();
    for (const note of [60, 64, 67]) {
      window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
        detail: { channel: 0, note, velocity: 100 },
      }));
    }
    expect(engine.activeVoiceCount).toBe(3);
    await engine.disable();
    expect(engine.activeVoiceCount).toBe(0);
    expect(engine.isEnabled).toBe(false);
  });

  it("voice-stealing kicks in beyond MAX_VOICES (32)", async () => {
    await engine.enable();
    // 35 verschiedene noteOns → max 32 aktive Voices
    for (let i = 0; i < 35; i++) {
      window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
        detail: { channel: 0, note: i, velocity: 100 },
      }));
    }
    expect(engine.activeVoiceCount).toBeLessThanOrEqual(32);
  });

  it("re-trigger same note replaces existing voice", async () => {
    await engine.enable();
    window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
      detail: { channel: 0, note: 60, velocity: 100 },
    }));
    window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
      detail: { channel: 0, note: 60, velocity: 100 },
    }));
    expect(engine.activeVoiceCount).toBe(1);
  });

  it("after disable() it ignores incoming events", async () => {
    await engine.enable();
    await engine.disable();
    window.dispatchEvent(new CustomEvent("omnitribe:noteOn", {
      detail: { channel: 0, note: 60, velocity: 100 },
    }));
    expect(engine.activeVoiceCount).toBe(0);
  });
});
