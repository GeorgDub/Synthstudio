/**
 * tests/features/channel-bounce.test.ts
 *
 * Unit-Tests für TASK-241 (v2.94 / v2.95): Per-Channel WAV-Bounce.
 *
 * Coverage v2.95:
 *  1. computeBounceDurationSec — Pure-Helper (bars/bpm/stepsPerBar → Sekunden)
 *  2. computeDynamicTailSec   — Reverb/Delay-aware Tail
 *  3. resolveBounceBars       — Mode-Switch (currentPattern/currentLoop/customBars)
 *  4. sanitizeStemFilenameStem — Filename-Sanitizer
 *  5. defaultStemFilename     — Filename-Aggregator
 *  6. makeDistortionCurve     — WaveShaper-Curve (Pure)
 *  7. buildReverbImpulse      — IR-Generator
 *  8. buildOfflinePartGraph   — Volle FX-Chain im Offline-Ctx
 *  9. renderChannelToBuffer   — OfflineAudioContext-Mock-Render (FX + bypass)
 * 10. bounceChannelToWavBuffer — End-to-End WAV-Header-Validation
 * 11. bounceAllChannels       — Multi-Channel-Iterator + Progress
 * 12. Edge-Cases (silent-channel, no-sample, max-duration, mute, defensive FX)
 */
import { describe, it, expect, vi } from "vitest";

import {
  computeBounceDurationSec,
  computeDynamicTailSec,
  resolveBounceBars,
  sanitizeStemFilenameStem,
  defaultStemFilename,
  makeDistortionCurve,
  buildReverbImpulse,
  buildOfflinePartGraph,
  renderChannelToBuffer,
  bounceChannelToWavBuffer,
  bounceAllChannels,
  BOUNCE_MAX_DURATION_SEC,
  BOUNCE_WARN_DURATION_SEC,
  // v3.41 — neue FX-Helpers
  makeBitcrusherCurve,
  applyBitcrusher,
  applyBitcrusherToBuffer,
  applyTransientShaper,
  applyTransientShaperToBuffer,
  buildRingModOffline,
  // v3.42 — synth pre-processing
  hasSynthPreProcessing,
  type ChannelBounceRenderOptions,
  type BounceAllProgress,
  type OfflineAudioContextCtor,
} from "../../client/src/utils/channelBounce";
import { isValidWavHeader, WAV_HEADER_SIZE } from "../../client/src/audio/wavEncoder";
import type { PartData, PatternData, ChannelFx } from "../../client/src/audio/AudioEngine";
import type { MixerFxSlot } from "../../client/src/utils/mixerFx";

// ─── Mocks ───────────────────────────────────────────────────────────────────

class MockAudioBuffer {
  private _data: Float32Array[];
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  constructor(channels: number, length: number, sampleRate: number) {
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
  }
  getChannelData(ch: number): Float32Array {
    return this._data[ch];
  }
  copyToChannel(src: Float32Array, ch: number, offset: number = 0): void {
    this._data[ch].set(src, offset);
  }
  copyFromChannel(dest: Float32Array, ch: number, offset: number = 0): void {
    dest.set(this._data[ch].subarray(offset, offset + dest.length));
  }
}

/**
 * Spies pro Node-Type. Wir tracken sowohl Creation-Counts als auch die
 * tatsächlichen Setter-Werte um FX-Param-Assertions zu erlauben.
 */
interface MockCtxStats {
  bufferSourcesCreated: number;
  startCalls: Array<{ when: number }>;
  gainNodesCreated: number;
  pannerNodesCreated: number;
  filterNodesCreated: number;
  waveShapersCreated: number;
  compressorsCreated: number;
  delaysCreated: number;
  convolversCreated: number;
  buffersCreated: number;
  oscillatorsCreated: number;
  oscTypesSet: string[];
  oscStarts: Array<{ when: number }>;
  oscStops: Array<{ when: number }>;
  oscFreqSets: number[];
  oscFreqRampTargets: number[];
  oscDetuneSet: number[];
  ampRamps: Array<{ value: number; time: number }>;
  ampSetAt: Array<{ value: number; time: number }>;
  panValuesSet: number[];
  gainValuesSet: number[];
  filterFreqsSet: number[];
  filterTypesSet: string[];
  filterQsSet: number[];
  filterGainsSet: number[];
  waveShaperCurves: Float32Array[];
  compressorThresholds: number[];
  compressorRatios: number[];
  compressorAttacks: number[];
  compressorReleases: number[];
  delayTimesSet: number[];
  convolverBuffers: (MockAudioBuffer | null)[];
  playbackRatesSet: number[];
  connections: Array<{ from: string; to: string }>;
}

