// @vitest-environment node
/**
 * sample-stereo-enhancer.test.ts — v3.197.0
 *
 * Tests for Stereo-Enhancer Pure-Helper (M/S processing).
 *
 * Math reference:
 *   M = (L+R)/2, S = (L-R)/2
 *   L_out = M + S*width
 *   R_out = M - S*width
 */

import { describe, it, expect } from "vitest";
import {
  applyStereoEnhance,
  DEFAULT_WIDTH,
  MIN_WIDTH,
  MAX_WIDTH,
} from "../../client/src/utils/sampleStereoEnhancer";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeStereo(left: number[], right: number[], sampleRate = 48000): AudioBufferLike {
  const L = new Float32Array(left);
  const R = new Float32Array(right);
  const arrays = [L, R];
  return { sampleRate, numberOfChannels: 2, length: L.length, getChannelData: (c: number) => arrays[c] };
}

function makeMono(values: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(values);
  return { sampleRate, numberOfChannels: 1, length: data.length, getChannelData: () => data };
}

function makeMultiChannel(arrays: number[][], sampleRate = 48000): AudioBufferLike {
  const floats = arrays.map((a) => new Float32Array(a));
  return { sampleRate, numberOfChannels: floats.length, length: floats[0]?.length ?? 0, getChannelData: (c: number) => floats[c] };
}

function makeEmpty(): AudioBufferLike {
  return { sampleRate: 48000, numberOfChannels: 0, length: 0, getChannelData: () => new Float32Array(0) };
}

