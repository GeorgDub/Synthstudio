// @vitest-environment node
/**
 * sample-freq-shift.test.ts - v3.225.0
 *
 * Tests fuer sampleFreqShift Pure-Helper (cos-Carrier-Multiplikation
 * als vereinfachte SSB-Approximation).
 *
 * WICHTIG: Aufgrund der cos-Symmetrie (cos ist gerade Funktion) liefern
 * positive UND negative shiftHz IDENTISCHEN Output sample-fuer-sample.
 * Das ist eine bewusste Eigenschaft der Approximation; ein echter SSB-
 * Shifter (mit Hilbert-Transform) wuerde +/- unterscheiden.
 */

import { describe, it, expect } from "vitest";
import { applyFreqShift } from "../../client/src/utils/sampleFreqShift";
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

describe("v3.225 applyFreqShift", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyFreqShift(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer mit eigener sampleRate behaelt sampleRate", () => {
    const out = applyFreqShift(makeEmptyBuffer(44100), { shiftHz: 100, mix: 1 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("null-buffer -> fallback sampleRate 48000 + empty", () => {
    const out = applyFreqShift(null as unknown as AudioBufferLike);
    expect(out.sampleRate).toBe(48000);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("mix=0 ergibt exakt identity (dry pass-through)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, -0.0625, 0.9, -0.4], 1000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: 0 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(-0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
  });

  it("shiftHz=0 ergibt exakt identity (cos(0)=1 fuer alle Samples)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, -0.0625, 0.9, -0.4], 48000);
    const out = applyFreqShift(dry, { shiftHz: 0, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(-0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
  });

  it("mix=1 deterministic phase (sr=1000, shiftHz=250 -> 4-sample-Periode)", () => {
    const dry = makeConst(0.5, 8, 1000);
    const out = applyFreqShift(dry, { shiftHz: 250, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 5);
    expect(got[1]).toBeCloseTo(0, 5);
    expect(got[2]).toBeCloseTo(-0.5, 5);
    expect(got[3]).toBeCloseTo(0, 5);
    expect(got[4]).toBeCloseTo(0.5, 5);
    expect(got[5]).toBeCloseTo(0, 5);
    expect(got[6]).toBeCloseTo(-0.5, 5);
    expect(got[7]).toBeCloseTo(0, 5);
  });

  it("mix=0.5: 50/50 dry-wet-blend", () => {
    const dry = makeConst(0.4, 4, 1000);
    const out = applyFreqShift(dry, { shiftHz: 250, mix: 0.5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.4, 5);
    expect(got[1]).toBeCloseTo(0.2, 5);
    expect(got[2]).toBeCloseTo(0.0, 5);
    expect(got[3]).toBeCloseTo(0.2, 5);
  });

  it("positive vs negative shiftHz produce IDENTICAL output (cos symmetry)", () => {
    const dry = makeSine(512, 440, 48000);
    const outPos = applyFreqShift(dry, { shiftHz: 50, mix: 1 });
    const outNeg = applyFreqShift(dry, { shiftHz: -50, mix: 1 });
    const a = Array.from(outPos.getChannelData(0));
    const b = Array.from(outNeg.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("length-preservation: output.length === input.length", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 48000);
    const out = applyFreqShift(dry, { shiftHz: 100, mix: 0.5 });
    expect(out.length).toBe(10);
  });

  it("multi-channel: shared carrier -> identische Channels -> identischer Output", () => {
    const dry = makeStereoBuffer(
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      48000,
    );
    const out = applyFreqShift(dry, { shiftHz: 50, mix: 1 });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("multi-channel: L=signal, R=silence -> R bleibt silence (kein channel-leak)", () => {
    const dry = makeStereoBuffer(
      [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      1000,
    );
    const out = applyFreqShift(dry, { shiftHz: 250, mix: 1 });
    expect(out.numberOfChannels).toBe(2);
    const R = Array.from(out.getChannelData(1));
    for (const v of R) {
      expect(v).toBeCloseTo(0, 9);
    }
  });

  it("defaults greifen ohne options-objekt (shiftHz=50, mix=1)", () => {
    const dry = makeBuffer([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], 48000);
    const out = applyFreqShift(dry);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(1.0, 6);
    for (const v of got) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("immutability: input-buffer wird nicht mutiert", () => {
    const src = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 1000);
    const before = Array.from(src.getChannelData(0));
    applyFreqShift(src, { shiftHz: 200, mix: 1 });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("verschiedene sampleRates: 8000 Hz funktioniert", () => {
    const dry = makeSine(800, 100, 8000);
    const out = applyFreqShift(dry, { shiftHz: 50, mix: 1 });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(800);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("verschiedene sampleRates: 44100 Hz funktioniert", () => {
    const dry = makeSine(4410, 440, 44100);
    const out = applyFreqShift(dry, { shiftHz: 100, mix: 0.7 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(4410);
  });

  it("verschiedene sampleRates: 96000 Hz funktioniert", () => {
    const dry = makeSine(9600, 440, 96000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: 1 });
    expect(out.sampleRate).toBe(96000);
    expect(out.length).toBe(9600);
  });

  it("sanitizer: shiftHz NaN -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625, 0.9, -0.4], 48000);
    const out = applyFreqShift(dry, { shiftHz: NaN, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
  });

  it("sanitizer: shiftHz Infinity -> 0 (identity, NICHT clamp)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyFreqShift(dry, { shiftHz: Infinity, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: shiftHz -Infinity -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25], 48000);
    const out = applyFreqShift(dry, { shiftHz: -Infinity, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
  });

  it("sanitizer: shiftHz > 5000 -> clamp 5000", () => {
    const dry = makeConst(1.0, 200, 48000);
    const out99k = applyFreqShift(dry, { shiftHz: 99999, mix: 1 });
    const out5k = applyFreqShift(dry, { shiftHz: 5000, mix: 1 });
    const a = Array.from(out99k.getChannelData(0));
    const b = Array.from(out5k.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: shiftHz < -5000 -> clamp -5000", () => {
    const dry = makeConst(1.0, 200, 48000);
    const outNeg = applyFreqShift(dry, { shiftHz: -99999, mix: 1 });
    const out5kNeg = applyFreqShift(dry, { shiftHz: -5000, mix: 1 });
    const a = Array.from(outNeg.getChannelData(0));
    const b = Array.from(out5kNeg.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: shiftHz undefined -> default 50 (NICHT identity)", () => {
    const dry = makeConst(1.0, 1000, 48000);
    const outDefault = applyFreqShift(dry, { mix: 1 });
    const outIdentity = applyFreqShift(dry, { shiftHz: 0, mix: 1 });
    const a = Array.from(outDefault.getChannelData(0));
    const b = Array.from(outIdentity.getChannelData(0));
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff += Math.abs(a[i] - b[i]);
    }
    expect(diff).toBeGreaterThan(0.1);
  });

  it("sanitizer: mix NaN -> 0 (dry pass-through)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625, 0.9, -0.4], 48000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: NaN });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
  });

  it("sanitizer: mix < 0 -> 0 (dry)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: -5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: mix > 1 -> clamp 1 (full wet)", () => {
    const dry = makeConst(1.0, 8, 1000);
    const out99 = applyFreqShift(dry, { shiftHz: 250, mix: 99 });
    const out1 = applyFreqShift(dry, { shiftHz: 250, mix: 1 });
    const a = Array.from(out99.getChannelData(0));
    const b = Array.from(out1.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: mix Infinity -> 0 (non-finite -> dry)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: Infinity });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: alle extreme values -> finite output", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFreqShift(dry, {
      shiftHz: Infinity,
      mix: Infinity,
    });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("mix=1 (full wet) ist nicht-identitaet bei shiftHz nonzero", () => {
    const dry = makeConst(0.5, 1000, 48000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    let diff = 0;
    for (let i = 0; i < got.length; i++) {
      diff += Math.abs(got[i] - 0.5);
    }
    expect(diff).toBeGreaterThan(0.1);
  });

  it("output amplitude <= input amplitude bei mix in [0,1] (Dreiecksungleichung)", () => {
    const dry = makeBuffer([1.0, -1.0, 0.8, -0.8, 0.5, -0.5], 1000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: 0.7 });
    const got = Array.from(out.getChannelData(0));
    const drySamples = Array.from(dry.getChannelData(0));
    for (let i = 0; i < got.length; i++) {
      expect(Math.abs(got[i])).toBeLessThanOrEqual(Math.abs(drySamples[i]) + 1e-9);
    }
  });

  it("zero-input -> zero-output", () => {
    const dry = makeConst(0.0, 32, 48000);
    const out = applyFreqShift(dry, { shiftHz: 200, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    for (const v of got) {
      expect(v).toBeCloseTo(0, 9);
    }
  });

  it("output finite fuer realistic sine input", () => {
    const dry = makeSine(2048, 440, 48000);
    const out = applyFreqShift(dry, { shiftHz: 100, mix: 0.8 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("different shiftHz values produce different output (effect existence)", () => {
    const dry = makeConst(1.0, 1000, 48000);
    const out50 = applyFreqShift(dry, { shiftHz: 50, mix: 1 });
    const out200 = applyFreqShift(dry, { shiftHz: 200, mix: 1 });
    const a = Array.from(out50.getChannelData(0));
    const b = Array.from(out200.getChannelData(0));
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff += Math.abs(a[i] - b[i]);
    }
    expect(diff).toBeGreaterThan(0.1);
  });

  it("out-of-range channel access throws RangeError", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyFreqShift(dry, { shiftHz: 50, mix: 1 });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(99)).toThrow(RangeError);
  });

  it("returned channels are NOT aliased to input (deep immutability)", () => {
    const src = makeBuffer([0.5, 0.4, 0.3, 0.2], 1000);
    const out = applyFreqShift(src, { shiftHz: 250, mix: 0 });
    const srcData = src.getChannelData(0);
    const outData = out.getChannelData(0);
    expect(outData).not.toBe(srcData);
    outData[0] = 999;
    expect(src.getChannelData(0)[0]).toBeCloseTo(0.5, 6);
  });
});
