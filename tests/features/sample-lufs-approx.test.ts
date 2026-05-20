// @vitest-environment node
/**
 * sample-lufs-approx.test.ts v3.182.0
 * Pure-Coverage fuer sampleLufsApprox (LUFS Integrated Loudness Approx).
 *
 * NB: LUFS-Werte sind Approximationen (BS.1770-4 simplified) — Toleranz ±3 dB.
 */

import { describe, it, expect } from "vitest";
import {
  computeLufsApprox,
  getKWeightingCoeffs,
  DEFAULT_BLOCK_SIZE_SEC,
  DEFAULT_OVERLAP,
  DEFAULT_ABSOLUTE_GATE_DB,
  DEFAULT_RELATIVE_GATE_DB,
} from "../../client/src/utils/sampleLufsApprox";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeEmptyBuffer(): AudioBufferLike {
  const data = new Float32Array(0);
  return {
    sampleRate: 48000,
    numberOfChannels: 1,
    length: 0,
    getChannelData: () => data,
  };
}

function makeSilentBuffer(durationSec: number, sampleRate = 48000): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(length);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeConstantBuffer(value: number, durationSec: number, sampleRate = 48000): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(length).fill(value);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeSineBuffer(
  freq: number,
  amp: number,
  durationSec: number,
  sampleRate = 48000,
): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeStereoSineBuffer(
  freqL: number,
  ampL: number,
  freqR: number,
  ampR: number,
  durationSec: number,
  sampleRate = 48000,
): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = ampL * Math.sin((2 * Math.PI * freqL * i) / sampleRate);
    right[i] = ampR * Math.sin((2 * Math.PI * freqR * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 2,
    length,
    getChannelData: (ch: number) => (ch === 0 ? left : right),
  };
}