function makeMockOfflineCtxCtor(stats: MockCtxStats): OfflineAudioContextCtor {
  // Pseudo-Class via Function-Constructor — ergibt einen Konstruktor mit
  // identischer Signatur zu OfflineAudioContext.
  return class MockOfflineCtx {
    destination = { __isDestination: true, _kind: "destination" };
    private channels: number;
    private length: number;
    sampleRate: number;
    constructor(channels: number, length: number, sampleRate: number) {
      this.channels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
    }
    createBufferSource() {
      stats.bufferSourcesCreated++;
      const _kind = "bufferSource";
      return {
        _kind,
        buffer: null as MockAudioBuffer | null,
        playbackRate: {
          get value() { return 1; },
          set value(v: number) { stats.playbackRatesSet.push(v); },
        } as { value: number },
        start(when: number = 0) { stats.startCalls.push({ when }); },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
    }
    createGain() {
      stats.gainNodesCreated++;
      const _kind = "gain";
      const node = {
        _kind,
        gain: {
          get value() { return 0; },
          set value(v: number) { stats.gainValuesSet.push(v); },
          setValueAtTime(value: number, time: number) {
            stats.ampSetAt.push({ value, time });
          },
          linearRampToValueAtTime(value: number, time: number) {
            stats.ampRamps.push({ value, time });
          },
          exponentialRampToValueAtTime(value: number, time: number) {
            stats.ampRamps.push({ value, time });
          },
          cancelScheduledValues() { /* noop */ },
        },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
      return node;
    }
    createOscillator() {
      stats.oscillatorsCreated++;
      const _kind = "oscillator";
      const freqParam = {
        get value() { return 0; },
        set value(v: number) { stats.oscFreqSets.push(v); },
        setValueAtTime(value: number, _time: number) {
          stats.oscFreqSets.push(value);
        },
        linearRampToValueAtTime(value: number, _time: number) {
          stats.oscFreqRampTargets.push(value);
        },
        cancelScheduledValues() { /* noop */ },
      };
      const detuneParam = {
        get value() { return 0; },
        set value(v: number) { stats.oscDetuneSet.push(v); },
        setValueAtTime(value: number, _time: number) { stats.oscDetuneSet.push(value); },
        linearRampToValueAtTime() { /* noop */ },
        cancelScheduledValues() { /* noop */ },
      };
      const node = {
        _kind,
        _type: "sine" as string,
        get type() { return node._type; },
        set type(v: string) {
          node._type = v;
          stats.oscTypesSet.push(v);
        },
        frequency: freqParam,
        detune: detuneParam,
        start(when: number = 0) { stats.oscStarts.push({ when }); },
        stop(when: number = 0) { stats.oscStops.push({ when }); },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
      return node;
    }
    createStereoPanner() {
      stats.pannerNodesCreated++;
      const _kind = "panner";
      return {
        _kind,
        pan: {
          get value() { return 0; },
          set value(v: number) { stats.panValuesSet.push(v); },
        } as { value: number },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
    }
    createBiquadFilter() {
      stats.filterNodesCreated++;
      const _kind = "biquad";
      const node = {
        _kind,
        _type: "lowpass" as string,
        get type() { return node._type; },
        set type(v: string) {
          node._type = v;
          stats.filterTypesSet.push(v);
        },
        frequency: {
          get value() { return 0; },
          set value(v: number) { stats.filterFreqsSet.push(v); },
        } as { value: number },
        Q: {
          get value() { return 1; },
          set value(v: number) { stats.filterQsSet.push(v); },
        } as { value: number },
        gain: {
          get value() { return 0; },
          set value(v: number) { stats.filterGainsSet.push(v); },
        } as { value: number },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
      return node;
    }
    createWaveShaper() {
      stats.waveShapersCreated++;
      const _kind = "waveShaper";
      return {
        _kind,
        _curve: null as Float32Array | null,
        get curve() { return this._curve; },
        set curve(v: Float32Array | null) {
          this._curve = v;
          if (v) stats.waveShaperCurves.push(v);
        },
        oversample: "none" as string,
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
    }
    createDynamicsCompressor() {
      stats.compressorsCreated++;
      const _kind = "compressor";
      return {
        _kind,
        threshold: {
          get value() { return -24; },
          set value(v: number) { stats.compressorThresholds.push(v); },
        } as { value: number },
        ratio: {
          get value() { return 4; },
          set value(v: number) { stats.compressorRatios.push(v); },
        } as { value: number },
        attack: {
          get value() { return 0.003; },
          set value(v: number) { stats.compressorAttacks.push(v); },
        } as { value: number },
        release: {
          get value() { return 0.25; },
          set value(v: number) { stats.compressorReleases.push(v); },
        } as { value: number },
        knee: { value: 30 } as { value: number },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
    }
    createDelay(_max: number = 2.0) {
      stats.delaysCreated++;
      const _kind = "delay";
      return {
        _kind,
        delayTime: {
          get value() { return 0; },
          set value(v: number) { stats.delayTimesSet.push(v); },
        } as { value: number },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
    }
    createConvolver() {
      stats.convolversCreated++;
      const _kind = "convolver";
      const node = {
        _kind,
        _buffer: null as MockAudioBuffer | null,
        get buffer() { return this._buffer; },
        set buffer(v: MockAudioBuffer | null) {
          this._buffer = v;
          stats.convolverBuffers.push(v);
        },
        connect(target: { _kind?: string }) {
          stats.connections.push({ from: _kind, to: target?._kind ?? "unknown" });
        },
        disconnect() { /* noop */ },
      };
      return node;
    }
    createBuffer(channels: number, length: number, sampleRate: number) {
      stats.buffersCreated++;
      return new MockAudioBuffer(channels, length, sampleRate);
    }
    async startRendering(): Promise<MockAudioBuffer> {
      return new MockAudioBuffer(this.channels, this.length, this.sampleRate);
    }
  } as unknown as OfflineAudioContextCtor;
}

function freshStats(): MockCtxStats {
  return {
    bufferSourcesCreated: 0,
    startCalls: [],
    gainNodesCreated: 0,
    pannerNodesCreated: 0,
    filterNodesCreated: 0,
    waveShapersCreated: 0,
    compressorsCreated: 0,
    delaysCreated: 0,
    convolversCreated: 0,
    buffersCreated: 0,
    oscillatorsCreated: 0,
    oscTypesSet: [],
    oscStarts: [],
    oscStops: [],
    oscFreqSets: [],
    oscFreqRampTargets: [],
    oscDetuneSet: [],
    ampRamps: [],
    ampSetAt: [],
    panValuesSet: [],
    gainValuesSet: [],
    filterFreqsSet: [],
    filterTypesSet: [],
    filterQsSet: [],
    filterGainsSet: [],
    waveShaperCurves: [],
    compressorThresholds: [],
    compressorRatios: [],
    compressorAttacks: [],
    compressorReleases: [],
    delayTimesSet: [],
    convolverBuffers: [],
    playbackRatesSet: [],
    connections: [],
  };
}

/** Default-FX entspricht `DEFAULT_CHANNEL_FX` aus AudioEngine: alle disabled. */
function defaultChannelFx(overrides: Partial<ChannelFx> = {}): ChannelFx {
  return {
    filterEnabled: false,
    filterType: "lowpass",
    filterFreq: 20000,
    filterQ: 1,
    filterGain: 0,
    distortionEnabled: false,
    distortionAmount: 50,
    compressorEnabled: false,
    compressorThreshold: -24,
    compressorRatio: 4,
    compressorAttack: 0.003,
    compressorRelease: 0.25,
    delayEnabled: false,
    delayTime: 0.25,
    delayFeedback: 0.3,
    delayMix: 0.3,
    reverbEnabled: false,
    reverbDecay: 2.0,
    reverbMix: 0.3,
    eqEnabled: false,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    ...overrides,
  };
}

function makePart(overrides: Partial<PartData> = {}): PartData {
  const steps = Array.from({ length: 16 }, (_, i) => ({
    active: i % 4 === 0,    // Step 0, 4, 8, 12 active
    velocity: 100,
  }));
  return {
    id: "part-1",
    name: "Kick",
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: defaultChannelFx(),
    sourceType: "sample",
    sampleUrl: "test-sample.wav",
    ...overrides,
  } as PartData;
}

function makePattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: "pat-1",
    name: "Pattern 1",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: null,
    parts: [makePart()],
    ...overrides,
  } as PatternData;
}

// ─── 1. computeBounceDurationSec ─────────────────────────────────────────────

describe("computeBounceDurationSec", () => {
  it("liefert 2.0sec für 1 Bar 16 steps @ 120 bpm (ohne tail)", () => {
    expect(computeBounceDurationSec(1, 16, 120, 0)).toBeCloseTo(2.0, 3);
  });

  it("addiert den tailSec-Wert", () => {
    expect(computeBounceDurationSec(1, 16, 120, 0.5)).toBeCloseTo(2.5, 3);
  });

  it("skaliert linear mit bars", () => {
    const oneBar = computeBounceDurationSec(1, 16, 120, 0);
    const fourBars = computeBounceDurationSec(4, 16, 120, 0);
    expect(fourBars).toBeCloseTo(oneBar * 4, 3);
  });

  it("liefert 0 bei invaliden Inputs", () => {
    expect(computeBounceDurationSec(0, 16, 120)).toBe(0);
    expect(computeBounceDurationSec(1, 16, 0)).toBe(0);
    expect(computeBounceDurationSec(1, 0, 120)).toBe(0);
    expect(computeBounceDurationSec(NaN, 16, 120)).toBe(0);
    expect(computeBounceDurationSec(1, 16, NaN)).toBe(0);
  });

  it("respektiert höheren BPM-Wert (kürzer)", () => {
    const slow = computeBounceDurationSec(1, 16, 60, 0);
    const fast = computeBounceDurationSec(1, 16, 240, 0);
    expect(slow).toBeCloseTo(fast * 4, 3);
  });
});

// ─── 2. computeDynamicTailSec (NEU v2.95) ────────────────────────────────────

describe("computeDynamicTailSec", () => {
  it("default 0.5s wenn keine FX aktiv", () => {
    expect(computeDynamicTailSec(defaultChannelFx())).toBe(0.5);
  });

  it("Reverb-Decay vergrößert den Tail", () => {
    const fx = defaultChannelFx({ reverbEnabled: true, reverbDecay: 3.0 });
    // tail = 3.0 + 0.2 = 3.2
    expect(computeDynamicTailSec(fx)).toBeCloseTo(3.2, 2);
  });

  it("Delay-Feedback addiert sich auf den Tail (max 4s)", () => {
    const fx = defaultChannelFx({
      delayEnabled: true, delayTime: 0.5, delayFeedback: 0.8,
    });
    // delayTail = 0.5*0.8/0.2 + 0.5 = 2.5 → max(0.5, 2.5) = 2.5
    expect(computeDynamicTailSec(fx)).toBeGreaterThan(0.5);
    expect(computeDynamicTailSec(fx)).toBeLessThanOrEqual(4.0);
  });

  it("Reverb + Delay → der größere gewinnt", () => {
    const fx = defaultChannelFx({
      reverbEnabled: true, reverbDecay: 6.0,
      delayEnabled: true, delayTime: 0.2, delayFeedback: 0.5,
    });
    expect(computeDynamicTailSec(fx)).toBeCloseTo(6.2, 2);
  });

  it("undefined fx → 0.5 (defensive)", () => {
    expect(computeDynamicTailSec(undefined)).toBe(0.5);
  });
});

// ─── 3. resolveBounceBars ────────────────────────────────────────────────────

describe("resolveBounceBars", () => {
  it("currentPattern → immer 1 Bar", () => {
    expect(resolveBounceBars({ mode: "currentPattern" })).toBe(1);
    expect(resolveBounceBars({ mode: "currentPattern", bars: 99 })).toBe(1);
  });

  it("currentLoop → Default 4 Bars", () => {
    expect(resolveBounceBars({ mode: "currentLoop" })).toBe(4);
    expect(resolveBounceBars({ mode: "currentLoop", bars: 8 })).toBe(8);
  });

  it("customBars → 1..64 geklemmt", () => {
    expect(resolveBounceBars({ mode: "customBars", bars: 1 })).toBe(1);
    expect(resolveBounceBars({ mode: "customBars", bars: 32 })).toBe(32);
    expect(resolveBounceBars({ mode: "customBars", bars: 100 })).toBe(64);
    expect(resolveBounceBars({ mode: "customBars", bars: 0 })).toBe(1);
    expect(resolveBounceBars({ mode: "customBars" })).toBe(1);
  });
});

// ─── 4+5. Filename-Sanitizer ─────────────────────────────────────────────────

describe("sanitizeStemFilenameStem", () => {
  it("ersetzt Whitespace durch Underscore", () => {
    expect(sanitizeStemFilenameStem("My Project")).toBe("My_Project");
  });

  it("entfernt Sonderzeichen", () => {
    expect(sanitizeStemFilenameStem("Hi/Hat (Open)")).toBe("HiHat_Open");
  });

  it("hat Default-Wert für leeren Input", () => {
    expect(sanitizeStemFilenameStem("")).toBe("stem");
    expect(sanitizeStemFilenameStem("   ")).toBe("stem");
    expect(sanitizeStemFilenameStem("///")).toBe("stem");
  });

  it("trimmt auf max 80 Zeichen", () => {
    const long = "a".repeat(200);
    expect(sanitizeStemFilenameStem(long).length).toBe(80);
  });

  it("behält erlaubte Sonderzeichen _ und -", () => {
    expect(sanitizeStemFilenameStem("Snare_v2-final")).toBe("Snare_v2-final");
  });
});

describe("defaultStemFilename", () => {
  it("kombiniert project + channel + suffix", () => {
    expect(defaultStemFilename("MyProj", "Kick")).toBe("MyProj-Kick-stem.wav");
  });

  it("sanitisiert beide Komponenten", () => {
    expect(defaultStemFilename("My Proj!", "Hi Hat")).toBe("My_Proj-Hi_Hat-stem.wav");
  });

  it("fällt auf 'synthstudio'/'channel' zurück bei leerem Input", () => {
    expect(defaultStemFilename("", "")).toBe("synthstudio-channel-stem.wav");
  });
});

// ─── 6. makeDistortionCurve (NEU v2.95) ──────────────────────────────────────

describe("makeDistortionCurve", () => {
  it("liefert 256-Sample Float32Array", () => {
    const curve = makeDistortionCurve(0);
    expect(curve.length).toBe(256);
    expect(curve).toBeInstanceOf(Float32Array);
  });

  it("amount=0 ergibt lineare Identitäts-Curve", () => {
    const curve = makeDistortionCurve(0);
    // Sample i=0 → x=-1, Sample i=128 → x=0, Sample i=255 → x≈+1
    expect(curve[0]).toBeCloseTo(-1, 2);
    expect(curve[128]).toBeCloseTo(0, 2);
    expect(curve[255]).toBeCloseTo(0.99, 1);
  });

  it("amount>0 erzeugt nicht-lineare Saturation", () => {
    const flat = makeDistortionCurve(0);
    const driven = makeDistortionCurve(100);
    // Bei mittlerem x dürfte die driven-Curve näher an ±1 liegen
    expect(Math.abs(driven[200])).toBeGreaterThan(Math.abs(flat[200]) * 0.9);
    // Curve bleibt bounded [-1, 1]
    for (let i = 0; i < 256; i++) {
      expect(driven[i]).toBeGreaterThanOrEqual(-1.01);
      expect(driven[i]).toBeLessThanOrEqual(1.01);
    }
  });

  it("höhere amount → stärkere Saturation am Mittelpunkt", () => {
    const low = makeDistortionCurve(10);
    const high = makeDistortionCurve(400);
    // High-Drive sollte für ein gegebenes x mit |x|>0 weiter weg von der
    // Diagonalen sein als Low-Drive.
    const i = 192; // x ≈ 0.5
    const ref = (i * 2) / 256 - 1;
    expect(Math.abs(high[i] - ref)).toBeGreaterThanOrEqual(Math.abs(low[i] - ref));
  });
});

// ─── 7. buildReverbImpulse (NEU v2.95) ───────────────────────────────────────

describe("buildReverbImpulse", () => {
  it("liefert AudioBuffer mit korrekter Länge", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const ir = buildReverbImpulse(ctx, 2.0);
    expect(ir).not.toBeNull();
    if (ir) {
      expect(ir.sampleRate).toBe(48000);
      expect(ir.length).toBe(48000 * 2);
      expect(ir.numberOfChannels).toBe(2);
    }
  });

  it("liefert null bei decay <= 0", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    expect(buildReverbImpulse(ctx, 0)).toBeNull();
    expect(buildReverbImpulse(ctx, -1)).toBeNull();
    expect(buildReverbImpulse(ctx, NaN)).toBeNull();
  });

  it("IR-Samples decay-en zum Ende hin (exponential-decay)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const ir = buildReverbImpulse(ctx, 1.0);
    expect(ir).not.toBeNull();
    if (ir) {
      const data = ir.getChannelData(0);
      // Erster Sample sollte größere Amplitude haben als der letzte
      const first10 = Math.max(...Array.from(data.slice(0, 10)).map(Math.abs));
      const last10 = Math.max(...Array.from(data.slice(-10)).map(Math.abs));
      expect(first10).toBeGreaterThan(last10);
    }
  });
});

// ─── 8. buildOfflinePartGraph (NEU v2.95) ────────────────────────────────────

describe("buildOfflinePartGraph", () => {
  it("baut alle FX-Nodes auch im disabled-State (Topologie konsistent)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    buildOfflinePartGraph(ctx, part, 2);
    expect(stats.filterNodesCreated).toBe(4);  // 3 EQ-Bands + 1 Filter
    expect(stats.waveShapersCreated).toBe(1);
    expect(stats.compressorsCreated).toBe(1);
    expect(stats.delaysCreated).toBe(1);
    expect(stats.convolversCreated).toBe(1);
    expect(stats.pannerNodesCreated).toBe(1);
  });

  it("EQ disabled → alle EQ-Bands haben gain=0", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ eqEnabled: false, eqLow: 6, eqMid: -3, eqHigh: 9 }) });
    buildOfflinePartGraph(ctx, part);
    // 3 EQ-Bands setzen gain — alle sollten 0 sein (disabled)
    expect(stats.filterGainsSet.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("EQ enabled → Lowshelf/Peaking/Highshelf-Gains werden übernommen", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ eqEnabled: true, eqLow: 6, eqMid: -3, eqHigh: 9 }) });
    buildOfflinePartGraph(ctx, part);
    // Erste drei Gain-Sets sind die EQ-Bänder (Low/Mid/High Reihenfolge)
    expect(stats.filterGainsSet[0]).toBe(6);
    expect(stats.filterGainsSet[1]).toBe(-3);
    expect(stats.filterGainsSet[2]).toBe(9);
  });

  it("Distortion-Drive parametrisiert WaveShaper-Curve", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ distortionEnabled: true, distortionAmount: 200 }) });
    buildOfflinePartGraph(ctx, part);
    expect(stats.waveShaperCurves.length).toBe(1);
    const curve = stats.waveShaperCurves[0];
    // amount=200 sollte deutliche Saturation gegen lineare Identität ergeben
    const flat = makeDistortionCurve(0);
    let driftSum = 0;
    for (let i = 0; i < 256; i++) {
      driftSum += Math.abs(curve[i] - flat[i]);
    }
    expect(driftSum).toBeGreaterThan(1);
  });

  it("Distortion disabled → flat curve (keine Saturation)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ distortionEnabled: false, distortionAmount: 200 }) });
    buildOfflinePartGraph(ctx, part);
    const curve = stats.waveShaperCurves[0];
    const flat = makeDistortionCurve(0);
    // Mit disabled bei amount-Override sollte die Curve flat=Identität sein
    for (let i = 0; i < 256; i++) {
      expect(curve[i]).toBeCloseTo(flat[i], 5);
    }
  });

  it("Compressor enabled → Threshold/Ratio/Attack/Release werden gesetzt", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({
      compressorEnabled: true,
      compressorThreshold: -18,
      compressorRatio: 8,
      compressorAttack: 0.005,
      compressorRelease: 0.1,
    }) });
    buildOfflinePartGraph(ctx, part);
    expect(stats.compressorThresholds).toContain(-18);
    expect(stats.compressorRatios).toContain(8);
    expect(stats.compressorAttacks).toContain(0.005);
    expect(stats.compressorReleases).toContain(0.1);
  });

  it("Compressor disabled → Bypass (Threshold=0, Ratio=1)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ compressorEnabled: false }) });
    buildOfflinePartGraph(ctx, part);
    expect(stats.compressorThresholds).toContain(0);
    expect(stats.compressorRatios).toContain(1);
  });

  it("Delay enabled → delayTime + delayWet + delayFeedback gesetzt", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({
      delayEnabled: true, delayTime: 0.375, delayFeedback: 0.5, delayMix: 0.4,
    }) });
    buildOfflinePartGraph(ctx, part);
    expect(stats.delayTimesSet).toContain(0.375);
    // delayWet ist ein Gain-Node, der Wert sollte irgendwo in den Gain-Sets sein
    expect(stats.gainValuesSet).toContain(0.4);
    // delayFeedback Gain ebenfalls (0.5)
    expect(stats.gainValuesSet).toContain(0.5);
  });

  it("Reverb enabled → Convolver bekommt IR-Buffer", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ reverbEnabled: true, reverbDecay: 1.5, reverbMix: 0.5 }) });
    buildOfflinePartGraph(ctx, part);
    // IR wird per createBuffer angelegt
    expect(stats.buffersCreated).toBeGreaterThan(0);
    expect(stats.convolverBuffers.length).toBeGreaterThan(0);
    expect(stats.convolverBuffers[0]).not.toBeNull();
    // Reverb-Wet-Gain = 0.5
    expect(stats.gainValuesSet).toContain(0.5);
  });

  it("Reverb disabled → kein IR-Buffer angelegt", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ reverbEnabled: false, reverbDecay: 2.0 }) });
    buildOfflinePartGraph(ctx, part);
    expect(stats.buffersCreated).toBe(0);
    // Convolver wird trotzdem angelegt (Bypass-Topologie), aber buffer bleibt null
    expect(stats.convolversCreated).toBe(1);
  });

  it("Filter enabled → frequency + Q übernommen", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({
      filterEnabled: true, filterType: "highpass", filterFreq: 800, filterQ: 5,
    }) });
    buildOfflinePartGraph(ctx, part);
    expect(stats.filterFreqsSet).toContain(800);
    expect(stats.filterQsSet).toContain(5);
    expect(stats.filterTypesSet).toContain("highpass");
  });

  it("Filter disabled → Bypass-allpass-Mode", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({ filterEnabled: false }) });
    buildOfflinePartGraph(ctx, part);
    expect(stats.filterTypesSet).toContain("allpass");
  });

  it("Mono-Mode → kein StereoPanner", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    buildOfflinePartGraph(ctx, part, 1);
    expect(stats.pannerNodesCreated).toBe(0);
  });

  it("Stereo-Mode → Pan-Wert wird auf Panner gesetzt", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ pan: -0.6 });
    buildOfflinePartGraph(ctx, part, 2);
    expect(stats.panValuesSet).toContain(-0.6);
  });

  it("undefined fx → Pass-Through ohne Crash (defensive)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    // @ts-expect-error — Test der defensive fx-Fallback-Branch
    delete part.fx;
    expect(() => buildOfflinePartGraph(ctx, part)).not.toThrow();
  });

  it("NaN/Infinity in fx-Feldern → Fallback-Werte (defensive)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart({ fx: defaultChannelFx({
      filterEnabled: true,
      filterFreq: NaN,
      filterQ: Infinity,
    }) });
    expect(() => buildOfflinePartGraph(ctx, part)).not.toThrow();
    // NaN-Fallback ist 20000, was dann auf Max-clamped wird (20000)
    expect(stats.filterFreqsSet.some(v => Number.isFinite(v))).toBe(true);
  });
});

