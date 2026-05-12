/**
 * tests/features/solo-cross-store.test.ts
 *
 * FOLLOWUP-102 / B — Solo Cross-Store Unifikation (v1.19.0).
 *
 * Verifiziert dass Drum-Solo und Audio-Track-Solo cross-type wirken:
 *  - Drum-Part-Solo macht alle nicht-soloed Audio-Tracks stumm.
 *  - Audio-Track-Solo macht alle nicht-soloed Drum-Parts stumm
 *    (via Scheduler-Skip in _scheduleStep).
 *  - drumSoloFlagGetter ist optional — null = Legacy-Verhalten
 *    (audio-track-internes Solo wirkt isoliert wie in v1.16.x).
 *  - Regression: existierendes setAudioTrackSolo-Verhalten bleibt korrekt.
 *
 * Pattern: nutzt vi.resetModules() + Mock-AudioContext analog zu
 *          tests/features/audio-track.test.ts. Web Audio API ist im
 *          Node-Testumfeld nicht verfuegbar, daher Global-Stubs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Globale Stubs vor Import der Engine ─────────────────────────────────────

interface MockParam {
  value: number;
  setValueAtTime: (v: number, _t: number) => void;
  setTargetAtTime: (v: number, _t: number, _c: number) => void;
  linearRampToValueAtTime: (v: number, _t: number) => void;
  cancelScheduledValues: (_t: number) => void;
}

function makeParam(initial = 0): MockParam {
  return {
    value: initial,
    setValueAtTime(v: number) { this.value = v; },
    setTargetAtTime(v: number) { this.value = v; },
    linearRampToValueAtTime(v: number) { this.value = v; },
    cancelScheduledValues() { /* no-op */ },
  };
}

interface MockNode {
  connect: (n?: unknown) => void;
  disconnect: () => void;
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
  __isSource?: boolean;
}

function makeBaseNode(): MockNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
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
    return {
      ...makeBaseNode(),
      type: "lowpass",
      frequency: makeParam(8000),
      Q: makeParam(1),
      gain: makeParam(0),
    };
  }
  createWaveShaper(): MockNode { return { ...makeBaseNode(), curve: null, oversample: "4x" }; }
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
  createDelay(): MockNode { return { ...makeBaseNode(), delayTime: makeParam(0.25) }; }
  createConvolver(): MockNode { return { ...makeBaseNode(), buffer: null }; }
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
      onended: null,
      buffer: null,
      loop: false,
      playbackRate: makeParam(1),
      start: vi.fn(),
      stop: vi.fn(),
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
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {};
}

// ─── Dynamischer Import nach Mock-Setup ──────────────────────────────────────
import type {
  AudioTrackChannelData,
  ChannelFx,
  PartData,
  PatternData,
  ScheduledStep,
  StepData,
} from "../../client/src/audio/AudioEngine";

let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;
let DEFAULT_CHANNEL_FX: ChannelFx;

beforeEach(async () => {
  vi.resetModules();
  __createdSources.length = 0;
  rafCallbacks.clear();
  rafCounter = 1;
  const mod = await import("../../client/src/audio/AudioEngine");
  AudioEngine = mod.AudioEngine;
  DEFAULT_CHANNEL_FX = mod.DEFAULT_CHANNEL_FX;
  await AudioEngine.init();
});

// ─── Helper ───────────────────────────────────────────────────────────────

