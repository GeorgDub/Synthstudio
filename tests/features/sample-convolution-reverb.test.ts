// @vitest-environment node
/**
 * sample-convolution-reverb.test.ts - v3.185.0
 * Tests fuer sampleConvolutionReverb Pure-Helpers.
 */

import { describe, it, expect } from "vitest";
import {
  applyConvolutionReverb,
  generateSyntheticIR,
  REVERB_PRESETS,
} from "../../client/src/utils/sampleConvolutionReverb";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeBuffer(samples: number[], channels = 1, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: channels === 0 ? 0 : 1,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeStereoBuffer(left: number[], right: number[], sampleRate = 48000): AudioBufferLike {
  const L = new Float32Array(left);
  const R = new Float32Array(right);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: Math.max(left.length, right.length),
    getChannelData: (c: number) => (c === 0 ? L : R),
  };
}

function makeEmptyBuffer(sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

describe("v3.185 applyConvolutionReverb", () => {
  it("empty dry produces empty output", () => {
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(makeEmptyBuffer(), ir);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty IR produces identical copy of dry", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4]);
    const out = applyConvolutionReverb(dry, makeEmptyBuffer());
    expect(out.length).toBe(4);
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.1, 5);
    expect(got[1]).toBeCloseTo(0.2, 5);
    expect(got[2]).toBeCloseTo(0.3, 5);
    expect(got[3]).toBeCloseTo(0.4, 5);
  });

  it("wet=0 outputs dry unchanged (kein reverb)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625]);
    const ir = makeBuffer([1.0, 0.5, 0.25]);
    const out = applyConvolutionReverb(dry, ir, { wet: 0, outputGain: 0.8 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 5);
    expect(got[1]).toBeCloseTo(0.25, 5);
    expect(got[2]).toBeCloseTo(0.125, 5);
    expect(got[3]).toBeCloseTo(0.0625, 5);
  });

  it("wet=1, identity IR, outputGain=1 ergibt output gleich dry", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: 1, outputGain: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 5);
    expect(got[1]).toBeCloseTo(0.25, 5);
    expect(got[2]).toBeCloseTo(0.125, 5);
  });

  it("identity impulse mit wet=0.5+outputGain=1 ergibt dry", () => {
    const dry = makeBuffer([0.4, 0.2, 0.1]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: 0.5, outputGain: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.4, 5);
    expect(got[1]).toBeCloseTo(0.2, 5);
    expect(got[2]).toBeCloseTo(0.1, 5);
  });

  it("non-trivial IR liefert korrekte Faltung (delta * ir = ir)", () => {
    const dry = makeBuffer([1.0, 0.0, 0.0, 0.0]);
    const ir = makeBuffer([1.0, 0.5]);
    const out = applyConvolutionReverb(dry, ir, { wet: 1, outputGain: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(1.0, 5);
    expect(got[1]).toBeCloseTo(0.5, 5);
    expect(got[2]).toBeCloseTo(0.0, 5);
    expect(got[3]).toBeCloseTo(0.0, 5);
  });

  it("output length equals dry length (Tail abgeschnitten)", () => {
    const dry = makeBuffer([1.0, 0.0]);
    const ir = makeBuffer([1.0, 1.0, 1.0, 1.0]);
    const out = applyConvolutionReverb(dry, ir);
    expect(out.length).toBe(2);
  });

  it("Stereo dry wird zu mono downmixed", () => {
    const dry = makeStereoBuffer([1.0, 1.0], [0.0, 0.0]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: 1, outputGain: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 5);
    expect(got[1]).toBeCloseTo(0.5, 5);
  });

  it("outputGain wirkt nur auf wet-Anteil", () => {
    const dry = makeBuffer([1.0, 0.0]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: 1, outputGain: 0.5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 5);
  });
});

