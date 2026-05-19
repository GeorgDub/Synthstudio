/**
 * tests/features/audio-loop-crossfade.test.ts (v3.72.0)
 *
 * Unit-Tests für v3.72.0 — Loop-Boundary Crossfade. Closes v3.71-Caveat
 * "harter Cut bei loopEnd → loopStart". Verifies:
 *
 *  1. Store: setTrackLoopCrossfadeMs persistiert + clamped (0..200ms).
 *  2. Engine BufferSource: setValueCurveAtTime wird auf den xfade-GainNode
 *     geschedult wenn loopCrossfadeMs > 0 + valid Range.
 *  3. Engine Worklet: setLoop-Message enthält crossfadeSamples-Feld.
 *  4. Clamp: crossfadeMs > loopRange/2 → engine clampt auf rangeLen/2
 *     (Samples) im Worklet-Payload.
 *  5. Backward-Compat: loopCrossfadeMs = 0 (default) → KEIN xfade-GainNode,
 *     KEIN setValueCurveAtTime, Worklet-Payload hat crossfadeSamples=0.
 *  6. Schema v1.27: SYNTH_FILE_VERSION + Round-Trip preserved loopCrossfadeMs.
 *  7. Pre-v1.27-Files: loopCrossfadeMs bleibt undefined.
 *
 * Insgesamt 11 Tests in 4 describes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

// ─── Mock-AudioContext + AudioWorkletNode ───────────────────────────────────

interface MockParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setValueCurveAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
  setTargetAtTime: (v: number, _t: number, _c: number) => void;
  linearRampToValueAtTime: (v: number, _t: number) => void;
}

function makeParam(initial = 0): MockParam {
  const p: MockParam = {
    value: initial,
    setValueAtTime: vi.fn(function (this: MockParam, v: number) { this.value = v; }),
    setValueCurveAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime(v: number) { this.value = v; },
    linearRampToValueAtTime(v: number) { this.value = v; },
  };
  (p.setValueAtTime as ReturnType<typeof vi.fn>).mockImplementation((v: number) => {
    p.value = v;
  });
  return p;
}

interface MockNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start?: (..._args: number[]) => void;
  stop?: () => void;
  onended?: (() => void) | null;
  buffer?: unknown;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  type?: string;
  curve?: Float32Array | null;
  oversample?: string;
  gain?: MockParam;
  pan?: MockParam;
  frequency?: MockParam;
  Q?: MockParam;
  threshold?: MockParam;
  ratio?: MockParam;
  attack?: MockParam;
  release?: MockParam;
  delayTime?: MockParam;
  reduction?: number;
  playbackRate?: MockParam;
  __started?: boolean;
  __stopped?: boolean;
  __startArgs?: number[];
  __isSource?: boolean;
  __isGain?: boolean;
}

function makeBaseNode(): MockNode {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

const __createdSources: MockNode[] = [];
const __createdGains: MockNode[] = [];

interface MockWorkletPort {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent) => void) | null;
}

interface MockAudioWorkletNode {
  port: MockWorkletPort;
  parameters: Map<string, MockParam>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  __processorName: string;
}

const __createdWorklets: MockAudioWorkletNode[] = [];

class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c: number): Float32Array { return this.data[c]; }
}

class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: "suspended" | "running" = "running";
  destination = makeBaseNode();
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn().mockResolvedValue(new MockAudioBuffer(2, 44100, 44100));
  createGain(): MockNode {
    const g: MockNode = { ...makeBaseNode(), gain: makeParam(1), __isGain: true };
    __createdGains.push(g);
    return g;
  }
  createStereoPanner(): MockNode { return { ...makeBaseNode(), pan: makeParam(0) }; }
  createBiquadFilter(): MockNode {
    return { ...makeBaseNode(), type: "lowpass", frequency: makeParam(8000), Q: makeParam(1), gain: makeParam(0) };
  }
  createWaveShaper(): MockNode { return { ...makeBaseNode(), curve: null, oversample: "4x" }; }
  createDynamicsCompressor(): MockNode {
    return { ...makeBaseNode(), threshold: makeParam(-24), ratio: makeParam(4), attack: makeParam(0.003), release: makeParam(0.25), knee: makeParam(30), reduction: 0 };
  }
  createDelay(): MockNode { return { ...makeBaseNode(), delayTime: makeParam(0.25) }; }
  createConvolver(): MockNode { return { ...makeBaseNode(), buffer: null }; }
  createAnalyser(): MockNode {
    return {
      ...makeBaseNode(),
      // @ts-expect-error mock-only
      fftSize: 512, smoothingTimeConstant: 0.8, getFloatTimeDomainData: vi.fn(),
    };
  }
  createBuffer(channels: number, length: number, sr: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sr);
  }
  createBufferSource(): MockNode {
    const src: MockNode = {
      ...makeBaseNode(),
      __isSource: true,
      __started: false,
      __stopped: false,
      __startArgs: [],
      onended: null,
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      playbackRate: makeParam(1),
      start(when = 0, offset = 0) {
        this.__started = true;
        this.__startArgs = [when, offset];
      },
      stop() { this.__stopped = true; },
    };
    __createdSources.push(src);
    return src;
  }
  createOscillator(): MockNode {
    return { ...makeBaseNode(), type: "sine", frequency: makeParam(440), start: vi.fn(), stop: vi.fn() };
  }
}

function MockAudioWorkletNodeCtor(
  this: MockAudioWorkletNode,
  _ctx: unknown,
  name: string,
) {
  const params = new Map<string, MockParam>();
  params.set("stretch", makeParam(1.0));
  const port: MockWorkletPort = {
    postMessage: vi.fn(),
    onmessage: null,
  };
  this.port = port;
  this.parameters = params;
  this.connect = vi.fn();
  this.disconnect = vi.fn();
  this.__processorName = name;
  __createdWorklets.push(this);
  return this;
}

(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
(globalThis as Record<string, unknown>).AudioWorkletNode = MockAudioWorkletNodeCtor;
(globalThis as Record<string, unknown>).requestAnimationFrame = (_cb: FrameRequestCallback) => 0;
(globalThis as Record<string, unknown>).cancelAnimationFrame = () => { /* no-op */ };