// ─── 9. renderChannelToBuffer ────────────────────────────────────────────────

describe("renderChannelToBuffer", () => {
  it("liefert AudioBuffer mit korrekter Länge (Sample-Frames)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    const opts: ChannelBounceRenderOptions = {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      tailSec: 0.5,  // explicit override
    };
    const result = await renderChannelToBuffer(part, pattern, opts, CtxCtor);
    expect(result.sampleRate).toBe(48000);
    expect(result.buffer.length).toBe(Math.ceil(2.5 * 48000));
    expect(result.buffer.numberOfChannels).toBe(2);
  });

  it("erzeugt einen BufferSource pro aktiven Step", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart(); // 4 active steps
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    expect(stats.bufferSourcesCreated).toBe(4);
    expect(stats.startCalls.length).toBe(4);
  });

  it("Pan-Wert wird einmal pro Channel gesetzt (Graph wird einmal gebaut)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart({ pan: 0.7 });
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    // v2.95: nur EIN Panner pro Channel (nicht pro Step)
    expect(stats.panValuesSet).toContain(0.7);
    expect(stats.pannerNodesCreated).toBe(1);
  });

  it("muted Channel → step-gain wird auf 0 gesetzt", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart({ muted: true, volume: 1 });
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    // Für muted-Channel: jeder Step erzeugt stepGain mit gain=0
    expect(stats.gainValuesSet.filter(v => v === 0).length).toBeGreaterThanOrEqual(4);
  });

  it("kein Sample-Buffer → liefert silent Buffer ohne BufferSources", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const result = await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer: null,
    }, CtxCtor);
    expect(stats.bufferSourcesCreated).toBe(0);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("v2.95: FX-Chain wird einmalig gebaut (ein Set FX-Nodes)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    // 3 EQ-Bands + 1 Filter = 4 Biquads (nur einmal, nicht pro Step)
    expect(stats.filterNodesCreated).toBe(4);
    expect(stats.compressorsCreated).toBe(1);
    expect(stats.delaysCreated).toBe(1);
    expect(stats.convolversCreated).toBe(1);
  });

  it("bypassFx=true → kein WaveShaper/Compressor/Delay/Convolver", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart({ fx: defaultChannelFx({ filterEnabled: true, filterFreq: 5000 }) });
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      bypassFx: true,
    }, CtxCtor);
    // Legacy v2.94-Pfad: nur per-Step Filter wenn freq<20k
    expect(stats.waveShapersCreated).toBe(0);
    expect(stats.compressorsCreated).toBe(0);
    expect(stats.convolversCreated).toBe(0);
    // Aber Filter wurde pro Step erzeugt (4 active steps)
    expect(stats.filterNodesCreated).toBe(4);
  });

  it("Mono-Mode erzeugt keinen StereoPanner (v2.95)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart({ pan: 0.5 });
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      channels: 1,
    }, CtxCtor);
    expect(stats.pannerNodesCreated).toBe(0);
  });

  it("wirft bei Duration > BOUNCE_MAX_DURATION_SEC", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    await expect(
      renderChannelToBuffer(part, pattern, {
        length: { mode: "customBars", bars: 64 },
        bpm: 1,
        sampleRate: 48000,
      }, CtxCtor)
    ).rejects.toThrow(/exceeds maximum/);
  });

  it("respektiert pattern.bpm Override wenn gesetzt", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern({ bpm: 60 });
    const result = await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      tailSec: 0.5,
    }, CtxCtor);
    expect(result.buffer.length).toBe(Math.ceil(4.5 * 48000));
  });

  it("dynamischer Tail: Reverb-Decay vergrößert Buffer-Länge", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart({ fx: defaultChannelFx({ reverbEnabled: true, reverbDecay: 3.0 }) });
    const pattern = makePattern();
    const result = await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      // explizit kein tailSec → dynamisch
    }, CtxCtor);
    // Reverb-Decay 3s + 0.2 = 3.2s Tail. Pattern 2s + Tail 3.2s = 5.2s.
    expect(result.buffer.length).toBeGreaterThan(Math.ceil(2.5 * 48000));
    expect(result.buffer.length).toBeGreaterThanOrEqual(Math.ceil(5.0 * 48000));
  });

  it("step.pitch wird auf playbackRate gemappt", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    part.steps[0] = { active: true, velocity: 100, pitch: 12 };  // +1 octave
    part.steps[4] = { active: true, velocity: 100, pitch: -12 }; // -1 octave
    part.steps[8] = { active: false };
    part.steps[12] = { active: false };
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    // +12 → playbackRate=2, -12 → playbackRate=0.5
    expect(stats.playbackRatesSet).toContain(2);
    expect(stats.playbackRatesSet).toContain(0.5);
  });
});

