// @vitest-environment node
/**
 * sample-auto-normalize.test.ts — v3.132.0
 * Tests für Auto-Normalize-Helpers + Peak-Analyze.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeSamplePeak,
  computeNormalizeGain,
  applyGainToBuffer,
  autoNormalizeSample,
  DEFAULT_NORMALIZE_TARGET_DBTP,
  MAX_NORMALIZE_BOOST_DB,
  SILENCE_THRESHOLD_DBTP,
} from "../../client/src/utils/sampleAutoNormalize";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeBuffer(samples: number[], channels = 1, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: channels,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeStereoBuffer(left: number[], right: number[]): AudioBufferLike {
  const L = new Float32Array(left);
  const R = new Float32Array(right);
  return {
    sampleRate: 48000,
    numberOfChannels: 2,
    length: Math.max(left.length, right.length),
    getChannelData: (c: number) => (c === 0 ? L : R),
  };
}

describe("v3.132 analyzeSamplePeak", () => {
  it("empty buffer → silence", () => {
    const result = analyzeSamplePeak(makeBuffer([]));
    expect(result.isSilence).toBe(true);
    expect(result.peakDbTp).toBe(-Infinity);
    expect(result.channelsAnalyzed).toBe(0);
  });

  it("DC silence → silence detected", () => {
    const result = analyzeSamplePeak(makeBuffer([0, 0, 0, 0]));
    expect(result.isSilence).toBe(true);
  });

  it("full-scale sine → peak near 0dBTP", () => {
    const samples: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples.push(Math.sin((i / 256) * 2 * Math.PI));
    }
    const result = analyzeSamplePeak(makeBuffer(samples), { oversampling: 1 });
    expect(result.peakDbTp).toBeGreaterThan(-1);
    expect(result.peakDbTp).toBeLessThanOrEqual(0.5);
    expect(result.isSilence).toBe(false);
  });

  it("half-scale sine → peak near -6dBTP", () => {
    const samples: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples.push(Math.sin((i / 256) * 2 * Math.PI) * 0.5);
    }
    const result = analyzeSamplePeak(makeBuffer(samples), { oversampling: 1 });
    expect(result.peakDbTp).toBeCloseTo(-6, 1);
  });

  it("stereo: max channel mode picks louder", () => {
    const L = [0.5, 0.5];
    const R = [0.1, 0.1];
    const result = analyzeSamplePeak(makeStereoBuffer(L, R), {
      oversampling: 1,
      channelMode: "max",
    });
    // peakDb of 0.5 = ~ -6dB
    expect(result.peakDbTp).toBeCloseTo(-6, 1);
  });

  it("stereo: left channel mode", () => {
    const L = [0.5];
    const R = [0.1];
    const result = analyzeSamplePeak(makeStereoBuffer(L, R), {
      oversampling: 1,
      channelMode: "left",
    });
    expect(result.peakDbTp).toBeCloseTo(-6, 1);
  });

  it("stereo: right channel mode", () => {
    const L = [0.5];
    const R = [0.1];
    const result = analyzeSamplePeak(makeStereoBuffer(L, R), {
      oversampling: 1,
      channelMode: "right",
    });
    expect(result.peakDbTp).toBeCloseTo(-20, 1);
  });
});

describe("v3.132 computeNormalizeGain", () => {
  it("identity wenn current == target", () => {
    expect(computeNormalizeGain(-1, -1)).toBeCloseTo(1, 5);
  });

  it("+6dB Boost wenn target=-1 und current=-7", () => {
    const g = computeNormalizeGain(-7, -1);
    // 6dB = ~2.0 linear
    expect(g).toBeCloseTo(2, 1);
  });

  it("-6dB Cut wenn target=-7 und current=-1", () => {
    const g = computeNormalizeGain(-1, -7);
    // -6dB = ~0.5 linear
    expect(g).toBeCloseTo(0.5, 1);
  });

  it("Silence (current=-Infinity) → no-op (1.0)", () => {
    expect(computeNormalizeGain(-Infinity, -1)).toBe(1.0);
  });

  it("Target NaN → no-op", () => {
    expect(computeNormalizeGain(-10, NaN)).toBe(1.0);
  });

  it("Boost-Cap MAX_NORMALIZE_BOOST_DB (+24dB)", () => {
    // current = -60, target = -1, raw = +59 → cap at +24
    const g = computeNormalizeGain(-60, -1);
    const expectedMax = Math.pow(10, MAX_NORMALIZE_BOOST_DB / 20);
    expect(g).toBeCloseTo(expectedMax, 2);
  });

  it("Cut-Floor -60dB", () => {
    // current = 0, target = -100 → raw = -100 → floor at -60
    const g = computeNormalizeGain(0, -100);
    const expectedMin = Math.pow(10, -60 / 20);
    expect(g).toBeCloseTo(expectedMin, 5);
  });

  it("Default target = DEFAULT_NORMALIZE_TARGET_DBTP", () => {
    const g1 = computeNormalizeGain(-7);
    const g2 = computeNormalizeGain(-7, DEFAULT_NORMALIZE_TARGET_DBTP);
    expect(g1).toBe(g2);
  });
});

describe("v3.132 applyGainToBuffer", () => {
  it("gain=1.0 → identische samples (neue Kopie)", () => {
    const original = makeBuffer([0.1, 0.2, 0.3]);
    const result = applyGainToBuffer(original, 1.0);
    // Float32-precision: 0.1 als f32 != 0.1 als f64. toBeCloseTo nimmt das.
    const got = Array.from(result.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.1, 5);
    expect(got[1]).toBeCloseTo(0.2, 5);
    expect(got[2]).toBeCloseTo(0.3, 5);
  });

  it("gain=2.0 → doppelt", () => {
    const result = applyGainToBuffer(makeBuffer([0.1, 0.2]), 2.0);
    expect(result.getChannelData(0)[0]).toBeCloseTo(0.2);
    expect(result.getChannelData(0)[1]).toBeCloseTo(0.4);
  });

  it("Stereo: gain pro Channel applied", () => {
    const stereo = makeStereoBuffer([0.5], [0.25]);
    const result = applyGainToBuffer(stereo, 2.0);
    expect(result.numberOfChannels).toBe(2);
    expect(result.getChannelData(0)[0]).toBeCloseTo(1.0);
    expect(result.getChannelData(1)[0]).toBeCloseTo(0.5);
  });

  it("Empty buffer → empty result", () => {
    const result = applyGainToBuffer(makeBuffer([]), 2.0);
    expect(result.length).toBe(0);
    expect(result.numberOfChannels).toBe(0);
  });

  it("Original Buffer unverändert (immutable)", () => {
    const original = makeBuffer([0.1, 0.2]);
    const origRef = original.getChannelData(0);
    const before = origRef[0]; // Float32-precision snapshot
    applyGainToBuffer(original, 2.0);
    expect(origRef[0]).toBe(before); // unchanged
  });

  it("NaN gain → fallback gain=1", () => {
    const result = applyGainToBuffer(makeBuffer([0.5]), NaN);
    expect(result.getChannelData(0)[0]).toBe(0.5);
  });
});

describe("v3.132 autoNormalizeSample", () => {
  it("Silence → unverändert, gain=1", () => {
    const silence = makeBuffer([0, 0, 0]);
    const result = autoNormalizeSample(silence);
    expect(result.gainApplied).toBe(1.0);
    expect(result.gainAppliedDb).toBe(0);
    expect(result.originalAnalysis.isSilence).toBe(true);
  });

  it("Half-scale Sine → boosted zu target", () => {
    const samples: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples.push(Math.sin((i / 256) * 2 * Math.PI) * 0.5);
    }
    const result = autoNormalizeSample(makeBuffer(samples), {
      oversampling: 1,
      targetDbTp: -1,
    });
    // Current ~ -6dB, target -1 → boost +5dB ≈ 1.78x
    expect(result.gainAppliedDb).toBeCloseTo(5, 0.5);
    // After applying gain, peak should be ~target
    const newPeak = Math.max(...Array.from(result.buffer.getChannelData(0)).map(Math.abs));
    expect(20 * Math.log10(newPeak)).toBeCloseTo(-1, 0.5);
  });

  it("Standard-Workflow: full-scale sine bleibt nahe 0dBTP", () => {
    const samples: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples.push(Math.sin((i / 256) * 2 * Math.PI));
    }
    const result = autoNormalizeSample(makeBuffer(samples), {
      oversampling: 1,
    });
    // current ~0dB, target -1 → small cut
    expect(result.gainAppliedDb).toBeLessThanOrEqual(0);
    expect(result.gainAppliedDb).toBeGreaterThan(-2);
  });
});

describe("v3.132 Constants", () => {
  it("DEFAULT_NORMALIZE_TARGET_DBTP = -1.0 (Streaming-Standard)", () => {
    expect(DEFAULT_NORMALIZE_TARGET_DBTP).toBe(-1.0);
  });

  it("MAX_NORMALIZE_BOOST_DB = 24", () => {
    expect(MAX_NORMALIZE_BOOST_DB).toBe(24);
  });

  it("SILENCE_THRESHOLD_DBTP = -90", () => {
    expect(SILENCE_THRESHOLD_DBTP).toBe(-90);
  });
});