describe("v3.185 generateSyntheticIR", () => {
  it("liefert non-empty buffer fuer 100ms@48k", () => {
    const ir = generateSyntheticIR(100, 48000);
    expect(ir.length).toBeGreaterThan(0);
    expect(ir.numberOfChannels).toBe(1);
    expect(ir.sampleRate).toBe(48000);
  });

  it("length matches duration: 100ms@48k = 4800", () => {
    const ir = generateSyntheticIR(100, 48000);
    expect(ir.length).toBe(4800);
  });

  it("length matches duration: 200ms@44100 = 8820", () => {
    const ir = generateSyntheticIR(200, 44100);
    expect(ir.length).toBe(8820);
  });

  it("erste ca. 3ms sind silence (pre-delay)", () => {
    const sr = 48000;
    const ir = generateSyntheticIR(50, sr);
    const data = ir.getChannelData(0);
    for (let i = 0; i < 144; i++) {
      expect(data[i]).toBe(0);
    }
  });

  it("exponential decay: amplitude faellt vom Anfang zum Ende", () => {
    const ir = generateSyntheticIR(100, 48000, 4.0);
    const data = ir.getChannelData(0);
    const preDelay = 144;
    const sampleRangeStart = data.slice(preDelay, preDelay + 480);
    const sampleRangeEnd = data.slice(data.length - 480);
    const rmsStart = Math.sqrt(
      Array.from(sampleRangeStart).reduce((s, x) => s + x * x, 0) / sampleRangeStart.length,
    );
    const rmsEnd = Math.sqrt(
      Array.from(sampleRangeEnd).reduce((s, x) => s + x * x, 0) / sampleRangeEnd.length,
    );
    expect(rmsStart).toBeGreaterThan(rmsEnd);
  });
});

describe("v3.185 REVERB_PRESETS", () => {
  it("hat mindestens 4 entries", () => {
    expect(REVERB_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("alle presets haben id, name, durationMs, decay", () => {
    for (const preset of REVERB_PRESETS) {
      expect(typeof preset.id).toBe("string");
      expect(typeof preset.name).toBe("string");
      expect(typeof preset.durationMs).toBe("number");
      expect(typeof preset.decay).toBe("number");
      expect(preset.durationMs).toBeGreaterThan(0);
    }
  });

  it("enthaelt room/hall/cathedral/plate IDs", () => {
    const ids = REVERB_PRESETS.map((p) => p.id);
    expect(ids).toContain("room");
    expect(ids).toContain("hall");
    expect(ids).toContain("cathedral");
    expect(ids).toContain("plate");
  });
});

describe("v3.185 defensive", () => {
  it("wet NaN faellt zurueck auf default (0.5)", () => {
    const dry = makeBuffer([1.0, 0.0]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: NaN, outputGain: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(1.0, 5);
  });

  it("outputGain NaN faellt zurueck auf 0.8", () => {
    const dry = makeBuffer([1.0, 0.0]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: 1, outputGain: NaN });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.8, 5);
  });

  it("wet groesser 1 wird auf 1 geclamped", () => {
    const dry = makeBuffer([1.0]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: 99, outputGain: 1 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(1.0, 5);
  });

  it("wet kleiner 0 wird auf 0 geclamped", () => {
    const dry = makeBuffer([0.5]);
    const ir = makeBuffer([1.0]);
    const out = applyConvolutionReverb(dry, ir, { wet: -5, outputGain: 1 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.5, 5);
  });

  it("generateSyntheticIR durationMs<=0 faellt zurueck auf 100ms", () => {
    const ir = generateSyntheticIR(0, 48000);
    expect(ir.length).toBe(4800);
  });

  it("generateSyntheticIR durationMs NaN faellt zurueck auf 100ms", () => {
    const ir = generateSyntheticIR(NaN, 48000);
    expect(ir.length).toBe(4800);
  });

  it("generateSyntheticIR sampleRate<=0 faellt zurueck auf 48000", () => {
    const ir = generateSyntheticIR(100, 0);
    expect(ir.sampleRate).toBe(48000);
    expect(ir.length).toBe(4800);
  });
});
