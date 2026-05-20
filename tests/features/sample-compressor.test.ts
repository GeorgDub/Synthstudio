// @vitest-environment node
/**
 * sample-compressor.test.ts — v3.188.0
 *
 * Tests fuer Sample-Compressor Pure-Helper:
 *   - applyCompressor (top-level API)
 *   - COMPRESSOR_PRESETS shape + content
 *   - defensive defaults (NaN / invalid inputs)
 *
 * Verifikations-Strategie:
 *   - Empty / silence -> direct array inspection
 *   - Above/below-threshold behaviour -> compare to identity (no compression)
 *   - Ratio comparison -> verify higher ratio -> more reduction at same level
 *   - Attack/Release ramps -> monotonic envelope buildup / decay
 *   - Limiter preset -> hard-knee path (knee=0) with very fast attack
 *   - Multi-channel -> independent envelope per channel
 */

import { describe, it, expect } from "vitest";
import {
  applyCompressor,
  COMPRESSOR_PRESETS,
  DEFAULT_THRESHOLD_DB,
  DEFAULT_RATIO,
  DEFAULT_ATTACK_MS,
  DEFAULT_RELEASE_MS,
  DEFAULT_KNEE_DB,
  DEFAULT_MAKEUP_GAIN_DB,
} from "../../client/src/utils/sampleCompressor";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeBuffer(values: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(values);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: values.length,
    getChannelData: () => data,
  };
}

function makeConstantBuffer(amplitude: number, length: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(length);
  data.fill(amplitude);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeMultiChannelBuffer(channelArrays: number[][], sampleRate = 48000): AudioBufferLike {
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("v3.188 applyCompressor — basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer();
    const out = applyCompressor(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("all-silence -> all-silence (no output amplification of zero)", () => {
    const buf = makeConstantBuffer(0, 500);
    const out = applyCompressor(buf, {
      thresholdDb: -18,
      ratio: 4,
      attackMs: 5,
      releaseMs: 100,
      kneeDb: 0,
      makeupGainDb: 12, // even with makeup, zero stays zero
    });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(0);
    }
  });

  it("signal below threshold (with hard knee) -> identical (no compression)", () => {
    // 0.05 ≈ -26 dBFS, well below threshold -24 dB. With kneeDb=0 and
    // makeupGainDb=0 there is zero reduction and zero gain change.
    const buf = makeConstantBuffer(0.05, 500);
    const out = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 4,
      attackMs: 5,
      releaseMs: 100,
      kneeDb: 0,
      makeupGainDb: 0,
    });
    const data = out.getChannelData(0);
    // After attack settles (>240 samples @ 48k for 5ms), output ≈ input.
    for (let i = 300; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(0.05, 5);
    }
  });
});

describe("v3.188 applyCompressor — gain reduction", () => {
  it("signal above threshold -> reduced amplitude", () => {
    // 0.5 ≈ -6 dBFS, well above threshold -24 dB. Should be reduced.
    const buf = makeConstantBuffer(0.5, 4000);
    const out = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 4,
      attackMs: 1,
      releaseMs: 100,
      kneeDb: 0,
      makeupGainDb: 0,
    });
    const data = out.getChannelData(0);
    // Steady-state (well past attack): output strictly less than 0.5.
    expect(Math.abs(data[3500])).toBeLessThan(0.5);
    expect(Math.abs(data[3500])).toBeGreaterThan(0);
  });

  it("higher ratio -> more compression at same input level", () => {
    const buf = makeConstantBuffer(0.5, 4000);
    const lowRatio = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 2,
      attackMs: 1,
      releaseMs: 100,
      kneeDb: 0,
      makeupGainDb: 0,
    }).getChannelData(0);
    const highRatio = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 10,
      attackMs: 1,
      releaseMs: 100,
      kneeDb: 0,
      makeupGainDb: 0,
    }).getChannelData(0);
    // Steady-state: high-ratio output amplitude < low-ratio output amplitude.
    expect(Math.abs(highRatio[3500])).toBeLessThan(Math.abs(lowRatio[3500]));
  });

  it("makeup-gain boosts output", () => {
    // Same compression with and without makeup. Sub-threshold input where
    // gain-reduction is exactly 0 -> output differs purely by makeup gain.
    const buf = makeConstantBuffer(0.05, 500);
    const noMakeup = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 4,
      attackMs: 1,
      releaseMs: 100,
      kneeDb: 0,
      makeupGainDb: 0,
    }).getChannelData(0);
    const withMakeup = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 4,
      attackMs: 1,
      releaseMs: 100,
      kneeDb: 0,
      makeupGainDb: 6, // +6 dB ≈ 2x
    }).getChannelData(0);
    // Below threshold -> reduction is 0 -> ratio of outputs ≈ 10^(6/20)≈1.995.
    const ratio = Math.abs(withMakeup[400]) / Math.abs(noMakeup[400]);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });
});

