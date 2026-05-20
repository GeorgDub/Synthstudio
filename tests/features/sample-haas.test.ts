// @vitest-environment node
/**
 * sample-haas.test.ts - v3.223.0
 *
 * Tests fuer sampleHaas Pure-Helper (Stereo-Widening via Haas-Effekt).
 *
 * Haas-Effekt = kurzes L/R-Delay (5-30 ms) auf einer monophonen Quelle,
 * erzeugt breite Stereoabbildung ohne dass das Delay als Echo gehoert
 * wird (Precedence-Effekt).
 *
 * Mono-Input wird zu Stereo upgemixed (beide Channels bekommen monoMix).
 * Stereo-Input wird zu (L+R)/2 ge-downmixed, dann wie Mono behandelt.
 * Output ist IMMER 2-channel, gleiche Laenge wie Input.
 */

import { describe, it, expect } from "vitest";
import { applyHaas, HAAS_PRESETS } from "../../client/src/utils/sampleHaas";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// --- Test-Helpers -----------------------------------------------------------

function makeMonoBuffer(samples: number[], sampleRate = 48000): AudioBufferLike {
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
    getChannelData: (c: number) => {
      if (c === 0) return L;
      if (c === 1) return R;
      throw new RangeError("channel " + c);
    },
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

function makeConstMono(value: number, len: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(len).fill(value);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

function makeSineMono(len: number, freqHz: number, sampleRate = 48000): AudioBufferLike {
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

// --- Tests: applyHaas -------------------------------------------------------

describe("v3.223 applyHaas", () => {
  it("empty buffer -> empty output (numberOfChannels=0)", () => {
    const out = applyHaas(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer behaelt sampleRate", () => {
    const buf = makeEmptyBuffer(44100);
    const out = applyHaas(buf, { delayMs: 15, side: "right" });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("mono input becomes stereo (numberOfChannels=2)", () => {
    const dry = makeConstMono(0.5, 1000, 48000);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(1000);
  });

  it("delayMs=0 -> default 15 (NICHT identity)", () => {
    const dry = makeConstMono(1.0, 2000, 48000);
    const out = applyHaas(dry, { delayMs: 0, side: "right" });
    expect(out.numberOfChannels).toBe(2);
    const R = out.getChannelData(1);
    expect(R[0]).toBeCloseTo(0, 9);
    expect(R[100]).toBeCloseTo(0, 9);
    expect(R[719]).toBeCloseTo(0, 9);
    expect(R[720]).toBeCloseTo(1, 6);
  });

  it("right-delayed: L immediate, R verzoegert", () => {
    const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const dry = makeMonoBuffer(samples, 1000);
    const out = applyHaas(dry, { delayMs: 10, side: "right" });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < samples.length; i++) {
      expect(L[i]).toBeCloseTo(samples[i], 6);
    }
    for (let i = 0; i < 10; i++) {
      expect(R[i]).toBeCloseTo(0, 9);
    }
    expect(R[10]).toBeCloseTo(samples[0], 6);
    expect(R[11]).toBeCloseTo(samples[1], 6);
    expect(R[12]).toBeCloseTo(samples[2], 6);
    expect(R[13]).toBeCloseTo(samples[3], 6);
    expect(R[14]).toBeCloseTo(samples[4], 6);
  });

  it("left-delayed: R immediate, L verzoegert (opposite)", () => {
    const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const dry = makeMonoBuffer(samples, 1000);
    const out = applyHaas(dry, { delayMs: 10, side: "left" });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < samples.length; i++) {
      expect(R[i]).toBeCloseTo(samples[i], 6);
    }
    for (let i = 0; i < 10; i++) {
      expect(L[i]).toBeCloseTo(0, 9);
    }
    expect(L[10]).toBeCloseTo(samples[0], 6);
    expect(L[14]).toBeCloseTo(samples[4], 6);
  });

  it("length-preservation: output.length === input.length", () => {
    const dry = makeMonoBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 48000);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    expect(out.length).toBe(10);
  });

  it("length-preservation auch wenn delaySamples >= len (delayed = all zeros)", () => {
    const dry = makeMonoBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 1000);
    const out = applyHaas(dry, { delayMs: 20, side: "right" });
    expect(out.length).toBe(10);
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < R.length; i++) {
      expect(R[i]).toBeCloseTo(0, 9);
    }
  });

  it("defaults greifen ohne options-objekt (delayMs=15, side=right)", () => {
    const dry = makeConstMono(1.0, 2000, 48000);
    const out = applyHaas(dry);
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(2000);
    expect(out.sampleRate).toBe(48000);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    expect(L[0]).toBeCloseTo(1, 6);
    expect(R[0]).toBeCloseTo(0, 9);
    expect(R[719]).toBeCloseTo(0, 9);
    expect(R[720]).toBeCloseTo(1, 6);
  });

  it("immutability: input-buffer wird nicht mutiert (mono)", () => {
    const src = makeMonoBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 1000);
    const before = Array.from(src.getChannelData(0));
    applyHaas(src, { delayMs: 5, side: "right" });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("immutability: input-buffer wird nicht mutiert (stereo)", () => {
    const src = makeStereoBuffer([0.5, 0.6, 0.7], [-0.1, -0.2, -0.3], 1000);
    const beforeL = Array.from(src.getChannelData(0));
    const beforeR = Array.from(src.getChannelData(1));
    applyHaas(src, { delayMs: 15, side: "left" });
    expect(Array.from(src.getChannelData(0))).toEqual(beforeL);
    expect(Array.from(src.getChannelData(1))).toEqual(beforeR);
  });

  it("stereo input -> (L+R)/2 downmix bevor Haas-Trick", () => {
    const dry = makeStereoBuffer(
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      1000,
    );
    const out = applyHaas(dry, { delayMs: 5, side: "right" });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(0, 9);
      expect(R[i]).toBeCloseTo(0, 9);
    }
  });

  it("output L und R sind getrennte Float32Arrays (kein aliasing)", () => {
    const dry = makeConstMono(1.0, 100, 1000);
    const out = applyHaas(dry, { delayMs: 5, side: "right" });
    expect(out.getChannelData(0)).not.toBe(out.getChannelData(1));
  });

  it("output getChannelData out-of-range wirft RangeError", () => {
    const dry = makeConstMono(1.0, 100, 1000);
    const out = applyHaas(dry, { delayMs: 5, side: "right" });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });

  it("zero-input -> zero-output", () => {
    const dry = makeConstMono(0.0, 1000, 48000);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(0, 9);
      expect(R[i]).toBeCloseTo(0, 9);
    }
  });
});

