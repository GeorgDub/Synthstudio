// @vitest-environment node
/**
 * sample-band-pass.test.ts - v3.201.0
 *
 * Tests fuer Band-Pass Pure-Helper (Cascade HighPass -> LowPass):
 *   - applyBandPass (top-level API)
 *   - BANDPASS_PRESETS shape + content
 *   - defensive defaults (NaN / Infinity / out-of-range)
 *   - sampleRate edge cases
 *   - multi-channel symmetry + immutability
 *
 * Pendant zu sample-low-pass.test.ts (v3.198) und sample-high-pass.test.ts
 * (v3.199).
 */

import { describe, it, expect } from "vitest";
import {
  applyBandPass,
  BANDPASS_PRESETS,
  DEFAULT_CENTER_HZ,
  DEFAULT_BANDWIDTH_HZ,
  DEFAULT_RESONANCE,
} from "../../client/src/utils/sampleBandPass";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

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

describe("v3.201 applyBandPass - basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer();
    const out = applyBandPass(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("empty options -> uses defaults (center=1000, bandwidth=500)", () => {
    const buf = makeBuffer([0, 0.5, 0.25, -0.1, 0.3]);
    const out = applyBandPass(buf, {});
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
    const a = applyBandPass(buf);
    const b = applyBandPass(buf, {});
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < 5; i++) expect(da[i]).toBeCloseTo(db[i], 10);
  });

  it("output length + numChannels + sampleRate preserved", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 44100);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    expect(out.length).toBe(6);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(44100);
  });
});

describe("v3.201 applyBandPass - filter behaviour", () => {
  it("DC (constant) settles to ~0 (band-pass kills DC)", () => {
    const buf = makeBuffer(new Array(4000).fill(0.5));
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    const d = out.getChannelData(0);
    expect(Math.abs(d[3500])).toBeLessThan(1e-3);
    expect(Math.abs(d[3999])).toBeLessThan(1e-3);
  });

  it("sub-band low frequency strongly attenuated", () => {
    const buf = makeSine(50, 8192);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    const tailIn = buf.getChannelData(0).subarray(4096);
    const tailOut = out.getChannelData(0).subarray(4096);
    expect(rms(tailIn)).toBeGreaterThan(0.5);
    expect(rms(tailOut)).toBeLessThan(rms(tailIn) * 0.5);
  });

  it("high frequency outside band attenuated (narrow band)", () => {
    const buf = makeSine(10000, 8192);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 200 });
    const tailIn = buf.getChannelData(0).subarray(4096);
    const tailOut = out.getChannelData(0).subarray(4096);
    expect(rms(tailIn)).toBeGreaterThan(0.5);
    expect(rms(tailOut)).toBeLessThan(rms(tailIn) * 0.5);
  });

  it("pass-band (1 kHz with center 1 kHz) preserves more energy than far-out band", () => {
    const buf = makeSine(1000, 8192);
    const inBand = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 1000 });
    const outOfBand = applyBandPass(buf, { centerHz: 100, bandwidthHz: 50 });
    const tIn = inBand.getChannelData(0).subarray(4096);
    const tOut = outOfBand.getChannelData(0).subarray(4096);
    expect(rms(tIn)).toBeGreaterThan(rms(tOut));
    expect(rms(tIn)).toBeGreaterThan(0.05);
  });

  it("resonance > 0 boosts output amplitude vs resonance=0 (same band)", () => {
    const buf = makeSine(1000, 4096);
    const r0 = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: 0 });
    const r1 = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: 1 });
    const tail0 = r0.getChannelData(0).subarray(2048);
    const tail1 = r1.getChannelData(0).subarray(2048);
    expect(rms(tail1)).toBeGreaterThan(rms(tail0));
  });

  it("resonance=0 leaves the plain band-passed output finite + sane", () => {
    const buf = makeBuffer([0, 1, -1, 0.5, -0.5, 0.25, -0.25]);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: 0 });
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      expect(Number.isFinite(d[i])).toBe(true);
    }
  });
});

