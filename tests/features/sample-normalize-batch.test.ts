// @vitest-environment node
/**
 * sample-normalize-batch.test.ts — v3.171.0
 * Tests für batchNormalizeSamples (Pure-Helper).
 */

import { describe, it, expect } from "vitest";
import { batchNormalizeSamples } from "../../client/src/utils/sampleNormalizeBatch";
import { analyzeSamplePeak } from "../../client/src/utils/sampleAutoNormalize";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Test-Helpers ────────────────────────────────────────────────────────────

function makeSineBuffer(peakLinear: number, sampleRate = 48000, samples = 512): AudioBufferLike {
  const data = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    data[i] = Math.sin((i / samples) * 2 * Math.PI) * peakLinear;
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples,
    getChannelData: () => data,
  };
}

function makeSilentBuffer(samples = 32): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate: 48000,
    numberOfChannels: 1,
    length: samples,
    getChannelData: () => data,
  };
}

// ─── 1. empty inputs ─────────────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — empty inputs", () => {
  it("empty array → empty entries + defaults", () => {
    const result = batchNormalizeSamples([]);
    expect(result.entries).toEqual([]);
    expect(result.loudestOriginalDbTp).toBe(-Infinity);
    expect(result.quietestOriginalDbTp).toBe(Infinity);
    expect(result.effectiveTargetDbTp).toBe(-1);
    expect(result.cappedCount).toBe(0);
  });

  it("custom target dBTP wird in effectiveTargetDbTp gespiegelt auch ohne inputs", () => {
    const result = batchNormalizeSamples([], { targetDbTp: -3 });
    expect(result.effectiveTargetDbTp).toBe(-3);
  });
});

// ─── 2. uniform-peak Mode ────────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — uniform-peak mode", () => {
  it("single sample wird auf target gebracht", () => {
    // Peak 0.5 ≈ -6 dBFS, target -1
    const input = { id: "s1", buffer: makeSineBuffer(0.5) };
    const result = batchNormalizeSamples([input], { mode: "uniform-peak", targetDbTp: -1 });
    const entry = result.entries[0];
    // Resultierender Peak sollte nahe -1 dBTP liegen
    const peakAfter = analyzeSamplePeak(entry.buffer).peakDbTp;
    expect(peakAfter).toBeCloseTo(-1, 0); // 1 dB Toleranz
    expect(result.cappedCount).toBe(0);
  });

  it("multi-sample → alle Peaks landen nahe Target (innerhalb 1 dB)", () => {
    const inputs = [
      { id: "a", buffer: makeSineBuffer(0.8) },
      { id: "b", buffer: makeSineBuffer(0.3) },
      { id: "c", buffer: makeSineBuffer(0.5) },
    ];
    const result = batchNormalizeSamples(inputs, { mode: "uniform-peak", targetDbTp: -3 });
    for (const e of result.entries) {
      const peakAfter = analyzeSamplePeak(e.buffer).peakDbTp;
      expect(Math.abs(peakAfter - (-3))).toBeLessThanOrEqual(1);
    }
  });

  it("default mode ohne option → uniform-peak verhalten", () => {
    const input = { id: "x", buffer: makeSineBuffer(0.5) };
    const result = batchNormalizeSamples([input]);
    expect(result.effectiveTargetDbTp).toBe(-1);
    // gainAppliedDb sollte positiv (Boost)
    expect(result.entries[0].gainAppliedDb).toBeGreaterThan(0);
  });
});

// ─── 3. match-loudest Mode ───────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — match-loudest mode", () => {
  it("lautestes Sample hat gainAppliedDb = 0", () => {
    const inputs = [
      { id: "loud", buffer: makeSineBuffer(0.8) },
      { id: "quiet", buffer: makeSineBuffer(0.2) },
    ];
    const result = batchNormalizeSamples(inputs, { mode: "match-loudest" });
    // effectiveTarget = loudest
    expect(result.effectiveTargetDbTp).toBe(result.loudestOriginalDbTp);
    const loudEntry = result.entries.find((e) => e.id === "loud")!;
    expect(loudEntry.gainAppliedDb).toBeCloseTo(0, 5);
  });

  it("leiseres Sample wird hochgezogen (gain > 0)", () => {
    const inputs = [
      { id: "loud", buffer: makeSineBuffer(0.9) },
      { id: "quiet", buffer: makeSineBuffer(0.1) },
    ];
    const result = batchNormalizeSamples(inputs, { mode: "match-loudest" });
    const quietEntry = result.entries.find((e) => e.id === "quiet")!;
    expect(quietEntry.gainAppliedDb).toBeGreaterThan(10); // ca. 19 dB Boost erwartbar
  });
});

