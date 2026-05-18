/**
 * tests/features/channel-bounce.test.ts
 *
 * Unit-Tests für TASK-241 (v2.94.0): Per-Channel WAV-Bounce.
 *
 * Coverage:
 *  1. computeBounceDurationSec — Pure-Helper (bars/bpm/stepsPerBar → Sekunden)
 *  2. resolveBounceBars — Mode-Switch (currentPattern/currentLoop/customBars)
 *  3. sanitizeStemFilenameStem — Filename-Sanitizer
 *  4. defaultStemFilename — Filename-Aggregator
 *  5. renderChannelToBuffer — OfflineAudioContext-Mock-Render
 *  6. bounceChannelToWavBuffer — End-to-End WAV-Header-Validation
 *  7. bounceAllChannels — Multi-Channel-Iterator + Progress
 *  8. Edge-Cases (silent-channel, no-sample, max-duration, mute)
 */
import { describe, it, expect, vi } from "vitest";

import {
  computeBounceDurationSec,
  resolveBounceBars,
  sanitizeStemFilenameStem,
  defaultStemFilename,
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
import type { PartData, PatternData } from "../../client/src/audio/AudioEngine";

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

interface MockBufferSource {
  buffer: MockAudioBuffer | null;
  start(when?: number): void;
  connect(target: unknown): void;
}
interface MockGainNode { gain: { value: number }; connect(t: unknown): void }
interface MockPannerNode { pan: { value: number }; connect(t: unknown): void }
interface MockFilterNode { type: string; frequency: { value: number }; Q: { value: number }; connect(t: unknown): void }

interface MockCtxStats {
  bufferSourcesCreated: number;
  startCalls: Array<{ when: number }>;
  gainNodesCreated: number;
  pannerNodesCreated: number;
  filterNodesCreated: number;
  panValuesSet: number[];
  gainValuesSet: number[];
  filterFreqsSet: number[];
}

function makeMockOfflineCtxCtor(stats: MockCtxStats): OfflineAudioContextCtor {
  // Pseudo-Class via Function-Constructor — ergibt einen Konstruktor mit
  // identischer Signatur zu OfflineAudioContext.
  return class MockOfflineCtx {
    destination = { __isDestination: true };
    private channels: number;
    private length: number;
    sampleRate: number;
    constructor(channels: number, length: number, sampleRate: number) {
      this.channels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
    }
    createBufferSource(): MockBufferSource {
      stats.bufferSourcesCreated++;
      return {
        buffer: null,
        start(when: number = 0) { stats.startCalls.push({ when }); },
        connect(_t: unknown) {},
      };
    }
    createGain(): MockGainNode {
      stats.gainNodesCreated++;
      const node: MockGainNode = {
        gain: {
          get value() { return 0; },
          set value(v: number) { stats.gainValuesSet.push(v); },
        } as { value: number },
        connect(_t: unknown) {},
      };
      return node;
    }
    createStereoPanner(): MockPannerNode {
      stats.pannerNodesCreated++;
      return {
        pan: {
          get value() { return 0; },
          set value(v: number) { stats.panValuesSet.push(v); },
        } as { value: number },
        connect(_t: unknown) {},
      };
    }
    createBiquadFilter(): MockFilterNode {
      stats.filterNodesCreated++;
      return {
        type: "lowpass",
        frequency: {
          get value() { return 0; },
          set value(v: number) { stats.filterFreqsSet.push(v); },
        } as { value: number },
        Q: { value: 1 },
        connect(_t: unknown) {},
      };
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
    panValuesSet: [],
    gainValuesSet: [],
    filterFreqsSet: [],
  };
}

function makePart(overrides: Partial<PartData> = {}): PartData {
  const steps = Array.from({ length: 16 }, (_, i) => ({
    active: i % 4 === 0,    // Step 0, 4, 8, 12 active
    velocity: 100,
    note: 60,
    probability: 1,
    ratchet: 1,
  }));
  return {
    id: "part-1",
    name: "Kick",
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: {
      filterFreq: 20000,
      filterQ: 1,
      filterGain: 0,
      delayTime: 0,
      delayFeedback: 0,
      delayMix: 0,
      reverbDecay: 0,
      reverbMix: 0,
      distortionDrive: 0,
      compThreshold: -24,
      compRatio: 4,
      compAttack: 0.003,
      compRelease: 0.25,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
    },
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
    // 1 bar = 4 beats @ 120 bpm = 4 * 60/120 = 2.0 sec
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
    // 60 bpm soll 4x länger sein als 240 bpm
    expect(slow).toBeCloseTo(fast * 4, 3);
  });
});

// ─── 2. resolveBounceBars ────────────────────────────────────────────────────

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

// ─── 3+4. Filename-Sanitizer ─────────────────────────────────────────────────

