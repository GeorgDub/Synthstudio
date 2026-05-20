// @vitest-environment node
/**
 * sample-click-remover.test.ts - v3.214.0
 *
 * Tests fuer sampleClickRemover Pure-Helper (detect + smooth Clicks/Pops).
 *
 * Spec-pinned design decisions (from spec + advisor):
 *   - Ramp formula: out[i+k] = A + (B-A)*(k+1)/(fadeSamples+1) fuer k in [0, fadeSamples-1]
 *   - Detection startet bei i=1 (kein samples[-1])
 *   - Click an i wo i+fadeSamples >= length -> SKIPPED (nicht gezaehlt)
 *   - Multi-channel: clicksDetected = Summe ueber Channels
 *   - Ueberlappende Clicks: detect-all-first auf Input, ramps in 2. Pass
 */

import { describe, it, expect } from "vitest";
import {
  removeClicks,
  detectClickPositions,
} from "../../client/src/utils/sampleClickRemover";
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

/** Smooth ramp 0..1 over len samples — no clicks, deltas tiny. */
function makeSmoothRamp(len: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = i / Math.max(1, len - 1);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

describe("v3.214 removeClicks", () => {
  it("empty buffer ergibt empty output + clicksDetected=0", () => {
    const res = removeClicks(makeEmptyBuffer());
    expect(res.buffer.length).toBe(0);
    expect(res.buffer.numberOfChannels).toBe(0);
    expect(res.clicksDetected).toBe(0);
  });

  it("empty buffer behaelt sampleRate", () => {
    const buf = makeEmptyBuffer(44100);
    const res = removeClicks(buf, { threshold: 0.5, fadeSamples: 16 });
    expect(res.buffer.sampleRate).toBe(44100);
    expect(res.clicksDetected).toBe(0);
  });

  it("empty buffer (null) -> fallback sampleRate 48000", () => {
    const res = removeClicks(null as unknown as AudioBufferLike);
    expect(res.buffer.sampleRate).toBe(48000);
    expect(res.buffer.length).toBe(0);
    expect(res.clicksDetected).toBe(0);
  });

  it("no clicks (smooth ramp) -> output unchanged + clicksDetected=0", () => {
    const buf = makeSmoothRamp(100);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 32 });
    expect(res.clicksDetected).toBe(0);
    const inData = buf.getChannelData(0);
    const outData = res.buffer.getChannelData(0);
    for (let i = 0; i < 100; i++) {
      expect(outData[i]).toBeCloseTo(inData[i], 6);
    }
  });

  it("single click detected + smoothed: delta after smoothing < threshold", () => {
    const samples = [0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 4 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
    const out = res.buffer.getChannelData(0);
    for (let i = 5; i <= 8; i++) {
      expect(Math.abs(out[i])).toBeLessThan(0.01);
    }
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThan(0.3);
    }
  });

  it("multi-clicks (3 clicks well-separated) -> alle detektiert", () => {
    const samples = new Array(60).fill(0);
    samples[10] = 0.9;
    samples[25] = -0.8;
    samples[40] = 0.85;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 4 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(3);
  });

  it("threshold=1 (strict >) -> jumps von 0.9 werden NICHT detektiert", () => {
    const samples = [0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 1, fadeSamples: 2 });
    expect(res.clicksDetected).toBe(0);
    const out = res.buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      expect(out[i]).toBeCloseTo(samples[i], 6);
    }
  });

  it("multi-channel: click only on L counts >= 1", () => {
    const L = [0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0];
    const R = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const buf = makeStereoBuffer(L, R);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 4 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
    expect(res.buffer.numberOfChannels).toBe(2);
    const outR = res.buffer.getChannelData(1);
    for (let i = 0; i < R.length; i++) {
      expect(outR[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("multi-channel: clicks on both channels -> sum across channels", () => {
    const L = [0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0];
    const R = [0, 0, 0, 0, 0, -0.8, 0, 0, 0, 0, 0, 0];
    const buf = makeStereoBuffer(L, R);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 4 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(2);
  });

  it("length preservation: output length == input length", () => {
    const samples = new Array(200).fill(0);
    samples[50] = 0.8;
    samples[100] = -0.9;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 16 });
    expect(res.buffer.length).toBe(200);
  });

  it("immutability: input buffer wird nie mutiert", () => {
    const samples = [0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const inDataBefore = Array.from(buf.getChannelData(0));
    removeClicks(buf, { threshold: 0.3, fadeSamples: 4 });
    const inDataAfter = Array.from(buf.getChannelData(0));
    expect(inDataAfter).toEqual(inDataBefore);
  });

  it("output ist fresh Float32Array, nicht aliased zu input", () => {
    const samples = [0, 0, 0, 0, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 2 });
    expect(res.buffer.getChannelData(0)).not.toBe(buf.getChannelData(0));
  });

  it("detectClickPositions standalone: detektiert korrekt", () => {
    const samples = new Float32Array([0, 0, 0, 0.9, 0, 0, -0.8, 0, 0, 0]);
    const positions = detectClickPositions(samples, 0.3);
    expect(positions).toEqual([3, 4, 6, 7]);
  });

  it("detectClickPositions empty / single sample -> leeres Array", () => {
    expect(detectClickPositions(new Float32Array(0), 0.3)).toEqual([]);
    expect(detectClickPositions(new Float32Array([0.5]), 0.3)).toEqual([]);
    expect(detectClickPositions(null as unknown as Float32Array, 0.3)).toEqual([]);
  });

  it("detectClickPositions: threshold NaN -> default 0.3", () => {
    const samples = new Float32Array([0, 0, 0.5, 0, 0]);
    const positions = detectClickPositions(samples, NaN);
    expect(positions).toEqual([2, 3]);
  });

  it("defaults: opts undefined -> threshold 0.3, fadeSamples 32", () => {
    const samples = new Array(100).fill(0);
    samples[50] = 0.5;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf);
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
  });

  it("sanitizer: threshold=0 -> default 0.3", () => {
    const samples = [0, 0, 0, 0.4, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0, fadeSamples: 2 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
  });

  it("sanitizer: threshold>1 -> clamped to 1", () => {
    const samples = [0, 0, 0, 0.9, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 5, fadeSamples: 2 });
    expect(res.clicksDetected).toBe(0);
  });

  it("sanitizer: fadeSamples=0 -> default 32", () => {
    const samples = new Array(100).fill(0);
    samples[50] = 0.8;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 0 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
  });

  it("sanitizer: fadeSamples=1 (min valid) wird NICHT defaulted", () => {
    const samples = [0, 0, 0, 1, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 1 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
    const out = res.buffer.getChannelData(0);
    expect(out[3]).toBeCloseTo(0, 6);
  });

  it("sanitizer: fadeSamples>1000 -> clamped to 1000", () => {
    const samples = new Array(2000).fill(0);
    samples[500] = 0.9;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 99999 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
  });

  it("sanitizer: fadeSamples NaN -> default 32", () => {
    const samples = new Array(100).fill(0);
    samples[50] = 0.8;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: NaN });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
  });

  it("sanitizer: fadeSamples non-integer (5.7) -> floor 5", () => {
    const samples = new Array(30).fill(0);
    samples[10] = 0.9;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 5.7 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(1);
  });

  it("verschiedene sampleRates -> identisches Verhalten + preservation", () => {
    const mk = (sr: number) => {
      const data = new Array(50).fill(0);
      data[25] = 0.8;
      return makeBuffer(data, sr);
    };
    const r1 = removeClicks(mk(8000), { threshold: 0.3, fadeSamples: 4 });
    const r2 = removeClicks(mk(44100), { threshold: 0.3, fadeSamples: 4 });
    const r3 = removeClicks(mk(96000), { threshold: 0.3, fadeSamples: 4 });
    expect(r1.clicksDetected).toBe(r2.clicksDetected);
    expect(r2.clicksDetected).toBe(r3.clicksDetected);
    expect(r1.buffer.sampleRate).toBe(8000);
    expect(r2.buffer.sampleRate).toBe(44100);
    expect(r3.buffer.sampleRate).toBe(96000);
  });

  it("clicksDetected wird korrekt returned (integer >= 0)", () => {
    const samples = new Array(100).fill(0);
    samples[20] = 0.8;
    samples[60] = 0.9;
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 4 });
    expect(typeof res.clicksDetected).toBe("number");
    expect(Number.isInteger(res.clicksDetected)).toBe(true);
    expect(res.clicksDetected).toBeGreaterThan(0);
  });

  it("click at first sample edge case: i=0 wird nie detektiert", () => {
    const samples = [0.9, 0, 0, 0, 0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 2 });
    expect(res.clicksDetected).toBe(1);
    const positions = detectClickPositions(new Float32Array(samples), 0.3);
    expect(positions).toEqual([1]);
  });

  it("click at last sample edge case: i+fadeSamples >= length -> SKIPPED", () => {
    const samples = [0, 0, 0, 0, 0, 0, 0, 0, 0.9, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 5 });
    expect(res.clicksDetected).toBe(0);
  });

  it("ramp interpolation linear: hand-computed Werte korrekt", () => {
    const samples = [0, 0, 0, 0, 0, 0.8, 0.8, 0.8, 1, 1];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 3 });
    const out = res.buffer.getChannelData(0);
    expect(out[4]).toBeCloseTo(0, 6);
    expect(out[5]).toBeCloseTo(0.25, 6);
    expect(out[6]).toBeCloseTo(0.5, 6);
    expect(out[7]).toBeCloseTo(0.75, 6);
    expect(out[8]).toBeCloseTo(1, 6);
  });

  it("RangeError bei out-of-range channel access am output", () => {
    const samples = [0, 0, 0, 0];
    const buf = makeBuffer(samples);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 1 });
    expect(() => res.buffer.getChannelData(5)).toThrow(RangeError);
    expect(() => res.buffer.getChannelData(-1)).toThrow(RangeError);
  });

  it("multi-channel: detection unabhaengig pro channel", () => {
    const L = [0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0];
    const R = [0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0];
    const buf = makeStereoBuffer(L, R);
    const res = removeClicks(buf, { threshold: 0.3, fadeSamples: 2 });
    expect(res.clicksDetected).toBeGreaterThanOrEqual(2);
  });
});