describe("v3.188 applyCompressor — envelope dynamics", () => {
  it("attack ramp: gain reduction develops over time (output decays toward steady-state)", () => {
    // Signal jumps from silent to loud at sample 100. With slow attack
    // (50ms), the gain-reduction envelope rises gradually -> output
    // amplitude DECREASES over the attack period.
    const samples = [
      ...new Array(100).fill(0),
      ...new Array(4000).fill(0.5),
    ];
    const buf = makeBuffer(samples);
    const out = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 8,
      attackMs: 50,
      releaseMs: 200,
      kneeDb: 0,
      makeupGainDb: 0,
    });
    const data = out.getChannelData(0);
    // Early in the loud section: gain reduction is small -> high output.
    // Later: gain reduction has settled higher -> lower output.
    const earlyAbs = Math.abs(data[110]);
    const midAbs = Math.abs(data[500]);
    const lateAbs = Math.abs(data[3900]);
    expect(earlyAbs).toBeGreaterThan(midAbs);
    expect(midAbs).toBeGreaterThan(lateAbs);
  });

  it("release ramp: gain reduction releases gradually after loud -> sub-threshold transition", () => {
    // Loud section settles GR-envelope high. Then jump to a small-but-nonzero
    // amplitude well below threshold. As envelope decays (releaseMs=200), the
    // applied gain rises -> output amplitude RISES monotonically.
    const samples = [
      ...new Array(2000).fill(0.5),     // loud — establish GR
      ...new Array(10000).fill(0.02),   // small signal -> target GR ≈ 0
    ];
    const buf = makeBuffer(samples);
    const out = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 8,
      attackMs: 1,
      releaseMs: 200,
      kneeDb: 0,
      makeupGainDb: 0,
    });
    const data = out.getChannelData(0);
    // Envelope is still high right after transition -> output very small.
    // Later, envelope has released -> output rises monotonically.
    const earlyAbs = Math.abs(data[2050]);
    const midAbs = Math.abs(data[5000]);
    const lateAbs = Math.abs(data[11500]);
    expect(midAbs).toBeGreaterThan(earlyAbs);
    expect(lateAbs).toBeGreaterThan(midAbs);
    // After ~1 time-constant of release the output has clearly recovered
    // from its initial ducked state — release is observably progressing.
    expect(lateAbs).toBeGreaterThan(earlyAbs * 2);
  });
});

describe("v3.188 applyCompressor — limiter preset", () => {
  it("Limiter preset: very fast attack, hard ratio, knee=0 (no divide-by-zero)", () => {
    const limiter = COMPRESSOR_PRESETS.find((p) => p.id === "limiter")!;
    expect(limiter.kneeDb).toBe(0);
    expect(limiter.ratio).toBeGreaterThanOrEqual(20);
    expect(limiter.attackMs).toBeLessThan(1);

    // Signal at ~-0.18 dBFS — clearly above limiter threshold -1.
    // (0.85 would be -1.41 dBFS, below the -1 threshold — wouldn't trigger.)
    const inputAmp = 0.98;
    const buf = makeConstantBuffer(inputAmp, 4000);
    const out = applyCompressor(buf, limiter);
    const data = out.getChannelData(0);
    // All samples finite (no NaN/Infinity from divide-by-zero).
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
    // Steady-state: reduced — strictly smaller than input.
    expect(Math.abs(data[3900])).toBeLessThan(inputAmp);
    expect(Math.abs(data[3900])).toBeGreaterThan(0);
  });
});

