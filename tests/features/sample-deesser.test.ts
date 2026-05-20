// @vitest-environment node
/**
 * sample-deesser.test.ts - v3.227.0
 *
 * Pure-Coverage fuer applyDeesser:
 *   - empty / null buffer
 *   - threshold=1 -> identity (tanh-bound on sib guarantees env <= 1)
 *   - threshold=0 -> max compression on any non-zero sibilant
 *   - ratio=1 -> identity (transparent)
 *   - length / sampleRate / channel preservation
 *   - immutability (input untouched, output Float32Array fresh)
 *   - defensive sanitizers (NaN / Infinity / out-of-range)
 *   - presets shape + content
 */

import { describe, it, expect } from "vitest";
import {
  applyDeesser,
  DEESSER_PRESETS,
  DEFAULT_FREQ_HZ,
  DEFAULT_THRESHOLD,
  DEFAULT_RATIO,
} from "../../client/src/utils/sampleDeesser";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ---------- Test Helpers ----------------------------------------------------

function makeBuffer(values: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(values);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: values.length,
    getChannelData: () => data,
  };
}

function makeMultiChannelBuffer(
  channelArrays: number[][],
  sampleRate = 48000,
): AudioBufferLike {
  const arrays = channelArrays.map((vals) => new Float32Array(vals));
  return {
    sampleRate,
    numberOfChannels: arrays.length,
    length: arrays[0]?.length ?? 0,
    getChannelData: (c: number) => arrays[c],
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

function makeSine(
  freq: number,
  length: number,
  sampleRate = 48000,
  amplitude = 1,
): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function rms(arr: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / arr.length);
}

function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}

// ---------- Tests -----------------------------------------------------------

