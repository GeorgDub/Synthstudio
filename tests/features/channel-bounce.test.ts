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
  type ChannelBounceRenderOptions,
  type BounceAllProgress,
  type OfflineAudioContextCtor,
} from "../../client/src/utils/channelBounce";
import { isValidWavHeader, WAV_HEADER_SIZE } from "../../client/src/audio/wavEncoder";
import type { PartData, PatternData, ChannelFx } from "../../client/src/audio/AudioEngine";

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
        } as { value: number },
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

// ─── 13. Helper: void-Reference für Type-Check ────────────────────────────────

it("type-spread: vi-spy unused-import-clearance", () => {
  void vi;
  expect(true).toBe(true);
});
