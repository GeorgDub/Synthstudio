// @vitest-environment node
import { describe, it, expect } from "vitest";
import { applyGate, DEFAULT_OPEN_THRESHOLD, DEFAULT_CLOSE_THRESHOLD, DEFAULT_ATTACK_MS, DEFAULT_RELEASE_MS } from "../../client/src/utils/sampleGate";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeBuffer(values: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(values);
  return { sampleRate, numberOfChannels: 1, length: values.length, getChannelData: () => data };
}
function makeConstantBuffer(amplitude: number, length: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(length); data.fill(amplitude);
  return { sampleRate, numberOfChannels: 1, length, getChannelData: () => data };
}
function makeMultiChannelBuffer(channelArrays: number[][], sampleRate = 48000): AudioBufferLike {
  const arrays = channelArrays.map((vals) => new Float32Array(vals));
  return { sampleRate, numberOfChannels: arrays.length, length: arrays[0]?.length ?? 0, getChannelData: (c: number) => arrays[c] };
}
function makeEmptyBuffer(): AudioBufferLike {
  return { sampleRate: 48000, numberOfChannels: 0, length: 0, getChannelData: () => new Float32Array(0) };
}
function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) { if (!Number.isFinite(arr[i])) return false; }
  return true;
}

describe("v3.228 applyGate - basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer();
    const o = applyGate(empty);
    expect(o.length).toBe(0);
    expect(o.numberOfChannels).toBe(0);
    expect(o.sampleRate).toBe(48000);
  });
  it("null cast -> empty buffer with fallback sampleRate", () => {
    const o = applyGate(null as unknown as AudioBufferLike);
    expect(o.length).toBe(0);
    expect(o.numberOfChannels).toBe(0);
    expect(o.sampleRate).toBe(48000);
  });
  it("all-loud (above openThreshold) -> identity (gate stays open)", () => {
    const buf = makeConstantBuffer(0.5, 1000);
    const o = applyGate(buf);
    const data = o.getChannelData(0);
    for (let i = 0; i < data.length; i++) { expect(data[i]).toBeCloseTo(0.5, 6); }
  });
  it("all-silent (below closeThreshold) -> all zeros", () => {
    const buf = makeConstantBuffer(0.001, 1000);
    const o = applyGate(buf);
    const data = o.getChannelData(0);
    for (let i = 0; i < data.length; i++) { expect(data[i]).toBe(0); }
  });
  it("length + numberOfChannels + sampleRate preserved", () => {
    const buf = makeBuffer([0.5, 0.5, 0.5, 0.5], 44100);
    const o = applyGate(buf);
    expect(o.length).toBe(4);
    expect(o.numberOfChannels).toBe(1);
    expect(o.sampleRate).toBe(44100);
  });
});

describe("v3.228 applyGate - threshold-cross / hysteresis", () => {
  it("threshold-cross opens gate (silent -> loud)", () => {
    const silent = new Array(200).fill(0.001);
    const loud = new Array(500).fill(0.5);
    const buf = makeBuffer([...silent, ...loud], 48000);
    const o = applyGate(buf, { attackMs: 1 });
    const data = o.getChannelData(0);
    for (let i = 0; i < 200; i++) { expect(data[i]).toBe(0); }
    expect(data[400]).toBeCloseTo(0.5, 6);
  });
  it("hysteresis: must drop below closeThreshold to close", () => {
    const loudA = new Array(500).fill(0.5);
    const dip = new Array(200).fill(0.07);
    const loudB = new Array(500).fill(0.5);
    const buf = makeBuffer([...loudA, ...dip, ...loudB], 48000);
    const o = applyGate(buf, { openThreshold: 0.1, closeThreshold: 0.05, attackMs: 0.1, releaseMs: 50 });
    const data = o.getChannelData(0);
    expect(data[600]).toBeCloseTo(0.07, 6);
    expect(data[1100]).toBeCloseTo(0.5, 6);
  });
  it("hysteresis: drops below closeThreshold -> gate closes", () => {
    const loud = new Array(500).fill(0.5);
    const silent = new Array(500).fill(0.001);
    const buf = makeBuffer([...loud, ...silent], 48000);
    const o = applyGate(buf, { openThreshold: 0.1, closeThreshold: 0.05, releaseMs: 1 });
    const data = o.getChannelData(0);
    expect(data[100]).toBeCloseTo(0.5, 6);
    expect(Math.abs(data[800])).toBeLessThan(1e-6);
  });
});