describe("v3.227 applyDeesser - basics", () => {
  it("empty buffer -> empty buffer with fallback sampleRate=48000", () => {
    const empty = makeEmptyBuffer();
    const out = applyDeesser(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("empty buffer preserves its own sampleRate", () => {
    const empty = makeEmptyBuffer(44100);
    const out = applyDeesser(empty);
    expect(out.sampleRate).toBe(44100);
    expect(out.numberOfChannels).toBe(0);
    expect(out.length).toBe(0);
  });

  it("null buffer cast -> empty fallback", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = applyDeesser(null as any);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("length / numberOfChannels / sampleRate preserved", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 44100);
    const out = applyDeesser(buf);
    expect(out.length).toBe(6);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(44100);
  });
});

describe("v3.227 applyDeesser - transparency cases", () => {
  it("ratio=1 -> output exactly equals input (slope=0 -> gainRed===1)", () => {
    const src = [0.1, -0.2, 0.5, -0.5, 0.9, -0.9, 0.3, 0.0];
    const buf = makeBuffer(src);
    const out = applyDeesser(buf, { ratio: 1, threshold: 0, freqHz: 6000 });
    const d = out.getChannelData(0);
    // Float32-Praezision: ~7-8 Dezimalstellen reichen fuer sample-exact identity.
    for (let i = 0; i < src.length; i++) {
      expect(d[i]).toBeCloseTo(src[i], 5);
    }
  });

  it("threshold=1 -> no compression (env <= 1 dank tanh, strict > triggert nicht)", () => {
    // Use a loud sine at sibilance freq to make sure env approaches 1.
    const buf = makeSine(6000, 4096, 48000, 1.0);
    const out = applyDeesser(buf, { freqHz: 6000, threshold: 1, ratio: 8 });
    const dIn = buf.getChannelData(0);
    const dOut = out.getChannelData(0);
    for (let i = 0; i < dIn.length; i++) {
      expect(dOut[i]).toBeCloseTo(dIn[i], 6);
    }
  });

  it("zero-input -> zero-output", () => {
    const buf = makeBuffer(new Array(512).fill(0));
    const out = applyDeesser(buf, { freqHz: 6000, threshold: 0.1, ratio: 4 });
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBe(0);
  });
});

describe("v3.227 applyDeesser - compression behaviour", () => {
  it("threshold=0 -> output differs from input on HF-rich content", () => {
    const buf = makeSine(6000, 2048, 48000, 0.9);
    const out = applyDeesser(buf, { freqHz: 6000, threshold: 0, ratio: 8 });
    const dIn = buf.getChannelData(0);
    const dOut = out.getChannelData(0);
    let absDiff = 0;
    // Skip the first few samples to let the HP/envelope warm up.
    for (let i = 64; i < dIn.length; i++) absDiff += Math.abs(dIn[i] - dOut[i]);
    expect(absDiff).toBeGreaterThan(0.1);
  });

  it("loud sibilant -> RMS reduced vs ratio=1 baseline", () => {
    const buf = makeSine(6000, 4096, 48000, 0.95);
    const transparent = applyDeesser(buf, { freqHz: 6000, threshold: 0.1, ratio: 1 });
    const compressed = applyDeesser(buf, { freqHz: 6000, threshold: 0.1, ratio: 12 });
    const rTrans = rms(transparent.getChannelData(0).subarray(2048));
    const rComp = rms(compressed.getChannelData(0).subarray(2048));
    expect(rComp).toBeLessThan(rTrans);
  });

  it("higher ratio -> more reduction (lower out RMS)", () => {
    const buf = makeSine(6000, 4096, 48000, 0.95);
    const r2 = applyDeesser(buf, { freqHz: 6000, threshold: 0.1, ratio: 2 });
    const r10 = applyDeesser(buf, { freqHz: 6000, threshold: 0.1, ratio: 10 });
    const rms2 = rms(r2.getChannelData(0).subarray(2048));
    const rms10 = rms(r10.getChannelData(0).subarray(2048));
    expect(rms10).toBeLessThan(rms2);
  });

  it("output is finite for realistic mixed input", () => {
    const length = 4096;
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      // Mix of low (200 Hz) + sibilant (6 kHz) content.
      data[i] =
        0.6 * Math.sin((2 * Math.PI * 200 * i) / 48000) +
        0.4 * Math.sin((2 * Math.PI * 6000 * i) / 48000);
    }
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length,
      getChannelData: () => data,
    };
    const out = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 6 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("v3.227 applyDeesser - multi-channel", () => {
  it("stereo input -> stereo output, channels processed independently", () => {
    const length = 2048;
    const ch0: number[] = [];
    const ch1: number[] = [];
    for (let i = 0; i < length; i++) {
      ch0.push(0.9 * Math.sin((2 * Math.PI * 6000 * i) / 48000));
      ch1.push(0); // silence on right
    }
    const buf = makeMultiChannelBuffer([ch0, ch1]);
    const out = applyDeesser(buf, { freqHz: 6000, threshold: 0.1, ratio: 6 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(length);
    // Right channel was silent in -> silent out (no cross-channel leak).
    const r = out.getChannelData(1);
    for (let i = 0; i < r.length; i++) expect(r[i]).toBe(0);
    // Left channel content was processed (not zero, not raw input).
    const l = out.getChannelData(0);
    expect(rms(l.subarray(1024))).toBeGreaterThan(0);
  });

  it("out-of-range channel access throws RangeError", () => {
    const buf = makeMultiChannelBuffer([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const out = applyDeesser(buf);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });
});

describe("v3.227 applyDeesser - immutability", () => {
  it("input buffer is not mutated", () => {
    const original = [0.1, 0.2, 0.3, -0.4, 0.5, -0.6, 0.7];
    const data = new Float32Array(original);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    for (let i = 0; i < original.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 5);
    }
  });

  it("output Float32Array is not aliased with input", () => {
    const data = new Float32Array([0.1, 0.2, 0.3]);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    const out = applyDeesser(buf);
    const d = out.getChannelData(0);
    // Mutate output and verify input is untouched.
    d[0] = 999;
    expect(data[0]).toBeCloseTo(0.1, 5);
  });
});

describe("v3.227 applyDeesser - sampleRate edge cases", () => {
  it("handles sampleRate 8000 Hz", () => {
    const buf = makeSine(3000, 1024, 8000, 0.9);
    const out = applyDeesser(buf, { freqHz: 3000, threshold: 0.2, ratio: 4 });
    expect(out.length).toBe(1024);
    expect(out.sampleRate).toBe(8000);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("handles sampleRate 44100 Hz", () => {
    const buf = makeSine(6000, 2048, 44100, 0.9);
    const out = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    expect(out.length).toBe(2048);
    expect(out.sampleRate).toBe(44100);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("handles sampleRate 96000 Hz", () => {
    const buf = makeSine(6000, 4096, 96000, 0.9);
    const out = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    expect(out.length).toBe(4096);
    expect(out.sampleRate).toBe(96000);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("v3.227 applyDeesser - defensive sanitizers", () => {
  it("default constants are exported with expected values", () => {
    expect(DEFAULT_FREQ_HZ).toBe(6000);
    expect(DEFAULT_THRESHOLD).toBe(0.3);
    expect(DEFAULT_RATIO).toBe(4);
  });

  it("NaN freqHz -> default 6000", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: NaN, threshold: 0.2, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("freqHz <500 -> default 6000", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 100, threshold: 0.2, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("freqHz >20000 -> clamp 20000", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 99999, threshold: 0.2, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 20000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("freqHz +Infinity -> clamp 20000", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: Infinity, threshold: 0.2, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 20000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("freqHz -Infinity -> default 6000 (via <500 fallback)", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: -Infinity, threshold: 0.2, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("freqHz undefined -> default 6000", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { threshold: 0.2, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("threshold NaN -> default 0.3", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 6000, threshold: NaN, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.3, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("threshold <0 -> clamp 0", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 6000, threshold: -5, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("threshold >1 -> clamp 1", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 6000, threshold: 99, ratio: 4 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 1, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("ratio NaN -> default 4", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: NaN });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("ratio <1 -> default 4 (NOT identity)", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 0.5 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("ratio >50 -> clamp 50", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 999 });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 50 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("ratio +Infinity -> clamp 50", () => {
    const buf = makeSine(6000, 1024, 48000, 0.5);
    const a = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: Infinity });
    const b = applyDeesser(buf, { freqHz: 6000, threshold: 0.2, ratio: 50 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 6);
  });

  it("all-extreme options -> finite output", () => {
    const buf = makeSine(6000, 2048, 48000, 0.95);
    const out = applyDeesser(buf, {
      freqHz: 99999,
      threshold: 99,
      ratio: 999,
    });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("undefined opts uses all defaults and produces finite output", () => {
    const buf = makeSine(6000, 2048, 48000, 0.9);
    const out = applyDeesser(buf);
    expect(out.length).toBe(2048);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("v3.227 DEESSER_PRESETS", () => {
  it("has the four documented presets with expected values", () => {
    expect(DEESSER_PRESETS.light).toEqual({ freqHz: 7000, threshold: 0.5, ratio: 2 });
    expect(DEESSER_PRESETS.medium).toEqual({ freqHz: 6000, threshold: 0.3, ratio: 4 });
    expect(DEESSER_PRESETS.heavy).toEqual({ freqHz: 5000, threshold: 0.2, ratio: 8 });
    expect(DEESSER_PRESETS.surgical).toEqual({
      freqHz: 6500,
      threshold: 0.4,
      ratio: 12,
    });
  });

  it("all preset values are within musical ranges", () => {
    for (const key of ["light", "medium", "heavy", "surgical"] as const) {
      const p = DEESSER_PRESETS[key];
      expect(p.freqHz).toBeGreaterThanOrEqual(3000);
      expect(p.freqHz).toBeLessThanOrEqual(12000);
      expect(p.threshold).toBeGreaterThanOrEqual(0);
      expect(p.threshold).toBeLessThanOrEqual(1);
      expect(p.ratio).toBeGreaterThanOrEqual(1);
      expect(p.ratio).toBeLessThanOrEqual(20);
    }
  });

  it("applying each preset produces finite output", () => {
    const buf = makeSine(6000, 2048, 48000, 0.9);
    for (const key of ["light", "medium", "heavy", "surgical"] as const) {
      const out = applyDeesser(buf, DEESSER_PRESETS[key]);
      expect(out.length).toBe(2048);
      expect(allFinite(out.getChannelData(0))).toBe(true);
    }
  });

  it("heavier preset (heavy) reduces RMS more than light", () => {
    // High-freq sine well above all preset HP cutoffs so the HP passes content
    // and the difference in ratio/threshold dominates.
    const buf = makeSine(10000, 4096, 48000, 0.95);
    const light = applyDeesser(buf, DEESSER_PRESETS.light);
    const heavy = applyDeesser(buf, DEESSER_PRESETS.heavy);
    const rmsLight = rms(light.getChannelData(0).subarray(2048));
    const rmsHeavy = rms(heavy.getChannelData(0).subarray(2048));
    expect(rmsHeavy).toBeLessThan(rmsLight);
  });
});