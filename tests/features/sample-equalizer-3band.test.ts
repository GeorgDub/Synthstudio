// @vitest-environment node
/**
 * sample-equalizer-3band.test.ts — v3.181.0
 *
 * Tests für 3-Band Parametric EQ Pure-Helpers:
 *   - applyEqualizer3Band (top-level API)
 *   - peakingEqCoeffs / lowShelfCoeffs / highShelfCoeffs (Biquad-Coeff-Builder)
 *
 * Verifikations-Strategie:
 *   - Empty / Identity / Sanity-Checks via direct array inspection
 *   - Frequenz-spezifische Boost/Cut via Sine-Wave + Peak-Amplitude-Vergleich
 *     (Steady-State nach ~10ms; nur die zweite Hälfte des Buffers gemessen,
 *      um Filter-Einschwing-Transienten zu eliminieren)
 */

import { describe, it, expect } from "vitest";
import {
  applyEqualizer3Band,
  peakingEqCoeffs,
  lowShelfCoeffs,
  highShelfCoeffs,
  DEFAULT_Q,
  DEFAULT_LOW_FREQ,
  DEFAULT_MID_FREQ,
  DEFAULT_HIGH_FREQ,
} from "../../client/src/utils/sampleEqualizer3Band";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeSineBuffer(
  freq: number,
  durationSec: number,
  sampleRate = 48000,
  channels = 1,
): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    channelData.push(data);
  }
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: (c: number) => channelData[c],
  };
}

function peakAmplitude(buffer: AudioBufferLike, fromIndex = 0): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = fromIndex; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function makeEmptyBuffer(channels = 1, sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: channels,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("v3.181 applyEqualizer3Band — basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer(1);
    const out = applyEqualizer3Band(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
  });

  it("all-zero gains -> identity (output equals input)", () => {
    const buf = makeSineBuffer(440, 0.05);
    const out = applyEqualizer3Band(buf, {
      low: { freq: 200, gainDb: 0 },
      mid: { freq: 1000, gainDb: 0, q: DEFAULT_Q },
      high: { freq: 5000, gainDb: 0 },
    });
    const inData = buf.getChannelData(0);
    const outData = out.getChannelData(0);
    expect(outData.length).toBe(inData.length);
    // Identity bypass: bit-genau (Float32-Kopie)
    for (let i = 0; i < inData.length; i++) {
      expect(outData[i]).toBeCloseTo(inData[i], 6);
    }
  });

  it("output has same length as input", () => {
    const buf = makeSineBuffer(1000, 0.1);
    const out = applyEqualizer3Band(buf, { mid: { freq: 1000, gainDb: 6 } });
    expect(out.length).toBe(buf.length);
    expect(out.getChannelData(0).length).toBe(buf.length);
  });

  it("multi-channel buffer -> all channels processed", () => {
    const stereo = makeSineBuffer(1000, 0.05, 48000, 2);
    const out = applyEqualizer3Band(stereo, { mid: { freq: 1000, gainDb: 6 } });
    expect(out.numberOfChannels).toBe(2);
    // Beide channels haben dieselbe Sinus-Quelle und denselben Filter ->
    // Output beider Channels muss identisch sein.
    const left = out.getChannelData(0);
    const right = out.getChannelData(1);
    expect(left.length).toBe(right.length);
    for (let i = 0; i < left.length; i++) {
      expect(left[i]).toBeCloseTo(right[i], 6);
    }
  });

  it("default options (kein options-arg) -> identity", () => {
    const buf = makeSineBuffer(440, 0.05);
    const out = applyEqualizer3Band(buf);
    const inData = buf.getChannelData(0);
    const outData = out.getChannelData(0);
    for (let i = 0; i < inData.length; i++) {
      expect(outData[i]).toBeCloseTo(inData[i], 6);
    }
  });
});

