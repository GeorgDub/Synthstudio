// @vitest-environment node
/**
 * sample-fade-reverse.test.ts — v3.133.0
 * Tests für Sample-Reverse + Fade-In/Out + Trim-Silence Pure Helpers.
 */

import { describe, it, expect } from "vitest";
import {
  reverseSample,
  fadeInSample,
  fadeOutSample,
  fadeCurveAt,
  msToSampleCount,
  trimSilence,
  FADE_CURVES,
  DEFAULT_FADE_MS,
  DEFAULT_TRIM_THRESHOLD,
} from "../../client/src/utils/sampleFadeReverse";
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

function makeStereoBuffer(L: number[], R: number[]): AudioBufferLike {
  const left = new Float32Array(L);
  const right = new Float32Array(R);
  return {
    sampleRate: 48000,
    numberOfChannels: 2,
    length: Math.max(L.length, R.length),
    getChannelData: (c: number) => (c === 0 ? left : right),
  };
}

describe("v3.133 reverseSample", () => {
  it("reverses mono samples", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4]);
    const rev = reverseSample(buf);
    const data = Array.from(rev.getChannelData(0));
    expect(data[0]).toBeCloseTo(0.4, 5);
    expect(data[3]).toBeCloseTo(0.1, 5);
  });

  it("reverses both stereo channels", () => {
    const buf = makeStereoBuffer([0.1, 0.2], [0.3, 0.4]);
    const rev = reverseSample(buf);
    expect(rev.numberOfChannels).toBe(2);
    expect(rev.getChannelData(0)[0]).toBeCloseTo(0.2, 5);
    expect(rev.getChannelData(1)[0]).toBeCloseTo(0.4, 5);
  });

  it("immutable: original unchanged", () => {
    const buf = makeBuffer([0.1, 0.2]);
    const origRef = buf.getChannelData(0);
    const before = origRef[0];
    reverseSample(buf);
    expect(origRef[0]).toBe(before);
  });

  it("empty buffer → empty result", () => {
    const result = reverseSample(makeBuffer([]));
    expect(result.length).toBe(0);
    expect(result.numberOfChannels).toBe(0);
  });

  it("single sample → unchanged", () => {
    const result = reverseSample(makeBuffer([0.5]));
    expect(result.getChannelData(0)[0]).toBeCloseTo(0.5, 5);
  });
});