describe("v3.201 applyBandPass - multi-channel", () => {
  it("multi-channel: shape preserved, each channel processed independently", () => {
    const ch0Buf = makeSine(1000, 2048);
    const ch1Buf = makeSine(50, 2048);
    const ch0 = Array.from(ch0Buf.getChannelData(0));
    const ch1 = Array.from(ch1Buf.getChannelData(0));
    const buf = makeMultiChannelBuffer([ch0, ch1]);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(2048);

    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    expect(rms(l.subarray(1024))).toBeGreaterThan(rms(r.subarray(1024)));
  });

  it("multi-channel symmetry: identical channels produce identical outputs", () => {
    const sineBuf = makeSine(1000, 1024);
    const vals = Array.from(sineBuf.getChannelData(0));
    const buf = makeMultiChannelBuffer([vals, vals]);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    for (let i = 0; i < l.length; i++) {
      expect(l[i]).toBeCloseTo(r[i], 10);
    }
  });

  it("multi-channel: out-of-range channel access throws RangeError", () => {
    const buf = makeMultiChannelBuffer([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    const out = applyBandPass(buf);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });

  it("input buffer is not mutated (precision=5)", () => {
    const original = [0.1, 0.2, 0.3, 0.4, 0.5, -0.1, -0.2, -0.3];
    const data = new Float32Array(original);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: 0.5 });
    for (let i = 0; i < original.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 5);
    }
  });
});

describe("v3.201 applyBandPass - defensive defaults", () => {
  it("NaN centerHz falls back to default 1000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const out = applyBandPass(buf, { centerHz: NaN });
    const ref = applyBandPass(buf, { centerHz: 1000 });
    const d = out.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("centerHz <= 0 falls back to default 1000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const ref = applyBandPass(buf, { centerHz: 1000 });
    const neg = applyBandPass(buf, { centerHz: -500 });
    const zero = applyBandPass(buf, { centerHz: 0 });
    const r = ref.getChannelData(0);
    const dN = neg.getChannelData(0);
    const dZ = zero.getChannelData(0);
    for (let i = 0; i < r.length; i++) {
      expect(dN[i]).toBeCloseTo(r[i], 10);
      expect(dZ[i]).toBeCloseTo(r[i], 10);
    }
  });

  it("Infinity centerHz falls back to default 1000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const inf = applyBandPass(buf, { centerHz: Infinity });
    const ref = applyBandPass(buf, { centerHz: 1000 });
    const d = inf.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("centerHz > Nyquist clamps to Nyquist", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const clamped = applyBandPass(buf, { centerHz: 100000, bandwidthHz: 500 });
    const ref = applyBandPass(buf, { centerHz: 24000, bandwidthHz: 500 });
    const d = clamped.getChannelData(0);
    const r = ref.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(r[i], 10);
  });

  it("NaN / Infinity bandwidthHz falls back to default 500", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const ref = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    const nan = applyBandPass(buf, { centerHz: 1000, bandwidthHz: NaN });
    const inf = applyBandPass(buf, { centerHz: 1000, bandwidthHz: Infinity });
    const r = ref.getChannelData(0);
    const dN = nan.getChannelData(0);
    const dI = inf.getChannelData(0);
    for (let i = 0; i < r.length; i++) {
      expect(dN[i]).toBeCloseTo(r[i], 10);
      expect(dI[i]).toBeCloseTo(r[i], 10);
    }
  });

  it("bandwidthHz <= 0 falls back to default 500", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const ref = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    const zero = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 0 });
    const neg = applyBandPass(buf, { centerHz: 1000, bandwidthHz: -100 });
    const r = ref.getChannelData(0);
    const dZ = zero.getChannelData(0);
    const dN = neg.getChannelData(0);
    for (let i = 0; i < r.length; i++) {
      expect(dZ[i]).toBeCloseTo(r[i], 10);
      expect(dN[i]).toBeCloseTo(r[i], 10);
    }
  });

  it("bandwidthHz < 10 clamps to minimum 10 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const tiny = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 1 });
    const min = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 10 });
    const dT = tiny.getChannelData(0);
    const dM = min.getChannelData(0);
    for (let i = 0; i < dT.length; i++) expect(dT[i]).toBeCloseTo(dM[i], 10);
  });

  it("bandwidthHz > Nyquist clamps to Nyquist", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const huge = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 100000 });
    const max = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 24000 });
    const dH = huge.getChannelData(0);
    const dM = max.getChannelData(0);
    for (let i = 0; i < dH.length; i++) expect(dH[i]).toBeCloseTo(dM[i], 10);
  });

  it("NaN / negative resonance falls back to 0 (no boost)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const ref = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: 0 });
    const nanRes = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: NaN });
    const negRes = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: -0.5 });
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
    const huge = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: 100 });
    const max = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500, resonance: 1 });
    const dH = huge.getChannelData(0);
    const dM = max.getChannelData(0);
    for (let i = 0; i < dH.length; i++) expect(dH[i]).toBeCloseTo(dM[i], 10);
  });

  it("default constants are exported with expected values", () => {
    expect(DEFAULT_CENTER_HZ).toBe(1000);
    expect(DEFAULT_BANDWIDTH_HZ).toBe(500);
    expect(DEFAULT_RESONANCE).toBe(0);
  });
});

