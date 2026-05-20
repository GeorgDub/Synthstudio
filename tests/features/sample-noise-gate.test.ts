// @vitest-environment node
/**
 * sample-noise-gate.test.ts — v3.186.0
 *
 * Tests fuer Noise-Gate Pure-Helper:
 *   - applyNoiseGate (top-level API)
 *   - NOISE_GATE_PRESETS shape + content
 *   - defensive defaults (NaN / invalid inputs)
 *
 * Verifikations-Strategie:
 *   - Empty / identity / silence -> direct array inspection
 *   - Attack/Release ramps -> monoton-increasing/decreasing check
 *   - Hysteresis interpreted as RELEASE-TIME hysteresis: a brief dip
 *     below threshold cannot fully drag coeff to 0 if release is long.
 */

import { describe, it, expect } from "vitest";
import {
  applyNoiseGate,
  NOISE_GATE_PRESETS,
  DEFAULT_THRESHOLD_DB,
  DEFAULT_ATTACK_MS,
  DEFAULT_RELEASE_MS,
  DEFAULT_HYSTERESIS_DB,
} from "../../client/src/utils/sampleNoiseGate";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeBuffer(
  values: number[],
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(values);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: values.length,
    getChannelData: () => data,
  };
}

function makeConstantBuffer(
  amplitude: number,
  length: number,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  data.fill(amplitude);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("v3.186 applyNoiseGate — basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer();
    const out = applyNoiseGate(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("all-loud (above threshold) -> identity (gate stays open)", () => {
    // Amplitude 0.5 is well above -40 dB threshold (-6 dBFS).
    // First sample envelope exceeds reopenLinear -> inits OPEN, coeff=1.
    const buf = makeConstantBuffer(0.5, 1000);
    const out = applyNoiseGate(buf);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(0.5, 6);
    }
  });

  it("all-silent (below threshold) -> all zeros (gate never opens)", () => {
    // Amplitude 0.0001 is below -40 threshold.
    // First sample envelope below reopenLinear -> inits CLOSED, coeff=0.
    const buf = makeConstantBuffer(0.0001, 1000);
    const out = applyNoiseGate(buf);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(0);
    }
  });

  it("mixed: loud parts kept, fully-silent parts gated (after release completes)", () => {
    // 500 loud (0.5) then 500 zero. With releaseMs=1 @ 48k, release
    // completes within ~48 samples, well before the 500-zero tail ends.
    const loud = new Array(500).fill(0.5);
    const silent = new Array(500).fill(0);
    const buf = makeBuffer([...loud, ...silent]);
    const out = applyNoiseGate(buf, {
      thresholdDb: -40,
      attackMs: 1,
      releaseMs: 1,
      hysteresisDb: 6,
    });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(0.5, 6);
    expect(data[250]).toBeCloseTo(0.5, 6);
    expect(data[900]).toBe(0);
    expect(data[999]).toBe(0);
  });

  it("thresholdDb=0 -> all gated (nothing exceeds full-scale)", () => {
    // Amplitude 0.99 is just below 0 dBFS. Strict > comparator means
    // envelope=0.99 does NOT exceed reopenLinear (about 1.995), so
    // gate stays closed.
    const buf = makeConstantBuffer(0.99, 500);
    const out = applyNoiseGate(buf, {
      thresholdDb: 0,
      attackMs: 1,
      releaseMs: 1,
      hysteresisDb: 6,
    });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(0);
    }
  });
});

describe("v3.186 applyNoiseGate — ramps", () => {
  it("attack ramp: gate opens gradually after silence -> loud transition", () => {
    // 100 silent then 500 loud. attackMs=20 @ 48k = 960 samples, ramp
    // is slower than the loud section so we observe a monotonic-rising
    // region.
    const samples = [
      ...new Array(100).fill(0),
      ...new Array(500).fill(0.5),
    ];
    const buf = makeBuffer(samples);
    const out = applyNoiseGate(buf, {
      thresholdDb: -40,
      attackMs: 20,
      releaseMs: 50,
      hysteresisDb: 6,
    });
    const data = out.getChannelData(0);

    for (let i = 0; i < 100; i++) expect(data[i]).toBe(0);

    expect(data[110]).toBeGreaterThan(0);
    expect(data[200]).toBeGreaterThan(data[110]);
    expect(data[300]).toBeGreaterThan(data[200]);
    expect(data[400]).toBeGreaterThan(data[300]);
  });

  it("release ramp: gate closes gradually after loud -> sub-threshold transition", () => {
    // Use a small non-zero tail so we can observe the coeff ramp through
    // multiplication (input * coeff). Pure-zero input would mask the ramp.
    const samples2 = [
      ...new Array(100).fill(0.5),
      ...new Array(500).fill(0.0001),
    ];
    const buf2 = makeBuffer(samples2);
    const out2 = applyNoiseGate(buf2, {
      thresholdDb: -40,
      attackMs: 1,
      releaseMs: 20,
      hysteresisDb: 6,
    });
    const d2 = out2.getChannelData(0);
    // In the tail, coeff ramps 1 -> 0; input is constant 0.0001;
    // output decays monotonically.
    expect(d2[110]).toBeGreaterThan(d2[200]);
    expect(d2[200]).toBeGreaterThan(d2[400]);
    expect(d2[599]).toBeLessThan(d2[110]);
  });
});

