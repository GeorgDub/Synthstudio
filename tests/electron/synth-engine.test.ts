/**
 * synth-engine.test.ts
 *
 * Tests für SynthEngine (Phase 5) – mit Web Audio API Mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SynthParams } from "../../client/src/audio/SynthEngine";
import { DEFAULT_SYNTH_PARAMS } from "../../client/src/audio/SynthEngine";

// ─── Web Audio API Mock ───────────────────────────────────────────────────────

function makeOscillatorMock() {
  return {
    type: "sine" as OscillatorType,
    frequency: { value: 440, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    detune: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}
function makeGainMock() {
  return {
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  };
}

function makeAudioContextMock() {
  return {
    currentTime: 0,
    createOscillator: vi.fn(() => makeOscillatorMock()),
    createGain: vi.fn(() => makeGainMock()),
    destination: {},
  } as unknown as AudioContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SynthParams – Defaults und Validierung", () => {
  it("DEFAULT_SYNTH_PARAMS hat alle Pflichtfelder", () => {
    expect(DEFAULT_SYNTH_PARAMS.mode).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.oscType).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.detune).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.fmRatio).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.fmDepth).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.attack).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.decay).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.sustain).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.release).toBeDefined();
    expect(DEFAULT_SYNTH_PARAMS.lfoEnabled).toBeDefined();
  });

  it("mode=wavetable ist der Standard-Modus", () => {
    expect(DEFAULT_SYNTH_PARAMS.mode).toBe("wavetable");
  });

  it("ADSR attack=0.01 ist ein sinnvoller Standard-Wert", () => {
    expect(DEFAULT_SYNTH_PARAMS.attack).toBeGreaterThan(0);
    expect(DEFAULT_SYNTH_PARAMS.attack).toBeLessThanOrEqual(2);
  });

  it("LFO ist standardmäßig deaktiviert", () => {
    expect(DEFAULT_SYNTH_PARAMS.lfoEnabled).toBe(false);
  });

  it("FM-Ratio ist standardmäßig 2 (Oktave über dem Carrier)", () => {
    expect(DEFAULT_SYNTH_PARAMS.fmRatio).toBe(2);
  });
});

describe("SynthEngine.triggerNote()", () => {
  let ctx: ReturnType<typeof makeAudioContextMock>;
  let destination: ReturnType<typeof makeGainMock>;

  beforeEach(async () => {
    ctx = makeAudioContextMock();
    destination = makeGainMock();
    // Dynamischer Import, damit Mocks aktiv sind
  });

  it("mode=wavetable: OscillatorNode wird erstellt (createOscillator aufgerufen)", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    const params: SynthParams = { ...DEFAULT_SYNTH_PARAMS, mode: "wavetable" };
    engine.triggerNote(440, params, 0);
    expect(ctx.createOscillator).toHaveBeenCalled();
  });

  it("mode=fm: zwei OscillatorNodes werden erstellt (Carrier + Modulator)", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    const params: SynthParams = { ...DEFAULT_SYNTH_PARAMS, mode: "fm" };
    engine.triggerNote(440, params, 0);
    // FM benötigt 2 Oscillatoren
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("mode=fm: Modulator-Frequenz = frequency * fmRatio", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    const params: SynthParams = { ...DEFAULT_SYNTH_PARAMS, mode: "fm", fmRatio: 3 };
    engine.triggerNote(220, params, 0);
    const oscillators = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.results;
    // Zweiter Oszillator (Modulator) hat frequency = 220 * 3 = 660
    expect(oscillators[1].value.frequency.value).toBe(660);
  });

  it("triggerNote() gibt GainNode zurück (nicht null)", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    const result = engine.triggerNote(440, DEFAULT_SYNTH_PARAMS, 0);
    expect(result).toBeTruthy();
  });
});

// ─── Macro-LFO-Cache (TASK-117) ───────────────────────────────────────────────
// Verifiziert die per-Part LFO-Setter (setPartLfoRate / setPartLfoDepth):
//   - Cache speichert letzten Wert
//   - Range-Clamping (hz: 0.01..30, depth: 0..1)
//   - Getter liefert null wenn nie gesetzt
//   - clearPartLfoCache räumt auf
//   - triggerNote(.., partId) übernimmt gecachten Wert in params

describe("SynthEngine – Macro-LFO-Cache (TASK-117)", () => {
  let ctx: ReturnType<typeof makeAudioContextMock>;
  let destination: ReturnType<typeof makeGainMock>;

  beforeEach(() => {
    ctx = makeAudioContextMock();
    destination = makeGainMock();
  });

  it("getPartLfoRate liefert null, wenn nie gesetzt", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    expect(engine.getPartLfoRate("kick")).toBeNull();
    expect(engine.getPartLfoDepth("kick")).toBeNull();
  });

  it("setPartLfoRate speichert Wert; getter liefert ihn zurück", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("kick", 5.5);
    expect(engine.getPartLfoRate("kick")).toBe(5.5);
  });

  it("setPartLfoDepth speichert Wert; getter liefert ihn zurück", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoDepth("snare", 0.42);
    expect(engine.getPartLfoDepth("snare")).toBe(0.42);
  });

  it("setPartLfoRate clamped hz=999 → 30 (PART_LFO_RATE_MAX)", async () => {
    const { SynthEngine, PART_LFO_RATE_MAX } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("k", 999);
    expect(engine.getPartLfoRate("k")).toBe(PART_LFO_RATE_MAX);
    expect(PART_LFO_RATE_MAX).toBe(30);
  });

  it("setPartLfoRate clamped hz=-1 → 0.01 (PART_LFO_RATE_MIN)", async () => {
    const { SynthEngine, PART_LFO_RATE_MIN } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("k", -1);
    expect(engine.getPartLfoRate("k")).toBe(PART_LFO_RATE_MIN);
    expect(PART_LFO_RATE_MIN).toBe(0.01);
  });

  it("setPartLfoDepth clamped depth=2 → 1", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoDepth("k", 2);
    expect(engine.getPartLfoDepth("k")).toBe(1);
  });

  it("setPartLfoDepth clamped depth=-0.5 → 0", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoDepth("k", -0.5);
    expect(engine.getPartLfoDepth("k")).toBe(0);
  });

  it("setPartLfoRate ignoriert NaN/Infinity (no-op)", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("k", 4);
    engine.setPartLfoRate("k", NaN);
    expect(engine.getPartLfoRate("k")).toBe(4);
    engine.setPartLfoRate("k", Infinity);
    expect(engine.getPartLfoRate("k")).toBe(4);
  });

  it("setPartLfoDepth ignoriert NaN/Infinity (no-op)", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoDepth("k", 0.5);
    engine.setPartLfoDepth("k", NaN);
    expect(engine.getPartLfoDepth("k")).toBe(0.5);
    engine.setPartLfoDepth("k", Infinity);
    expect(engine.getPartLfoDepth("k")).toBe(0.5);
  });

  it("setPartLfoRate ist no-op bei leerer partId", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("", 5);
    expect(engine.getPartLfoRate("")).toBeNull();
  });

  it("Cache-Werte pro Part-ID sind voneinander isoliert", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("kick", 2);
    engine.setPartLfoRate("snare", 8);
    engine.setPartLfoDepth("kick", 0.3);
    expect(engine.getPartLfoRate("kick")).toBe(2);
    expect(engine.getPartLfoRate("snare")).toBe(8);
    expect(engine.getPartLfoDepth("kick")).toBe(0.3);
    expect(engine.getPartLfoDepth("snare")).toBeNull();
  });

  it("Rate und Depth für denselben Part koexistieren im Cache", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("lead", 6);
    engine.setPartLfoDepth("lead", 0.6);
    expect(engine.getPartLfoRate("lead")).toBe(6);
    expect(engine.getPartLfoDepth("lead")).toBe(0.6);
  });

  it("clearPartLfoCache(partId) löscht nur diesen Part", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("a", 1);
    engine.setPartLfoRate("b", 2);
    engine.clearPartLfoCache("a");
    expect(engine.getPartLfoRate("a")).toBeNull();
    expect(engine.getPartLfoRate("b")).toBe(2);
  });

  it("clearPartLfoCache() ohne arg löscht ALLE Caches", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("a", 1);
    engine.setPartLfoRate("b", 2);
    engine.clearPartLfoCache();
    expect(engine.getPartLfoRate("a")).toBeNull();
    expect(engine.getPartLfoRate("b")).toBeNull();
  });

  it("triggerNote(.., partId) übernimmt gecachte Rate (lfoEnabled=true)", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("lead", 7);
    const params: SynthParams = {
      ...DEFAULT_SYNTH_PARAMS,
      lfoEnabled: true,
      lfoWaveform: "sine",
      lfoBpmSync: "free",
      lfoRate: 4, // wird vom Cache überschrieben
    };
    engine.triggerNote(440, params, 0, undefined, "lead");
    // LFO-Oszillator wird intern erzeugt; wir prüfen, dass mind. einer mit frequency=7 angelegt wurde.
    const oscMocks = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.results;
    const lfoOsc = oscMocks.find(r => r.value.frequency.value === 7);
    expect(lfoOsc).toBeDefined();
  });

  it("triggerNote(.., partId) ohne Cache verwendet params.lfoRate unverändert", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    const params: SynthParams = {
      ...DEFAULT_SYNTH_PARAMS,
      lfoEnabled: true,
      lfoWaveform: "sine",
      lfoBpmSync: "free",
      lfoRate: 3,
    };
    engine.triggerNote(440, params, 0, undefined, "neverset");
    const oscMocks = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.results;
    const lfoOsc = oscMocks.find(r => r.value.frequency.value === 3);
    expect(lfoOsc).toBeDefined();
  });

  it("triggerNote ohne partId-Argument umgeht den Cache komplett", async () => {
    const { SynthEngine } = await import("../../client/src/audio/SynthEngine");
    const engine = new SynthEngine(ctx as unknown as AudioContext, destination as unknown as AudioNode);
    engine.setPartLfoRate("ghost", 12);
    const params: SynthParams = {
      ...DEFAULT_SYNTH_PARAMS,
      lfoEnabled: true,
      lfoWaveform: "sine",
      lfoBpmSync: "free",
      lfoRate: 4,
    };
    // KEIN partId → Cache wird nicht konsultiert
    engine.triggerNote(440, params, 0);
    const oscMocks = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.results;
    const lfoOsc = oscMocks.find(r => r.value.frequency.value === 4);
    expect(lfoOsc).toBeDefined();
    const cachedOsc = oscMocks.find(r => r.value.frequency.value === 12);
    expect(cachedOsc).toBeUndefined();
  });
});