describe("v3.181 applyEqualizer3Band — frequency-domain behavior", () => {
  it("low-shelf boost +12dB lifts low-frequency sine (100Hz)", () => {
    // 100Hz Sinus, low-shelf bei 200Hz +12dB
    const buf = makeSineBuffer(100, 0.1);
    const out = applyEqualizer3Band(buf, { low: { freq: 200, gainDb: 12 } });
    // Steady-State-Messung: zweite Hälfte des Buffers
    const half = Math.floor(buf.length / 2);
    const inputPeak = peakAmplitude(buf, half);
    const outputPeak = peakAmplitude(out, half);
    // +12dB -> ~4x Amplitude; konservativ erwarten wir > 2x
    expect(outputPeak).toBeGreaterThan(inputPeak * 2);
  });

  it("high-shelf cut -12dB attenuates high-frequency sine (8000Hz)", () => {
    const buf = makeSineBuffer(8000, 0.1);
    const out = applyEqualizer3Band(buf, { high: { freq: 5000, gainDb: -12 } });
    const half = Math.floor(buf.length / 2);
    const inputPeak = peakAmplitude(buf, half);
    const outputPeak = peakAmplitude(out, half);
    // -12dB -> ~0.25x; konservativ < 0.6
    expect(outputPeak).toBeLessThan(inputPeak * 0.6);
  });

  it("mid-peak boost +12dB at 1kHz lifts 1kHz sine", () => {
    const buf = makeSineBuffer(1000, 0.1);
    const out = applyEqualizer3Band(buf, {
      mid: { freq: 1000, gainDb: 12, q: 1.0 },
    });
    const half = Math.floor(buf.length / 2);
    const inputPeak = peakAmplitude(buf, half);
    const outputPeak = peakAmplitude(out, half);
    // Bei der Peak-Frequenz ist Gain ≈ 10^(12/20) = ~4x; > 2x ist sicher
    expect(outputPeak).toBeGreaterThan(inputPeak * 2);
  });

  it("mid-peak cut -12dB at 1kHz attenuates 1kHz sine", () => {
    const buf = makeSineBuffer(1000, 0.1);
    const out = applyEqualizer3Band(buf, {
      mid: { freq: 1000, gainDb: -12, q: 1.0 },
    });
    const half = Math.floor(buf.length / 2);
    const inputPeak = peakAmplitude(buf, half);
    const outputPeak = peakAmplitude(out, half);
    expect(outputPeak).toBeLessThan(inputPeak * 0.6);
  });

  it("low-shelf does not significantly affect high-frequency sine", () => {
    // 8000Hz Sinus mit low-shelf +12dB bei 200Hz -> 8kHz weit über shelf
    const buf = makeSineBuffer(8000, 0.1);
    const out = applyEqualizer3Band(buf, { low: { freq: 200, gainDb: 12 } });
    const half = Math.floor(buf.length / 2);
    const inputPeak = peakAmplitude(buf, half);
    const outputPeak = peakAmplitude(out, half);
    // Erwartung: minimaler Einfluss; output ≈ input ±20%
    expect(outputPeak).toBeGreaterThan(inputPeak * 0.7);
    expect(outputPeak).toBeLessThan(inputPeak * 1.3);
  });
});

describe("v3.181 biquad coefficient builders", () => {
  it("peakingEqCoeffs returns 6 finite numbers", () => {
    const c = peakingEqCoeffs(1000, 0.707, 6, 48000);
    expect(Number.isFinite(c.b0)).toBe(true);
    expect(Number.isFinite(c.b1)).toBe(true);
    expect(Number.isFinite(c.b2)).toBe(true);
    expect(Number.isFinite(c.a0)).toBe(true);
    expect(Number.isFinite(c.a1)).toBe(true);
    expect(Number.isFinite(c.a2)).toBe(true);
  });

  it("peakingEqCoeffs gainDb=0 -> b0/a0 == 1 (pass-through ratio)", () => {
    // Bei gainDb=0 ist A=1, also b0 = 1+alpha, a0 = 1+alpha -> b0/a0 == 1.
    // b1 == a1 und b2 == a2 -> Filter ist identity.
    const c = peakingEqCoeffs(1000, 0.707, 0, 48000);
    expect(c.b0 / c.a0).toBeCloseTo(1, 6);
    expect(c.b1).toBeCloseTo(c.a1, 6);
    expect(c.b2).toBeCloseTo(c.a2, 6);
  });

  it("lowShelfCoeffs gainDb=0 -> identity-like filter (b/a ratio constant)", () => {
    // Bei gainDb=0 ist A=1, sqrt(A)=1: alle Bs werden gleich den As mit A=1.
    // Konkret: b0 = (1+1) - 0 + 2*alpha = 2 + 2*alpha; a0 = 2 + 2*alpha -> b0/a0=1.
    const c = lowShelfCoeffs(200, 0, 48000);
    expect(c.b0 / c.a0).toBeCloseTo(1, 6);
    expect(c.b1 / c.a0).toBeCloseTo(c.a1 / c.a0, 6);
    expect(c.b2 / c.a0).toBeCloseTo(c.a2 / c.a0, 6);
  });

  it("highShelfCoeffs gainDb=0 -> identity-like filter", () => {
    const c = highShelfCoeffs(5000, 0, 48000);
    expect(c.b0 / c.a0).toBeCloseTo(1, 6);
    expect(c.b1 / c.a0).toBeCloseTo(c.a1 / c.a0, 6);
    expect(c.b2 / c.a0).toBeCloseTo(c.a2 / c.a0, 6);
  });

  it("peakingEqCoeffs all coeffs finite for extreme params", () => {
    const c = peakingEqCoeffs(20, 10, 24, 48000);
    expect(Number.isFinite(c.b0)).toBe(true);
    expect(Number.isFinite(c.a0)).toBe(true);
    const c2 = peakingEqCoeffs(20000, 0.1, -24, 48000);
    expect(Number.isFinite(c2.b0)).toBe(true);
    expect(Number.isFinite(c2.a0)).toBe(true);
  });
});

