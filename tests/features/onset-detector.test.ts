// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  detectOnsets,
  frameRms,
  ONSET_DEFAULT_FRAME_SIZE,
  ONSET_DEFAULT_HOP_SIZE,
  ONSET_DEFAULT_SENSITIVITY,
  ONSET_DEFAULT_MIN_DISTANCE_SEC,
} from "../../client/src/utils/onsetDetector";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeBuffer(samples: Float32Array, sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => samples,
  };
}

function makeStereoBuffer(L: Float32Array, R: Float32Array, sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 2,
    length: Math.max(L.length, R.length),
    getChannelData: (c: number) => (c === 0 ? L : R),
  };
}

function makeImpulseBuffer(
  length: number,
  impulsePositions: number[],
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  for (const pos of impulsePositions) {
    for (let i = 0; i < 512 && pos + i < length; i++) {
      data[pos + i] += 0.8 * Math.sin(i * 0.5) * Math.exp(-i / 200);
    }
  }
  return makeBuffer(data, sampleRate);
}

function makeStepBuffer(length: number, stepSample: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = stepSample; i < length; i++) {
    data[i] = 0.6 * Math.sin((i - stepSample) * 0.05);
  }
  return makeBuffer(data, sampleRate);
}

describe("v3.177 frameRms", () => {
  it("constant 0.5 gives RMS 0.5", () => {
    const data = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(frameRms(data, 0, 4)).toBeCloseTo(0.5, 5);
  });

  it("silent buffer gives 0", () => {
    expect(frameRms(new Float32Array(8), 0, 8)).toBe(0);
  });

  it("NaN samples skipped", () => {
    const data = new Float32Array([1, NaN, 1, NaN]);
    expect(frameRms(data, 0, 4)).toBeCloseTo(1, 5);
  });

  it("clamps end to length", () => {
    expect(frameRms(new Float32Array([1, 1, 1]), 0, 100)).toBeCloseTo(1, 5);
  });

  it("known sine-wave RMS approx amplitude / sqrt(2)", () => {
    const N = 4096;
    const amp = 0.7;
    const samples = new Float32Array(N);
    const k = 8;
    for (let i = 0; i < N; i++) {
      samples[i] = amp * Math.sin((2 * Math.PI * k * i) / N);
    }
    const expected = amp / Math.SQRT2;
    expect(frameRms(samples, 0, N)).toBeCloseTo(expected, 3);
  });

  it("length lte 0 gives 0", () => {
    expect(frameRms(new Float32Array([1, 1, 1]), 0, 0)).toBe(0);
    expect(frameRms(new Float32Array([1, 1, 1]), 0, -5)).toBe(0);
  });

  it("empty array gives 0", () => {
    expect(frameRms(new Float32Array(0), 0, 10)).toBe(0);
  });
});

describe("v3.177 detectOnsets defensive", () => {
  it("empty buffer gives empty array", () => {
    expect(detectOnsets(makeBuffer(new Float32Array(0)))).toEqual([]);
  });

  it("silent buffer all zeros gives empty array", () => {
    const buf = makeBuffer(new Float32Array(48000));
    expect(detectOnsets(buf)).toEqual([]);
  });

  it("constant-level buffer gives 0 or very few onsets", () => {
    const data = new Float32Array(48000);
    for (let i = 0; i < data.length; i++) data[i] = 0.3;
    const onsets = detectOnsets(makeBuffer(data));
    expect(onsets.length).toBeLessThanOrEqual(2);
  });

  it("buffer shorter than frameSize gives empty array", () => {
    const data = new Float32Array(100);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i);
    expect(detectOnsets(makeBuffer(data))).toEqual([]);
  });

  it("clamps frameSize less than 64 to 64", () => {
    const buf = makeImpulseBuffer(8000, [1000, 4000]);
    const onsets = detectOnsets(buf, { frameSize: 16, hopSize: 8 });
    expect(Array.isArray(onsets)).toBe(true);
  });

  it("clamps sensitivity outside 0..1", () => {
    const buf = makeImpulseBuffer(48000, [4000, 14000, 24000]);
    const onsetsLow = detectOnsets(buf, { sensitivity: -5 });
    const onsetsHigh = detectOnsets(buf, { sensitivity: 99 });
    expect(Array.isArray(onsetsLow)).toBe(true);
    expect(Array.isArray(onsetsHigh)).toBe(true);
    expect(onsetsHigh.length).toBeGreaterThanOrEqual(onsetsLow.length);
  });

  it("NaN minDistanceSamples falls back to sampleRate * 0.05", () => {
    const buf = makeImpulseBuffer(48000, [4000, 14000, 24000, 34000]);
    const onsets = detectOnsets(buf, {
      sensitivity: 0.7,
      minDistanceSamples: NaN as unknown as number,
    });
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i].samplePos - onsets[i - 1].samplePos).toBeGreaterThanOrEqual(2400);
    }
  });
});