// ─── Dynamische Imports ──────────────────────────────────────────────────────

import type { AudioTrackChannelData } from "../../client/src/audio/AudioEngine";

let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function makeTrackData(overrides: Partial<AudioTrackChannelData> = {}): AudioTrackChannelData {
  return {
    id: overrides.id ?? "audiotrack:t1",
    name: "Sample",
    filePath: "/fake/loop.wav",
    fileName: "loop.wav",
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    syncMode: "free",
    originalBpm: null,
    ...overrides,
  };
}

async function loadFakeBuffer(id: string, durationSec = 5): Promise<void> {
  const fakeFile = { arrayBuffer: async () => new ArrayBuffer(1024) } as unknown as File;
  const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
  ctx.decodeAudioData = vi.fn().mockResolvedValue(
    new MockAudioBuffer(2, Math.round(durationSec * 44100), 44100),
  );
  await AudioEngine.loadAudioTrack(id, fakeFile);
}

// ─── 1. Store: setTrackLoopCrossfadeMs persistiert + clamped ─────────────────

describe("v3.72.0 — Store: setTrackLoopCrossfadeMs", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorageMock.clear();
  });

  it("clampLoopCrossfadeMs clamped Werte in [0, 200]", async () => {
    const { clampLoopCrossfadeMs, LOOP_CROSSFADE_MAX_MS } = await import(
      "../../client/src/store/useAudioTrackStore"
    );
    expect(LOOP_CROSSFADE_MAX_MS).toBe(200);
    expect(clampLoopCrossfadeMs(50)).toBe(50);
    expect(clampLoopCrossfadeMs(0)).toBe(0);
    expect(clampLoopCrossfadeMs(-10)).toBe(0);
    expect(clampLoopCrossfadeMs(250)).toBe(200);
    expect(clampLoopCrossfadeMs(NaN)).toBe(0);
    // Number.isFinite(Infinity) === false → defensive 0 (kein gültiger Eingabewert).
    expect(clampLoopCrossfadeMs(Infinity)).toBe(0);
  });

  it("setTrackLoopCrossfadeMs persistiert in localStorage", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const id = mod.addAudioTrack({
      name: "Loop", filePath: "/tmp/x.wav", fileName: "x.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    mod.setTrackLoopCrossfadeMs(id, 25);
    const t = mod.getAudioTrack(id);
    expect(t?.loopCrossfadeMs).toBe(25);
    // localStorage Round-Trip
    const raw = localStorageMock.getItem("synthstudio:audiotracks:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Array<{ loopCrossfadeMs?: number }>;
    expect(parsed[0].loopCrossfadeMs).toBe(25);
  });

  it("setTrackLoopCrossfadeMs(id, 500) → 200 (clamp)", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const id = mod.addAudioTrack({
      name: "Loop", filePath: "/tmp/x.wav", fileName: "x.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    mod.setTrackLoopCrossfadeMs(id, 500);
    expect(mod.getAudioTrack(id)?.loopCrossfadeMs).toBe(200);
  });

  it("setTrackLoopCrossfadeMs(id, -5) → 0 (clamp)", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const id = mod.addAudioTrack({
      name: "Loop", filePath: "/tmp/x.wav", fileName: "x.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    mod.setTrackLoopCrossfadeMs(id, -5);
    expect(mod.getAudioTrack(id)?.loopCrossfadeMs).toBe(0);
  });
});

// ─── 2. Engine BufferSource: Crossfade-GainNode + Schedule ───────────────────

describe("v3.72.0 — Engine BufferSource: Crossfade-GainNode + Schedule", () => {
  beforeEach(async () => {
    vi.resetModules();
    __createdSources.length = 0;
    __createdGains.length = 0;
    __createdWorklets.length = 0;
    localStorageMock.clear();
    const mod = await import("../../client/src/audio/AudioEngine");
    AudioEngine = mod.AudioEngine;
    await AudioEngine.init();
  });

  it("loopCrossfadeMs > 0 + valid Range → xfade-GainNode wird in die Chain eingefügt + setValueCurveAtTime scheduled", async () => {
    const id = "audiotrack:xfade-on";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 44100,    // 1s
      loopEndSample: 132300,     // 3s
      loopCrossfadeMs: 20,        // 20ms
    }));
    const gainsBefore = __createdGains.length;
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    // Mindestens 1 zusätzlicher GainNode wurde erzeugt (xfade-gain).
    expect(__createdGains.length).toBeGreaterThan(gainsBefore);

    // Mindestens ein GainNode hat setValueCurveAtTime-Calls erhalten.
    const xfadeCallsTotal = __createdGains.reduce((sum, g) => {
      const calls = (g.gain?.setValueCurveAtTime as ReturnType<typeof vi.fn>)?.mock?.calls?.length ?? 0;
      return sum + calls;
    }, 0);
    // Pro Loop-Cycle 2 Calls (fade-out + fade-in); 64 Cycles scheduled → 128.
    expect(xfadeCallsTotal).toBeGreaterThan(0);
    AudioEngine.disposeAudioTrack(id);
  });

  it("loopCrossfadeMs = 0 (default) → KEIN setValueCurveAtTime auf einem xfade-GainNode (backward-compat)", async () => {
    const id = "audiotrack:xfade-off";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 44100,
      loopEndSample: 132300,
      // loopCrossfadeMs nicht gesetzt → default 0
    }));
    const xfadeCallsBefore = __createdGains.reduce((sum, g) => {
      const calls = (g.gain?.setValueCurveAtTime as ReturnType<typeof vi.fn>)?.mock?.calls?.length ?? 0;
      return sum + calls;
    }, 0);
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const xfadeCallsAfter = __createdGains.reduce((sum, g) => {
      const calls = (g.gain?.setValueCurveAtTime as ReturnType<typeof vi.fn>)?.mock?.calls?.length ?? 0;
      return sum + calls;
    }, 0);
    expect(xfadeCallsAfter).toBe(xfadeCallsBefore);
    AudioEngine.disposeAudioTrack(id);
  });

  it("loopCrossfadeMs > loopRange/2 → engine clampt: setValueCurveAtTime mit duration ≤ rangeSec/2", async () => {
    // Range 1000 Samples @ 44100Hz = 22.67ms. crossfade=100ms → clamp auf 11.33ms.
    const id = "audiotrack:xfade-clamp";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 0,
      loopEndSample: 1000,        // 22.67ms range
      loopCrossfadeMs: 100,       // 100ms crossfade — sollte auf ~11ms clamped werden
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    // Suche im ersten gain mit setValueCurveAtTime nach der duration (3. Argument).
    let maxDurFound = 0;
    for (const g of __createdGains) {
      const calls = (g.gain?.setValueCurveAtTime as ReturnType<typeof vi.fn>)?.mock?.calls ?? [];
      for (const args of calls) {
        // args = [curve, startTime, duration]
        const dur = args[2] as number;
        if (typeof dur === "number" && dur > maxDurFound) maxDurFound = dur;
      }
    }
    // Range = 1000/44100 ≈ 22.67ms. Crossfade clamped auf rangeSec/2 ≈ 11.33ms = 0.01133s.
    expect(maxDurFound).toBeGreaterThan(0);
    expect(maxDurFound).toBeLessThanOrEqual(0.0114); // Clamp greift.
    AudioEngine.disposeAudioTrack(id);
  });
});