describe("v3.186 applyNoiseGate — hysteresis (release-time)", () => {
  it("brief dip below threshold during long release does not drag coeff to 0", () => {
    // Setup: long release (50ms @ 48k = 2400 samples). After loud,
    // a brief 10-sample dip below threshold cannot drag coeff to 0 —
    // release-step over 10 samples is only ~0.004. Output returns
    // immediately to ~0.5 when signal returns above reopen.
    const samples = [
      ...new Array(200).fill(0.5),    // gate open
      ...new Array(10).fill(0.0001),  // brief dip
      ...new Array(200).fill(0.5),    // back loud
    ];
    const buf = makeBuffer(samples);
    const out = applyNoiseGate(buf, {
      thresholdDb: -40,
      attackMs: 0.1,
      releaseMs: 50,
      hysteresisDb: 6,
    });
    const data = out.getChannelData(0);

    expect(data[100]).toBeCloseTo(0.5, 3);

    // Post-dip output near 0.5 -> coeff stayed close to 1 through dip.
    const postDipIdx = 215;
    expect(data[postDipIdx]).toBeGreaterThan(0.45);
  });
});

describe("v3.186 applyNoiseGate — multi-channel", () => {
  it("multi-channel: shape preserved, each channel processed independently", () => {
    const buf = makeMultiChannelBuffer([
      [0.5, 0.5, 0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5, 0.5],
    ]);
    const out = applyNoiseGate(buf);
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(5);
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    expect(l.length).toBe(5);
    expect(r.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(l[i]).toBeCloseTo(0.5, 6);
      expect(r[i]).toBeCloseTo(0.5, 6);
    }
  });

  it("multi-channel: out-of-range channel access throws RangeError", () => {
    const buf = makeMultiChannelBuffer([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    const out = applyNoiseGate(buf);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });
});

describe("v3.186 NOISE_GATE_PRESETS", () => {
  it("has 4 entries with correct shape", () => {
    expect(NOISE_GATE_PRESETS.length).toBe(4);
    for (const p of NOISE_GATE_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(Number.isFinite(p.thresholdDb)).toBe(true);
      expect(Number.isFinite(p.attackMs)).toBe(true);
      expect(p.attackMs).toBeGreaterThan(0);
      expect(Number.isFinite(p.releaseMs)).toBe(true);
      expect(p.releaseMs).toBeGreaterThan(0);
    }
    const ids = NOISE_GATE_PRESETS.map((p) => p.id);
    expect(ids).toContain("vocal");
    expect(ids).toContain("drums");
    expect(ids).toContain("ambient");
    expect(ids).toContain("tight");
  });
});

describe("v3.186 applyNoiseGate — defensive defaults", () => {
  it("NaN inputs fall back to defaults", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const out = applyNoiseGate(buf, {
      thresholdDb: NaN,
      attackMs: NaN,
      releaseMs: NaN,
      hysteresisDb: NaN,
    });
    expect(out.length).toBe(100);
    const data = out.getChannelData(0);
    expect(data[50]).toBeCloseTo(0.5, 6);
  });

  it("zero / negative attack and release fall back to 1ms (no divide-by-zero, no infinite ramp)", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const out = applyNoiseGate(buf, {
      thresholdDb: -40,
      attackMs: 0,
      releaseMs: -5,
      hysteresisDb: 6,
    });
    expect(out.length).toBe(100);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
    expect(data[50]).toBeCloseTo(0.5, 6);
  });

  it("default constants are exported and have expected values", () => {
    expect(DEFAULT_THRESHOLD_DB).toBe(-40);
    expect(DEFAULT_ATTACK_MS).toBe(5);
    expect(DEFAULT_RELEASE_MS).toBe(50);
    expect(DEFAULT_HYSTERESIS_DB).toBe(6);
  });
});