describe("v3.228 applyGate - ramps", () => {
  it("attack ramps up monotonically (closed -> open)", () => {
    const silent = new Array(100).fill(0.001);
    const loud = new Array(5000).fill(0.5);
    const buf = makeBuffer([...silent, ...loud], 48000);
    const o = applyGate(buf, { attackMs: 20, releaseMs: 50 });
    const data = o.getChannelData(0);
    const v1 = data[110], v2 = data[300], v3 = data[600], v4 = data[900];
    expect(v1).toBeLessThan(v2);
    expect(v2).toBeLessThan(v3);
    expect(v3).toBeLessThan(v4);
    expect(data[1500]).toBeCloseTo(0.5, 4);
  });
  it("release ramps down monotonically (open -> closed)", () => {
    const loud = new Array(100).fill(0.5);
    const tiny = new Array(5000).fill(0.001);
    const buf = makeBuffer([...loud, ...tiny], 48000);
    const o = applyGate(buf, { attackMs: 1, releaseMs: 20 });
    const data = o.getChannelData(0);
    const v1 = data[110], v2 = data[300], v3 = data[600], v4 = data[900];
    expect(v1).toBeGreaterThan(v2);
    expect(v2).toBeGreaterThan(v3);
    expect(v3).toBeGreaterThan(v4);
  });
});

describe("v3.228 applyGate - multi-channel", () => {
  it("preserves 2 channels independently (L=signal, R=silence)", () => {
    const Larr = new Array(500).fill(0.5);
    const Rarr = new Array(500).fill(0.001);
    const buf = makeMultiChannelBuffer([Larr, Rarr]);
    const o = applyGate(buf);
    expect(o.numberOfChannels).toBe(2);
    expect(o.getChannelData(0)[250]).toBeCloseTo(0.5, 6);
    expect(o.getChannelData(1)[250]).toBe(0);
  });
  it("RangeError on out-of-range channel access", () => {
    const buf = makeMultiChannelBuffer([[0.5, 0.5], [0.5, 0.5]]);
    const o = applyGate(buf);
    expect(() => o.getChannelData(-1)).toThrow(RangeError);
    expect(() => o.getChannelData(2)).toThrow(RangeError);
  });
});

describe("v3.228 applyGate - immutability", () => {
  it("input buffer is not mutated", () => {
    const original = [0.5, 0.5, 0.5, 0.5, 0.5];
    const buf = makeBuffer([...original]);
    applyGate(buf);
    const after = Array.from(buf.getChannelData(0));
    for (let i = 0; i < original.length; i++) { expect(after[i]).toBeCloseTo(original[i], 6); }
  });
  it("output Float32Array is not aliased with input", () => {
    const buf = makeBuffer([0.5, 0.5, 0.5, 0.5]);
    const o = applyGate(buf);
    const inSrc = buf.getChannelData(0);
    const outSrc = o.getChannelData(0);
    expect(outSrc).not.toBe(inSrc);
    outSrc[0] = 999;
    expect(inSrc[0]).toBeCloseTo(0.5, 6);
  });
});

