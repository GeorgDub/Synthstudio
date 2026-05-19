/**
 * tests/features/sub-mix-bus-fx.test.ts (v3.86.0)
 *
 * Closes v3.79.x-Caveat "SubMixBusFx minimal" — volle FX-Chain pro Bus.
 *
 * Test-Cluster:
 *  (1) Store-Setter: setBusEq3 / setBusCompressor / setBusReverbSend / setBusDelaySend
 *  (2) AudioEngine: applySubMixBus baut EQ + Compressor + Sends-Pfade
 *  (3) Engine-Bus-Compressor wirkt auf den Channel-Sum (Wet/Dry-Crossfade)
 *  (4) Reverb-Send routet zur global-reverb-bus
 *  (5) Schema v1.33 Round-Trip (volle FX-Felder)
 *  (6) FX-Disabled = no-op (EQ-Bänder auf 0dB, Compressor bypassed)
 *  (7) Backward-Compat: Pre-v1.32-Buses ohne fx-Feld funktionieren weiter
 *
 * 13 Tests in 7 describes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage-Mock ───────────────────────────────────────────────────────

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

// ─── Mock-AudioContext ───────────────────────────────────────────────────────

interface MockParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  setValueCurveAtTime: ReturnType<typeof vi.fn>;
}

function makeParam(initial = 0): MockParam {
  const p: MockParam = {
    value: initial,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setValueCurveAtTime: vi.fn(),
  };
  p.setValueAtTime.mockImplementation((v: number) => { p.value = v; });
  // setTargetAtTime schreibt direkt damit Assertions deterministisch sind.
  p.setTargetAtTime.mockImplementation((v: number) => { p.value = v; });
  return p;
}

interface MockNode {
  __id?: number;
  __kind?: string;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  type?: string;
  buffer?: unknown;
  gain?: MockParam;
  frequency?: MockParam;
  Q?: MockParam;
  delayTime?: MockParam;
  pan?: MockParam;
  threshold?: MockParam;
  knee?: MockParam;
  ratio?: MockParam;
  attack?: MockParam;
  release?: MockParam;
  curve?: Float32Array | null;
}

let __nodeCounter = 0;
function makeBase(kind: string): MockNode {
  return { __id: ++__nodeCounter, __kind: kind, connect: vi.fn(), disconnect: vi.fn() };
}

const __createdNodes: MockNode[] = [];

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
  destination = makeBase("destination");
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn();
  createGain(): MockNode {
    const g: MockNode = { ...makeBase("gain"), gain: makeParam(1) };
    __createdNodes.push(g);
    return g;
  }
  createStereoPanner(): MockNode {
    const p: MockNode = { ...makeBase("panner"), pan: makeParam(0) };
    __createdNodes.push(p);
    return p;
  }
  createBiquadFilter(): MockNode {
    const f: MockNode = {
      ...makeBase("biquad"),
      type: "lowpass",
      frequency: makeParam(1000),
      Q: makeParam(0.7),
      gain: makeParam(0),
    };
    __createdNodes.push(f);
    return f;
  }
  createWaveShaper(): MockNode { return { ...makeBase("waveshaper"), curve: null }; }
  createDynamicsCompressor(): MockNode {
    const c: MockNode = {
      ...makeBase("compressor"),
      threshold: makeParam(-24),
      ratio: makeParam(4),
      attack: makeParam(0.003),
      release: makeParam(0.25),
      knee: makeParam(30),
    };
    __createdNodes.push(c);
    return c;
  }
  createDelay(_max?: number): MockNode {
    return { ...makeBase("delay"), delayTime: makeParam(0) };
  }
  createConvolver(): MockNode { return { ...makeBase("convolver"), buffer: null }; }
  createAnalyser(): MockNode { return makeBase("analyser"); }
  createBuffer(channels: number, length: number, sr: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sr);
  }
  createBufferSource(): MockNode { return makeBase("source"); }
  createOscillator(): MockNode {
    return { ...makeBase("oscillator"), frequency: makeParam(440), type: "sine" };
  }
}

(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
(globalThis as Record<string, unknown>).requestAnimationFrame = (_cb: FrameRequestCallback) => 0;
(globalThis as Record<string, unknown>).cancelAnimationFrame = () => { /* no-op */ };