// --- Tests: sampleRates -----------------------------------------------------

describe("v3.223 applyHaas sampleRates", () => {
  it("8000 Hz: delaySamples skaliert linear (delayMs=10 -> 80 samples)", () => {
    const dry = makeConstMono(1.0, 200, 8000);
    const out = applyHaas(dry, { delayMs: 10, side: "right" });
    expect(out.sampleRate).toBe(8000);
    const R = out.getChannelData(1);
    for (let i = 0; i < 80; i++) {
      expect(R[i]).toBeCloseTo(0, 9);
    }
    expect(R[80]).toBeCloseTo(1, 6);
  });

  it("44100 Hz: delaySamples = floor(15 * 44100 / 1000) = 661", () => {
    const dry = makeConstMono(1.0, 1500, 44100);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    expect(out.sampleRate).toBe(44100);
    const R = out.getChannelData(1);
    expect(R[660]).toBeCloseTo(0, 9);
    expect(R[661]).toBeCloseTo(1, 6);
  });

  it("96000 Hz: delaySamples = floor(15 * 96000 / 1000) = 1440", () => {
    const dry = makeConstMono(1.0, 2500, 96000);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    expect(out.sampleRate).toBe(96000);
    const R = out.getChannelData(1);
    expect(R[1439]).toBeCloseTo(0, 9);
    expect(R[1440]).toBeCloseTo(1, 6);
  });

  it("22050 Hz mit stereo-input behaelt sampleRate", () => {
    const dry = makeStereoBuffer([0.5, 0.4, 0.3, 0.2], [0.1, 0.2, 0.3, 0.4], 22050);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    expect(out.sampleRate).toBe(22050);
  });
});

// --- Tests: Sanitizer Edge Cases --------------------------------------------

