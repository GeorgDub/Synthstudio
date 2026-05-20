// @vitest-environment node
/**
 * sample-sample-rate-reduce.test.ts -- v3.204.0
 *
 * Tests fuer applySampleRateReduce (Sample-and-Hold + optional Bit-Depth-Quantize).
 * Pure-Helper, DOM-frei, operiert auf AudioBufferLike.
 */

import { describe, it, expect } from "vitest";
import {
  applySampleRateReduce,
  SR_REDUCE_PRESETS,
  DEFAULT_REDUCTION_FACTOR,
  MAX_REDUCTION_FACTOR,
  MIN_BIT_DEPTH,
  MAX_BIT_DEPTH,
} from "../../client/src/utils/sampleSampleRateReduce";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeMono(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => data,
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

function makeEmpty(sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

describe("v3.204 applySampleRateReduce identity", () => {
  it("reductionFactor=1, no bitDepth means bit-exact copy", () => {
    const src = [0.1, -0.2, 0.3, -0.4, 0.5];
    const buf = makeMono(src);
    const out = applySampleRateReduce(buf, { reductionFactor: 1 });
    const data = out.getChannelData(0);
    for (let i = 0; i < src.length; i++) {
      expect(data[i]).toBeCloseTo(src[i], 6);
    }
  });

  it("opts undefined means identity", () => {
    const src = [0.1, -0.2, 0.3];
    const buf = makeMono(src);
    const out = applySampleRateReduce(buf);
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(0.1, 6);
    expect(data[1]).toBeCloseTo(-0.2, 6);
    expect(data[2]).toBeCloseTo(0.3, 6);
  });

  it("AudioBufferLike conformance: length, numberOfChannels, sampleRate erhalten", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4], 44100);
    const out = applySampleRateReduce(buf, { reductionFactor: 2 });
    expect(out.length).toBe(4);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(44100);
    expect(typeof out.getChannelData).toBe("function");
  });
});

describe("v3.204 applySampleRateReduce empty / null", () => {
  it("empty mono buffer means empty result", () => {
    const empty = makeMono([]);
    const out = applySampleRateReduce(empty, { reductionFactor: 4 });
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty-channel buffer (numberOfChannels=0) means empty result", () => {
    const empty = makeEmpty(48000);
    const out = applySampleRateReduce(empty, { reductionFactor: 2, bitDepth: 8 });
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });
});

