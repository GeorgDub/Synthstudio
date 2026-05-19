// @vitest-environment node
/**
 * slice-auto-detector.test.ts — v3.135.0
 * Tests für RMS-Energy-basierte Slice-Detection (ergänzt v2.62 amplitude-detection).
 */

import { describe, it, expect } from "vitest";
import {
  detectSlicePoints,
  sliceAtPoints,
  sliceFrameRms,
  sliceDownmixMono,
  SLICE_FRAME_SIZE,
  SLICE_HOP_SIZE,
  SLICE_DEFAULT_SENSITIVITY,
  SLICE_DEFAULT_MIN_MS,
} from "../../client/src/utils/sliceAutoDetector";
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

function makeStereoBuffer(L: number[], R: number[], sampleRate = 48000): AudioBufferLike {
  const left = new Float32Array(L);
  const right = new Float32Array(R);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: Math.max(L.length, R.length),
    getChannelData: (c: number) => (c === 0 ? left : right),
  };
}

function generateDrumPattern(totalSamples: number, hitPositions: number[]): number[] {
  const samples = new Array(totalSamples).fill(0);
  for (const pos of hitPositions) {
    for (let i = 0; i < 4800 && pos + i < totalSamples; i++) {
      const decay = Math.exp(-i / 1000);
      const wave = Math.sin((i / 48000) * 80 * 2 * Math.PI);
      samples[pos + i] += decay * wave * 0.8;
    }
  }
  return samples;
}

describe("v3.135 sliceFrameRms", () => {
  it("constant 0.5 → RMS 0.5", () => {
    const data = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(sliceFrameRms(data, 0, 4)).toBeCloseTo(0.5, 3);
  });

  it("silence → 0", () => {
    expect(sliceFrameRms(new Float32Array(4), 0, 4)).toBe(0);
  });

  it("NaN ignored", () => {
    const data = new Float32Array([1, NaN, 1]);
    expect(sliceFrameRms(data, 0, 3)).toBeCloseTo(1, 5);
  });

  it("clamps end to length", () => {
    expect(sliceFrameRms(new Float32Array([1, 1, 1]), 0, 100)).toBeCloseTo(1, 5);
  });
});

describe("v3.135 sliceDownmixMono", () => {
  it("stereo mean", () => {
    const buf = makeStereoBuffer([1, 1], [0, 0]);
    expect(sliceDownmixMono(buf)[0]).toBeCloseTo(0.5, 5);
  });

  it("mono passthrough", () => {
    const buf = makeBuffer([0.3, 0.4]);
    expect(sliceDownmixMono(buf)[0]).toBeCloseTo(0.3, 5);
    expect(sliceDownmixMono(buf)[1]).toBeCloseTo(0.4, 5);
  });
});

describe("v3.135 detectSlicePoints", () => {
  it("empty buffer → []", () => {
    expect(detectSlicePoints(makeBuffer([]))).toEqual([]);
  });

  it("very short buffer → [0]", () => {
    expect(detectSlicePoints(makeBuffer([0.1, 0.2, 0.3]))).toEqual([0]);
  });

  it("silence → only [0]", () => {
    expect(detectSlicePoints(makeBuffer(new Array(48000).fill(0)))).toEqual([0]);
  });

  it("multiple drum-hits detected", () => {
    const samples = generateDrumPattern(48000, [0, 12000, 24000, 36000]);
    const points = detectSlicePoints(makeBuffer(samples), { sensitivity: 0.7, minSliceMs: 50 });
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]).toBe(0);
  });

  it("minSliceMs respected", () => {
    const samples = generateDrumPattern(48000, [0, 1000, 2000, 3000]);
    const points = detectSlicePoints(makeBuffer(samples), {
      sensitivity: 0.7,
      minSliceMs: 100,
    });
    for (let i = 1; i < points.length; i++) {
      expect(points[i] - points[i - 1]).toBeGreaterThanOrEqual(4800);
    }
  });

  it("sensitivity=high produces ≥ sensitivity=low", () => {
    const samples = generateDrumPattern(48000, [0, 12000, 24000, 36000]);
    const low = detectSlicePoints(makeBuffer(samples), { sensitivity: 0.1 });
    const high = detectSlicePoints(makeBuffer(samples), { sensitivity: 0.9 });
    expect(high.length).toBeGreaterThanOrEqual(low.length);
  });

  it("channelMode left", () => {
    const L = generateDrumPattern(48000, [0, 24000]);
    const R = new Array(48000).fill(0);
    const points = detectSlicePoints(makeStereoBuffer(L, R), {
      channelMode: "left",
      sensitivity: 0.7,
    });
    expect(points[0]).toBe(0);
  });

  it("channelMode right silence → [0]", () => {
    const L = generateDrumPattern(48000, [0, 24000]);
    const R = new Array(48000).fill(0);
    const points = detectSlicePoints(makeStereoBuffer(L, R), { channelMode: "right" });
    expect(points).toEqual([0]);
  });

  it("Always includes 0 (start)", () => {
    const samples = generateDrumPattern(48000, [10000]);
    expect(detectSlicePoints(makeBuffer(samples))[0]).toBe(0);
  });

  it("Constants exposed", () => {
    expect(SLICE_FRAME_SIZE).toBe(512);
    expect(SLICE_HOP_SIZE).toBe(256);
    expect(SLICE_DEFAULT_SENSITIVITY).toBe(0.5);
    expect(SLICE_DEFAULT_MIN_MS).toBe(50);
  });
});

describe("v3.135 sliceAtPoints", () => {
  it("empty buffer → []", () => {
    expect(sliceAtPoints(makeBuffer([]), [0, 100])).toEqual([]);
  });

  it("empty points → [original]", () => {
    const slices = sliceAtPoints(makeBuffer([1, 2, 3, 4]), []);
    expect(slices.length).toBe(1);
    expect(slices[0].length).toBe(4);
  });

  it("two points → two slices", () => {
    const slices = sliceAtPoints(makeBuffer([1, 2, 3, 4, 5, 6, 7, 8]), [0, 4]);
    expect(slices.length).toBe(2);
    expect(slices[0].length).toBe(4);
    expect(slices[1].length).toBe(4);
  });

  it("preserves sample-rate + channels", () => {
    const buf = makeStereoBuffer([1, 2, 3, 4], [5, 6, 7, 8], 44100);
    const slices = sliceAtPoints(buf, [0, 2]);
    expect(slices[0].sampleRate).toBe(44100);
    expect(slices[0].numberOfChannels).toBe(2);
    expect(slices[0].getChannelData(1)[0]).toBe(5);
  });

  it("auto-prepends 0", () => {
    const slices = sliceAtPoints(makeBuffer([1, 2, 3, 4]), [2]);
    expect(slices.length).toBe(2);
  });

  it("filters invalid points", () => {
    const slices = sliceAtPoints(makeBuffer([1, 2, 3, 4]), [-10, 100, NaN, 2]);
    expect(slices.length).toBe(2);
  });

  it("sorts points", () => {
    const slices = sliceAtPoints(makeBuffer([1, 2, 3, 4, 5, 6]), [4, 0, 2]);
    expect(slices.length).toBe(3);
    expect(slices.map((s) => s.length)).toEqual([2, 2, 2]);
  });
});
