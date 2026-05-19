/**
 * tests/features/audio-track-loop.test.ts (v3.70.0)
 *
 * Unit-Tests für Audio-Track Loop-Point Engine-Wiring.
 * Closes v3.67-Caveat "Loop-Marker waren visual-only — Engine ignoriert sie".
 *
 * Abgedeckt:
 *  - Store-Actions setTrackLoopEnabled / setTrackLoopPoints (Happy + Defensive)
 *  - AudioEngine.playAudioTrack respektiert loopEnabled + loopStartSample/
 *    loopEndSample (source.loop=true + loopStart/loopEnd in Sekunden)
 *  - Backward-Compat: Tracks ohne neue Felder fallen auf legacy loop-Flag zurück
 *  - Schema v1.26 Round-Trip via projectSerializer
 *  - Pre-v1.26 lädt mit defaults (Felder bleiben undefined)
 *
 * Insgesamt 14 Tests in 5 describes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
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

// ─── Mock AudioContext (analog audio-track-stretch.test.ts) ──────────────────

interface MockParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: (v: number, _t: number, _c: number) => void;
  linearRampToValueAtTime: (v: number, _t: number) => void;
  cancelScheduledValues: (_t: number) => void;
}

function makeParam(initial = 0): MockParam {
  const p: MockParam = {
    value: initial,
    setValueAtTime: vi.fn(function (this: MockParam, v: number) {
      this.value = v;
    }),
    setTargetAtTime(v: number) { this.value = v; },
    linearRampToValueAtTime(v: number) { this.value = v; },
    cancelScheduledValues() { /* no-op */ },
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
  __isSource?: boolean;
}