// ─── 9b. Synth-Parts im Bounce (NEU v2.96) ───────────────────────────────────

describe("renderChannelToBuffer — Synth-Parts (v2.96)", () => {
  /** Helper für Wavetable-Synth-Part mit Default-Params. */
  function makeWavetablePart(overrides: Partial<PartData> = {}): PartData {
    return makePart({
      sourceType: "wavetable",
      sampleUrl: undefined,
      synthParams: {
        mode: "wavetable",
        oscType: "sawtooth",
        detune: 0,
        fmRatio: 2,
        fmDepth: 100,
        attack: 0.01,
        decay: 0.1,
        sustain: 0.8,
        release: 0.3,
        lfoEnabled: false,
        lfoRate: 4,
        lfoDepth: 10,
        lfoTarget: "pitch",
        lfoWaveform: "sine",
        lfoBpmSync: "free",
        glide: 0,
      },
      ...overrides,
    });
  }

  function makeFmPart(overrides: Partial<PartData> = {}): PartData {
    return makeWavetablePart({
      sourceType: "fm",
      synthParams: {
        mode: "fm",
        oscType: "sine",
        detune: 0,
        fmRatio: 3,
        fmDepth: 200,
        attack: 0.01,
        decay: 0.1,
        sustain: 0.7,
        release: 0.2,
        lfoEnabled: false,
        lfoRate: 4,
        lfoDepth: 10,
        lfoTarget: "pitch",
        lfoWaveform: "sine",
        lfoBpmSync: "free",
        glide: 0,
      },
      ...overrides,
    });
  }

  it("subtractive/wavetable: erzeugt OscillatorNode pro aktiven Step (nicht silent)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeWavetablePart(); // 4 active steps
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      // KEIN sampleBuffer — Synth braucht keinen
    }, CtxCtor);
    // 4 aktive Steps → 4 Oscillators (Wavetable = 1 Osc pro Note)
    expect(stats.oscillatorsCreated).toBe(4);
    expect(stats.oscStarts.length).toBe(4);
  });

  it("wavetable: oscType wird auf OscillatorNode.type übernommen", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeWavetablePart({
      synthParams: {
        ...makeWavetablePart().synthParams!,
        oscType: "square",
      },
    });
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    expect(stats.oscTypesSet).toContain("square");
  });

  it("FM-Part: 2 Oszillator-Setup pro Note (carrier + modulator)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeFmPart(); // 4 active steps
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // 4 aktive Steps × 2 Oszillatoren (carrier + modulator) = 8
    expect(stats.oscillatorsCreated).toBe(8);
    // 8 starts und 8 stops
    expect(stats.oscStarts.length).toBe(8);
    expect(stats.oscStops.length).toBe(8);
  });

  it("FM-Part: modulator-Frequenz = note-freq × fmRatio", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeFmPart({
      synthParams: {
        ...makeFmPart().synthParams!,
        mode: "fm",
        fmRatio: 3,
        fmDepth: 100,
      },
    });
    // Nur 1 active step für deterministische Assertion
    part.steps = Array.from({ length: 16 }, (_, i) => ({
      active: i === 0,
      velocity: 100,
    }));
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // Carrier-Freq = 440 (A4, kein pitch). Modulator-Freq = 440 * 3 = 1320.
    // Beide werden via setValueAtTime/value-Setter erfasst.
    expect(stats.oscFreqSets).toContain(440);
    expect(stats.oscFreqSets).toContain(1320);
  });

  it("ADSR-Hüllkurve: setValueAtTime + linearRamp-Sequenz wird parametrisiert", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeWavetablePart({
      synthParams: {
        ...makeWavetablePart().synthParams!,
        attack: 0.05,
        decay: 0.2,
        sustain: 0.6,
        release: 0.4,
      },
    });
    // Single active step
    part.steps = Array.from({ length: 16 }, (_, i) => ({
      active: i === 0,
      velocity: 100,
    }));
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // Mindestens 2 setValueAtTime calls (start=0 + noteEnd-sustain)
    // und mindestens 3 linearRamp calls (attack peak, decay → sustain, release → 0).
    expect(stats.ampSetAt.length).toBeGreaterThanOrEqual(2);
    expect(stats.ampRamps.length).toBeGreaterThanOrEqual(3);
    // Erster setValueAtTime ist gain=0 zu time=0 (Note-Start).
    expect(stats.ampSetAt[0].value).toBe(0);
    // Letzter Ramp soll auf 0 gehen (Release-Ende).
    const lastRamp = stats.ampRamps[stats.ampRamps.length - 1];
    expect(lastRamp.value).toBe(0);
  });

  it("Mehrere Steps in einem Pattern werden alle als Synth-Notes gerendert", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeWavetablePart();
    // 8 active steps (alle geraden positionen)
    part.steps = Array.from({ length: 16 }, (_, i) => ({
      active: i % 2 === 0,
      velocity: 100,
    }));
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    expect(stats.oscillatorsCreated).toBe(8);
    expect(stats.oscStarts.length).toBe(8);
  });

  it("step.pitch transponiert die Note-Frequenz (Semitones)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeWavetablePart();
    // +12 Semis = Oktave hoch (880 Hz), -12 Semis = Oktave runter (220 Hz).
    part.steps = Array.from({ length: 16 }, () => ({ active: false }));
    part.steps[0] = { active: true, velocity: 100, pitch: 12 };
    part.steps[4] = { active: true, velocity: 100, pitch: -12 };
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // Erwartete Frequenzen: A5=880, A3=220
    expect(stats.oscFreqSets.some(f => Math.abs(f - 880) < 0.001)).toBe(true);
    expect(stats.oscFreqSets.some(f => Math.abs(f - 220) < 0.001)).toBe(true);
  });

  it("Synth-Part wird durch die FX-Chain geroutet (EQ+Filter+Comp+Reverb wirken)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeWavetablePart({
      fx: defaultChannelFx({
        eqEnabled: true, eqLow: 3,
        compressorEnabled: true, compressorThreshold: -12,
        reverbEnabled: true, reverbDecay: 1.5,
      }),
    });
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // Volle FX-Chain wurde gebaut (analog zum Sample-Pfad in v2.95)
    expect(stats.filterNodesCreated).toBe(4); // 3 EQ + 1 Filter
    expect(stats.compressorsCreated).toBe(1);
    expect(stats.delaysCreated).toBe(1);
    expect(stats.convolversCreated).toBe(1);
    // EQ-Low-Gain wurde übernommen
    expect(stats.filterGainsSet).toContain(3);
    // Compressor-Threshold übernommen
    expect(stats.compressorThresholds).toContain(-12);
    // Reverb-IR wurde angelegt
    expect(stats.buffersCreated).toBeGreaterThan(0);
  });

  it("Granular-Part bleibt silent (v2.96-Caveat — kein Crash)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart({
      sourceType: "granular",
      sampleUrl: undefined,
      // synthParams absichtlich weggelassen
    });
    const pattern = makePattern({ parts: [part] });
    const result = await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // Keine Oscillators, keine BufferSources → Silent Buffer
    expect(stats.oscillatorsCreated).toBe(0);
    expect(stats.bufferSourcesCreated).toBe(0);
    // Aber Buffer wird zurückgegeben (kein Crash)
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("muted Synth-Part: volume=0 wird in ADSR-Peak gemappt", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeWavetablePart({ muted: true });
    part.steps = Array.from({ length: 16 }, (_, i) => ({
      active: i === 0,
      velocity: 100,
    }));
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // Oscillator wird trotzdem gebaut (Topologie bleibt konsistent), aber
    // ADSR-Peak = 0 — ein der ampRamps sollte auf 0 sein.
    expect(stats.oscillatorsCreated).toBe(1);
    // Attack-Ramp Ziel: peak * 1.0 = 0 (weil muted)
    const peakRamp = stats.ampRamps.find(r => r.time > 0 && r.time < 0.1);
    // Wenn muted → peak ist 0
    if (peakRamp) expect(peakRamp.value).toBe(0);
  });

  it("Synth-Part ohne synthParams (sourceType='wavetable' aber kein params) → silent", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart({
      sourceType: "wavetable",
      sampleUrl: undefined,
      // synthParams fehlt — isSynthPart() liefert false
    });
    const pattern = makePattern({ parts: [part] });
    const result = await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    expect(stats.oscillatorsCreated).toBe(0);
    expect(stats.bufferSourcesCreated).toBe(0);
    expect(result.buffer.length).toBeGreaterThan(0);
  });
});