describe("v3.223 applyHaas sanitizers", () => {
  it("delayMs NaN -> default 15", () => {
    const dry = makeConstMono(1.0, 2000, 48000);
    const outNaN = applyHaas(dry, { delayMs: NaN, side: "right" });
    const outDef = applyHaas(dry, { delayMs: 15, side: "right" });
    const aR = Array.from(outNaN.getChannelData(1));
    const bR = Array.from(outDef.getChannelData(1));
    for (let i = 0; i < aR.length; i++) {
      expect(aR[i]).toBeCloseTo(bR[i], 6);
    }
  });

  it("delayMs negativ -> default 15", () => {
    const dry = makeConstMono(1.0, 2000, 48000);
    const outNeg = applyHaas(dry, { delayMs: -10, side: "right" });
    const outDef = applyHaas(dry, { delayMs: 15, side: "right" });
    const aR = Array.from(outNeg.getChannelData(1));
    const bR = Array.from(outDef.getChannelData(1));
    for (let i = 0; i < aR.length; i++) {
      expect(aR[i]).toBeCloseTo(bR[i], 6);
    }
  });

  it("delayMs +Infinity -> clamp 50", () => {
    const dry = makeConstMono(1.0, 3000, 48000);
    const outInf = applyHaas(dry, { delayMs: Infinity, side: "right" });
    const outMax = applyHaas(dry, { delayMs: 50, side: "right" });
    for (let i = 0; i < outInf.length; i++) {
      expect(outInf.getChannelData(0)[i]).toBeCloseTo(outMax.getChannelData(0)[i], 5);
      expect(outInf.getChannelData(1)[i]).toBeCloseTo(outMax.getChannelData(1)[i], 5);
    }
  });

  it("delayMs -Infinity -> default 15", () => {
    const dry = makeConstMono(1.0, 2000, 48000);
    const outNegInf = applyHaas(dry, { delayMs: -Infinity, side: "right" });
    const outDef = applyHaas(dry, { delayMs: 15, side: "right" });
    for (let i = 0; i < outNegInf.length; i++) {
      expect(outNegInf.getChannelData(1)[i]).toBeCloseTo(outDef.getChannelData(1)[i], 5);
    }
  });

  it("delayMs > 50 -> clamp 50", () => {
    const dry = makeConstMono(1.0, 3000, 48000);
    const outBig = applyHaas(dry, { delayMs: 9999, side: "right" });
    const out50 = applyHaas(dry, { delayMs: 50, side: "right" });
    for (let i = 0; i < outBig.length; i++) {
      expect(outBig.getChannelData(0)[i]).toBeCloseTo(out50.getChannelData(0)[i], 5);
      expect(outBig.getChannelData(1)[i]).toBeCloseTo(out50.getChannelData(1)[i], 5);
    }
  });

  it("side unknown -> right", () => {
    const dry = makeConstMono(1.0, 1000, 48000);
    // @ts-expect-error: testing runtime fallback for invalid side
    const outUnknown = applyHaas(dry, { delayMs: 15, side: "middle" });
    const outRight = applyHaas(dry, { delayMs: 15, side: "right" });
    for (let i = 0; i < outUnknown.length; i++) {
      expect(outUnknown.getChannelData(0)[i]).toBeCloseTo(outRight.getChannelData(0)[i], 6);
      expect(outUnknown.getChannelData(1)[i]).toBeCloseTo(outRight.getChannelData(1)[i], 6);
    }
  });

  it("side undefined -> right", () => {
    const dry = makeConstMono(1.0, 1000, 48000);
    const outUndef = applyHaas(dry, { delayMs: 15 });
    const outRight = applyHaas(dry, { delayMs: 15, side: "right" });
    for (let i = 0; i < outUndef.length; i++) {
      expect(outUndef.getChannelData(0)[i]).toBeCloseTo(outRight.getChannelData(0)[i], 6);
      expect(outUndef.getChannelData(1)[i]).toBeCloseTo(outRight.getChannelData(1)[i], 6);
    }
  });

  it("alle extremen Werte -> finite output (kein NaN/Infinity)", () => {
    const dry = makeMonoBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyHaas(dry, {
      delayMs: Infinity,
      // @ts-expect-error: testing runtime fallback
      side: "weird",
    });
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i])).toBe(true);
      expect(Number.isFinite(R[i])).toBe(true);
    }
  });
});

// --- Tests: DSP-Verhalten ---------------------------------------------------

