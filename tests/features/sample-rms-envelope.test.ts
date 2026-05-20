// @vitest-environment node
/**
 * sample-rms-envelope.test.ts v3.178.0
 * Tests fuer die RMS-Envelope Pure-Helper.
 */

import { describe, it, expect } from "vitest";
import {
  computeRmsEnvelope,
  findFadeOutPoint,
  findOnsetPoint,
  DEFAULT_FRAME_SIZE,
  DEFAULT_HOP_SIZE,
  MIN_FRAME_SIZE,
  DEFAULT_THRESHOLD,
} from "../../client/src/utils/sampleRmsEnvelope";
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

function makeConstantBuffer(
  length: number,
  value: number,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  data.fill(value);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeRampBuffer(
  length: number,
  startAmp: number,
  endAmp: number,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = length > 1 ? i / (length - 1) : 0;
    data[i] = (startAmp + (endAmp - startAmp) * t) *
      Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeStereoBuffer(
  length: number,
  ampLeft: number,
  ampRight: number,
  sampleRate = 48000,
): AudioBufferLike {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  left.fill(ampLeft);
  right.fill(ampRight);
  return {
    sampleRate,
    numberOfChannels: 2,
    length,
    getChannelData: (channel: number) => (channel === 0 ? left : right),
  };
}

function makeSilenceThenToneBuffer(
  silenceLen: number,
  toneLen: number,
  amp: number,
  sampleRate = 48000,
): AudioBufferLike {
  const length = silenceLen + toneLen;
  const data = new Float32Array(length);
  for (let i = silenceLen; i < length; i++) {
    data[i] = amp * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

describe("computeRmsEnvelope", () => {
  it("empty buffer all zeros", () => {
    const r = computeRmsEnvelope(makeEmptyBuffer());
    expect(r.envelope.length).toBe(0);
    expect(r.samplePositions.length).toBe(0);
    expect(r.peakRms).toBe(0);
    expect(r.meanRms).toBe(0);
    expect(r.frameSize).toBe(DEFAULT_FRAME_SIZE);
    expect(r.hopSize).toBe(DEFAULT_HOP_SIZE);
  });

  it("constant level 0.5 envelope close to 0.5", () => {
    const buf = makeConstantBuffer(4096, 0.5);
    const r = computeRmsEnvelope(buf, { frameSize: 256, hopSize: 128 });
    expect(r.envelope.length).toBeGreaterThan(0);
    for (let i = 0; i < r.envelope.length; i++) {
      expect(r.envelope[i]).toBeCloseTo(0.5, 5);
    }
    expect(r.peakRms).toBeCloseTo(0.5, 5);
    expect(r.meanRms).toBeCloseTo(0.5, 5);
  });

  it("silence buffer envelope all zeros", () => {
    const buf = makeSilentBuffer(4096);
    const r = computeRmsEnvelope(buf, { frameSize: 256, hopSize: 128 });
    expect(r.envelope.length).toBeGreaterThan(0);
    for (let i = 0; i < r.envelope.length; i++) {
      expect(r.envelope[i]).toBe(0);
    }
    expect(r.peakRms).toBe(0);
    expect(r.meanRms).toBe(0);
  });

  it("decreasing amplitude envelope decreasing", () => {
    const buf = makeRampBuffer(8192, 1.0, 0.0);
    const r = computeRmsEnvelope(buf, { frameSize: 512, hopSize: 256 });
    expect(r.envelope.length).toBeGreaterThan(2);
    expect(r.envelope[0]).toBeGreaterThan(r.envelope[r.envelope.length - 1]);
    for (let i = 1; i < r.envelope.length; i++) {
      expect(r.envelope[i]).toBeLessThan(r.envelope[i - 1] + 0.02);
    }
    // peakRms is the JS-number version of envelope[0]; due to Float32
    // storage, envelope[0] is rounded to 32-bit precision while peakRms
    // retains 64-bit precision. They are close but not bit-identical.
    expect(r.peakRms).toBeCloseTo(r.envelope[0], 5);
    expect(r.peakRms).toBeGreaterThanOrEqual(r.envelope[0]);
  });

  it("stereo mix mode averaged", () => {
    const buf = makeStereoBuffer(4096, 0.8, 0.2);
    const r = computeRmsEnvelope(buf, {
      frameSize: 256,
      hopSize: 128,
      channelMode: "mix",
    });
    for (let i = 0; i < r.envelope.length; i++) {
      expect(r.envelope[i]).toBeCloseTo(0.5, 5);
    }
    const rLeft = computeRmsEnvelope(buf, {
      frameSize: 256,
      hopSize: 128,
      channelMode: "left",
    });
    expect(rLeft.envelope[0]).toBeCloseTo(0.8, 5);
    const rRight = computeRmsEnvelope(buf, {
      frameSize: 256,
      hopSize: 128,
      channelMode: "right",
    });
    expect(rRight.envelope[0]).toBeCloseTo(0.2, 5);
  });
});

describe("findFadeOutPoint", () => {
  it("decreasing envelope: findet spaeten threshold-crossing", () => {
    const buf = makeRampBuffer(8192, 1.0, 0.0);
    const env = computeRmsEnvelope(buf, { frameSize: 512, hopSize: 256 });
    const point = findFadeOutPoint(env, 0.5);
    expect(point).toBeGreaterThanOrEqual(0);
    expect(point).toBeLessThan(8192);
    const pointDefault = findFadeOutPoint(env);
    expect(pointDefault).toBeGreaterThanOrEqual(point);
  });

  it("all-silence returns -1", () => {
    const env = computeRmsEnvelope(makeSilentBuffer(4096), {
      frameSize: 256,
      hopSize: 128,
    });
    expect(findFadeOutPoint(env, 0.5)).toBe(-1);
    expect(findFadeOutPoint(env)).toBe(-1);
  });
});

describe("findOnsetPoint", () => {
  it("silence-then-tone: findet early threshold-crossing", () => {
    const buf = makeSilenceThenToneBuffer(4096, 4096, 1.0);
    const env = computeRmsEnvelope(buf, { frameSize: 512, hopSize: 256 });
    const onset = findOnsetPoint(env, 0.5);
    expect(onset).toBeGreaterThan(0);
    expect(onset).toBeLessThan(8192);
    expect(onset).toBeGreaterThanOrEqual(4096 - 512);
  });

  it("empty returns -1", () => {
    const env = computeRmsEnvelope(makeEmptyBuffer());
    expect(findOnsetPoint(env, 0.5)).toBe(-1);
    expect(findOnsetPoint(env)).toBe(-1);
  });
});

describe("defensive defaults", () => {
  it("threshold NaN fallback to 0.1", () => {
    const buf = makeRampBuffer(8192, 1.0, 0.0);
    const env = computeRmsEnvelope(buf, { frameSize: 512, hopSize: 256 });
    const defaultPoint = findFadeOutPoint(env);
    const nanPoint = findFadeOutPoint(env, Number.NaN);
    expect(nanPoint).toBe(defaultPoint);
    const negPoint = findFadeOutPoint(env, -0.5);
    expect(negPoint).toBe(defaultPoint);
    const bigPoint = findFadeOutPoint(env, 1.5);
    expect(bigPoint).toBe(defaultPoint);
    expect(findFadeOutPoint(env, DEFAULT_THRESHOLD)).toBe(defaultPoint);
    const onsetDefault = findOnsetPoint(env);
    expect(findOnsetPoint(env, Number.NaN)).toBe(onsetDefault);
    expect(findOnsetPoint(env, -1)).toBe(onsetDefault);
    expect(findOnsetPoint(env, 2)).toBe(onsetDefault);
  });

  it("frameSize less than MIN clamps to MIN_FRAME_SIZE", () => {
    const buf = makeConstantBuffer(4096, 0.3);
    const r = computeRmsEnvelope(buf, { frameSize: 8, hopSize: 4 });
    expect(r.frameSize).toBe(MIN_FRAME_SIZE);
    expect(r.hopSize).toBe(4);
    expect(r.peakRms).toBeCloseTo(0.3, 5);
  });

  it("hopSize less than 1 fallback to 1", () => {
    const buf = makeConstantBuffer(512, 0.2);
    const r = computeRmsEnvelope(buf, { frameSize: 128, hopSize: 0 });
    expect(r.hopSize).toBe(1);
    expect(r.envelope.length).toBe(512 - 128 + 1);
  });
});