describe("v3.188 applyCompressor — multi-channel", () => {
  it("multi-channel: shape preserved, each channel processed independently", () => {
    // Channel 0 loud, channel 1 quiet. With threshold -24 and ratio 4,
    // channel 0 gets compressed; channel 1 stays untouched.
    const loudCh = new Array(4000).fill(0.5);
    const quietCh = new Array(4000).fill(0.02);
    const buf = makeMultiChannelBuffer([loudCh, quietCh]);
    const out = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 4,
      attackMs: 1,
      releaseMs: 50,
      kneeDb: 0,
      makeupGainDb: 0,
    });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(4000);
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    // Channel 0 compressed -> steady-state amplitude < 0.5.
    expect(Math.abs(l[3900])).toBeLessThan(0.5);
    // Channel 1 below threshold -> stays close to 0.02 (independent envelope!).
    expect(Math.abs(r[3900])).toBeCloseTo(0.02, 4);
  });

  it("multi-channel: out-of-range channel access throws RangeError", () => {
    const buf = makeMultiChannelBuffer([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    const out = applyCompressor(buf);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });
});

describe("v3.188 COMPRESSOR_PRESETS", () => {
  it("has 4 entries with correct shape and ids", () => {
    expect(COMPRESSOR_PRESETS.length).toBe(4);
    for (const p of COMPRESSOR_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(Number.isFinite(p.thresholdDb)).toBe(true);
      expect(Number.isFinite(p.ratio)).toBe(true);
      expect(p.ratio).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(p.attackMs)).toBe(true);
      expect(p.attackMs).toBeGreaterThan(0);
      expect(Number.isFinite(p.releaseMs)).toBe(true);
      expect(p.releaseMs).toBeGreaterThan(0);
      expect(Number.isFinite(p.kneeDb)).toBe(true);
      expect(p.kneeDb).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(p.makeupGainDb)).toBe(true);
    }
    const ids = COMPRESSOR_PRESETS.map((p) => p.id);
    expect(ids).toContain("soft");
    expect(ids).toContain("vocal");
    expect(ids).toContain("drum-bus");
    expect(ids).toContain("limiter");
  });
});

describe("v3.188 applyCompressor — defensive defaults", () => {
  it("NaN inputs fall back to defaults (no NaN propagation in output)", () => {
    const buf = makeConstantBuffer(0.1, 500);
    const out = applyCompressor(buf, {
      thresholdDb: NaN,
      ratio: NaN,
      attackMs: NaN,
      releaseMs: NaN,
      kneeDb: NaN,
      makeupGainDb: NaN,
    });
    expect(out.length).toBe(500);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
  });

  it("ratio<1 clamped to 1 (no expansion), invalid attack/release -> small positive", () => {
    const buf = makeConstantBuffer(0.5, 500);
    const out = applyCompressor(buf, {
      thresholdDb: -24,
      ratio: 0.5, // clamped to 1 -> zero reduction
      attackMs: 0,
      releaseMs: -10,
      kneeDb: 0,
      makeupGainDb: 0,
    });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
    // With ratio=1 effectively, output ≈ input (slope = 1 - 1/1 = 0 -> no GR).
    expect(Math.abs(data[400])).toBeCloseTo(0.5, 5);
  });

  it("default constants are exported and have expected values", () => {
    expect(DEFAULT_THRESHOLD_DB).toBe(-18);
    expect(DEFAULT_RATIO).toBe(4);
    expect(DEFAULT_ATTACK_MS).toBe(5);
    expect(DEFAULT_RELEASE_MS).toBe(100);
    expect(DEFAULT_KNEE_DB).toBe(6);
    expect(DEFAULT_MAKEUP_GAIN_DB).toBe(0);
  });
});
