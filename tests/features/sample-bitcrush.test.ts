// @vitest-environment node
import { describe, it, expect } from "vitest";
import { applyBitcrush, BITCRUSH_PRESETS } from "@/utils/sampleBitcrush";
import type { AudioBufferLike } from "@/utils/sampleEmbedding";

function makeBuf(channels: number, length: number, sampleRate = 48000, fill: (c: number, i: number) => number = () => 0): AudioBufferLike {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i++) arr[i] = fill(c, i);
    data.push(arr);
  }
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData(ch: number) {
      if (ch < 0 || ch >= channels) throw new RangeError(`oob ${ch}`);
      return data[ch];
    },
  };
}

describe("sampleBitcrush", () => {
  describe("applyBitcrush", () => {
    it("empty buffer → empty output", () => {
      const empty: AudioBufferLike = { sampleRate: 48000, numberOfChannels: 0, length: 0, getChannelData: () => new Float32Array(0) };
      const out = applyBitcrush(empty);
      expect(out.length).toBe(0);
      expect(out.numberOfChannels).toBe(0);
    });

    it("zero-channels buffer", () => {
      const empty: AudioBufferLike = { sampleRate: 44100, numberOfChannels: 0, length: 0, getChannelData: () => new Float32Array(0) };
      const out = applyBitcrush(empty);
      expect(out.sampleRate).toBe(44100);
    });

    it("mix=0 → identity (passes input through)", () => {
      const buf = makeBuf(1, 32, 48000, (_, i) => Math.sin(i * 0.1));
      const out = applyBitcrush(buf, { mix: 0 });
      const src = buf.getChannelData(0);
      const dst = out.getChannelData(0);
      for (let i = 0; i < src.length; i++) {
        expect(dst[i]).toBeCloseTo(src[i], 5);
      }
    });

    it("length-preservation", () => {
      const buf = makeBuf(1, 1024, 48000, () => 0.5);
      const out = applyBitcrush(buf);
      expect(out.length).toBe(buf.length);
    });

    it("multi-channel preserved", () => {
      const buf = makeBuf(2, 32, 48000, (c, i) => (c === 0 ? 0.3 : -0.3) * Math.sin(i * 0.2));
      const out = applyBitcrush(buf);
      expect(out.numberOfChannels).toBe(2);
      expect(out.getChannelData(1).length).toBe(32);
    });

    it("defaults compile cleanly", () => {
      const buf = makeBuf(1, 64, 48000, (_, i) => Math.sin(i * 0.1));
      const out = applyBitcrush(buf);
      const dst = out.getChannelData(0);
      let anyFinite = false;
      for (let i = 0; i < dst.length; i++) {
        if (Number.isFinite(dst[i])) anyFinite = true;
        expect(dst[i]).toBeGreaterThanOrEqual(-1);
        expect(dst[i]).toBeLessThanOrEqual(1);
      }
      expect(anyFinite).toBe(true);
    });

    it("immutability: input buffer unchanged", () => {
      const buf = makeBuf(1, 32, 48000, (_, i) => Math.sin(i * 0.1));
      const before = Array.from(buf.getChannelData(0));
      applyBitcrush(buf, { mix: 1, drive: 5 });
      const after = Array.from(buf.getChannelData(0));
      for (let i = 0; i < before.length; i++) {
        expect(after[i]).toBeCloseTo(before[i], 6);
      }
    });

    it("sampleRate 8000", () => {
      const buf = makeBuf(1, 64, 8000, () => 0.4);
      const out = applyBitcrush(buf);
      expect(out.sampleRate).toBe(8000);
    });

    it("sampleRate 44100", () => {
      const buf = makeBuf(1, 64, 44100, () => 0.4);
      const out = applyBitcrush(buf);
      expect(out.sampleRate).toBe(44100);
    });

    it("sampleRate 96000", () => {
      const buf = makeBuf(1, 64, 96000, () => 0.4);
      const out = applyBitcrush(buf);
      expect(out.sampleRate).toBe(96000);
    });

    it("bitDepth=1 → harsh 2-level quantization", () => {
      const buf = makeBuf(1, 64, 48000, (_, i) => 0.5 * Math.sin(i * 0.1));
      const out = applyBitcrush(buf, { bitDepth: 1, sampleRateReduction: 1, drive: 1, mix: 1 });
      const dst = out.getChannelData(0);
      const unique = new Set<number>();
      for (let i = 0; i < dst.length; i++) {
        unique.add(Math.round(dst[i] * 100) / 100);
      }
      // bitDepth=1 + tanh-saturation = effectively binary output (a few discrete levels)
      expect(unique.size).toBeLessThanOrEqual(5);
    });

    it("bitDepth=16 → near-identity quantization (with drive=1)", () => {
      const buf = makeBuf(1, 64, 48000, (_, i) => 0.3 * Math.sin(i * 0.1));
      const out = applyBitcrush(buf, { bitDepth: 16, sampleRateReduction: 1, drive: 1, mix: 1 });
      const src = buf.getChannelData(0);
      const dst = out.getChannelData(0);
      for (let i = 0; i < src.length; i++) {
        expect(Math.abs(dst[i] - Math.tanh(src[i]))).toBeLessThan(0.001);
      }
    });

    it("sanitizer: bitDepth NaN → default 8", () => {
      const buf = makeBuf(1, 8, 48000, () => 0.5);
      const out = applyBitcrush(buf, { bitDepth: NaN, mix: 1 });
      const dst = out.getChannelData(0);
      for (let i = 0; i < dst.length; i++) expect(Number.isFinite(dst[i])).toBe(true);
    });

    it("sanitizer: bitDepth 100 → clamped 16", () => {
      const buf = makeBuf(1, 8, 48000, () => 0.5);
      const a = applyBitcrush(buf, { bitDepth: 100, mix: 1 });
      const b = applyBitcrush(buf, { bitDepth: 16, mix: 1 });
      for (let i = 0; i < 8; i++) {
        expect(a.getChannelData(0)[i]).toBeCloseTo(b.getChannelData(0)[i], 6);
      }
    });

    it("sanitizer: drive negative → default 1", () => {
      const buf = makeBuf(1, 8, 48000, () => 0.5);
      const a = applyBitcrush(buf, { drive: -1, mix: 1 });
      const b = applyBitcrush(buf, { drive: 1, mix: 1 });
      for (let i = 0; i < 8; i++) {
        expect(a.getChannelData(0)[i]).toBeCloseTo(b.getChannelData(0)[i], 6);
      }
    });

    it("sanitizer: mix >1 → clamped 1", () => {
      const buf = makeBuf(1, 8, 48000, () => 0.5);
      const a = applyBitcrush(buf, { mix: 5 });
      const b = applyBitcrush(buf, { mix: 1 });
      for (let i = 0; i < 8; i++) {
        expect(a.getChannelData(0)[i]).toBeCloseTo(b.getChannelData(0)[i], 6);
      }
    });

    it("sanitizer: srReduction NaN → default 4", () => {
      const buf = makeBuf(1, 8, 48000, () => 0.5);
      const a = applyBitcrush(buf, { sampleRateReduction: NaN, mix: 1 });
      const b = applyBitcrush(buf, { sampleRateReduction: 4, mix: 1 });
      for (let i = 0; i < 8; i++) {
        expect(a.getChannelData(0)[i]).toBeCloseTo(b.getChannelData(0)[i], 6);
      }
    });

    it("drive > 1 → harder saturation", () => {
      const buf = makeBuf(1, 32, 48000, (_, i) => 0.1 * Math.sin(i * 0.1));
      const low = applyBitcrush(buf, { drive: 1, bitDepth: 16, sampleRateReduction: 1, mix: 1 });
      const high = applyBitcrush(buf, { drive: 10, bitDepth: 16, sampleRateReduction: 1, mix: 1 });
      let lowEnergy = 0;
      let highEnergy = 0;
      for (let i = 0; i < 32; i++) {
        lowEnergy += Math.abs(low.getChannelData(0)[i]);
        highEnergy += Math.abs(high.getChannelData(0)[i]);
      }
      expect(highEnergy).toBeGreaterThan(lowEnergy);
    });

    it("output finite (no NaN, no Infinity)", () => {
      const buf = makeBuf(1, 32, 48000, (_, i) => 0.5 * Math.sin(i * 0.3));
      const out = applyBitcrush(buf, { drive: 20, bitDepth: 4, mix: 1 });
      const dst = out.getChannelData(0);
      for (let i = 0; i < dst.length; i++) {
        expect(Number.isFinite(dst[i])).toBe(true);
      }
    });

    it("output clamped ±1", () => {
      const buf = makeBuf(1, 32, 48000, (_, i) => (i % 2 === 0 ? 2 : -2));
      const out = applyBitcrush(buf, { drive: 10, mix: 1 });
      const dst = out.getChannelData(0);
      for (let i = 0; i < dst.length; i++) {
        expect(dst[i]).toBeGreaterThanOrEqual(-1);
        expect(dst[i]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("BITCRUSH_PRESETS", () => {
    it("all 4 presets defined", () => {
      expect(BITCRUSH_PRESETS.subtle).toBeDefined();
      expect(BITCRUSH_PRESETS.classic).toBeDefined();
      expect(BITCRUSH_PRESETS.destroy).toBeDefined();
      expect(BITCRUSH_PRESETS.videogame).toBeDefined();
    });

    it("preset classic matches spec", () => {
      expect(BITCRUSH_PRESETS.classic.bitDepth).toBe(8);
      expect(BITCRUSH_PRESETS.classic.sampleRateReduction).toBe(4);
      expect(BITCRUSH_PRESETS.classic.drive).toBe(2);
      expect(BITCRUSH_PRESETS.classic.mix).toBe(0.7);
    });

    it("preset destroy is most aggressive", () => {
      expect(BITCRUSH_PRESETS.destroy.bitDepth).toBeLessThanOrEqual(BITCRUSH_PRESETS.classic.bitDepth);
      expect(BITCRUSH_PRESETS.destroy.sampleRateReduction).toBeGreaterThanOrEqual(BITCRUSH_PRESETS.classic.sampleRateReduction);
    });

    it("apply preset to buffer is finite", () => {
      const buf = makeBuf(1, 64, 48000, (_, i) => 0.4 * Math.sin(i * 0.1));
      const out = applyBitcrush(buf, BITCRUSH_PRESETS.destroy);
      const dst = out.getChannelData(0);
      for (let i = 0; i < dst.length; i++) {
        expect(Number.isFinite(dst[i])).toBe(true);
      }
    });
  });
});