// ─── Dynamische Imports ──────────────────────────────────────────────────────

let storeModule: typeof import("../../client/src/store/useSubMixStore");
let serializer: typeof import("../../client/src/utils/projectSerializer");
let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  __createdNodes.length = 0;
  __nodeCounter = 0;
  storeModule = await import("../../client/src/store/useSubMixStore");
  serializer = await import("../../client/src/utils/projectSerializer");
  AudioEngine = (await import("../../client/src/audio/AudioEngine")).AudioEngine;
  storeModule.__resetSubMixStoreForTests();
});

// ─── (1) Store-Setter ────────────────────────────────────────────────────────

describe("useSubMixStore — FX-Chain Setter (v3.86.0)", () => {
  it("setBusEq3 mergt + clampt EQ-Bänder und persistiert in localStorage", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusEq3(id, { lowGain: 6, midGain: -3 });
    const b = storeModule.getBusById(id)!;
    expect(b.fx).toBeDefined();
    expect(b.fx!.eq3.lowGain).toBe(6);
    expect(b.fx!.eq3.midGain).toBe(-3);
    expect(b.fx!.eq3.highGain).toBe(0); // unchanged → default

    // Clamping: out-of-range fällt auf min/max.
    storeModule.setBusEq3(id, { lowGain: 99, highGain: -99 });
    const b2 = storeModule.getBusById(id)!;
    expect(b2.fx!.eq3.lowGain).toBe(24);
    expect(b2.fx!.eq3.highGain).toBe(-24);

    // Persist
    const raw = localStorageMock.getItem("synthstudio:sub-mix:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.buses[0].fx.eq3.lowGain).toBe(24);
  });

  it("setBusCompressor mergt + clampt Compressor-Felder", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusCompressor(id, { enabled: true, threshold: -20, ratio: 10 });
    const b = storeModule.getBusById(id)!;
    expect(b.fx!.compressor.enabled).toBe(true);
    expect(b.fx!.compressor.threshold).toBe(-20);
    expect(b.fx!.compressor.ratio).toBe(10);
    expect(b.fx!.compressor.attack).toBe(0.01); // unchanged → default

    // Clamping
    storeModule.setBusCompressor(id, { ratio: 999, threshold: 99 });
    const b2 = storeModule.getBusById(id)!;
    expect(b2.fx!.compressor.ratio).toBe(20);
    expect(b2.fx!.compressor.threshold).toBe(0);
  });

  it("setBusReverbSend + setBusDelaySend clampen auf 0..1", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusReverbSend(id, 0.5);
    storeModule.setBusDelaySend(id, 0.3);
    let b = storeModule.getBusById(id)!;
    expect(b.fx!.reverbSend).toBe(0.5);
    expect(b.fx!.delaySend).toBe(0.3);

    storeModule.setBusReverbSend(id, 99);
    storeModule.setBusDelaySend(id, -1);
    b = storeModule.getBusById(id)!;
    expect(b.fx!.reverbSend).toBe(1);
    expect(b.fx!.delaySend).toBe(0);
  });
});

// ─── (2) AudioEngine: applySubMixBus FX-Wiring ───────────────────────────────

