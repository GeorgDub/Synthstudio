/**
 * tests/features/audio-track-timestretch.test.ts
 *
 * Unit-Tests für FOLLOWUP-102 / A: Pitch-preserving Audio-Track Stretch via
 * AudioWorklet (v1.19.0).
 *
 * Erweitert das bestehende audio-track.test.ts Pattern um Worklet-Mocks
 * (MockAudioWorkletNode + MockAudioParam mit setValueAtTime-Spy).
 *
 * Coverage (Pflicht-Tests):
 *  1. syncMode==="timestretch" triggert Worklet statt BufferSource
 *  2. Stretch-Param wird auf bpm/originalBpm gesetzt
 *  3. setBpm während Worklet running → setValueAtTime aktualisiert Param
 *  4. seekAudioTrack sendet port.postMessage({type:"seek",...})
 *  5. stopAudioTrack disconnected Worklet + cleant Map
 *  6. disposeAudioTrack cleant Worklet (auch wenn nicht aktiv)
 *  7. isValidTrack akzeptiert "timestretch"
 *  8. Regression: bestehende "stretch"/"free" Pfade benutzen weiter BufferSource
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Globale Stubs vor Import der Engine ─────────────────────────────────────

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
  // Bind setValueAtTime to mutate own .value:
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
  __startArgs?: number[];
  __isSource?: boolean;
}

function makeBaseNode(): MockNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

const __createdSources: MockNode[] = [];

// ─── Mock AudioWorkletNode ────────────────────────────────────────────────────
//
// Globaler Sammler für Worklet-Instanzen + Test-Helper.

interface MockWorkletPort {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent) => void) | null;
  __triggerMessage: (data: unknown) => void;
}

interface MockAudioWorkletNode {
  port: MockWorkletPort;
  parameters: Map<string, MockParam>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  __nodeType: "AudioWorkletNode";
  __processorName: string;
  __outputChannelCount: number[] | null;
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
    return { ...makeBaseNode(), gain: makeParam(1) };
  }
  createStereoPanner(): MockNode {
    return { ...makeBaseNode(), pan: makeParam(0) };
  }
  createBiquadFilter(): MockNode {
    return {
      ...makeBaseNode(),
      type: "lowpass",
      frequency: makeParam(8000),
      Q: makeParam(1),
      gain: makeParam(0),
    };
  }
  createWaveShaper(): MockNode {
    return { ...makeBaseNode(), curve: null, oversample: "4x" };
  }
  createDynamicsCompressor(): MockNode {
    return {
      ...makeBaseNode(),
      threshold: makeParam(-24),
      ratio: makeParam(4),
      attack: makeParam(0.003),
      release: makeParam(0.25),
      reduction: 0,
    };
  }
  createDelay(): MockNode {
    return { ...makeBaseNode(), delayTime: makeParam(0.25) };
  }
  createConvolver(): MockNode {
    return { ...makeBaseNode(), buffer: null };
  }
  createAnalyser(): MockNode {
    return {
      ...makeBaseNode(),
      // @ts-expect-error mock-only
      fftSize: 512,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: vi.fn(),
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
      playbackRate: makeParam(1),
      start(when = 0, offset = 0) {
        this.__started = true;
        this.__startArgs = [when, offset];
      },
      stop() {
        this.__stopped = true;
      },
    };
    __createdSources.push(src);
    return src;
  }
  createOscillator(): MockNode {
    return {
      ...makeBaseNode(),
      type: "sine",
      frequency: makeParam(440),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
}

// Constructor-Stub: `new AudioWorkletNode(ctx, name, options?)`
function MockAudioWorkletNodeCtor(
  this: MockAudioWorkletNode,
  _ctx: unknown,
  name: string,
  options?: { outputChannelCount?: number[] },
) {
  // Wir simulieren Parameter-Map mit "stretch".
  const params = new Map<string, MockParam>();
  params.set("stretch", makeParam(1.0));
  const portListeners: Array<(e: MessageEvent) => void> = [];
  const port: MockWorkletPort = {
    postMessage: vi.fn(),
    onmessage: null,
    __triggerMessage(data: unknown) {
      // Hilfe für Tests: ruft sowohl onmessage als auch addEventListener-Listener.
      const evt = { data } as MessageEvent;
      if (port.onmessage) {
        try { port.onmessage(evt); } catch { /* ignore */ }
      }
      for (const l of portListeners) {
        try { l(evt); } catch { /* ignore */ }
      }
    },
  };
  this.port = port;
  this.parameters = params;
  this.connect = vi.fn();
  this.disconnect = vi.fn();
  this.__nodeType = "AudioWorkletNode";
  this.__processorName = name;
  this.__outputChannelCount = options?.outputChannelCount ?? null;
  __createdWorklets.push(this);
  return this;
}