function makeBaseNode(): MockNode {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

const __createdSources: MockNode[] = [];

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
  createGain(): MockNode { return { ...makeBaseNode(), gain: makeParam(1) }; }
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
      onended: null,
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      playbackRate: makeParam(1),
      start(when = 0, offset = 0) {
        this.__started = true;
        void when; void offset;
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

const rafCallbacks = new Map<number, FrameRequestCallback>();
let rafCounter = 1;
(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
  const id = rafCounter++;
  rafCallbacks.set(id, cb);
  return id;
};
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => {
  rafCallbacks.delete(id);
};

// ─── Dynamische Imports nach Mock-Setup ──────────────────────────────────────

import {
  addAudioTrack,
  getAudioTrack,
  setTrackLoopEnabled,
  setTrackLoopPoints,
  __resetForTests as resetTrackStore,
  type AudioTrackChannelData,
} from "../../client/src/store/useAudioTrackStore";

import {
  serializeProject,
  parseProject,
  toJson,
  SYNTH_FILE_VERSION,
  type SynthProject,
} from "../../client/src/utils/projectSerializer";

let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

async function loadFakeBuffer(id: string, durationSec = 5): Promise<void> {
  const fakeFile = { arrayBuffer: async () => new ArrayBuffer(1024) } as unknown as File;
  const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
  ctx.decodeAudioData = vi.fn().mockResolvedValue(
    new MockAudioBuffer(2, Math.round(durationSec * 44100), 44100),
  );
  await AudioEngine.loadAudioTrack(id, fakeFile);
}

function makeTrackData(overrides: Partial<AudioTrackChannelData> = {}): AudioTrackChannelData {
  return {
    id: overrides.id ?? "audiotrack:loop-1",
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

function makeBaseProject(audioTracks?: AudioTrackChannelData[]): Omit<SynthProject, "version" | "savedAt"> {
  return {
    projectName: "Test",
    bpm: 120,
    samples: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patterns: [({ id: "p1", name: "P", steps: [], stepCount: 16 } as any)],
    activePatternId: "p1",
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: {
      masterVolume: 0.85,
      channels: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      returnTracks: {} as any,
      insertChains: {},
      eq16: {},
      sidechains: {},
      transientShapers: {},
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    humanizer: { global: {} as any },
    automation: { lanes: [], stepCount: 16 },
    ...(audioTracks !== undefined ? { audioTracks } : {}),
  };
}

function makeTrackInput(): Omit<AudioTrackChannelData, "id"> {
  return {
    name: "T",
    filePath: "/t.wav",
    fileName: "t.wav",
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
  };
}

// ─── Tests: Store Actions ────────────────────────────────────────────────────

describe("v3.70.0 – Loop Store Actions", () => {
  beforeEach(() => {
    resetTrackStore();
    localStorageMock.clear();
  });

  it("setTrackLoopEnabled togglet loopEnabled-Flag (Round-Trip)", () => {
    const id = addAudioTrack(makeTrackInput());
    expect(getAudioTrack(id)!.loopEnabled).toBeUndefined();
    setTrackLoopEnabled(id, true);
    expect(getAudioTrack(id)!.loopEnabled).toBe(true);
    setTrackLoopEnabled(id, false);
    expect(getAudioTrack(id)!.loopEnabled).toBe(false);
  });

  it("setTrackLoopPoints updates store mit start/end (happy path)", () => {
    const id = addAudioTrack(makeTrackInput());
    setTrackLoopPoints(id, 1000, 5000);
    const t = getAudioTrack(id)!;
    expect(t.loopStartSample).toBe(1000);
    expect(t.loopEndSample).toBe(5000);
  });

  it("setTrackLoopPoints swappt wenn end ≤ start (defensive)", () => {
    const id = addAudioTrack(makeTrackInput());
    setTrackLoopPoints(id, 5000, 1000);
    const t = getAudioTrack(id)!;
    expect(t.loopStartSample).toBe(1000);
    expect(t.loopEndSample).toBe(5000);
  });

  it("setTrackLoopPoints akzeptiert null (clear marker)", () => {
    const id = addAudioTrack(makeTrackInput());
    setTrackLoopPoints(id, 1000, 5000);
    setTrackLoopPoints(id, null, 5000);
    expect(getAudioTrack(id)!.loopStartSample).toBeNull();
    expect(getAudioTrack(id)!.loopEndSample).toBe(5000);
  });

  it("setTrackLoopPoints sanitized NaN/Infinity/negativ auf null", () => {
    const id = addAudioTrack(makeTrackInput());
    setTrackLoopPoints(id, NaN, 5000);
    expect(getAudioTrack(id)!.loopStartSample).toBeNull();
    setTrackLoopPoints(id, -100, 5000);
    expect(getAudioTrack(id)!.loopStartSample).toBeNull();
    setTrackLoopPoints(id, Infinity, 5000);
    expect(getAudioTrack(id)!.loopStartSample).toBeNull();
  });

  it("setTrackLoopPoints floored Float-Werte auf Integer-Sample-Indizes", () => {
    const id = addAudioTrack(makeTrackInput());
    setTrackLoopPoints(id, 1000.7, 5000.9);
    const t = getAudioTrack(id)!;
    expect(t.loopStartSample).toBe(1000);
    expect(t.loopEndSample).toBe(5000);
  });
});

// ─── Tests: AudioEngine Loop-Playback ────────────────────────────────────────

describe("v3.70.0 – AudioEngine Loop-Playback", () => {
  beforeEach(async () => {
    vi.resetModules();
    __createdSources.length = 0;
    rafCallbacks.clear();
    rafCounter = 1;
    const mod = await import("../../client/src/audio/AudioEngine");
    AudioEngine = mod.AudioEngine;
    await AudioEngine.init();
  });

  it("loopEnabled=true + valid points → source.loop=true mit loopStart/End in Sekunden", async () => {
    const id = "audiotrack:loop-engine";
    const SR = 44100;
    await loadFakeBuffer(id, 5); // 5s @ 44100 = 220500 samples
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 44100,  // 1.0s
      loopEndSample: 132300,   // 3.0s
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const src = __createdSources[__createdSources.length - 1];
    expect(src.__started).toBe(true);
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBeCloseTo(44100 / SR, 5);
    expect(src.loopEnd).toBeCloseTo(132300 / SR, 5);
    AudioEngine.disposeAudioTrack(id);
  });

  it("loopEnabled=false → kein Loop-Range, legacy loop-Flag (default false)", async () => {
    const id = "audiotrack:no-loop";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: false,
      loopStartSample: 44100,
      loopEndSample: 132300,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const src = __createdSources[__createdSources.length - 1];
    expect(src.loop).toBe(false);
    AudioEngine.disposeAudioTrack(id);
  });

  it("Pre-v3.70 Track (kein loopEnabled-Feld) + legacy data.loop=true → source.loop=true OHNE loop-Range", async () => {
    const id = "audiotrack:legacy-loop";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loop: true,
      // KEIN loopEnabled / loopStartSample / loopEndSample
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const src = __createdSources[__createdSources.length - 1];
    expect(src.loop).toBe(true);
    // Engine setzt loopStart/loopEnd nicht — bleibt bei 0 (default)
    expect(src.loopStart).toBe(0);
    expect(src.loopEnd).toBe(0);
    AudioEngine.disposeAudioTrack(id);
  });

  it("loopEnabled=true OHNE valid points → fallback auf source.loop=true (komplette Buffer)", async () => {
    const id = "audiotrack:loop-no-points";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      // null = unset
      loopStartSample: null,
      loopEndSample: null,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const src = __createdSources[__createdSources.length - 1];
    expect(src.loop).toBe(true);
    // Kein Range gesetzt → loopStart/loopEnd bleiben 0 (Default = ganzer Buffer)
    expect(src.loopStart).toBe(0);
    expect(src.loopEnd).toBe(0);
    AudioEngine.disposeAudioTrack(id);
  });

  it("loopEnabled=true mit end ≤ start → fallback auf legacy loop=true (defensive — Range invalid)", async () => {
    const id = "audiotrack:loop-bad-range";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 100000,
      loopEndSample: 50000, // < start
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const src = __createdSources[__createdSources.length - 1];
    // wantsLoopRange ist false (end ≤ start) → fallback Pfad → loopEnabled=true → source.loop=true ohne Range
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBe(0);
    expect(src.loopEnd).toBe(0);
    AudioEngine.disposeAudioTrack(id);
  });
});

// ─── Tests: Serializer Round-Trip (v1.26) ────────────────────────────────────

describe("v3.70.0 – Serializer Round-Trip (v1.26)", () => {
  beforeEach(() => {
    resetTrackStore();
    localStorageMock.clear();
  });

  it("SYNTH_FILE_VERSION wurde auf '1.31' gebumpt (v3.76.0 Master-Limiter + Mid-Q)", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.31");
  });

  it("Round-Trip erhält loopEnabled + loopStartSample + loopEndSample", () => {
    const tracks: AudioTrackChannelData[] = [
      {
        id: "audiotrack:rt-loop",
        name: "Loop-RT",
        filePath: "/data/loop.wav",
        fileName: "loop.wav",
        volume: 1.0, pan: 0,
        muted: false, soloed: false,
        sends: { reverb: 0, delay: 0 },
        syncMode: "free",
        originalBpm: null,
        loopEnabled: true,
        loopStartSample: 44100,
        loopEndSample: 132300,
      },
    ];
    const json = toJson(serializeProject(makeBaseProject(tracks)));
    const restored = parseProject(json);
    expect(restored.audioTracks).toHaveLength(1);
    const t = restored.audioTracks![0];
    expect(t.loopEnabled).toBe(true);
    expect(t.loopStartSample).toBe(44100);
    expect(t.loopEndSample).toBe(132300);
  });
});

// ─── Tests: Pre-v1.26 Backward-Compat ────────────────────────────────────────

describe("v3.70.0 – Pre-v1.26 Backward-Compat", () => {
  beforeEach(() => {
    resetTrackStore();
    localStorageMock.clear();
  });

  it("Pre-v1.26 Track ohne Loop-Felder lädt mit defaults (undefined)", () => {
    const v125Json = JSON.stringify({
      version: "1.25",
      savedAt: new Date().toISOString(),
      projectName: "Pre-loop",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", steps: [], stepCount: 16 }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      audioTracks: [
        {
          id: "audiotrack:pre-loop",
          name: "Old", filePath: "/o.wav", fileName: "o.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
        },
      ],
    });
    const restored = parseProject(v125Json);
    expect(restored.audioTracks).toHaveLength(1);
    const t = restored.audioTracks![0];
    expect(t.loopEnabled).toBeUndefined();
    expect(t.loopStartSample).toBeUndefined();
    expect(t.loopEndSample).toBeUndefined();
    expect(restored.version).toBe("1.25"); // source version preserved
  });

  it("Serializer verwirft Track mit invalidem Loop-Typ (string statt boolean)", () => {
    const corruptJson = JSON.stringify({
      version: "1.26",
      savedAt: new Date().toISOString(),
      projectName: "Corrupt",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", steps: [], stepCount: 16 }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      audioTracks: [
        // valid
        {
          id: "audiotrack:ok", name: "OK", filePath: "/ok.wav", fileName: "ok.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
          loopEnabled: true, loopStartSample: 100, loopEndSample: 500,
        },
        // invalid: loopEnabled ist string
        {
          id: "audiotrack:bad", name: "Bad", filePath: "/bad.wav", fileName: "bad.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
          loopEnabled: "yes",
        },
      ],
    });
    const restored = parseProject(corruptJson);
    expect(restored.audioTracks).toHaveLength(1);
    expect(restored.audioTracks![0].id).toBe("audiotrack:ok");
  });
});

// ─── Tests: localStorage-Persist ─────────────────────────────────────────────

describe("v3.70.0 – Loop Persist via Store", () => {
  beforeEach(() => {
    resetTrackStore();
    localStorageMock.clear();
  });

  it("Loop-Points werden in localStorage geschrieben (Round-Trip)", () => {
    const id = addAudioTrack(makeTrackInput());
    setTrackLoopEnabled(id, true);
    setTrackLoopPoints(id, 22050, 88200);
    const raw = localStorageMock.getItem("synthstudio:audiotracks:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].loopEnabled).toBe(true);
    expect(parsed[0].loopStartSample).toBe(22050);
    expect(parsed[0].loopEndSample).toBe(88200);
  });
});