describe("v3.133 fadeCurveAt", () => {
  it("linear: t=0 → 0", () => expect(fadeCurveAt(0, "linear")).toBe(0));
  it("linear: t=1 → 1", () => expect(fadeCurveAt(1, "linear")).toBe(1));
  it("linear: t=0.5 → 0.5", () => expect(fadeCurveAt(0.5, "linear")).toBe(0.5));

  it("exp: t=0.5 → 0.25", () => expect(fadeCurveAt(0.5, "exp")).toBeCloseTo(0.25));
  it("exp: t=1 → 1", () => expect(fadeCurveAt(1, "exp")).toBe(1));

  it("equal-power: t=0 → 0", () => expect(fadeCurveAt(0, "equal-power")).toBeCloseTo(0));
  it("equal-power: t=1 → 1", () => expect(fadeCurveAt(1, "equal-power")).toBeCloseTo(1));
  it("equal-power: t=0.5 → sin(π/4)≈0.707", () => {
    expect(fadeCurveAt(0.5, "equal-power")).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("clamps t<0 → 0", () => expect(fadeCurveAt(-0.5, "linear")).toBe(0));
  it("clamps t>1 → 1", () => expect(fadeCurveAt(1.5, "linear")).toBe(1));
  it("NaN → 0", () => expect(fadeCurveAt(NaN, "linear")).toBe(0));
});

describe("v3.133 msToSampleCount", () => {
  it("100ms @ 48kHz → 4800", () => expect(msToSampleCount(100, 48000, 99999)).toBe(4800));
  it("clamps to maxLen", () => expect(msToSampleCount(1000, 48000, 100)).toBe(100));
  it("0ms → 0", () => expect(msToSampleCount(0, 48000, 100)).toBe(0));
  it("negative → 0", () => expect(msToSampleCount(-10, 48000, 100)).toBe(0));
  it("NaN → 0", () => expect(msToSampleCount(NaN, 48000, 100)).toBe(0));
});

describe("v3.133 fadeInSample", () => {
  it("first sample is 0 (fade start)", () => {
    const buf = makeBuffer(new Array(100).fill(1.0));
    const faded = fadeInSample(buf, 10, "linear");
    expect(faded.getChannelData(0)[0]).toBeCloseTo(0, 3);
  });

  it("samples after fade region unchanged", () => {
    const buf = makeBuffer(new Array(48000).fill(1.0));
    const faded = fadeInSample(buf, 10, "linear"); // 480 samples
    expect(faded.getChannelData(0)[1000]).toBeCloseTo(1.0, 3);
  });

  it("monotonically increasing within fade region", () => {
    const buf = makeBuffer(new Array(48000).fill(1.0));
    const faded = fadeInSample(buf, 100, "linear"); // 4800 samples
    const data = faded.getChannelData(0);
    for (let i = 1; i < 4800; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(data[i - 1] - 1e-5);
    }
  });

  it("stereo: applied to both channels", () => {
    const buf = makeStereoBuffer(new Array(100).fill(1), new Array(100).fill(1));
    const faded = fadeInSample(buf, 10, "linear");
    expect(faded.getChannelData(0)[0]).toBeCloseTo(0, 3);
    expect(faded.getChannelData(1)[0]).toBeCloseTo(0, 3);
  });

  it("empty buffer → empty result", () => {
    const result = fadeInSample(makeBuffer([]));
    expect(result.length).toBe(0);
  });

  it("0ms duration → no change", () => {
    const buf = makeBuffer([1.0, 1.0, 1.0]);
    const faded = fadeInSample(buf, 0, "linear");
    expect(faded.getChannelData(0)[0]).toBe(1.0);
  });
});

describe("v3.133 fadeOutSample", () => {
  it("last sample is 0 (fade end)", () => {
    const buf = makeBuffer(new Array(48000).fill(1.0));
    const faded = fadeOutSample(buf, 100, "linear");
    expect(faded.getChannelData(0)[47999]).toBeCloseTo(0, 2);
  });

  it("samples before fade region unchanged", () => {
    const buf = makeBuffer(new Array(48000).fill(1.0));
    const faded = fadeOutSample(buf, 100, "linear"); // last 4800
    expect(faded.getChannelData(0)[1000]).toBeCloseTo(1.0, 3);
  });

  it("monotonically decreasing in fade region", () => {
    const buf = makeBuffer(new Array(48000).fill(1.0));
    const faded = fadeOutSample(buf, 100, "linear");
    const data = faded.getChannelData(0);
    for (let i = 48000 - 4800; i < 47998; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(data[i + 1] - 1e-5);
    }
  });
});

describe("v3.133 trimSilence", () => {
  it("trims leading silence", () => {
    const buf = makeBuffer([0, 0, 0, 0.5, 0.6, 0.7]);
    const trimmed = trimSilence(buf, 0.01);
    expect(trimmed.length).toBe(3);
    expect(trimmed.getChannelData(0)[0]).toBeCloseTo(0.5, 5);
  });

  it("trims trailing silence", () => {
    const buf = makeBuffer([0.5, 0.6, 0.7, 0, 0, 0]);
    const trimmed = trimSilence(buf, 0.01);
    expect(trimmed.length).toBe(3);
    expect(trimmed.getChannelData(0)[2]).toBeCloseTo(0.7, 5);
  });

  it("trims both ends", () => {
    const buf = makeBuffer([0, 0, 0.5, 0.6, 0, 0]);
    const trimmed = trimSilence(buf, 0.01);
    expect(trimmed.length).toBe(2);
  });

  it("pure silence → empty buffer", () => {
    const buf = makeBuffer([0, 0, 0, 0]);
    const trimmed = trimSilence(buf, 0.01);
    expect(trimmed.length).toBe(0);
  });

  it("no silence → unchanged length", () => {
    const buf = makeBuffer([0.5, 0.5, 0.5]);
    const trimmed = trimSilence(buf, 0.01);
    expect(trimmed.length).toBe(3);
  });

  it("threshold respected: low-volume samples below threshold trimmed", () => {
    const buf = makeBuffer([0.001, 0.5, 0.001]);
    const trimmed = trimSilence(buf, 0.01);
    expect(trimmed.length).toBe(1);
    expect(trimmed.getChannelData(0)[0]).toBeCloseTo(0.5, 5);
  });

  it("stereo: max across channels respected", () => {
    const buf = makeStereoBuffer([0, 0, 0.5], [0.5, 0, 0]);
    const trimmed = trimSilence(buf, 0.01);
    // L[0]=0, R[0]=0.5 → max=0.5 > thresh, trimStart=0
    // L[2]=0.5, R[2]=0 → max=0.5 > thresh, trimEnd=2
    expect(trimmed.length).toBe(3);
  });
});

describe("v3.133 Constants", () => {
  it("FADE_CURVES contains 3 entries", () => {
    expect(FADE_CURVES).toEqual(["linear", "exp", "equal-power"]);
  });
  it("DEFAULT_FADE_MS = 10", () => expect(DEFAULT_FADE_MS).toBe(10));
  it("DEFAULT_TRIM_THRESHOLD = 0.001", () => expect(DEFAULT_TRIM_THRESHOLD).toBe(0.001));
});
