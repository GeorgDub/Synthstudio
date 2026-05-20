// @vitest-environment node
/**
 * sample-auto-pan.test.ts - v3.209.0
 *
 * Tests fuer sampleAutoPan Pure-Helper (Stereo-AutoPan via bipolarer LFO).
 *
 * Wichtige Unterschiede zu Tremolo (v3.207):
 *  - LFO ist BIPOLAR (-1..+1) statt unipolar (0..1).
 *  - depth=0 ist NICHT identity: equal-power center -> L == R, beide
 *    auf ca. 0.7071 (sqrt(0.5)) des monoMix-Pegels.
 *  - Output ist IMMER 2-channel (auch bei mono input), AUSSER bei empty.
 *  - Stereo-Input wird vor dem Pan zu mono ge-downmixed.
 *
 * Sample-Rate-Trick: viele Tests nutzen sampleRate/rate-Kombinationen,
 * die LFO-Phase deterministisch an bestimmten Zeitpunkten setzen.
 */

import { describe, it, expect } from "vitest";
import { applyAutoPan, AUTOPAN_PRESETS } from "../../client/src/utils/sampleAutoPan";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// --- Test-Helpers -----------------------------------------------------------

function makeMonoBuffer(samples: number[], sampleRate = 48000): AudioBufferLike {
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
    getChannelData: (c: number) => {
      if (c === 0) return L;
      if (c === 1) return R;
      throw new RangeError(`channel ${c}`);
    },
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

function makeConstMono(value: number, len: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(len).fill(value);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

function makeSineMono(len: number, freqHz: number, sampleRate = 48000): AudioBufferLike {
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

// --- Tests: applyAutoPan -----------------------------------------------------

describe("v3.209 applyAutoPan", () => {
  it("empty buffer -> empty output (numberOfChannels=0)", () => {
    const out = applyAutoPan(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer behaelt sampleRate", () => {
    const buf = makeEmptyBuffer(44100);
    const out = applyAutoPan(buf, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("depth=0 -> output L === R (equal-power center, kein pan)", () => {
    // monoMix = [0.5, 0.25, 0.125, -0.0625, 0.9, -0.4, 0.2, 0.1]
    // pan_t == 0 for all i -> leftGain = rightGain = sqrt(0.5)
    const dry = makeMonoBuffer([0.5, 0.25, 0.125, -0.0625, 0.9, -0.4, 0.2, 0.1], 1000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 0, waveform: "sine" });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(8);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    const half = Math.sqrt(0.5);
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 7); // L == R
      expect(L[i]).toBeCloseTo(dry.getChannelData(0)[i] * half, 6); // beide ~70.7%
    }
  });

  it("depth=1 mit sine: pan voll links/rechts geht durch (DC input)", () => {
    // sr=80, rate=20 (max-Clamp) -> Periode = 4 samples
    // t=0      -> sin(0)        =  0  -> pan=0     -> L=R=sqrt(0.5)=0.707
    // t=0.0125 -> sin(pi/2)     = +1  -> pan=+1    -> L=0, R=1
    // t=0.025  -> sin(pi)       =  0  -> pan=0     -> L=R=0.707
    // t=0.0375 -> sin(3pi/2)    = -1  -> pan=-1    -> L=1, R=0
    const dry = makeConstMono(1.0, 8, 80);
    const out = applyAutoPan(dry, { rateHz: 20, depth: 1, waveform: "sine" });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    const half = Math.sqrt(0.5);
    expect(L[0]).toBeCloseTo(half, 5);
    expect(R[0]).toBeCloseTo(half, 5);
    expect(L[1]).toBeCloseTo(0, 5);
    expect(R[1]).toBeCloseTo(1, 5);
    expect(L[2]).toBeCloseTo(half, 5);
    expect(R[2]).toBeCloseTo(half, 5);
    expect(L[3]).toBeCloseTo(1, 5);
    expect(R[3]).toBeCloseTo(0, 5);
  });

  it("equal-power invariant: leftGain^2 + rightGain^2 = 1 fuer alle samples (DC input=1)", () => {
    // Bei monoMix=1.0 ist outL=leftGain und outR=rightGain.
    // Energy-Preservation: outL^2 + outR^2 == 1 fuer alle i.
    // Precision 6 statt 9 wg. Float32-Speicher-Praezision (~7 Stellen).
    const dry = makeConstMono(1.0, 200, 48000);
    const out = applyAutoPan(dry, { rateHz: 5, depth: 1, waveform: "sine" });
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      const energy = L[i] * L[i] + R[i] * R[i];
      expect(energy).toBeCloseTo(1, 6);
    }
  });

  it("equal-power invariant haelt auch bei depth=0.5 (DC input=1)", () => {
    const dry = makeConstMono(1.0, 200, 48000);
    const out = applyAutoPan(dry, { rateHz: 3, depth: 0.5, waveform: "triangle" });
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      const energy = L[i] * L[i] + R[i] * R[i];
      expect(energy).toBeCloseTo(1, 6);
    }
  });

  it("mono input -> output ist 2-channel mit identischem monoMix gepannt", () => {
    const dry = makeMonoBuffer([0.3, -0.4, 0.5, 0.2], 1000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 0, waveform: "sine" });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(4);
    // depth=0 -> L=R=monoMix*sqrt(0.5)
    const half = Math.sqrt(0.5);
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.3 * half, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(0.3 * half, 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(-0.4 * half, 6);
    expect(out.getChannelData(1)[2]).toBeCloseTo(0.5 * half, 6);
  });

  it("stereo input -> wird zu (L+R)/2 ge-downmixed bevor neu gepanned", () => {
    // Bei L=1, R=-1 ist monoMix=0 -> Output muss 0 sein (Cancellation).
    const dry = makeStereoBuffer([1, 1, 1, 1], [-1, -1, -1, -1], 1000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(0, 9);
      expect(R[i]).toBeCloseTo(0, 9);
    }
  });

  it("length-preservation: output.length === input.length", () => {
    const dry = makeMonoBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 48000);
    const out = applyAutoPan(dry, { depth: 0.5 });
    expect(out.length).toBe(10);
  });

  it("defaults greifen ohne options-objekt (rate=0.5, depth=1, sine)", () => {
    const dry = makeConstMono(1.0, 16, 48000);
    const out = applyAutoPan(dry);
    expect(out.length).toBe(16);
    expect(out.numberOfChannels).toBe(2);
    expect(out.sampleRate).toBe(48000);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i])).toBe(true);
      expect(Number.isFinite(R[i])).toBe(true);
      // Equal-power energy-preservation soll auch fuer Defaults gelten
      // (Precision 6 wg. Float32 ~7 Stellen)
      expect(L[i] * L[i] + R[i] * R[i]).toBeCloseTo(1, 6);
    }
  });

  it("immutability: input-buffer wird nicht mutiert (mono)", () => {
    const src = makeMonoBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 1000);
    const before = Array.from(src.getChannelData(0));
    applyAutoPan(src, { rateHz: 0.5, depth: 1, waveform: "square" });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("immutability: input-buffer wird nicht mutiert (stereo)", () => {
    const src = makeStereoBuffer([0.5, 0.6, 0.7], [-0.1, -0.2, -0.3], 1000);
    const beforeL = Array.from(src.getChannelData(0));
    const beforeR = Array.from(src.getChannelData(1));
    applyAutoPan(src, { rateHz: 2, depth: 1, waveform: "triangle" });
    expect(Array.from(src.getChannelData(0))).toEqual(beforeL);
    expect(Array.from(src.getChannelData(1))).toEqual(beforeR);
  });

  it("output L und R sind getrennte Float32Arrays (kein aliasing)", () => {
    const dry = makeConstMono(1.0, 8, 1000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.getChannelData(0)).not.toBe(out.getChannelData(1));
  });

  it("output getChannelData out-of-range wirft RangeError", () => {
    const dry = makeConstMono(1.0, 8, 1000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1 });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });
});

