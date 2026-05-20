// @vitest-environment node
/**
 * sample-time-stretch.test.ts (v3.219.0)
 *
 * Pure-Coverage for sampleTimeStretch.ts (OLA Time-Stretch without Pitch).
 */

import { describe, it, expect } from "vitest";
import {
  applyTimeStretch,
  DEFAULT_STRETCH_FACTOR,
  MAX_STRETCH_FACTOR,
  DEFAULT_GRAIN_SIZE_MS,
  MIN_GRAIN_SIZE_MS,
  MAX_GRAIN_SIZE_MS,
  DEFAULT_OVERLAP,
  MIN_OVERLAP,
  MAX_OVERLAP,
} from "../../client/src/utils/sampleTimeStretch";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// Helpers --------------------------------------------------------------------

function makeMono(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: (c: number) => {
      if (c !== 0) throw new RangeError("channel " + c + " out of range");
      return data;
    },
  };
}

function makeStereo(L: number[], R: number[], sampleRate = 48000): AudioBufferLike {
  const left = new Float32Array(L);
  const right = new Float32Array(R);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: Math.max(L.length, R.length),
    getChannelData: (c: number) => (c === 0 ? left : right),
  };
}

function makeEmptyBuf(sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function makeConstant(length: number, value: number, sampleRate = 48000): AudioBufferLike {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i++) arr[i] = value;
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: (c: number) => {
      if (c !== 0) throw new RangeError("channel " + c + " out of range");
      return arr;
    },
  };
}

// Basics ---------------------------------------------------------------------

describe("v3.219 applyTimeStretch -- empty / degenerate", () => {
  it("empty buffer -> empty result, fallback sampleRate", () => {
    const result = applyTimeStretch(makeEmptyBuf(), { stretchFactor: 2 });
    expect(result.length).toBe(0);
    expect(result.numberOfChannels).toBe(0);
    expect(result.sampleRate).toBe(48000);
  });

  it("empty buffer preserves own sampleRate", () => {
    const result = applyTimeStretch(makeEmptyBuf(22050), { stretchFactor: 2 });
    expect(result.sampleRate).toBe(22050);
  });

  it("numberOfChannels=0 with length>0 -> empty result", () => {
    const buf: AudioBufferLike = {
      sampleRate: 44100,
      numberOfChannels: 0,
      length: 100,
      getChannelData: () => new Float32Array(0),
    };
    const result = applyTimeStretch(buf);
    expect(result.length).toBe(0);
    expect(result.numberOfChannels).toBe(0);
  });

  it("null buffer cast -> empty result, fallback sampleRate", () => {
    const result = applyTimeStretch(null as unknown as AudioBufferLike, { stretchFactor: 2 });
    expect(result.length).toBe(0);
    expect(result.numberOfChannels).toBe(0);
    expect(result.sampleRate).toBe(48000);
  });
});

// stretchFactor effects ------------------------------------------------------

describe("v3.219 applyTimeStretch -- stretchFactor length", () => {
  it("stretchFactor=1 -> output length close to input length", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 1 });
    expect(result.length).toBeGreaterThanOrEqual(4800);
    expect(result.length).toBeLessThanOrEqual(4800 + 2400);
  });

  it("stretchFactor=2 -> output length close to 2x input length", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 2 });
    expect(result.length).toBeGreaterThanOrEqual(9600);
    expect(result.length).toBeLessThanOrEqual(9600 + 2400);
  });

  it("stretchFactor=0.5 -> output length close to 0.5x input length", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 0.5 });
    expect(result.length).toBeGreaterThanOrEqual(2400);
    expect(result.length).toBeLessThanOrEqual(2400 + 2400);
  });

  it("stretchFactor=4 -> output length close to 4x input length", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 4 });
    expect(result.length).toBeGreaterThanOrEqual(19200);
    expect(result.length).toBeLessThanOrEqual(19200 + 4800);
  });
});

// Multi-channel --------------------------------------------------------------

