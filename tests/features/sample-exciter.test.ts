// @vitest-environment node
/**
 * sample-exciter.test.ts -- v3.224.0
 *
 * Tests fuer den Aural-Exciter Pure-Helper:
 *   - applyExciter (top-level API)
 *   - EXCITER_PRESETS Shape + Content
 *   - defensive Defaults (NaN / Infinity / out-of-range)
 *
 * Pattern wie sample-haas.test.ts (v3.223) / sample-high-pass.test.ts (v3.199).
 */

import { describe, it, expect } from "vitest";
import {
  applyExciter,
  EXCITER_PRESETS,
} from "../../client/src/utils/sampleExciter";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// --- Helpers --------------------------------------------------------------

function makeBuffer(values: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(values);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: values.length,
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

function makeSine(
  freq: number,
  length: number,
  sampleRate = 48000,
  amplitude = 0.5,
): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function snapshot(buf: AudioBufferLike): { meta: string; channels: number[][] } {
  const channels: number[][] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    channels.push(Array.from(buf.getChannelData(c)));
  }
  return {
    meta: `sr=${buf.sampleRate} ch=${buf.numberOfChannels} len=${buf.length}`,
    channels,
  };
}

function allFinite(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

function maxAbs(arr: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) {
    const a = Math.abs(arr[i]);
    if (a > m) m = a;
  }
  return m;
}

function sumAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s;
}

// --- Tests ----------------------------------------------------------------

describe("applyExciter - basics", () => {
  it("empty buffer -> empty output (numberOfChannels=0)", () => {
    const out = applyExciter(makeEmptyBuffer());
    expect(out.numberOfChannels).toBe(0);
    expect(out.length).toBe(0);
  });

  it("empty buffer preserves sampleRate fallback when sampleRate present", () => {
    const empty: AudioBufferLike = {
      sampleRate: 44100,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
    const out = applyExciter(empty);
    expect(out.sampleRate).toBe(44100);
    expect(out.numberOfChannels).toBe(0);
  });

  it("length is preserved", () => {
    const sine = makeSine(440, 512);
    const out = applyExciter(sine, { amount: 0.3, freq: 3000 });
    expect(out.length).toBe(512);
  });

  it("sampleRate is preserved", () => {
    const buf = makeSine(440, 256, 22050);
    const out = applyExciter(buf, { amount: 0.3 });
    expect(out.sampleRate).toBe(22050);
  });

  it("numberOfChannels is preserved (mono input -> mono output)", () => {
    const out = applyExciter(makeSine(440, 256));
    expect(out.numberOfChannels).toBe(1);
  });

  it("defaults apply when no options passed (amount=0.3, freq=3000)", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const out = applyExciter(sine);
    // Defaults sind aktiv -> Output unterscheidet sich vom Dry.
    const dry = sine.getChannelData(0);
    const wet = out.getChannelData(0);
    expect(sumAbsDiff(dry, wet)).toBeGreaterThan(0);
  });
});

describe("applyExciter - amount=0 -> identity", () => {
  it("amount=0 produces sample-exact identity of dry input", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const before = Array.from(sine.getChannelData(0));
    const out = applyExciter(sine, { amount: 0, freq: 3000 });
    const after = Array.from(out.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("amount=0 identity also holds for multi-channel input", () => {
    const left = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1));
    const right = Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.1));
    const stereo = makeMultiChannelBuffer([left, right]);
    // Float32-roundtrip: stereo's getChannelData lieferte Float32-Arrays mit
    // typed-array-Praezision; Vergleich braucht denselben Roundtrip.
    const leftFloat = Array.from(new Float32Array(left));
    const rightFloat = Array.from(new Float32Array(right));
    const out = applyExciter(stereo, { amount: 0 });
    expect(Array.from(out.getChannelData(0))).toEqual(leftFloat);
    expect(Array.from(out.getChannelData(1))).toEqual(rightFloat);
  });

  it("amount<0 (NaN-Pfad) -> sanitized to 0 -> identity", () => {
    const sine = makeSine(440, 64, 48000, 0.5);
    const before = Array.from(sine.getChannelData(0));
    const out = applyExciter(sine, { amount: -1 });
    expect(Array.from(out.getChannelData(0))).toEqual(before);
  });
});

describe("applyExciter - immutability", () => {
  it("input mono buffer not mutated", () => {
    const sine = makeSine(440, 128, 48000, 0.5);
    const before = snapshot(sine);
    applyExciter(sine, { amount: 0.5, freq: 4000 });
    expect(snapshot(sine)).toEqual(before);
  });

  it("input multi-channel buffer not mutated", () => {
    const left = Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.2) * 0.4);
    const right = Array.from({ length: 64 }, (_, i) => Math.cos(i * 0.2) * 0.4);
    const stereo = makeMultiChannelBuffer([left, right]);
    const before = snapshot(stereo);
    applyExciter(stereo, { amount: 0.7, freq: 5000 });
    expect(snapshot(stereo)).toEqual(before);
  });

  it("output Float32Array is not aliased to input Float32Array", () => {
    const sine = makeSine(440, 32);
    const out = applyExciter(sine, { amount: 0.4 });
    expect(out.getChannelData(0)).not.toBe(sine.getChannelData(0));
  });
});