describe("v3.197 applyStereoEnhance — basics", () => {
  it("empty buffer -> empty result (no throw)", () => {
    const out = applyStereoEnhance(makeEmpty());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("undefined options -> identity (width defaults to 1)", () => {
    const buf = makeStereo([0.5, -0.5, 0.25], [0.3, -0.3, 0.1]);
    const out = applyStereoEnhance(buf);
    expect(Array.from(out.getChannelData(0))).toEqual(Array.from(buf.getChannelData(0)));
    expect(Array.from(out.getChannelData(1))).toEqual(Array.from(buf.getChannelData(1)));
  });

  it("empty options object -> width undefined -> identity", () => {
    const buf = makeStereo([0.4, -0.2], [-0.1, 0.6]);
    const out = applyStereoEnhance(buf, {});
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(-0.2, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(-0.1, 6);
    expect(out.getChannelData(1)[1]).toBeCloseTo(0.6, 6);
  });

  it("sampleRate + length + numberOfChannels preserved", () => {
    const buf = makeStereo([0.1, 0.2, 0.3], [0.4, 0.5, 0.6], 44100);
    const out = applyStereoEnhance(buf, { width: 0.5 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(3);
    expect(out.numberOfChannels).toBe(2);
  });
});

describe("v3.197 applyStereoEnhance — width behaviour", () => {
  it("mono buffer -> identity COPY (values match, but fresh Float32Array)", () => {
    const buf = makeMono([0.1, -0.4, 0.9, -1.0, 0]);
    const out = applyStereoEnhance(buf, { width: 0.5 });
    expect(out.numberOfChannels).toBe(1);
    // Compare Float32-to-Float32 to avoid precision mismatch with JS Number literals
    expect(Array.from(out.getChannelData(0))).toEqual(Array.from(buf.getChannelData(0)));
    expect(out.getChannelData(0)).not.toBe(buf.getChannelData(0));
  });

  it("width=1 -> identity for stereo (L_out=L, R_out=R)", () => {
    const buf = makeStereo([0.7, -0.3, 0.1], [0.2, -0.6, -0.8]);
    const out = applyStereoEnhance(buf, { width: 1 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.7, 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(-0.3, 6);
    expect(out.getChannelData(0)[2]).toBeCloseTo(0.1, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(0.2, 6);
    expect(out.getChannelData(1)[1]).toBeCloseTo(-0.6, 6);
    expect(out.getChannelData(1)[2]).toBeCloseTo(-0.8, 6);
  });

  it("width=0 -> mono-collapse (L_out=R_out=M)", () => {
    const buf = makeStereo([0.6, 0.0], [0.2, 0.8]);
    const out = applyStereoEnhance(buf, { width: 0 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(1)[1]).toBeCloseTo(0.4, 6);
    for (let i = 0; i < out.length; i++) {
      expect(out.getChannelData(0)[i]).toBeCloseTo(out.getChannelData(1)[i], 6);
    }
  });

  it("width=2 -> doubled side (L_out=(3L-R)/2, R_out=(3R-L)/2)", () => {
    const buf = makeStereo([1.0, 0.4], [0.0, 0.2]);
    const out = applyStereoEnhance(buf, { width: 2 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(1.5, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(-0.5, 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(0.5, 6);
    expect(out.getChannelData(1)[1]).toBeCloseTo(0.1, 6);
  });

  it("width=2 doubles the side-signal magnitude vs width=1", () => {
    const buf = makeStereo([1, -1], [-1, 1]);
    const out1 = applyStereoEnhance(buf, { width: 1 });
    const out2 = applyStereoEnhance(buf, { width: 2 });
    expect(out2.getChannelData(0)[0]).toBeCloseTo(2 * out1.getChannelData(0)[0], 6);
    expect(out2.getChannelData(1)[0]).toBeCloseTo(2 * out1.getChannelData(1)[0], 6);
  });

  it("width=0.5 -> half-width (between mono and identity)", () => {
    const buf = makeStereo([0.8], [0.2]);
    const out = applyStereoEnhance(buf, { width: 0.5 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.65, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(0.35, 6);
  });
});

describe("v3.197 applyStereoEnhance — defensive defaults", () => {
  it("width NaN -> falls back to 1 (identity)", () => {
    const buf = makeStereo([0.4, -0.7], [0.1, 0.3]);
    const out = applyStereoEnhance(buf, { width: NaN });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(-0.7, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(0.1, 6);
    expect(out.getChannelData(1)[1]).toBeCloseTo(0.3, 6);
  });

  it("width Infinity -> clamped to MAX_WIDTH (2) (behaves like width=2)", () => {
    const buf = makeStereo([1.0], [0.0]);
    const fromInf = applyStereoEnhance(buf, { width: Number.POSITIVE_INFINITY });
    const fromMax = applyStereoEnhance(buf, { width: 2 });
    expect(fromInf.getChannelData(0)[0]).toBeCloseTo(fromMax.getChannelData(0)[0], 6);
    expect(fromInf.getChannelData(1)[0]).toBeCloseTo(fromMax.getChannelData(1)[0], 6);
  });

  it("width -1 -> clamped to MIN_WIDTH (0) (mono collapse)", () => {
    const buf = makeStereo([0.6, 0.0], [0.2, 0.8]);
    const out = applyStereoEnhance(buf, { width: -1 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(1)[1]).toBeCloseTo(0.4, 6);
  });

  it("width 5 (above MAX) -> clamped to 2 (extreme wide)", () => {
    const buf = makeStereo([1.0], [0.0]);
    const fromHi = applyStereoEnhance(buf, { width: 5 });
    expect(fromHi.getChannelData(0)[0]).toBeCloseTo(1.5, 6);
    expect(fromHi.getChannelData(1)[0]).toBeCloseTo(-0.5, 6);
  });

  it("input buffer is NOT mutated", () => {
    const leftOriginal = [0.3, -0.4, 0.5];
    const rightOriginal = [0.6, -0.7, 0.8];
    const buf = makeStereo([...leftOriginal], [...rightOriginal]);
    const snapL = Array.from(buf.getChannelData(0));
    const snapR = Array.from(buf.getChannelData(1));
    applyStereoEnhance(buf, { width: 0 });
    applyStereoEnhance(buf, { width: 2 });
    expect(Array.from(buf.getChannelData(0))).toEqual(snapL);
    expect(Array.from(buf.getChannelData(1))).toEqual(snapR);
  });
});

describe("v3.197 applyStereoEnhance — multi-channel", () => {
  it("3-channel buffer: Ch 0/1 M/S processed, Ch 2 passed through (fresh copy)", () => {
    const buf = makeMultiChannel([
      [1.0, 0.4],
      [0.0, 0.2],
      [0.9, -0.5],
    ]);
    const out = applyStereoEnhance(buf, { width: 2 });
    expect(out.numberOfChannels).toBe(3);
    expect(out.getChannelData(0)[0]).toBeCloseTo(1.5, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(-0.5, 6);
    expect(out.getChannelData(2)[0]).toBeCloseTo(0.9, 6);
    expect(out.getChannelData(2)[1]).toBeCloseTo(-0.5, 6);
    expect(out.getChannelData(2)).not.toBe(buf.getChannelData(2));
  });

  it("4-channel buffer: Ch 2+3 unchanged on width=0 mono-collapse", () => {
    const buf = makeMultiChannel([
      [0.6, 0.0],
      [0.2, 0.8],
      [0.1, 0.2],
      [-0.3, -0.4],
    ]);
    const out = applyStereoEnhance(buf, { width: 0 });
    expect(out.numberOfChannels).toBe(4);
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(0.4, 6);
    expect(out.getChannelData(2)[0]).toBeCloseTo(0.1, 6);
    expect(out.getChannelData(2)[1]).toBeCloseTo(0.2, 6);
    expect(out.getChannelData(3)[0]).toBeCloseTo(-0.3, 6);
    expect(out.getChannelData(3)[1]).toBeCloseTo(-0.4, 6);
  });
});

describe("v3.197 constants", () => {
  it("exports DEFAULT_WIDTH=1, MIN_WIDTH=0, MAX_WIDTH=2", () => {
    expect(DEFAULT_WIDTH).toBe(1);
    expect(MIN_WIDTH).toBe(0);
    expect(MAX_WIDTH).toBe(2);
  });
});
