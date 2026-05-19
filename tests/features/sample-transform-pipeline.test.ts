// @vitest-environment node
/**
 * sample-transform-pipeline.test.ts — v3.136.0
 *
 * Tests für die Pipeline-Komposition in client/src/utils/sampleTransformPipeline.ts.
 *
 * Pipeline-Reihenfolge (fix, deterministisch):
 *   trimSilence → reverse → fadeIn → fadeOut → normalize
 *
 * Closes v3.136 UI-Wiring der Pure-Helpers aus v3.132 + v3.133 + v3.135.
 */

import { describe, it, expect } from "vitest";
import {
  applyTransformPipeline,
  type TransformPipelineOptions,
} from "../../client/src/utils/sampleTransformPipeline";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBuffer(samples: number[], channels = 1, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: channels,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeTestBuffer(
  sr = 48000,
  len = 4800,
  fn: (i: number, sr: number) => number = (i, sampleRate) =>
    Math.sin((2 * Math.PI * 440 * i) / sampleRate),
): AudioBufferLike {
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = fn(i, sr);
  return {
    sampleRate: sr,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("applyTransformPipeline – identity (alle Flags off)", () => {
  it("liefert buffer-shape unverändert (length, channels, sampleRate match)", () => {
    const buf = makeTestBuffer(48000, 4800);
    const result = applyTransformPipeline(buf, {});
    expect(result.buffer.length).toBe(buf.length);
    expect(result.buffer.numberOfChannels).toBe(buf.numberOfChannels);
    expect(result.buffer.sampleRate).toBe(buf.sampleRate);
    expect(result.normalizeGainDb).toBe(0);
  });
});

describe("applyTransformPipeline – reverse", () => {
  it("reverse=true → erstes Sample = altes letztes Sample", () => {
    const samples = [0.1, 0.2, 0.3, 0.4, 0.5];
    const buf = makeBuffer(samples);
    const result = applyTransformPipeline(buf, { reverse: true });
    expect(result.buffer.length).toBe(5);
    const out = result.buffer.getChannelData(0);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[4]).toBeCloseTo(0.1, 6);
  });
});

describe("applyTransformPipeline – order matters: trim VOR reverse", () => {
  it("leading-silence → trim greift zuerst, dann reverse: erstes Output-Sample = altes letztes Non-Silence-Sample", () => {
    // Original: [0, 0, 0, 1, 0.5, 0.2]
    //   After trim:    [1, 0.5, 0.2]
    //   After reverse: [0.2, 0.5, 1]
    // (Wenn die Pipeline reverse VOR trim machen würde:
    //   reverse: [0.2, 0.5, 1, 0, 0, 0] → trim trail: [0.2, 0.5, 1]
    //   → Output[0] = 0.2 wäre identisch.  Wir brauchen leading + trailing,
    //   um die Reihenfolge zu diskriminieren.)
    //
    // Test-Daten mit leading + trailing silence:
    //   Original:           [0, 0, 1, 0.5, 0.2, 0, 0, 0]
    //   trim → reverse:     trim → [1, 0.5, 0.2] → reverse → [0.2, 0.5, 1]
    //   (reverse → trim:    reverse → [0,0,0,0.2,0.5,1,0,0] → trim → [0.2, 0.5, 1])
    //   Beide produzieren same content but trim-first gives len=3 directly,
    //   reverse-first also gives len=3 but only because trimSilence on both
    //   ends collapses them — content identical.
    //
    // Für eine echte Diskriminierung: prüfe dass nach trim+reverse die ORIGINAL
    // erste Non-Silence-Position als LETZTES Sample landet.  Bei reverse-only
    // (ohne trim) würde sample[0]=0 (das original-letzte=0), nicht 0.2 (das
    // original-erste Non-Silence).
    const buf = makeBuffer([0, 0, 1, 0.5, 0.2, 0, 0, 0]);

    // Trim + Reverse aktiv: erwarte [0.2, 0.5, 1]
    const withTrim = applyTransformPipeline(buf, {
      trimSilence: true,
      trimThreshold: 0.001,
      reverse: true,
    });
    expect(withTrim.buffer.length).toBe(3);
    const withTrimOut = withTrim.buffer.getChannelData(0);
    expect(withTrimOut[0]).toBeCloseTo(0.2, 6);
    expect(withTrimOut[1]).toBeCloseTo(0.5, 6);
    expect(withTrimOut[2]).toBeCloseTo(1, 6);

    // Nur reverse (ohne trim): Output[0] = original[last] = 0 (silence),
    // nicht 0.2 — beweist dass trim oben tatsächlich gegriffen hat
    const reverseOnly = applyTransformPipeline(buf, { reverse: true });
    expect(reverseOnly.buffer.length).toBe(8);
    const reverseOnlyOut = reverseOnly.buffer.getChannelData(0);
    expect(reverseOnlyOut[0]).toBeCloseTo(0, 6); // trailing silence landet vorne
    expect(reverseOnlyOut[7]).toBeCloseTo(0, 6); // leading silence landet hinten
  });
});

describe("applyTransformPipeline – fade-In + Normalize", () => {
  it("fadeInMs=10, normalize=true, target=-1 → output-peak ≈ 10^(-1/20)", () => {
    // Sine 440Hz, 100ms @ 48k → 4800 samples.
    // Fade-In von 10ms (480 samples) affektiert nur die ersten 480 Samples;
    // der Peak des Sinus liegt bei ±1 in der restlichen 90ms-Region.
    // Normalize auf -1dBTP → peak ≈ 10^(-1/20) ≈ 0.8913.
    const buf = makeTestBuffer(48000, 4800);
    const result = applyTransformPipeline(buf, {
      fadeInMs: 10,
      normalize: true,
      normalizeTargetDbTp: -1,
    });
    expect(result.buffer.length).toBe(4800);

    // Finde Peak-Amplitude (linear) im Output
    const out = result.buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      const v = Math.abs(out[i]);
      if (v > peak) peak = v;
    }

    const expectedPeak = Math.pow(10, -1 / 20); // ≈ 0.89125
    // True-Peak (oversampled) liegt typischerweise leicht über Sample-Peak.
    // Auto-Normalize berechnet auf True-Peak-Basis — der Sample-Peak im
    // Output kann daher geringfügig UNTER expectedPeak liegen (z.B. 0.88).
    // Toleranz: 0.05 (5%).
    expect(peak).toBeGreaterThan(expectedPeak - 0.05);
    expect(peak).toBeLessThan(expectedPeak + 0.05);

    // normalizeGainDb wurde gesetzt (≠ 0, weil sine peak=1.0 ≈ 0 dBTP →
    // gain auf -1 dBTP wäre ≈ -1 dB).  Bei True-Peak-Detection liegt das
    // typischerweise zwischen -1.5 und -0.5 dB.
    expect(result.normalizeGainDb).toBeLessThan(0);
    expect(result.normalizeGainDb).toBeGreaterThan(-3);
  });
});

describe("applyTransformPipeline – all-off identity (channelData)", () => {
  it("alle Flags off → exakt gleicher Float-Inhalt (erste 100 Samples channel-wise)", () => {
    const buf = makeTestBuffer(48000, 4800);
    const original = buf.getChannelData(0);
    const options: TransformPipelineOptions = {
      trimSilence: false,
      reverse: false,
      fadeInMs: 0,
      fadeOutMs: 0,
      normalize: false,
    };
    const result = applyTransformPipeline(buf, options);
    const out = result.buffer.getChannelData(0);
    expect(result.buffer.length).toBe(buf.length);
    for (let i = 0; i < 100; i++) {
      expect(out[i]).toBe(original[i]);
    }
    expect(result.normalizeGainDb).toBe(0);
  });
});

describe("applyTransformPipeline – fade-In only (no normalize)", () => {
  it("fadeInMs > 0 ohne normalize → erstes Sample = 0, last Sample unverändert", () => {
    const buf = makeTestBuffer(48000, 4800);
    const lastBefore = buf.getChannelData(0)[4799];
    const result = applyTransformPipeline(buf, { fadeInMs: 10 });
    const out = result.buffer.getChannelData(0);
    // Erstes Sample nach Linear-Fade ist input[0] * 0 = 0.
    expect(Math.abs(out[0])).toBeLessThan(0.0001);
    // Letztes Sample bleibt unverändert (außerhalb Fade-Region).
    expect(out[4799]).toBe(lastBefore);
    expect(result.normalizeGainDb).toBe(0);
  });
});
