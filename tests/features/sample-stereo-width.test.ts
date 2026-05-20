// @vitest-environment node
/**
 * sample-stereo-width.test.ts v3.184.0
 * Pure-Coverage fuer sampleStereoWidth (M/S-Decomposition, Width-Analyse).
 */

import { describe, it, expect } from "vitest";
import {
  analyzeStereoWidth,
  categorizeWidth,
} from "../../client/src/utils/sampleStereoWidth";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// --- Test Helpers ------------------------------------------------------------

function makeStereoBuffer(left: number[], right: number[], sampleRate = 48000): AudioBufferLike {
  const len = Math.min(left.length, right.length);
  const l = new Float32Array(left.slice(0, len));
  const r = new Float32Array(right.slice(0, len));
  return {
    sampleRate,
    numberOfChannels: 2,
    length: len,
    getChannelData: (c: number) => (c === 0 ? l : r),
  };
}

function makeMonoBuffer(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeEmptyBuffer(): AudioBufferLike {
  const data = new Float32Array(0);
  return {
    sampleRate: 48000,
    numberOfChannels: 2,
    length: 0,
    getChannelData: () => data,
  };
}

function makeMultiChannelBuffer(channels: number[][], sampleRate = 48000): AudioBufferLike {
  const len = Math.min(...channels.map((c) => c.length));
  const arrs = channels.map((c) => new Float32Array(c.slice(0, len)));
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: len,
    getChannelData: (c: number) => arrs[c] ?? new Float32Array(len),
  };
}

function sineSamples(freq: number, amp: number, durationSec: number, sampleRate = 48000): number[] {
  const length = Math.floor(durationSec * sampleRate);
  const out: number[] = new Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function pseudoRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

// --- analyzeStereoWidth ------------------------------------------------------

describe("analyzeStereoWidth - basic cases", () => {
  it("mono buffer (1 channel) -> widthRatio 0, width mono, monoCompat 1", () => {
    const buf = makeMonoBuffer([0.1, -0.2, 0.3, -0.4, 0.5]);
    const res = analyzeStereoWidth(buf);
    expect(res.widthRatio).toBe(0);
    expect(res.sideRms).toBe(0);
    expect(res.monoCompat).toBe(1);
    expect(res.width).toBe("mono");
    expect(res.midRms).toBeGreaterThan(0);
  });

  it("duplicated stereo (L = R) -> widthRatio 0, width mono", () => {
    const sig = sineSamples(440, 0.5, 0.05);
    const buf = makeStereoBuffer(sig, sig);
    const res = analyzeStereoWidth(buf);
    expect(res.widthRatio).toBe(0);
    expect(res.sideRms).toBeCloseTo(0, 8);
    expect(res.monoCompat).toBeCloseTo(1, 6);
    expect(res.width).toBe("mono");
  });

  it("opposite stereo (L = -R) -> widthRatio at max clamp, width extreme", () => {
    const sig = sineSamples(440, 0.5, 0.05);
    const inv = sig.map((v) => -v);
    const buf = makeStereoBuffer(sig, inv);
    const res = analyzeStereoWidth(buf);
    expect(res.midRms).toBeCloseTo(0, 6);
    expect(res.sideRms).toBeGreaterThan(0);
    expect(res.widthRatio).toBe(10);
    expect(res.monoCompat).toBeCloseTo(0, 6);
    expect(res.width).toBe("extreme");
  });

  it("balanced uncorrelated stereo -> widthRatio near 1.0", () => {
    const rnd1 = pseudoRandom(42);
    const rnd2 = pseudoRandom(99);
    const len = 8192;
    const l: number[] = new Array(len);
    const r: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      l[i] = rnd1();
      r[i] = rnd2();
    }
    const buf = makeStereoBuffer(l, r);
    const res = analyzeStereoWidth(buf);
    expect(res.widthRatio).toBeGreaterThan(0.85);
    expect(res.widthRatio).toBeLessThan(1.15);
    expect(res.midRms).toBeGreaterThan(0);
    expect(res.sideRms).toBeGreaterThan(0);
  });
});

describe("analyzeStereoWidth - monoCompat", () => {
  it("monoCompat is 1 for pure mono (L = R)", () => {
    const sig = sineSamples(220, 0.7, 0.05);
    const buf = makeStereoBuffer(sig, sig);
    const res = analyzeStereoWidth(buf);
    expect(res.monoCompat).toBeCloseTo(1, 6);
  });

  it("monoCompat is 0 for pure side (L = -R)", () => {
    const sig = sineSamples(220, 0.7, 0.05);
    const inv = sig.map((v) => -v);
    const buf = makeStereoBuffer(sig, inv);
    const res = analyzeStereoWidth(buf);
    expect(res.monoCompat).toBeCloseTo(0, 6);
  });

  it("monoCompat is around 0.5 when midRms == sideRms", () => {
    const len = 4096;
    const rnd = pseudoRandom(7);
    const l: number[] = new Array(len);
    const r: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const v = rnd();
      l[i] = v;
      r[i] = i % 2 === 0 ? v : -v;
    }
    const buf = makeStereoBuffer(l, r);
    const res = analyzeStereoWidth(buf);
    expect(res.monoCompat).toBeGreaterThan(0.45);
    expect(res.monoCompat).toBeLessThan(0.55);
  });
});