// --- Tests: sampleRates -----------------------------------------------------

describe("v3.209 applyAutoPan sampleRates", () => {
  it("8000 Hz funktioniert (kleinste typische rate)", () => {
    const dry = makeSineMono(800, 100, 8000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(800);
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i])).toBe(true);
      expect(Number.isFinite(R[i])).toBe(true);
    }
  });

  it("44100 Hz funktioniert", () => {
    const dry = makeSineMono(4410, 440, 44100);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(4410);
    expect(out.numberOfChannels).toBe(2);
  });

  it("96000 Hz funktioniert", () => {
    const dry = makeSineMono(9600, 440, 96000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.sampleRate).toBe(96000);
    expect(out.length).toBe(9600);
    expect(out.numberOfChannels).toBe(2);
  });

  it("22050 Hz mit stereo-input behaelt sampleRate", () => {
    const dry = makeStereoBuffer([0.5, 0.4, 0.3, 0.2], [0.1, 0.2, 0.3, 0.4], 22050);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.sampleRate).toBe(22050);
  });
});

// --- Tests: Sanitizer Edge Cases --------------------------------------------

describe("v3.209 applyAutoPan sanitizers", () => {
  it("rateHz NaN -> default 0.5", () => {
    const dry = makeConstMono(1.0, 100, 48000);
    const outNaN = applyAutoPan(dry, { rateHz: NaN, depth: 1, waveform: "sine" });
    const outDef = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    const aL = Array.from(outNaN.getChannelData(0));
    const bL = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < aL.length; i++) {
      expect(aL[i]).toBeCloseTo(bL[i], 6);
    }
  });

  it("rateHz <= 0 -> default 0.5 (0 + negativ)", () => {
    const dry = makeConstMono(1.0, 100, 48000);
    const outZero = applyAutoPan(dry, { rateHz: 0, depth: 1, waveform: "sine" });
    const outNeg = applyAutoPan(dry, { rateHz: -3, depth: 1, waveform: "sine" });
    const outDef = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    const aL = Array.from(outZero.getChannelData(0));
    const bL = Array.from(outNeg.getChannelData(0));
    const cL = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < cL.length; i++) {
      expect(aL[i]).toBeCloseTo(cL[i], 6);
      expect(bL[i]).toBeCloseTo(cL[i], 6);
    }
  });

  it("rateHz +Infinity -> clamp 20 (max), -Infinity -> default 0.5", () => {
    const dry = makeConstMono(1.0, 100, 48000);
    const outPosInf = applyAutoPan(dry, { rateHz: Infinity, depth: 1, waveform: "sine" });
    const outMax = applyAutoPan(dry, { rateHz: 20, depth: 1, waveform: "sine" });
    for (let i = 0; i < outPosInf.length; i++) {
      expect(outPosInf.getChannelData(0)[i]).toBeCloseTo(outMax.getChannelData(0)[i], 5);
    }
    const outNegInf = applyAutoPan(dry, { rateHz: -Infinity, depth: 1, waveform: "sine" });
    const outDef = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    for (let i = 0; i < outNegInf.length; i++) {
      expect(outNegInf.getChannelData(0)[i]).toBeCloseTo(outDef.getChannelData(0)[i], 5);
    }
  });

  it("rateHz > 20 -> clamp 20", () => {
    const dry = makeConstMono(1.0, 200, 48000);
    const outBig = applyAutoPan(dry, { rateHz: 9999, depth: 1, waveform: "sine" });
    const out20 = applyAutoPan(dry, { rateHz: 20, depth: 1, waveform: "sine" });
    for (let i = 0; i < outBig.length; i++) {
      expect(outBig.getChannelData(0)[i]).toBeCloseTo(out20.getChannelData(0)[i], 5);
      expect(outBig.getChannelData(1)[i]).toBeCloseTo(out20.getChannelData(1)[i], 5);
    }
  });

  it("depth NaN -> 0 (equal-power center, L == R, NICHT identity)", () => {
    const dry = makeMonoBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: NaN, waveform: "sine" });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    const half = Math.sqrt(0.5);
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
      expect(L[i]).toBeCloseTo(dry.getChannelData(0)[i] * half, 6);
    }
  });

  it("depth < 0 -> 0 (equal-power center)", () => {
    const dry = makeMonoBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: -5, waveform: "sine" });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("depth > 1 -> clamp 1", () => {
    const dry = makeConstMono(1.0, 200, 48000);
    const outBig = applyAutoPan(dry, { rateHz: 0.5, depth: 99, waveform: "sine" });
    const out1 = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    for (let i = 0; i < outBig.length; i++) {
      expect(outBig.getChannelData(0)[i]).toBeCloseTo(out1.getChannelData(0)[i], 5);
      expect(outBig.getChannelData(1)[i]).toBeCloseTo(out1.getChannelData(1)[i], 5);
    }
  });

  it("depth Infinity -> clamp 1", () => {
    const dry = makeConstMono(1.0, 200, 48000);
    const outInf = applyAutoPan(dry, { rateHz: 0.5, depth: Infinity, waveform: "sine" });
    const out1 = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    for (let i = 0; i < outInf.length; i++) {
      expect(outInf.getChannelData(0)[i]).toBeCloseTo(out1.getChannelData(0)[i], 5);
    }
  });

  it("waveform unknown -> 'sine'", () => {
    const dry = makeConstMono(1.0, 16, 1000);
    // @ts-expect-error: testing runtime fallback for invalid waveform
    const outUnknown = applyAutoPan(dry, { rateHz: 50, depth: 1, waveform: "saw" });
    const outSine = applyAutoPan(dry, { rateHz: 50, depth: 1, waveform: "sine" });
    for (let i = 0; i < outUnknown.length; i++) {
      expect(outUnknown.getChannelData(0)[i]).toBeCloseTo(outSine.getChannelData(0)[i], 6);
      expect(outUnknown.getChannelData(1)[i]).toBeCloseTo(outSine.getChannelData(1)[i], 6);
    }
  });

  it("waveform undefined -> 'sine'", () => {
    const dry = makeConstMono(1.0, 16, 1000);
    const outUndef = applyAutoPan(dry, { rateHz: 50, depth: 1 });
    const outSine = applyAutoPan(dry, { rateHz: 50, depth: 1, waveform: "sine" });
    for (let i = 0; i < outUndef.length; i++) {
      expect(outUndef.getChannelData(0)[i]).toBeCloseTo(outSine.getChannelData(0)[i], 6);
    }
  });

  it("alle extremen Werte -> finite output (kein NaN/Infinity)", () => {
    const dry = makeMonoBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyAutoPan(dry, {
      rateHz: Infinity,
      depth: Infinity,
      // @ts-expect-error: testing runtime fallback
      waveform: "weird",
    });
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i])).toBe(true);
      expect(Number.isFinite(R[i])).toBe(true);
    }
  });
});

