// @vitest-environment node
/**
 * sample-high-pass.test.ts — v3.199.0
 *
 * Tests fuer One-Pole-Highpass Pure-Helper:
 *   - applyHighPass (top-level API)
 *   - HIGHPASS_PRESETS shape + content
 *   - defensive defaults (NaN / Infinity / out-of-range)
 *
 * Pendant zu sample-low-pass.test.ts (v3.198).
 */

import { describe, it, expect } from 'vitest';
import {
  applyHighPass,
  HIGHPASS_PRESETS,
  DEFAULT_CUTOFF_HZ,
  DEFAULT_RESONANCE,
} from '../../client/src/utils/sampleHighPass';
import type { AudioBufferLike } from '../../client/src/utils/sampleEmbedding';

// Helpers

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

function makeEmptyBuffer(): AudioBufferLike {
  return {
    sampleRate: 48000,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function makeNyquistSquare(length: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = i % 2 === 0 ? 1 : -1;
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeSine(
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

function rms(arr: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / arr.length);
}

// Tests

describe("v3.199 applyHighPass — basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer();
    const out = applyHighPass(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("empty options -> uses DEFAULT_CUTOFF_HZ (200)", () => {
    const buf = makeBuffer([0, 0.5, 0.25, -0.1, 0.3]);
    const out = applyHighPass(buf, {});
    expect(out.length).toBe(5);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      expect(Number.isFinite(d[i])).toBe(true);
    }
  });

  it("undefined options behaves like empty options", () => {
    const buf = makeBuffer([0, 0.5, 0.25, -0.1, 0.3]);
    const a = applyHighPass(buf);
    const b = applyHighPass(buf, {});
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < 5; i++) expect(da[i]).toBeCloseTo(db[i], 10);
  });

  it("output length + numChannels + sampleRate preserved", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 44100);
    const out = applyHighPass(buf, { cutoffHz: 1000 });
    expect(out.length).toBe(6);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(44100);
  });
});

describe("v3.199 applyHighPass — filter behaviour", () => {
  it("DC (constant) settles to ~0 (highpass kills DC)", () => {
    const buf = makeBuffer(new Array(4000).fill(0.5));
    const out = applyHighPass(buf, { cutoffHz: 1000, resonance: 0 });
    const d = out.getChannelData(0);
    expect(Math.abs(d[3000])).toBeLessThan(1e-3);
    expect(Math.abs(d[3999])).toBeLessThan(1e-3);
  });

  it("high cutoff strongly attenuates a low-frequency sine", () => {
    const buf = makeSine(50, 4096);
    const out = applyHighPass(buf, { cutoffHz: 2000, resonance: 0 });
    const dIn = buf.getChannelData(0);
    const dOut = out.getChannelData(0);
    const tailIn = dIn.subarray(2048);
    const tailOut = dOut.subarray(2048);
    expect(rms(tailIn)).toBeGreaterThan(0.5);
    expect(rms(tailOut)).toBeLessThan(0.2);
  });

  it("low cutoff passes a high-frequency Nyquist square mostly intact", () => {
    const buf = makeNyquistSquare(2048);
    const out = applyHighPass(buf, { cutoffHz: 100, resonance: 0 });
    const dIn = buf.getChannelData(0);
    const dOut = out.getChannelData(0);
    const tailIn = dIn.subarray(1024);
    const tailOut = dOut.subarray(1024);
    expect(rms(tailIn)).toBeCloseTo(1, 3);
    expect(rms(tailOut)).toBeGreaterThan(0.9);
  });

  it("low cutoff is closer to identity than high cutoff (AC content)", () => {
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) samples.push(i % 2 === 0 ? 0.3 : -0.3);
    const buf = makeBuffer(samples);
    const lowCut = applyHighPass(buf, { cutoffHz: 50, resonance: 0 });
    const hiCut = applyHighPass(buf, { cutoffHz: 24000, resonance: 0 });
    const dIn = buf.getChannelData(0);
    const dLow = lowCut.getChannelData(0);
    const dHi = hiCut.getChannelData(0);

    let devLow = 0;
    let devHi = 0;
    for (let i = 2; i < dIn.length; i++) {
      devLow += Math.abs(dIn[i] - dLow[i]);
      devHi += Math.abs(dIn[i] - dHi[i]);
    }
    expect(devLow).toBeLessThan(devHi);
  });

  it("resonance > 0 increases output amplitude near cutoff vs resonance=0", () => {
    const length = 2048;
    const sr = 48000;
    const freq = 1000;
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freq * i) / sr);
    }
    const buf: AudioBufferLike = {
      sampleRate: sr,
      numberOfChannels: 1,
      length,
      getChannelData: () => samples,
    };
    const r0 = applyHighPass(buf, { cutoffHz: 1000, resonance: 0 });
    const r1 = applyHighPass(buf, { cutoffHz: 1000, resonance: 1 });
    const tail = (arr: Float32Array) => arr.subarray(1024);
    expect(rms(tail(r1.getChannelData(0)))).toBeGreaterThan(
      rms(tail(r0.getChannelData(0))),
    );
  });

  it("resonance=0 leaves the plain highpass output finite + sane", () => {
    const buf = makeBuffer([0, 1, -1, 0.5, -0.5, 0.25, -0.25]);
    const out = applyHighPass(buf, { cutoffHz: 500, resonance: 0 });
    const d = out.getChannelData(0);
    expect(d[0]).toBeCloseTo(0, 10);
    for (let i = 0; i < d.length; i++) {
      expect(Number.isFinite(d[i])).toBe(true);
    }
  });
});

