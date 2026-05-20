// @vitest-environment node
/**
 * sample-pitch-shift.test.ts — v3.194.0
 *
 * Pure-Coverage für samplePitchShift.ts.
 */

import { describe, it, expect } from "vitest";
import {
  applyPitchShift,
  pitchShiftedLength,
  MAX_SEMITONES,
} from "../../client/src/utils/samplePitchShift";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMono(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: (c: number) => {
      if (c !== 0) throw new RangeError(`channel ${c} out of range`);
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

function makeEmpty(): AudioBufferLike {
  return {
    sampleRate: 48000,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

// ─── applyPitchShift ─────────────────────────────────────────────────────────

describe("v3.194 applyPitchShift — basics", () => {
  it("empty buffer → empty buffer", () => {
    const result = applyPitchShift(makeEmpty(), { semitones: 12 });
    expect(result.length).toBe(0);
    expect(result.numberOfChannels).toBe(0);
  });

  it("semitones=0 → identity copy (same length + values)", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4, 0.5]);
    const result = applyPitchShift(buf, { semitones: 0 });
    expect(result.length).toBe(5);
    expect(result.numberOfChannels).toBe(1);
    const data = Array.from(result.getChannelData(0));
    for (let i = 0; i < 5; i++) {
      expect(data[i]).toBeCloseTo(buf.getChannelData(0)[i], 6);
    }
  });

  it("semitones=0 → returns FRESH Float32Array (no aliasing)", () => {
    const buf = makeMono([0.1, 0.2, 0.3]);
    const result = applyPitchShift(buf, { semitones: 0 });
    // Mutate the returned data — original must be untouched.
    result.getChannelData(0)[0] = 99;
    expect(buf.getChannelData(0)[0]).toBeCloseTo(0.1, 6);
  });

  it("+12 semitones (oktav up) → half-length output", () => {
    const input = new Array(100).fill(0).map((_, i) => i / 100);
    const buf = makeMono(input);
    const result = applyPitchShift(buf, { semitones: 12 });
    // ratio = 2 → outputLength = 100 / 2 = 50.
    expect(result.length).toBe(50);
  });

  it("-12 semitones (oktav down) → double-length output", () => {
    const input = new Array(100).fill(0).map((_, i) => i / 100);
    const buf = makeMono(input);
    const result = applyPitchShift(buf, { semitones: -12 });
    // ratio = 0.5 → outputLength = 100 / 0.5 = 200.
    expect(result.length).toBe(200);
  });
});

describe("v3.194 applyPitchShift — multi-channel + sampleRate", () => {
  it("preserves multi-channel layout (stereo)", () => {
    const buf = makeStereo(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8],
    );
    const result = applyPitchShift(buf, { semitones: 12 });
    expect(result.numberOfChannels).toBe(2);
    expect(result.length).toBe(4);
    // Channels remain distinguishable (sign-pattern stays).
    expect(result.getChannelData(0)[0]).toBeGreaterThan(0);
    expect(result.getChannelData(1)[0]).toBeLessThan(0);
  });

  it("preserves sampleRate", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4], 44100);
    const result = applyPitchShift(buf, { semitones: 7 });
    expect(result.sampleRate).toBe(44100);
  });

  it("immutable: original buffer values unchanged", () => {
    const orig = [0.1, 0.2, 0.3, 0.4];
    const buf = makeMono(orig);
    applyPitchShift(buf, { semitones: 12 });
    expect(buf.getChannelData(0)[0]).toBeCloseTo(0.1, 6);
    expect(buf.getChannelData(0)[3]).toBeCloseTo(0.4, 6);
  });
});

