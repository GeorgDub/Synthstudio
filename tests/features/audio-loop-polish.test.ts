/**
 * tests/features/audio-loop-polish.test.ts (v3.71.0)
 *
 * Unit-Tests für v3.71.0 — Loop-Drag-Throttle (RAF) + Worklet Loop-Range
 * + Live-Loop-Edit. Closes v3.70-Caveats:
 *  1. "Loop-Drag dispatched JEDEN move-Frame → setTrackLoopPoints flooded"
 *  2. "Worklet-Pfad ignoriert Loop-Range (pitchLocked=true bypasses loop)"
 *  3. "AudioBufferSourceNode.loop* read-only nach start() → Stop+Restart"
 *
 * Strategien:
 *  - RAF-Throttle: testen via Mock-rAF, verifizieren dass mehrere
 *    scheduleLoopUpdate-Calls im selben Frame nur EINEN flush triggern,
 *    aber den NEUESTEN Wert ausliefern.
 *  - Worklet Loop-Range: AudioEngine.playAudioTrack mit pitchLocked=true
 *    + loopEnabled+range muss port.postMessage({type:"setLoop", loopStart,
 *    loopEnd}) senden.
 *  - Live-Edit Worklet: setAudioTrackLoopPoints schickt postMessage ohne
 *    Stop+Restart.
 *  - Live-Edit BufferSource: setAudioTrackLoopPoints stoppt alte Source +
 *    erzeugt neue mit Range. Position bleibt erhalten falls innerhalb der
 *    neuen Range, sonst restart bei loopStart.
 *
 * Insgesamt 12 Tests in 4 describes.
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
  setTargetAtTime: (v: number, _t: number, _c: number) => void;
  linearRampToValueAtTime: (v: number, _t: number) => void;
  cancelScheduledValues: (_t: number) => void;
}

function makeParam(initial = 0): MockParam {
  const p: MockParam = {
    value: initial,
    setValueAtTime: vi.fn(function (this: MockParam, v: number) { this.value = v; }),
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
  __startArgs?: number[];
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
    return { ...makeBaseNode(), threshold: makeParam(-24), ratio: makeParam(4), attack: makeParam(0.003), release: makeParam(0.25), reduction: 0 };
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

// rAF-Mock — manuell tickbar.
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

function tickRaf(): void {
  const pending = Array.from(rafCallbacks.entries());
  rafCallbacks.clear();
  for (const [, cb] of pending) {
    try { cb(performance.now ? performance.now() : Date.now()); } catch { /* ignore */ }
  }
}

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

// ─── Tests: RAF-Throttle (pure scheduler-Logik) ──────────────────────────────

