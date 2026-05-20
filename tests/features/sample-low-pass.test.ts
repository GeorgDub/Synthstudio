// @vitest-environment node
/**
 * sample-low-pass.test.ts — v3.198.0
 *
 * Tests fuer One-Pole-Lowpass Pure-Helper:
 *   - applyLowPass (top-level API)
 *   - LOWPASS_PRESETS shape + content
 *   - defensive defaults (NaN / Infinity / out-of-range)
 */

import { describe, it, expect } from 'vitest';
import {
  applyLowPass,
  LOWPASS_PRESETS,
  DEFAULT_CUTOFF_HZ,
  DEFAULT_RESONANCE,
} from '../../client/src/utils/sampleLowPass';
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

function rms(arr: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / arr.length);
}

// Tests

describe("v3.198 applyLowPass — basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer();
    const out = applyLowPass(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("empty options -> uses DEFAULT_CUTOFF_HZ (2000)", () => {
    const buf = makeBuffer([0, 0.5, 0.25, -0.1, 0.3]);
    const out = applyLowPass(buf, {});
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
    const a = applyLowPass(buf);
    const b = applyLowPass(buf, {});
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < 5; i++) expect(da[i]).toBeCloseTo(db[i], 10);
  });

  it("output length + numChannels + sampleRate preserved", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 44100);
    const out = applyLowPass(buf, { cutoffHz: 1000 });
    expect(out.length).toBe(6);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(44100);
  });
});

describe("v3.198 applyLowPass — filter behaviour", () => {
  it("low cutoff strongly attenuates high-frequency content", () => {
    const buf = makeNyquistSquare(512);
    const out = applyLowPass(buf, { cutoffHz: 200, resonance: 0 });
    const dIn = buf.getChannelData(0);
    const dOut = out.getChannelData(0);
    const rmsIn = rms(dIn);
    const rmsOut = rms(dOut);
    expect(rmsIn).toBeCloseTo(1, 3);
    expect(rmsOut).toBeLessThan(0.1);
  });

  it("very high cutoff (near Nyquist) is closer to identity than low cutoff", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2]);
    const lowCut = applyLowPass(buf, { cutoffHz: 50, resonance: 0 });
    const hiCut = applyLowPass(buf, { cutoffHz: 24000, resonance: 0 });
    const dIn = buf.getChannelData(0);
    const dLow = lowCut.getChannelData(0);
    const dHi = hiCut.getChannelData(0);

    let devLow = 0;
    let devHi = 0;
    for (let i = 0; i < dIn.length; i++) {
      devLow += Math.abs(dIn[i] - dLow[i]);
      devHi += Math.abs(dIn[i] - dHi[i]);
    }
    expect(devHi).toBeLessThan(devLow);
  });

  it("DC signal (constant) settles to constant value", () => {
    const buf = makeBuffer(new Array(2000).fill(0.5));
    const out = applyLowPass(buf, { cutoffHz: 1000, resonance: 0 });
    const d = out.getChannelData(0);
    expect(d[1500]).toBeCloseTo(0.5, 3);
    expect(d[1999]).toBeCloseTo(0.5, 3);
  });

  it("step response is monotonic-rising toward target (no overshoot)", () => {
    const samples = [...new Array(50).fill(0), ...new Array(500).fill(1)];
    const buf = makeBuffer(samples);
    const out = applyLowPass(buf, { cutoffHz: 500, resonance: 0 });
    const d = out.getChannelData(0);
    let prev = -Infinity;
    for (let i = 50; i < 250; i++) {
      expect(d[i]).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d[i];
    }
    expect(d[549]).toBeCloseTo(1, 3);
  });

  it("resonance > 0 increases output amplitude near cutoff vs resonance=0", () => {
    const length = 1024;
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
    const r0 = applyLowPass(buf, { cutoffHz: 1000, resonance: 0 });
    const r1 = applyLowPass(buf, { cutoffHz: 1000, resonance: 1 });
    const tail = (arr: Float32Array) => arr.subarray(512);
    expect(rms(tail(r1.getChannelData(0)))).toBeGreaterThan(
      rms(tail(r0.getChannelData(0))),
    );
  });
});