describe("analyzeStereoWidth - edge cases", () => {
  it("empty buffer -> default mono result", () => {
    const buf = makeEmptyBuffer();
    const res = analyzeStereoWidth(buf);
    expect(res.widthRatio).toBe(0);
    expect(res.midRms).toBe(0);
    expect(res.sideRms).toBe(0);
    expect(res.monoCompat).toBe(1);
    expect(res.width).toBe("mono");
  });

  it("null buffer -> default mono result", () => {
    const res = analyzeStereoWidth(null);
    expect(res.widthRatio).toBe(0);
    expect(res.midRms).toBe(0);
    expect(res.sideRms).toBe(0);
    expect(res.monoCompat).toBe(1);
    expect(res.width).toBe("mono");
  });

  it("undefined buffer -> default mono result", () => {
    const res = analyzeStereoWidth(undefined);
    expect(res.width).toBe("mono");
    expect(res.monoCompat).toBe(1);
  });

  it("silent stereo (both channels 0) -> ratio 0, monoCompat 1", () => {
    const zeros = new Array(2048).fill(0);
    const buf = makeStereoBuffer(zeros, zeros);
    const res = analyzeStereoWidth(buf);
    expect(res.widthRatio).toBe(0);
    expect(res.midRms).toBe(0);
    expect(res.sideRms).toBe(0);
    expect(res.monoCompat).toBe(1);
    expect(res.width).toBe("mono");
  });

  it(">2 channels -> only first two are used", () => {
    const sig = sineSamples(330, 0.4, 0.05);
    const chaos = sig.map((v, i) => (i % 2 === 0 ? 1 : -1) * v);
    const buf = makeMultiChannelBuffer([sig, sig, chaos, chaos]);
    const res = analyzeStereoWidth(buf);
    expect(res.widthRatio).toBe(0);
    expect(res.width).toBe("mono");
  });

  it("known mid amplitude: L = R = constant 0.5 -> midRms = 0.5, sideRms = 0", () => {
    const len = 1000;
    const l = new Array(len).fill(0.5);
    const r = new Array(len).fill(0.5);
    const buf = makeStereoBuffer(l, r);
    const res = analyzeStereoWidth(buf);
    expect(res.midRms).toBeCloseTo(0.5, 8);
    expect(res.sideRms).toBeCloseTo(0, 8);
    expect(res.widthRatio).toBe(0);
  });

  it("sine RMS: L=R=sin(amp=1) -> midRms approx 1/sqrt(2)", () => {
    const sig = sineSamples(1000, 1.0, 0.5, 48000);
    const buf = makeStereoBuffer(sig, sig);
    const res = analyzeStereoWidth(buf);
    expect(res.midRms).toBeCloseTo(Math.SQRT1_2, 2);
    expect(res.sideRms).toBeCloseTo(0, 6);
  });
});

// --- categorizeWidth ---------------------------------------------------------

describe("categorizeWidth", () => {
  it("0 -> mono", () => {
    expect(categorizeWidth(0)).toBe("mono");
  });

  it("0.04 -> mono", () => {
    expect(categorizeWidth(0.04)).toBe("mono");
  });

  it("0.1 -> narrow", () => {
    expect(categorizeWidth(0.1)).toBe("narrow");
  });

  it("0.5 -> balanced", () => {
    expect(categorizeWidth(0.5)).toBe("balanced");
  });

  it("1.0 -> wide", () => {
    expect(categorizeWidth(1.0)).toBe("wide");
  });

  it("2.0 -> extreme", () => {
    expect(categorizeWidth(2.0)).toBe("extreme");
  });

  it("threshold 0.35 lower edge -> balanced", () => {
    expect(categorizeWidth(0.35)).toBe("balanced");
  });

  it("threshold 0.75 lower edge -> wide", () => {
    expect(categorizeWidth(0.75)).toBe("wide");
  });

  it("threshold 1.5 lower edge -> extreme", () => {
    expect(categorizeWidth(1.5)).toBe("extreme");
  });

  it("NaN ratio -> mono", () => {
    expect(categorizeWidth(NaN)).toBe("mono");
  });

  it("+Infinity ratio -> mono (defensive)", () => {
    expect(categorizeWidth(Number.POSITIVE_INFINITY)).toBe("mono");
  });
});

// --- Integration sanity ------------------------------------------------------

describe("analyzeStereoWidth + categorizeWidth consistency", () => {
  it("returned width always matches categorizeWidth(widthRatio)", () => {
    const sig = sineSamples(440, 0.5, 0.05);
    const noise = pseudoRandom(123);
    const cases: AudioBufferLike[] = [
      makeStereoBuffer(sig, sig),
      makeStereoBuffer(sig, sig.map((v) => v * 0.5)),
      (() => {
        const l = sig.map(() => noise());
        const r = sig.map(() => noise());
        return makeStereoBuffer(l, r);
      })(),
      makeStereoBuffer(sig, sig.map((v) => -v)),
    ];

    for (const buf of cases) {
      const res = analyzeStereoWidth(buf);
      expect(res.width).toBe(categorizeWidth(res.widthRatio));
    }
  });
});