describe("v3.223 applyHaas DSP behavior", () => {
  it("realistic sine-input: outputs sind finite und 2-channel", () => {
    const dry = makeSineMono(2000, 440, 48000);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i])).toBe(true);
      expect(Number.isFinite(R[i])).toBe(true);
    }
  });

  it("L und R unterscheiden sich (Haas-Effekt aktiv)", () => {
    const dry = makeSineMono(2000, 440, 48000);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    let totalDiff = 0;
    for (let i = 0; i < 100; i++) {
      totalDiff += Math.abs(L[i] - R[i]);
    }
    expect(totalDiff).toBeGreaterThan(1);
  });

  it("delayMs=1 -> kleinste sinnvolle delay (>0 samples bei sr>=1000)", () => {
    const dry = makeConstMono(1.0, 500, 48000);
    const out = applyHaas(dry, { delayMs: 1, side: "right" });
    const R = out.getChannelData(1);
    expect(R[0]).toBeCloseTo(0, 9);
    expect(R[47]).toBeCloseTo(0, 9);
    expect(R[48]).toBeCloseTo(1, 6);
  });

  it("right- und left-side sind spiegelbildlich (gleicher delayMs)", () => {
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) samples.push(Math.sin(i * 0.1));
    const dry = makeMonoBuffer(samples, 48000);
    const outR = applyHaas(dry, { delayMs: 10, side: "right" });
    const outL = applyHaas(dry, { delayMs: 10, side: "left" });
    for (let i = 0; i < dry.length; i++) {
      expect(outR.getChannelData(0)[i]).toBeCloseTo(outL.getChannelData(1)[i], 6);
      expect(outR.getChannelData(1)[i]).toBeCloseTo(outL.getChannelData(0)[i], 6);
    }
  });

  it("output ist immer 2-channel auch bei mono input", () => {
    const dry = makeConstMono(0.5, 100, 48000);
    const out = applyHaas(dry, { delayMs: 15, side: "right" });
    expect(out.numberOfChannels).toBe(2);
  });
});

// --- Tests: HAAS_PRESETS ----------------------------------------------------

describe("v3.223 HAAS_PRESETS", () => {
  it("enthaelt subtle/classic/wide/reverseWide", () => {
    expect(HAAS_PRESETS.subtle).toBeDefined();
    expect(HAAS_PRESETS.classic).toBeDefined();
    expect(HAAS_PRESETS.wide).toBeDefined();
    expect(HAAS_PRESETS.reverseWide).toBeDefined();
  });

  it("alle Presets haben delayMs/side mit plausiblen Werten", () => {
    const all = [
      HAAS_PRESETS.subtle,
      HAAS_PRESETS.classic,
      HAAS_PRESETS.wide,
      HAAS_PRESETS.reverseWide,
    ];
    for (const p of all) {
      expect(typeof p.delayMs).toBe("number");
      expect(typeof p.side).toBe("string");
      expect(p.delayMs).toBeGreaterThan(0);
      expect(p.delayMs).toBeLessThanOrEqual(50);
      expect(["left", "right"]).toContain(p.side);
    }
  });

  it("preset subtle matched Spec: delayMs=5, side=right", () => {
    expect(HAAS_PRESETS.subtle.delayMs).toBe(5);
    expect(HAAS_PRESETS.subtle.side).toBe("right");
  });

  it("preset classic matched Spec: delayMs=15, side=right", () => {
    expect(HAAS_PRESETS.classic.delayMs).toBe(15);
    expect(HAAS_PRESETS.classic.side).toBe("right");
  });

  it("preset wide matched Spec: delayMs=25, side=right", () => {
    expect(HAAS_PRESETS.wide.delayMs).toBe(25);
    expect(HAAS_PRESETS.wide.side).toBe("right");
  });

  it("preset reverseWide matched Spec: delayMs=25, side=left", () => {
    expect(HAAS_PRESETS.reverseWide.delayMs).toBe(25);
    expect(HAAS_PRESETS.reverseWide.side).toBe("left");
  });

  it("presets sind direkt anwendbar via applyHaas(buf, preset)", () => {
    const dry = makeConstMono(0.5, 2000, 48000);
    const out = applyHaas(dry, HAAS_PRESETS.classic);
    expect(out.length).toBe(2000);
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i])).toBe(true);
      expect(Number.isFinite(R[i])).toBe(true);
    }
  });

  it("alle presets liefern finite output bei realistic sine-input", () => {
    const dry = makeSineMono(2000, 440, 48000);
    const presets = [
      HAAS_PRESETS.subtle,
      HAAS_PRESETS.classic,
      HAAS_PRESETS.wide,
      HAAS_PRESETS.reverseWide,
    ];
    for (const p of presets) {
      const out = applyHaas(dry, p);
      expect(out.numberOfChannels).toBe(2);
      const L = out.getChannelData(0);
      const R = out.getChannelData(1);
      for (let i = 0; i < L.length; i++) {
        expect(Number.isFinite(L[i])).toBe(true);
        expect(Number.isFinite(R[i])).toBe(true);
      }
    }
  });
});