function makeTrackData(overrides: Partial<AudioTrackChannelData> = {}): AudioTrackChannelData {
  return {
    id: overrides.id ?? "audiotrack:cross-1",
    name: "Test Track",
    filePath: "/fake/path.wav",
    fileName: "path.wav",
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
  const fakeFile = {
    arrayBuffer: async () => new ArrayBuffer(1024),
  } as unknown as File;
  const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
  ctx.decodeAudioData = vi.fn().mockResolvedValue(
    new MockAudioBuffer(2, Math.round(durationSec * 44100), 44100),
  );
  await AudioEngine.loadAudioTrack(id, fakeFile);
}

function makeStep(active = true, velocity = 100): StepData {
  return { active, velocity };
}

function makePart(id: string, opts: Partial<PartData> = {}): PartData {
  return {
    id,
    name: opts.name ?? `Part ${id}`,
    muted: false,
    soloed: false,
    volume: 1.0,
    pan: 0,
    steps: Array.from({ length: 16 }, () => makeStep(true, 100)),
    fx: { ...DEFAULT_CHANNEL_FX },
    ...opts,
  };
}

function makePattern(parts: PartData[]): PatternData {
  return {
    id: "pat-1",
    name: "Test Pattern",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: null,
    parts,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("Solo Cross-Store: _reapplyAudioTrackSoloMutes — Legacy (kein drumSoloFlagGetter)", () => {
  it("Test 1: drumSoloFlagGetter === null verhaelt sich wie vor v1.19 (nur audio-solo wirkt)", async () => {
    const idA = "audiotrack:legacy-A";
    const idB = "audiotrack:legacy-B";
    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id: idA, volume: 0.5 }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB, volume: 0.8 }));

    // Default-State: kein Drum-Solo-Getter, kein Audio-Solo aktiv.
    // notifyDrumSoloChanged() darf keinen Track stumm schalten.
    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.notifyDrumSoloChanged();
    // Beide Tracks bleiben auf ihren regulaeren Volume-Werten.
    const aSet = spy.mock.calls.find(c => c[0] === idA && c[1] === 0.5);
    const bSet = spy.mock.calls.find(c => c[0] === idB && c[1] === 0.8);
    expect(aSet).toBeDefined();
    expect(bSet).toBeDefined();
    // Niemand wurde auf 0 gesetzt.
    const anyMuted = spy.mock.calls.some(c => (c[0] === idA || c[0] === idB) && c[1] === 0);
    expect(anyMuted).toBe(false);

    spy.mockRestore();
    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
  });
});

describe("Solo Cross-Store: setDrumSoloFlagGetter + notifyDrumSoloChanged", () => {
  it("Test 2: aktiver Drum-Solo-Getter (true) + notifyDrumSoloChanged → alle nicht-soloed Audio-Tracks auf 0", async () => {
    const idA = "audiotrack:drum-trigger-A";
    const idB = "audiotrack:drum-trigger-B";
    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id: idA, volume: 0.7 }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB, volume: 0.4 }));

    // Drum-Solo aktiv (irgendwo, z.B. Snare) → beide Audio-Tracks stumm.
    AudioEngine.setDrumSoloFlagGetter(() => true);

    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.notifyDrumSoloChanged();

    const aMuted = spy.mock.calls.find(c => c[0] === idA && c[1] === 0);
    const bMuted = spy.mock.calls.find(c => c[0] === idB && c[1] === 0);
    expect(aMuted).toBeDefined();
    expect(bMuted).toBeDefined();

    spy.mockRestore();
    AudioEngine.setDrumSoloFlagGetter(null);
    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
  });

  it("Test 3: Drum-Solo aktiv + ein Audio-Track soloed → Track toent, andere muted", async () => {
    const idA = "audiotrack:mixed-A";
    const idB = "audiotrack:mixed-B";
    const idC = "audiotrack:mixed-C";
    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    await loadFakeBuffer(idC, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id: idA, volume: 0.5 }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB, volume: 0.6 }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idC, volume: 0.9 }));

    // Drum-Solo aktiv.
    AudioEngine.setDrumSoloFlagGetter(() => true);
    // Audio-Track B explizit soloed.
    AudioEngine.setAudioTrackSolo(idB, true);

    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.notifyDrumSoloChanged();

    // B soll auf 0.6 (sein volume) bleiben, A + C auf 0.
    const aMuted = spy.mock.calls.find(c => c[0] === idA && c[1] === 0);
    const cMuted = spy.mock.calls.find(c => c[0] === idC && c[1] === 0);
    const bOn = spy.mock.calls.find(c => c[0] === idB && c[1] === 0.6);
    expect(aMuted).toBeDefined();
    expect(cMuted).toBeDefined();
    expect(bOn).toBeDefined();

    spy.mockRestore();
    AudioEngine.setDrumSoloFlagGetter(null);
    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
    AudioEngine.disposeAudioTrack(idC);
  });

  it("Test 4: Drum-Solo aus + Audio-Solo aus → alle Volumes regulaer (kein 0-Mute)", async () => {
    const idA = "audiotrack:clear-A";
    const idB = "audiotrack:clear-B";
    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id: idA, volume: 0.5 }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB, volume: 0.7 }));

    // Drum-Getter liefert false (nichts soloed).
    AudioEngine.setDrumSoloFlagGetter(() => false);

    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.notifyDrumSoloChanged();

    const aOn = spy.mock.calls.find(c => c[0] === idA && c[1] === 0.5);
    const bOn = spy.mock.calls.find(c => c[0] === idB && c[1] === 0.7);
    expect(aOn).toBeDefined();
    expect(bOn).toBeDefined();
    const anyMuted = spy.mock.calls.some(c => (c[0] === idA || c[0] === idB) && c[1] === 0);
    expect(anyMuted).toBe(false);

    spy.mockRestore();
    AudioEngine.setDrumSoloFlagGetter(null);
    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
  });
});