describe("v3.204 applySampleRateReduce Sample-and-Hold", () => {
  it("alternating [1,0,1,0,1,0] factor=2 first-of-pair held as [1,1,1,1,1,1]", () => {
    const buf = makeMono([1, 0, 1, 0, 1, 0]);
    const out = applySampleRateReduce(buf, { reductionFactor: 2 });
    const data = out.getChannelData(0);
    expect(Array.from(data)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("factor=4 means only every 4th sample becomes the hold source", () => {
    const buf = makeMono([0.5, 0.1, 0.2, 0.3, -0.7, 0.9, 0.4, 0.6]);
    const out = applySampleRateReduce(buf, { reductionFactor: 4 });
    const data = Array.from(out.getChannelData(0));
    expect(data[0]).toBeCloseTo(0.5, 6);
    expect(data[1]).toBeCloseTo(0.5, 6);
    expect(data[2]).toBeCloseTo(0.5, 6);
    expect(data[3]).toBeCloseTo(0.5, 6);
    expect(data[4]).toBeCloseTo(-0.7, 6);
    expect(data[5]).toBeCloseTo(-0.7, 6);
    expect(data[6]).toBeCloseTo(-0.7, 6);
    expect(data[7]).toBeCloseTo(-0.7, 6);
  });

  it("factor=8 over 4-sample buffer means only src[0] is held", () => {
    const buf = makeMono([0.25, 0.5, 0.75, 1.0]);
    const out = applySampleRateReduce(buf, { reductionFactor: 8 });
    const data = Array.from(out.getChannelData(0));
    expect(data).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});

describe("v3.204 applySampleRateReduce bitDepth quantization", () => {
  it("bitDepth=2 with 4 levels rounds 0.0001 to 0", () => {
    const buf = makeMono([0.0001]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 2 });
    const v = out.getChannelData(0)[0];
    expect(v).toBe(0);
  });

  it("bitDepth=2 + value=0.4 means round(0.4*2)/2 = 0.5", () => {
    const buf = makeMono([0.4]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 2 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.5, 6);
  });

  it("bitDepth=2 quantize-Lattice maps values to 0.5 steps", () => {
    const buf = makeMono([-0.1, 0.1, 0.3, 0.4, -0.6]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 2 });
    const data = Array.from(out.getChannelData(0));
    expect(data[0]).toBeCloseTo(0, 6);
    expect(data[1]).toBeCloseTo(0, 6);
    expect(data[2]).toBeCloseTo(0.5, 6);
    expect(data[3]).toBeCloseTo(0.5, 6);
    expect(data[4]).toBeCloseTo(-0.5, 6);
  });

  it("bitDepth=8 with 256 levels is near-identity for small values", () => {
    const buf = makeMono([0.5, -0.5, 0.25]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 8 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(0.5, 6);
    expect(data[1]).toBeCloseTo(-0.5, 6);
    expect(data[2]).toBeCloseTo(0.25, 6);
  });
});

describe("v3.204 applySampleRateReduce defensive sanitizers", () => {
  it("reductionFactor NaN means 1 (identity)", () => {
    const buf = makeMono([0.1, -0.2, 0.3]);
    const out = applySampleRateReduce(buf, { reductionFactor: NaN });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(0.1, 6);
    expect(data[1]).toBeCloseTo(-0.2, 6);
    expect(data[2]).toBeCloseTo(0.3, 6);
  });

  it("reductionFactor < 1 means clamp to 1 (identity)", () => {
    const buf = makeMono([1, 0, 1, 0]);
    const out = applySampleRateReduce(buf, { reductionFactor: 0 });
    const data = Array.from(out.getChannelData(0));
    expect(data).toEqual([1, 0, 1, 0]);
  });

  it("reductionFactor negative means 1 (identity)", () => {
    const buf = makeMono([1, 0, 1, 0]);
    const out = applySampleRateReduce(buf, { reductionFactor: -5 });
    expect(Array.from(out.getChannelData(0))).toEqual([1, 0, 1, 0]);
  });

  it("reductionFactor > 256 means cap to 256", () => {
    const buf = makeMono(new Array(10).fill(0).map((_, i) => i * 0.1));
    const out = applySampleRateReduce(buf, { reductionFactor: 1_000_000 });
    const data = Array.from(out.getChannelData(0));
    expect(data.every(v => v === 0)).toBe(true);
  });

  it("bitDepth < 2 means undefined (no quantize)", () => {
    const buf = makeMono([0.123456]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 1 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.123456, 6);
  });

  it("bitDepth NaN means undefined (no quantize)", () => {
    const buf = makeMono([0.333]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: NaN });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.333, 6);
  });

  it("bitDepth > 16 means cap to 16", () => {
    const buf = makeMono([0.5]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 64 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.5, 4);
  });

  it("reductionFactor non-integer 2.9 means floor to 2", () => {
    const buf = makeMono([1, 0, 1, 0, 1, 0]);
    const out = applySampleRateReduce(buf, { reductionFactor: 2.9 });
    expect(Array.from(out.getChannelData(0))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("Infinity reductionFactor means identity (non-finite path)", () => {
    const buf = makeMono([0.1, 0.2, 0.3]);
    const out = applySampleRateReduce(buf, { reductionFactor: Infinity });
    const data = Array.from(out.getChannelData(0));
    expect(data[0]).toBeCloseTo(0.1, 6);
    expect(data[1]).toBeCloseTo(0.2, 6);
    expect(data[2]).toBeCloseTo(0.3, 6);
  });
});

describe("v3.204 applySampleRateReduce multi-channel", () => {
  it("stereo channels are processed independently", () => {
    const buf = makeStereo([1, 0, 1, 0], [0, 1, 0, 1]);
    const out = applySampleRateReduce(buf, { reductionFactor: 2 });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    expect(L).toEqual([1, 1, 1, 1]);
    expect(R).toEqual([0, 0, 0, 0]);
    expect(out.numberOfChannels).toBe(2);
  });

  it("stereo independent quantize per channel", () => {
    const buf = makeStereo([0.4, 0.4], [-0.4, -0.4]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 2 });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    expect(L[0]).toBeCloseTo(0.5, 6);
    expect(R[0]).toBeCloseTo(-0.5, 6);
  });
});

describe("v3.204 applySampleRateReduce immutability", () => {
  it("input is not mutated", () => {
    const original = [0.1, -0.2, 0.3, -0.4];
    const buf = makeMono([...original]);
    const snapshot = Array.from(buf.getChannelData(0));
    applySampleRateReduce(buf, { reductionFactor: 2, bitDepth: 4 });
    const after = Array.from(buf.getChannelData(0));
    // Compare to the post-Float32 snapshot (input round-trip through Float32Array).
    expect(after).toEqual(snapshot);
  });

  it("repeated calls return deterministic values", () => {
    const buf = makeMono([0.1, 0.5, -0.3, 0.7, -0.9, 0.2]);
    const a = applySampleRateReduce(buf, { reductionFactor: 3, bitDepth: 4 });
    const b = applySampleRateReduce(buf, { reductionFactor: 3, bitDepth: 4 });
    expect(Array.from(a.getChannelData(0))).toEqual(Array.from(b.getChannelData(0)));
  });

  it("output is a fresh Float32Array (not source-aliased)", () => {
    const buf = makeMono([0.1, 0.2, 0.3]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1 });
    const data = out.getChannelData(0);
    data[0] = 99;
    expect(buf.getChannelData(0)[0]).toBeCloseTo(0.1, 6);
  });
});

describe("v3.204 applySampleRateReduce sampleRate variants", () => {
  it("sampleRate=44100 is preserved on output", () => {
    const buf = makeMono([0.1, 0.2], 44100);
    const out = applySampleRateReduce(buf, { reductionFactor: 2, bitDepth: 8 });
    expect(out.sampleRate).toBe(44100);
  });

  it("sampleRate=96000 is preserved on output", () => {
    const buf = makeMono([0.1, 0.2], 96000);
    const out = applySampleRateReduce(buf, { reductionFactor: 4 });
    expect(out.sampleRate).toBe(96000);
  });

  it("sampleRate=22050 is preserved on output", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4], 22050);
    const out = applySampleRateReduce(buf, { reductionFactor: 2 });
    expect(out.sampleRate).toBe(22050);
  });
});