// ─── 10. bounceChannelToWavBuffer ─────────────────────────────────────────────

describe("bounceChannelToWavBuffer", () => {
  it("produziert validen WAV-Header", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    const wav = await bounceChannelToWavBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    expect(isValidWavHeader(wav)).toBe(true);
    expect(wav.byteLength).toBeGreaterThan(WAV_HEADER_SIZE);
  });

  it("Stereo-WAV hat numChannels=2 im Header", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const wav = await bounceChannelToWavBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    const view = new DataView(wav);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
  });
});

// ─── 11. bounceAllChannels ────────────────────────────────────────────────────

describe("bounceAllChannels", () => {
  it("iteriert über alle Parts + liefert N Results", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const parts = [makePart({ id: "p1", name: "Kick" }), makePart({ id: "p2", name: "Snare" }), makePart({ id: "p3", name: "Hat" })];
    const pattern = makePattern({ parts });
    const samples = new Map<string, AudioBuffer>();
    samples.set("test-sample.wav", new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer);

    const results = await bounceAllChannels(parts, pattern, samples, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, "MyProj", undefined, CtxCtor);

    expect(results).toHaveLength(3);
    expect(results[0].filename).toBe("MyProj-Kick-stem.wav");
    expect(results[1].filename).toBe("MyProj-Snare-stem.wav");
    expect(results[2].filename).toBe("MyProj-Hat-stem.wav");
  });

  it("ruft onProgress mit korrekten Werten auf", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const parts = [makePart({ id: "p1", name: "Kick" }), makePart({ id: "p2", name: "Snare" })];
    const pattern = makePattern({ parts });
    const samples = new Map<string, AudioBuffer>();
    samples.set("test-sample.wav", new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer);

    const progresses: BounceAllProgress[] = [];
    await bounceAllChannels(parts, pattern, samples, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, "MyProj", (p) => progresses.push(p), CtxCtor);

    expect(progresses.length).toBeGreaterThanOrEqual(3);
    expect(progresses.some(p => p.phase === "done")).toBe(true);
    expect(progresses[0].channelName).toBe("Kick");
  });

  it("setzt fort wenn ein einzelner Render failt (error-isolation)", async () => {
    let invocation = 0;
    const FailingCtor = class FailingCtx {
      destination = { _kind: "destination" };
      sampleRate: number;
      constructor(_ch: number, _len: number, sr: number) {
        invocation++;
        if (invocation === 2) throw new Error("Simulated render failure");
        this.sampleRate = sr;
      }
      createBufferSource() {
        return {
          _kind: "bufferSource", buffer: null,
          playbackRate: { value: 1 },
          start() {}, connect() {}, disconnect() {},
        };
      }
      createGain() {
        return { _kind: "gain", gain: { value: 0 }, connect() {}, disconnect() {} };
      }
      createStereoPanner() {
        return { _kind: "panner", pan: { value: 0 }, connect() {}, disconnect() {} };
      }
      createBiquadFilter() {
        return {
          _kind: "biquad", type: "lowpass",
          frequency: { value: 0 }, Q: { value: 1 }, gain: { value: 0 },
          connect() {}, disconnect() {},
        };
      }
      createWaveShaper() {
        return { _kind: "waveShaper", curve: null, oversample: "none", connect() {}, disconnect() {} };
      }
      createDynamicsCompressor() {
        return {
          _kind: "compressor",
          threshold: { value: -24 }, ratio: { value: 4 }, attack: { value: 0.003 }, release: { value: 0.25 },
          connect() {}, disconnect() {},
        };
      }
      createDelay() {
        return { _kind: "delay", delayTime: { value: 0 }, connect() {}, disconnect() {} };
      }
      createConvolver() {
        return { _kind: "convolver", buffer: null, connect() {}, disconnect() {} };
      }
      createBuffer(channels: number, length: number, sampleRate: number) {
        return new MockAudioBuffer(channels, length, sampleRate);
      }
      async startRendering() { return new MockAudioBuffer(2, 96000, 48000); }
    } as unknown as OfflineAudioContextCtor;

    const parts = [makePart({ id: "p1", name: "A" }), makePart({ id: "p2", name: "B" }), makePart({ id: "p3", name: "C" })];
    const pattern = makePattern({ parts });
    const samples = new Map<string, AudioBuffer>();
    samples.set("test-sample.wav", new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer);

    const progresses: BounceAllProgress[] = [];
    const results = await bounceAllChannels(parts, pattern, samples, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, "Proj", (p) => progresses.push(p), FailingCtor);

    expect(results).toHaveLength(2);
    expect(progresses.some(p => p.phase === "error")).toBe(true);
  });
});

// ─── 12. Edge-Cases & Constants ───────────────────────────────────────────────

describe("constants & boundaries", () => {
  it("BOUNCE_WARN_DURATION_SEC ist 5 Minuten", () => {
    expect(BOUNCE_WARN_DURATION_SEC).toBe(300);
  });

  it("BOUNCE_MAX_DURATION_SEC ist 30 Minuten", () => {
    expect(BOUNCE_MAX_DURATION_SEC).toBe(1800);
  });

  it("wirft wenn kein OfflineAudioContext im Environment", async () => {
    const part = makePart();
    const pattern = makePattern();
    await expect(
      renderChannelToBuffer(part, pattern, {
        length: { mode: "currentPattern" },
        bpm: 120,
        sampleRate: 48000,
      })
    ).rejects.toThrow(/OfflineAudioContext/);
  });
});

// ─── 13. v3.41 — Bitcrusher / RingMod / Transient-Shaper im Bounce ───────────

