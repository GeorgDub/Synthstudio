/**
 * tests/features/master-limiter-lookahead.test.ts (v3.77.0)
 *
 * Closes v3.76 Caveats — drei separate, kleine Verbesserungen am
 * Master-Limiter:
 *   1. Lookahead via DelayNode (5ms) vor dem Compressor
 *      → harte Transienten (Snare/Kick) werden vom Limiter "rückwirkend"
 *        gesehen, Reaktion bevor das Audio die Destination erreicht.
 *   2. Make-Up-Gain Pure-Helper linearToDb / dbToLinear für die
 *      UI-Konvertierung. Store bleibt linear (Backward-Compat zum
 *      .synth-File-Format v1.31), UI zeigt dB.
 *   3. Bypass per Wet/Dry-Crossfade (20ms) statt disconnect/reconnect
 *      → keine Click-Artefakte beim Toggle.
 *
 * Mind. 3 Tests — wir liefern 8.
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

// ─── Mock-AudioContext (mit DynamicsCompressor + DelayNode + Curve-Spy) ──────

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
  // setValueCurveAtTime: nach Ablauf liegt value am letzten Curve-Wert.
  p.setValueCurveAtTime.mockImplementation((curve: Float32Array | number[]) => {
    p.value = curve[curve.length - 1];
  });
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
  __id?: string;
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

let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;
let panel: typeof import("../../client/src/components/Mixer/MasterFxPanel");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  __createdBiquads.length = 0;
  __createdGains.length = 0;
  __createdConvolvers.length = 0;
  __createdDelays.length = 0;
  __createdCompressors.length = 0;
  AudioEngine = (await import("../../client/src/audio/AudioEngine")).AudioEngine;
  panel = await import("../../client/src/components/Mixer/MasterFxPanel");
});

// ─── (1) Lookahead-DelayNode in Audio-Path ───────────────────────────────────

describe("v3.77 Lookahead — 5ms DelayNode vor dem Master-Limiter", () => {
  it("init() erzeugt eine DelayNode mit 5ms delayTime im Limiter-Pfad", async () => {
    await AudioEngine.init();
    // Mind. 1 DelayNode mit delayTime ≈ 0.005s muss erzeugt worden sein.
    const lookahead = __createdDelays.find(
      (d) => d.delayTime !== undefined && Math.abs(d.delayTime.value - 0.005) < 1e-6,
    );
    expect(lookahead).toBeDefined();
  });

  it("Lookahead-DelayNode sitzt zwischen eqHigh und dem Limiter (Audio-Pfad)", async () => {
    await AudioEngine.init();
    expect(__createdBiquads.length).toBeGreaterThanOrEqual(3);
    const eqHigh = __createdBiquads[2];
    const limiter = __createdCompressors[0];
    // eqHigh connectet zur Lookahead-DelayNode.
    const eqHighTargets = eqHigh.connect.mock.calls.map((a: unknown[]) => a[0]);
    const lookahead = eqHighTargets.find(
      (t: unknown) =>
        (t as MockNode)?.delayTime !== undefined
        && Math.abs((t as MockNode).delayTime!.value - 0.005) < 1e-6,
    ) as MockNode | undefined;
    expect(lookahead).toBeDefined();
    // Die Lookahead-DelayNode connectet ihrerseits zum Compressor.
    const lookaheadTargets = lookahead!.connect.mock.calls.map((a: unknown[]) => a[0]);
    expect(lookaheadTargets).toContain(limiter);
  });

  it("Compressor-Attack wurde auf ≤2ms gesenkt (v3.77 war 3ms in v3.76)", async () => {
    await AudioEngine.init();
    const limiter = __createdCompressors[0];
    // v3.77: 1ms statt 3ms. Wir testen ≤ 2ms damit minor-Tuning ohne Test-Bruch.
    expect(limiter.attack?.value).toBeLessThanOrEqual(0.002 + 1e-9);
    expect(limiter.attack?.value).toBeGreaterThanOrEqual(0);
  });
});

// ─── (2) Make-Up dB-Conversion (linearToDb / dbToLinear Pure-Helper) ─────────

describe("v3.77 Make-Up Gain dB-Conversion", () => {
  it("linearToDb: 1.0 → 0 dB, 2.0 → +6.02 dB, 0.5 → -6.02 dB", () => {
    expect(panel.linearToDb(1.0)).toBeCloseTo(0, 3);
    expect(panel.linearToDb(2.0)).toBeCloseTo(6.0206, 3);
    expect(panel.linearToDb(0.5)).toBeCloseTo(-6.0206, 3);
  });

  it("dbToLinear: 0 → 1.0, +12 → ~3.981, -12 → ~0.2512", () => {
    expect(panel.dbToLinear(0)).toBeCloseTo(1.0, 6);
    expect(panel.dbToLinear(12)).toBeCloseTo(3.9811, 3);
    expect(panel.dbToLinear(-12)).toBeCloseTo(0.2512, 3);
  });

  it("Round-Trip linear → dB → linear (verlustfrei innerhalb fp-precision)", () => {
    [0.1, 0.5, 1.0, 1.5, 4.0, 10.0].forEach((linear) => {
      const back = panel.dbToLinear(panel.linearToDb(linear));
      expect(back).toBeCloseTo(linear, 6);
    });
  });

  it("Edge-Cases: linear=0 → DB_MIN (kein -Infinity), NaN-dB → 1.0", () => {
    expect(panel.linearToDb(0)).toBe(panel.LIMITER_GAIN_DB_MIN);
    expect(panel.linearToDb(-1)).toBe(panel.LIMITER_GAIN_DB_MIN);
    expect(panel.dbToLinear(NaN)).toBe(1.0);
    expect(panel.dbToLinear(Infinity)).toBe(1.0);
  });

  it("Slider-Range -12..+24 dB liegt komplett im Store-Clamp 0..16 (kein Clip)", () => {
    expect(panel.dbToLinear(panel.LIMITER_GAIN_DB_MIN)).toBeLessThanOrEqual(16);
    expect(panel.dbToLinear(panel.LIMITER_GAIN_DB_MAX)).toBeLessThanOrEqual(16);
    expect(panel.dbToLinear(panel.LIMITER_GAIN_DB_MAX)).toBeCloseTo(15.849, 2);
  });
});

// ─── (3) Bypass-Crossfade (20ms Wet/Dry-Ramp, kein disconnect) ───────────────

describe("v3.77 Bypass-Crossfade — No-Click", () => {
  it("setMasterLimiterBypass(true) rampt Wet-Gain → 0 und Dry-Gain → 1 ohne disconnect", async () => {
    await AudioEngine.init();
    const eqHigh = __createdBiquads[2];
    eqHigh.disconnect.mockClear();
    // Wet- + Dry-Gain-Nodes finden: müssen unter __createdGains existieren.
    // Wir lesen sie nach dem Toggle aus den setValueCurveAtTime-Spies aus.
    const curveSpiesBefore = __createdGains
      .filter((g) => g.gain)
      .map((g) => g.gain!.setValueCurveAtTime.mock.calls.length);

    AudioEngine.setMasterLimiterBypass(true);

    // KEIN disconnect am eqHigh (klick-frei!)
    expect(eqHigh.disconnect).not.toHaveBeenCalled();

    // Mindestens 2 GainNodes haben einen neuen setValueCurveAtTime-Call
    // (wet + dry).
    let curveCallDelta = 0;
    __createdGains.forEach((g, i) => {
      if (!g.gain) return;
      const before = curveSpiesBefore[i] ?? 0;
      const after = g.gain.setValueCurveAtTime.mock.calls.length;
      if (after > before) curveCallDelta++;
    });
    expect(curveCallDelta).toBeGreaterThanOrEqual(2);
  });

  it("Bypass-Crossfade nutzt Zeitbasis 0.02s (20ms)", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterLimiterBypass(true);
    // Über alle GainNodes finden wir mindestens einen setValueCurveAtTime-
    // Call mit durationArg === 0.02.
    const matching = __createdGains.flatMap((g) =>
      g.gain ? g.gain.setValueCurveAtTime.mock.calls : [],
    );
    const hasXfadeDuration = matching.some(
      (args) => args.length >= 3 && Math.abs((args[2] as number) - 0.02) < 1e-9,
    );
    expect(hasXfadeDuration).toBe(true);
  });

  it("Bypass + Unbypass behält Engine-Memory (Threshold) — keine Routing-Side-Effects", async () => {
    await AudioEngine.init();
    AudioEngine.setMasterLimiterThreshold(-7.5);
    AudioEngine.setMasterLimiterBypass(true);
    AudioEngine.setMasterLimiterBypass(false);
    expect(AudioEngine.getMasterFxSnapshot().limiter.threshold).toBe(-7.5);
    expect(AudioEngine.getMasterFxSnapshot().limiter.bypass).toBe(false);
  });
});