describe("v3.71.0 – Loop-Drag RAF-Throttle (Scheduler-Logik)", () => {
  beforeEach(() => {
    rafCallbacks.clear();
    rafCounter = 1;
  });

  /**
   * Wir simulieren die in ZoomableWaveform implementierte Throttle-Logik:
   * pendingRef speichert latest value, scheduleUpdate() reused den RAF wenn
   * bereits einer pending ist.
   */
  function makeThrottle(onFlush: (v: { loopStart: number; loopEnd: number }) => void) {
    let pending: { loopStart: number; loopEnd: number } | null = null;
    let pendingRaf: number | null = null;

    const flush = () => {
      pendingRaf = null;
      const next = pending;
      pending = null;
      if (next) onFlush(next);
    };

    const schedule = (next: { loopStart: number; loopEnd: number }) => {
      pending = next;
      if (pendingRaf !== null) return;
      pendingRaf = requestAnimationFrame(flush);
    };

    const cancel = () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
        pendingRaf = null;
      }
    };

    return { schedule, cancel, get pendingRaf() { return pendingRaf; } };
  }

  it("RAF-Throttle batched mehrere scheduleUpdate-Calls auf EINEN flush", () => {
    const onFlush = vi.fn();
    const t = makeThrottle(onFlush);
    t.schedule({ loopStart: 100, loopEnd: 500 });
    t.schedule({ loopStart: 110, loopEnd: 500 });
    t.schedule({ loopStart: 120, loopEnd: 500 });
    // Vor rAF-Tick: noch kein flush.
    expect(onFlush).toHaveBeenCalledTimes(0);
    expect(t.pendingRaf).not.toBeNull();
    tickRaf();
    // Genau EIN flush — mit dem ALLERLETZTEN Wert.
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ loopStart: 120, loopEnd: 500 });
  });

  it("RAF-Throttle nach flush ist wieder bereit für nächsten Schedule (mehrere Frames)", () => {
    const onFlush = vi.fn();
    const t = makeThrottle(onFlush);
    t.schedule({ loopStart: 100, loopEnd: 500 });
    tickRaf();
    expect(onFlush).toHaveBeenCalledTimes(1);
    // Neuer Drag-Move-Cycle.
    t.schedule({ loopStart: 200, loopEnd: 600 });
    t.schedule({ loopStart: 210, loopEnd: 600 });
    tickRaf();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith({ loopStart: 210, loopEnd: 600 });
  });

  it("RAF-Throttle cancel() verhindert flush bei drop+cleanup", () => {
    const onFlush = vi.fn();
    const t = makeThrottle(onFlush);
    t.schedule({ loopStart: 100, loopEnd: 500 });
    expect(t.pendingRaf).not.toBeNull();
    t.cancel();
    expect(t.pendingRaf).toBeNull();
    tickRaf();
    expect(onFlush).toHaveBeenCalledTimes(0);
  });

  it("RAF-Throttle pending value wird durch wiederholten schedule überschrieben (nicht akkumuliert)", () => {
    const onFlush = vi.fn();
    const t = makeThrottle(onFlush);
    // 60 rapide Updates (simuliert ~1 Sekunde Mausbewegung).
    for (let i = 0; i < 60; i++) {
      t.schedule({ loopStart: 100 + i, loopEnd: 500 });
    }
    tickRaf();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ loopStart: 159, loopEnd: 500 });
  });
});

// ─── Tests: Worklet Loop-Range via setBuffer/setLoop ─────────────────────────

describe("v3.71.0 – Worklet Loop-Range Message-Protokoll", () => {
  beforeEach(async () => {
    vi.resetModules();
    __createdSources.length = 0;
    __createdWorklets.length = 0;
    rafCallbacks.clear();
    rafCounter = 1;
    localStorageMock.clear();
    const mod = await import("../../client/src/audio/AudioEngine");
    AudioEngine = mod.AudioEngine;
    await AudioEngine.init();
  });

  it("pitchLocked=true + loopEnabled+range → setLoop-Message enthält loopStart/loopEnd", async () => {
    const id = "audiotrack:worklet-loop";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      loopEnabled: true,
      loopStartSample: 44100,   // 1.0s
      loopEndSample: 132300,    // 3.0s
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    expect(__createdWorklets.length).toBeGreaterThanOrEqual(1);
    const node = __createdWorklets[__createdWorklets.length - 1];
    const setLoopCall = node.port.postMessage.mock.calls.find(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    );
    expect(setLoopCall).toBeDefined();
    const payload = setLoopCall![0] as { type: string; loop: boolean; loopStart: number; loopEnd: number };
    expect(payload.loop).toBe(true);
    expect(payload.loopStart).toBe(44100);
    expect(payload.loopEnd).toBe(132300);
    AudioEngine.disposeAudioTrack(id);
  });

  it("pitchLocked=true ohne Loop-Range → setLoop-Message mit loopStart/End=null + loop=false (legacy)", async () => {
    const id = "audiotrack:worklet-no-loop";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      // loopEnabled fehlt → legacy
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const node = __createdWorklets[__createdWorklets.length - 1];
    const setLoopCall = node.port.postMessage.mock.calls.find(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    );
    expect(setLoopCall).toBeDefined();
    const payload = setLoopCall![0] as { loop: boolean; loopStart: number | null; loopEnd: number | null };
    expect(payload.loop).toBe(false);
    expect(payload.loopStart).toBeNull();
    expect(payload.loopEnd).toBeNull();
    AudioEngine.disposeAudioTrack(id);
  });

  it("pitchLocked=true + loopEnabled=true OHNE valid Range → loop=true + null/null (Default ganze Buffer-Länge)", async () => {
    const id = "audiotrack:worklet-loop-no-range";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      loopEnabled: true,
      loopStartSample: null,
      loopEndSample: null,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();

    const node = __createdWorklets[__createdWorklets.length - 1];
    const setLoopCall = node.port.postMessage.mock.calls.find(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    );
    const payload = setLoopCall![0] as { loop: boolean; loopStart: number | null; loopEnd: number | null };
    expect(payload.loop).toBe(true);
    expect(payload.loopStart).toBeNull();
    expect(payload.loopEnd).toBeNull();
    AudioEngine.disposeAudioTrack(id);
  });
});