describe("v3.41 — Bitcrusher pure-fn", () => {
  it("makeBitcrusherCurve liefert 256-Sample Float32Array", () => {
    const curve = makeBitcrusherCurve(8);
    expect(curve.length).toBe(256);
    expect(curve).toBeInstanceOf(Float32Array);
  });

  it("Bit-Depth=1 erzeugt wenige diskrete Werte (heavy crush)", () => {
    // bitDepth=1 → steps=2 → round(x*2)/2 → {-1, -0.5, 0, 0.5, 1}
    const curve = makeBitcrusherCurve(1);
    const distinct = new Set<number>();
    for (const v of curve) distinct.add(Math.round(v * 100) / 100);
    // Heavy-crush sollte signifikant weniger distinct values als input haben.
    // Input-Curve hätte ~256 distinct values; gecrusht max 5.
    expect(distinct.size).toBeLessThanOrEqual(5);
  });

  it("Bit-Depth=16 (max) verändert das Signal kaum (near-identity)", () => {
    const curve = makeBitcrusherCurve(16);
    // Bei 16-bit / 65536 Stufen sollte die Curve in der Mitte fast identisch
    // zur Eingangs-X-Reihe sein.
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      expect(Math.abs(curve[i] - x)).toBeLessThan(0.001);
    }
  });

  it("applyBitcrusher reduziert die Auflösung tatsächlich (FX wirkt)", () => {
    // Sinus-Welle als Input
    const N = 1024;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin(2 * Math.PI * i * 4 / N);

    const crushed = applyBitcrusher(input, 2, 1, 1);

    // Anzahl distinct values sollte massiv reduziert sein
    const inputDistinct = new Set<number>();
    const crushedDistinct = new Set<number>();
    for (const v of input) inputDistinct.add(v);
    for (const v of crushed) crushedDistinct.add(v);

    expect(crushedDistinct.size).toBeLessThan(inputDistinct.size);
    expect(crushedDistinct.size).toBeLessThanOrEqual(10); // bitDepth=2 → 4 Stufen, signed range ergibt 9 mögliche
  });

  it("applyBitcrusher: sample-rate-reduction hält Sample N mal (FX wirkt)", () => {
    // Linear ascending input
    const input = new Float32Array(20);
    for (let i = 0; i < 20; i++) input[i] = i / 20;

    // sampleReduct=5 → jedes 5. Sample neu, dazwischen hold
    // bitDepth=16 (lossless), mix=1
    const crushed = applyBitcrusher(input, 16, 5, 1);

    // Sample[0] sollte gleich Sample[1]..[4] sein (hold-mode)
    // Hinweis: Counter inkrementiert VOR check, also: counter=1,2,3,4,5
    // bei counter=5: neuer hold, dann counter=0 → counter=1,2,3,4 nutzen alten hold
    // Erwartung: nach erstem update (i=4 if sampleReduct=5? siehe Impl):
    // counter starts at 0, inc → counter=1, check 1>=5? no.
    // ... at i=4: counter inc to 5, hold=input[4], counter=0
    // so output[0..3] = 0 (initial hold), output[4] = input[4], output[5..8]=input[4], output[9]=input[9]...
    expect(crushed[5]).toBe(crushed[6]);
    expect(crushed[6]).toBe(crushed[7]);
    expect(crushed[8]).toBe(crushed[7]);
  });

  it("applyBitcrusher mix=0 → pure passthrough", () => {
    const input = new Float32Array([0.1, 0.5, -0.3, 0.7, -0.9]);
    const out = applyBitcrusher(input, 1, 1, 0);
    for (let i = 0; i < input.length; i++) {
      expect(out[i]).toBeCloseTo(input[i], 5);
    }
  });

  it("applyBitcrusherToBuffer erzeugt neuen Buffer mit pre-quantized Daten", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 1000, 48000);
    const input = new MockAudioBuffer(2, 1000, 48000) as unknown as AudioBuffer;
    // Fill input mit sinusoidal data
    for (let ch = 0; ch < 2; ch++) {
      const data = input.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.1);
    }
    const crushed = applyBitcrusherToBuffer(ctx, input, 2, 1, 1);
    expect(crushed).not.toBeNull();
    if (crushed) {
      expect(crushed.length).toBe(input.length);
      expect(crushed.numberOfChannels).toBe(input.numberOfChannels);
      // Quantization sollte sichtbar sein: bitDepth=2 → steps=4 →
      // round(x*4)/4 erlaubt {-1, -3/4, -1/2, -1/4, 0, 1/4, 1/2, 3/4, 1} = 9 max.
      const crushedDistinct = new Set<number>();
      for (const v of crushed.getChannelData(0)) crushedDistinct.add(v);
      expect(crushedDistinct.size).toBeLessThanOrEqual(10);
      // Original-Input hat klar mehr distinct values (sinusoidal, 1000 samples)
      const inputDistinct = new Set<number>();
      for (const v of input.getChannelData(0)) inputDistinct.add(v);
      expect(crushedDistinct.size).toBeLessThan(inputDistinct.size);
    }
  });

  it("applyBitcrusherToBuffer mit null input → null (defensive)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 1000, 48000);
    expect(applyBitcrusherToBuffer(ctx, null, 2, 1, 1)).toBeNull();
    expect(applyBitcrusherToBuffer(ctx, undefined, 2, 1, 1)).toBeNull();
  });
});

describe("v3.41 — Transient-Shaper pure-fn", () => {
  it("applyTransientShaper: positive attack boostet Transient-Peak", () => {
    // Impulse-Signal mit klarem Transient + Tail
    const N = 200;
    const input = new Float32Array(N);
    input[0] = 1.0; // initial peak
    for (let i = 1; i < N; i++) input[i] = 0.3 * Math.exp(-i / 50); // exponential decay

    const boosted = applyTransientShaper(input, 1, 0, 1);

    // Initial peak sollte verstärkt sein oder mindestens gleich
    expect(Math.abs(boosted[0])).toBeGreaterThanOrEqual(Math.abs(input[0]) * 0.99);
    // Mehrere Samples nach Peak: boosted > original (oder gleich)
    // weil envFast > envSlow → transient > 0 → gain > 1
    let foundBoost = false;
    for (let i = 1; i < 30; i++) {
      if (Math.abs(boosted[i]) > Math.abs(input[i]) * 1.01) {
        foundBoost = true;
        break;
      }
    }
    expect(foundBoost).toBe(true);
  });

  it("applyTransientShaper: negative attack reduziert Peak", () => {
    const N = 100;
    const input = new Float32Array(N);
    input[0] = 1.0;
    for (let i = 1; i < N; i++) input[i] = 0.3 * Math.exp(-i / 50);

    const ducked = applyTransientShaper(input, -1, 0, 1);

    // Bei attack=-1 sollte transient-period gedämpft sein
    // Min. EIN Sample im transient-bereich sollte < original sein
    let foundDuck = false;
    for (let i = 1; i < 30; i++) {
      if (Math.abs(ducked[i]) < Math.abs(input[i]) * 0.99) {
        foundDuck = true;
        break;
      }
    }
    expect(foundDuck).toBe(true);
  });

  it("applyTransientShaper attack=0 sustain=0 mix=0 → pure passthrough", () => {
    const input = new Float32Array([0.1, 0.5, -0.3, 0.7, -0.9]);
    const out = applyTransientShaper(input, 0, 0, 0);
    for (let i = 0; i < input.length; i++) {
      expect(out[i]).toBeCloseTo(input[i], 5);
    }
  });

  it("applyTransientShaperToBuffer erzeugt neuen Buffer", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 1000, 48000);
    const input = new MockAudioBuffer(2, 1000, 48000) as unknown as AudioBuffer;
    // Impuls bei 0, decay danach
    for (let ch = 0; ch < 2; ch++) {
      const data = input.getChannelData(ch);
      data[0] = 1;
      for (let i = 1; i < data.length; i++) data[i] = 0.2 * Math.exp(-i / 30);
    }
    const shaped = applyTransientShaperToBuffer(ctx, input, 1, 0, 1);
    expect(shaped).not.toBeNull();
    if (shaped) {
      expect(shaped.length).toBe(input.length);
      expect(shaped.numberOfChannels).toBe(2);
      // Mindestens ein Sample muss sich vom Original unterscheiden
      const data = shaped.getChannelData(0);
      const orig = input.getChannelData(0);
      let foundDiff = false;
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i] - orig[i]) > 0.001) { foundDiff = true; break; }
      }
      expect(foundDiff).toBe(true);
    }
  });

  it("applyTransientShaperToBuffer mit null input → null (defensive)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 1000, 48000);
    expect(applyTransientShaperToBuffer(ctx, null, 1, 0, 1)).toBeNull();
  });
});

describe("v3.41 — RingMod offline native nodes", () => {
  it("buildRingModOffline erzeugt OscillatorNode + Gain-Subgraph", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const before = { osc: stats.oscillatorsCreated, gain: stats.gainNodesCreated };
    buildRingModOffline(ctx, 200, 0.5);
    // 1 OscillatorNode + mindestens 4 Gain-Nodes (input/output/dryGain/ringGain + modScale)
    expect(stats.oscillatorsCreated).toBe(before.osc + 1);
    expect(stats.gainNodesCreated - before.gain).toBeGreaterThanOrEqual(4);
  });

  it("buildRingModOffline setzt Frequenz und sin-Waveform", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    buildRingModOffline(ctx, 440, 0.7);
    expect(stats.oscTypesSet).toContain("sine");
    expect(stats.oscFreqSets).toContain(440);
    // Oscillator wird gestartet
    expect(stats.oscStarts.length).toBeGreaterThanOrEqual(1);
  });

  it("buildRingModOffline clampt Frequency auf [20, 5000]", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    buildRingModOffline(ctx, 100000, 0.5);
    // Frequenz sollte auf 5000 geclampt sein
    expect(stats.oscFreqSets.some(f => f === 5000)).toBe(true);
  });
});