// rAF/cAF: kontrollierbar.
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
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {};
}

// ─── Dynamischer Import nach Mock-Setup ──────────────────────────────────────

import type { AudioTrackChannelData } from "../../client/src/audio/AudioEngine";

let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrackData(overrides: Partial<AudioTrackChannelData> = {}): AudioTrackChannelData {
  return {
    id: overrides.id ?? "audiotrack:ts-1",
    name: "Vocal",
    filePath: "/fake/path/vocal.wav",
    fileName: "vocal.wav",
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

async function loadFakeBuffer(id: string, durationSec = 10, channels = 2): Promise<void> {
  const fakeFile = { arrayBuffer: async () => new ArrayBuffer(1024) } as unknown as File;
  const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
  ctx.decodeAudioData = vi.fn().mockResolvedValue(
    new MockAudioBuffer(channels, Math.round(durationSec * 44100), 44100),
  );
  await AudioEngine.loadAudioTrack(id, fakeFile);
}

/**
 * Wartet einen Microtask-Tick, damit awaited Promises in playAudioTrack
 * (für "timestretch": _ensureWorklets) durchlaufen.
 */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TimeStretch: routing via AudioWorklet", () => {
  it("syncMode='timestretch' triggert _playAudioTrackViaWorklet statt BufferSource", async () => {
    const id = "audiotrack:ts-route";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));

    const sourcesBefore = __createdSources.length;
    const workletsBefore = __createdWorklets.length;

    AudioEngine.playAudioTrack(id);
    await flushPromises();

    expect(__createdSources.length).toBe(sourcesBefore); // KEIN BufferSource
    expect(__createdWorklets.length).toBe(workletsBefore + 1); // Worklet erzeugt

    const node = __createdWorklets[__createdWorklets.length - 1];
    expect(node.__processorName).toBe("time-stretch-processor");
    expect(node.__outputChannelCount).toEqual([2]);

    // setBuffer + setLoop wurden via postMessage gesendet.
    const calls = node.port.postMessage.mock.calls.map(c => c[0]);
    const hasSetBuffer = calls.some(
      (m) => (m as { type?: string }).type === "setBuffer",
    );
    const hasSetLoop = calls.some(
      (m) => (m as { type?: string }).type === "setLoop",
    );
    expect(hasSetBuffer).toBe(true);
    expect(hasSetLoop).toBe(true);

    // Routing: node.connect wurde aufgerufen (zum channelNodes.input).
    expect(node.connect).toHaveBeenCalled();

    AudioEngine.disposeAudioTrack(id);
  });

  it("setzt stretch-Param auf bpm/originalBpm beim Start", async () => {
    const id = "audiotrack:ts-ratio";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));
    AudioEngine.setBpm(150);
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const node = __createdWorklets[__createdWorklets.length - 1];
    const p = node.parameters.get("stretch")!;
    expect(p.value).toBeCloseTo(150 / 120, 5);
    expect(p.setValueAtTime).toHaveBeenCalled();

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("TimeStretch: setBpm aktualisiert stretch-Param live", () => {
  it("setBpm während Worklet running → setValueAtTime aktualisiert Param", async () => {
    const id = "audiotrack:ts-bpm-live";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));
    AudioEngine.setBpm(120);
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const node = __createdWorklets[__createdWorklets.length - 1];
    const p = node.parameters.get("stretch")!;
    const initialSetCalls = p.setValueAtTime.mock.calls.length;

    AudioEngine.setBpm(180);
    expect(p.setValueAtTime.mock.calls.length).toBeGreaterThan(initialSetCalls);
    expect(p.value).toBeCloseTo(180 / 120, 5);

    AudioEngine.setBpm(60);
    expect(p.value).toBeCloseTo(60 / 120, 5);

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("TimeStretch: seekAudioTrack", () => {
  it("sendet port.postMessage({type:'seek',samplePos:...}) statt Re-Create", async () => {
    const id = "audiotrack:ts-seek";
    await loadFakeBuffer(id, 10);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const node = __createdWorklets[__createdWorklets.length - 1];
    const workletsBefore = __createdWorklets.length;
    node.port.postMessage.mockClear();

    AudioEngine.seekAudioTrack(id, 3.5);

    // KEIN neuer Worklet erzeugt (in-place seek).
    expect(__createdWorklets.length).toBe(workletsBefore);
    // postMessage mit type:"seek" wurde gesendet.
    const seekCall = node.port.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === "seek",
    );
    expect(seekCall).toBeDefined();
    const payload = seekCall![0] as { samplePos: number };
    expect(payload.samplePos).toBe(Math.floor(3.5 * 44100));

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("TimeStretch: stopAudioTrack", () => {
  it("disconnected Worklet + cleant audioTrackWorkletNodes Map", async () => {
    const id = "audiotrack:ts-stop";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const node = __createdWorklets[__createdWorklets.length - 1];

    AudioEngine.stopAudioTrack(id);
    expect(node.disconnect).toHaveBeenCalled();

    // Re-Stopp ist no-op (kein Throw).
    expect(() => AudioEngine.stopAudioTrack(id)).not.toThrow();

    // Nach Stop ist keine erneute Param-Update aktiv (setBpm muss harmlos sein).
    expect(() => AudioEngine.setBpm(99)).not.toThrow();

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("TimeStretch: disposeAudioTrack räumt auch ungestarteten Worklet auf", () => {
  it("dispose ohne play wirft nicht (Worklet-Map leer → no-op)", async () => {
    const id = "audiotrack:ts-dispose-cold";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));
    expect(() => AudioEngine.disposeAudioTrack(id)).not.toThrow();
  });

  it("dispose nach play cleant Worklet + Position-Map", async () => {
    const id = "audiotrack:ts-dispose-hot";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const node = __createdWorklets[__createdWorklets.length - 1];

    AudioEngine.disposeAudioTrack(id);
    expect(node.disconnect).toHaveBeenCalled();
    // setBpm darf nicht mehr in den disposed-Node greifen.
    expect(() => AudioEngine.setBpm(140)).not.toThrow();
  });
});

describe("TimeStretch: Position-Tracking via postMessage", () => {
  it("port-Message {type:'position'} füllt audioTrackWorkletPositions und Playhead-Callback liefert Sekunden", async () => {
    const id = "audiotrack:ts-pos";
    await loadFakeBuffer(id, 10);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "timestretch",
      originalBpm: 120,
    }));

    const cb = vi.fn();
    AudioEngine.onAudioTrackPosition(id, cb);

    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const node = __createdWorklets[__createdWorklets.length - 1];

    // Simuliere Position-Report vom Worklet.
    node.port.__triggerMessage({ type: "position", samplePos: 44100 * 2 });

    // rAF-Tick triggern.
    const firstRaf = rafCallbacks.values().next().value;
    if (firstRaf) firstRaf(0);

    expect(cb).toHaveBeenCalled();
    const last = cb.mock.calls[cb.mock.calls.length - 1];
    // last = [pos01, sec]
    expect(last[1]).toBeCloseTo(2, 3);

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("TimeStretch: Regression — bestehende syncModes nutzen weiter BufferSource", () => {
  it("syncMode='stretch' bleibt auf AudioBufferSourceNode (kein Worklet)", async () => {
    const id = "audiotrack:reg-stretch";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "stretch",
      originalBpm: 120,
    }));
    const sourcesBefore = __createdSources.length;
    const workletsBefore = __createdWorklets.length;

    AudioEngine.setBpm(140);
    AudioEngine.playAudioTrack(id);

    // KEIN Worklet erzeugt.
    expect(__createdWorklets.length).toBe(workletsBefore);
    // Genau eine neue BufferSource.
    expect(__createdSources.length).toBe(sourcesBefore + 1);
    const src = __createdSources[__createdSources.length - 1];
    expect(src.playbackRate?.value).toBeCloseTo(140 / 120, 5);

    AudioEngine.disposeAudioTrack(id);
  });

  it("syncMode='free' bleibt auf AudioBufferSourceNode mit playbackRate=1", async () => {
    const id = "audiotrack:reg-free";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "free",
      originalBpm: 120,
    }));
    const workletsBefore = __createdWorklets.length;

    AudioEngine.setBpm(140);
    AudioEngine.playAudioTrack(id);

    expect(__createdWorklets.length).toBe(workletsBefore);
    const src = __createdSources[__createdSources.length - 1];
    expect(src.playbackRate?.value).toBe(1);

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("TimeStretch: Store-Validation akzeptiert 'timestretch'", () => {
  it("isValidTrack via loadAudioTracks akzeptiert syncMode='timestretch'", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const { loadAudioTracks, getAllAudioTracks, __resetForTests, countTimestretchTracks } = mod;
    __resetForTests();

    const valid: AudioTrackChannelData[] = [
      {
        id: "audiotrack:val-ts",
        name: "Vocal",
        filePath: "/p/vocal.wav",
        fileName: "vocal.wav",
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
        syncMode: "timestretch",
        originalBpm: 120,
      },
      {
        id: "audiotrack:val-stretch",
        name: "Drum-Loop",
        filePath: "/p/loop.wav",
        fileName: "loop.wav",
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
        syncMode: "stretch",
        originalBpm: 100,
      },
    ];
    loadAudioTracks(valid);
    expect(getAllAudioTracks()).toHaveLength(2);
    expect(countTimestretchTracks()).toBe(1);
  });

  it("isValidTrack lehnt ungültigen syncMode ab", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const { loadAudioTracks, getAllAudioTracks, __resetForTests } = mod;
    __resetForTests();

    const partlyInvalid: AudioTrackChannelData[] = [
      // valider Eintrag
      {
        id: "audiotrack:ok",
        name: "OK",
        filePath: "/p/ok.wav",
        fileName: "ok.wav",
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
        syncMode: "free",
        originalBpm: null,
      } as AudioTrackChannelData,
      // ungültig (bogus syncMode)
      {
        id: "audiotrack:bad",
        name: "Bad",
        filePath: "/p/bad.wav",
        fileName: "bad.wav",
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
        syncMode: "bogus" as unknown as "free",
        originalBpm: null,
      } as AudioTrackChannelData,
    ];
    loadAudioTracks(partlyInvalid);
    // Nur der valide Eintrag wird übernommen.
    const all = getAllAudioTracks();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("audiotrack:ok");
  });
});

describe("TimeStretch: MAX_TIMESTRETCH_TRACKS Konstante", () => {
  it("countTimestretchTracks zählt korrekt", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const {
      addAudioTrack,
      countTimestretchTracks,
      __resetForTests,
      MAX_TIMESTRETCH_TRACKS,
    } = mod;
    __resetForTests();
    expect(MAX_TIMESTRETCH_TRACKS).toBe(4);

    addAudioTrack({
      name: "A",
      filePath: "/p/a.wav",
      fileName: "a.wav",
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      sends: { reverb: 0, delay: 0 },
      syncMode: "timestretch",
      originalBpm: 120,
    });
    addAudioTrack({
      name: "B",
      filePath: "/p/b.wav",
      fileName: "b.wav",
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      sends: { reverb: 0, delay: 0 },
      syncMode: "free",
      originalBpm: null,
    });
    addAudioTrack({
      name: "C",
      filePath: "/p/c.wav",
      fileName: "c.wav",
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      sends: { reverb: 0, delay: 0 },
      syncMode: "timestretch",
      originalBpm: 100,
    });
    expect(countTimestretchTracks()).toBe(2);
  });
});

describe("TimeStretch: isTimestretchLimitReached helper (TASK-121)", () => {
  /** Adds N tracks with given syncMode, returns their IDs. */
  async function addTracksWithMode(
    count: number,
    syncMode: "free" | "stretch" | "timestretch",
  ): Promise<string[]> {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const { addAudioTrack } = mod;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        addAudioTrack({
          name: `T-${syncMode}-${i}`,
          filePath: `/p/${syncMode}-${i}.wav`,
          fileName: `${syncMode}-${i}.wav`,
          volume: 1,
          pan: 0,
          muted: false,
          soloed: false,
          sends: { reverb: 0, delay: 0 },
          syncMode,
          originalBpm: syncMode === "free" ? null : 120,
        }),
      );
    }
    return ids;
  }

  it("returns false bei 0 timestretch-Tracks", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const { isTimestretchLimitReached, __resetForTests } = mod;
    __resetForTests();
    expect(isTimestretchLimitReached()).toBe(false);
  });

  it("returns false bei 3 timestretch-Tracks (Limit=4)", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const { isTimestretchLimitReached, __resetForTests, MAX_TIMESTRETCH_TRACKS } = mod;
    __resetForTests();
    await addTracksWithMode(3, "timestretch");
    expect(MAX_TIMESTRETCH_TRACKS).toBe(4);
    expect(isTimestretchLimitReached()).toBe(false);
  });

  it("returns true wenn 4 timestretch-Tracks aktiv sind (Limit erreicht)", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const { isTimestretchLimitReached, __resetForTests, countTimestretchTracks } = mod;
    __resetForTests();
    await addTracksWithMode(4, "timestretch");
    expect(countTimestretchTracks()).toBe(4);
    expect(isTimestretchLimitReached()).toBe(true);
  });

  it("ignoriert non-timestretch Tracks beim Limit-Check", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const { isTimestretchLimitReached, __resetForTests } = mod;
    __resetForTests();
    await addTracksWithMode(3, "timestretch");
    await addTracksWithMode(2, "free");
    // Insgesamt 5 Tracks, aber nur 3 timestretch → noch nicht am Limit.
    expect(isTimestretchLimitReached()).toBe(false);
  });

  it("reagiert auf updateAudioTrack syncMode-Wechsel (3 ts → patch eines free auf ts ⇒ Limit)", async () => {
    const mod = await import("../../client/src/store/useAudioTrackStore");
    const {
      isTimestretchLimitReached,
      __resetForTests,
      updateAudioTrack,
    } = mod;
    __resetForTests();
    await addTracksWithMode(3, "timestretch");
    const freeIds = await addTracksWithMode(1, "free");
    expect(isTimestretchLimitReached()).toBe(false);

    updateAudioTrack(freeIds[0], { syncMode: "timestretch" });
    expect(isTimestretchLimitReached()).toBe(true);
  });
});