describe("v3.201 applyBandPass - sampleRate edge cases", () => {
  it("handles sampleRate 8000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, -0.5, -0.3, 0.0], 8000);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    expect(out.length).toBe(8);
    expect(out.sampleRate).toBe(8000);
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("handles sampleRate 44100 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 44100);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    expect(out.length).toBe(5);
    expect(out.sampleRate).toBe(44100);
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("handles sampleRate 96000 Hz", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 96000);
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
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
    const out = applyBandPass(buf, { centerHz: 1000, bandwidthHz: 500 });
    expect(out.length).toBe(0);
    expect(out.getChannelData(0).length).toBe(0);
  });
});

describe("v3.201 BANDPASS_PRESETS", () => {
  it("has the four documented presets with positive center + bandwidth", () => {
    expect(BANDPASS_PRESETS.telephone.centerHz).toBe(1500);
    expect(BANDPASS_PRESETS.telephone.bandwidthHz).toBe(2000);
    expect(BANDPASS_PRESETS.vocalPresence.centerHz).toBe(3000);
    expect(BANDPASS_PRESETS.vocalPresence.bandwidthHz).toBe(2000);
    expect(BANDPASS_PRESETS.bass.centerHz).toBe(200);
    expect(BANDPASS_PRESETS.bass.bandwidthHz).toBe(200);
    expect(BANDPASS_PRESETS.resonant.centerHz).toBe(800);
    expect(BANDPASS_PRESETS.resonant.bandwidthHz).toBe(100);

    for (const key of ["telephone", "vocalPresence", "bass", "resonant"] as const) {
      const p = BANDPASS_PRESETS[key];
      expect(Number.isFinite(p.centerHz)).toBe(true);
      expect(Number.isFinite(p.bandwidthHz)).toBe(true);
      expect(p.centerHz).toBeGreaterThan(0);
      expect(p.bandwidthHz).toBeGreaterThan(0);
    }
  });

  it("applying a preset produces a valid finite output buffer", () => {
    const samples: number[] = [];
    for (let i = 0; i < 2048; i++) samples.push(Math.sin(i * 0.05));
    const buf = makeBuffer(samples);
    for (const key of ["telephone", "vocalPresence", "bass", "resonant"] as const) {
      const out = applyBandPass(buf, BANDPASS_PRESETS[key]);
      expect(out.length).toBe(2048);
      const d = out.getChannelData(0);
      for (let i = 0; i < d.length; i++) expect(Number.isFinite(d[i])).toBe(true);
    }
  });

  it("bass preset (200 Hz center) passes a 200 Hz sine more than a 5 kHz sine", () => {
    const low = makeSine(200, 8192);
    const hi = makeSine(5000, 8192);
    const lowOut = applyBandPass(low, BANDPASS_PRESETS.bass);
    const hiOut = applyBandPass(hi, BANDPASS_PRESETS.bass);
    const lowTail = lowOut.getChannelData(0).subarray(4096);
    const hiTail = hiOut.getChannelData(0).subarray(4096);
    expect(rms(lowTail)).toBeGreaterThan(rms(hiTail));
  });

  it("vocalPresence preset (3 kHz center) passes a 3 kHz sine more than a 50 Hz sine", () => {
    const vocal = makeSine(3000, 8192);
    const low = makeSine(50, 8192);
    const vOut = applyBandPass(vocal, BANDPASS_PRESETS.vocalPresence);
    const lOut = applyBandPass(low, BANDPASS_PRESETS.vocalPresence);
    const vTail = vOut.getChannelData(0).subarray(4096);
    const lTail = lOut.getChannelData(0).subarray(4096);
    expect(rms(vTail)).toBeGreaterThan(rms(lTail));
  });
});