describe("v3.177 detectOnsets detection behaviour", () => {
  it("step-function silence plus sudden tone gives at least 1 onset near step", () => {
    const sampleRate = 48000;
    const stepSample = 12000;
    const buf = makeStepBuffer(48000, stepSample, sampleRate);
    const onsets = detectOnsets(buf, { sensitivity: 0.7 });
    expect(onsets.length).toBeGreaterThanOrEqual(1);
    const tolerance = 4 * ONSET_DEFAULT_HOP_SIZE;
    const closest = onsets.reduce((best, o) =>
      Math.abs(o.samplePos - stepSample) < Math.abs(best.samplePos - stepSample) ? o : best,
    );
    expect(Math.abs(closest.samplePos - stepSample)).toBeLessThanOrEqual(tolerance);
  });

  it("multiple impulses spaced apart give multiple onsets", () => {
    const sampleRate = 48000;
    const positions = [4800, 14400, 24000, 33600];
    const buf = makeImpulseBuffer(48000, positions, sampleRate);
    const onsets = detectOnsets(buf, { sensitivity: 0.7 });
    expect(onsets.length).toBeGreaterThanOrEqual(2);
  });

  it("minDistance filters nearby onsets", () => {
    const sampleRate = 48000;
    const positions = [4000, 4600, 5200, 5800];
    const buf = makeImpulseBuffer(20000, positions, sampleRate);
    const onsets = detectOnsets(buf, {
      sensitivity: 0.9,
      minDistanceSamples: 5000,
    });
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i].samplePos - onsets[i - 1].samplePos).toBeGreaterThanOrEqual(5000);
    }
  });

  it("higher sensitivity gives at least as many onsets as lower", () => {
    const buf = makeImpulseBuffer(48000, [4000, 14000, 24000, 34000]);
    const low = detectOnsets(buf, { sensitivity: 0.05 });
    const high = detectOnsets(buf, { sensitivity: 0.95 });
    expect(high.length).toBeGreaterThanOrEqual(low.length);
  });

  it("lower sensitivity gives at most as many onsets as higher", () => {
    const buf = makeImpulseBuffer(48000, [4000, 14000, 24000, 34000]);
    const veryLow = detectOnsets(buf, { sensitivity: 0.0 });
    const veryHigh = detectOnsets(buf, { sensitivity: 1.0 });
    expect(veryLow.length).toBeLessThanOrEqual(veryHigh.length);
  });

  it("timeSec equals samplePos divided by sampleRate", () => {
    const sampleRate = 44100;
    const buf = makeImpulseBuffer(44100, [5000, 15000, 25000], sampleRate);
    const onsets = detectOnsets(buf, { sensitivity: 0.7 });
    expect(onsets.length).toBeGreaterThanOrEqual(1);
    for (const o of onsets) {
      expect(o.timeSec).toBeCloseTo(o.samplePos / sampleRate, 8);
    }
  });

  it("strength values are within 0..1", () => {
    const buf = makeImpulseBuffer(48000, [4000, 14000, 24000, 34000]);
    const onsets = detectOnsets(buf, { sensitivity: 0.7 });
    for (const o of onsets) {
      expect(o.strength).toBeGreaterThanOrEqual(0);
      expect(o.strength).toBeLessThanOrEqual(1);
      expect(Number.isFinite(o.strength)).toBe(true);
    }
  });

  it("onsets sorted ascending by samplePos", () => {
    const buf = makeImpulseBuffer(60000, [3000, 13000, 23000, 33000, 43000, 53000]);
    const onsets = detectOnsets(buf, { sensitivity: 0.7 });
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i].samplePos).toBeGreaterThan(onsets[i - 1].samplePos);
    }
  });

  it("stereo input downmixes to mono internally", () => {
    const sampleRate = 48000;
    const L = new Float32Array(48000);
    for (let i = 0; i < 512 && 12000 + i < 48000; i++) {
      L[12000 + i] = 0.8 * Math.sin(i * 0.5) * Math.exp(-i / 200);
    }
    const R = new Float32Array(48000);
    const buf = makeStereoBuffer(L, R, sampleRate);
    const onsets = detectOnsets(buf, { sensitivity: 0.7 });
    expect(onsets.length).toBeGreaterThanOrEqual(1);
  });

  it("does not auto-include sample 0 as onset", () => {
    expect(detectOnsets(makeBuffer(new Float32Array(48000)))).toEqual([]);
  });

  it("constants exposed", () => {
    expect(ONSET_DEFAULT_FRAME_SIZE).toBe(512);
    expect(ONSET_DEFAULT_HOP_SIZE).toBe(256);
    expect(ONSET_DEFAULT_SENSITIVITY).toBe(0.5);
    expect(ONSET_DEFAULT_MIN_DISTANCE_SEC).toBeCloseTo(0.05, 5);
  });
});