describe("v3.194 applyPitchShift — linear interpolation correctness", () => {
  it("known ramp: -12 semitones doubles length with midpoint values", () => {
    // semitones=-12 → ratio=0.5 → outputLength = 4 / 0.5 = 8.
    // src_idx = i * 0.5 → reads at 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5.
    // Linear ramp src = [0, 1, 2, 3].
    // Expected outputs:
    //   i=0 → src 0     → 0
    //   i=1 → src 0.5   → 0.5*0 + 0.5*1 = 0.5
    //   i=2 → src 1     → 1
    //   i=3 → src 1.5   → 0.5*1 + 0.5*2 = 1.5
    //   i=4 → src 2     → 2
    //   i=5 → src 2.5   → 0.5*2 + 0.5*3 = 2.5
    //   i=6 → src 3     → 3
    //   i=7 → src 3.5   → hi clamped to lo=3 → reads src[3] both sides → 3
    const buf = makeMono([0, 1, 2, 3]);
    const result = applyPitchShift(buf, { semitones: -12 });
    expect(result.length).toBe(8);
    const data = Array.from(result.getChannelData(0));
    expect(data[0]).toBeCloseTo(0, 6);
    expect(data[1]).toBeCloseTo(0.5, 6);
    expect(data[2]).toBeCloseTo(1, 6);
    expect(data[3]).toBeCloseTo(1.5, 6);
    expect(data[4]).toBeCloseTo(2, 6);
    expect(data[5]).toBeCloseTo(2.5, 6);
    expect(data[6]).toBeCloseTo(3, 6);
    // i=7 → hi clamped → reads src[3] = 3.
    expect(data[7]).toBeCloseTo(3, 6);
  });

  it("+12 semitones picks every second sample (no interpolation needed)", () => {
    // ratio=2 → src_idx = i*2 → integer reads at 0,2,4,6,...
    const buf = makeMono([1, 99, 2, 99, 3, 99, 4, 99]);
    const result = applyPitchShift(buf, { semitones: 12 });
    expect(result.length).toBe(4);
    const data = Array.from(result.getChannelData(0));
    expect(data[0]).toBeCloseTo(1, 6);
    expect(data[1]).toBeCloseTo(2, 6);
    expect(data[2]).toBeCloseTo(3, 6);
    expect(data[3]).toBeCloseTo(4, 6);
  });
});

describe("v3.194 applyPitchShift — defensive clamps", () => {
  it("clamps semitones > +24 to +24", () => {
    const buf = makeMono(new Array(1000).fill(0).map((_, i) => i / 1000));
    const r1 = applyPitchShift(buf, { semitones: 99 });
    const r2 = applyPitchShift(buf, { semitones: MAX_SEMITONES });
    expect(r1.length).toBe(r2.length);
  });

  it("clamps semitones < -24 to -24", () => {
    const buf = makeMono(new Array(10).fill(0).map((_, i) => i / 10));
    const r1 = applyPitchShift(buf, { semitones: -99 });
    const r2 = applyPitchShift(buf, { semitones: -MAX_SEMITONES });
    expect(r1.length).toBe(r2.length);
  });

  it("NaN semitones → behaves like 0 (identity length)", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4, 0.5]);
    const result = applyPitchShift(buf, { semitones: Number.NaN });
    expect(result.length).toBe(5);
    const data = Array.from(result.getChannelData(0));
    expect(data[0]).toBeCloseTo(0.1, 6);
    expect(data[4]).toBeCloseTo(0.5, 6);
  });

  it("Infinity semitones → clamped to +24 (very short output)", () => {
    const buf = makeMono(new Array(1000).fill(0).map((_, i) => i / 1000));
    const result = applyPitchShift(buf, { semitones: Number.POSITIVE_INFINITY });
    // Clamped to +24 → ratio = 2^2 = 4 → outputLength = 1000/4 = 250.
    expect(result.length).toBe(250);
  });
});

// ─── pitchShiftedLength ──────────────────────────────────────────────────────

describe("v3.194 pitchShiftedLength", () => {
  it("inputLength<=0 → 0", () => {
    expect(pitchShiftedLength(0, 0)).toBe(0);
    expect(pitchShiftedLength(-5, 12)).toBe(0);
  });

  it("semitones=0 → identity floor(inputLength)", () => {
    expect(pitchShiftedLength(100, 0)).toBe(100);
    expect(pitchShiftedLength(101.7, 0)).toBe(101);
  });

  it("+12 → half-length", () => {
    expect(pitchShiftedLength(100, 12)).toBe(50);
    expect(pitchShiftedLength(200, 12)).toBe(100);
  });

  it("-12 → double-length", () => {
    expect(pitchShiftedLength(100, -12)).toBe(200);
  });

  it("+24 → quarter-length", () => {
    expect(pitchShiftedLength(1000, 24)).toBe(250);
  });

  it("-24 → 4x length", () => {
    expect(pitchShiftedLength(100, -24)).toBe(400);
  });

  it("NaN/Infinity safety", () => {
    expect(pitchShiftedLength(100, Number.NaN)).toBe(100);
    expect(pitchShiftedLength(100, Number.POSITIVE_INFINITY)).toBe(
      pitchShiftedLength(100, MAX_SEMITONES),
    );
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("v3.194 constants", () => {
  it("MAX_SEMITONES = 24", () => {
    expect(MAX_SEMITONES).toBe(24);
  });
});
