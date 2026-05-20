// @vitest-environment node
/**
 * sample-notch.test.ts - v3.229.0
 *
 * Tests fuer applyNotch + NOTCH_PRESETS aus client/src/utils/sampleNotch.ts.
 *
 * Aufbau analog sample-band-pass.test.ts (v3.201) / sample-high-pass.test.ts
 * (v3.199). Vitest node-environment, kein DOM-AudioBuffer benoetigt.
 */

import { describe, it, expect } from "vitest";
import {
  applyNotch,
  NOTCH_PRESETS,
  DEFAULT_FREQ_HZ,
  DEFAULT_Q,
  MIN_FREQ_HZ,
  MIN_Q,
  MAX_Q,
} from "../../client/src/utils/sampleNotch";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ----- Helpers ----------------------------------------------------------------

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

function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

// ----- Tests ------------------------------------------------------------------

describe("v3.229 applyNotch - basics", () => {
  it("empty buffer -> empty buffer with fallback sampleRate", () => {
    const empty = makeEmptyBuffer();
    const out = applyNotch(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("null buffer -> empty buffer with FALLBACK sample rate", () => {
    const out = applyNotch(null as unknown as AudioBufferLike);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("length / numChannels / sampleRate preserved", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 44100);
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    expect(out.length).toBe(6);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(44100);
  });

  it("undefined options behaves like {} (defaults)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const a = applyNotch(buf);
    const b = applyNotch(buf, {});
    const da = a.getChannelData(0);
    const db = b.getChannelData(0);
    for (let i = 0; i < da.length; i++) expect(da[i]).toBeCloseTo(db[i], 10);
  });
});

describe("v3.229 applyNotch - filter behaviour (DSP)", () => {
  it("frequency AT freqHz strongly attenuated (steady-state tail)", () => {
    const buf = makeSine(1000, 8192);
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    const tailIn = buf.getChannelData(0).subarray(4096);
    const tailOut = out.getChannelData(0).subarray(4096);
    expect(rms(tailIn)).toBeGreaterThan(0.5);
    // Notch at exact freq should kill the sine almost completely
    expect(rms(tailOut)).toBeLessThan(rms(tailIn) * 0.1);
  });

  it("frequency far from notch passes through (near-identity)", () => {
    // Notch at 50 Hz, signal at 4000 Hz -> should pass unchanged
    const buf = makeSine(4000, 8192);
    const out = applyNotch(buf, { freqHz: 50, q: 30 });
    const tailIn = buf.getChannelData(0).subarray(4096);
    const tailOut = out.getChannelData(0).subarray(4096);
    expect(rms(tailIn)).toBeGreaterThan(0.5);
    expect(rms(tailOut)).toBeGreaterThan(rms(tailIn) * 0.9);
  });

  it("DC passes through (notch does NOT kill DC at freqHz>0)", () => {
    const buf = makeBuffer(new Array(8192).fill(0.5));
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    // Steady-state DC gain should be ~1; check the tail
    const tail = out.getChannelData(0);
    expect(tail[8000]).toBeCloseTo(0.5, 3);
    expect(tail[8191]).toBeCloseTo(0.5, 3);
  });

  it("higher q -> narrower notch (less attenuation off-band)", () => {
    // Signal at 1100 Hz with notch at 1000 Hz
    // narrow notch (high q) should affect 1100 Hz less than wide notch (low q)
    const buf = makeSine(1100, 8192);
    const narrow = applyNotch(buf, { freqHz: 1000, q: 30 });
    const wide = applyNotch(buf, { freqHz: 1000, q: 1 });
    const rmsNarrow = rms(narrow.getChannelData(0).subarray(4096));
    const rmsWide = rms(wide.getChannelData(0).subarray(4096));
    expect(rmsNarrow).toBeGreaterThan(rmsWide);
  });

  it("output is finite for arbitrary musical input", () => {
    const buf = makeBuffer([0, 1, -1, 0.5, -0.5, 0.25, -0.25, 0.1, -0.1]);
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("v3.229 applyNotch - multi-channel", () => {
  it("multi-channel: each channel processed independently", () => {
    const ch0Buf = makeSine(1000, 2048);
    const ch1Buf = makeSine(4000, 2048);
    const ch0 = Array.from(ch0Buf.getChannelData(0));
    const ch1 = Array.from(ch1Buf.getChannelData(0));
    const buf = makeMultiChannelBuffer([ch0, ch1]);
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(2048);
    // Ch0 (1 kHz at notch) should have less RMS than Ch1 (4 kHz off-notch)
    const lRms = rms(out.getChannelData(0).subarray(1024));
    const rRms = rms(out.getChannelData(1).subarray(1024));
    expect(lRms).toBeLessThan(rRms);
  });

  it("multi-channel symmetry: identical inputs produce identical outputs", () => {
    const vals = Array.from(makeSine(1000, 1024).getChannelData(0));
    const buf = makeMultiChannelBuffer([vals, vals]);
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    for (let i = 0; i < l.length; i++) expect(l[i]).toBeCloseTo(r[i], 10);
  });

  it("RangeError for out-of-range channel access", () => {
    const buf = makeMultiChannelBuffer([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const out = applyNotch(buf);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });
});

describe("v3.229 applyNotch - immutability + length", () => {
  it("input buffer is not mutated", () => {
    const original = [0.1, 0.2, 0.3, 0.4, 0.5, -0.1, -0.2, -0.3];
    const data = new Float32Array(original);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    applyNotch(buf, { freqHz: 1000, q: 5 });
    for (let i = 0; i < original.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 6);
    }
  });

  it("output array is a fresh Float32Array (not aliased to input)", () => {
    const data = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    const outArr = out.getChannelData(0);
    expect(outArr).not.toBe(data);
    outArr[0] = 999;
    expect(data[0]).toBeCloseTo(0.1, 6);
  });

  it("length preserved across many sample rates", () => {
    const rates = [8000, 22050, 44100, 48000, 96000];
    for (const sr of rates) {
      const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], sr);
      const out = applyNotch(buf, { freqHz: 1000, q: 5 });
      expect(out.length).toBe(5);
      expect(out.sampleRate).toBe(sr);
      expect(allFinite(out.getChannelData(0))).toBe(true);
    }
  });
});

describe("v3.229 applyNotch - defensive defaults", () => {
  it("DEFAULT_FREQ_HZ + DEFAULT_Q constants exposed", () => {
    expect(DEFAULT_FREQ_HZ).toBe(1000);
    expect(DEFAULT_Q).toBe(5);
    expect(MIN_FREQ_HZ).toBe(10);
    expect(MIN_Q).toBeCloseTo(0.1, 10);
    expect(MAX_Q).toBe(50);
  });

  it("freqHz NaN -> default 1000", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const nan = applyNotch(buf, { freqHz: NaN });
    const ref = applyNotch(buf, { freqHz: 1000 });
    const dN = nan.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dN.length; i++) expect(dN[i]).toBeCloseTo(dR[i], 10);
  });

  it("freqHz < 10 -> default 1000", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const small = applyNotch(buf, { freqHz: 5 });
    const ref = applyNotch(buf, { freqHz: 1000 });
    const dS = small.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dS.length; i++) expect(dS[i]).toBeCloseTo(dR[i], 10);
  });

  it("freqHz > Nyquist -> clamped to Nyquist/2", () => {
    // sr=48000 -> Nyquist=24000 -> clamped to 12000
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const clamped = applyNotch(buf, { freqHz: 100000, q: 5 });
    const ref = applyNotch(buf, { freqHz: 12000, q: 5 });
    const dC = clamped.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dC.length; i++) expect(dC[i]).toBeCloseTo(dR[i], 10);
  });

  it("Infinity freqHz -> default 1000", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const inf = applyNotch(buf, { freqHz: Infinity });
    const ref = applyNotch(buf, { freqHz: 1000 });
    const dI = inf.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dI.length; i++) expect(dI[i]).toBeCloseTo(dR[i], 10);
  });

  it("q NaN -> default 5", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const nan = applyNotch(buf, { q: NaN });
    const ref = applyNotch(buf, { q: 5 });
    const dN = nan.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dN.length; i++) expect(dN[i]).toBeCloseTo(dR[i], 10);
  });

  it("q < 0.1 -> default 5", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const small = applyNotch(buf, { q: 0.05 });
    const ref = applyNotch(buf, { q: 5 });
    const dS = small.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dS.length; i++) expect(dS[i]).toBeCloseTo(dR[i], 10);
  });

  it("q > 50 -> clamp to 50", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const big = applyNotch(buf, { q: 1000 });
    const ref = applyNotch(buf, { q: 50 });
    const dB = big.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dB.length; i++) expect(dB[i]).toBeCloseTo(dR[i], 10);
  });

  it("Infinity q -> default 5 (non-finite)", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5]);
    const inf = applyNotch(buf, { q: Infinity });
    const ref = applyNotch(buf, { q: 5 });
    const dI = inf.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dI.length; i++) expect(dI[i]).toBeCloseTo(dR[i], 10);
  });

  it("freqHz NaN at degenerate sr=1500 -> default 1000 then nyquist-clamp to 375", () => {
    // sr=1500, Nyquist=750. Default 1000 > 750 -> clamp to 375.
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 1500);
    const out = applyNotch(buf, { freqHz: NaN, q: 5 });
    const ref = applyNotch(buf, { freqHz: 375, q: 5 }, );
    const dO = out.getChannelData(0);
    const dR = ref.getChannelData(0);
    for (let i = 0; i < dO.length; i++) expect(dO[i]).toBeCloseTo(dR[i], 10);
  });
});

