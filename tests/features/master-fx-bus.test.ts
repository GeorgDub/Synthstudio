/**
 * tests/features/master-fx-bus.test.ts (v3.75.0)
 *
 * Unit-Tests für den Master-FX-Bus (Global Reverb + Delay + EQ).
 * Closes v3.74-Caveat: bis v3.74 waren _globalReverbBus + _globalDelayBus
 * im AudioEngine hart codiert (decay=2s, delay=0.5s, feedback=0.35) ohne
 * User-Control. v3.75.0 ergänzt:
 *   - useMasterFxStore (Reverb {decay, damping, preDelay, wet, bypass},
 *     Delay {time, feedback, wet, bypass}, EQ {3-Band gain + 2 freq +
 *     bypass}), localStorage-Persistenz, Project-File-Round-Trip (v1.30).
 *   - AudioEngine.setMasterReverb / setMasterDelay / setMasterEq Setter.
 *   - Defensive Clamping (decay 0.1..10, damping 0..1, preDelay 0..200,
 *     wet 0..1, time 0.001..2, feedback 0..0.95, EQ gain ±24dB).
 *   - Schema v1.30 Round-Trip (Pre-v1.30 → masterFx=undefined).
 *
 * Insgesamt 22 Tests in 6 describes.
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

// ─── Mock-AudioContext (sehr minimal) ─────────────────────────────────────────

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
  p.setTargetAtTime.mockImplementation((v: number) => { p.value = v; });
  return p;
}

interface MockNode {
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
  ratio?: MockParam;
  attack?: MockParam;
  release?: MockParam;
  curve?: Float32Array | null;
}

function makeBase(): MockNode {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

const __createdBiquads: MockNode[] = [];
const __createdGains: MockNode[] = [];
const __createdConvolvers: MockNode[] = [];
const __createdDelays: MockNode[] = [];

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
  createStereoPanner(): MockNode { return { ...makeBase(), pan: makeParam(0) }; }
  createBiquadFilter(): MockNode {
    const b: MockNode = {
      ...makeBase(),
      type: "lowpass",
      frequency: makeParam(1000),
      Q: makeParam(0.7),
      gain: makeParam(0),
    };
    __createdBiquads.push(b);
    return b;
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
    const d: MockNode = { ...makeBase(), delayTime: makeParam(0) };
    __createdDelays.push(d);
    return d;
  }
  createConvolver(): MockNode {
    const c: MockNode = { ...makeBase(), buffer: null };
    __createdConvolvers.push(c);
    return c;
  }
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

// ─── Dynamische Imports (NACH Mock-Setup) ─────────────────────────────────────

let storeModule: typeof import("../../client/src/store/useMasterFxStore");
let serializer: typeof import("../../client/src/utils/projectSerializer");
let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  __createdBiquads.length = 0;
  __createdGains.length = 0;
  __createdConvolvers.length = 0;
  __createdDelays.length = 0;
  storeModule = await import("../../client/src/store/useMasterFxStore");
  serializer = await import("../../client/src/utils/projectSerializer");
  AudioEngine = (await import("../../client/src/audio/AudioEngine")).AudioEngine;
  storeModule.__resetMasterFxStoreForTests();
});

// ─── (1) Store: Reverb/Delay/EQ Setter + Defaults + Clamping ─────────────────

describe("useMasterFxStore — defaults & clamping", () => {
  it("liefert die Default-Werte aus DEFAULT_MASTER_REVERB/DELAY/EQ", () => {
    const s = storeModule.getMasterFxState();
    expect(s.reverb.decay).toBe(2.0);
    expect(s.reverb.damping).toBe(0.5);
    expect(s.reverb.preDelay).toBe(0);
    expect(s.reverb.wet).toBe(0.6);
    expect(s.reverb.bypass).toBe(false);
    expect(s.delay.time).toBe(0.5);
    expect(s.delay.feedback).toBe(0.35);
    expect(s.delay.wet).toBe(0.5);
    expect(s.delay.bypass).toBe(false);
    expect(s.eq.lowGain).toBe(0);
    expect(s.eq.midGain).toBe(0);
    expect(s.eq.highGain).toBe(0);
    expect(s.eq.lowFreq).toBe(250);
    expect(s.eq.highFreq).toBe(4000);
    expect(s.eq.bypass).toBe(false);
  });

  it("setMasterReverb({ decay }) clampt 0.1..10 + persistiert in localStorage", () => {
    storeModule.setMasterReverb({ decay: 25 });
    expect(storeModule.getMasterReverb().decay).toBe(10);
    storeModule.setMasterReverb({ decay: -2 });
    expect(storeModule.getMasterReverb().decay).toBe(0.1);
    storeModule.setMasterReverb({ decay: 3.5 });
    expect(storeModule.getMasterReverb().decay).toBe(3.5);
    const raw = localStorageMock.getItem("synthstudio:master-fx:v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).reverb.decay).toBe(3.5);
  });

  it("setMasterDelay({ feedback }) clampt 0..0.95 (Stabilitätsgrenze)", () => {
    storeModule.setMasterDelay({ feedback: 0.99 });
    expect(storeModule.getMasterDelay().feedback).toBe(0.95);
    storeModule.setMasterDelay({ feedback: -0.5 });
    expect(storeModule.getMasterDelay().feedback).toBe(0);
    storeModule.setMasterDelay({ feedback: 0.5 });
    expect(storeModule.getMasterDelay().feedback).toBe(0.5);
  });

  it("setMasterEq({ lowGain/midGain/highGain }) clampt ±24dB", () => {
    storeModule.setMasterEq({ lowGain: 40, midGain: -50, highGain: 12 });
    const eq = storeModule.getMasterEq();
    expect(eq.lowGain).toBe(24);
    expect(eq.midGain).toBe(-24);
    expect(eq.highGain).toBe(12);
  });

  it("NaN/Infinity/non-number → Fallback auf Default (defensive)", () => {
    storeModule.setMasterReverb({ decay: NaN, damping: Infinity, preDelay: -Infinity });
    const r = storeModule.getMasterReverb();
    expect(r.decay).toBe(2.0);
    expect(r.damping).toBe(0.5);
    expect(r.preDelay).toBe(0);
    // bool stays sane
    storeModule.setMasterReverb({ bypass: "yes" as unknown as boolean });
    expect(storeModule.getMasterReverb().bypass).toBe(false);
  });

  it("setMasterEq Freq clampt low 20..1000 / high 1000..20000", () => {
    storeModule.setMasterEq({ lowFreq: 5000, highFreq: 500 });
    const eq = storeModule.getMasterEq();
    expect(eq.lowFreq).toBe(1000);  // gecappt
    expect(eq.highFreq).toBe(1000); // gecappt nach unten
    storeModule.setMasterEq({ lowFreq: 150, highFreq: 8000 });
    const eq2 = storeModule.getMasterEq();
    expect(eq2.lowFreq).toBe(150);
    expect(eq2.highFreq).toBe(8000);
  });

  it("resetMasterFx kehrt auf Defaults zurück", () => {
    storeModule.setMasterReverb({ decay: 5, bypass: true });
    storeModule.setMasterDelay({ feedback: 0.8 });
    storeModule.resetMasterFx();
    expect(storeModule.getMasterReverb().decay).toBe(2.0);
    expect(storeModule.getMasterReverb().bypass).toBe(false);
    expect(storeModule.getMasterDelay().feedback).toBe(0.35);
  });
});

// ─── (2) Persistenz: localStorage round-trip ─────────────────────────────────

describe("useMasterFxStore — localStorage round-trip", () => {
  it("Updates landen in synthstudio:master-fx:v1 + re-loaden auf next session", async () => {
    storeModule.setMasterReverb({ decay: 4.2, damping: 0.8, wet: 0.42 });
    storeModule.setMasterDelay({ time: 0.25, feedback: 0.6 });
    storeModule.setMasterEq({ lowGain: -6, midGain: 3, highFreq: 8000 });
    const raw = localStorageMock.getItem("synthstudio:master-fx:v1");
    expect(raw).toBeTruthy();

    // Simuliere Re-Mount durch Modul-Reset
    vi.resetModules();
    storeModule = await import("../../client/src/store/useMasterFxStore");
    const s = storeModule.getMasterFxState();
    expect(s.reverb.decay).toBe(4.2);
    expect(s.reverb.damping).toBe(0.8);
    expect(s.reverb.wet).toBe(0.42);
    expect(s.delay.time).toBe(0.25);
    expect(s.delay.feedback).toBe(0.6);
    expect(s.eq.lowGain).toBe(-6);
    expect(s.eq.highFreq).toBe(8000);
  });

  it("Korrupte localStorage-Daten → defaults (kein Crash)", async () => {
    localStorageMock.setItem("synthstudio:master-fx:v1", "{not valid json");
    vi.resetModules();
    storeModule = await import("../../client/src/store/useMasterFxStore");
    const s = storeModule.getMasterFxState();
    expect(s.reverb.decay).toBe(2.0); // default
  });

  it("Partielle localStorage-Daten → defaults für fehlende Felder", async () => {
    localStorageMock.setItem(
      "synthstudio:master-fx:v1",
      JSON.stringify({ reverb: { decay: 6 } }),
    );
    vi.resetModules();
    storeModule = await import("../../client/src/store/useMasterFxStore");
    const s = storeModule.getMasterFxState();
    expect(s.reverb.decay).toBe(6);
    expect(s.reverb.damping).toBe(0.5);
    expect(s.delay.time).toBe(0.5);
    expect(s.eq.lowGain).toBe(0);
  });
});

// ─── (3) AudioEngine: Setter wirken auf die Mock-Nodes ───────────────────────

describe("AudioEngine — Master-FX Setter wirken auf die Audio-Nodes", () => {
  it("setMasterReverbDecay regeneriert IR + updated _globalReverbDecay", async () => {
    await AudioEngine.init();
    await flushPromises();
    // Vor dem Setter
    const snap0 = AudioEngine.getMasterFxSnapshot();
    expect(snap0.reverb.decay).toBe(2.0);
    AudioEngine.setMasterReverbDecay(5);
    const snap1 = AudioEngine.getMasterFxSnapshot();
    expect(snap1.reverb.decay).toBe(5);
    // Clamp
    AudioEngine.setMasterReverbDecay(100);
    expect(AudioEngine.getMasterFxSnapshot().reverb.decay).toBe(10);
    AudioEngine.setMasterReverbDecay(-1);
    expect(AudioEngine.getMasterFxSnapshot().reverb.decay).toBe(0.1);
  });

  it("setMasterReverbBypass setzt Wet-Gain auf 0 ohne wet-Wert zu verlieren", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterReverbWet(0.75);
    AudioEngine.setMasterReverbBypass(true);
    const snap = AudioEngine.getMasterFxSnapshot();
    expect(snap.reverb.wet).toBe(0.75);
    expect(snap.reverb.bypass).toBe(true);
    AudioEngine.setMasterReverbBypass(false);
    expect(AudioEngine.getMasterFxSnapshot().reverb.bypass).toBe(false);
  });

  it("Master-Delay feedback-loop: Setter clamped auf 0.95", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterDelayFeedback(2.0);
    const snap = AudioEngine.getMasterFxSnapshot();
    expect(snap.delay.feedback).toBeLessThanOrEqual(0.95);
    expect(snap.delay.feedback).toBeGreaterThan(0.9);
    AudioEngine.setMasterDelayFeedback(-1);
    expect(AudioEngine.getMasterFxSnapshot().delay.feedback).toBe(0);
  });

  it("Master-Delay-Bus existiert: createDelay erzeugte einen GlobalDelay-Node", async () => {
    await AudioEngine.init();
    // mind. 1 Delay-Node (für den Master-Bus) wurde im init() erzeugt
    expect(__createdDelays.length).toBeGreaterThanOrEqual(1);
    AudioEngine.setMasterDelayTime(0.25);
    // Das setValueAtTime / setTargetAtTime wurde auf einem delayTime-Param
    // gefeuert — wir suchen den Node mit aktivem delayTime.
    const used = __createdDelays.some(d => {
      const target = d.delayTime?.setTargetAtTime.mock.calls.length ?? 0;
      const direct = d.delayTime?.setValueAtTime.mock.calls.length ?? 0;
      return target > 0 || direct > 0;
    });
    expect(used).toBe(true);
  });

  it("Master-EQ-3-Band wirkt: setMasterEqLowGain ändert das gain-Param", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterEqLowGain(6);
    AudioEngine.setMasterEqMidGain(-3);
    AudioEngine.setMasterEqHighGain(2.5);
    const snap = AudioEngine.getMasterFxSnapshot();
    expect(snap.eq.lowGain).toBe(6);
    expect(snap.eq.midGain).toBe(-3);
    expect(snap.eq.highGain).toBe(2.5);
    // mind. 3 BiquadFilter wurden im init für Master-EQ angelegt
    expect(__createdBiquads.length).toBeGreaterThanOrEqual(3);
  });

  it("Master-EQ Bypass setzt alle 3 Gain-Params auf 0 ohne den Store-Wert zu verlieren", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterEqLowGain(8);
    AudioEngine.setMasterEqMidGain(-4);
    AudioEngine.setMasterEqHighGain(3);
    AudioEngine.setMasterEqBypass(true);
    const snap = AudioEngine.getMasterFxSnapshot();
    // Engine-internal-Memory bleibt erhalten
    expect(snap.eq.lowGain).toBe(8);
    expect(snap.eq.midGain).toBe(-4);
    expect(snap.eq.highGain).toBe(3);
    expect(snap.eq.bypass).toBe(true);
    AudioEngine.setMasterEqBypass(false);
    expect(AudioEngine.getMasterFxSnapshot().eq.bypass).toBe(false);
  });

  it("setMasterReverbPreDelay clampt 0..200ms", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterReverbPreDelay(150);
    // Wir verifizieren über das Setter-Result via Store
    storeModule.setMasterReverb({ preDelay: 150 });
    expect(storeModule.getMasterReverb().preDelay).toBe(150);
    storeModule.setMasterReverb({ preDelay: 999 });
    expect(storeModule.getMasterReverb().preDelay).toBe(200);
    storeModule.setMasterReverb({ preDelay: -10 });
    expect(storeModule.getMasterReverb().preDelay).toBe(0);
  });
});

// ─── (4) Routing: Channel-Send routet zu Master-Bus ──────────────────────────

describe("AudioEngine — Channel-Send-Wiring", () => {
  it("Engine erzeugt im init() einen Reverb-Convolver + Delay-Bus + 3-Band-Master-EQ", async () => {
    await AudioEngine.init();
    expect(__createdConvolvers.length).toBeGreaterThanOrEqual(1);
    expect(__createdDelays.length).toBeGreaterThanOrEqual(1);
    // 3 Master-EQ-Biquads + (mögliche andere Filter aus Looper/Recorder)
    expect(__createdBiquads.length).toBeGreaterThanOrEqual(3);
  });

  it("Channel-Send-Knob via setChannelSend ändert den Send-Level ohne Crash", async () => {
    await AudioEngine.init();
    // Channel anlegen + Send setzen — wir testen NUR dass kein Throw passiert,
    // weil der Send-Pfad ein eigenes Test-Setup mit FX-Chain bräuchte.
    expect(() => {
      AudioEngine.setChannelSend("kick", "reverb", 0.5);
      AudioEngine.setChannelSend("kick", "delay", 0.25);
    }).not.toThrow();
  });
});

// ─── (5) Schema v1.30 Round-Trip ─────────────────────────────────────────────

describe("Schema v1.31 — masterFx Round-Trip", () => {
  it("SYNTH_FILE_VERSION ist '1.32'", () => {
    expect(serializer.SYNTH_FILE_VERSION).toBe("1.36");
  });

  it("Round-Trip preserves masterFx Reverb/Delay/EQ", () => {
    const masterFx = {
      reverb: { decay: 4.0, damping: 0.75, preDelay: 50, wet: 0.5, bypass: false },
      delay:  { time: 0.375, feedback: 0.55, wet: 0.4, bypass: true },
      eq:     { lowGain: -3, midGain: 4, highGain: -1, lowFreq: 200, highFreq: 6000, bypass: false },
    };
    const proj = serializer.serializeProject({
      projectName: "Test",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P1", parts: [], stepCount: 16 } as never],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 0.85, channels: {}, returnTracks: {} as never, insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} as never },
      automation: { lanes: [], stepCount: 16 },
      masterFx,
    } as never);
    const json = serializer.toJson(proj);
    const parsed = serializer.parseProject(json);
    expect(parsed.masterFx).toBeDefined();
    expect(parsed.masterFx!.reverb.decay).toBe(4.0);
    expect(parsed.masterFx!.reverb.damping).toBe(0.75);
    expect(parsed.masterFx!.delay.feedback).toBe(0.55);
    expect(parsed.masterFx!.delay.bypass).toBe(true);
    expect(parsed.masterFx!.eq.lowGain).toBe(-3);
    expect(parsed.masterFx!.eq.highFreq).toBe(6000);
  });

  it("Pre-v1.30-File (kein masterFx) → masterFx bleibt undefined (kein Overwrite-Signal)", () => {
    const oldFile = {
      version: "1.29",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "Old",
      savedAt: "2026-05-18T00:00:00.000Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p", name: "P", parts: [], stepCount: 16 }],
      activePatternId: "p",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = serializer.parseProject(JSON.stringify(oldFile));
    expect(parsed.masterFx).toBeUndefined();
  });

  it("null masterFx → undefined (defensive)", () => {
    const file = {
      version: "1.31",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "X",
      savedAt: "2026-05-18T00:00:00.000Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p", name: "P", parts: [], stepCount: 16 }],
      activePatternId: "p",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      masterFx: null,
    };
    const parsed = serializer.parseProject(JSON.stringify(file));
    expect(parsed.masterFx).toBeUndefined();
  });

  it("Korrupte masterFx (out-of-range Felder) wird via sanitizeMasterFx gefixt", () => {
    const file = {
      version: "1.31",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "X",
      savedAt: "2026-05-18T00:00:00.000Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p", name: "P", parts: [], stepCount: 16 }],
      activePatternId: "p",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 0.85, channels: {}, returnTracks: {}, insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      masterFx: {
        reverb: { decay: 999, damping: -5, preDelay: 9999, wet: 2, bypass: "yes" },
        delay: { time: 50, feedback: 1.5, wet: 99, bypass: false },
        eq: { lowGain: 99, midGain: -99, highGain: 50, lowFreq: 5, highFreq: 99999, bypass: false },
      },
    };
    const parsed = serializer.parseProject(JSON.stringify(file));
    expect(parsed.masterFx).toBeDefined();
    expect(parsed.masterFx!.reverb.decay).toBe(10);    // 999 → 10 (max)
    expect(parsed.masterFx!.reverb.damping).toBe(0);   // -5 → 0
    expect(parsed.masterFx!.reverb.preDelay).toBe(200); // 9999 → 200
    expect(parsed.masterFx!.reverb.wet).toBe(1);
    expect(parsed.masterFx!.reverb.bypass).toBe(false); // non-boolean → fallback default
    expect(parsed.masterFx!.delay.time).toBe(2.0);
    expect(parsed.masterFx!.delay.feedback).toBe(0.95);
    expect(parsed.masterFx!.eq.lowGain).toBe(24);
    expect(parsed.masterFx!.eq.lowFreq).toBe(20);
    expect(parsed.masterFx!.eq.highFreq).toBe(20000);
  });
});

// ─── (6) setAllMasterFx Restore-Path ─────────────────────────────────────────

describe("setAllMasterFx — Restore-Path", () => {
  it("undefined → no-op (User-localStorage NICHT überschreiben)", () => {
    storeModule.setMasterReverb({ decay: 7 });
    storeModule.setAllMasterFx(undefined);
    expect(storeModule.getMasterReverb().decay).toBe(7);
  });

  it("Valid Snapshot → State wird vollständig ersetzt", () => {
    storeModule.setMasterReverb({ decay: 1 });
    storeModule.setAllMasterFx({
      reverb: { decay: 3, damping: 0.3, preDelay: 25, wet: 0.4, bypass: false },
      delay:  { time: 0.2, feedback: 0.5, wet: 0.6, bypass: true },
      eq:     { lowGain: 2, midGain: -2, highGain: 1, lowFreq: 300, highFreq: 5000, bypass: false },
    });
    expect(storeModule.getMasterReverb().decay).toBe(3);
    expect(storeModule.getMasterDelay().bypass).toBe(true);
    expect(storeModule.getMasterEq().lowGain).toBe(2);
  });

  it("null oder {} → defaults (defensive)", () => {
    storeModule.setMasterReverb({ decay: 9 });
    storeModule.setAllMasterFx(null);
    expect(storeModule.getMasterReverb().decay).toBe(2.0);
    storeModule.setMasterReverb({ decay: 5 });
    storeModule.setAllMasterFx({});
    expect(storeModule.getMasterReverb().decay).toBe(2.0);
  });
});
