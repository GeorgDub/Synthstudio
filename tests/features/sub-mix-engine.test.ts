/**
 * tests/features/sub-mix-engine.test.ts (v3.79.1)
 *
 * Closes v3.79.0 dead-store: Audio-Wiring für Sub-Mix-Buses.
 *
 * Test-Cluster:
 *  (1) applySubMixBus erzeugt GainNode + Panner
 *  (2) Channel mit busId routes via Bus statt direkt zu Master
 *  (3) Bus-Mute mute't alle Members (gain.value → 0)
 *  (4) Bus-Solo dämpft Sister-Buses
 *  (5) Reassign Channel zwischen Buses funktioniert
 *  (6) syncSubMixState bulk-applied (idempotent + Cleanup orphan-Buses)
 *
 * 9 Tests in 6 describes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage-Mock ────────────────────────────────────────────────────────

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

// ─── Mock-AudioContext ────────────────────────────────────────────────────────

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
  // Wichtig: setTargetAtTime schreibt den Zielwert direkt damit Assertions
  // gegen .value deterministisch sind (Hardware-Ramp ist nicht synchron).
  p.setTargetAtTime.mockImplementation((v: number) => { p.value = v; });
  return p;
}

interface MockNode {
  __id?: number;
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
function makeBase(): MockNode {
  return { __id: ++__nodeCounter, connect: vi.fn(), disconnect: vi.fn() };
}

const __createdGains: MockNode[] = [];
const __createdPanners: MockNode[] = [];

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
  destination = makeBase();
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn();
  createGain(): MockNode {
    const g: MockNode = { ...makeBase(), gain: makeParam(1) };
    __createdGains.push(g);
    return g;
  }
  createStereoPanner(): MockNode {
    const p: MockNode = { ...makeBase(), pan: makeParam(0) };
    __createdPanners.push(p);
    return p;
  }
  createBiquadFilter(): MockNode {
    return {
      ...makeBase(),
      type: "lowpass",
      frequency: makeParam(1000),
      Q: makeParam(0.7),
      gain: makeParam(0),
    };
  }
  createWaveShaper(): MockNode { return { ...makeBase(), curve: null }; }
  createDynamicsCompressor(): MockNode {
    return {
      ...makeBase(),
      threshold: makeParam(-24),
      ratio: makeParam(4),
      attack: makeParam(0.003),
      release: makeParam(0.25),
      knee: makeParam(30),
    };
  }
  createDelay(_max?: number): MockNode {
    return { ...makeBase(), delayTime: makeParam(0) };
  }
  createConvolver(): MockNode { return { ...makeBase(), buffer: null }; }
  createAnalyser(): MockNode { return makeBase(); }
  createBuffer(channels: number, length: number, sr: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sr);
  }
  createBufferSource(): MockNode { return makeBase(); }
  createOscillator(): MockNode {
    return { ...makeBase(), frequency: makeParam(440), type: "sine" };
  }
}

(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
(globalThis as Record<string, unknown>).requestAnimationFrame = (_cb: FrameRequestCallback) => 0;
(globalThis as Record<string, unknown>).cancelAnimationFrame = () => { /* no-op */ };

// ─── Dynamische Imports ───────────────────────────────────────────────────────

let storeModule: typeof import("../../client/src/store/useSubMixStore");
let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  __createdGains.length = 0;
  __createdPanners.length = 0;
  __nodeCounter = 0;
  storeModule = await import("../../client/src/store/useSubMixStore");
  AudioEngine = (await import("../../client/src/audio/AudioEngine")).AudioEngine;
  storeModule.__resetSubMixStoreForTests();
});

// ─── (1) applySubMixBus erzeugt GainNode + Panner ────────────────────────────