describe("v3.229 NOTCH_PRESETS", () => {
  it("preset shape: contains hum50/hum60/midReject/presence", () => {
    expect(NOTCH_PRESETS.hum50).toEqual({ freqHz: 50, q: 30 });
    expect(NOTCH_PRESETS.hum60).toEqual({ freqHz: 60, q: 30 });
    expect(NOTCH_PRESETS.midReject).toEqual({ freqHz: 1000, q: 5 });
    expect(NOTCH_PRESETS.presence).toEqual({ freqHz: 3000, q: 8 });
  });

  it("all preset values are within sanitizer ranges", () => {
    for (const key of Object.keys(NOTCH_PRESETS)) {
      const p = NOTCH_PRESETS[key as keyof typeof NOTCH_PRESETS];
      expect(p.freqHz).toBeGreaterThanOrEqual(MIN_FREQ_HZ);
      expect(p.q).toBeGreaterThanOrEqual(MIN_Q);
      expect(p.q).toBeLessThanOrEqual(MAX_Q);
    }
  });

  it("hum50 preset effectively notches 50 Hz", () => {
    // hum50 uses q=30 (very narrow) which has a long IIR transient
    // (~q/freq seconds = ~0.6 s). Use 65536 samples (~1.37s) and analyze
    // the final third for steady-state.
    const buf = makeSine(50, 65536);
    const out = applyNotch(buf, NOTCH_PRESETS.hum50);
    const tailStart = (65536 * 2) / 3;
    const tailIn = buf.getChannelData(0).subarray(tailStart);
    const tailOut = out.getChannelData(0).subarray(tailStart);
    expect(rms(tailIn)).toBeGreaterThan(0.5);
    expect(rms(tailOut)).toBeLessThan(rms(tailIn) * 0.2);
  });

  it("midReject preset attenuates 1 kHz", () => {
    const buf = makeSine(1000, 8192);
    const out = applyNotch(buf, NOTCH_PRESETS.midReject);
    const tailIn = buf.getChannelData(0).subarray(4096);
    const tailOut = out.getChannelData(0).subarray(4096);
    expect(rms(tailOut)).toBeLessThan(rms(tailIn) * 0.2);
  });
});

describe("v3.229 applyNotch - output-finite stress", () => {
  it("extreme params (q=MIN, freqHz=MIN) produce finite output", () => {
    const buf = makeSine(440, 1024);
    const out = applyNotch(buf, { freqHz: MIN_FREQ_HZ, q: MIN_Q });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("extreme params (q=MAX, freqHz near Nyquist) produce finite output", () => {
    const buf = makeSine(440, 1024, 48000);
    const out = applyNotch(buf, { freqHz: 23000, q: MAX_Q });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("white-noise-ish input produces finite output", () => {
    const data: number[] = [];
    let seed = 12345;
    for (let i = 0; i < 4096; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data.push(((seed % 2000) - 1000) / 1000);
    }
    const buf = makeBuffer(data, 48000);
    const out = applyNotch(buf, { freqHz: 1000, q: 5 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});