// ─── 3. Engine Worklet: setLoop-Message enthält crossfadeSamples ─────────────

describe("v3.72.0 — Engine Worklet: crossfadeSamples-Payload", () => {
  beforeEach(async () => {
    vi.resetModules();
    __createdSources.length = 0;
    __createdGains.length = 0;
    __createdWorklets.length = 0;
    localStorageMock.clear();
    const mod = await import("../../client/src/audio/AudioEngine");
    AudioEngine = mod.AudioEngine;
    await AudioEngine.init();
  });

  it("pitchLocked=true + loopCrossfadeMs=20 → setLoop-Message hat crossfadeSamples > 0", async () => {
    const id = "audiotrack:worklet-xfade";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      loopEnabled: true,
      loopStartSample: 44100,
      loopEndSample: 132300,
      loopCrossfadeMs: 20, // 20ms → 882 Samples bei 44.1kHz
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const node = __createdWorklets[__createdWorklets.length - 1];
    const setLoopCall = node.port.postMessage.mock.calls.find(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    );
    expect(setLoopCall).toBeDefined();
    const payload = setLoopCall![0] as {
      loop: boolean; loopStart: number; loopEnd: number; crossfadeSamples: number;
    };
    expect(payload.loop).toBe(true);
    // 20ms * 44100 Hz / 1000 = 882 Samples.
    expect(payload.crossfadeSamples).toBe(882);
    AudioEngine.disposeAudioTrack(id);
  });

  it("loopCrossfadeMs = 0 → setLoop-Message hat crossfadeSamples = 0 (backward-compat)", async () => {
    const id = "audiotrack:worklet-no-xfade";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      loopEnabled: true,
      loopStartSample: 44100,
      loopEndSample: 132300,
      // loopCrossfadeMs default 0
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const node = __createdWorklets[__createdWorklets.length - 1];
    const setLoopCall = node.port.postMessage.mock.calls.find(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    );
    const payload = setLoopCall![0] as { crossfadeSamples: number };
    expect(payload.crossfadeSamples).toBe(0);
    AudioEngine.disposeAudioTrack(id);
  });

  it("loopCrossfadeMs > loopRange/2 → engine clampt crossfadeSamples auf rangeLen/2", async () => {
    const id = "audiotrack:worklet-clamp";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      loopEnabled: true,
      loopStartSample: 0,
      loopEndSample: 1000,           // Range = 1000 Samples
      loopCrossfadeMs: 100,          // → 4410 Samples raw, sollte auf 500 clamped werden
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const node = __createdWorklets[__createdWorklets.length - 1];
    const setLoopCall = node.port.postMessage.mock.calls.find(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    );
    const payload = setLoopCall![0] as { crossfadeSamples: number };
    // rangeLen / 2 = 500.
    expect(payload.crossfadeSamples).toBeLessThanOrEqual(500);
    expect(payload.crossfadeSamples).toBeGreaterThan(0);
    AudioEngine.disposeAudioTrack(id);
  });
});