describe("v3.219 applyTimeStretch -- multi-channel", () => {
  it("preserves stereo layout (2 channels)", () => {
    const L = new Array(4800).fill(0.5);
    const R = new Array(4800).fill(-0.5);
    const buf = makeStereo(L, R);
    const result = applyTimeStretch(buf, { stretchFactor: 2 });
    expect(result.numberOfChannels).toBe(2);
    const li = result.getChannelData(0);
    const ri = result.getChannelData(1);
    // Find max-abs samples on each channel; the left channel must hold a
    // positive max while right channel holds a negative min. Robust across
    // grain-boundary zero-crossings.
    let maxL = 0;
    let minR = 0;
    for (let i = 0; i < result.length; i++) {
      if (li[i] > maxL) maxL = li[i];
      if (ri[i] < minR) minR = ri[i];
    }
    expect(maxL).toBeGreaterThan(0);
    expect(minR).toBeLessThan(0);
  });

  it("getChannelData out-of-range -> RangeError", () => {
    const buf = makeConstant(1000, 0.3);
    const result = applyTimeStretch(buf, { stretchFactor: 2 });
    expect(() => result.getChannelData(-1)).toThrow(RangeError);
    expect(() => result.getChannelData(99)).toThrow(RangeError);
  });
});

// Defaults -------------------------------------------------------------------

describe("v3.219 applyTimeStretch -- defaults", () => {
  it("undefined opts -> defaults applied (identity length)", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf);
    expect(result.length).toBeGreaterThanOrEqual(4800);
    expect(result.length).toBeLessThanOrEqual(4800 + 2400);
  });

  it("empty opts {} -> defaults applied", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, {});
    expect(result.length).toBeGreaterThanOrEqual(4800);
  });

  it("DEFAULT_STRETCH_FACTOR=1, MAX_STRETCH_FACTOR=10", () => {
    expect(DEFAULT_STRETCH_FACTOR).toBe(1);
    expect(MAX_STRETCH_FACTOR).toBe(10);
  });

  it("DEFAULT_GRAIN_SIZE_MS=50 / MIN=10 / MAX=500", () => {
    expect(DEFAULT_GRAIN_SIZE_MS).toBe(50);
    expect(MIN_GRAIN_SIZE_MS).toBe(10);
    expect(MAX_GRAIN_SIZE_MS).toBe(500);
  });

  it("DEFAULT_OVERLAP=0.5 / MIN=0 / MAX=0.95", () => {
    expect(DEFAULT_OVERLAP).toBe(0.5);
    expect(MIN_OVERLAP).toBe(0);
    expect(MAX_OVERLAP).toBe(0.95);
  });
});

// Immutability + Determinism ------------------------------------------------

describe("v3.219 applyTimeStretch -- immutability", () => {
  it("input buffer is not mutated", () => {
    const orig = [0.1, 0.2, 0.3, 0.4, 0.5];
    const arr = new Float32Array(4800);
    for (let i = 0; i < orig.length; i++) arr[i] = orig[i];
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: 4800,
      getChannelData: () => arr,
    };
    applyTimeStretch(buf, { stretchFactor: 2 });
    for (let i = 0; i < orig.length; i++) {
      expect(arr[i]).toBeCloseTo(orig[i], 6);
    }
  });

  it("output is a fresh allocation (not aliased to input)", () => {
    const buf = makeConstant(1000, 0.3);
    const result = applyTimeStretch(buf, { stretchFactor: 1 });
    const out = result.getChannelData(0);
    const src = buf.getChannelData(0);
    out[0] = 99;
    expect(src[0]).toBeCloseTo(0.3, 6);
  });

  it("deterministic: two calls with same input give same output", () => {
    const buf = makeConstant(2000, 0.4);
    const a = applyTimeStretch(buf, { stretchFactor: 1.5 });
    const b = applyTimeStretch(buf, { stretchFactor: 1.5 });
    expect(a.length).toBe(b.length);
    const ad = a.getChannelData(0);
    const bd = b.getChannelData(0);
    for (let i = 0; i < ad.length; i++) {
      expect(ad[i]).toBeCloseTo(bd[i], 6);
    }
  });
});

// Sample rates ---------------------------------------------------------------

describe("v3.219 applyTimeStretch -- various sample rates", () => {
  it.each([8000, 22050, 44100, 48000, 96000])("preserves sampleRate %i", (sr) => {
    const buf = makeConstant(Math.floor(sr * 0.1), 0.5, sr);
    const result = applyTimeStretch(buf, { stretchFactor: 2 });
    expect(result.sampleRate).toBe(sr);
  });
});

// Sanitizer edge cases ------------------------------------------------------

describe("v3.219 applyTimeStretch -- sanitizer: stretchFactor", () => {
  it.each([
    [NaN, "NaN"],
    [Infinity, "PosInf"],
    [-Infinity, "NegInf"],
    [0, "zero"],
    [-1, "negative"],
  ])("invalid stretchFactor %s (%s) -> identity 1x", (val) => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: val as number });
    expect(result.length).toBeGreaterThanOrEqual(4800);
    expect(result.length).toBeLessThanOrEqual(4800 + 2400);
  });

  it("stretchFactor>10 -> clamped to 10", () => {
    const buf = makeConstant(1000, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 99 });
    expect(result.length).toBeGreaterThanOrEqual(10000);
    expect(result.length).toBeLessThan(15000);
  });
});

