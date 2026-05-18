/**
 * tests/features/synth-offline-render.test.ts
 *
 * Unit-Tests fuer TASK-241-FOLLOWUP-2 (v2.96.0): Synth-Offline-Render.
 *
 * Pure-Helper Coverage:
 *  - pitchToFrequency       (Semi-Transpose von A4=440)
 *  - normalizeSynthParams   (Defensive Defaults bei missing/NaN)
 *  - computeNoteHoldSec     (Konstante 1.0s)
 *  - isSynthPart            (Detection-Logik)
 *  - isGranularPart         (Detection-Logik)
 *
 * Integration via Mock-Ctx:
 *  - triggerOfflineSynthNote: Wavetable + FM mit ADSR
 */
import { describe, it, expect } from "vitest";
import {
  pitchToFrequency,
  normalizeSynthParams,
  computeNoteHoldSec,
  isSynthPart,
  isGranularPart,
  triggerOfflineSynthNote,
} from "../../client/src/utils/synthOfflineRender";
import type { SynthParams } from "../../client/src/audio/SynthEngine";

// ─── pitchToFrequency ────────────────────────────────────────────────────────

describe("pitchToFrequency", () => {
  it("0 Semitones → 440 Hz (A4 baseline)", () => {
    expect(pitchToFrequency(0)).toBeCloseTo(440, 3);
  });

  it("+12 Semitones → 880 Hz (Oktave hoch)", () => {
    expect(pitchToFrequency(12)).toBeCloseTo(880, 3);
  });

  it("-12 Semitones → 220 Hz (Oktave runter)", () => {
    expect(pitchToFrequency(-12)).toBeCloseTo(220, 3);
  });

  it("custom baseHz wird respektiert", () => {
    expect(pitchToFrequency(0, 261.63)).toBeCloseTo(261.63, 2);
  });

  it("NaN/undefined → fällt auf 0 zurück (defensive)", () => {
    expect(pitchToFrequency(NaN)).toBeCloseTo(440, 3);
    expect(pitchToFrequency(undefined as unknown as number)).toBeCloseTo(440, 3);
  });
});

// ─── normalizeSynthParams ────────────────────────────────────────────────────

describe("normalizeSynthParams", () => {
  it("undefined → kompletter DEFAULT_SYNTH_PARAMS-Snapshot", () => {
    const p = normalizeSynthParams(undefined);
    expect(p.mode).toBe("wavetable");
    expect(p.attack).toBeGreaterThan(0);
    expect(p.sustain).toBeGreaterThan(0);
    expect(p.sustain).toBeLessThanOrEqual(1);
  });

  it("invalider mode → wavetable-Fallback", () => {
    const p = normalizeSynthParams({ mode: "foo" } as unknown as SynthParams);
    expect(p.mode).toBe("wavetable");
  });

  it("NaN-attack → mindestens 0.001s", () => {
    const p = normalizeSynthParams({
      attack: NaN, decay: 0.1, sustain: 0.5, release: 0.2,
    } as unknown as SynthParams);
    expect(p.attack).toBeGreaterThanOrEqual(0.001);
  });

  it("clampt sustain auf [0,1]", () => {
    const p1 = normalizeSynthParams({ sustain: 2 } as unknown as SynthParams);
    expect(p1.sustain).toBe(1);
    const p2 = normalizeSynthParams({ sustain: -5 } as unknown as SynthParams);
    expect(p2.sustain).toBe(0);
  });

  it("clampt detune auf [-100,100] Cents", () => {
    const p1 = normalizeSynthParams({ detune: 500 } as unknown as SynthParams);
    expect(p1.detune).toBe(100);
    const p2 = normalizeSynthParams({ detune: -500 } as unknown as SynthParams);
    expect(p2.detune).toBe(-100);
  });

  it("fmRatio bei 0 oder negativ → min 0.1", () => {
    const p = normalizeSynthParams({ fmRatio: 0 } as unknown as SynthParams);
    expect(p.fmRatio).toBeGreaterThanOrEqual(0.1);
  });
});

// ─── computeNoteHoldSec ──────────────────────────────────────────────────────

describe("computeNoteHoldSec", () => {
  it("ist eine positive Konstante (1.0s erwartet)", () => {
    expect(computeNoteHoldSec()).toBeGreaterThan(0);
    expect(computeNoteHoldSec()).toBeCloseTo(1.0, 3);
  });
});

// ─── isSynthPart ─────────────────────────────────────────────────────────────

describe("isSynthPart", () => {
  const validParams = {
    mode: "wavetable",
    oscType: "sawtooth",
  } as unknown as SynthParams;

  it("wavetable + synthParams → true", () => {
    expect(isSynthPart({ sourceType: "wavetable", synthParams: validParams })).toBe(true);
  });

  it("fm + synthParams → true", () => {
    expect(isSynthPart({ sourceType: "fm", synthParams: validParams })).toBe(true);
  });

  it("sample → false (auch mit synthParams)", () => {
    expect(isSynthPart({ sourceType: "sample", synthParams: validParams })).toBe(false);
  });

  it("granular → false", () => {
    expect(isSynthPart({ sourceType: "granular", synthParams: validParams })).toBe(false);
  });

  it("ohne synthParams → false (auch wenn sourceType=wavetable)", () => {
    expect(isSynthPart({ sourceType: "wavetable" })).toBe(false);
  });
});

