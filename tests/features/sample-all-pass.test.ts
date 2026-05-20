// @vitest-environment node
/**
 * sample-all-pass.test.ts - v3.202.0
 *
 * Tests fuer Biquad-All-Pass Pure-Helper (RBJ Cookbook):
 *   - applyAllPass (top-level API)
 *   - ALLPASS_PRESETS shape + content
 *   - defensive defaults (NaN / Infinity / out-of-range)
 *   - magnitude-preserving Eigenschaft
 *   - Phase-Shift (single-stage = inverted sine at centerHz)
 *   - Multi-stage cascade
 */

import { describe, it, expect } from 'vitest';
import {
  applyAllPass,
  ALLPASS_PRESETS,
  DEFAULT_CENTER_HZ,
  DEFAULT_Q,
  DEFAULT_STAGES,
} from '../../client/src/utils/sampleAllPass';
import type { AudioBufferLike } from '../../client/src/utils/sampleEmbedding';

// Helpers

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

function makeEmptyBuffer(): AudioBufferLike {
  return {
    sampleRate: 48000,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function makeSineBuffer(
  freq: number,
  length: number,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function rms(arr: Float32Array, fromIndex = 0): number {
  let sum = 0;
  let count = 0;
  for (let i = fromIndex; i < arr.length; i++) {
    sum += arr[i] * arr[i];
    count++;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

// Tests

describe("v3.202 applyAllPass - basics", () => {
  it("empty buffer returns empty buffer", () => {
    const empty = makeEmptyBuffer();
    const out = applyAllPass(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("defaults: centerHz=1000 q=0.707 stages=1", () => {
    expect(DEFAULT_CENTER_HZ).toBe(1000);
    expect(DEFAULT_Q).toBeCloseTo(0.707, 3);
    expect(DEFAULT_STAGES).toBe(1);
  });

  it("undefined options behaves like empty options", () => {
    const buf = makeSineBuffer(1000, 256);
    const a = applyAllPass(buf);
    const b = applyAllPass(buf, {});
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    expect(da.length).toBe(db.length);
    for (let i = 0; i < da.length; i++) {
      expect(da[i]).toBeCloseTo(db[i], 6);
    }
  });

  it("preserves length / numCh / sampleRate at 44100", () => {
    const buf = makeSineBuffer(500, 128, 44100);
    const out = applyAllPass(buf, { centerHz: 500 });
    expect(out.length).toBe(128);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(44100);
  });

  it("all-output is finite (no NaN, no Inf) with default options", () => {
    const buf = makeSineBuffer(1000, 4800);
    const out = applyAllPass(buf);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("v3.202 applyAllPass - magnitude-preserving", () => {
  it("RMS of output approximates RMS of input for sine at centerHz (after transient)", () => {
    // Long buffer 100ms @ 48kHz; skip first 100 samples for transient settle.
    const buf = makeSineBuffer(1000, 4800);
    const out = applyAllPass(buf, { centerHz: 1000, q: 0.707, stages: 1 });
    const rin = rms(buf.getChannelData(0), 100);
    const rout = rms(out.getChannelData(0), 100);
    // Allow 10% tolerance: all-pass has |H|=1 but a finite startup transient.
    expect(rout).toBeGreaterThan(rin * 0.9);
    expect(rout).toBeLessThan(rin * 1.1);
  });

  it("RMS preserved at frequencies above centerHz", () => {
    const buf = makeSineBuffer(5000, 4800);
    const out = applyAllPass(buf, { centerHz: 1000 });
    const rin = rms(buf.getChannelData(0), 100);
    const rout = rms(out.getChannelData(0), 100);
    expect(rout).toBeGreaterThan(rin * 0.9);
    expect(rout).toBeLessThan(rin * 1.1);
  });

  it("RMS preserved at frequencies below centerHz", () => {
    const buf = makeSineBuffer(200, 4800);
    const out = applyAllPass(buf, { centerHz: 1000 });
    const rin = rms(buf.getChannelData(0), 100);
    const rout = rms(out.getChannelData(0), 100);
    expect(rout).toBeGreaterThan(rin * 0.9);
    expect(rout).toBeLessThan(rin * 1.1);
  });

  it("RMS preserved for stages=4 phaser", () => {
    const buf = makeSineBuffer(1000, 4800);
    const out = applyAllPass(buf, { centerHz: 1000, q: 1.5, stages: 4 });
    const rin = rms(buf.getChannelData(0), 200);
    const rout = rms(out.getChannelData(0), 200);
    expect(rout).toBeGreaterThan(rin * 0.85);
    expect(rout).toBeLessThan(rin * 1.15);
  });
});

describe("v3.202 applyAllPass - phase-shift behavior", () => {
  it("single stage at centerHz: output is approximately inverted input in steady state", () => {
    // At centerHz, single-stage biquad all-pass has phase = -pi (-180 deg).
    // So output sample should approach -input sample after transient settles.
    const len = 4800;
    const buf = makeSineBuffer(1000, len);
    const out = applyAllPass(buf, { centerHz: 1000, q: 0.707, stages: 1 });
    const src = buf.getChannelData(0);
    const dst = out.getChannelData(0);

    // Check well after the transient (e.g. last 1000 samples).
    let sumSqDiff = 0;
    let sumSqInv = 0;
    for (let i = len - 1000; i < len; i++) {
      sumSqDiff += (dst[i] - src[i]) * (dst[i] - src[i]); // identity check
      sumSqInv += (dst[i] + src[i]) * (dst[i] + src[i]); // inversion check
    }
    // Inversion residual should be MUCH smaller than identity residual.
    expect(sumSqInv).toBeLessThan(sumSqDiff);
  });

  it("output differs from input (i.e. filter does SOMETHING)", () => {
    const buf = makeSineBuffer(1000, 256);
    const out = applyAllPass(buf, { centerHz: 1000 });
    const src = buf.getChannelData(0);
    const dst = out.getChannelData(0);
    let anyDifferent = false;
    for (let i = 0; i < src.length; i++) {
      if (Math.abs(src[i] - dst[i]) > 1e-6) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });

  it("stages=1 and stages=4 produce different outputs (cascade has effect)", () => {
    const buf = makeSineBuffer(1000, 4800);
    const a = applyAllPass(buf, { centerHz: 1000, stages: 1 });
    const b = applyAllPass(buf, { centerHz: 1000, stages: 4 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);

    let sumSqDiff = 0;
    for (let i = 200; i < da.length; i++) {
      sumSqDiff += (da[i] - db[i]) * (da[i] - db[i]);
    }
    // Should be clearly nonzero (different cascade depth = different phase).
    expect(sumSqDiff).toBeGreaterThan(1.0);
  });
});

describe("v3.202 applyAllPass - multi-channel", () => {
  it("processes 2 channels independently with no cross-channel leak", () => {
    // Channel 0 = silence, channel 1 = sine.
    const len = 1024;
    const ch0 = new Array(len).fill(0);
    const ch1Vals: number[] = [];
    for (let i = 0; i < len; i++) {
      ch1Vals.push(Math.sin((2 * Math.PI * 1000 * i) / 48000));
    }
    const buf = makeMultiChannelBuffer([ch0, ch1Vals]);
    const out = applyAllPass(buf, { centerHz: 1000 });
    expect(out.numberOfChannels).toBe(2);
    // Channel 0 must stay silent (no cross-talk from channel 1).
    const d0 = out.getChannelData(0);
    for (let i = 0; i < d0.length; i++) {
      expect(d0[i]).toBe(0);
    }
    // Channel 1 should have non-trivial output.
    const d1 = out.getChannelData(1);
    expect(rms(d1, 100)).toBeGreaterThan(0.1);
  });

  it("out-of-range channel throws RangeError", () => {
    const buf = makeSineBuffer(1000, 256);
    const out = applyAllPass(buf);
    expect(() => out.getChannelData(5)).toThrow(RangeError);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
  });

  it("does not mutate the input buffer (immutability)", () => {
    const len = 512;
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      data[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000);
    }
    const before = Array.from(data);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: len,
      getChannelData: () => data,
    };
    applyAllPass(buf, { centerHz: 1000, q: 1.5, stages: 4 });
    for (let i = 0; i < len; i++) {
      expect(data[i]).toBeCloseTo(before[i], 5);
    }
  });
});

describe("v3.202 applyAllPass - defensive sanitizers", () => {
  it("centerHz=NaN -> default 1000", () => {
    const buf = makeSineBuffer(1000, 256);
    const a = applyAllPass(buf, { centerHz: NaN });
    const b = applyAllPass(buf, { centerHz: 1000 });
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) {
      expect(da[i]).toBeCloseTo(db[i], 6);
    }
  });

  it("centerHz=Infinity / -Infinity -> default 1000", () => {
    const buf = makeSineBuffer(1000, 256);
    const a = applyAllPass(buf, { centerHz: Infinity });
    const b = applyAllPass(buf, { centerHz: -Infinity });
    const ref = applyAllPass(buf, { centerHz: 1000 });
    const ra = a.getChannelData(0);
    const rb = b.getChannelData(0);
    const rr = ref.getChannelData(0);
    for (let i = 0; i < ra.length; i++) {
      expect(ra[i]).toBeCloseTo(rr[i], 6);
      expect(rb[i]).toBeCloseTo(rr[i], 6);
    }
  });

  it("centerHz=0 / negative -> default 1000", () => {
    const buf = makeSineBuffer(1000, 256);
    const a = applyAllPass(buf, { centerHz: 0 });
    const b = applyAllPass(buf, { centerHz: -500 });
    const ref = applyAllPass(buf, { centerHz: 1000 });
    const ra = a.getChannelData(0);
    const rb = b.getChannelData(0);
    const rr = ref.getChannelData(0);
    for (let i = 0; i < ra.length; i++) {
      expect(ra[i]).toBeCloseTo(rr[i], 6);
      expect(rb[i]).toBeCloseTo(rr[i], 6);
    }
  });

  it("centerHz > Nyquist clamps to Nyquist", () => {
    const buf = makeSineBuffer(1000, 256, 48000);
    const out = applyAllPass(buf, { centerHz: 100000 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("q=NaN / 0 / negative -> default 0.707", () => {
    const buf = makeSineBuffer(1000, 256);
    const ref = applyAllPass(buf, { q: 0.707 });
    for (const bad of [NaN, 0, -1]) {
      const out = applyAllPass(buf, { q: bad });
      const r = ref.getChannelData(0);
      const o = out.getChannelData(0);
      for (let i = 0; i < r.length; i++) {
        expect(o[i]).toBeCloseTo(r[i], 6);
      }
    }
  });

  it("q > 10 clamps to 10", () => {
    const buf = makeSineBuffer(1000, 256);
    const a = applyAllPass(buf, { q: 100 });
    const b = applyAllPass(buf, { q: 10 });
    const ra = a.getChannelData(0);
    const rb = b.getChannelData(0);
    for (let i = 0; i < ra.length; i++) {
      expect(ra[i]).toBeCloseTo(rb[i], 6);
    }
  });

  it("stages=NaN / 0 / <1 -> 1", () => {
    const buf = makeSineBuffer(1000, 256);
    const ref = applyAllPass(buf, { stages: 1 });
    for (const bad of [NaN, 0, -1, -100]) {
      const out = applyAllPass(buf, { stages: bad });
      const r = ref.getChannelData(0);
      const o = out.getChannelData(0);
      for (let i = 0; i < r.length; i++) {
        expect(o[i]).toBeCloseTo(r[i], 6);
      }
    }
  });

  it("stages > 8 clamps to 8", () => {
    const buf = makeSineBuffer(1000, 512);
    const a = applyAllPass(buf, { stages: 100 });
    const b = applyAllPass(buf, { stages: 8 });
    const ra = a.getChannelData(0);
    const rb = b.getChannelData(0);
    for (let i = 0; i < ra.length; i++) {
      expect(ra[i]).toBeCloseTo(rb[i], 5);
    }
  });

  it("non-integer stages floored to integer", () => {
    const buf = makeSineBuffer(1000, 256);
    const a = applyAllPass(buf, { stages: 3.7 });
    const b = applyAllPass(buf, { stages: 3 });
    const ra = a.getChannelData(0);
    const rb = b.getChannelData(0);
    for (let i = 0; i < ra.length; i++) {
      expect(ra[i]).toBeCloseTo(rb[i], 6);
    }
  });
});

describe("v3.202 applyAllPass - sampleRate edge cases", () => {
  it("works at 8000 Hz", () => {
    const buf = makeSineBuffer(500, 1024, 8000);
    const out = applyAllPass(buf, { centerHz: 500 });
    expect(out.sampleRate).toBe(8000);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("works at 96000 Hz", () => {
    const buf = makeSineBuffer(1000, 1024, 96000);
    const out = applyAllPass(buf, { centerHz: 1000 });
    expect(out.sampleRate).toBe(96000);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("zero-length channel is handled", () => {
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
    const out = applyAllPass(buf, { centerHz: 1000 });
    expect(out.length).toBe(0);
    expect(out.getChannelData(0).length).toBe(0);
  });
});

describe("v3.202 ALLPASS_PRESETS - presets validation", () => {
  it("exports subtle / phaser / deep / resonant", () => {
    expect(ALLPASS_PRESETS.subtle).toBeDefined();
    expect(ALLPASS_PRESETS.phaser).toBeDefined();
    expect(ALLPASS_PRESETS.deep).toBeDefined();
    expect(ALLPASS_PRESETS.resonant).toBeDefined();
  });

  it("preset values match spec", () => {
    expect(ALLPASS_PRESETS.subtle.centerHz).toBe(800);
    expect(ALLPASS_PRESETS.subtle.q).toBe(0.5);
    expect(ALLPASS_PRESETS.subtle.stages).toBe(1);

    expect(ALLPASS_PRESETS.phaser.centerHz).toBe(1000);
    expect(ALLPASS_PRESETS.phaser.q).toBe(1.5);
    expect(ALLPASS_PRESETS.phaser.stages).toBe(4);

    expect(ALLPASS_PRESETS.deep.centerHz).toBe(400);
    expect(ALLPASS_PRESETS.deep.q).toBe(2);
    expect(ALLPASS_PRESETS.deep.stages).toBe(6);

    expect(ALLPASS_PRESETS.resonant.centerHz).toBe(2000);
    expect(ALLPASS_PRESETS.resonant.q).toBe(5);
    expect(ALLPASS_PRESETS.resonant.stages).toBe(2);
  });

  it("applying each preset produces finite output and preserves magnitude", () => {
    for (const key of Object.keys(ALLPASS_PRESETS) as Array<keyof typeof ALLPASS_PRESETS>) {
      const preset = ALLPASS_PRESETS[key];
      const buf = makeSineBuffer(preset.centerHz, 4800);
      const out = applyAllPass(buf, preset);
      const d = out.getChannelData(0);
      expect(allFinite(d)).toBe(true);
      // Magnitude approximately preserved (loose tolerance for higher stages).
      const rin = rms(buf.getChannelData(0), 300);
      const rout = rms(d, 300);
      expect(rout).toBeGreaterThan(rin * 0.7);
      expect(rout).toBeLessThan(rin * 1.3);
    }
  });
});
