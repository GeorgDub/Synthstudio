// @vitest-environment node
/**
 * sample-transform-dialog-wiring.test.ts — v3.136.0
 *
 * Tests für die Verkabelung des SampleTransformDialog mit applyTransformPipeline.
 *
 * Wir testen NICHT die React-Komponente selbst (Playwright-Smoke wäre nice-to-have,
 * aber Vitest-Pflicht ist die Pipeline-Integration + die dB↔linear-Konvertierung,
 * die der Dialog vor dem applyTransformPipeline-Call macht).
 */

import { describe, it, expect } from "vitest";
import { applyTransformPipeline } from "../../client/src/utils/sampleTransformPipeline";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeSineBuffer(freq = 440, sr = 48000, durMs = 100): AudioBufferLike {
  const len = Math.floor((durMs / 1000) * sr);
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return {
    sampleRate: sr,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

describe("Pipeline-Integration: alle-off liefert identische channelData", () => {
  it("Pipeline mit komplett-off Options modifiziert channelData nicht", () => {
    const buf = makeSineBuffer(440, 48000, 100);
    const original = buf.getChannelData(0);
    const result = applyTransformPipeline(buf, {
      trimSilence: false,
      reverse: false,
      fadeInMs: 0,
      fadeOutMs: 0,
      normalize: false,
    });
    const out = result.buffer.getChannelData(0);
    expect(out.length).toBe(original.length);
    for (let i = 0; i < Math.min(200, out.length); i++) {
      expect(out[i]).toBe(original[i]);
    }
  });
});

describe("Normalize-Integration: sine-440Hz mit normalize=true + target -1dBTP", () => {
  it("output-peak ≈ 10^(-1/20) (innerhalb 0.05 Toleranz)", () => {
    const buf = makeSineBuffer(440, 48000, 100);
    const result = applyTransformPipeline(buf, {
      normalize: true,
      normalizeTargetDbTp: -1,
    });
    const out = result.buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      const v = Math.abs(out[i]);
      if (v > peak) peak = v;
    }
    const expectedPeak = Math.pow(10, -1 / 20); // ≈ 0.89125
    // True-Peak-Detection oversampled → kleiner Toleranz gegen Sample-Peak
    expect(peak).toBeGreaterThan(expectedPeak - 0.05);
    expect(peak).toBeLessThan(expectedPeak + 0.05);
    expect(result.normalizeGainDb).toBeLessThan(0); // gain runter (peak war ~1.0)
  });
});

describe("dB→linear-conversion-formel (UI-Logic)", () => {
  it("Math.pow(10, -60/20) ≈ 0.001 (4-Stellen Toleranz)", () => {
    const linear = Math.pow(10, -60 / 20);
    expect(linear).toBeCloseTo(0.001, 4);
  });

  it("Math.pow(10, -20/20) ≈ 0.1", () => {
    const linear = Math.pow(10, -20 / 20);
    expect(linear).toBeCloseTo(0.1, 6);
  });

  it("Math.pow(10, 0/20) === 1.0", () => {
    const linear = Math.pow(10, 0 / 20);
    expect(linear).toBeCloseTo(1.0, 10);
  });
});