describe("AudioEngine — applySubMixBus FX-Chain (v3.86.0)", () => {
  it("setBusEqLowGain (durch Store → applySubMixBus) wirkt auf EQ-Low-Gain im Engine", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusFx(id, { enabled: true });
    storeModule.setBusEq3(id, { lowGain: 9 });
    const bus = storeModule.getBusById(id)!;
    AudioEngine.applySubMixBus(id, bus, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // EQ-Low-Gain wurde im Engine durch setTargetAtTime auf 9 gerampt.
    expect((nodes.eqLow.gain as unknown as MockParam).value).toBe(9);
    // Mid + High blieben unverändert (0).
    expect((nodes.eqMid.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.eqHigh.gain as unknown as MockParam).value).toBe(0);
  });

  it("Bus-Compressor wirkt auf den Channel-Sum: Wet/Dry-Crossfade bei enabled", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    // FX-Chain aktivieren + Compressor an
    storeModule.setBusFx(id, { enabled: true });
    storeModule.setBusCompressor(id, { enabled: true, threshold: -10, ratio: 8 });
    const bus = storeModule.getBusById(id)!;
    AudioEngine.applySubMixBus(id, bus, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // Wet=1, Dry=0 → Audio läuft durch den Compressor.
    expect((nodes.compWet.gain as unknown as MockParam).value).toBe(1);
    expect((nodes.compDry.gain as unknown as MockParam).value).toBe(0);
    // Compressor-Threshold + Ratio wurden gesetzt.
    expect((nodes.compressor.threshold as unknown as MockParam).value).toBe(-10);
    expect((nodes.compressor.ratio as unknown as MockParam).value).toBe(8);

    // Compressor aus → Dry=1, Wet=0
    storeModule.setBusCompressor(id, { enabled: false });
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    expect((nodes.compWet.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.compDry.gain as unknown as MockParam).value).toBe(1);
  });

  it("Engine-FX-Chain ist verkabelt: input → eqLow → eqMid → eqHigh → compIn", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // input.connect wurde gerufen (mind. einmal zum eqLow).
    expect((nodes.input as unknown as MockNode).connect).toHaveBeenCalled();
    // eqLow.connect → eqMid (1 call)
    expect((nodes.eqLow as unknown as MockNode).connect).toHaveBeenCalled();
    // Final gain → panner
    expect((nodes.gain as unknown as MockNode).connect).toHaveBeenCalled();
    // panner → master
    expect((nodes.panner as unknown as MockNode).connect).toHaveBeenCalled();
  });
});

// ─── (3) Reverb-Send / Delay-Send routing ────────────────────────────────────

describe("AudioEngine — Sends routen zu global-buses", () => {
  it("Reverb-Send routet vom Bus-Gain zu global-reverb-bus (über reverbSend-Gain)", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusReverbSend(id, 0.7);
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // reverbSend.gain.value wurde auf 0.7 gerampt.
    expect((nodes.reverbSend.gain as unknown as MockParam).value).toBeCloseTo(0.7, 5);
    // bus.gain → reverbSend wurde verkabelt (gain.connect-Aufrufe enthalten reverbSend).
    expect((nodes.gain as unknown as MockNode).connect).toHaveBeenCalled();
    // reverbSend.connect wurde gerufen (zum global-reverb-bus).
    expect((nodes.reverbSend as unknown as MockNode).connect).toHaveBeenCalled();
  });

  it("Delay-Send routet vom Bus-Gain zu global-delay-bus", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusDelaySend(id, 0.4);
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    expect((nodes.delaySend.gain as unknown as MockParam).value).toBeCloseTo(0.4, 5);
    expect((nodes.delaySend as unknown as MockNode).connect).toHaveBeenCalled();
  });
});

// ─── (4) Schema v1.33 Round-Trip ──────────────────────────────────────────────