describe("AudioEngine — applySubMixBus", () => {
  it("erzeugt FX-Chain (Gain-Nodes + StereoPanner) pro Bus und verbindet sie zum master", async () => {
    await AudioEngine.init();
    const bus = {
      id: "drums",
      name: "Drums",
      volume: 0.85,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: [],
    };
    const beforeGainCount = __createdGains.length;
    const beforePanCount = __createdPanners.length;
    AudioEngine.applySubMixBus(bus.id, bus, false);
    // v3.86.0: Pro Bus werden mehrere Gains erzeugt (input + compIn + compWet
    // + compDry + compMix + gain + reverbSend + delaySend = 8). Plus 1 Panner.
    expect(__createdGains.length).toBeGreaterThanOrEqual(beforeGainCount + 8);
    expect(__createdPanners.length).toBe(beforePanCount + 1);
    const nodes = AudioEngine.getSubMixBusNodes();
    expect(nodes.has("drums")).toBe(true);
    const set = nodes.get("drums")!;
    // Gain → panner → master ist verkabelt
    expect((set.gain as unknown as MockNode).connect).toHaveBeenCalled();
    expect((set.panner as unknown as MockNode).connect).toHaveBeenCalled();
    // Volume wurde via setTargetAtTime auf 0.85 gerampt
    expect(set.gain.gain.value).toBe(0.85);
    // Pan wurde gerampt
    expect((set.panner.pan as unknown as MockParam).value).toBe(0);
  });

  it("idempotent: zweimaliger Aufruf erzeugt keine neuen Nodes, rampt nur Gain/Pan", async () => {
    await AudioEngine.init();
    const bus = {
      id: "b1",
      name: "B1",
      volume: 0.5,
      pan: -0.5,
      mute: false,
      solo: false,
      channelIds: [],
    };
    AudioEngine.applySubMixBus(bus.id, bus, false);
    const after1 = __createdGains.length;
    // Update volume + pan
    AudioEngine.applySubMixBus(bus.id, { ...bus, volume: 1.5, pan: 0.7 }, false);
    expect(__createdGains.length).toBe(after1); // keine neue Gain-Node
    const set = AudioEngine.getSubMixBusNodes().get("b1")!;
    expect(set.gain.gain.value).toBeCloseTo(1.5, 5);
    expect((set.panner.pan as unknown as MockParam).value).toBeCloseTo(0.7, 5);
  });
});

// ─── (2) Channel routes via Bus ──────────────────────────────────────────────

describe("AudioEngine — routeChannelToSubMixBus", () => {
  it("Channel mit busId routes über Bus-Gain statt direkt zu Master", async () => {
    await AudioEngine.init();
    AudioEngine.applySubMixBus(
      "drums",
      { id: "drums", name: "Drums", volume: 1, pan: 0, mute: false, solo: false, channelIds: [] },
      false,
    );
    AudioEngine.ensureChannelExists("kick");
    AudioEngine.routeChannelToSubMixBus("kick", "drums");
    expect(AudioEngine.getChannelSubMixAssignment("kick")).toBe("drums");
    // Der Channel-Output (sidechainGain) wurde re-verbunden — wir können nicht
    // direkt das Internals greifen, aber das Assignment ist gesetzt.
  });

  it("Channel ohne busId routes direkt zu Master (Default)", async () => {
    await AudioEngine.init();
    AudioEngine.ensureChannelExists("hihat");
    expect(AudioEngine.getChannelSubMixAssignment("hihat")).toBeNull();
    // Reassign zu null = no-op aber crash-free
    AudioEngine.routeChannelToSubMixBus("hihat", null);
    expect(AudioEngine.getChannelSubMixAssignment("hihat")).toBeNull();
  });
});

// ─── (3) Bus-Mute mute't alle Members ────────────────────────────────────────

describe("AudioEngine — Bus-Mute", () => {
  it("Bus-Mute setzt den Bus-Gain.value auf 0", async () => {
    await AudioEngine.init();
    const bus = {
      id: "drums",
      name: "Drums",
      volume: 0.9,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: ["kick", "snare"],
    };
    AudioEngine.applySubMixBus(bus.id, bus, false);
    const set = AudioEngine.getSubMixBusNodes().get("drums")!;
    expect(set.gain.gain.value).toBe(0.9);
    // Bus-Mute aktivieren
    AudioEngine.applySubMixBus(bus.id, { ...bus, mute: true }, false);
    expect(set.gain.gain.value).toBe(0);
    // Bus-Mute deaktivieren — Volume kehrt zurück
    AudioEngine.applySubMixBus(bus.id, { ...bus, mute: false }, false);
    expect(set.gain.gain.value).toBe(0.9);
  });
});

// ─── (4) Bus-Solo dämpft Sister-Buses ────────────────────────────────────────