// --- Tests: DSP-Verhalten / Waveforms ---------------------------------------

describe("v3.209 applyAutoPan waveforms", () => {
  it("sine vs triangle vs square: produzieren unterschiedliche Kurven", () => {
    // Bei identischem rate/depth muessen die LFO-Formen messbar unterschiedliche
    // Outputs liefern (DC input=1, viele Samples damit Periode passt).
    const dry = makeConstMono(1.0, 200, 48000);
    const sine = applyAutoPan(dry, { rateHz: 5, depth: 1, waveform: "sine" });
    const tri = applyAutoPan(dry, { rateHz: 5, depth: 1, waveform: "triangle" });
    const sqr = applyAutoPan(dry, { rateHz: 5, depth: 1, waveform: "square" });
    // Pruefen dass mind. ein i existiert wo sich Outputs >0.001 unterscheiden
    let diffSineTri = 0;
    let diffSineSqr = 0;
    let diffTriSqr = 0;
    for (let i = 0; i < sine.length; i++) {
      diffSineTri += Math.abs(sine.getChannelData(0)[i] - tri.getChannelData(0)[i]);
      diffSineSqr += Math.abs(sine.getChannelData(0)[i] - sqr.getChannelData(0)[i]);
      diffTriSqr += Math.abs(tri.getChannelData(0)[i] - sqr.getChannelData(0)[i]);
    }
    expect(diffSineTri).toBeGreaterThan(0.1);
    expect(diffSineSqr).toBeGreaterThan(0.1);
    expect(diffTriSqr).toBeGreaterThan(0.1);
  });

  it("square waveform: nur 2 distinkte (L, R)-Paare ueber eine Periode (hard L/R)", () => {
    // sr=160, rate=20 (max-Clamp) -> Periode = 8 samples; halbe Periode = 4 samples
    // phase<0.5 -> lfo=+1 -> pan=+1 -> L=0, R=1
    // phase>=0.5 -> lfo=-1 -> pan=-1 -> L=1, R=0
    const dry = makeConstMono(1.0, 16, 160);
    const out = applyAutoPan(dry, { rateHz: 20, depth: 1, waveform: "square" });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    // Erste 4 sample: L=0, R=1
    for (let i = 0; i < 4; i++) {
      expect(L[i]).toBeCloseTo(0, 6);
      expect(R[i]).toBeCloseTo(1, 6);
    }
    // Naechste 4 sample: L=1, R=0
    for (let i = 4; i < 8; i++) {
      expect(L[i]).toBeCloseTo(1, 6);
      expect(R[i]).toBeCloseTo(0, 6);
    }
    // Wiederholung in zweiter Periode
    expect(L[8]).toBeCloseTo(0, 6);
    expect(R[8]).toBeCloseTo(1, 6);
  });

  it("triangle waveform: liefert lineare Rampen mit Endpunkten -1,+1,-1", () => {
    // sr=160, rate=20 (max-Clamp) -> Periode = 8 samples.
    // phase=0   -> lfo=-1 -> pan=-1 -> L=1, R=0
    // phase=0.5 -> lfo=+1 -> pan=+1 -> L=0, R=1
    const dry = makeConstMono(1.0, 9, 160);
    const out = applyAutoPan(dry, { rateHz: 20, depth: 1, waveform: "triangle" });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    // sample 0: phase=0   -> lfo=-1, pan=-1: L=1, R=0
    expect(L[0]).toBeCloseTo(1, 5);
    expect(R[0]).toBeCloseTo(0, 5);
    // sample 4: phase=0.5 -> lfo=+1, pan=+1: L=0, R=1
    expect(L[4]).toBeCloseTo(0, 5);
    expect(R[4]).toBeCloseTo(1, 5);
    // sample 8: phase=1 (wraps) -> phase=0 -> wieder L=1, R=0
    expect(L[8]).toBeCloseTo(1, 5);
    expect(R[8]).toBeCloseTo(0, 5);
  });

  it("zero-input -> zero-output (gain * 0 == 0)", () => {
    const dry = makeConstMono(0.0, 32, 48000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(0, 9);
      expect(R[i]).toBeCloseTo(0, 9);
    }
  });

  it("output ist immer 2-channel, auch bei mono input (numberOfChannels=2)", () => {
    const dry = makeConstMono(0.5, 100, 48000);
    const out = applyAutoPan(dry, { rateHz: 0.5, depth: 1, waveform: "sine" });
    expect(out.numberOfChannels).toBe(2);
  });
});