describe("v3.198 applyLowPass — multi-channel", () => {
  it("multi-channel: shape preserved, each channel processed independently", () => {
    const ch0 = new Array(256).fill(0).map((_, i) => (i % 2 === 0 ? 1 : -1));
    const ch1 = new Array(256).fill(0.5);
    const buf = makeMultiChannelBuffer([ch0, ch1]);
    const out = applyLowPass(buf, { cutoffHz: 200, resonance: 0 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(256);
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    expect(rms(l)).toBeLessThan(0.1);
    // R is DC=0.5 with 200 Hz cutoff @ 48k → slow settle. At 250 samples
    // the output is within ~1e-3 of 0.5 — use loose precision.
    expect(r[250]).toBeCloseTo(0.5, 2);
  });

  it("multi-channel: out-of-range channel access throws RangeError", () => {
    const buf = makeMultiChannelBuffer([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    const out = applyLowPass(buf);
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
    applyLowPass(buf, { cutoffHz: 500, resonance: 0.5 });
    // Float32 precision: values match within Float32 epsilon (~1.2e-7),
    // not double precision. Use precision=5 to allow Float32-roundtrip
    // delta while still catching real mutations.
    for (let i = 0; i < original.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 5);
    }
  });
});

describe("v3.198 applyLowPass — defensive defaults", () => {
  it("NaN cutoffHz falls back to default 2000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const out = applyLowPass(buf, { cutoffHz: NaN });
    const ref = applyLowPass(buf, { cutoffHz: 2000 });
    const d = out.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("cutoffHz <= 0 falls back to default 2000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const out = applyLowPass(buf, { cutoffHz: -500 });
    const ref = applyLowPass(buf, { cutoffHz: 2000 });
    const d = out.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);

    const out0 = applyLowPass(buf, { cutoffHz: 0 });
    const d0 = out0.getChannelData(0);
    for (let i = 0; i < d0.length; i++) expect(d0[i]).toBeCloseTo(r[i], 10);
  });

  it("cutoffHz > Nyquist clamps to Nyquist (sampleRate/2)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const clamped = applyLowPass(buf, { cutoffHz: 100000 });
    const ref = applyLowPass(buf, { cutoffHz: 24000 });
    const d = clamped.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("NaN / negative resonance falls back to 0 (no boost)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const ref = applyLowPass(buf, { cutoffHz: 1000, resonance: 0 });
    const nanRes = applyLowPass(buf, { cutoffHz: 1000, resonance: NaN });
    const negRes = applyLowPass(buf, { cutoffHz: 1000, resonance: -0.5 });
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
    const huge = applyLowPass(buf, { cutoffHz: 1000, resonance: 100 });
    const max = applyLowPass(buf, { cutoffHz: 1000, resonance: 1 });
    const dH = huge.getChannelData(0);
    const dM = max.getChannelData(0);
    for (let i = 0; i < dH.length; i++) expect(dH[i]).toBeCloseTo(dM[i], 10);
  });

  it("Infinity cutoffHz falls back to default 2000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const inf = applyLowPass(buf, { cutoffHz: Infinity });
    const ref = applyLowPass(buf, { cutoffHz: 2000 });
    const d = inf.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("default constants are exported with expected values", () => {
    expect(DEFAULT_CUTOFF_HZ).toBe(2000);
    expect(DEFAULT_RESONANCE).toBe(0);
  });
});

describe("v3.198 LOWPASS_PRESETS", () => {
  it("has 4 entries with correct shape", () => {
    expect(LOWPASS_PRESETS.length).toBe(4);
    for (const p of LOWPASS_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(Number.isFinite(p.cutoffHz)).toBe(true);
      expect(p.cutoffHz).toBeGreaterThan(0);
      expect(Number.isFinite(p.resonance)).toBe(true);
      expect(p.resonance).toBeGreaterThanOrEqual(0);
      expect(p.resonance).toBeLessThanOrEqual(1);
    }
    const ids = LOWPASS_PRESETS.map((p) => p.id);
    expect(ids).toContain("muffled");
    expect(ids).toContain("warm");
    expect(ids).toContain("bright");
    expect(ids).toContain("open");
  });

  it("preset cutoff frequencies match the spec (500/1500/5000/10000)", () => {
    const byId = Object.fromEntries(LOWPASS_PRESETS.map((p) => [p.id, p]));
    expect(byId.muffled.cutoffHz).toBe(500);
    expect(byId.warm.cutoffHz).toBe(1500);
    expect(byId.bright.cutoffHz).toBe(5000);
    expect(byId.open.cutoffHz).toBe(10000);
  });

  it("preset cutoffs are monotonically increasing (muffled < warm < bright < open)", () => {
    const order = ["muffled", "warm", "bright", "open"];
    const byId = Object.fromEntries(LOWPASS_PRESETS.map((p) => [p.id, p]));
    for (let i = 1; i < order.length; i++) {
      expect(byId[order[i]].cutoffHz).toBeGreaterThan(byId[order[i - 1]].cutoffHz);
    }
  });
});