// ─── isGranularPart ──────────────────────────────────────────────────────────

describe("isGranularPart", () => {
  it("granular → true", () => {
    expect(isGranularPart({ sourceType: "granular" })).toBe(true);
  });

  it("wavetable/fm/sample → false", () => {
    expect(isGranularPart({ sourceType: "wavetable" })).toBe(false);
    expect(isGranularPart({ sourceType: "fm" })).toBe(false);
    expect(isGranularPart({ sourceType: "sample" })).toBe(false);
    expect(isGranularPart({})).toBe(false);
  });
});

// ─── triggerOfflineSynthNote (Integration mit Mock-Ctx) ─────────────────────

interface MockNode {
  _kind: string;
  connect: (target: MockNode) => void;
}

interface MockOscParam {
  value: number;
  setValueAtTime: (v: number, t: number) => void;
  linearRampToValueAtTime: (v: number, t: number) => void;
  cancelScheduledValues: () => void;
}

interface MockOsc extends MockNode {
  type: string;
  frequency: MockOscParam;
  detune: MockOscParam;
  start: (when: number) => void;
  stop: (when: number) => void;
}

interface MockGain extends MockNode {
  gain: MockOscParam;
}

function makeMockCtx(): {
  ctx: BaseAudioContext;
  oscillators: MockOsc[];
  gains: MockGain[];
} {
  const oscillators: MockOsc[] = [];
  const gains: MockGain[] = [];
  const ctx = {
    createOscillator(): MockOsc {
      const osc: MockOsc = {
        _kind: "oscillator",
        type: "sine",
        frequency: {
          value: 0,
          setValueAtTime() { /* noop */ },
          linearRampToValueAtTime() { /* noop */ },
          cancelScheduledValues() { /* noop */ },
        },
        detune: {
          value: 0,
          setValueAtTime() { /* noop */ },
          linearRampToValueAtTime() { /* noop */ },
          cancelScheduledValues() { /* noop */ },
        },
        start() { /* noop */ },
        stop() { /* noop */ },
        connect() { /* noop */ },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain(): MockGain {
      const g: MockGain = {
        _kind: "gain",
        gain: {
          value: 0,
          setValueAtTime() { /* noop */ },
          linearRampToValueAtTime() { /* noop */ },
          cancelScheduledValues() { /* noop */ },
        },
        connect() { /* noop */ },
      };
      gains.push(g);
      return g;
    },
  } as unknown as BaseAudioContext;
  return { ctx, oscillators, gains };
}

describe("triggerOfflineSynthNote", () => {
  const baseParams: SynthParams = {
    mode: "wavetable",
    oscType: "sawtooth",
    detune: 0,
    fmRatio: 2,
    fmDepth: 100,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.8,
    release: 0.3,
    lfoEnabled: false,
    lfoRate: 4,
    lfoDepth: 10,
    lfoTarget: "pitch",
    lfoWaveform: "sine",
    lfoBpmSync: "free",
    glide: 0,
  };

  it("Wavetable: erzeugt genau 1 Oszillator + 1 Gain", () => {
    const { ctx, oscillators, gains } = makeMockCtx();
    const output = { _kind: "output", connect() { /* noop */ } } as unknown as AudioNode;
    triggerOfflineSynthNote(ctx, baseParams, 440, 0, 1, output);
    expect(oscillators.length).toBe(1);
    expect(gains.length).toBe(1);
    expect(oscillators[0].type).toBe("sawtooth");
  });

  it("FM: erzeugt 2 Oszillatoren (carrier + modulator) + 2 Gains (ampEnv + modDepth)", () => {
    const { ctx, oscillators, gains } = makeMockCtx();
    const output = { _kind: "output", connect() { /* noop */ } } as unknown as AudioNode;
    triggerOfflineSynthNote(ctx, { ...baseParams, mode: "fm" }, 440, 0, 1, output);
    expect(oscillators.length).toBe(2);
    expect(gains.length).toBe(2);
  });

  it("Defensive: undefined params → kein Crash, nutzt Defaults", () => {
    const { ctx, oscillators } = makeMockCtx();
    const output = { _kind: "output", connect() { /* noop */ } } as unknown as AudioNode;
    expect(() => triggerOfflineSynthNote(ctx, undefined, 440, 0, 1, output)).not.toThrow();
    expect(oscillators.length).toBe(1);
  });

  it("Returnt OfflineSynthNoteHandle mit releaseEnd > time", () => {
    const { ctx } = makeMockCtx();
    const output = { _kind: "output", connect() { /* noop */ } } as unknown as AudioNode;
    const handle = triggerOfflineSynthNote(ctx, baseParams, 440, 0, 1, output);
    expect(handle.releaseEnd).toBeGreaterThan(0);
    // releaseEnd = noteEnd(1.0s) + release(0.3) + buffer(0.1) = 1.4
    expect(handle.releaseEnd).toBeCloseTo(1.4, 1);
  });

  it("oscType 'custom' → wird auf 'sine' abgebildet (identisch SynthEngine)", () => {
    const { ctx, oscillators } = makeMockCtx();
    const output = { _kind: "output", connect() { /* noop */ } } as unknown as AudioNode;
    triggerOfflineSynthNote(ctx, { ...baseParams, oscType: "custom" }, 440, 0, 1, output);
    expect(oscillators[0].type).toBe("sine");
  });
});