describe("v3.204 SR_REDUCE_PRESETS", () => {
  it("all 4 presets are defined", () => {
    expect(SR_REDUCE_PRESETS.subtle).toBeDefined();
    expect(SR_REDUCE_PRESETS.lofi).toBeDefined();
    expect(SR_REDUCE_PRESETS.crunch).toBeDefined();
    expect(SR_REDUCE_PRESETS.destroy).toBeDefined();
  });

  it("subtle: factor=2, no bitDepth", () => {
    expect(SR_REDUCE_PRESETS.subtle.reductionFactor).toBe(2);
    expect((SR_REDUCE_PRESETS.subtle as { bitDepth?: number }).bitDepth).toBeUndefined();
  });

  it("destroy: factor=16, bitDepth=4 (most aggressive)", () => {
    expect(SR_REDUCE_PRESETS.destroy.reductionFactor).toBe(16);
    expect(SR_REDUCE_PRESETS.destroy.bitDepth).toBe(4);
  });

  it("crunch preset on real buffer yields quantized 8-level values", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
    const out = applySampleRateReduce(buf, SR_REDUCE_PRESETS.crunch);
    const data = Array.from(out.getChannelData(0));
    expect(data[0]).toBeCloseTo(13 / 128, 6);
    expect(data[7]).toBeCloseTo(13 / 128, 6);
    expect(data[8]).toBeCloseTo(Math.round(0.9 * 128) / 128, 6);
  });
});

describe("v3.204 applySampleRateReduce length preservation", () => {
  it("length input == length output (no resample)", () => {
    const buf = makeMono(new Array(123).fill(0).map(() => Math.random() * 2 - 1));
    const out = applySampleRateReduce(buf, { reductionFactor: 8, bitDepth: 6 });
    expect(out.length).toBe(123);
    expect(out.getChannelData(0).length).toBe(123);
  });

  it("length=1 buffer + factor=8 means output length=1 and dst[0]=src[0]", () => {
    const buf = makeMono([0.42]);
    const out = applySampleRateReduce(buf, { reductionFactor: 8 });
    expect(out.length).toBe(1);
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.42, 6);
  });

  it("length=0 means output length=0", () => {
    const buf = makeMono([]);
    const out = applySampleRateReduce(buf, { reductionFactor: 4, bitDepth: 8 });
    expect(out.length).toBe(0);
  });
});

describe("v3.204 applySampleRateReduce caps", () => {
  it("MAX_REDUCTION_FACTOR is 256", () => {
    expect(MAX_REDUCTION_FACTOR).toBe(256);
  });

  it("MAX_BIT_DEPTH is 16", () => {
    expect(MAX_BIT_DEPTH).toBe(16);
  });

  it("MIN_BIT_DEPTH is 2", () => {
    expect(MIN_BIT_DEPTH).toBe(2);
  });

  it("DEFAULT_REDUCTION_FACTOR is 1", () => {
    expect(DEFAULT_REDUCTION_FACTOR).toBe(1);
  });

  it("reductionFactor capped at 256 holds first sample for 256-sample stretches", () => {
    const samples = new Array(300).fill(0).map((_, i) => i * 0.001);
    const buf = makeMono(samples);
    const out = applySampleRateReduce(buf, { reductionFactor: 999_999 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(samples[0], 6);
    expect(data[1]).toBeCloseTo(samples[0], 6);
    expect(data[255]).toBeCloseTo(samples[0], 6);
    expect(data[256]).toBeCloseTo(samples[256], 5);
    expect(data[299]).toBeCloseTo(samples[256], 5);
  });

  it("bitDepth=999 cap to 16 keeps 0.5 as 0.5", () => {
    const buf = makeMono([0.5, 0.25, -0.5]);
    const out = applySampleRateReduce(buf, { reductionFactor: 1, bitDepth: 999 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(0.5, 4);
    expect(data[1]).toBeCloseTo(0.25, 4);
    expect(data[2]).toBeCloseTo(-0.5, 4);
  });
});
