// @vitest-environment node
/**
 * sample-ring-mod.test.ts - v3.213.0
 *
 * Tests fuer sampleRingMod Pure-Helper (Signal x Sine-Carrier-Multiplikation).
 * Bipolarer Carrier in [-1..1] mit Dry/Wet-Blend.
 *
 * Sample-Rate-Trick: viele Tests nutzen sampleRate=1000 mit carrierHz so dass
 * die Phase deterministisch an bestimmten Sample-Indizes landet
 * (z.B. carrierHz=250 -> Periode = 4 Samples bei sr=1000).
 */

import { describe, it, expect } from "vitest";
import { applyRingMod, RINGMOD_PRESETS } from "../../client/src/utils/sampleRingMod";
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

describe("v3.213 applyRingMod", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyRingMod(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer mit defaults wirft nicht und behaelt sampleRate", () => {
    const buf = makeEmptyBuffer(44100);
    const out = applyRingMod(buf, { carrierHz: 440, mix: 1 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer ohne sampleRate -> fallback 48000", () => {
    const out = applyRingMod(null as unknown as AudioBufferLike);
    expect(out.sampleRate).toBe(48000);
    expect(out.length).toBe(0);
  });

  it("mix=0 ergibt exakt identity (dry signal pass-through)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, -0.0625, 0.9, -0.4, 0.2, 0.1], 1000);
    const out = applyRingMod(dry, { carrierHz: 440, mix: 0 });
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

  it("mix=1: output[i] = input[i] * carrier_t (deterministic phase)", () => {
    // sr=1000, carrierHz=250 -> Periode = 4 samples
    // i=0 -> sin(0)        = 0
    // i=1 -> sin(pi/2)     = 1
    // i=2 -> sin(pi)       = 0
    // i=3 -> sin(3pi/2)    = -1
    const dry = makeConst(0.5, 8, 1000);
    const out = applyRingMod(dry, { carrierHz: 250, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0, 5);
    expect(got[1]).toBeCloseTo(0.5, 5);
    expect(got[2]).toBeCloseTo(0, 5);
    expect(got[3]).toBeCloseTo(-0.5, 5);
    expect(got[4]).toBeCloseTo(0, 5);
    expect(got[5]).toBeCloseTo(0.5, 5);
    expect(got[6]).toBeCloseTo(0, 5);
    expect(got[7]).toBeCloseTo(-0.5, 5);
  });

  it("carrier ist bipolar - Output kann input[i] * (-1) enthalten (sign-flip moeglich)", () => {
    // Im Gegensatz zu Tremolo (unipolar [0..1]) ist Ring-Mod-Output bipolar.
    // Bei mix=1 und positiven Input + negativem Carrier -> negativer Output.
    const dry = makeConst(1.0, 8, 1000);
    const out = applyRingMod(dry, { carrierHz: 250, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    // Bei i=3 (carrier=-1) muss output negativ sein
    expect(got[3]).toBeLessThan(-0.9);
  });

  it("mix=0.5: 50/50 dry-wet-blend", () => {
    // sr=1000, carrierHz=250, mix=0.5
    // output = 0.5 * (input * carrier) + 0.5 * input
    // i=0: carrier=0, input=0.4 -> 0.5*0 + 0.5*0.4 = 0.2
    // i=1: carrier=1, input=0.4 -> 0.5*0.4 + 0.5*0.4 = 0.4
    // i=2: carrier=0, input=0.4 -> 0.5*0 + 0.5*0.4 = 0.2
    // i=3: carrier=-1, input=0.4 -> 0.5*(-0.4) + 0.5*0.4 = 0.0
    const dry = makeConst(0.4, 4, 1000);
    const out = applyRingMod(dry, { carrierHz: 250, mix: 0.5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.2, 5);
    expect(got[1]).toBeCloseTo(0.4, 5);
    expect(got[2]).toBeCloseTo(0.2, 5);
    expect(got[3]).toBeCloseTo(0.0, 5);
  });

  it("carrier at 0Hz (sanitized to 440Hz)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5], 48000);
    const out0 = applyRingMod(dry, { carrierHz: 0, mix: 1 });
    const out440 = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    const a = Array.from(out0.getChannelData(0));
    const b = Array.from(out440.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("length-preservation: output.length === input.length", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 48000);
    const out = applyRingMod(dry, { mix: 0.5 });
    expect(out.length).toBe(10);
  });

  it("multi-channel symmetry: shared carrier -> identische Channels -> identischer Output", () => {
    const dry = makeStereoBuffer(
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      48000,
    );
    const out = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("multi-channel: L=signal, R=silence -> R bleibt silence (kein Channel-Leak)", () => {
    const dry = makeStereoBuffer(
      [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      1000,
    );
    const out = applyRingMod(dry, { carrierHz: 250, mix: 1 });
    expect(out.numberOfChannels).toBe(2);
    const R = Array.from(out.getChannelData(1));
    for (const v of R) {
      expect(v).toBeCloseTo(0, 9);
    }
  });

  it("defaults greifen ohne options-objekt", () => {
    // Default carrierHz=440, mix=1 -> full ring mod
    const dry = makeBuffer([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], 48000);
    const out = applyRingMod(dry);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
    const got = Array.from(out.getChannelData(0));
    for (const v of got) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
    // erste Probe i=0 -> carrier=sin(0)=0 -> output[0]=0
    expect(got[0]).toBeCloseTo(0, 6);
  });

  it("immutability: input-buffer wird nicht mutiert", () => {
    const src = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 1000);
    const before = Array.from(src.getChannelData(0));
    applyRingMod(src, { carrierHz: 250, mix: 1 });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("verschiedene sampleRates: 8000 Hz funktioniert", () => {
    const dry = makeSine(800, 100, 8000);
    const out = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(800);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("verschiedene sampleRates: 44100 Hz funktioniert", () => {
    const dry = makeSine(4410, 440, 44100);
    const out = applyRingMod(dry, { carrierHz: 880, mix: 0.7 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(4410);
  });

  it("verschiedene sampleRates: 96000 Hz funktioniert", () => {
    const dry = makeSine(9600, 440, 96000);
    const out = applyRingMod(dry, { carrierHz: 1500, mix: 1 });
    expect(out.sampleRate).toBe(96000);
    expect(out.length).toBe(9600);
  });

  it("sanitizer: carrierHz NaN -> default 440", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const outNaN = applyRingMod(dry, { carrierHz: NaN, mix: 1 });
    const outDef = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    const a = Array.from(outNaN.getChannelData(0));
    const b = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(Number.isFinite(a[i])).toBe(true);
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("sanitizer: carrierHz <= 0 -> default 440", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const outZero = applyRingMod(dry, { carrierHz: 0, mix: 1 });
    const outNeg = applyRingMod(dry, { carrierHz: -100, mix: 1 });
    const outDef = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    const aZero = Array.from(outZero.getChannelData(0));
    const aNeg = Array.from(outNeg.getChannelData(0));
    const aDef = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < aDef.length; i++) {
      expect(aZero[i]).toBeCloseTo(aDef[i], 6);
      expect(aNeg[i]).toBeCloseTo(aDef[i], 6);
    }
  });

  it("sanitizer: carrierHz > 20000 -> clamp 20000", () => {
    const dry = makeConst(1.0, 200, 48000);
    const out99k = applyRingMod(dry, { carrierHz: 99999, mix: 1 });
    const out20k = applyRingMod(dry, { carrierHz: 20000, mix: 1 });
    const a = Array.from(out99k.getChannelData(0));
    const b = Array.from(out20k.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: carrierHz Infinity -> default 440 (non-finite branch)", () => {
    // Infinity is non-finite -> sanitizer falls back to default 440
    const dry = makeConst(1.0, 16, 48000);
    const outInf = applyRingMod(dry, { carrierHz: Infinity, mix: 1 });
    const outDef = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    const a = Array.from(outInf.getChannelData(0));
    const b = Array.from(outDef.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(Number.isFinite(a[i])).toBe(true);
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("sanitizer: mix NaN -> 0 (identity / dry pass-through)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625, 0.9, -0.4], 48000);
    const out = applyRingMod(dry, { carrierHz: 440, mix: NaN });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
    expect(got[5]).toBeCloseTo(-0.4, 6);
  });

  it("sanitizer: mix < 0 -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyRingMod(dry, { mix: -5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: mix > 1 -> clamp 1", () => {
    const dry = makeConst(1.0, 8, 1000);
    const out99 = applyRingMod(dry, { carrierHz: 250, mix: 99 });
    const out1 = applyRingMod(dry, { carrierHz: 250, mix: 1 });
    const a = Array.from(out99.getChannelData(0));
    const b = Array.from(out1.getChannelData(0));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: mix Infinity -> 0 (non-finite branch)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyRingMod(dry, { carrierHz: 440, mix: Infinity });
    const got = Array.from(out.getChannelData(0));
    // mix=Infinity -> not-finite -> falls back to 0 (dry)
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: mix -Infinity -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25], 48000);
    const out = applyRingMod(dry, { mix: -Infinity });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
  });

  it("sanitizer: alle extreme values -> finite output", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyRingMod(dry, {
      carrierHz: Infinity,
      mix: Infinity,
    });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("output amplitude <= input amplitude (kein Clipping bei mix in [0,1])", () => {
    // |output| <= mix*|input|*|carrier| + (1-mix)*|input| <= |input|
    const dry = makeBuffer([1.0, -1.0, 0.8, -0.8, 0.5, -0.5], 1000);
    const out = applyRingMod(dry, { carrierHz: 200, mix: 0.7 });
    const got = Array.from(out.getChannelData(0));
    const drySamples = Array.from(dry.getChannelData(0));
    for (let i = 0; i < got.length; i++) {
      expect(Math.abs(got[i])).toBeLessThanOrEqual(Math.abs(drySamples[i]) + 1e-9);
    }
  });

  it("zero-input -> zero-output (signal * carrier == 0)", () => {
    const dry = makeConst(0.0, 32, 48000);
    const out = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    for (const v of got) {
      expect(v).toBeCloseTo(0, 9);
    }
  });

  it("output finiteness fuer realistic sine input", () => {
    const dry = makeSine(2048, 440, 48000);
    const out = applyRingMod(dry, { carrierHz: 880, mix: 0.8 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("different carrier frequencies produce different output (carrier-effect)", () => {
    const dry = makeConst(1.0, 100, 48000);
    const out440 = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    const out880 = applyRingMod(dry, { carrierHz: 880, mix: 1 });
    const a = Array.from(out440.getChannelData(0));
    const b = Array.from(out880.getChannelData(0));
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff += Math.abs(a[i] - b[i]);
    }
    expect(diff).toBeGreaterThan(0.1);
  });

  it("out-of-range channel access throws RangeError", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyRingMod(dry, { carrierHz: 440, mix: 1 });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(99)).toThrow(RangeError);
  });

  it("returned channels are NOT aliased to input (immutability deep-check)", () => {
    const src = makeBuffer([0.5, 0.4, 0.3, 0.2], 1000);
    const out = applyRingMod(src, { carrierHz: 250, mix: 0 });
    // mix=0 -> output numerisch == input, aber fresh Float32Array
    const srcData = src.getChannelData(0);
    const outData = out.getChannelData(0);
    expect(outData).not.toBe(srcData);
    outData[0] = 999;
    expect(src.getChannelData(0)[0]).toBeCloseTo(0.5, 6);
  });
});

describe("v3.213 RINGMOD_PRESETS", () => {
  it("enthaelt bell/alien/metallic/bass", () => {
    expect(RINGMOD_PRESETS.bell).toBeDefined();
    expect(RINGMOD_PRESETS.alien).toBeDefined();
    expect(RINGMOD_PRESETS.metallic).toBeDefined();
    expect(RINGMOD_PRESETS.bass).toBeDefined();
  });

  it("alle Presets haben carrierHz/mix mit plausiblen Werten", () => {
    const all = [
      RINGMOD_PRESETS.bell,
      RINGMOD_PRESETS.alien,
      RINGMOD_PRESETS.metallic,
      RINGMOD_PRESETS.bass,
    ];
    for (const p of all) {
      expect(typeof p.carrierHz).toBe("number");
      expect(typeof p.mix).toBe("number");
      expect(p.carrierHz).toBeGreaterThan(0);
      expect(p.carrierHz).toBeLessThanOrEqual(20000);
      expect(p.mix).toBeGreaterThanOrEqual(0);
      expect(p.mix).toBeLessThanOrEqual(1);
    }
  });

  it("preset bell matched Spec: carrierHz=880, mix=0.8", () => {
    expect(RINGMOD_PRESETS.bell.carrierHz).toBe(880);
    expect(RINGMOD_PRESETS.bell.mix).toBe(0.8);
  });

  it("preset alien matched Spec: carrierHz=1500, mix=1", () => {
    expect(RINGMOD_PRESETS.alien.carrierHz).toBe(1500);
    expect(RINGMOD_PRESETS.alien.mix).toBe(1);
  });

  it("preset metallic matched Spec: carrierHz=600, mix=0.7", () => {
    expect(RINGMOD_PRESETS.metallic.carrierHz).toBe(600);
    expect(RINGMOD_PRESETS.metallic.mix).toBe(0.7);
  });

  it("preset bass matched Spec: carrierHz=100, mix=0.5", () => {
    expect(RINGMOD_PRESETS.bass.carrierHz).toBe(100);
    expect(RINGMOD_PRESETS.bass.mix).toBe(0.5);
  });

  it("presets sind direkt anwendbar via applyRingMod(buf, preset)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyRingMod(dry, RINGMOD_PRESETS.bell);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("alle presets liefern finite output bei realistic sine-input", () => {
    const dry = makeSine(1000, 440, 48000);
    const presets = [
      RINGMOD_PRESETS.bell,
      RINGMOD_PRESETS.alien,
      RINGMOD_PRESETS.metallic,
      RINGMOD_PRESETS.bass,
    ];
    for (const p of presets) {
      const out = applyRingMod(dry, p);
      const got = out.getChannelData(0);
      for (let i = 0; i < got.length; i++) {
        expect(Number.isFinite(got[i])).toBe(true);
      }
    }
  });

  it("alien-preset (mix=1) ist staerker moduliert als bass-preset (mix=0.5)", () => {
    // Bei mix=1 ist die Modulation komplett wet; bei mix=0.5 nur halb.
    const dry = makeConst(1.0, 4800, 48000);
    const outAlien = applyRingMod(dry, RINGMOD_PRESETS.alien);
    const outBass = applyRingMod(dry, RINGMOD_PRESETS.bass);
    const aSamples = Array.from(outAlien.getChannelData(0));
    const bSamples = Array.from(outBass.getChannelData(0));

    // Compute mean-deviation from dry (constant 1.0)
    let devAlien = 0;
    let devBass = 0;
    for (let i = 0; i < aSamples.length; i++) {
      devAlien += Math.abs(aSamples[i] - 1.0);
      devBass += Math.abs(bSamples[i] - 1.0);
    }
    devAlien /= aSamples.length;
    devBass /= bSamples.length;
    expect(devAlien).toBeGreaterThan(devBass);
  });
});
