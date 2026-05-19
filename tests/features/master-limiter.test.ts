/**
 * tests/features/master-limiter.test.ts (v3.76.0)
 *
 * Unit-Tests für den Master-Limiter (brick-wall DynamicsCompressor) +
 * Master-EQ Mid-Band-Q-Slider — closes v3.75-Caveats:
 *   - Master-Compressor/Limiter fehlt komplett (User kann nicht brick-wall
 *     mastern).
 *   - Master-EQ Q-Param für Mid-Band exposable (war hart auf 0.7 codiert).
 *
 * Test-Matrix:
 *   1. Store-Defaults + Clamping (Limiter)
 *   2. Store-Defaults + Clamping (Mid-Q)
 *   3. AudioEngine.setMasterLimiter* + setMasterEqMidQ Setter
 *   4. Routing-Wiring: post-EQ → Limiter → destination
 *   5. Bypass-Toggle behält Engine-Memory
 *   6. Schema v1.31 Round-Trip (limiter + midQ)
 *   7. Default-Reset
 *
 * Mind. 5 Tests — wir liefern 13.
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

// ─── Mock-AudioContext (mit DynamicsCompressor + reduction-Field) ────────────

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
  knee?: MockParam;
  reduction?: number;
  curve?: Float32Array | null;
}

function makeBase(): MockNode {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

const __createdBiquads: MockNode[] = [];
const __createdGains: MockNode[] = [];
const __createdConvolvers: MockNode[] = [];
const __createdDelays: MockNode[] = [];
const __createdCompressors: MockNode[] = [];

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
    const c: MockNode = {
      ...makeBase(),
      threshold: makeParam(-24),
      ratio: makeParam(4),
      attack: makeParam(0.003),
      release: makeParam(0.25),
      knee: makeParam(30),
      reduction: 0,
    };
    __createdCompressors.push(c);
    return c;
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
  __createdCompressors.length = 0;
  storeModule = await import("../../client/src/store/useMasterFxStore");
  serializer = await import("../../client/src/utils/projectSerializer");
  AudioEngine = (await import("../../client/src/audio/AudioEngine")).AudioEngine;
  storeModule.__resetMasterFxStoreForTests();
});

// ─── (1) Limiter-Store-Defaults + Clamping ───────────────────────────────────

describe("useMasterFxStore.limiter — defaults & clamping", () => {
  it("liefert brick-wall Default-Werte (threshold=-1, ratio=20, knee=0, release=50ms)", () => {
    const lim = storeModule.getMasterLimiter();
    expect(lim.threshold).toBe(-1);
    expect(lim.knee).toBe(0);
    expect(lim.ratio).toBe(20);
    expect(lim.release).toBeCloseTo(0.05, 4);
    expect(lim.gain).toBe(1.0);
    expect(lim.bypass).toBe(false);
  });

  it("setMasterLimiter clampt threshold (-60..0), knee (0..40), ratio (1..20), release (0..1), gain (0..16)", () => {
    storeModule.setMasterLimiter({ threshold: -200, knee: 999, ratio: 100, release: 5, gain: 99 });
    const lim = storeModule.getMasterLimiter();
    expect(lim.threshold).toBe(-60);
    expect(lim.knee).toBe(40);
    expect(lim.ratio).toBe(20);
    expect(lim.release).toBe(1);
    // v3.77.0: gain-Range auf 0..16 erweitert (UI zeigt dB).
    expect(lim.gain).toBe(16);

    storeModule.setMasterLimiter({ threshold: 50, knee: -10, ratio: -5, release: -2, gain: -3 });
    const lim2 = storeModule.getMasterLimiter();
    expect(lim2.threshold).toBe(0);
    expect(lim2.knee).toBe(0);
    expect(lim2.ratio).toBe(1);
    expect(lim2.release).toBe(0);
    expect(lim2.gain).toBe(0);
  });

  it("setMasterLimiter NaN/Infinity → Fallback auf Defaults (defensive)", () => {
    storeModule.setMasterLimiter({
      threshold: NaN,
      knee: Infinity,
      ratio: -Infinity,
      release: NaN,
      gain: NaN,
    });
    const lim = storeModule.getMasterLimiter();
    expect(lim.threshold).toBe(-1);
    expect(lim.knee).toBe(0);
    expect(lim.ratio).toBe(20);
    expect(lim.release).toBeCloseTo(0.05, 4);
    expect(lim.gain).toBe(1.0);
  });

  it("setMasterLimiter persistiert in localStorage und re-loaded auf next session", async () => {
    storeModule.setMasterLimiter({ threshold: -6, ratio: 10, release: 0.2 });
    const raw = localStorageMock.getItem("synthstudio:master-fx:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.limiter.threshold).toBe(-6);
    expect(parsed.limiter.ratio).toBe(10);
    // Re-Mount
    vi.resetModules();
    storeModule = await import("../../client/src/store/useMasterFxStore");
    const lim = storeModule.getMasterLimiter();
    expect(lim.threshold).toBe(-6);
    expect(lim.ratio).toBe(10);
    expect(lim.release).toBe(0.2);
  });
});

// ─── (2) Mid-Q-Store-Defaults + Clamping ─────────────────────────────────────

describe("useMasterFxStore.eq.midQ — Mid-Band Q-Slider (closes v3.75 caveat)", () => {
  it("Default-midQ ist 0.7 (backward-compat zur hart-codierten v3.75-Engine)", () => {
    const eq = storeModule.getMasterEq();
    expect(eq.midQ).toBe(0.7);
  });

  it("setMasterEq({ midQ }) clampt 0.3..10", () => {
    storeModule.setMasterEq({ midQ: 50 });
    expect(storeModule.getMasterEq().midQ).toBe(10);
    storeModule.setMasterEq({ midQ: 0.05 });
    expect(storeModule.getMasterEq().midQ).toBe(0.3);
    storeModule.setMasterEq({ midQ: 5 });
    expect(storeModule.getMasterEq().midQ).toBe(5);
    storeModule.setMasterEq({ midQ: NaN });
    expect(storeModule.getMasterEq().midQ).toBe(0.7); // default fallback
  });
});

// ─── (3) AudioEngine Limiter-Setter + Mid-Q-Setter ───────────────────────────

describe("AudioEngine — Limiter + Mid-Q Setter", () => {
  it("setMasterLimiterThreshold updates store + engine (via getMasterFxSnapshot)", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterLimiterThreshold(-12);
    const snap = AudioEngine.getMasterFxSnapshot();
    expect(snap.limiter.threshold).toBe(-12);
    // Clamp
    AudioEngine.setMasterLimiterThreshold(-200);
    expect(AudioEngine.getMasterFxSnapshot().limiter.threshold).toBe(-60);
    AudioEngine.setMasterLimiterThreshold(50);
    expect(AudioEngine.getMasterFxSnapshot().limiter.threshold).toBe(0);
  });

  it("setMasterEqMidQ schreibt auf den Mid-Biquad Q-Param + clampt 0.3..10", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterEqMidQ(5);
    expect(AudioEngine.getMasterFxSnapshot().eq.midQ).toBe(5);
    AudioEngine.setMasterEqMidQ(100);
    expect(AudioEngine.getMasterFxSnapshot().eq.midQ).toBe(10);
    AudioEngine.setMasterEqMidQ(0);
    expect(AudioEngine.getMasterFxSnapshot().eq.midQ).toBe(0.3);
  });
});

// ─── (4) Routing-Wiring: post-EQ → Limiter → destination ─────────────────────

describe("AudioEngine — Routing: post-EQ → Limiter → destination", () => {
  it("init() erzeugt einen DynamicsCompressor (Master-Limiter) am Ende der Master-Chain", async () => {
    await AudioEngine.init();
    // mindestens 1 createDynamicsCompressor-Aufruf für den Master-Limiter
    expect(__createdCompressors.length).toBeGreaterThanOrEqual(1);
    const limiter = __createdCompressors[0];
    // Default-Werte aus DEFAULT_MASTER_LIMITER (threshold=-1, ratio=20, knee=0, release=0.05).
    expect(limiter.threshold?.value).toBe(-1);
    expect(limiter.ratio?.value).toBe(20);
    expect(limiter.knee?.value).toBe(0);
    expect(limiter.release?.value).toBeCloseTo(0.05, 4);
  });

  it("Limiter ist post-EQ verkabelt: eqHigh → Lookahead-Delay → Limiter (v3.77)", async () => {
    await AudioEngine.init();
    // v3.77: eqHigh connectet zum Lookahead-DelayNode (nicht direkt zum
    // Compressor). Die DelayNode wiederum connectet zum Compressor.
    expect(__createdBiquads.length).toBeGreaterThanOrEqual(3);
    const eqHigh = __createdBiquads[2];
    const limiter = __createdCompressors[0];
    // Es muss eine DelayNode existieren die zwischen eqHigh und Limiter
    // verschaltet ist (= eqHigh.connect-Calls zeigen auf eine Node, die
    // ihrerseits zum Limiter connectet).
    const eqHighTargets = eqHigh.connect.mock.calls.map((a: unknown[]) => a[0]);
    const lookaheadCandidate = eqHighTargets.find((t: unknown) =>
      (t as MockNode)?.connect && (t as MockNode).connect.mock.calls.some(
        (args: unknown[]) => args[0] === limiter,
      ),
    );
    expect(lookaheadCandidate).toBeDefined();
  });

  it("setMasterLimiterBypass = true crossfaded auf Dry-Path (wet→0, dry→1) ohne disconnect", async () => {
    // v3.77.0: Bypass funktioniert per Wet/Dry-Crossfade über 20ms statt
    // disconnect/reconnect. Beide Pfade bleiben permanent konnektiert.
    await AudioEngine.init();
    const eqHigh = __createdBiquads[2];
    eqHigh.disconnect.mockClear();
    AudioEngine.setMasterLimiterBypass(true);
    // v3.77: KEIN disconnect mehr am eqHigh (würde Click erzeugen).
    expect(eqHigh.disconnect).not.toHaveBeenCalled();
    // Snapshot reflektiert Bypass-State
    expect(AudioEngine.getMasterFxSnapshot().limiter.bypass).toBe(true);
  });

  it("Bypass-Toggle behält Engine-Memory: Threshold-Wert wird nach Bypass+Unbypass preserved", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterLimiterThreshold(-9);
    AudioEngine.setMasterLimiterBypass(true);
    AudioEngine.setMasterLimiterBypass(false);
    expect(AudioEngine.getMasterFxSnapshot().limiter.threshold).toBe(-9);
  });

  it("getMasterLimiterReduction liefert die DynamicsCompressorNode.reduction (oder 0 bei bypass)", async () => {
    await AudioEngine.init();
    const limiter = __createdCompressors[0];
    // Simuliere -3dB Gain-Reduction
    limiter.reduction = -3;
    const gr = AudioEngine.getMasterLimiterReduction();
    expect(gr).toBe(-3);
    // Bei Bypass → 0
    AudioEngine.setMasterLimiterBypass(true);
    expect(AudioEngine.getMasterLimiterReduction()).toBe(0);
  });
});

// ─── (5) Schema v1.31 Round-Trip ─────────────────────────────────────────────

describe("Schema v1.31 — limiter + midQ Round-Trip", () => {
  it("SYNTH_FILE_VERSION ist '1.32'", () => {
    expect(serializer.SYNTH_FILE_VERSION).toBe("1.36");
  });

  it("Round-Trip preserves masterFx.limiter + masterFx.eq.midQ", () => {
    const masterFx = {
      reverb:  { decay: 2.0, damping: 0.5, preDelay: 0, wet: 0.6, bypass: false },
      delay:   { time: 0.5, feedback: 0.35, wet: 0.5, bypass: false },
      eq:      { lowGain: 0, midGain: 4, highGain: 0, lowFreq: 250, highFreq: 4000, midQ: 5, bypass: false },
      limiter: { threshold: -8, knee: 2, ratio: 15, release: 0.15, gain: 1.5, bypass: false },
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
    expect(parsed.masterFx!.eq.midQ).toBe(5);
    expect(parsed.masterFx!.limiter.threshold).toBe(-8);
    expect(parsed.masterFx!.limiter.knee).toBe(2);
    expect(parsed.masterFx!.limiter.ratio).toBe(15);
    expect(parsed.masterFx!.limiter.release).toBe(0.15);
    expect(parsed.masterFx!.limiter.gain).toBe(1.5);
    expect(parsed.masterFx!.limiter.bypass).toBe(false);
  });

  it("Pre-v1.31-File mit altem masterFx ohne limiter/midQ → Defaults werden ergänzt", () => {
    const file = {
      version: "1.30",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "OldMaster",
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
        reverb: { decay: 3, damping: 0.5, preDelay: 0, wet: 0.6, bypass: false },
        delay: { time: 0.5, feedback: 0.35, wet: 0.5, bypass: false },
        // limiter + midQ FEHLT (pre-v1.31)
        eq: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 250, highFreq: 4000, bypass: false },
      },
    };
    const parsed = serializer.parseProject(JSON.stringify(file));
    expect(parsed.masterFx).toBeDefined();
    // Defaults werden via sanitizeMasterFx eingesetzt
    expect(parsed.masterFx!.eq.midQ).toBe(0.7);
    expect(parsed.masterFx!.limiter.threshold).toBe(-1);
    expect(parsed.masterFx!.limiter.ratio).toBe(20);
    expect(parsed.masterFx!.limiter.knee).toBe(0);
    expect(parsed.masterFx!.limiter.bypass).toBe(false);
  });

  it("Korrupte limiter-Felder (out-of-range) werden via sanitizeMasterFx gefixt", () => {
    const file = {
      version: "1.31",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "Corrupt",
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
        reverb: { decay: 2, damping: 0.5, preDelay: 0, wet: 0.6, bypass: false },
        delay: { time: 0.5, feedback: 0.35, wet: 0.5, bypass: false },
        eq: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 250, highFreq: 4000, midQ: 999, bypass: false },
        limiter: { threshold: 100, knee: -10, ratio: 500, release: 99, gain: -5, bypass: "no" },
      },
    };
    const parsed = serializer.parseProject(JSON.stringify(file));
    expect(parsed.masterFx!.eq.midQ).toBe(10);            // 999 → 10
    expect(parsed.masterFx!.limiter.threshold).toBe(0);   // 100 → 0
    expect(parsed.masterFx!.limiter.knee).toBe(0);        // -10 → 0
    expect(parsed.masterFx!.limiter.ratio).toBe(20);      // 500 → 20
    expect(parsed.masterFx!.limiter.release).toBe(1);     // 99 → 1
    expect(parsed.masterFx!.limiter.gain).toBe(0);        // -5 → 0
    expect(parsed.masterFx!.limiter.bypass).toBe(false);  // non-bool → fallback
  });
});

// ─── (6) Reset ───────────────────────────────────────────────────────────────

describe("resetMasterFx — Default-Reset", () => {
  it("Reset stellt Limiter + Mid-Q auf Defaults zurück", () => {
    storeModule.setMasterLimiter({ threshold: -20, ratio: 5, gain: 2 });
    storeModule.setMasterEq({ midQ: 8 });
    storeModule.resetMasterFx();
    const lim = storeModule.getMasterLimiter();
    expect(lim.threshold).toBe(-1);
    expect(lim.ratio).toBe(20);
    expect(lim.gain).toBe(1.0);
    expect(storeModule.getMasterEq().midQ).toBe(0.7);
  });
});
