/**
 * macro-lfo-integration.test.ts (TASK-128)
 *
 * Integration-Test für die End-to-End-Macro-LFO-Routing-Kette:
 *
 *   applyMacroBindings(macro, value, { setLfoRate, setLfoDepth })
 *     → AudioEngine.setPartLfoRate / setPartLfoDepth
 *       → SynthEngine.setPartLfoRate / setPartLfoDepth (via _getOrCreateSynthEngine)
 *         → _partLfoCache.set(partId, { rate, depth })
 *
 * Sicherstellt, dass ein Macro-Knob-Wert tatsächlich im SynthEngine-Cache landet
 * — was die Voraussetzung dafür ist, dass `triggerNote(.., partId)` beim
 * nächsten Step-Trigger die gecachten Werte über `params.lfoRate/lfoDepth` legt.
 *
 * Hinweis: dieser Test verwendet AudioEngine als Singleton mit Mocked
 * AudioContext via `vi.stubGlobal`. Wir nutzen die Public-Surface (Setter +
 * Getter-Delegates) — _triggerMelodicNote-Aufruf ist im Test nicht nötig,
 * weil die LFO-Cache-Persistenz das eigentliche TASK-128-Akzeptanzkriterium ist.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyMacroBindings, type Macro } from "@/store/useMacroStore";

// ─── Web Audio API Mock (gemeinsam mit synth-engine.test.ts Logik) ────────────
function makeOscillatorMock() {
  return {
    type: "sine" as OscillatorType,
    frequency: { value: 440, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    detune: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}
function makeGainMock() {
  return {
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  };
}
function makePannerMock() {
  return {
    pan: { value: 0 },
    connect: vi.fn(),
  };
}
function makeConvolverMock() {
  return {
    buffer: null,
    connect: vi.fn(),
  };
}
function makeDelayMock() {
  return {
    delayTime: { value: 0 },
    connect: vi.fn(),
  };
}

class MockAudioContext {
  currentTime = 0;
  destination = {};
  state = "running";
  createOscillator() { return makeOscillatorMock(); }
  createGain() { return makeGainMock(); }
  createStereoPanner() { return makePannerMock(); }
  createConvolver() { return makeConvolverMock(); }
  createDelay(_max?: number) { return makeDelayMock(); }
  createBiquadFilter() { return { ...makeGainMock(), type: "lowpass", frequency: { value: 1000 }, Q: { value: 1 } }; }
  createDynamicsCompressor() { return { ...makeGainMock(), threshold: { value: -24 }, ratio: { value: 4 }, attack: { value: 0.003 }, release: { value: 0.25 } }; }
  createWaveShaper() { return makeGainMock(); }
  createAnalyser() { return { ...makeGainMock(), fftSize: 2048, getByteFrequencyData: vi.fn() }; }
  createBuffer() { return { duration: 1, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array(44100) }; }
  createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}

describe("TASK-128 — Macro→AudioEngine→SynthEngine LFO-Cache Integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("AudioContext", MockAudioContext as unknown as typeof AudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applyMacroBindings(lfo-rate) → AudioEngine.setPartLfoRate → SynthEngine-Cache hält den Wert", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();

    const macro: Macro = {
      index: 0,
      label: "Test",
      value: 0.5,
      color: "#f59e0b",
      mode: "knob",
      bindings: [
        { id: "b1", target: "lfo-rate", partId: "lead", minValue: 0.1, maxValue: 10 },
      ],
    };

    applyMacroBindings(macro, 0.5, {
      setLfoRate: (id, v) => AudioEngine.setPartLfoRate(id, v),
    });

    // value=0.5 zwischen 0.1..10 → 5.05
    const cached = AudioEngine.getPartLfoRate("lead");
    expect(cached).not.toBeNull();
    expect(cached).toBeCloseTo(5.05, 2);
  });

  it("applyMacroBindings(lfo-depth) → AudioEngine.setPartLfoDepth → SynthEngine-Cache hält den Wert (0..1 normalisiert)", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();

    const macro: Macro = {
      index: 1,
      label: "Depth",
      value: 0.8,
      color: "#06b6d4",
      mode: "knob",
      bindings: [
        { id: "b2", target: "lfo-depth", partId: "bass", minValue: 0, maxValue: 1 },
      ],
    };

    applyMacroBindings(macro, 0.8, {
      setLfoDepth: (id, v) => AudioEngine.setPartLfoDepth(id, v),
    });

    // value=0.8 zwischen 0..1 → 0.8
    const cached = AudioEngine.getPartLfoDepth("bass");
    expect(cached).not.toBeNull();
    expect(cached).toBeCloseTo(0.8, 2);
  });

  it("Mehrere Parts: Cache-Werte werden pro partId getrennt gehalten", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();

    AudioEngine.setPartLfoRate("kick", 2);
    AudioEngine.setPartLfoRate("snare", 8);
    AudioEngine.setPartLfoDepth("kick", 0.3);

    expect(AudioEngine.getPartLfoRate("kick")).toBe(2);
    expect(AudioEngine.getPartLfoRate("snare")).toBe(8);
    expect(AudioEngine.getPartLfoDepth("kick")).toBeCloseTo(0.3, 5);
    expect(AudioEngine.getPartLfoDepth("snare")).toBeNull();
  });

  it("Range-Clamping bleibt erhalten: hz=999 → 30 (PART_LFO_RATE_MAX)", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();

    AudioEngine.setPartLfoRate("x", 999);
    expect(AudioEngine.getPartLfoRate("x")).toBe(30);
  });

  it("Range-Clamping bleibt erhalten: depth=-0.5 → 0 (PART_LFO_DEPTH_MIN)", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();

    AudioEngine.setPartLfoDepth("x", -0.5);
    expect(AudioEngine.getPartLfoDepth("x")).toBe(0);
  });

  it("Ohne init() (kein AudioContext): Setter sind no-op, Getter liefern null", async () => {
    // Diesmal KEIN init() — Setter dürfen nicht crashen
    const { AudioEngine } = await import("@/audio/AudioEngine");

    expect(() => AudioEngine.setPartLfoRate("y", 5)).not.toThrow();
    expect(AudioEngine.getPartLfoRate("y")).toBeNull();
  });
});