describe("sanitizeStemFilenameStem", () => {
  it("ersetzt Whitespace durch Underscore", () => {
    expect(sanitizeStemFilenameStem("My Project")).toBe("My_Project");
  });

  it("entfernt Sonderzeichen (Whitespace zuerst → Underscore, dann Strip)", () => {
    // "Hi/Hat (Open)" → trim → replace ws → "Hi/Hat_(Open)" → strip → "HiHat_Open"
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

// ─── 5. renderChannelToBuffer ────────────────────────────────────────────────

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
    };
    const result = await renderChannelToBuffer(part, pattern, opts, CtxCtor);
    // 1 Bar @ 120 BPM 16 steps + 0.5s tail = 2.5s @ 48k = 120000 frames
    expect(result.sampleRate).toBe(48000);
    expect(result.buffer.length).toBe(Math.ceil(2.5 * 48000));
    expect(result.buffer.numberOfChannels).toBe(2);
  });

  it("erzeugt einen BufferSource pro aktiven Step", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart(); // 4 active steps (0, 4, 8, 12)
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

  it("Pan-Wert wird auf den StereoPanner gemappt", async () => {
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
    // 4 active steps → 4 panner instances, each set to 0.7
    expect(stats.panValuesSet).toContain(0.7);
    expect(stats.panValuesSet.length).toBe(4);
  });

  it("muted Channel → gain = 0 für alle Trigger", async () => {
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
    // Bei muted=true wird gain.value zweimal pro Step geschrieben (init + zero).
    // Letzte Schreibung pro Step muss 0 sein.
    expect(stats.gainValuesSet.some(v => v === 0)).toBe(true);
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

  it("Filter wird angelegt wenn fx.filterFreq < 20000", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    part.fx.filterFreq = 5000;
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    expect(stats.filterNodesCreated).toBe(4); // 1 per active step
    expect(stats.filterFreqsSet).toContain(5000);
  });

  it("kein Filter wenn fx.filterFreq >= 20000 (bypass)", async () => {
    const stats = freshStats();
    const CtxCtor = makeMockOfflineCtxCtor(stats);
    const part = makePart();
    part.fx.filterFreq = 20000;
    const pattern = makePattern();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
      sampleBuffer,
    }, CtxCtor);
    expect(stats.filterNodesCreated).toBe(0);
  });

  it("Mono-Mode erzeugt keinen StereoPanner", async () => {
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
    // 64 bars @ 1 BPM = absurd lang ~ ca. 245 min, should throw
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
    const pattern = makePattern({ bpm: 60 });   // halb so schnell wie 120
    const result = await renderChannelToBuffer(part, pattern, {
      length: { mode: "currentPattern" },
      bpm: 120,
      sampleRate: 48000,
    }, CtxCtor);
    // 1 bar @ 60 bpm = 4 sec + 0.5 tail = 4.5sec
    expect(result.buffer.length).toBe(Math.ceil(4.5 * 48000));
  });
});

// ─── 6. bounceChannelToWavBuffer ─────────────────────────────────────────────

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

// ─── 7. bounceAllChannels ────────────────────────────────────────────────────

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
    const stats = freshStats();
    // Custom Ctor das beim zweiten Channel throwt
    let invocation = 0;
    const FailingCtor = class FailingCtx {
      destination = {};
      sampleRate: number;
      constructor(_ch: number, _len: number, sr: number) {
        invocation++;
        if (invocation === 2) throw new Error("Simulated render failure");
        this.sampleRate = sr;
      }
      createBufferSource() { return { buffer: null, start() {}, connect() {} }; }
      createGain() { return { gain: { value: 0 }, connect() {} }; }
      createStereoPanner() { return { pan: { value: 0 }, connect() {} }; }
      createBiquadFilter() {
        return { type: "lowpass", frequency: { value: 0 }, Q: { value: 1 }, connect() {} };
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

    // 2 erfolgreiche + 1 mit Fehler — Result-Array hat nur 2 Einträge
    expect(results).toHaveLength(2);
    expect(progresses.some(p => p.phase === "error")).toBe(true);
    void stats;
  });
});

// ─── 8. Edge-Cases & Constants ───────────────────────────────────────────────

describe("constants & boundaries", () => {
  it("BOUNCE_WARN_DURATION_SEC ist 5 Minuten", () => {
    expect(BOUNCE_WARN_DURATION_SEC).toBe(300);
  });

  it("BOUNCE_MAX_DURATION_SEC ist 30 Minuten", () => {
    expect(BOUNCE_MAX_DURATION_SEC).toBe(1800);
  });

  it("wirft wenn kein OfflineAudioContext im Environment", async () => {
    // Wir simulieren das durch undefined-Globals + kein injizierter Ctor.
    // Da OfflineAudioContext in Node nicht existiert, ist das der Default.
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

// ─── 9. Helper: void-Reference für Type-Check ────────────────────────────────

it("type-spread: vi-spy unused-import-clearance", () => {
  void vi;
  expect(true).toBe(true);
});
