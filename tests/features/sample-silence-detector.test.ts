// @vitest-environment node
/**
 * sample-silence-detector.test.ts v3.179.0
 * Pure-Coverage fuer sampleSilenceDetector.
 */

import { describe, it, expect } from "vitest";
import {
  detectSilenceRegions,
  totalSilenceSec,
  longestSilenceRegion,
  DEFAULT_THRESHOLD,
  DEFAULT_MIN_REGION_SAMPLES,
} from "../../client/src/utils/sampleSilenceDetector";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// Test-Helpers

function makeEmptyBuffer(): AudioBufferLike {
  const data = new Float32Array(0);
  return {
    sampleRate: 48000,
    numberOfChannels: 1,
    length: 0,
    getChannelData: () => data,
  };
}

function makeSilentBuffer(length: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(length);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeLoudBuffer(
  length: number,
  amp = 0.5,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  data.fill(amp);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeMiddleSilenceBuffer(
  length: number,
  silenceStart: number,
  silenceEnd: number,
  loudAmp = 0.5,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i >= silenceStart && i < silenceEnd) {
      data[i] = 0;
    } else {
      data[i] = loudAmp;
    }
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeMultiSilenceBuffer(
  length: number,
  regions: ReadonlyArray<readonly [number, number]>,
  loudAmp = 0.5,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  data.fill(loudAmp);
  for (const [s, e] of regions) {
    for (let i = s; i < e; i++) {
      data[i] = 0;
    }
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

// detectSilenceRegions

describe("detectSilenceRegions", () => {
  it("1) empty buffer -> []", () => {
    const result = detectSilenceRegions(makeEmptyBuffer());
    expect(result).toEqual([]);
  });

  it("2) all-silence -> 1 region covering whole buffer", () => {
    const length = 12000;
    const result = detectSilenceRegions(makeSilentBuffer(length));
    expect(result).toHaveLength(1);
    const r = result[0];
    expect(r.startSample).toBe(0);
    expect(r.endSample).toBe(length);
    expect(r.durationSamples).toBe(length);
    expect(r.startSec).toBe(0);
    expect(r.endSec).toBeCloseTo(length / 48000, 6);
  });

  it("3) all-loud -> []", () => {
    const length = 12000;
    const result = detectSilenceRegions(makeLoudBuffer(length, 0.5));
    expect(result).toEqual([]);
  });

  it("4) middle-silence (loud-quiet-loud) -> 1 region in middle", () => {
    const length = 24000;
    const buffer = makeMiddleSilenceBuffer(length, 8000, 16000, 0.5);
    const result = detectSilenceRegions(buffer);
    expect(result).toHaveLength(1);
    expect(result[0].startSample).toBe(8000);
    expect(result[0].endSample).toBe(16000);
    expect(result[0].durationSamples).toBe(8000);
  });

  it("5) silence-too-short (unter minRegionSamples) -> []", () => {
    const length = 12000;
    const buffer = makeMiddleSilenceBuffer(length, 4000, 5000, 0.5);
    const result = detectSilenceRegions(buffer);
    expect(result).toEqual([]);
  });

  it("6) multiple silence regions -> all detected", () => {
    const length = 30000;
    const buffer = makeMultiSilenceBuffer(length, [
      [2000, 8000],
      [12000, 18000],
      [22000, 28000],
    ]);
    const result = detectSilenceRegions(buffer);
    expect(result).toHaveLength(3);
    expect(result[0].startSample).toBe(2000);
    expect(result[0].endSample).toBe(8000);
    expect(result[1].startSample).toBe(12000);
    expect(result[1].endSample).toBe(18000);
    expect(result[2].startSample).toBe(22000);
    expect(result[2].endSample).toBe(28000);
  });

  it("trailing silence (loud-then-silence to end) is flushed", () => {
    const length = 14000;
    const buffer = makeMiddleSilenceBuffer(length, 4000, length, 0.5);
    const result = detectSilenceRegions(buffer);
    expect(result).toHaveLength(1);
    expect(result[0].startSample).toBe(4000);
    expect(result[0].endSample).toBe(length);
  });

  it("custom threshold above 0 detects low-amp signal as silent", () => {
    const length = 12000;
    const buffer = makeLoudBuffer(length, 0.001);
    const result = detectSilenceRegions(buffer);
    expect(result).toHaveLength(1);
    expect(result[0].startSample).toBe(0);
    expect(result[0].endSample).toBe(length);
  });

  it("stereo downmix: opposite signals cancel to silence", () => {
    const length = 12000;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    left.fill(0.5);
    right.fill(-0.5);
    const buffer: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 2,
      length,
      getChannelData: (c) => (c === 0 ? left : right),
    };
    const result = detectSilenceRegions(buffer);
    expect(result).toHaveLength(1);
    expect(result[0].durationSamples).toBe(length);
  });
});

// totalSilenceSec

describe("totalSilenceSec", () => {
  it("7) summiert durationen korrekt (in Sekunden)", () => {
    const buffer = makeMultiSilenceBuffer(96000, [
      [0, 24000],
      [48000, 72000],
    ]);
    const regions = detectSilenceRegions(buffer);
    expect(regions).toHaveLength(2);
    const total = totalSilenceSec(regions);
    expect(total).toBeCloseTo(1.0, 6);
  });

  it("empty regions array -> 0", () => {
    expect(totalSilenceSec([])).toBe(0);
  });
});

// longestSilenceRegion

describe("longestSilenceRegion", () => {
  it("8) liefert die laengste Region", () => {
    const buffer = makeMultiSilenceBuffer(60000, [
      [0, 5000],
      [10000, 30000],
      [40000, 50000],
    ]);
    const regions = detectSilenceRegions(buffer);
    expect(regions).toHaveLength(3);
    const longest = longestSilenceRegion(regions);
    expect(longest).not.toBeNull();
    expect(longest?.startSample).toBe(10000);
    expect(longest?.endSample).toBe(30000);
    expect(longest?.durationSamples).toBe(20000);
  });

  it("empty input -> null", () => {
    expect(longestSilenceRegion([])).toBeNull();
  });
});

// Defensive Defaults

describe("defensive options", () => {
  it("9) threshold NaN -> fallback DEFAULT_THRESHOLD", () => {
    const buffer = makeLoudBuffer(12000, 0.001);
    const result = detectSilenceRegions(buffer, { threshold: NaN });
    expect(result).toHaveLength(1);
    expect(result[0].durationSamples).toBe(12000);

    const loud = makeLoudBuffer(12000, 0.01);
    expect(detectSilenceRegions(loud, { threshold: NaN })).toEqual([]);
  });

  it("threshold negative -> fallback", () => {
    const buffer = makeLoudBuffer(12000, 0.001);
    const result = detectSilenceRegions(buffer, { threshold: -0.5 });
    expect(result).toHaveLength(1);
  });

  it("10) minRegionSamples 0 -> fallback DEFAULT_MIN_REGION_SAMPLES", () => {
    const length = 12000;
    const buffer = makeMiddleSilenceBuffer(length, 4000, 5000, 0.5);
    const result = detectSilenceRegions(buffer, { minRegionSamples: 0 });
    expect(result).toEqual([]);
  });

  it("minRegionSamples NaN -> fallback DEFAULT_MIN_REGION_SAMPLES", () => {
    const length = 24000;
    const buffer = makeMiddleSilenceBuffer(length, 8000, 16000, 0.5);
    const result = detectSilenceRegions(buffer, { minRegionSamples: NaN });
    expect(result).toHaveLength(1);
    expect(result[0].durationSamples).toBe(8000);
  });

  it("minRegionSamples explicit low value picks up short silences", () => {
    const length = 12000;
    const buffer = makeMiddleSilenceBuffer(length, 4000, 5000, 0.5);
    const result = detectSilenceRegions(buffer, { minRegionSamples: 500 });
    expect(result).toHaveLength(1);
    expect(result[0].startSample).toBe(4000);
    expect(result[0].endSample).toBe(5000);
  });

  it("Konstanten haben erwartete Werte", () => {
    expect(DEFAULT_THRESHOLD).toBeCloseTo(0.005, 6);
    expect(DEFAULT_MIN_REGION_SAMPLES).toBe(4800);
  });
});
