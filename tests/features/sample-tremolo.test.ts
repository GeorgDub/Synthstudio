// @vitest-environment node
/**
 * sample-tremolo.test.ts - v3.207.0
 *
 * Tests fuer sampleTremolo Pure-Helper (Amplitude-Modulation via LFO).
 * Kein Delay/Pitch-Effekt, nur Gain-Multiplikation pro Sample.
 *
 * Sample-Rate-Trick: viele Tests nutzen sampleRate=1000 + rate so dass die
 * LFO-Phase deterministisch an bestimmten Zeitpunkten liegt (z.B. rate=250 -
 * Periode = 4 Samples bei sr=1000).
 */

import { describe, it, expect } from "vitest";
import { applyTremolo, TREMOLO_PRESETS } from "../../client/src/utils/sampleTremolo";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeBuffer(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeStereoBuffer(
  left: number[],
  right: number[],
  sampleRate = 48000,
): AudioBufferLike {
  const L = new Float32Array(left);
  const R = new Float32Array(right);
  const len = Math.max(left.length, right.length);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: len,
    getChannelData: (c: number) => (c === 0 ? L : R),
  };
}

function makeEmptyBuffer(sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function makeConst(value: number, len: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(len).fill(value);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

function makeSine(len: number, freqHz: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    data[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

describe("v3.207 applyTremolo", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyTremolo(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer mit defaults wirft nicht und behaelt sampleRate", () => {
    const buf = makeEmptyBuffer(44100);
    const out = applyTremolo(buf, { rateHz: 5, depth: 0.5, waveform: "sine" });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
  });

  it("depth=0 ergibt exakt identity (gain konstant 1)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, -0.0625, 0.9, -0.4, 0.2, 0.1], 1000);
    const out = applyTremolo(dry, { rateHz: 5, depth: 0, waveform: "sine" });
    expect(out.length).toBe(8);
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(-0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
    expect(got[6]).toBeCloseTo(0.2, 6);
    expect(got[7]).toBeCloseTo(0.1, 6);
  });

  it("depth=1: gain bewegt sich in [0, 1] (sine, konstanter Input 1.0)", () => {
    // sample_rate=200, rate=50 -> Periode = 4 samples.
    // t=0       (sample 0) -> sin(0)=0    -> lfo=0.5 -> gain=0.5
    // t=0.005   (sample 1) -> sin(pi/2)=1 -> lfo=1   -> gain=1.0
    // t=0.010   (sample 2) -> sin(pi)=0   -> lfo=0.5 -> gain=0.5
    // t=0.015   (sample 3) -> sin(3pi/2)=-1 -> lfo=0 -> gain=0.0
    const dry = makeConst(1.0, 8, 200);
    const out = applyTremolo(dry, { rateHz: 50, depth: 1, waveform: "sine" });
    const got = Array.from(out.getChannelData(0));
    for (const v of got) {
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(got[0]).toBeCloseTo(0.5, 5);
    expect(got[1]).toBeCloseTo(1.0, 5);
    expect(got[2]).toBeCloseTo(0.5, 5);
    expect(got[3]).toBeCloseTo(0.0, 5);
  });

  it("sine waveform: smooth modulation (kein abrupter Sprung zwischen Samples bei hoher sr)", () => {
    // sr=48000, rate=5 -> Periode = 9600 samples. Differenz zwischen
    // benachbarten Gain-Werten muss sehr klein sein (smooth).
    const dry = makeConst(1.0, 1000, 48000);
    const out = applyTremolo(dry, { rateHz: 5, depth: 0.5, waveform: "sine" });
    const got = out.getChannelData(0);
    for (let i = 1; i < got.length; i++) {
      // Bei rate=5/sr=48000 ist dphase ~= 1/9600 -> dlfo <= 2pi/9600 ~ 0.00065
      // gain-Diff <= depth * dlfo ~ 0.00033
      expect(Math.abs(got[i] - got[i - 1])).toBeLessThan(0.01);
    }
  });

  it("square waveform: step modulation (nur 2 distinkte Gain-Werte: 1 und 1-depth)", () => {
    // sr=400, rate=50 -> Periode = 8 samples; halbe Periode = 4 samples.
    // Erste 4 sample: phase < 0.5 -> lfo=1 -> gain=1
    // Naechste 4 sample: phase >= 0.5 -> lfo=0 -> gain=1-depth
    const dry = makeConst(1.0, 16, 400);
    const out = applyTremolo(dry, { rateHz: 50, depth: 0.5, waveform: "square" });
    const got = Array.from(out.getChannelData(0));
    // Erste 4 sample sollten gain=1 sein (phase < 0.5)
    expect(got[0]).toBeCloseTo(1.0, 5);
    expect(got[1]).toBeCloseTo(1.0, 5);
    expect(got[2]).toBeCloseTo(1.0, 5);
    expect(got[3]).toBeCloseTo(1.0, 5);
    // Naechste 4 sample sollten gain=0.5 sein (phase >= 0.5)
    expect(got[4]).toBeCloseTo(0.5, 5);
    expect(got[5]).toBeCloseTo(0.5, 5);
    expect(got[6]).toBeCloseTo(0.5, 5);
    expect(got[7]).toBeCloseTo(0.5, 5);
    // Wiederholung in zweiter Periode
    expect(got[8]).toBeCloseTo(1.0, 5);
    expect(got[12]).toBeCloseTo(0.5, 5);
    // Nur 2 distinkte Werte
    const unique = new Set(got.map((v) => Math.round(v * 100) / 100));
    expect(unique.size).toBe(2);
  });

  it("triangle waveform: linear ramps (lineare Aenderung zwischen 1-depth und 1)", () => {
    // sr=400, rate=50 -> Periode = 8 samples. Ramp up sample 0-3 (phase 0->0.5),
    // ramp down sample 4-7 (phase 0.5->1). Bei depth=1: gain = 0..1..0
    // t=0 -> phase=0 -> lfo=0 -> gain=0
    // t=1/400, phase=0.125 -> lfo=0.25 -> gain=0.25
    // t=2/400, phase=0.25 -> lfo=0.5 -> gain=0.5
    // t=3/400, phase=0.375 -> lfo=0.75 -> gain=0.75
    // t=4/400, phase=0.5 -> lfo=1.0 -> gain=1.0
    // t=5/400, phase=0.625 -> lfo=0.75 -> gain=0.75
    const dry = makeConst(1.0, 9, 400);
    const out = applyTremolo(dry, { rateHz: 50, depth: 1, waveform: "triangle" });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0, 5);
    expect(got[1]).toBeCloseTo(0.25, 5);
    expect(got[2]).toBeCloseTo(0.5, 5);
    expect(got[3]).toBeCloseTo(0.75, 5);
    expect(got[4]).toBeCloseTo(1.0, 5);
    expect(got[5]).toBeCloseTo(0.75, 5);
    expect(got[6]).toBeCloseTo(0.5, 5);
    expect(got[7]).toBeCloseTo(0.25, 5);
    // Linear: diff zwischen 1 und 2 = diff zwischen 2 und 3
    expect(got[2] - got[1]).toBeCloseTo(got[3] - got[2], 5);
  });

  it("length-preservation: output.length === input.length", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 48000);
    const out = applyTremolo(dry, { depth: 0.5 });
    expect(out.length).toBe(10);
  });

  it("multi-channel symmetry: shared LFO -> identische Channels ergeben identischen Output", () => {
    const dry = makeStereoBuffer(
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      48000,
    );
    const out = applyTremolo(dry, { rateHz: 5, depth: 0.5, waveform: "sine" });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("multi-channel: L=impulse, R=silence -> R bleibt silence (kein Channel-Leak)", () => {
    const dry = makeStereoBuffer(
      [1.0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      1000,
    );
    const out = applyTremolo(dry, { rateHz: 5, depth: 0.5, waveform: "sine" });
    expect(out.numberOfChannels).toBe(2);
    const R = Array.from(out.getChannelData(1));
    for (const v of R) {
      expect(v).toBeCloseTo(0, 6);
    }
  });

  it("defaults greifen ohne options-objekt", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyTremolo(dry);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
    const got = Array.from(out.getChannelData(0));
    expect(got.every((v) => Number.isFinite(v))).toBe(true);
    // Default ist depth=0.5, also gain in [0.5, 1] und input=0.5
    // -> output in [0.25, 0.5]
    for (const v of got) {
      expect(v).toBeGreaterThanOrEqual(0.25 - 1e-6);
      expect(v).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it("immutability: input-buffer wird nicht mutiert", () => {
    const src = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 1000);
    const before = Array.from(src.getChannelData(0));
    applyTremolo(src, { rateHz: 5, depth: 0.8, waveform: "square" });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("verschiedene sampleRates: 8000 Hz funktioniert", () => {
    const dry = makeSine(800, 100, 8000);
    const out = applyTremolo(dry, { rateHz: 5, depth: 0.5, waveform: "sine" });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(800);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("verschiedene sampleRates: 44100 Hz funktioniert", () => {
    const dry = makeSine(4410, 440, 44100);
    const out = applyTremolo(dry, { rateHz: 5, depth: 0.5, waveform: "sine" });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(4410);
  });

  it("verschiedene sampleRates: 96000 Hz funktioniert", () => {
    const dry = makeSine(9600, 440, 96000);
    const out = applyTremolo(dry, { rateHz: 5, depth: 0.5, waveform: "sine" });
    expect(out.sampleRate).toBe(96000);
    expect(out.length).toBe(9600);
  });

  it("sanitizer: rateHz NaN -> default 5 (finite output, no throw)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyTremolo(dry, { rateHz: NaN, depth: 0.5 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
    // Verify against fb=5 explicit
    const ref = applyTremolo(dry, { rateHz: 5, depth: 0.5 });
    const a = Array.from(ref.getChannelData(0));
    const b = Array.from(got);
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeCloseTo(a[i], 6);
    }
  });

  it("sanitizer: rateHz <= 0 -> default 5", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const outZero = applyTremolo(dry, { rateHz: 0, depth: 0.5 });
    const outNeg = applyTremolo(dry, { rateHz: -3, depth: 0.5 });
    const outDef = applyTremolo(dry, { rateHz: 5, depth: 0.5 });
    const aZero = Array.from(outZero.getChannelData(0));
    const aNeg = Array.from(outNeg.getChannelData(0));
    const aDef = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < aDef.length; i++) {
      expect(aZero[i]).toBeCloseTo(aDef[i], 6);
      expect(aNeg[i]).toBeCloseTo(aDef[i], 6);
    }
  });

  it("sanitizer: rateHz > 50 -> clamp 50", () => {
    const dry = makeConst(1.0, 200, 48000);
    const out999 = applyTremolo(dry, { rateHz: 9999, depth: 0.5 });
    const out50 = applyTremolo(dry, { rateHz: 50, depth: 0.5 });
    const a = Array.from(out999.getChannelData(0));
    const b = Array.from(out50.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: depth NaN -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625, 0.9, -0.4], 48000);
    const out = applyTremolo(dry, { rateHz: 5, depth: NaN });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
  });

  it("sanitizer: depth < 0 -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyTremolo(dry, { depth: -5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: depth > 1 -> clamp 1", () => {
    const dry = makeConst(1.0, 8, 1000);
    const out99 = applyTremolo(dry, { rateHz: 250, depth: 99, waveform: "sine" });
    const out1 = applyTremolo(dry, { rateHz: 250, depth: 1, waveform: "sine" });
    const a = Array.from(out99.getChannelData(0));
    const b = Array.from(out1.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: waveform unknown -> 'sine'", () => {
    const dry = makeConst(1.0, 16, 1000);
    // @ts-expect-error: testing runtime fallback for invalid waveform
    const outUnknown = applyTremolo(dry, { rateHz: 250, depth: 1, waveform: "saw" });
    const outSine = applyTremolo(dry, { rateHz: 250, depth: 1, waveform: "sine" });
    const a = Array.from(outUnknown.getChannelData(0));
    const b = Array.from(outSine.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("sanitizer: waveform undefined -> 'sine'", () => {
    const dry = makeConst(1.0, 16, 1000);
    const outUndef = applyTremolo(dry, { rateHz: 250, depth: 1 });
    const outSine = applyTremolo(dry, { rateHz: 250, depth: 1, waveform: "sine" });
    const a = Array.from(outUndef.getChannelData(0));
    const b = Array.from(outSine.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("sanitizer: all extreme values -> finite output", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyTremolo(dry, {
      rateHz: Infinity,
      depth: Infinity,
      // @ts-expect-error: testing runtime fallback
      waveform: "weird",
    });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sub-unity gain: output amplitude <= input amplitude (kein Clipping)", () => {
    const dry = makeBuffer([1.0, -1.0, 0.8, -0.8, 0.5, -0.5], 1000);
    const out = applyTremolo(dry, { rateHz: 5, depth: 0.7, waveform: "sine" });
    const got = Array.from(out.getChannelData(0));
    for (let i = 0; i < got.length; i++) {
      expect(Math.abs(got[i])).toBeLessThanOrEqual(Math.abs(dry.getChannelData(0)[i]) + 1e-9);
    }
  });

  it("zero-input -> zero-output (gain * 0 == 0)", () => {
    const dry = makeConst(0.0, 32, 48000);
    const out = applyTremolo(dry, { rateHz: 5, depth: 1, waveform: "sine" });
    const got = Array.from(out.getChannelData(0));
    for (const v of got) {
      expect(v).toBeCloseTo(0, 9);
    }
  });

  it("triangle vs sine vs square: alle bei depth=0 sind identity", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const outSine = applyTremolo(dry, { depth: 0, waveform: "sine" });
    const outTri = applyTremolo(dry, { depth: 0, waveform: "triangle" });
    const outSqr = applyTremolo(dry, { depth: 0, waveform: "square" });
    const ref = Array.from(dry.getChannelData(0));
    for (let i = 0; i < ref.length; i++) {
      expect(outSine.getChannelData(0)[i]).toBeCloseTo(ref[i], 6);
      expect(outTri.getChannelData(0)[i]).toBeCloseTo(ref[i], 6);
      expect(outSqr.getChannelData(0)[i]).toBeCloseTo(ref[i], 6);
    }
  });
});

describe("v3.207 TREMOLO_PRESETS", () => {
  it("enthaelt subtle/classic/pulse/vintage", () => {
    expect(TREMOLO_PRESETS.subtle).toBeDefined();
    expect(TREMOLO_PRESETS.classic).toBeDefined();
    expect(TREMOLO_PRESETS.pulse).toBeDefined();
    expect(TREMOLO_PRESETS.vintage).toBeDefined();
  });

  it("alle Presets haben rateHz/depth/waveform mit plausiblen Werten", () => {
    const all = [
      TREMOLO_PRESETS.subtle,
      TREMOLO_PRESETS.classic,
      TREMOLO_PRESETS.pulse,
      TREMOLO_PRESETS.vintage,
    ];
    for (const p of all) {
      expect(typeof p.rateHz).toBe("number");
      expect(typeof p.depth).toBe("number");
      expect(typeof p.waveform).toBe("string");
      expect(p.rateHz).toBeGreaterThan(0);
      expect(p.rateHz).toBeLessThanOrEqual(50);
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThanOrEqual(1);
      expect(["sine", "triangle", "square"]).toContain(p.waveform);
    }
  });

  it("preset 'classic' matched Spec-Defaults: rate=5, depth=0.5, waveform=sine", () => {
    expect(TREMOLO_PRESETS.classic.rateHz).toBe(5);
    expect(TREMOLO_PRESETS.classic.depth).toBe(0.5);
    expect(TREMOLO_PRESETS.classic.waveform).toBe("sine");
  });

  it("preset 'pulse' nutzt square + hoechste depth", () => {
    expect(TREMOLO_PRESETS.pulse.waveform).toBe("square");
    expect(TREMOLO_PRESETS.pulse.depth).toBeGreaterThan(TREMOLO_PRESETS.subtle.depth);
    expect(TREMOLO_PRESETS.pulse.depth).toBeGreaterThan(TREMOLO_PRESETS.classic.depth);
  });

  it("preset 'vintage' nutzt triangle", () => {
    expect(TREMOLO_PRESETS.vintage.waveform).toBe("triangle");
  });

  it("presets sind direkt anwendbar via applyTremolo(buf, preset)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyTremolo(dry, TREMOLO_PRESETS.classic);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("alle presets liefern finite output bei realistic sine-input", () => {
    const dry = makeSine(1000, 440, 48000);
    const presets = [
      TREMOLO_PRESETS.subtle,
      TREMOLO_PRESETS.classic,
      TREMOLO_PRESETS.pulse,
      TREMOLO_PRESETS.vintage,
    ];
    for (const p of presets) {
      const out = applyTremolo(dry, p);
      const got = out.getChannelData(0);
      for (let i = 0; i < got.length; i++) {
        expect(Number.isFinite(got[i])).toBe(true);
      }
    }
  });
});