describe("v3.219 applyTimeStretch -- sanitizer: grainSizeMs", () => {
  it.each([
    [NaN, "NaN"],
    [Infinity, "PosInf"],
    [-Infinity, "NegInf"],
    [-50, "negative"],
    [5, "below-min"],
  ])("invalid grainSizeMs %s (%s) -> default 50", (val) => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { grainSizeMs: val as number });
    expect(result.length).toBeGreaterThanOrEqual(4800);
  });

  it("grainSizeMs>500 -> clamped to 500", () => {
    const buf = makeConstant(48000, 0.5);
    const result = applyTimeStretch(buf, { grainSizeMs: 99999 });
    expect(result.length).toBeGreaterThan(0);
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});

describe("v3.219 applyTimeStretch -- sanitizer: overlap", () => {
  it.each([
    [NaN, "NaN"],
    [Infinity, "PosInf"],
    [-Infinity, "NegInf"],
    [-0.5, "negative"],
  ])("invalid overlap %s (%s) -> clamped to 0", (val) => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { overlap: val as number });
    expect(result.length).toBeGreaterThan(0);
  });

  it("overlap>0.95 -> clamped to 0.95", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { overlap: 0.99 });
    expect(result.length).toBeGreaterThan(0);
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});

// Output finiteness ----------------------------------------------------------

describe("v3.219 applyTimeStretch -- output finiteness", () => {
  it("all output samples are finite", () => {
    const buf = makeConstant(4800, 0.7);
    const result = applyTimeStretch(buf, { stretchFactor: 2 });
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it("NaN/Inf samples in input -> output finite (NaN guarded)", () => {
    const arr = new Float32Array(4800);
    for (let i = 0; i < arr.length; i++) arr[i] = 0.3;
    arr[100] = NaN;
    arr[500] = Infinity;
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: 4800,
      getChannelData: () => arr,
    };
    const result = applyTimeStretch(buf, { stretchFactor: 1.5 });
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});

// Overlap edge cases ---------------------------------------------------------

describe("v3.219 applyTimeStretch -- overlap behavior", () => {
  it("overlap=0 (no overlap) -> output finite, non-empty", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 1, overlap: 0 });
    expect(result.length).toBeGreaterThan(0);
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it("overlap=0.9 (strong overlap) -> output finite, non-empty", () => {
    const buf = makeConstant(4800, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 1, overlap: 0.9 });
    expect(result.length).toBeGreaterThan(0);
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it("overlap=0.5 + stretchFactor=1 -> COLA-near constant amplitude interior", () => {
    const buf = makeConstant(4800, 1.0);
    const result = applyTimeStretch(buf, {
      stretchFactor: 1,
      overlap: 0.5,
      grainSizeMs: 10,
    });
    const out = result.getChannelData(0);
    const mid = Math.floor(out.length / 2);
    expect(out[mid]).toBeGreaterThan(0.5);
  });
});

// Grain-size edge: input shorter than grain ---------------------------------

describe("v3.219 applyTimeStretch -- input shorter than grain", () => {
  it("inputLength < grainSamples -> grain clamped, output produced", () => {
    const buf = makeConstant(100, 0.6);
    const result = applyTimeStretch(buf, { stretchFactor: 2, grainSizeMs: 50 });
    expect(result.length).toBeGreaterThan(0);
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it("length=1 input -> small output produced, finite", () => {
    const buf = makeConstant(1, 0.5);
    const result = applyTimeStretch(buf, { stretchFactor: 2 });
    expect(result.length).toBeGreaterThan(0);
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});

// Silence in -> silence out -------------------------------------------------

describe("v3.219 applyTimeStretch -- silence preservation", () => {
  it("silence input -> silence output (all zero)", () => {
    const buf = makeConstant(4800, 0);
    const result = applyTimeStretch(buf, { stretchFactor: 2 });
    const out = result.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(0);
    }
  });
});

// makeMono helper smoke (silence unused-import lint via use) ----------------

describe("v3.219 makeMono helper smoke", () => {
  it("explicit mono construction round-trips", () => {
    const buf = makeMono([0.1, 0.2, 0.3]);
    expect(buf.length).toBe(3);
    expect(buf.numberOfChannels).toBe(1);
    expect(buf.getChannelData(0)[1]).toBeCloseTo(0.2, 6);
  });
});