function makeShortBuffer(): AudioBufferLike {
  // < 400 ms → no full block possible at default block size (48000*0.4 = 19200)
  const length = 4800; // 100 ms @ 48k
  const data = new Float32Array(length).fill(0.5);
  return {
    sampleRate: 48000,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("computeLufsApprox — basic / edge cases", () => {
  it("empty buffer → -Infinity LUFS, 0 blocks", () => {
    const r = computeLufsApprox(makeEmptyBuffer());
    expect(r.integratedLufs).toBe(-Infinity);
    expect(r.passedBlocks).toBe(0);
    expect(r.totalBlocks).toBe(0);
    expect(r.truePeakDbFS).toBe(-Infinity);
  });

  it("silence → -Infinity LUFS, 0 passedBlocks, truePeak -Infinity", () => {
    const r = computeLufsApprox(makeSilentBuffer(2));
    expect(r.integratedLufs).toBe(-Infinity);
    expect(r.passedBlocks).toBe(0);
    expect(r.truePeakDbFS).toBe(-Infinity);
    // totalBlocks may still be > 0 (we scanned blocks, they just all had ms <= 0)
    expect(r.totalBlocks).toBeGreaterThan(0);
  });

  it("constant DC=0.5 → K-weighting removes DC, but transient leaks → finite low LUFS or -Infinity", () => {
    const r = computeLufsApprox(makeConstantBuffer(0.5, 2));
    // After RLB HP @38Hz, DC is heavily attenuated. Result is either -Infinity
    // (all blocks below -70 LUFS abs-gate) or finite but very low.
    // truePeak captures the raw 0.5: 20*log10(0.5) ≈ -6.02 dBFS.
    expect(r.truePeakDbFS).toBeGreaterThan(-10);
    expect(r.truePeakDbFS).toBeLessThan(-4);
    // The integrated value is either -Infinity (all gated) or far below 0 LUFS.
    expect(r.integratedLufs).toBeLessThan(-30);
  });

  it("very short buffer (< 400ms) → totalBlocks 0, integrated -Infinity, truePeak still measured", () => {
    const r = computeLufsApprox(makeShortBuffer());
    expect(r.totalBlocks).toBe(0);
    expect(r.passedBlocks).toBe(0);
    expect(r.integratedLufs).toBe(-Infinity);
    // truePeak is computed on raw mono so we still see 0.5 → ≈ -6 dBFS
    expect(r.truePeakDbFS).toBeGreaterThan(-10);
    expect(r.truePeakDbFS).toBeLessThan(-4);
  });
});

describe("computeLufsApprox — sine signals", () => {
  it("sine 1kHz amp=1.0 (digital full-scale) → LUFS near 0 (≈ -3.7 LUFS ± 3 dB)", () => {
    // sin² avg = 0.5 → -0.691 + 10*log10(0.5) ≈ -3.7 LUFS (before K-weighting).
    // K-weighting at 1 kHz is approx 0 dB → expect roughly -3.7 LUFS ± 3.
    const r = computeLufsApprox(makeSineBuffer(1000, 1.0, 2));
    expect(r.integratedLufs).toBeGreaterThan(-7);
    expect(r.integratedLufs).toBeLessThan(1);
    expect(r.passedBlocks).toBeGreaterThan(0);
    // True peak ≈ 0 dBFS for amp=1
    expect(r.truePeakDbFS).toBeGreaterThan(-1);
    expect(r.truePeakDbFS).toBeLessThanOrEqual(0);
  });

  it("quieter sine amp=0.1 → LUFS roughly -23.7 ± 3 dB", () => {
    // ms = 0.005 → -0.691 + 10*log10(0.005) ≈ -23.7 LUFS.
    const r = computeLufsApprox(makeSineBuffer(1000, 0.1, 2));
    expect(r.integratedLufs).toBeGreaterThan(-27);
    expect(r.integratedLufs).toBeLessThan(-19);
    expect(r.passedBlocks).toBeGreaterThan(0);
  });

  it("quieter sine LUFS < louder sine LUFS (monotonicity)", () => {
    const loud = computeLufsApprox(makeSineBuffer(1000, 1.0, 2));
    const quiet = computeLufsApprox(makeSineBuffer(1000, 0.1, 2));
    expect(quiet.integratedLufs).toBeLessThan(loud.integratedLufs);
    expect(quiet.truePeakDbFS).toBeLessThan(loud.truePeakDbFS);
  });
});

describe("computeLufsApprox — peak + stereo", () => {
  it("truePeak entspricht 20*log10(max abs amplitude)", () => {
    const amp = 0.5;
    const r = computeLufsApprox(makeSineBuffer(1000, amp, 2));
    const expected = 20 * Math.log10(amp);
    // Float-tolerance: ±0.5 dB
    expect(r.truePeakDbFS).toBeGreaterThan(expected - 0.5);
    expect(r.truePeakDbFS).toBeLessThan(expected + 0.5);
  });

  it("stereo (L=1.0, R=0.0) — mono-downmix averages → quieter than pure L=1.0 mono", () => {
    const stereo = computeLufsApprox(
      makeStereoSineBuffer(1000, 1.0, 1000, 0.0, 2),
    );
    const mono = computeLufsApprox(makeSineBuffer(1000, 1.0, 2));
    // Mono-downmix halves the amplitude → ~6 dB quieter
    expect(stereo.integratedLufs).toBeLessThan(mono.integratedLufs);
    expect(stereo.passedBlocks).toBeGreaterThan(0);
  });
});

describe("getKWeightingCoeffs", () => {
  it("returns valid coefficient arrays (length 3 each)", () => {
    const c = getKWeightingCoeffs(48000);
    expect(c.preFilter.b.length).toBe(3);
    expect(c.preFilter.a.length).toBe(3);
    expect(c.rlbFilter.b.length).toBe(3);
    expect(c.rlbFilter.a.length).toBe(3);
    // a[0] must be 1 (normalized form)
    expect(c.preFilter.a[0]).toBe(1);
    expect(c.rlbFilter.a[0]).toBe(1);
    // All coefficients must be finite numbers
    for (const v of [...c.preFilter.b, ...c.preFilter.a, ...c.rlbFilter.b, ...c.rlbFilter.a]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("returns same coefficients regardless of sampleRate (48k approximation)", () => {
    const c48 = getKWeightingCoeffs(48000);
    const c44 = getKWeightingCoeffs(44100);
    expect(c44.preFilter.b).toEqual(c48.preFilter.b);
    expect(c44.rlbFilter.a).toEqual(c48.rlbFilter.a);
  });
});

describe("computeLufsApprox — options + defensive defaults", () => {
  it("invalid options fall back to defaults (NaN/negative)", () => {
    const sine = makeSineBuffer(1000, 0.5, 2);
    const refResult = computeLufsApprox(sine);
    const withBadOpts = computeLufsApprox(sine, {
      blockSizeSec: NaN,
      overlap: NaN,
      absoluteGateDb: NaN,
      relativeGateDb: NaN,
    });
    // Both runs should yield same integrated LUFS (defaults applied)
    expect(withBadOpts.integratedLufs).toBeCloseTo(refResult.integratedLufs, 5);
    expect(withBadOpts.totalBlocks).toBe(refResult.totalBlocks);

    // blockSizeSec=-1 → default 0.4; overlap=-0.5 → clamped to 0 (not default).
    // Different hop → slightly different integrated value (float-accum), but
    // should be very close (< 0.5 dB diff) since signal is stationary.
    const negOpts = computeLufsApprox(sine, {
      blockSizeSec: -1,
      overlap: -0.5,
    });
    expect(Math.abs(negOpts.integratedLufs - refResult.integratedLufs)).toBeLessThan(0.5);
  });

  it("overlap clamped at 0.99 (no infinite loop, hop ≥ 1)", () => {
    const r = computeLufsApprox(makeSineBuffer(1000, 0.5, 2), { overlap: 5 });
    // Should not hang; result must be finite for a loud sine
    expect(Number.isFinite(r.integratedLufs)).toBe(true);
    expect(r.totalBlocks).toBeGreaterThan(0);
  });

  it("result has all expected fields with valid shapes", () => {
    const r = computeLufsApprox(makeSineBuffer(1000, 0.5, 2));
    expect(typeof r.integratedLufs).toBe("number");
    expect(typeof r.passedBlocks).toBe("number");
    expect(typeof r.totalBlocks).toBe("number");
    expect(typeof r.truePeakDbFS).toBe("number");
    expect(r.passedBlocks).toBeGreaterThanOrEqual(0);
    expect(r.totalBlocks).toBeGreaterThanOrEqual(r.passedBlocks);
  });

  it("relativeGate = -Infinity → no relative gating, more or equal blocks pass", () => {
    const sine = makeSineBuffer(1000, 0.5, 2);
    const rDefault = computeLufsApprox(sine);
    const rNoRel = computeLufsApprox(sine, { relativeGateDb: -Infinity });
    // Without relative gate, all abs-passed blocks make it through
    expect(rNoRel.passedBlocks).toBeGreaterThanOrEqual(rDefault.passedBlocks);
    // Result still finite
    expect(Number.isFinite(rNoRel.integratedLufs)).toBe(true);
  });

  it("exposes named constants for defaults", () => {
    expect(DEFAULT_BLOCK_SIZE_SEC).toBe(0.4);
    expect(DEFAULT_OVERLAP).toBe(0.75);
    expect(DEFAULT_ABSOLUTE_GATE_DB).toBe(-70);
    expect(DEFAULT_RELATIVE_GATE_DB).toBe(-10);
  });
});
