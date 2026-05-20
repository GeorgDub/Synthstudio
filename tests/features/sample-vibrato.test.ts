// @vitest-environment node
/**
 * sample-vibrato.test.ts - v3.208.0
 *
 * Tests fuer sampleVibrato Pure-Helper (Pitch-Modulation via modulated
 * delay-line). Kein FFT, kein Phase-Vocoder.
 */

import { describe, it, expect } from "vitest";
import { applyVibrato, VIBRATO_PRESETS } from "../../client/src/utils/sampleVibrato";
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

function makeStereoBuffer(
  left: number[],
  right: number[],
  sampleRate = 48000,
): AudioBufferLike {
  const L = new Float32Array(left);
  const R = new Float32Array(right);
  const len = Math.max(left.length, right.length);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: len,
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

function makeConst(value: number, len: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(len).fill(value);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

function makeSine(len: number, freqHz: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    data[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

describe("v3.208 applyVibrato", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyVibrato(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer mit options wirft nicht und behaelt sampleRate", () => {
    const buf = makeEmptyBuffer(44100);
    const out = applyVibrato(buf, { rateHz: 5, depthCents: 20 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
  });

  it("depthCents=0 ergibt exakt identity (Short-Circuit)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, -0.0625, 0.9, -0.4, 0.2, 0.1], 1000);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 0 });
    expect(out.length).toBe(8);
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(-0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
    expect(got[6]).toBeCloseTo(0.2, 6);
    expect(got[7]).toBeCloseTo(0.1, 6);
  });

  it("length-preservation: output.length === input.length", () => {
    const dry = makeBuffer(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      48000,
    );
    const out = applyVibrato(dry, { depthCents: 20 });
    expect(out.length).toBe(10);
  });

  it("length-preservation: output.length === input.length bei depth=0", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const out = applyVibrato(dry, { depthCents: 0 });
    expect(out.length).toBe(5);
  });

  it("multi-channel: stereo-input -> stereo-output", () => {
    const dry = makeStereoBuffer(
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      48000,
    );
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(8);
  });

  it("multi-channel symmetry: identische Channels ergeben identischen Output", () => {
    const dry = makeStereoBuffer(
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2, 0.3, 0.6, -0.4, 0.1],
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2, 0.3, 0.6, -0.4, 0.1],
      48000,
    );
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("multi-channel: L-impulse R-silence -> R bleibt silence", () => {
    const dry = makeStereoBuffer(
      [1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      1000,
    );
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 30 });
    expect(out.numberOfChannels).toBe(2);
    const R = Array.from(out.getChannelData(1));
    for (const v of R) {
      expect(v).toBeCloseTo(0, 6);
    }
  });

  it("defaults greifen ohne options-objekt: rateHz=5, depthCents=20", () => {
    const dry = makeSine(2000, 440, 48000);
    const out = applyVibrato(dry);
    expect(out.length).toBe(2000);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("immutability: input-buffer wird nicht mutiert", () => {
    const src = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 1000);
    const before = Array.from(src.getChannelData(0));
    applyVibrato(src, { rateHz: 5, depthCents: 50 });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("immutability: depth=0 Short-Circuit mutiert input nicht", () => {
    const src = makeBuffer([0.1, 0.2, 0.3, 0.4], 48000);
    const before = Array.from(src.getChannelData(0));
    const out = applyVibrato(src, { depthCents: 0 });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
    expect(out.getChannelData(0)).not.toBe(src.getChannelData(0));
  });
});

describe("v3.208 applyVibrato (sampleRates)", () => {
  it("sampleRate 8000 Hz funktioniert", () => {
    const dry = makeSine(800, 100, 8000);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(800);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sampleRate 44100 Hz funktioniert", () => {
    const dry = makeSine(4410, 440, 44100);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(4410);
  });

  it("sampleRate 96000 Hz funktioniert", () => {
    const dry = makeSine(9600, 440, 96000);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(out.sampleRate).toBe(96000);
    expect(out.length).toBe(9600);
  });
});

describe("v3.208 applyVibrato (sanitizers)", () => {
  it("rateHz NaN -> default 5", () => {
    const dry = makeSine(2000, 440, 48000);
    const outNaN = applyVibrato(dry, { rateHz: NaN, depthCents: 20 });
    const outDef = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    const a = outNaN.getChannelData(0);
    const b = outDef.getChannelData(0);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("rateHz <= 0 -> default 5", () => {
    const dry = makeSine(1000, 440, 48000);
    const outZero = applyVibrato(dry, { rateHz: 0, depthCents: 20 });
    const outNeg = applyVibrato(dry, { rateHz: -3, depthCents: 20 });
    const outDef = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    const aZero = Array.from(outZero.getChannelData(0));
    const aNeg = Array.from(outNeg.getChannelData(0));
    const aDef = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < aDef.length; i++) {
      expect(aZero[i]).toBeCloseTo(aDef[i], 6);
      expect(aNeg[i]).toBeCloseTo(aDef[i], 6);
    }
  });

  it("rateHz > 50 -> clamp 50", () => {
    const dry = makeSine(1000, 440, 48000);
    const out999 = applyVibrato(dry, { rateHz: 9999, depthCents: 20 });
    const out50 = applyVibrato(dry, { rateHz: 50, depthCents: 20 });
    const a = Array.from(out999.getChannelData(0));
    const b = Array.from(out50.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("rateHz Infinity -> default 5", () => {
    const dry = makeSine(800, 200, 8000);
    const outInf = applyVibrato(dry, { rateHz: Infinity, depthCents: 20 });
    const outDef = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    const a = Array.from(outInf.getChannelData(0));
    const b = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("depthCents NaN -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625, 0.9, -0.4], 48000);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: NaN });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
  });

  it("depthCents < 0 -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyVibrato(dry, { depthCents: -50 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("depthCents > 200 -> clamp 200", () => {
    const dry = makeSine(1000, 440, 48000);
    const out999 = applyVibrato(dry, { rateHz: 5, depthCents: 9999 });
    const out200 = applyVibrato(dry, { rateHz: 5, depthCents: 200 });
    const a = Array.from(out999.getChannelData(0));
    const b = Array.from(out200.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("depthCents Infinity -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyVibrato(dry, { depthCents: Infinity });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("all extreme values -> finite output", () => {
    const dry = makeBuffer(
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      48000,
    );
    const out = applyVibrato(dry, {
      rateHz: Infinity,
      depthCents: Infinity,
    });
    expect(out.length).toBe(10);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("max-params (rateHz=50, depthCents=200) auf sine -> finite output", () => {
    const dry = makeSine(2000, 440, 48000);
    const out = applyVibrato(dry, { rateHz: 50, depthCents: 200 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });
});

describe("v3.208 applyVibrato (DSP behaviour)", () => {
  it("zero-input -> zero-output (auch im delay-line-Pfad)", () => {
    const dry = makeConst(0.0, 200, 48000);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 50 });
    const got = Array.from(out.getChannelData(0));
    for (const v of got) {
      expect(v).toBeCloseTo(0, 9);
    }
  });

  it("LFO rate effect: rate=1 vs rate=10 ergeben unterschiedlichen Output", () => {
    const sr = 48000;
    const dry = makeSine(2400, 1000, sr);
    const outSlow = applyVibrato(dry, { rateHz: 1, depthCents: 50 });
    const outFast = applyVibrato(dry, { rateHz: 10, depthCents: 50 });
    const slowData = outSlow.getChannelData(0);
    const fastData = outFast.getChannelData(0);
    const start = Math.floor((5 * sr) / 1000) + 5;
    let pairDiff = 0;
    for (let i = start; i < slowData.length; i++) {
      pairDiff += Math.abs(slowData[i] - fastData[i]);
    }
    expect(pairDiff).toBeGreaterThan(0.1);
  });

  it("depthCents-Effekt: depth=0 vs depth=50 ergeben unterschiedlichen Output", () => {
    const dry = makeSine(2000, 440, 48000);
    const outZero = applyVibrato(dry, { rateHz: 5, depthCents: 0 });
    const outFull = applyVibrato(dry, { rateHz: 5, depthCents: 50 });
    const a = outZero.getChannelData(0);
    const b = outFull.getChannelData(0);
    let diffSum = 0;
    for (let i = 0; i < a.length; i++) {
      diffSum += Math.abs(a[i] - b[i]);
    }
    expect(diffSum).toBeGreaterThan(1.0);
  });

  it("DC-input -> Output bleibt nahe DC nach warmup", () => {
    const dc = makeConst(0.5, 1000, 48000);
    const out = applyVibrato(dc, { rateHz: 5, depthCents: 50 });
    const got = out.getChannelData(0);
    for (let i = 500; i < got.length; i++) {
      expect(got[i]).toBeCloseTo(0.5, 5);
    }
  });

  it("output.numberOfChannels == input.numberOfChannels (mono)", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4], 48000);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(out.numberOfChannels).toBe(1);
  });

  it("output.sampleRate == input.sampleRate", () => {
    const dry = makeSine(500, 100, 22050);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(out.sampleRate).toBe(22050);
  });

  it("getChannelData out-of-range wirft RangeError (mono delay-line)", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3], 48000);
    const out = applyVibrato(dry, { rateHz: 5, depthCents: 20 });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(1)).toThrow(RangeError);
    expect(() => out.getChannelData(99)).toThrow(RangeError);
  });

  it("getChannelData out-of-range wirft RangeError (identity-Pfad)", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3], 48000);
    const out = applyVibrato(dry, { depthCents: 0 });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(1)).toThrow(RangeError);
  });
});

describe("v3.208 VIBRATO_PRESETS", () => {
  it("enthaelt subtle/classic/expressive/warble", () => {
    expect(VIBRATO_PRESETS.subtle).toBeDefined();
    expect(VIBRATO_PRESETS.classic).toBeDefined();
    expect(VIBRATO_PRESETS.expressive).toBeDefined();
    expect(VIBRATO_PRESETS.warble).toBeDefined();
  });

  it("alle Presets haben rateHz/depthCents mit plausiblen Werten", () => {
    const all = [
      VIBRATO_PRESETS.subtle,
      VIBRATO_PRESETS.classic,
      VIBRATO_PRESETS.expressive,
      VIBRATO_PRESETS.warble,
    ];
    for (const p of all) {
      expect(typeof p.rateHz).toBe("number");
      expect(typeof p.depthCents).toBe("number");
      expect(p.rateHz).toBeGreaterThan(0);
      expect(p.rateHz).toBeLessThanOrEqual(50);
      expect(p.depthCents).toBeGreaterThanOrEqual(0);
      expect(p.depthCents).toBeLessThanOrEqual(200);
    }
  });

  it("preset classic matched Spec-Defaults: rateHz=5, depthCents=20", () => {
    expect(VIBRATO_PRESETS.classic.rateHz).toBe(5);
    expect(VIBRATO_PRESETS.classic.depthCents).toBe(20);
  });

  it("preset warble hat hoechste depthCents", () => {
    expect(VIBRATO_PRESETS.warble.depthCents).toBeGreaterThan(
      VIBRATO_PRESETS.expressive.depthCents,
    );
    expect(VIBRATO_PRESETS.warble.depthCents).toBeGreaterThan(
      VIBRATO_PRESETS.classic.depthCents,
    );
    expect(VIBRATO_PRESETS.warble.depthCents).toBeGreaterThan(
      VIBRATO_PRESETS.subtle.depthCents,
    );
  });

  it("preset subtle hat geringste depthCents", () => {
    expect(VIBRATO_PRESETS.subtle.depthCents).toBeLessThan(
      VIBRATO_PRESETS.classic.depthCents,
    );
    expect(VIBRATO_PRESETS.subtle.depthCents).toBeLessThan(
      VIBRATO_PRESETS.expressive.depthCents,
    );
    expect(VIBRATO_PRESETS.subtle.depthCents).toBeLessThan(
      VIBRATO_PRESETS.warble.depthCents,
    );
  });

  it("presets sind direkt anwendbar via applyVibrato(buf, preset)", () => {
    const dry = makeBuffer(
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      48000,
    );
    const out = applyVibrato(dry, VIBRATO_PRESETS.classic);
    expect(out.length).toBe(10);
    expect(out.numberOfChannels).toBe(1);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("alle Presets liefern finite output bei sine-input", () => {
    const dry = makeSine(2000, 440, 48000);
    const presets = [
      VIBRATO_PRESETS.subtle,
      VIBRATO_PRESETS.classic,
      VIBRATO_PRESETS.expressive,
      VIBRATO_PRESETS.warble,
    ];
    for (const p of presets) {
      const out = applyVibrato(dry, p);
      const got = out.getChannelData(0);
      for (let i = 0; i < got.length; i++) {
        expect(Number.isFinite(got[i])).toBe(true);
      }
    }
  });
});