// ─── 4. relative-mix Mode ────────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — relative-mix mode", () => {
  it("alle audible Samples haben dieselbe gainAppliedDb", () => {
    const inputs = [
      { id: "a", buffer: makeSineBuffer(0.8) },
      { id: "b", buffer: makeSineBuffer(0.4) },
      { id: "c", buffer: makeSineBuffer(0.2) },
    ];
    const result = batchNormalizeSamples(inputs, { mode: "relative-mix", targetDbTp: -1 });
    const first = result.entries[0].gainAppliedDb;
    for (const e of result.entries) {
      expect(Math.abs(e.gainAppliedDb - first)).toBeLessThan(0.01);
    }
  });

  it("relative-mix: lautestes Sample landet nahe Target", () => {
    const inputs = [
      { id: "loud", buffer: makeSineBuffer(0.5) },
      { id: "quiet", buffer: makeSineBuffer(0.1) },
    ];
    const result = batchNormalizeSamples(inputs, { mode: "relative-mix", targetDbTp: -1 });
    const loudEntry = result.entries.find((e) => e.id === "loud")!;
    const peakAfter = analyzeSamplePeak(loudEntry.buffer).peakDbTp;
    expect(Math.abs(peakAfter - (-1))).toBeLessThanOrEqual(1);
  });
});

// ─── 5. maxBoostDb Cap ───────────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — maxBoostDb cap", () => {
  it("extrem leises Sample wird auf maxBoostDb gecappt", () => {
    // Peak 0.005 ≈ -46 dBFS. Mit target -1 wäre Boost ~+45 dB.
    const inputs = [{ id: "veryQuiet", buffer: makeSineBuffer(0.005) }];
    const result = batchNormalizeSamples(inputs, {
      mode: "uniform-peak",
      targetDbTp: -1,
      maxBoostDb: 12,
    });
    expect(result.entries[0].gainAppliedDb).toBe(12);
    expect(result.cappedCount).toBe(1);
  });

  it("nicht alle Samples werden gecappt — nur die mit gain > maxBoostDb", () => {
    const inputs = [
      { id: "loud", buffer: makeSineBuffer(0.8) }, // braucht wenig boost
      { id: "low", buffer: makeSineBuffer(0.01) }, // braucht viel
    ];
    const result = batchNormalizeSamples(inputs, {
      mode: "uniform-peak",
      targetDbTp: -1,
      maxBoostDb: 6,
    });
    expect(result.cappedCount).toBe(1);
    const lowEntry = result.entries.find((e) => e.id === "low")!;
    expect(lowEntry.gainAppliedDb).toBe(6);
  });

  it("maxBoostDb < 0 wird auf 0 geclampt", () => {
    const inputs = [{ id: "any", buffer: makeSineBuffer(0.1) }];
    const result = batchNormalizeSamples(inputs, {
      mode: "uniform-peak",
      maxBoostDb: -5,
    });
    // gain darf nicht > 0 sein (cap auf 0 → kein Boost)
    expect(result.entries[0].gainAppliedDb).toBeLessThanOrEqual(0);
  });
});