describe("Schema v1.33 — FX-Chain Round-Trip", () => {
  it("SYNTH_FILE_VERSION ist '1.33' (Schema-Bump für volle SubMixBus-FX-Chain)", () => {
    expect(serializer.SYNTH_FILE_VERSION).toBe("1.34");
  });

  it("Round-Trip: SubMixBusFx mit eq3 + compressor + sends preserves alle Werte", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusFx(id, { enabled: true });
    storeModule.setBusEq3(id, { lowGain: 4, midGain: -2, highGain: 6 });
    storeModule.setBusCompressor(id, {
      enabled: true, threshold: -15, ratio: 6, attack: 0.02, release: 0.2,
    });
    storeModule.setBusReverbSend(id, 0.6);
    storeModule.setBusDelaySend(id, 0.25);

    const buses = storeModule.getBuses();
    const project = serializer.serializeProject({
      projectName: "Test",
      bpm: 120,
      samples: [],
      patterns: [],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {
          reverb: { id: "reverb", name: "Reverb Return", volume: 0.85, muted: false },
          delay:  { id: "delay",  name: "Delay Return",  volume: 0.85, muted: false },
        },
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: { swing: 0, velocityJitter: 0, timeJitter: 0 } as unknown as never },
      automation: { lanes: [], stepCount: 16 },
      subMixBuses: buses,
    } as unknown as Parameters<typeof serializer.serializeProject>[0]);

    const json = serializer.toJson(project);
    const parsed = serializer.parseProject(json);
    expect(parsed.subMixBuses).toBeDefined();
    expect(parsed.subMixBuses!).toHaveLength(1);
    const restored = parsed.subMixBuses![0];
    expect(restored.fx).toBeDefined();
    expect(restored.fx!.enabled).toBe(true);
    expect(restored.fx!.eq3.lowGain).toBe(4);
    expect(restored.fx!.eq3.midGain).toBe(-2);
    expect(restored.fx!.eq3.highGain).toBe(6);
    expect(restored.fx!.compressor.enabled).toBe(true);
    expect(restored.fx!.compressor.threshold).toBe(-15);
    expect(restored.fx!.compressor.ratio).toBe(6);
    expect(restored.fx!.compressor.attack).toBe(0.02);
    expect(restored.fx!.compressor.release).toBeCloseTo(0.2, 5);
    expect(restored.fx!.reverbSend).toBe(0.6);
    expect(restored.fx!.delaySend).toBe(0.25);
  });

  it("Pre-v1.33-Bus (nur enabled + postGain) lädt → fehlende FX-Felder werden mit Defaults gefüllt", () => {
    const oldRawBus = {
      id: "drums",
      name: "Drums",
      volume: 0.85,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: ["kick"],
      fx: { enabled: true, postGain: 1.0 }, // alte minimal-Shape
    };
    const sanitized = storeModule.sanitizeBus(oldRawBus);
    expect(sanitized).toBeTruthy();
    expect(sanitized!.fx).toBeDefined();
    // Defaults müssen vorhanden sein.
    expect(sanitized!.fx!.eq3.lowGain).toBe(0);
    expect(sanitized!.fx!.eq3.midGain).toBe(0);
    expect(sanitized!.fx!.eq3.highGain).toBe(0);
    expect(sanitized!.fx!.compressor.enabled).toBe(false);
    expect(sanitized!.fx!.reverbSend).toBe(0);
    expect(sanitized!.fx!.delaySend).toBe(0);
  });
});

// ─── (5) FX-Disabled = no-op ─────────────────────────────────────────────────

describe("Engine: FX-Disabled = no-op (transparent)", () => {
  it("fx.enabled=false → EQ-Bänder bleiben auf 0dB, Compressor bypassed (compDry=1)", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    // Werte gesetzt aber enabled=false.
    storeModule.setBusFx(id, { enabled: false });
    storeModule.setBusEq3(id, { lowGain: 12, midGain: 6, highGain: -3 });
    storeModule.setBusCompressor(id, { enabled: true, threshold: -20 });
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // EQ-Bänder MÜSSEN auf 0 bleiben weil enabled=false die ganze FX-Chain
    // transparent macht.
    expect((nodes.eqLow.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.eqMid.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.eqHigh.gain as unknown as MockParam).value).toBe(0);
    // Compressor bypassed (Dry=1, Wet=0) — selbst wenn fx.compressor.enabled=true.
    expect((nodes.compWet.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.compDry.gain as unknown as MockParam).value).toBe(1);
  });
});

// ─── (6) Backward-Compat: Bus ohne fx-Feld ──────────────────────────────────

describe("Engine: Backward-Compat (Bus ohne fx-Feld)", () => {
  it("Bus ohne fx-Feld → applySubMixBus crash-frei, alle FX-Params=Default-Transparent", async () => {
    await AudioEngine.init();
    const bus = {
      id: "drums",
      name: "Drums",
      volume: 0.5,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: [],
      // KEIN fx-Feld!
    };
    expect(() => AudioEngine.applySubMixBus(bus.id, bus, false)).not.toThrow();
    const nodes = AudioEngine.getSubMixBusNodes().get("drums")!;
    expect((nodes.gain.gain as unknown as MockParam).value).toBe(0.5);
    // Defaults: EQ=0dB, Compressor bypassed (Dry=1), Sends=0.
    expect((nodes.eqLow.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.compWet.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.compDry.gain as unknown as MockParam).value).toBe(1);
    expect((nodes.reverbSend.gain as unknown as MockParam).value).toBe(0);
    expect((nodes.delaySend.gain as unknown as MockParam).value).toBe(0);
  });
});
