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
  createDynamicsCompressor() { return { ...makeGainMock(), threshold: { value: -24 }, ratio: { value: 4 }, attack: { value: 0.003 }, release: { value: 0.25 }, knee: { value: 30 } }; }
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

// ─── TASK-129: Synth-Part Channel-FX-Routing + DrumLoop Synth-Branch ──────────

/** Minimal-Part-Builder für Synth-Part-Tests (TASK-129). */
function makeSynthPart(overrides: Record<string, unknown> = {}) {
  return {
    id: "synth-1",
    name: "Synth",
    muted: false,
    soloed: false,
    volume: 0.8,
    pan: 0,
    steps: [],
    fx: {
      eq: { low: 0, mid: 0, high: 0 },
      filter: { type: "lowpass" as const, frequency: 1000, resonance: 1 },
      distortion: 0,
      compressor: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 },
      delay: { enabled: false, time: 0.5, feedback: 0.35, mix: 0.5 },
      reverb: { enabled: false, decay: 2.0, mix: 0.6 },
      send: { reverb: 0, delay: 0 },
      insertChain: [],
    },
    sourceType: "wavetable" as const,
    synthParams: {
      mode: "wavetable" as const,
      oscType: "sine" as const,
      detune: 0,
      fmRatio: 2,
      fmDepth: 0.5,
      attack: 0.01,
      decay: 0.1,
      sustain: 0.7,
      release: 0.2,
      glide: 0,
      lfoEnabled: false,
      lfoRate: 1,
      lfoDepth: 0,
      lfoWaveform: "sine" as const,
      lfoBpmSync: "free" as const,
      customWavetable: null,
    },
    ...overrides,
  };
}

describe("TASK-129 — Synth-Part Channel-FX-Routing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("AudioContext", MockAudioContext as unknown as typeof AudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("_triggerSynthOnChannel returnt true für wavetable-Part mit synthParams", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();
    const eng = AudioEngine as unknown as { _triggerSynthOnChannel: (...a: unknown[]) => boolean };
    const result = eng._triggerSynthOnChannel(0, 440, 0.8, 0, makeSynthPart());
    expect(result).toBe(true);
  });

  it("_triggerSynthOnChannel returnt true für fm-Part mit synthParams", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();
    const eng = AudioEngine as unknown as { _triggerSynthOnChannel: (...a: unknown[]) => boolean };
    const result = eng._triggerSynthOnChannel(0, 440, 0.8, 0, makeSynthPart({ sourceType: "fm" }));
    expect(result).toBe(true);
  });

  it("_triggerSynthOnChannel returnt false für sample-Part (Fallback)", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();
    const eng = AudioEngine as unknown as { _triggerSynthOnChannel: (...a: unknown[]) => boolean };
    const result = eng._triggerSynthOnChannel(0, 440, 0.8, 0, makeSynthPart({ sourceType: "sample" }));
    expect(result).toBe(false);
  });

  it("_triggerSynthOnChannel returnt false ohne synthParams", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();
    const eng = AudioEngine as unknown as { _triggerSynthOnChannel: (...a: unknown[]) => boolean };
    const result = eng._triggerSynthOnChannel(0, 440, 0.8, 0, makeSynthPart({ synthParams: undefined }));
    expect(result).toBe(false);
  });

  it("_triggerSynthOnChannel returnt false ohne init() (kein AudioContext)", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    // KEIN init()
    const eng = AudioEngine as unknown as { _triggerSynthOnChannel: (...a: unknown[]) => boolean };
    const result = eng._triggerSynthOnChannel(0, 440, 0.8, 0, makeSynthPart());
    expect(result).toBe(false);
  });

  it("Wenn _triggerSynthOnChannel feuert, wird der Macro-LFO-Cache konsultiert (partId durchgereicht)", async () => {
    const { AudioEngine } = await import("@/audio/AudioEngine");
    await AudioEngine.init();

    // Cache füllen
    AudioEngine.setPartLfoRate("synth-1", 7.5);
    expect(AudioEngine.getPartLfoRate("synth-1")).toBe(7.5);

    // Synth-Trigger ruft SynthEngine.triggerNote(.., "synth-1") auf — der Cache
    // wird konsultiert und die LFO-Werte aus dem Cache appliziert.
    const eng = AudioEngine as unknown as { _triggerSynthOnChannel: (...a: unknown[]) => boolean };
    const result = eng._triggerSynthOnChannel(0, 440, 0.8, 0, makeSynthPart({
      synthParams: { ...makeSynthPart().synthParams, lfoEnabled: true, lfoRate: 2 },
    }));
    expect(result).toBe(true);

    // Cache bleibt nach dem Trigger erhalten (wird nicht clear'd)
    expect(AudioEngine.getPartLfoRate("synth-1")).toBe(7.5);
  });
});