// --- Tests: AUTOPAN_PRESETS -------------------------------------------------

describe("v3.209 AUTOPAN_PRESETS", () => {
  it("enthaelt subtle/classic/fast/trance", () => {
    expect(AUTOPAN_PRESETS.subtle).toBeDefined();
    expect(AUTOPAN_PRESETS.classic).toBeDefined();
    expect(AUTOPAN_PRESETS.fast).toBeDefined();
    expect(AUTOPAN_PRESETS.trance).toBeDefined();
  });

  it("alle Presets haben rateHz/depth/waveform mit plausiblen Werten", () => {
    const all = [
      AUTOPAN_PRESETS.subtle,
      AUTOPAN_PRESETS.classic,
      AUTOPAN_PRESETS.fast,
      AUTOPAN_PRESETS.trance,
    ];
    for (const p of all) {
      expect(typeof p.rateHz).toBe("number");
      expect(typeof p.depth).toBe("number");
      expect(typeof p.waveform).toBe("string");
      expect(p.rateHz).toBeGreaterThan(0);
      expect(p.rateHz).toBeLessThanOrEqual(20);
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThanOrEqual(1);
      expect(["sine", "triangle", "square"]).toContain(p.waveform);
    }
  });

  it("preset 'subtle' matched Spec: rate=0.2, depth=0.4, waveform=sine", () => {
    expect(AUTOPAN_PRESETS.subtle.rateHz).toBe(0.2);
    expect(AUTOPAN_PRESETS.subtle.depth).toBe(0.4);
    expect(AUTOPAN_PRESETS.subtle.waveform).toBe("sine");
  });

  it("preset 'classic' matched Spec: rate=0.5, depth=0.7, waveform=sine", () => {
    expect(AUTOPAN_PRESETS.classic.rateHz).toBe(0.5);
    expect(AUTOPAN_PRESETS.classic.depth).toBe(0.7);
    expect(AUTOPAN_PRESETS.classic.waveform).toBe("sine");
  });

  it("preset 'fast' matched Spec: rate=2, depth=1, waveform=triangle", () => {
    expect(AUTOPAN_PRESETS.fast.rateHz).toBe(2);
    expect(AUTOPAN_PRESETS.fast.depth).toBe(1);
    expect(AUTOPAN_PRESETS.fast.waveform).toBe("triangle");
  });

  it("preset 'trance' matched Spec: rate=0.5, depth=1, waveform=square", () => {
    expect(AUTOPAN_PRESETS.trance.rateHz).toBe(0.5);
    expect(AUTOPAN_PRESETS.trance.depth).toBe(1);
    expect(AUTOPAN_PRESETS.trance.waveform).toBe("square");
  });

  it("presets sind direkt anwendbar via applyAutoPan(buf, preset)", () => {
    const dry = makeConstMono(0.5, 64, 48000);
    const out = applyAutoPan(dry, AUTOPAN_PRESETS.classic);
    expect(out.length).toBe(64);
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i])).toBe(true);
      expect(Number.isFinite(R[i])).toBe(true);
    }
  });

  it("alle presets liefern finite output bei realistic sine-input", () => {
    const dry = makeSineMono(1000, 440, 48000);
    const presets = [
      AUTOPAN_PRESETS.subtle,
      AUTOPAN_PRESETS.classic,
      AUTOPAN_PRESETS.fast,
      AUTOPAN_PRESETS.trance,
    ];
    for (const p of presets) {
      const out = applyAutoPan(dry, p);
      expect(out.numberOfChannels).toBe(2);
      const L = out.getChannelData(0);
      const R = out.getChannelData(1);
      for (let i = 0; i < L.length; i++) {
        expect(Number.isFinite(L[i])).toBe(true);
        expect(Number.isFinite(R[i])).toBe(true);
      }
    }
  });
});