// ─── 6. Silent Inputs ────────────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — silent inputs", () => {
  it("silent sample → gainAppliedDb = 0 (no-op pass-through)", () => {
    const inputs = [
      { id: "silent", buffer: makeSilentBuffer() },
      { id: "audible", buffer: makeSineBuffer(0.5) },
    ];
    const result = batchNormalizeSamples(inputs);
    const silentEntry = result.entries.find((e) => e.id === "silent")!;
    expect(silentEntry.gainAppliedDb).toBe(0);
    expect(silentEntry.buffer).toBe(inputs[0].buffer); // same reference (pass-through)
  });

  it("all-silent inputs → loudest=-Infinity, quietest=Infinity, all gain=0", () => {
    const inputs = [
      { id: "s1", buffer: makeSilentBuffer() },
      { id: "s2", buffer: makeSilentBuffer() },
    ];
    const result = batchNormalizeSamples(inputs);
    expect(result.loudestOriginalDbTp).toBe(-Infinity);
    expect(result.quietestOriginalDbTp).toBe(Infinity);
    for (const e of result.entries) {
      expect(e.gainAppliedDb).toBe(0);
    }
  });

  it("match-loudest mit allen silent → keine Crashes, alle gain=0", () => {
    const inputs = [
      { id: "s1", buffer: makeSilentBuffer() },
      { id: "s2", buffer: makeSilentBuffer() },
    ];
    const result = batchNormalizeSamples(inputs, { mode: "match-loudest" });
    for (const e of result.entries) {
      expect(e.gainAppliedDb).toBe(0);
    }
    expect(result.cappedCount).toBe(0);
  });

  it("relative-mix mit allen silent → kein +Infinity-Disaster, alle gain=0", () => {
    const inputs = [{ id: "s", buffer: makeSilentBuffer() }];
    const result = batchNormalizeSamples(inputs, { mode: "relative-mix" });
    expect(result.entries[0].gainAppliedDb).toBe(0);
    expect(Number.isFinite(result.entries[0].gainAppliedDb)).toBe(true);
  });
});

// ─── 7. Loudest/Quietest Reporting ───────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — loudest/quietest reporting", () => {
  it("loudestOriginalDbTp + quietestOriginalDbTp matchen die Inputs", () => {
    const inputs = [
      { id: "a", buffer: makeSineBuffer(0.9) },
      { id: "b", buffer: makeSineBuffer(0.3) },
      { id: "c", buffer: makeSineBuffer(0.1) },
    ];
    const result = batchNormalizeSamples(inputs);
    // Loudest sollte nahe sample-peak von 0.9 (≈ -0.9 dBFS) sein
    const analysisA = analyzeSamplePeak(inputs[0].buffer);
    const analysisC = analyzeSamplePeak(inputs[2].buffer);
    expect(result.loudestOriginalDbTp).toBeCloseTo(analysisA.peakDbTp, 5);
    expect(result.quietestOriginalDbTp).toBeCloseTo(analysisC.peakDbTp, 5);
  });
});

// ─── 8. Defensive Inputs ─────────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — defensive", () => {
  it("targetDbTp = NaN → fällt auf -1 zurück", () => {
    const inputs = [{ id: "x", buffer: makeSineBuffer(0.5) }];
    const result = batchNormalizeSamples(inputs, {
      mode: "uniform-peak",
      targetDbTp: NaN,
    });
    expect(result.effectiveTargetDbTp).toBe(-1);
  });

  it("mode invalid → default 'uniform-peak'", () => {
    const inputs = [{ id: "x", buffer: makeSineBuffer(0.5) }];
    const result = batchNormalizeSamples(inputs, {
      // @ts-expect-error — intentional invalid mode
      mode: "garbage",
      targetDbTp: -1,
    });
    // uniform-peak: jedes Sample auf target
    const peakAfter = analyzeSamplePeak(result.entries[0].buffer).peakDbTp;
    expect(Math.abs(peakAfter - (-1))).toBeLessThanOrEqual(1);
  });

  it("targetDbTp = +Infinity → fällt auf -1 zurück", () => {
    const inputs = [{ id: "x", buffer: makeSineBuffer(0.5) }];
    const result = batchNormalizeSamples(inputs, {
      mode: "uniform-peak",
      targetDbTp: Infinity,
    });
    expect(result.effectiveTargetDbTp).toBe(-1);
  });
});

// ─── 9. Immutability ─────────────────────────────────────────────────────────

describe("v3.171 batchNormalizeSamples — immutability", () => {
  it("input buffer wird nicht mutiert", () => {
    const buf = makeSineBuffer(0.5);
    const originalSample = buf.getChannelData(0)[10];
    const result = batchNormalizeSamples([{ id: "x", buffer: buf }]);
    const afterSample = buf.getChannelData(0)[10];
    expect(afterSample).toBe(originalSample);
    // result.entries[0].buffer ist eine neue Instanz (oder same bei gain=0)
    expect(result.entries[0].buffer).not.toBe(buf);
  });
});