describe("v3.199 applyHighPass — multi-channel", () => {
  it("multi-channel: shape preserved, each channel processed independently", () => {
    const ch0 = new Array(2048).fill(0).map((_, i) => (i % 2 === 0 ? 1 : -1));
    const ch1 = new Array(2048).fill(0.5);
    const buf = makeMultiChannelBuffer([ch0, ch1]);
    const out = applyHighPass(buf, { cutoffHz: 200, resonance: 0 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(2048);
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    expect(rms(l.subarray(1024))).toBeGreaterThan(0.9);
    expect(Math.abs(r[2000])).toBeLessThan(1e-2);
  });

  it("multi-channel: out-of-range channel access throws RangeError", () => {
    const buf = makeMultiChannelBuffer([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    const out = applyHighPass(buf);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });

  it("input buffer is not mutated", () => {
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const data = new Float32Array(original);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    applyHighPass(buf, { cutoffHz: 500, resonance: 0.5 });
    for (let i = 0; i < original.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 5);
    }
  });
});

describe("v3.199 applyHighPass — defensive defaults", () => {
  it("NaN cutoffHz falls back to default 200 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const out = applyHighPass(buf, { cutoffHz: NaN });
    const ref = applyHighPass(buf, { cutoffHz: 200 });
    const d = out.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("cutoffHz <= 0 falls back to default 200 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const out = applyHighPass(buf, { cutoffHz: -500 });
    const ref = applyHighPass(buf, { cutoffHz: 200 });
    const d = out.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);

    const out0 = applyHighPass(buf, { cutoffHz: 0 });
    const d0 = out0.getChannelData(0);
    for (let i = 0; i < d0.length; i++) expect(d0[i]).toBeCloseTo(r[i], 10);
  });

  it("cutoffHz > Nyquist clamps to Nyquist (sampleRate/2)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const clamped = applyHighPass(buf, { cutoffHz: 100000 });
    const ref = applyHighPass(buf, { cutoffHz: 24000 });
    const d = clamped.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("Infinity cutoffHz falls back to default 200 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const inf = applyHighPass(buf, { cutoffHz: Infinity });
    const ref = applyHighPass(buf, { cutoffHz: 200 });
    const d = inf.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("NaN / negative resonance falls back to 0 (no boost)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const ref = applyHighPass(buf, { cutoffHz: 1000, resonance: 0 });
    const nanRes = applyHighPass(buf, { cutoffHz: 1000, resonance: NaN });
    const negRes = applyHighPass(buf, { cutoffHz: 1000, resonance: -0.5 });
    const r = ref.getChannelData(0);
    const dN = nanRes.getChannelData(0);
    const dNeg = negRes.getChannelData(0);
    for (let i = 0; i < r.length; i++) {
      expect(dN[i]).toBeCloseTo(r[i], 10);
      expect(dNeg[i]).toBeCloseTo(r[i], 10);
    }
  });

  it("resonance > 1 clamps to 1 (max +6 dB)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const huge = applyHighPass(buf, { cutoffHz: 1000, resonance: 100 });
    const max = applyHighPass(buf, { cutoffHz: 1000, resonance: 1 });
    const dH = huge.getChannelData(0);
    const dM = max.getChannelData(0);
    for (let i = 0; i < dH.length; i++) expect(dH[i]).toBeCloseTo(dM[i], 10);
  });

  it("default constants are exported with expected values", () => {
    expect(DEFAULT_CUTOFF_HZ).toBe(200);
    expect(DEFAULT_RESONANCE).toBe(0);
  });
});

describe("v3.199 applyHighPass — sampleRate edge cases", () => {
  it("handles sampleRate 8000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, -0.5, -0.3, 0.0], 8000);
    const out = applyHighPass(buf, { cutoffHz: 200 });
    expect(out.length).toBe(8);
    expect(out.sampleRate).toBe(8000);
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("handles sampleRate 44100 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 44100);
    const out = applyHighPass(buf, { cutoffHz: 200 });
    expect(out.length).toBe(5);
    expect(out.sampleRate).toBe(44100);
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("handles sampleRate 96000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 96000);
    const out = applyHighPass(buf, { cutoffHz: 200 });
    expect(out.length).toBe(5);
    expect(out.sampleRate).toBe(96000);
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("handles zero-length channel buffer gracefully", () => {
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
    const out = applyHighPass(buf, { cutoffHz: 500 });
    expect(out.length).toBe(0);
    expect(out.getChannelData(0).length).toBe(0);
  });
});

describe("v3.199 HIGHPASS_PRESETS", () => {
  it("has the four documented presets with positive cutoffs", () => {
    expect(HIGHPASS_PRESETS.rumble.cutoffHz).toBe(80);
    expect(HIGHPASS_PRESETS.vocal.cutoffHz).toBe(100);
    expect(HIGHPASS_PRESETS.thin.cutoffHz).toBe(300);
    expect(HIGHPASS_PRESETS.airy.cutoffHz).toBe(600);

    for (const key of ["rumble", "vocal", "thin", "airy"] as const) {
      const p = HIGHPASS_PRESETS[key];
      expect(Number.isFinite(p.cutoffHz)).toBe(true);
      expect(p.cutoffHz).toBeGreaterThan(0);
    }
  });

  it("applying a preset produces a valid finite output buffer", () => {
    const samples: number[] = [];
    for (let i = 0; i < 2048; i++) samples.push(Math.sin(i * 0.05));
    const buf = makeBuffer(samples);
    const out = applyHighPass(buf, HIGHPASS_PRESETS.rumble);
    expect(out.length).toBe(2048);
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("rumble (80 Hz) attenuates a 20 Hz sub-bass tone", () => {
    const buf = makeSine(20, 8192);
    const out = applyHighPass(buf, HIGHPASS_PRESETS.rumble);
    const dIn = buf.getChannelData(0);
    const dOut = out.getChannelData(0);
    const tailIn = dIn.subarray(4096);
    const tailOut = dOut.subarray(4096);
    expect(rms(tailIn)).toBeGreaterThan(0.5);
    expect(rms(tailOut)).toBeLessThan(rms(tailIn) * 0.7);
  });
});