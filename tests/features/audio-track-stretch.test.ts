/**
 * tests/features/audio-track-stretch.test.ts
 *
 * Unit-Tests für Audio-Track Time-Stretch UI (v3.52.0):
 *  - Store-Actions:  setTrackStretchRatio / setTrackPitchLocked
 *                    setTrackBpmHint / autoWarpToBpm
 *  - Pure helpers:   clampStretchRatio / computeWarpRatio
 *  - AudioEngine:    Routing via pitchLocked → Worklet, _calcAudioTrackPlaybackRate
 *                    berücksichtigt stretchRatio multiplikativ.
 *  - Schema (v1.22): Round-Trip via projectSerializer erhält die neuen Felder.
 *
 * Insgesamt 11 Tests in 5 describes (Mix aus reinen Store-Tests via jsdom-light
 * + Engine-Tests via Mock-AudioContext im Stil von audio-track-timestretch).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock (für Store-Tests) ──────────────────────────────────────

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

// ─── Mock-Helpers für AudioEngine (gleicher Stil wie audio-track-timestretch.test.ts)

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
    return { ...makeBaseNode(),
      // @ts-expect-error mock-only
      fftSize: 512, smoothingTimeConstant: 0.8, getFloatTimeDomainData: vi.fn() };
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

function MockAudioWorkletNodeCtor(
  this: MockAudioWorkletNode,
  _ctx: unknown,
  name: string,
  _options?: { outputChannelCount?: number[] },
) {
  const params = new Map<string, MockParam>();
  params.set("stretch", makeParam(1.0));
  const port: MockWorkletPort = { postMessage: vi.fn(), onmessage: null };
  this.port = port;
  this.parameters = params;
  this.connect = vi.fn();
  this.disconnect = vi.fn();
  this.__processorName = name;
  __createdWorklets.push(this);
  return this;
}

const rafCallbacks = new Map<number, FrameRequestCallback>();
let rafCounter = 1;
(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
(globalThis as Record<string, unknown>).AudioWorkletNode = MockAudioWorkletNodeCtor;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
  const id = rafCounter++;
  rafCallbacks.set(id, cb);
  return id;
};
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => {
  rafCallbacks.delete(id);
};

// ─── Dynamische Imports nach Mock-Setup ───────────────────────────────────────

import {
  addAudioTrack,
  updateAudioTrack,
  getAudioTrack,
  setTrackStretchRatio,
  setTrackPitchLocked,
  setTrackBpmHint,
  autoWarpToBpm,
  clampStretchRatio,
  computeWarpRatio,
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

// Engine-Test-Helpers
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
    id: overrides.id ?? "audiotrack:s-1",
    name: "Sample",
    filePath: "/fake/song.wav",
    fileName: "song.wav",
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

// ─── Tests: Pure Helpers ──────────────────────────────────────────────────────

describe("v3.52.0 – Stretch Pure Helpers", () => {
  it("clampStretchRatio clampt < 0.25 auf 0.25 und > 4.0 auf 4.0", () => {
    expect(clampStretchRatio(0.1)).toBe(0.25);
    expect(clampStretchRatio(0.25)).toBe(0.25);
    expect(clampStretchRatio(1.0)).toBe(1.0);
    expect(clampStretchRatio(4.0)).toBe(4.0);
    expect(clampStretchRatio(8.0)).toBe(4.0);
  });

  it("clampStretchRatio bei NaN/0/negativ/Infinity → 1.0 (defensive default)", () => {
    expect(clampStretchRatio(NaN)).toBe(1.0);
    expect(clampStretchRatio(0)).toBe(1.0);
    expect(clampStretchRatio(-2)).toBe(1.0);
    // Infinity ist nicht finite → defensive default 1.0 (kein Worklet-Crash bei NaN-Param).
    expect(clampStretchRatio(Infinity)).toBe(1.0);
  });

  it("computeWarpRatio(projectBpm, sourceBpm) liefert projectBpm/sourceBpm geclamped auf 0.25..4.0", () => {
    expect(computeWarpRatio(130, 120)).toBeCloseTo(130 / 120, 5);
    expect(computeWarpRatio(60, 120)).toBeCloseTo(0.5, 5);
    // Werte über 4 werden geclampt (z.B. 250/50=5 → 4)
    expect(computeWarpRatio(250, 50)).toBe(4.0);
    // Werte unter 0.25 werden geclampt (50/250 = 0.2 → 0.25)
    expect(computeWarpRatio(50, 250)).toBe(0.25);
  });

  it("computeWarpRatio liefert null bei ungültigen Inputs", () => {
    expect(computeWarpRatio(120, 0)).toBeNull();
    expect(computeWarpRatio(120, null)).toBeNull();
    expect(computeWarpRatio(120, undefined)).toBeNull();
    expect(computeWarpRatio(0, 120)).toBeNull();
    expect(computeWarpRatio(NaN, 120)).toBeNull();
    expect(computeWarpRatio(120, -1)).toBeNull();
  });
});

// ─── Tests: Store Actions ─────────────────────────────────────────────────────

describe("v3.52.0 – Store Actions", () => {
  beforeEach(() => {
    resetTrackStore();
    localStorageMock.clear();
  });

  it("setTrackStretchRatio updated den Store + clampt Werte", () => {
    const id = addAudioTrack({
      name: "T", filePath: "/t.wav", fileName: "t.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    setTrackStretchRatio(id, 2.0);
    expect(getAudioTrack(id)!.stretchRatio).toBe(2.0);
    // Clamping in Aktion: 10 → 4.0
    setTrackStretchRatio(id, 10);
    expect(getAudioTrack(id)!.stretchRatio).toBe(4.0);
    // NaN → 1.0
    setTrackStretchRatio(id, NaN);
    expect(getAudioTrack(id)!.stretchRatio).toBe(1.0);
  });

  it("setTrackPitchLocked togglet das pitchLocked-Flag", () => {
    const id = addAudioTrack({
      name: "T", filePath: "/t.wav", fileName: "t.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    expect(getAudioTrack(id)!.pitchLocked).toBeUndefined();
    setTrackPitchLocked(id, true);
    expect(getAudioTrack(id)!.pitchLocked).toBe(true);
    setTrackPitchLocked(id, false);
    expect(getAudioTrack(id)!.pitchLocked).toBe(false);
  });

  it("setTrackBpmHint speichert positive Werte, räumt bei null/0/neg auf", () => {
    const id = addAudioTrack({
      name: "T", filePath: "/t.wav", fileName: "t.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    setTrackBpmHint(id, 128);
    expect(getAudioTrack(id)!.bpmHint).toBe(128);
    setTrackBpmHint(id, null);
    expect(getAudioTrack(id)!.bpmHint).toBeUndefined();
    setTrackBpmHint(id, 0);
    expect(getAudioTrack(id)!.bpmHint).toBeUndefined();
  });

  it("autoWarpToBpm berechnet stretchRatio = projectBpm / bpmHint und persistiert", () => {
    const id = addAudioTrack({
      name: "T", filePath: "/t.wav", fileName: "t.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    setTrackBpmHint(id, 100);
    const ratio = autoWarpToBpm(id, 130);
    expect(ratio).toBeCloseTo(1.3, 5);
    expect(getAudioTrack(id)!.stretchRatio).toBeCloseTo(1.3, 5);
  });

  it("autoWarpToBpm fällt auf originalBpm zurück wenn bpmHint nicht gesetzt", () => {
    const id = addAudioTrack({
      name: "T", filePath: "/t.wav", fileName: "t.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
      originalBpm: 120,
    });
    const ratio = autoWarpToBpm(id, 90);
    expect(ratio).toBeCloseTo(0.75, 5);
    expect(getAudioTrack(id)!.stretchRatio).toBeCloseTo(0.75, 5);
  });

  it("autoWarpToBpm liefert null wenn weder bpmHint noch originalBpm gesetzt", () => {
    const id = addAudioTrack({
      name: "T", filePath: "/t.wav", fileName: "t.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    const ratio = autoWarpToBpm(id, 120);
    expect(ratio).toBeNull();
    // stretchRatio unverändert
    expect(getAudioTrack(id)!.stretchRatio).toBeUndefined();
  });

  it("updateAudioTrack mit invalidem Typ wird vom Store-Validator nicht abgewehrt (additive Felder)", () => {
    // Defensive Note: updateAudioTrack hat KEINE eigene Validierung (ist Patch-Semantik).
    // Der Schutz liegt im loadAudioTracks-Pfad und im Serializer. Wir prüfen hier
    // dass clamp via setTrackStretchRatio greift selbst wenn updateAudioTrack roh
    // einen schrägen Wert aufnimmt.
    const id = addAudioTrack({
      name: "T", filePath: "/t.wav", fileName: "t.wav",
      volume: 1, pan: 0, muted: false, soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    updateAudioTrack(id, { stretchRatio: -5 });
    // updateAudioTrack patcht direkt → Wert ist drin
    expect(getAudioTrack(id)!.stretchRatio).toBe(-5);
    // setTrackStretchRatio clampt
    setTrackStretchRatio(id, -5);
    expect(getAudioTrack(id)!.stretchRatio).toBe(1.0);
  });
});

// ─── Tests: Serializer Round-Trip (v1.22) ─────────────────────────────────────

describe("v3.52.0 – Serializer Round-Trip (v1.22)", () => {
  function makeBaseProject(
    audioTracks?: AudioTrackChannelData[],
  ): Omit<SynthProject, "version" | "savedAt"> {
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

  beforeEach(() => {
    resetTrackStore();
    localStorageMock.clear();
  });

  it("SYNTH_FILE_VERSION wurde auf '1.32' gebumpt (v3.79 Sub-Mix-Buses)", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.36");
  });

  it("Round-Trip erhält stretchRatio + pitchLocked + bpmHint", () => {
    const tracks: AudioTrackChannelData[] = [
      {
        id: "audiotrack:rt-1",
        name: "Roundtrip",
        filePath: "/data/song.wav",
        fileName: "song.wav",
        volume: 1.0, pan: 0,
        muted: false, soloed: false,
        sends: { reverb: 0, delay: 0 },
        syncMode: "free",
        originalBpm: null,
        stretchRatio: 1.25,
        pitchLocked: true,
        bpmHint: 100,
      },
    ];
    const json = toJson(serializeProject(makeBaseProject(tracks)));
    const restored = parseProject(json);
    expect(restored.audioTracks).toHaveLength(1);
    const t = restored.audioTracks![0];
    expect(t.stretchRatio).toBe(1.25);
    expect(t.pitchLocked).toBe(true);
    expect(t.bpmHint).toBe(100);
  });

  it("Backward-Compat: v1.21-Tracks ohne neue Felder bleiben gültig", () => {
    // Simuliere v1.21-Track ohne stretchRatio/pitchLocked/bpmHint
    const v121Json = JSON.stringify({
      version: "1.21",
      savedAt: new Date().toISOString(),
      projectName: "Legacy",
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
          id: "audiotrack:old", name: "Old", filePath: "/o.wav", fileName: "o.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
          syncMode: "free", originalBpm: null,
        },
      ],
    });
    const restored = parseProject(v121Json);
    expect(restored.audioTracks).toHaveLength(1);
    const t = restored.audioTracks![0];
    expect(t.stretchRatio).toBeUndefined();
    expect(t.pitchLocked).toBeUndefined();
    expect(t.bpmHint).toBeUndefined();
    // Source-Version bleibt erhalten (parseProject preserves source)
    expect(restored.version).toBe("1.21");
  });

  it("Serializer verwirft Tracks mit invalidem Typ in stretchRatio/pitchLocked/bpmHint", () => {
    const corruptJson = JSON.stringify({
      version: "1.22",
      savedAt: new Date().toISOString(),
      projectName: "X",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", steps: [], stepCount: 16 }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      audioTracks: [
        // gültig
        {
          id: "audiotrack:ok", name: "OK", filePath: "/ok.wav", fileName: "ok.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
          stretchRatio: 1.5, pitchLocked: false, bpmHint: 128,
        },
        // invalid: stretchRatio ist String
        {
          id: "audiotrack:bad", name: "Bad", filePath: "/bad.wav", fileName: "bad.wav",
          volume: 1, pan: 0, muted: false, soloed: false,
          sends: { reverb: 0, delay: 0 },
          stretchRatio: "1.5",
        },
      ],
    });
    const restored = parseProject(corruptJson);
    expect(restored.audioTracks).toHaveLength(1);
    expect(restored.audioTracks![0].id).toBe("audiotrack:ok");
  });
});

// ─── Tests: AudioEngine Integration ───────────────────────────────────────────

describe("v3.52.0 – AudioEngine Routing & Rate", () => {
  beforeEach(async () => {
    vi.resetModules();
    __createdSources.length = 0;
    __createdWorklets.length = 0;
    rafCallbacks.clear();
    rafCounter = 1;
    const mod = await import("../../client/src/audio/AudioEngine");
    AudioEngine = mod.AudioEngine;
    await AudioEngine.init();
  });

  it("pitchLocked=true UND syncMode='free' → Worklet-Pfad (statt BufferSource)", async () => {
    const id = "audiotrack:s-locked";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "free",
      pitchLocked: true,
      stretchRatio: 1.5,
    }));
    const sourcesBefore = __createdSources.length;
    const workletsBefore = __createdWorklets.length;
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    expect(__createdSources.length).toBe(sourcesBefore); // kein BufferSource
    expect(__createdWorklets.length).toBe(workletsBefore + 1); // Worklet erzeugt

    const node = __createdWorklets[__createdWorklets.length - 1];
    expect(node.__processorName).toBe("time-stretch-processor");
    // stretch-Param ≈ 1.5 (kein BPM-Sync da syncMode=free)
    const p = node.parameters.get("stretch")!;
    expect(p.value).toBeCloseTo(1.5, 5);

    AudioEngine.disposeAudioTrack(id);
  });

  it("pitchLocked=false + syncMode='stretch' + stretchRatio=2 → BufferSource mit kombinierter Rate", async () => {
    const id = "audiotrack:s-combo";
    await loadFakeBuffer(id, 5);
    AudioEngine.setBpm(140);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "stretch",
      originalBpm: 140, // BPM-Rate = 1.0
      stretchRatio: 2.0, // manueller Faktor
      pitchLocked: false,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    // BufferSource wurde benutzt
    expect(__createdSources.length).toBeGreaterThan(0);
    const src = __createdSources[__createdSources.length - 1];
    // effektive Rate = 1.0 (BPM) × 2.0 (stretch) = 2.0
    expect(src.playbackRate!.value).toBeCloseTo(2.0, 5);

    AudioEngine.disposeAudioTrack(id);
  });

  it("setBpm aktualisiert die kombinierte Rate live (BPM × stretchRatio)", async () => {
    const id = "audiotrack:s-bpm-live";
    await loadFakeBuffer(id, 5);
    AudioEngine.setBpm(120);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "stretch",
      originalBpm: 120,
      stretchRatio: 0.5,
      pitchLocked: false,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const src = __createdSources[__createdSources.length - 1];
    // Initial: bpm 120, orig 120, ratio 0.5 → 0.5
    expect(src.playbackRate!.value).toBeCloseTo(0.5, 5);

    AudioEngine.setBpm(180);
    // Neue: bpm 180/120 × 0.5 = 0.75
    expect(src.playbackRate!.value).toBeCloseTo(0.75, 5);

    AudioEngine.disposeAudioTrack(id);
  });
});