describe("v3.41 — buildOfflinePartGraph mit InsertChain", () => {
  it("RingMod-Insert fügt Oscillator hinzu", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    const inserts: MixerFxSlot[] = [{
      id: "rm-1",
      type: "ringmod",
      name: "RingMod",
      enabled: true,
      params: { frequency: 333, mix: 0.6 },
    }];
    buildOfflinePartGraph(ctx, part, 2, inserts);
    // OHNE RingMod hätte buildOfflinePartGraph nur 0 Oscillators erzeugt
    expect(stats.oscillatorsCreated).toBeGreaterThanOrEqual(1);
    expect(stats.oscFreqSets).toContain(333);
  });

  it("Disabled RingMod-Insert wird ignoriert", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    const inserts: MixerFxSlot[] = [{
      id: "rm-1", type: "ringmod", name: "RingMod", enabled: false,
      params: { frequency: 333, mix: 0.6 },
    }];
    buildOfflinePartGraph(ctx, part, 2, inserts);
    expect(stats.oscillatorsCreated).toBe(0);
  });

  it("Bitcrusher-Insert wird als preProcessing zurueckgegeben", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    const inserts: MixerFxSlot[] = [{
      id: "bc-1", type: "bitcrusher", name: "Bitcrusher", enabled: true,
      params: { bitDepth: 4, sampleReduct: 8, mix: 0.7 },
    }];
    const graph = buildOfflinePartGraph(ctx, part, 2, inserts);
    expect(graph.preProcessing).toBeDefined();
    expect(graph.preProcessing?.bitcrusher).toEqual({ bitDepth: 4, sampleReduct: 8, mix: 0.7 });
  });

  it("Transient-Insert wird als preProcessing zurueckgegeben", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    const inserts: MixerFxSlot[] = [{
      id: "tr-1", type: "transient", name: "TS", enabled: true,
      params: { attack: 0.8, sustain: -0.3, mix: 1 },
    }];
    const graph = buildOfflinePartGraph(ctx, part, 2, inserts);
    expect(graph.preProcessing?.transient).toEqual({ attack: 0.8, sustain: -0.3, mix: 1 });
  });

  it("Mehrere Inserts zusammen: RingMod (inline) + Bitcrusher + Transient (preProc)", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    const inserts: MixerFxSlot[] = [
      { id: "bc", type: "bitcrusher", name: "BC", enabled: true,
        params: { bitDepth: 4, sampleReduct: 2, mix: 1 } },
      { id: "rm", type: "ringmod", name: "RM", enabled: true,
        params: { frequency: 200, mix: 0.5 } },
      { id: "tr", type: "transient", name: "TS", enabled: true,
        params: { attack: 0.5, sustain: 0, mix: 1 } },
    ];
    const graph = buildOfflinePartGraph(ctx, part, 2, inserts);
    expect(graph.preProcessing?.bitcrusher).toBeDefined();
    expect(graph.preProcessing?.transient).toBeDefined();
    expect(stats.oscillatorsCreated).toBeGreaterThanOrEqual(1);
    expect(stats.oscFreqSets).toContain(200);
  });

  it("Backward-Compat: ohne insertChain bleibt preProcessing undefined", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    const graph = buildOfflinePartGraph(ctx, part, 2);
    expect(graph.preProcessing).toBeUndefined();
    expect(stats.oscillatorsCreated).toBe(0);
  });

  it("Andere Insert-Typen (chorus/filter/comp) werden silent ignoriert", () => {
    const stats = freshStats();
    const Ctor = makeMockOfflineCtxCtor(stats);
    const ctx = new (Ctor as unknown as new (...a: number[]) => BaseAudioContext)(2, 96000, 48000);
    const part = makePart();
    const inserts: MixerFxSlot[] = [
      { id: "ch", type: "chorus", name: "Chorus", enabled: true, params: {} },
      { id: "ft", type: "filter", name: "Filter", enabled: true, params: {} },
    ];
    expect(() => buildOfflinePartGraph(ctx, part, 2, inserts)).not.toThrow();
    expect(stats.oscillatorsCreated).toBe(0);
  });
});

describe("v3.41 — renderChannelToBuffer mit InsertChain", () => {
  it("Bitcrusher-Insert wird im Sample-Pfad angewendet (Buffer wird neu erzeugt)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    // Fill input mit Daten — sonst kann der Crusher nichts quantizen
    const data = sampleBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.1);

    const beforeBuffers = stats.buffersCreated;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      insertChain: [{
        id: "bc", type: "bitcrusher", name: "BC", enabled: true,
        params: { bitDepth: 2, sampleReduct: 1, mix: 1 },
      }],
    }, CtxCtor);
    // Mindestens ein neues Buffer wurde durch applyBitcrusherToBuffer erzeugt
    expect(stats.buffersCreated).toBeGreaterThan(beforeBuffers);
  });

  it("RingMod-Insert fügt Oscillator zum Render-Graph hinzu", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      insertChain: [{
        id: "rm", type: "ringmod", name: "RM", enabled: true,
        params: { frequency: 440, mix: 0.5 },
      }],
    }, CtxCtor);
    expect(stats.oscillatorsCreated).toBeGreaterThanOrEqual(1);
    expect(stats.oscFreqSets).toContain(440);
  });

  it("Transient-Shaper-Insert pre-processed Sample-Buffer", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    // Impulse-Signal damit transient-shaper was zu tun hat
    sampleBuffer.getChannelData(0)[0] = 1;

    const beforeBuffers = stats.buffersCreated;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      insertChain: [{
        id: "tr", type: "transient", name: "TS", enabled: true,
        params: { attack: 1, sustain: 0, mix: 1 },
      }],
    }, CtxCtor);
    expect(stats.buffersCreated).toBeGreaterThan(beforeBuffers);
  });

  it("Alle 3 FX zusammen: produzieren erwarteten Output (kein Crash, Buffer + Osc beide angelegt)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    sampleBuffer.getChannelData(0)[0] = 1;

    const beforeBuffers = stats.buffersCreated;
    const beforeOsc = stats.oscillatorsCreated;
    const result = await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      insertChain: [
        { id: "bc", type: "bitcrusher", name: "BC", enabled: true,
          params: { bitDepth: 4, sampleReduct: 2, mix: 1 } },
        { id: "rm", type: "ringmod", name: "RM", enabled: true,
          params: { frequency: 333, mix: 0.5 } },
        { id: "tr", type: "transient", name: "TS", enabled: true,
          params: { attack: 0.5, sustain: 0.2, mix: 1 } },
      ],
    }, CtxCtor);
    // Bitcrusher + Transient produzieren je 1 neues Buffer = 2 zusaetzliche Buffers
    expect(stats.buffersCreated).toBeGreaterThanOrEqual(beforeBuffers + 2);
    // RingMod produziert 1 Oscillator
    expect(stats.oscillatorsCreated).toBeGreaterThanOrEqual(beforeOsc + 1);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("Backward-Compat: ohne insertChain → keine zusätzlichen Buffers oder Oszillatoren", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    // KEIN Bitcrusher/Transient → keine zusätzlichen Buffers (außer ggf. Reverb-IR — aber Reverb ist disabled)
    expect(stats.buffersCreated).toBe(0);
    // KEIN RingMod → keine Oszillatoren
    expect(stats.oscillatorsCreated).toBe(0);
  });

  it("Disabled Inserts werden komplett ignoriert (kein Buffer, kein Osc)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
      insertChain: [
        { id: "bc", type: "bitcrusher", name: "BC", enabled: false,
          params: { bitDepth: 2, sampleReduct: 8, mix: 1 } },
        { id: "rm", type: "ringmod", name: "RM", enabled: false,
          params: { frequency: 333, mix: 0.5 } },
      ],
    }, CtxCtor);
    expect(stats.buffersCreated).toBe(0);
    expect(stats.oscillatorsCreated).toBe(0);
  });
});

// ─── v3.42 — hasSynthPreProcessing pure-fn ────────────────────────────────────

describe("v3.42 — hasSynthPreProcessing", () => {
  it("liefert false für undefined/null/leer", () => {
    expect(hasSynthPreProcessing(undefined)).toBe(false);
    expect(hasSynthPreProcessing(null)).toBe(false);
    expect(hasSynthPreProcessing([])).toBe(false);
  });

  it("liefert true für aktive Bitcrusher-Insert", () => {
    const inserts: MixerFxSlot[] = [{
      id: "bc", type: "bitcrusher", name: "BC", enabled: true,
      params: { bitDepth: 4, sampleReduct: 2, mix: 1 },
    }];
    expect(hasSynthPreProcessing(inserts)).toBe(true);
  });

  it("liefert true für aktive Transient-Insert", () => {
    const inserts: MixerFxSlot[] = [{
      id: "tr", type: "transient", name: "TS", enabled: true,
      params: { attack: 0.5, sustain: 0, mix: 1 },
    }];
    expect(hasSynthPreProcessing(inserts)).toBe(true);
  });

  it("liefert false für disabled Bitcrusher-Insert", () => {
    const inserts: MixerFxSlot[] = [{
      id: "bc", type: "bitcrusher", name: "BC", enabled: false,
      params: { bitDepth: 4, sampleReduct: 2, mix: 1 },
    }];
    expect(hasSynthPreProcessing(inserts)).toBe(false);
  });

  it("liefert false für RingMod-only (kein pre-processing benoetigt)", () => {
    const inserts: MixerFxSlot[] = [{
      id: "rm", type: "ringmod", name: "RM", enabled: true,
      params: { frequency: 200, mix: 0.5 },
    }];
    expect(hasSynthPreProcessing(inserts)).toBe(false);
  });

  it("liefert true wenn mind. 1 BC oder TS aktiv ist (mixed chain)", () => {
    const inserts: MixerFxSlot[] = [
      { id: "rm", type: "ringmod", name: "RM", enabled: true, params: {} },
      { id: "bc", type: "bitcrusher", name: "BC", enabled: true, params: {} },
    ];
    expect(hasSynthPreProcessing(inserts)).toBe(true);
  });
});

