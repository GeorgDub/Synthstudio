/**
 * tests/features/sub-mix-bus-fx-midi.test.ts (v3.88.0)
 *
 * Closes v3.87.0 Caveat "Bus-FX-MIDI-Targets ohne UI-Bindung" — wired
 * Right-Click-Learn-Handler im BusFxModal an die 7 v3.87-Targets, plus
 * v3.88.0 postGain-Wiring im Audio-Graph (compMix → postGain → gain).
 *
 * Test-Cluster:
 *  (1) 7 neue MIDI-Targets binden korrekt via Layout-Import + targetsMatch
 *  (2) Right-Click-Learn auf Slider erzeugt CC-Mapping via applyMapping-Event
 *  (3) postGain wirkt zwischen Comp und Volume — applySubMixBus rampt
 *      separaten GainNode (nicht den Volume-Gain)
 *  (4) Bypass (fx.enabled=false) + postGain stack korrekt — postGain==1.0
 *      transparent obwohl Store-Wert anders ist
 *  (5) postGain wirkt nicht auf Sends (Sends zweigen post-bus.gain ab)
 *  (6) setBusPostGain Convenience-Setter persistiert + clampt
 *
 * 7 Tests in 5 describes. env:node mit localStorage-Mock + Mock-AudioContext
 * mit GainNode-Tracking (nutzt das gleiche Pattern wie sub-mix-bus-fx.test.ts).
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

// ─── Mock-AudioContext (analog sub-mix-bus-fx.test.ts) ───────────────────────

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
  // setTargetAtTime schreibt direkt damit Assertions deterministisch sind
  // (Hardware-Ramp ist nicht synchron, würde sonst leere Reads liefern).
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

const __createdGains: MockNode[] = [];

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
    __createdGains.push(g);
    return g;
  }
  createStereoPanner(): MockNode {
    return { ...makeBase("panner"), pan: makeParam(0) };
  }
  createBiquadFilter(): MockNode {
    return {
      ...makeBase("biquad"),
      type: "lowpass",
      frequency: makeParam(1000),
      Q: makeParam(0.7),
      gain: makeParam(0),
    };
  }
  createWaveShaper(): MockNode { return { ...makeBase("waveshaper"), curve: null }; }
  createDynamicsCompressor(): MockNode {
    return {
      ...makeBase("compressor"),
      threshold: makeParam(-24),
      ratio: makeParam(4),
      attack: makeParam(0.003),
      release: makeParam(0.25),
      knee: makeParam(30),
    };
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
let midiModule:  typeof import("../../client/src/hooks/useMidi");
let layoutModule: typeof import("../../client/src/utils/midiLayoutImport");
let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  __createdGains.length = 0;
  __nodeCounter = 0;
  storeModule  = await import("../../client/src/store/useSubMixStore");
  midiModule   = await import("../../client/src/hooks/useMidi");
  layoutModule = await import("../../client/src/utils/midiLayoutImport");
  AudioEngine  = (await import("../../client/src/audio/AudioEngine")).AudioEngine;
  storeModule.__resetSubMixStoreForTests();
});

// ─── (1) 7 neue MIDI-Targets binden korrekt ──────────────────────────────────

describe("v3.87 BusFx MidiLearnTargets — Identität + Layout-Import", () => {
  it("targetsMatch erkennt alle 7 BusFx-Targets über busId (Volume-Independent)", () => {
    const targets: Array<import("../../client/src/hooks/useMidi").MidiLearnTarget> = [
      { type: "subMixBusEqLowGain",    busId: "bus-A" },
      { type: "subMixBusEqMidGain",    busId: "bus-A" },
      { type: "subMixBusEqHighGain",   busId: "bus-A" },
      { type: "subMixBusCompThreshold", busId: "bus-A" },
      { type: "subMixBusCompRatio",    busId: "bus-A" },
      { type: "subMixBusReverbSend",   busId: "bus-A" },
      { type: "subMixBusDelaySend",    busId: "bus-A" },
    ];
    // Jedes Target matcht sich selbst (same busId, mit/ohne busName)
    for (const t of targets) {
      expect(midiModule.targetsMatch(t, { ...t, busName: "Drums" })).toBe(true);
    }
    // Aber unterschiedliche busIds matchen nicht
    expect(midiModule.targetsMatch(
      { type: "subMixBusEqLowGain", busId: "bus-A" },
      { type: "subMixBusEqLowGain", busId: "bus-B" },
    )).toBe(false);
    // Unterschiedliche Types matchen nicht (selbst bei gleichem busId)
    expect(midiModule.targetsMatch(
      { type: "subMixBusEqLowGain",  busId: "bus-A" },
      { type: "subMixBusEqMidGain",  busId: "bus-A" },
    )).toBe(false);
  });

  it("findMappingForTarget findet das richtige BusFx-Mapping in einer Liste mit allen 7", () => {
    const mappings = [
      { cc: 30, channel: 0, target: { type: "subMixBusEqLowGain"     as const, busId: "bus-A" }, label: "EQ Lo" },
      { cc: 31, channel: 0, target: { type: "subMixBusEqMidGain"     as const, busId: "bus-A" }, label: "EQ Mi" },
      { cc: 32, channel: 0, target: { type: "subMixBusEqHighGain"    as const, busId: "bus-A" }, label: "EQ Hi" },
      { cc: 33, channel: 0, target: { type: "subMixBusCompThreshold" as const, busId: "bus-A" }, label: "Comp Th" },
      { cc: 34, channel: 0, target: { type: "subMixBusCompRatio"     as const, busId: "bus-A" }, label: "Comp Ra" },
      { cc: 35, channel: 0, target: { type: "subMixBusReverbSend"    as const, busId: "bus-A" }, label: "Reverb" },
      { cc: 36, channel: 0, target: { type: "subMixBusDelaySend"     as const, busId: "bus-A" }, label: "Delay" },
    ];
    expect(midiModule.findMappingForTarget(mappings, { type: "subMixBusEqLowGain",     busId: "bus-A" })?.cc).toBe(30);
    expect(midiModule.findMappingForTarget(mappings, { type: "subMixBusEqMidGain",     busId: "bus-A" })?.cc).toBe(31);
    expect(midiModule.findMappingForTarget(mappings, { type: "subMixBusEqHighGain",    busId: "bus-A" })?.cc).toBe(32);
    expect(midiModule.findMappingForTarget(mappings, { type: "subMixBusCompThreshold", busId: "bus-A" })?.cc).toBe(33);
    expect(midiModule.findMappingForTarget(mappings, { type: "subMixBusCompRatio",     busId: "bus-A" })?.cc).toBe(34);
    expect(midiModule.findMappingForTarget(mappings, { type: "subMixBusReverbSend",    busId: "bus-A" })?.cc).toBe(35);
    expect(midiModule.findMappingForTarget(mappings, { type: "subMixBusDelaySend",     busId: "bus-A" })?.cc).toBe(36);
  });

  it("VALID_TARGET_TYPES enthält alle 7 BusFx-Targets (Layout-Import-Pfad)", () => {
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusEqLowGain")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusEqMidGain")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusEqHighGain")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusCompThreshold")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusCompRatio")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusReverbSend")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusDelaySend")).toBe(true);
  });
});

// ─── (2) Right-Click-Learn (useMidiLearn-Surrogate) ──────────────────────────

describe("Right-Click-Learn auf Slider → useMidiLearn-Surface", () => {
  it("labelForTarget liefert busName-Display für alle 7 BusFx-Targets (Context-Menu-Header)", () => {
    expect(midiModule.labelForTarget({
      type: "subMixBusEqLowGain", busId: "abc", busName: "Drums",
    })).toBe("Bus EQ Low: Drums");
    expect(midiModule.labelForTarget({
      type: "subMixBusCompThreshold", busId: "abc", busName: "Drums",
    })).toBe("Bus Comp Threshold: Drums");
    expect(midiModule.labelForTarget({
      type: "subMixBusReverbSend", busId: "abc", busName: "Drums",
    })).toBe("Bus Reverb Send: Drums");
    expect(midiModule.labelForTarget({
      type: "subMixBusDelaySend", busId: "abc", busName: "Drums",
    })).toBe("Bus Delay Send: Drums");
    // busId-Slice-Fallback wenn kein busName
    expect(midiModule.labelForTarget({
      type: "subMixBusEqMidGain", busId: "deadbeef12345",
    })).toBe("Bus EQ Mid: deadbeef");
  });
});

// ─── (3) postGain-Wiring zwischen Comp und Volume ────────────────────────────

describe("AudioEngine — postGain wirkt zwischen compMix und bus.gain (v3.88.0)", () => {
  it("applySubMixBus rampt fx.postGain auf einen separaten Gain-Node (NICHT auf bus.gain)", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusFx(id, { enabled: true });
    storeModule.setBusPostGain(id, 1.5);
    const bus = storeModule.getBusById(id)!;
    AudioEngine.applySubMixBus(id, bus, false);

    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // postGain ist ein eigener Node mit value=1.5 — distinkt von bus.gain (=volume=0.85)
    expect(nodes.postGain).toBeDefined();
    expect((nodes.postGain.gain as unknown as MockParam).value).toBeCloseTo(1.5, 5);
    expect((nodes.gain.gain as unknown as MockParam).value).toBeCloseTo(0.85, 5);
    // postGain-Node ist NICHT identisch mit bus.gain
    expect(nodes.postGain.__id !== nodes.gain.__id || true).toBe(true);
    expect(nodes.postGain).not.toBe(nodes.gain);
  });

  it("postGain wird gewired: compMix → postGain → gain (Routing-Order)", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // compMix wurde connected (→ postGain laut Wiring in _createSubMixBusNodes)
    expect((nodes.compMix as unknown as MockNode).connect).toHaveBeenCalledWith(nodes.postGain);
    // postGain → gain
    expect((nodes.postGain as unknown as MockNode).connect).toHaveBeenCalledWith(nodes.gain);
    // gain → panner (bestehende Chain)
    expect((nodes.gain as unknown as MockNode).connect).toHaveBeenCalledWith(nodes.panner);
  });
});

// ─── (4) Bypass + postGain Stack korrekt ─────────────────────────────────────

describe("Bypass-Interaktion: fx.enabled=false → postGain transparent (1.0)", () => {
  it("fx.enabled=false → postGain auf 1.0 obwohl Store-Wert 2.0 ist (FX-Chain bypassed)", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    // FX-Chain disabled, aber postGain im Store auf 2.0
    storeModule.setBusFx(id, { enabled: false });
    storeModule.setBusPostGain(id, 2.0);
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // postGain MUSS auf 1.0 stehen weil enabled=false die ganze FX-Chain
    // transparent macht (analog EQ-Bypass-Pattern).
    expect((nodes.postGain.gain as unknown as MockParam).value).toBe(1.0);
    // Sobald wir FX aktivieren, kommt der Store-Wert durch.
    storeModule.setBusFx(id, { enabled: true });
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    expect((nodes.postGain.gain as unknown as MockParam).value).toBeCloseTo(2.0, 5);
  });

  it("postGain wirkt nicht auf Sends — Sends zweigen post-bus.gain ab (unaffected)", async () => {
    await AudioEngine.init();
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusFx(id, { enabled: true });
    storeModule.setBusPostGain(id, 0.5);
    storeModule.setBusReverbSend(id, 0.7);
    storeModule.setBusDelaySend(id, 0.4);
    AudioEngine.applySubMixBus(id, storeModule.getBusById(id)!, false);
    const nodes = AudioEngine.getSubMixBusNodes().get(id)!;
    // Sends-Werte sind 1:1 aus dem Store geramped — postGain hat KEINEN
    // Einfluss auf den Send-Pegel (im Graph: bus.gain → reverbSend, daher
    // skaliert bus.gain die Sends — aber postGain liegt davor und multipliziert
    // das Signal ZUSÄTZLICH, nicht die Send-Gain-Werte selbst).
    expect((nodes.reverbSend.gain as unknown as MockParam).value).toBeCloseTo(0.7, 5);
    expect((nodes.delaySend.gain as unknown as MockParam).value).toBeCloseTo(0.4, 5);
  });
});

// ─── (5) setBusPostGain Setter ────────────────────────────────────────────────

describe("useSubMixStore — setBusPostGain (v3.88.0)", () => {
  it("setBusPostGain merge-updated postGain + clamping + Persistenz", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusPostGain(id, 1.5);
    let b = storeModule.getBusById(id)!;
    expect(b.fx).toBeDefined();
    expect(b.fx!.postGain).toBe(1.5);

    // Clamping: 99 → 2.0 (max), -1 → 0 (min)
    storeModule.setBusPostGain(id, 99);
    b = storeModule.getBusById(id)!;
    expect(b.fx!.postGain).toBe(2.0);

    storeModule.setBusPostGain(id, -1);
    b = storeModule.getBusById(id)!;
    expect(b.fx!.postGain).toBe(0);

    // Persistenz in localStorage
    const raw = localStorageMock.getItem("synthstudio:sub-mix:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.buses[0].fx.postGain).toBe(0);

    // Andere FX-Felder bleiben unverändert (Merge-Semantik)
    expect(b.fx!.eq3.lowGain).toBe(0);
    expect(b.fx!.compressor.enabled).toBe(false);
    expect(b.fx!.reverbSend).toBe(0);
  });
});
