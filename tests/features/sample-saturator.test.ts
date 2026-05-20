// @vitest-environment node
/**
 * sample-saturator.test.ts -- v3.195.0
 *
 * Tests fuer den Sample-Saturator-Pure-Helper (tanh / soft-clip / tube / tape).
 */

import { describe, it, expect } from "vitest";
import {
  applySaturator,
  SATURATOR_PRESETS,
  DEFAULT_DRIVE,
  DEFAULT_OUTPUT_GAIN,
} from "../../client/src/utils/sampleSaturator";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeBuffer(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeStereo(L: number[], R: number[], sampleRate = 48000): AudioBufferLike {
  const left = new Float32Array(L);
  const right = new Float32Array(R);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: Math.max(L.length, R.length),
    getChannelData: (c: number) => (c === 0 ? left : right),
  };
}

describe("v3.195 applySaturator basics", () => {
  it("empty buffer to empty result", () => {
    const empty = makeBuffer([]);
    const out = applySaturator(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("drive=0 to silence (input*0=0, then shape(0)=0)", () => {
    const buf = makeBuffer([0.5, -0.5, 0.8, -0.8]);
    const out = applySaturator(buf, { drive: 0 });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(0, 7);
    }
  });

  it("low input (under threshold) roughly preserved with drive=1, gain=1", () => {
    const buf = makeBuffer([0.01, -0.01, 0.05, -0.05]);
    const out = applySaturator(buf, { type: "tanh", drive: 1, outputGain: 1 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(0.01, 3);
    expect(data[1]).toBeCloseTo(-0.01, 3);
    expect(data[2]).toBeCloseTo(0.05, 3);
    expect(data[3]).toBeCloseTo(-0.05, 3);
  });

  it("high drive to strong compression/saturation", () => {
    const buf = makeBuffer([0.4, -0.4]);
    const out = applySaturator(buf, { type: "tanh", drive: 5, outputGain: 1 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(Math.tanh(2), 4);
    expect(data[1]).toBeCloseTo(-Math.tanh(2), 4);
    expect(Math.abs(data[0])).toBeLessThan(1);
  });

  it("preserves sampleRate and length", () => {
    const buf = makeBuffer([0.1, 0.2, 0.3], 44100);
    const out = applySaturator(buf, { type: "tanh" });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(3);
    expect(out.numberOfChannels).toBe(1);
  });
});

describe("v3.195 applySaturator tanh curve", () => {
  it("tanh bounded: abs(out) < outputGain for any input", () => {
    const buf = makeBuffer([10, -10, 100, -100, 1, -1, 0.5]);
    const gain = 0.7;
    const out = applySaturator(buf, { type: "tanh", drive: 1.5, outputGain: gain });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Math.abs(data[i])).toBeLessThan(gain + 1e-6);
    }
  });

  it("tanh symmetric: shape(-x) = -shape(x)", () => {
    const buf = makeBuffer([0.3, -0.3, 0.7, -0.7]);
    const out = applySaturator(buf, { type: "tanh", drive: 2, outputGain: 1 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(-data[1], 6);
    expect(data[2]).toBeCloseTo(-data[3], 6);
  });
});

describe("v3.195 applySaturator soft-clip curve", () => {
  it("polynomial: 1.5*x - 0.5*x^3 for abs(x*drive) < 1", () => {
    const buf = makeBuffer([0.5]);
    const out = applySaturator(buf, { type: "soft-clip", drive: 1, outputGain: 1 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.6875, 6);
  });

  it("soft-clip clamps to +/-1 for abs(x*drive) >= 1", () => {
    const buf = makeBuffer([0.8, -0.8]);
    const out = applySaturator(buf, { type: "soft-clip", drive: 2, outputGain: 1 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(1, 6);
    expect(data[1]).toBeCloseTo(-1, 6);
  });
});

describe("v3.195 applySaturator tube curve (asymmetric)", () => {
  it("positive: tanh(x*drive); negative: tanh(x*drive*0.7)", () => {
    const buf = makeBuffer([1, -1]);
    const out = applySaturator(buf, { type: "tube", drive: 2, outputGain: 1 });
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(Math.tanh(2), 6);
    expect(data[1]).toBeCloseTo(Math.tanh(-1 * 2 * 0.7), 6);
  });

  it("tube asymmetry: abs(shape(+x)) != abs(shape(-x)) at moderate drive", () => {
    const buf = makeBuffer([0.5, -0.5]);
    const out = applySaturator(buf, { type: "tube", drive: 2, outputGain: 1 });
    const data = out.getChannelData(0);
    expect(Math.abs(data[0])).toBeGreaterThan(Math.abs(data[1]));
  });
});

describe("v3.195 applySaturator tape curve (HF-damping)", () => {
  it("tape low-pass: impulse attenuated vs. pure tanh", () => {
    const impulse = [1, 0, 0, 0, 0];
    const buf = makeBuffer(impulse);
    const tape = applySaturator(buf, { type: "tape", drive: 1.5, outputGain: 1 });
    const tanhRef = applySaturator(buf, { type: "tanh", drive: 1.5, outputGain: 1 });

    const tapeData = tape.getChannelData(0);
    const tanhData = tanhRef.getChannelData(0);

    expect(Math.abs(tapeData[0])).toBeLessThan(Math.abs(tanhData[0]));
    expect(Math.abs(tapeData[1])).toBeGreaterThan(1e-6);
    expect(tanhData[1]).toBeCloseTo(0, 7);
  });
});

describe("v3.195 applySaturator multi-channel", () => {
  it("stereo preserved: both channels processed independently", () => {
    const buf = makeStereo([0.5, -0.5], [0.3, -0.3]);
    const out = applySaturator(buf, { type: "tanh", drive: 2, outputGain: 1 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.getChannelData(0)[0]).toBeCloseTo(Math.tanh(0.5 * 2), 6);
    expect(out.getChannelData(1)[0]).toBeCloseTo(Math.tanh(0.3 * 2), 6);
    expect(out.getChannelData(0)[1]).toBeCloseTo(Math.tanh(-0.5 * 2), 6);
    expect(out.getChannelData(1)[1]).toBeCloseTo(Math.tanh(-0.3 * 2), 6);
  });

  it("original buffer not mutated", () => {
    const buf = makeBuffer([0.5, -0.5, 0.3]);
    const original = Array.from(buf.getChannelData(0));
    applySaturator(buf, { type: "tanh", drive: 3, outputGain: 0.5 });
    const after = Array.from(buf.getChannelData(0));
    expect(after).toEqual(original);
  });
});

describe("v3.195 applySaturator defensive defaults", () => {
  it("NaN drive to DEFAULT_DRIVE (1.5)", () => {
    const buf = makeBuffer([0.4]);
    const outNaN = applySaturator(buf, { type: "tanh", drive: NaN, outputGain: 1 });
    const outDef = applySaturator(buf, { type: "tanh", drive: DEFAULT_DRIVE, outputGain: 1 });
    expect(outNaN.getChannelData(0)[0]).toBeCloseTo(outDef.getChannelData(0)[0], 6);
  });

  it("negative drive to 0 (silence)", () => {
    const buf = makeBuffer([0.5, -0.5, 0.8]);
    const out = applySaturator(buf, { type: "tanh", drive: -3, outputGain: 1 });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(0, 7);
    }
  });

  it("invalid type to fallback tanh", () => {
    const buf = makeBuffer([0.4, -0.4]);
    const outBogus = applySaturator(buf, {
      // @ts-expect-error invalid on purpose
      type: "not-a-type",
      drive: 2,
      outputGain: 1,
    });
    const outTanh = applySaturator(buf, { type: "tanh", drive: 2, outputGain: 1 });
    expect(outBogus.getChannelData(0)[0]).toBeCloseTo(outTanh.getChannelData(0)[0], 6);
    expect(outBogus.getChannelData(0)[1]).toBeCloseTo(outTanh.getChannelData(0)[1], 6);
  });

  it("NaN outputGain to DEFAULT_OUTPUT_GAIN (0.7)", () => {
    const buf = makeBuffer([0.4]);
    const outNaN = applySaturator(buf, { type: "tanh", drive: 1.5, outputGain: NaN });
    const outDef = applySaturator(buf, { type: "tanh", drive: 1.5, outputGain: DEFAULT_OUTPUT_GAIN });
    expect(outNaN.getChannelData(0)[0]).toBeCloseTo(outDef.getChannelData(0)[0], 6);
  });

  it("no options to defaults applied (tanh, 1.5, 0.7)", () => {
    const buf = makeBuffer([0.4]);
    const outNoOpts = applySaturator(buf);
    const outExplicit = applySaturator(buf, { type: "tanh", drive: 1.5, outputGain: 0.7 });
    expect(outNoOpts.getChannelData(0)[0]).toBeCloseTo(outExplicit.getChannelData(0)[0], 6);
  });
});

describe("v3.195 SATURATOR_PRESETS", () => {
  it("contains exactly 4 entries", () => {
    expect(SATURATOR_PRESETS.length).toBe(4);
  });

  it("each preset has required fields", () => {
    for (const p of SATURATOR_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.name).toBe("string");
      expect(["tanh", "soft-clip", "tube", "tape"]).toContain(p.type);
      expect(typeof p.drive).toBe("number");
      expect(p.drive).toBeGreaterThan(0);
      expect(typeof p.outputGain).toBe("number");
      expect(p.outputGain).toBeGreaterThan(0);
    }
  });

  it("preset ids are unique", () => {
    const ids = SATURATOR_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preset subtle matches spec", () => {
    const subtle = SATURATOR_PRESETS.find((p) => p.id === "subtle");
    expect(subtle).toBeDefined();
    expect(subtle!.type).toBe("tanh");
    expect(subtle!.drive).toBe(1.2);
    expect(subtle!.outputGain).toBe(0.85);
  });

  it("preset hard-clip matches spec (soft-clip @ 3.5)", () => {
    const hard = SATURATOR_PRESETS.find((p) => p.id === "hard-clip");
    expect(hard).toBeDefined();
    expect(hard!.type).toBe("soft-clip");
    expect(hard!.drive).toBe(3.5);
    expect(hard!.outputGain).toBe(0.5);
  });

  it("presets are applyable to real buffer", () => {
    const buf = makeBuffer([0.3, -0.3, 0.6, -0.6]);
    for (const p of SATURATOR_PRESETS) {
      const out = applySaturator(buf, { type: p.type, drive: p.drive, outputGain: p.outputGain });
      expect(out.length).toBe(4);
      const data = out.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        expect(Number.isFinite(data[i])).toBe(true);
      }
    }
  });
});