// ─── Tests: Live-Loop-Edit ───────────────────────────────────────────────────

describe("v3.71.0 – Live-Loop-Edit: BufferSource (Stop+Restart)", () => {
  beforeEach(async () => {
    vi.resetModules();
    __createdSources.length = 0;
    __createdWorklets.length = 0;
    rafCallbacks.clear();
    rafCounter = 1;
    localStorageMock.clear();
    const mod = await import("../../client/src/audio/AudioEngine");
    AudioEngine = mod.AudioEngine;
    await AudioEngine.init();
  });

  it("setAudioTrackLoopPoints restartet BufferSource mit neuer Loop-Range", async () => {
    const id = "audiotrack:live-edit-bs";
    const SR = 44100;
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 44100,   // 1s
      loopEndSample: 132300,    // 3s
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const firstSrc = __createdSources[__createdSources.length - 1];
    expect(firstSrc.__started).toBe(true);
    expect(firstSrc.loopStart).toBeCloseTo(44100 / SR, 5);
    expect(firstSrc.loopEnd).toBeCloseTo(132300 / SR, 5);

    // Live-Edit: User schiebt loopEnd auf 88200 (=2s).
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 44100,
      loopEndSample: 88200,
    }));
    AudioEngine.setAudioTrackLoopPoints(id);
    await flushPromises();

    // Alte Source wurde gestoppt, neue Source erzeugt.
    expect(firstSrc.__stopped).toBe(true);
    const newSrc = __createdSources[__createdSources.length - 1];
    expect(newSrc).not.toBe(firstSrc);
    expect(newSrc.__started).toBe(true);
    expect(newSrc.loop).toBe(true);
    expect(newSrc.loopStart).toBeCloseTo(44100 / SR, 5);
    expect(newSrc.loopEnd).toBeCloseTo(88200 / SR, 5);
    AudioEngine.disposeAudioTrack(id);
  });

  it("Live-Edit preserved Position falls innerhalb der neuen Range", async () => {
    const id = "audiotrack:live-edit-preserve";
    const SR = 44100;
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 0,
      loopEndSample: 220500, // 5s
      startOffsetSec: 1.5,    // wir starten bei 1.5s
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    // Simuliere "1 Sekunde später" — currentTime tickt vorwärts.
    const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
    ctx.currentTime = 1.0; // → elapsed 1s, current pos ≈ 1.5 + 1 = 2.5s

    // Live-Edit: Range bleibt 0..5s, Position 2.5s liegt drin → restart at 2.5s.
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 44100,    // 1.0s
      loopEndSample: 176400,     // 4.0s — 2.5s liegt drin
      startOffsetSec: 1.5,
    }));
    AudioEngine.setAudioTrackLoopPoints(id);
    await flushPromises();

    const newSrc = __createdSources[__createdSources.length - 1];
    // start(when, offset) → offset (zweites Argument) sollte ~2.5s sein
    expect(newSrc.__startArgs).toBeDefined();
    const offset = newSrc.__startArgs![1];
    expect(offset).toBeGreaterThan(2.0);
    expect(offset).toBeLessThan(3.0);
    AudioEngine.disposeAudioTrack(id);
  });

  it("Live-Edit restarted ab loopStart wenn aktuelle Position ausserhalb der neuen Range", async () => {
    const id = "audiotrack:live-edit-outside";
    const SR = 44100;
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 0,
      loopEndSample: 220500,
      startOffsetSec: 0.5,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
    ctx.currentTime = 0.0; // elapsed=0 → currentSec ≈ 0.5

    // Neue Range 3..4s — current 0.5s ist OUTSIDE → restart bei loopStart=3s.
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 132300, // 3s
      loopEndSample: 176400,   // 4s
      startOffsetSec: 0.5,
    }));
    AudioEngine.setAudioTrackLoopPoints(id);
    await flushPromises();

    const newSrc = __createdSources[__createdSources.length - 1];
    const offset = newSrc.__startArgs![1];
    expect(offset).toBeCloseTo(132300 / SR, 5);
    AudioEngine.disposeAudioTrack(id);
  });

  it("setAudioTrackLoopPoints no-op wenn Track nicht spielt (kein dangling restart)", async () => {
    const id = "audiotrack:not-playing";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      loopEnabled: true,
      loopStartSample: 1000,
      loopEndSample: 5000,
    }));
    // NICHT playen.
    const sourcesBefore = __createdSources.length;
    AudioEngine.setAudioTrackLoopPoints(id);
    await flushPromises();
    expect(__createdSources.length).toBe(sourcesBefore);
    AudioEngine.disposeAudioTrack(id);
  });
});