describe("AudioEngine — Bus-Solo dämpft andere Buses", () => {
  it("anyBusSolo=true + bus.solo=false → Bus-Gain wird auf 0 gerampt", async () => {
    await AudioEngine.init();
    const drums = {
      id: "drums",
      name: "Drums",
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: [],
    };
    const bass = {
      id: "bass",
      name: "Bass",
      volume: 0.7,
      pan: 0,
      mute: false,
      solo: true,
      channelIds: [],
    };
    AudioEngine.applySubMixBus(drums.id, drums, true);
    AudioEngine.applySubMixBus(bass.id, bass, true);
    const drumsSet = AudioEngine.getSubMixBusNodes().get("drums")!;
    const bassSet  = AudioEngine.getSubMixBusNodes().get("bass")!;
    // Drums sind NICHT solo'd → effektiv stumm
    expect(drumsSet.gain.gain.value).toBe(0);
    // Bass selbst ist solo'd → behält Volume
    expect(bassSet.gain.gain.value).toBe(0.7);
  });

  it("anyBusSolo=false → alle Buses behalten ihr Volume", async () => {
    await AudioEngine.init();
    const drums = {
      id: "drums",
      name: "Drums",
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: [],
    };
    AudioEngine.applySubMixBus(drums.id, drums, false);
    const set = AudioEngine.getSubMixBusNodes().get("drums")!;
    expect(set.gain.gain.value).toBe(0.8);
  });
});

// ─── (5) Reassign Channel zwischen Buses ─────────────────────────────────────

describe("AudioEngine — Channel-Reassign zwischen Buses", () => {
  it("Channel-Reassign zwischen Buses ändert die Assignment-Map korrekt", async () => {
    await AudioEngine.init();
    const drums = {
      id: "drums",
      name: "Drums",
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: [],
    };
    const fx = {
      id: "fx",
      name: "FX",
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      channelIds: [],
    };
    AudioEngine.applySubMixBus(drums.id, drums, false);
    AudioEngine.applySubMixBus(fx.id, fx, false);
    AudioEngine.ensureChannelExists("kick");
    AudioEngine.routeChannelToSubMixBus("kick", "drums");
    expect(AudioEngine.getChannelSubMixAssignment("kick")).toBe("drums");
    AudioEngine.routeChannelToSubMixBus("kick", "fx");
    expect(AudioEngine.getChannelSubMixAssignment("kick")).toBe("fx");
    // Sidechain-Disconnect wurde mehrfach gerufen (jeder routing-switch
    // disconnected einmal + reconnected). Kein Crash.
  });
});

// ─── (6) syncSubMixState — Bulk-Sync vom Store ────────────────────────────────

describe("AudioEngine — syncSubMixState", () => {
  it("syncSubMixState bulk-applied erzeugt Buses + Assignments aus State-Snapshot", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    storeModule.assignChannelToBus(id, "snare");
    AudioEngine.ensureChannelExists("kick");
    AudioEngine.ensureChannelExists("snare");
    AudioEngine.syncSubMixState(storeModule.getSubMixState());
    const nodes = AudioEngine.getSubMixBusNodes();
    expect(nodes.has(id)).toBe(true);
    expect(AudioEngine.getChannelSubMixAssignment("kick")).toBe(id);
    expect(AudioEngine.getChannelSubMixAssignment("snare")).toBe(id);
  });

  it("syncSubMixState entfernt Buses die nicht mehr im State sind (Orphan-Cleanup)", async () => {
    await AudioEngine.init();
    const idA = storeModule.createBus("Drums")!;
    const idB = storeModule.createBus("Bass")!;
    AudioEngine.syncSubMixState(storeModule.getSubMixState());
    expect(AudioEngine.getSubMixBusNodes().size).toBe(2);
    // Bus B entfernen — sync sollte den Node aus dem Engine-Graph räumen
    storeModule.removeBus(idB);
    AudioEngine.syncSubMixState(storeModule.getSubMixState());
    expect(AudioEngine.getSubMixBusNodes().size).toBe(1);
    expect(AudioEngine.getSubMixBusNodes().has(idA)).toBe(true);
    expect(AudioEngine.getSubMixBusNodes().has(idB)).toBe(false);
  });

  it("syncSubMixState idempotent: zweimaliger Aufruf mit gleichem State erzeugt keine doppelten Nodes", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    AudioEngine.syncSubMixState(storeModule.getSubMixState());
    const count1 = __createdGains.length;
    AudioEngine.syncSubMixState(storeModule.getSubMixState());
    const count2 = __createdGains.length;
    expect(count2).toBe(count1);
    expect(AudioEngine.getSubMixBusNodes().size).toBe(1);
    expect(AudioEngine.getSubMixBusNodes().has(id)).toBe(true);
  });
});