// ─── 4. Schema v1.27 Round-Trip + Backward-Compat ───────────────────────────

describe("v3.72.0 — Schema v1.27 Round-Trip + Backward-Compat", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorageMock.clear();
  });

  it("SYNTH_FILE_VERSION = '1.29'", async () => {
    const { SYNTH_FILE_VERSION } = await import(
      "../../client/src/utils/projectSerializer"
    );
    expect(SYNTH_FILE_VERSION).toBe("1.31");
  });

  it("Round-Trip: loopCrossfadeMs wird in der .synth-Datei preserved", async () => {
    const { serializeProject, parseProject } = await import(
      "../../client/src/utils/projectSerializer"
    );
    const baseInput = {
      projectName: "Loop Crossfade Test",
      bpm: 120,
      samples: [],
      patterns: [{
        id: "p1",
        name: "P",
        parts: [],
        steps: [],
        stepCount: 16,
        stepResolution: "1/16" as const,
      }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {},
        eq16: {}, sidechains: {}, transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 as const },
      audioTracks: [{
        id: "audiotrack:rt-xfade",
        name: "RT",
        filePath: "/foo/bar.wav",
        fileName: "bar.wav",
        volume: 1, pan: 0, muted: false, soloed: false,
        sends: { reverb: 0, delay: 0 },
        loopEnabled: true,
        loopStartSample: 1000,
        loopEndSample: 50000,
        loopCrossfadeMs: 15,
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ser = serializeProject(baseInput as any);
    const json = JSON.stringify(ser);
    const parsed = parseProject(json);
    expect(parsed.version).toBe("1.31");
    expect(parsed.audioTracks).toBeDefined();
    expect(parsed.audioTracks![0].loopCrossfadeMs).toBe(15);
  });

  it("Pre-v1.27-Files ohne loopCrossfadeMs-Feld → loopCrossfadeMs bleibt undefined (backward-compat)", async () => {
    const { parseProject } = await import(
      "../../client/src/utils/projectSerializer"
    );
    const preV127 = {
      version: "1.26",
      savedAt: new Date().toISOString(),
      projectName: "Pre-v1.27",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", parts: [], steps: [], stepCount: 16, stepResolution: "1/16" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {},
        eq16: {}, sidechains: {}, transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      audioTracks: [{
        id: "audiotrack:pre",
        name: "Pre",
        filePath: "/old.wav",
        fileName: "old.wav",
        volume: 1, pan: 0, muted: false, soloed: false,
        sends: { reverb: 0, delay: 0 },
        loopEnabled: true,
        loopStartSample: 0,
        loopEndSample: 1000,
        // loopCrossfadeMs NICHT gesetzt
      }],
    };
    const parsed = parseProject(JSON.stringify(preV127));
    expect(parsed.audioTracks).toHaveLength(1);
    expect(parsed.audioTracks![0].loopCrossfadeMs).toBeUndefined();
    expect(parsed.version).toBe("1.26"); // source version preserved
  });

  it("Invalider loopCrossfadeMs-Typ (string statt number) → Track verworfen", async () => {
    const { parseProject } = await import(
      "../../client/src/utils/projectSerializer"
    );
    const corrupt = {
      version: "1.27",
      savedAt: new Date().toISOString(),
      projectName: "Corrupt",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", parts: [], steps: [], stepCount: 16, stepResolution: "1/16" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {},
        eq16: {}, sidechains: {}, transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      audioTracks: [
        // valid
        {
          id: "audiotrack:ok", name: "OK", filePath: "/ok.wav", fileName: "ok.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
          loopCrossfadeMs: 25,
        },
        // invalid: loopCrossfadeMs ist string
        {
          id: "audiotrack:bad", name: "Bad", filePath: "/bad.wav", fileName: "bad.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
          loopCrossfadeMs: "twenty",
        },
      ],
    };
    const parsed = parseProject(JSON.stringify(corrupt));
    expect(parsed.audioTracks).toHaveLength(1);
    expect(parsed.audioTracks![0].id).toBe("audiotrack:ok");
  });
});
