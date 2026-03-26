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