describe("v3.181 defensive defaults", () => {
  it("gainDb NaN -> fallback 0 (bypass, identity output)", () => {
    const buf = makeSineBuffer(440, 0.05);
    const out = applyEqualizer3Band(buf, {
      mid: { freq: 1000, gainDb: NaN, q: 0.707 },
    });
    const inData = buf.getChannelData(0);
    const outData = out.getChannelData(0);
    // gainDb NaN -> sanitize zu 0 -> bypass -> identity
    for (let i = 0; i < inData.length; i++) {
      expect(outData[i]).toBeCloseTo(inData[i], 5);
    }
  });

  it("negative freq -> fallback 1000 (coeffs trotzdem finite)", () => {
    const c = peakingEqCoeffs(-100, 0.707, 6, 48000);
    expect(Number.isFinite(c.b0)).toBe(true);
    expect(Number.isFinite(c.a0)).toBe(true);
    // Verify es ist äquivalent zu 1000Hz coeffs
    const ref = peakingEqCoeffs(1000, 0.707, 6, 48000);
    expect(c.b0).toBeCloseTo(ref.b0, 6);
    expect(c.a0).toBeCloseTo(ref.a0, 6);
  });

  it("Q NaN / <=0 -> fallback 0.707", () => {
    const c = peakingEqCoeffs(1000, NaN, 6, 48000);
    const ref = peakingEqCoeffs(1000, DEFAULT_Q, 6, 48000);
    expect(c.b0).toBeCloseTo(ref.b0, 6);
    expect(c.a0).toBeCloseTo(ref.a0, 6);

    const c2 = peakingEqCoeffs(1000, -5, 6, 48000);
    expect(c2.b0).toBeCloseTo(ref.b0, 6);
    expect(c2.a0).toBeCloseTo(ref.a0, 6);
  });

  it("undefined Q in mid-band -> uses DEFAULT_Q", () => {
    const buf = makeSineBuffer(1000, 0.05);
    // Two runs should be identical
    const a = applyEqualizer3Band(buf, { mid: { freq: 1000, gainDb: 6 } });
    const b = applyEqualizer3Band(buf, {
      mid: { freq: 1000, gainDb: 6, q: DEFAULT_Q },
    });
    const dataA = a.getChannelData(0);
    const dataB = b.getChannelData(0);
    for (let i = 0; i < dataA.length; i++) {
      expect(dataA[i]).toBeCloseTo(dataB[i], 6);
    }
  });

  it("default constants are sane", () => {
    expect(DEFAULT_Q).toBeGreaterThan(0);
    expect(DEFAULT_LOW_FREQ).toBe(200);
    expect(DEFAULT_MID_FREQ).toBe(1000);
    expect(DEFAULT_HIGH_FREQ).toBe(5000);
  });

  it("output does not mutate input buffer", () => {
    const buf = makeSineBuffer(1000, 0.05);
    const inData = buf.getChannelData(0);
    const inputSnapshot = new Float32Array(inData);
    applyEqualizer3Band(buf, { mid: { freq: 1000, gainDb: 12 } });
    // Input data still intact
    for (let i = 0; i < inData.length; i++) {
      expect(inData[i]).toBeCloseTo(inputSnapshot[i], 6);
    }
  });
});

describe("v3.181 sequential band processing", () => {
  it("all 3 bands active -> finite, length-preserving output", () => {
    const buf = makeSineBuffer(1000, 0.05);
    const out = applyEqualizer3Band(buf, {
      low: { freq: 200, gainDb: 3 },
      mid: { freq: 1000, gainDb: -3, q: 1.0 },
      high: { freq: 5000, gainDb: 3 },
    });
    expect(out.length).toBe(buf.length);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
  });

  it("only high-shelf active -> low frequency unaffected", () => {
    const buf = makeSineBuffer(100, 0.1);
    const out = applyEqualizer3Band(buf, { high: { freq: 5000, gainDb: 12 } });
    const half = Math.floor(buf.length / 2);
    const inputPeak = peakAmplitude(buf, half);
    const outputPeak = peakAmplitude(out, half);
    // 100Hz sine + high-shelf @ 5kHz: minimal change
    expect(outputPeak).toBeGreaterThan(inputPeak * 0.7);
    expect(outputPeak).toBeLessThan(inputPeak * 1.3);
  });
});