describe("Solo Cross-Store: Scheduler-Loop Cross-Mute (Audio-Solo blockt Drum-Steps)", () => {
  it("Test 5: Part X non-soloed + Audio-Track soloed → stepCallback feuert NICHT fuer Part X", () => {
    // Pattern mit 2 Parts, beide aktive Steps.
    const partA = makePart("part-A");
    const partB = makePart("part-B");
    const pattern = makePattern([partA, partB]);

    // Audio-Track als Getter mit soloed=true bereitstellen.
    const audioTrack = makeTrackData({ id: "audiotrack:scheduler-1", soloed: true });
    AudioEngine.setAudioTracksGetter(() => [audioTrack]);

    // Sammelt alle gefeuerten ScheduledSteps.
    const fired: ScheduledStep[] = [];
    AudioEngine.onStep((s) => fired.push(s));

    // Direkter Aufruf von _scheduleStep ueber Type-Cast (Test-Only-Access).
    // Wir geben scheduledPattern explizit mit, damit kein patternGetter benoetigt wird.
    const engineAny = AudioEngine as unknown as {
      _scheduleStep: (stepIndex: number, time: number, scheduledPattern?: PatternData) => void;
    };
    engineAny._scheduleStep(0, 0, pattern);

    // Keiner der Drum-Parts ist soloed, aber Audio-Track ist soloed →
    // anySolo=true im Scheduler → kein Step-Callback feuert.
    expect(fired.length).toBe(0);

    AudioEngine.setAudioTracksGetter(() => []);
  });

  it("Test 5b: Part X non-soloed + Audio-Track NICHT soloed → stepCallback feuert normal", () => {
    const partA = makePart("part-A");
    const partB = makePart("part-B");
    const pattern = makePattern([partA, partB]);

    // Audio-Tracks ohne Solo.
    AudioEngine.setAudioTracksGetter(() => [
      makeTrackData({ id: "audiotrack:scheduler-2", soloed: false }),
    ]);

    const fired: ScheduledStep[] = [];
    AudioEngine.onStep((s) => fired.push(s));

    const engineAny = AudioEngine as unknown as {
      _scheduleStep: (stepIndex: number, time: number, scheduledPattern?: PatternData) => void;
    };
    engineAny._scheduleStep(0, 0, pattern);

    // Beide Parts duerfen feuern.
    expect(fired.length).toBe(2);
    expect(fired.map(f => f.partIndex).sort()).toEqual([0, 1]);

    AudioEngine.setAudioTracksGetter(() => []);
  });

  it("Test 5c: Drum-Solo aktiv + Audio-Track NICHT soloed → nur soloed Drum-Part feuert", () => {
    const partA = makePart("part-A", { soloed: true });
    const partB = makePart("part-B", { soloed: false });
    const pattern = makePattern([partA, partB]);

    AudioEngine.setAudioTracksGetter(() => []);
    const fired: ScheduledStep[] = [];
    AudioEngine.onStep((s) => fired.push(s));

    const engineAny = AudioEngine as unknown as {
      _scheduleStep: (stepIndex: number, time: number, scheduledPattern?: PatternData) => void;
    };
    engineAny._scheduleStep(0, 0, pattern);

    expect(fired.length).toBe(1);
    expect(fired[0].partIndex).toBe(0);
  });
});

describe("Solo Cross-Store: Regression — existing setAudioTrackSolo bleibt grün", () => {
  it("Test 6: setAudioTrackSolo schaltet andere Audio-Tracks stumm (unveraendert)", async () => {
    const idA = "audiotrack:reg-A";
    const idB = "audiotrack:reg-B";
    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id: idA, volume: 0.5 }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB, volume: 0.8 }));

    // Kein Drum-Solo-Getter gesetzt.
    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.setAudioTrackSolo(idA, true);

    const bMuted = spy.mock.calls.find(c => c[0] === idB && c[1] === 0);
    const aOn = spy.mock.calls.find(c => c[0] === idA && c[1] === 0.5);
    expect(bMuted).toBeDefined();
    expect(aOn).toBeDefined();

    spy.mockRestore();
    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
  });
});