// ─── v3.42 — Synth-Part Pre-Processing (two-stage Render) ─────────────────────

describe("v3.42 — Synth-Part mit Bitcrusher/Transient (two-stage Render)", () => {
  /** Helper: Wavetable-Synth-Part. */
  function makeSynthPart(overrides: Partial<PartData> = {}): PartData {
    return makePart({
      sourceType: "wavetable",
      sampleUrl: undefined,
      synthParams: {
        mode: "wavetable",
        oscType: "sawtooth",
        detune: 0,
        fmRatio: 2,
        fmDepth: 100,
        attack: 0.01,
        decay: 0.1,
        sustain: 0.8,
        release: 0.3,
        lfoEnabled: false,
        lfoRate: 4,
        lfoDepth: 10,
        lfoTarget: "pitch",
        lfoWaveform: "sine",
        lfoBpmSync: "free",
        glide: 0,
      },
      ...overrides,
    });
  }

  it("Synth-Part mit Bitcrusher: two-stage Render erzeugt zusaetzliches AudioBuffer", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeSynthPart();
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      insertChain: [{
        id: "bc", type: "bitcrusher", name: "BC", enabled: true,
        params: { bitDepth: 2, sampleReduct: 1, mix: 1 },
      }],
    }, CtxCtor);
    // Two-stage: temp-ctx rendert Synth, dann main-ctx baut FX-Chain.
    // applyBitcrusherToBuffer erzeugt 1 zusaetzliches Buffer im main-ctx.
    expect(stats.buffersCreated).toBeGreaterThanOrEqual(1);
    // Synth-Notes wurden in tempCtx erzeugt — Oscillators sind dort gelandet.
    // Im main-ctx existiert eine BufferSource fuer die Pre-processed Stage-2-Buffer.
    expect(stats.bufferSourcesCreated).toBeGreaterThanOrEqual(1);
  });

  it("Synth-Part mit Transient: two-stage Render erzeugt zusaetzliches AudioBuffer", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeSynthPart();
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      insertChain: [{
        id: "tr", type: "transient", name: "TS", enabled: true,
        params: { attack: 1, sustain: 0, mix: 1 },
      }],
    }, CtxCtor);
    expect(stats.buffersCreated).toBeGreaterThanOrEqual(1);
    expect(stats.bufferSourcesCreated).toBeGreaterThanOrEqual(1);
  });

  it("Synth-Part mit BC+TS+RingMod: two-stage Render + RingMod-Inline-Node", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeSynthPart();
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      insertChain: [
        { id: "bc", type: "bitcrusher", name: "BC", enabled: true,
          params: { bitDepth: 4, sampleReduct: 2, mix: 1 } },
        { id: "rm", type: "ringmod", name: "RM", enabled: true,
          params: { frequency: 333, mix: 0.5 } },
        { id: "tr", type: "transient", name: "TS", enabled: true,
          params: { attack: 0.5, sustain: 0.2, mix: 1 } },
      ],
    }, CtxCtor);
    // BC + TS = 2 zusaetzliche Buffers
    expect(stats.buffersCreated).toBeGreaterThanOrEqual(2);
    // RingMod erzeugt mind. 1 Oscillator (im main-ctx).
    // Plus Synth-Oscillators wurden in tempCtx erzeugt — die zaehlen auch in stats
    // weil beide Ctor's denselben MockOfflineCtx benutzen.
    expect(stats.oscFreqSets).toContain(333);
  });

  it("Synth-Part OHNE BC/TS: einstufiger v2.96-Render bleibt unveraendert (kein zusaetzliches Buffer)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeSynthPart();
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      // Kein insertChain
    }, CtxCtor);
    // KEIN BC/TS → kein Pre-Processing → 0 createBuffer calls in main-ctx
    // (Reverb-IR ist auch disabled in defaultChannelFx).
    expect(stats.buffersCreated).toBe(0);
    // Kein BufferSource im main-ctx (Synth-Notes direkt in main-ctx via Osc).
    expect(stats.bufferSourcesCreated).toBe(0);
    // Aber Oscillators wurden erzeugt (Synth-Notes).
    expect(stats.oscillatorsCreated).toBeGreaterThanOrEqual(4);
  });

  it("Synth-Part mit nur RingMod (kein BC/TS): einstufiger Render — kein temp-Render noetig", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeSynthPart();
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      insertChain: [{
        id: "rm", type: "ringmod", name: "RM", enabled: true,
        params: { frequency: 200, mix: 0.5 },
      }],
    }, CtxCtor);
    // Kein BC/TS → KEIN two-stage Render → 0 createBuffer
    expect(stats.buffersCreated).toBe(0);
    expect(stats.bufferSourcesCreated).toBe(0);
    // RingMod-Oscillator + Synth-Oscillators (alle im main-ctx).
    expect(stats.oscillatorsCreated).toBeGreaterThanOrEqual(5);
    expect(stats.oscFreqSets).toContain(200);
  });

  it("Synth-Part mit disabled BC: einstufiger Render (kein Pre-Processing)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makeSynthPart();
    const pattern = makePattern({ parts: [part] });
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      insertChain: [{
        id: "bc", type: "bitcrusher", name: "BC", enabled: false,
        params: { bitDepth: 2, sampleReduct: 4, mix: 1 },
      }],
    }, CtxCtor);
    // Disabled → kein Pre-Processing → kein zusaetzliches Buffer
    expect(stats.buffersCreated).toBe(0);
    expect(stats.bufferSourcesCreated).toBe(0);
  });
});

// ─── v3.42 — bounceAllChannels mit partInsertChains-Map ───────────────────────

describe("v3.42 — bounceAllChannels mit partInsertChains-Map (ExportPanel-Wiring)", () => {
  it("Map: partId → insertChain wird pro Part korrekt aufgeloest", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const parts = [
      makePart({ id: "p1", name: "Kick" }),
      makePart({ id: "p2", name: "Snare" }),
    ];
    const pattern = makePattern({ parts });
    const samples = new Map<string, AudioBuffer>();
    samples.set("test-sample.wav", new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer);

    const insertChainMap = new Map<string, MixerFxSlot[]>();
    insertChainMap.set("p1", [{
      id: "rm-1", type: "ringmod", name: "RM-p1", enabled: true,
      params: { frequency: 555, mix: 0.5 },
    }]);
    // p2 hat keine Inserts

    const results = await bounceAllChannels(
      parts, pattern, samples,
      { length: { mode: "currentPattern" }, bpm: 120, sampleRate: 48000 },
      "MyProj", undefined, CtxCtor, insertChainMap,
    );
    expect(results).toHaveLength(2);
    // Mind. 1 Oscillator mit freq=555 wurde erzeugt (fuer Part p1).
    expect(stats.oscFreqSets).toContain(555);
  });

  it("Record: partId → insertChain (object-Form) wird ebenfalls akzeptiert", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const parts = [makePart({ id: "p1", name: "Kick" })];
    const pattern = makePattern({ parts });
    const samples = new Map<string, AudioBuffer>();
    samples.set("test-sample.wav", new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer);

    const insertChainsObj: Record<string, MixerFxSlot[]> = {
      p1: [{
        id: "rm-1", type: "ringmod", name: "RM", enabled: true,
        params: { frequency: 777, mix: 0.5 },
      }],
    };

    await bounceAllChannels(
      parts, pattern, samples,
      { length: { mode: "currentPattern" }, bpm: 120, sampleRate: 48000 },
      "MyProj", undefined, CtxCtor, insertChainsObj,
    );
    expect(stats.oscFreqSets).toContain(777);
  });

  it("partInsertChains=null/undefined: Bestandsverhalten — keine Inserts angewendet", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const parts = [makePart({ id: "p1", name: "Kick" })];
    const pattern = makePattern({ parts });
    const samples = new Map<string, AudioBuffer>();
    samples.set("test-sample.wav", new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer);

    // null
    await bounceAllChannels(
      parts, pattern, samples,
      { length: { mode: "currentPattern" }, bpm: 120, sampleRate: 48000 },
      "MyProj", undefined, CtxCtor, null,
    );
    expect(stats.oscillatorsCreated).toBe(0);

    // undefined
    const stats2 = freshStats();
    const CtxCtor2 = makeMockOfflineCtxCtor(stats2);
    await bounceAllChannels(
      parts, pattern, samples,
      { length: { mode: "currentPattern" }, bpm: 120, sampleRate: 48000 },
      "MyProj", undefined, CtxCtor2,
    );
    expect(stats2.oscillatorsCreated).toBe(0);
  });

  it("Map mit unknown partId: nur Parts mit passender Map-Entry kriegen Inserts", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const parts = [
      makePart({ id: "p1", name: "Kick" }),
      makePart({ id: "p2", name: "Snare" }),
    ];
    const pattern = makePattern({ parts });
    const samples = new Map<string, AudioBuffer>();
    samples.set("test-sample.wav", new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer);

    const insertChainMap = new Map<string, MixerFxSlot[]>();
    insertChainMap.set("unknown-part", [{
      id: "rm", type: "ringmod", name: "RM", enabled: true,
      params: { frequency: 999, mix: 0.5 },
    }]);

    await bounceAllChannels(
      parts, pattern, samples,
      { length: { mode: "currentPattern" }, bpm: 120, sampleRate: 48000 },
      "MyProj", undefined, CtxCtor, insertChainMap,
    );
    // Kein Part hat die Map-Entry → keine RingMod-Oscillators
    expect(stats.oscFreqSets.includes(999)).toBe(false);
  });
});

// ─── 14. Helper: void-Reference für Type-Check ────────────────────────────────

it("type-spread: vi-spy unused-import-clearance", () => {
  void vi;
  expect(true).toBe(true);
});