describe("applyExciter - multi-channel", () => {
  it("stereo input -> stereo output, both channels processed independently", () => {
    const left = Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.1));
    const right = Array.from({ length: 256 }, (_, i) => Math.cos(i * 0.1));
    const stereo = makeMultiChannelBuffer([left, right]);
    const out = applyExciter(stereo, { amount: 0.5, freq: 3000 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(256);
    // Channels haben eigene HP-State -> Output unterscheidet sich pro Channel.
    expect(Array.from(out.getChannelData(0))).not.toEqual(Array.from(out.getChannelData(1)));
  });

  it("getChannelData out-of-range throws RangeError", () => {
    const out = applyExciter(makeSine(440, 32));
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });

  it("3-channel input -> 3-channel output (channel count preserved)", () => {
    const ch0 = Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.05) * 0.3);
    const ch1 = Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.07) * 0.3);
    const ch2 = Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.09) * 0.3);
    const buf = makeMultiChannelBuffer([ch0, ch1, ch2]);
    const out = applyExciter(buf, { amount: 0.4 });
    expect(out.numberOfChannels).toBe(3);
  });
});

describe("applyExciter - sample rates", () => {
  it("8000 Hz output finite + length preserved", () => {
    const sine = makeSine(1000, 128, 8000, 0.5);
    const out = applyExciter(sine, { amount: 0.3, freq: 2000 });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(128);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("44100 Hz output finite + length preserved", () => {
    const sine = makeSine(440, 256, 44100, 0.5);
    const out = applyExciter(sine, { amount: 0.3, freq: 3000 });
    expect(out.sampleRate).toBe(44100);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("96000 Hz output finite + length preserved", () => {
    const sine = makeSine(440, 256, 96000, 0.5);
    const out = applyExciter(sine, { amount: 0.3, freq: 3000 });
    expect(out.sampleRate).toBe(96000);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("applyExciter - sanitizers", () => {
  it("amount NaN -> 0 -> identity", () => {
    const sine = makeSine(440, 64);
    const before = Array.from(sine.getChannelData(0));
    const out = applyExciter(sine, { amount: NaN });
    expect(Array.from(out.getChannelData(0))).toEqual(before);
  });

  it("amount=-5 -> clamped to 0 -> identity", () => {
    const sine = makeSine(440, 64);
    const before = Array.from(sine.getChannelData(0));
    const out = applyExciter(sine, { amount: -5 });
    expect(Array.from(out.getChannelData(0))).toEqual(before);
  });

  it("amount=5 -> clamped to 1 -> finite output", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const out = applyExciter(sine, { amount: 5, freq: 3000 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
    expect(maxAbs(out.getChannelData(0))).toBeLessThanOrEqual(1);
  });

  it("amount Infinity -> clamped to 1 -> finite output", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const out = applyExciter(sine, { amount: Infinity });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("freq NaN -> default 3000", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const outNaN = applyExciter(sine, { amount: 0.3, freq: NaN });
    const outDefault = applyExciter(sine, { amount: 0.3, freq: 3000 });
    expect(Array.from(outNaN.getChannelData(0))).toEqual(
      Array.from(outDefault.getChannelData(0)),
    );
  });

  it("freq <100 -> default 3000", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const outLow = applyExciter(sine, { amount: 0.3, freq: 50 });
    const outDefault = applyExciter(sine, { amount: 0.3, freq: 3000 });
    expect(Array.from(outLow.getChannelData(0))).toEqual(
      Array.from(outDefault.getChannelData(0)),
    );
  });

  it("freq >20000 -> clamped to 20000", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const outHigh = applyExciter(sine, { amount: 0.3, freq: 99999 });
    const outClamped = applyExciter(sine, { amount: 0.3, freq: 20000 });
    expect(Array.from(outHigh.getChannelData(0))).toEqual(
      Array.from(outClamped.getChannelData(0)),
    );
  });

  it("freq +Infinity -> clamped to 20000 -> finite output", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const out = applyExciter(sine, { amount: 0.3, freq: Infinity });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("amount undefined -> default 0.3 (NOT identity)", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const out = applyExciter(sine, { freq: 3000 });
    const dry = Array.from(sine.getChannelData(0));
    const wet = Array.from(out.getChannelData(0));
    expect(wet).not.toEqual(dry);
  });

  it("freq undefined -> default 3000", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    const outUndef = applyExciter(sine, { amount: 0.3 });
    const outDefault = applyExciter(sine, { amount: 0.3, freq: 3000 });
    expect(Array.from(outUndef.getChannelData(0))).toEqual(
      Array.from(outDefault.getChannelData(0)),
    );
  });
});

describe("applyExciter - DSP behaviour", () => {
  it("output is finite for realistic sine input", () => {
    const sine = makeSine(440, 2000, 48000, 0.7);
    const out = applyExciter(sine, { amount: 0.5, freq: 3000 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("output is clipped to [-1, +1]", () => {
    // Aggressive input near +-1 mit max amount + tanh saturation.
    const len = 1024;
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) data[i] = Math.sin((2 * Math.PI * 100 * i) / 48000) * 0.99;
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: len,
      getChannelData: () => data,
    };
    const out = applyExciter(buf, { amount: 1, freq: 3000 });
    expect(maxAbs(out.getChannelData(0))).toBeLessThanOrEqual(1);
  });

  it("exciter signal contribution > 0 for non-silent input", () => {
    const sine = makeSine(440, 512, 48000, 0.5);
    const out = applyExciter(sine, { amount: 0.5, freq: 3000 });
    const dry = sine.getChannelData(0);
    const wet = out.getChannelData(0);
    // Mindestens irgendeine messbare Abweichung Dry vs. Wet.
    expect(sumAbsDiff(dry, wet)).toBeGreaterThan(0.01);
  });

  it("higher amount -> larger deviation from dry", () => {
    const sine = makeSine(440, 512, 48000, 0.5);
    const dry = sine.getChannelData(0);
    const outLow = applyExciter(sine, { amount: 0.1, freq: 3000 });
    const outHigh = applyExciter(sine, { amount: 0.9, freq: 3000 });
    const diffLow = sumAbsDiff(dry, outLow.getChannelData(0));
    const diffHigh = sumAbsDiff(dry, outHigh.getChannelData(0));
    expect(diffHigh).toBeGreaterThan(diffLow);
  });

  it("zero input -> zero output", () => {
    const len = 128;
    const data = new Float32Array(len); // alle 0
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: len,
      getChannelData: () => data,
    };
    const out = applyExciter(buf, { amount: 0.5, freq: 3000 });
    expect(maxAbs(out.getChannelData(0))).toBe(0);
  });

  it("DC input + amount>0 -> output finite (no DC-blowup)", () => {
    const len = 256;
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) data[i] = 0.5; // Konstanter DC
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: len,
      getChannelData: () => data,
    };
    const out = applyExciter(buf, { amount: 0.5, freq: 3000 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("EXCITER_PRESETS", () => {
  it("all 4 presets exist with amount + freq", () => {
    expect(EXCITER_PRESETS.subtle).toBeDefined();
    expect(EXCITER_PRESETS.bright).toBeDefined();
    expect(EXCITER_PRESETS.air).toBeDefined();
    expect(EXCITER_PRESETS.presence).toBeDefined();
    for (const key of ["subtle", "bright", "air", "presence"] as const) {
      const p = EXCITER_PRESETS[key];
      expect(typeof p.amount).toBe("number");
      expect(typeof p.freq).toBe("number");
    }
  });

  it("preset values match spec", () => {
    expect(EXCITER_PRESETS.subtle).toEqual({ amount: 0.2, freq: 4000 });
    expect(EXCITER_PRESETS.bright).toEqual({ amount: 0.4, freq: 3000 });
    expect(EXCITER_PRESETS.air).toEqual({ amount: 0.3, freq: 6000 });
    expect(EXCITER_PRESETS.presence).toEqual({ amount: 0.5, freq: 2500 });
  });

  it("all preset amounts in [0,1]", () => {
    for (const key of ["subtle", "bright", "air", "presence"] as const) {
      const p = EXCITER_PRESETS[key];
      expect(p.amount).toBeGreaterThanOrEqual(0);
      expect(p.amount).toBeLessThanOrEqual(1);
    }
  });

  it("all preset freqs in [500,8000] (musical range)", () => {
    for (const key of ["subtle", "bright", "air", "presence"] as const) {
      const p = EXCITER_PRESETS[key];
      expect(p.freq).toBeGreaterThanOrEqual(500);
      expect(p.freq).toBeLessThanOrEqual(8000);
    }
  });

  it("presets are directly applicable to applyExciter", () => {
    const sine = makeSine(440, 256, 48000, 0.5);
    for (const key of ["subtle", "bright", "air", "presence"] as const) {
      const out = applyExciter(sine, EXCITER_PRESETS[key]);
      expect(allFinite(out.getChannelData(0))).toBe(true);
      expect(out.length).toBe(256);
    }
  });
});