describe("v3.228 applyGate - sampleRates", () => {
  it.each([8000, 22050, 44100, 48000, 96000])("sampleRate %i Hz preserved + finite output", (sr) => {
    const buf = makeConstantBuffer(0.5, 1000, sr);
    const o = applyGate(buf);
    expect(o.sampleRate).toBe(sr);
    expect(o.length).toBe(1000);
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
});

describe("v3.228 applyGate - defaults and defensive sanitizers", () => {
  it("default constants exposed", () => {
    expect(DEFAULT_OPEN_THRESHOLD).toBe(0.1);
    expect(DEFAULT_CLOSE_THRESHOLD).toBe(0.05);
    expect(DEFAULT_ATTACK_MS).toBe(1);
    expect(DEFAULT_RELEASE_MS).toBe(50);
  });
  it("undefined options -> defaults applied (no throw, finite output)", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, undefined);
    expect(allFinite(o.getChannelData(0))).toBe(true);
    expect(o.getChannelData(0)[50]).toBeCloseTo(0.5, 6);
  });
  it("openThreshold NaN -> default 0.1", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { openThreshold: Number.NaN });
    expect(o.getChannelData(0)[50]).toBeCloseTo(0.5, 6);
  });
  it("openThreshold <0 -> default", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { openThreshold: -1 });
    expect(o.getChannelData(0)[50]).toBeCloseTo(0.5, 6);
  });
  it("openThreshold >1 -> clamp to 1 (no-op gate, all zeros)", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { openThreshold: 5, closeThreshold: 0.01 });
    const data = o.getChannelData(0);
    for (let i = 0; i < data.length; i++) { expect(data[i]).toBe(0); }
  });
  it("closeThreshold NaN -> default 0.05", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { closeThreshold: Number.NaN });
    expect(o.getChannelData(0)[50]).toBeCloseTo(0.5, 6);
  });
  it("closeThreshold > openThreshold -> SWAP (pin #1)", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { openThreshold: 0.05, closeThreshold: 0.1 });
    expect(o.getChannelData(0)[50]).toBeCloseTo(0.5, 6);
    const preamble = new Array(50).fill(0.5);
    const mid = new Array(50).fill(0.07);
    const buf2 = makeBuffer([...preamble, ...mid]);
    const o2 = applyGate(buf2, { openThreshold: 0.05, closeThreshold: 0.1 });
    expect(o2.getChannelData(0)[75]).toBeCloseTo(0.07, 6);
  });
  it("attackMs NaN -> default 1", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { attackMs: Number.NaN });
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
  it("attackMs <=0 -> fallback 1 (no div-by-zero)", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { attackMs: 0 });
    expect(allFinite(o.getChannelData(0))).toBe(true);
    const o2 = applyGate(buf, { attackMs: -5 });
    expect(allFinite(o2.getChannelData(0))).toBe(true);
  });
  it("attackMs >100 -> clamp 100", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { attackMs: 99999 });
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
  it("releaseMs NaN -> default 50", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { releaseMs: Number.NaN });
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
  it("releaseMs <1 -> default 50", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { releaseMs: 0 });
    expect(allFinite(o.getChannelData(0))).toBe(true);
    const o2 = applyGate(buf, { releaseMs: -10 });
    expect(allFinite(o2.getChannelData(0))).toBe(true);
  });
  it("releaseMs >1000 -> clamp 1000", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, { releaseMs: 99999 });
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
  it("Infinity inputs -> sanitized to defaults / clamps", () => {
    const buf = makeConstantBuffer(0.5, 100);
    const o = applyGate(buf, {
      openThreshold: Number.POSITIVE_INFINITY,
      closeThreshold: Number.NEGATIVE_INFINITY,
      attackMs: Number.POSITIVE_INFINITY,
      releaseMs: Number.NEGATIVE_INFINITY,
    });
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
});

describe("v3.228 applyGate - output finite", () => {
  it("output is finite for typical sine input", () => {
    const sr = 48000;
    const n = 1024;
    const vals: number[] = [];
    for (let i = 0; i < n; i++) { vals.push(0.5 * Math.sin((2 * Math.PI * 440 * i) / sr)); }
    const buf = makeBuffer(vals, sr);
    const o = applyGate(buf);
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
  it("output is finite under extreme parameter combinations", () => {
    const buf = makeConstantBuffer(0.5, 500);
    const o = applyGate(buf, { openThreshold: 0, closeThreshold: 0, attackMs: 0.0001, releaseMs: 0.0001 });
    expect(allFinite(o.getChannelData(0))).toBe(true);
  });
});