describe("v3.71.0 – Live-Loop-Edit: Worklet (in-place postMessage)", () => {
  beforeEach(async () => {
    vi.resetModules();
    __createdSources.length = 0;
    __createdWorklets.length = 0;
    rafCallbacks.clear();
    rafCounter = 1;
    localStorageMock.clear();
    const mod = await import("../../client/src/audio/AudioEngine");
    AudioEngine = mod.AudioEngine;
    await AudioEngine.init();
  });

  it("setAudioTrackLoopPoints schickt postMessage(setLoop) an Worklet ohne neuen Node zu erzeugen", async () => {
    const id = "audiotrack:worklet-live-edit";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      loopEnabled: true,
      loopStartSample: 44100,
      loopEndSample: 132300,
    }));
    AudioEngine.playAudioTrack(id);
    await flushPromises();
    const initialWorklets = __createdWorklets.length;
    expect(initialWorklets).toBeGreaterThanOrEqual(1);
    const node = __createdWorklets[__createdWorklets.length - 1];
    const setLoopCallsBefore = node.port.postMessage.mock.calls.filter(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    ).length;

    // Live-Edit der Range.
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      pitchLocked: true,
      loopEnabled: true,
      loopStartSample: 22050,    // neues Start
      loopEndSample: 88200,      // neues End
    }));
    AudioEngine.setAudioTrackLoopPoints(id);
    await flushPromises();

    // KEIN neuer Worklet-Node erzeugt (kein restart).
    expect(__createdWorklets.length).toBe(initialWorklets);
    // Genau ein zusätzlicher setLoop-Call.
    const setLoopCallsAfter = node.port.postMessage.mock.calls.filter(
      (args: unknown[]) => (args[0] as { type?: string })?.type === "setLoop",
    );
    expect(setLoopCallsAfter.length).toBe(setLoopCallsBefore + 1);
    const latest = setLoopCallsAfter[setLoopCallsAfter.length - 1][0] as {
      loop: boolean; loopStart: number; loopEnd: number;
    };
    expect(latest.loop).toBe(true);
    expect(latest.loopStart).toBe(22050);
    expect(latest.loopEnd).toBe(88200);
    AudioEngine.disposeAudioTrack(id);
  });
});
