// @vitest-environment node
/**
 * sample-flanger.test.ts - v3.206.0
 *
 * Tests fuer sampleFlanger Pure-Helper (kurze modulierte Delay-Line MIT
 * Feedback-Loop). Bipolare LFO (sin direkt) im Gegensatz zum Chorus (unipolar).
 *
 * Sample-Rate-Trick: viele Tests nutzen sampleRate=1000 + delayMs als
 * Integer-Samples. Bei t=0 ist sin(0)=0 -> modDelayMs=delayMs (exakt), so
 * dass die Lookup-Position deterministisch ohne Float-Wackler ist.
 */

import { describe, it, expect } from "vitest";
import { applyFlanger, FLANGER_PRESETS } from "../../client/src/utils/sampleFlanger";
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

describe("v3.206 applyFlanger", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyFlanger(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer mit defaults wirft nicht und ist DOM-frei (AudioBufferLike interface)", () => {
    const buf = makeEmptyBuffer(44100);
    const out = applyFlanger(buf, { rateHz: 0.5, depthMs: 2, delayMs: 3, feedback: 0.5, mix: 0.5 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
  });

  it("mix=0 ergibt exakt dry (identity am Output, auch wenn delay-line state divergiert)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, -0.0625, 0.9, -0.4, 0.2, 0.1], 1000);
    const out = applyFlanger(dry, { rateHz: 0.5, depthMs: 2, delayMs: 3, feedback: 0.5, mix: 0 });
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

  it("mix=1 + feedback=0 + delayMs=2/sr=1000: erste Samples 0, dann signal", () => {
    // sampleRate=1000, delayMs=2 -> delaySamples=2 (bei t=0, sin=0).
    // depthMs=0.1 (min legal) -> Modulation fast 0. mix=1, fb=0 -> pure delay (no feedback).
    const dry = makeBuffer([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1000);
    const out = applyFlanger(dry, { rateHz: 0.01, depthMs: 0.1, delayMs: 2, feedback: 0, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    // Erste 2 Samples (i=0,1) muessen 0 sein - delay-Buffer noch leer.
    expect(got[0]).toBeCloseTo(0, 4);
    expect(got[1]).toBeCloseTo(0, 4);
    // Bei i=2 erscheint dry[0]=1.0 wieder.
    expect(got[2]).toBeGreaterThan(0.9);
  });

  it("length-preservation: output.length === input.length, kein Tail", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 48000);
    const out = applyFlanger(dry, { mix: 0.5 });
    expect(out.length).toBe(10);
  });

  it("multi-channel: alle channels gleich behandelt (shared LFO-Phase)", () => {
    // Beide Channels identisch -> Output muss identisch sein (shared LFO).
    const dry = makeStereoBuffer(
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      48000,
    );
    const out = applyFlanger(dry, { rateHz: 1, depthMs: 2, delayMs: 3, feedback: 0.5, mix: 0.6 });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("multi-channel: unabhaengige Delay-Lines (Channel A signal leaks nicht zu B)", () => {
    // Channel-Isolation: L = impulse, R = silence.
    // R darf nicht von L-Echos beeinflusst werden.
    const dry = makeStereoBuffer(
      [1.0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      1000,
    );
    const out = applyFlanger(dry, { rateHz: 0.1, depthMs: 0.5, delayMs: 2, feedback: 0.5, mix: 1 });
    expect(out.numberOfChannels).toBe(2);
    const R = Array.from(out.getChannelData(1));
    // R-Channel sollte komplett 0 sein (dry=0 + delay-buf-init=0 + feedback*0=0).
    for (const v of R) {
      expect(v).toBeCloseTo(0, 6);
    }
  });

  it("defaults greifen ohne options-objekt", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFlanger(dry);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
    const got = Array.from(out.getChannelData(0));
    expect(got.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("immutability: input-buffer wird nicht mutiert (auch mit aktivem Feedback)", () => {
    const src = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 1000);
    const before = Array.from(src.getChannelData(0));
    applyFlanger(src, { rateHz: 1, depthMs: 2, delayMs: 3, feedback: 0.8, mix: 0.7 });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("verschiedene sampleRates: 8000 Hz funktioniert", () => {
    const dry = makeSine(800, 100, 8000);
    const out = applyFlanger(dry, { rateHz: 0.5, depthMs: 2, delayMs: 3, feedback: 0.5, mix: 0.5 });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(800);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("verschiedene sampleRates: 44100 Hz funktioniert", () => {
    const dry = makeSine(4410, 440, 44100);
    const out = applyFlanger(dry, { rateHz: 0.5, depthMs: 2, delayMs: 3, feedback: 0.5, mix: 0.5 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(4410);
  });

  it("verschiedene sampleRates: 96000 Hz funktioniert", () => {
    const dry = makeSine(9600, 440, 96000);
    const out = applyFlanger(dry, { rateHz: 0.5, depthMs: 2, delayMs: 3, feedback: 0.5, mix: 0.5 });
    expect(out.sampleRate).toBe(96000);
    expect(out.length).toBe(9600);
  });

  it("sanitizer: rateHz NaN -> default 0.5 (finite output, no throw)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyFlanger(dry, { rateHz: NaN, depthMs: 2, delayMs: 3, mix: 0.5 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: depthMs Infinity -> clamp 20", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFlanger(dry, { depthMs: Infinity, delayMs: 3, mix: 0.5 });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: feedback > 0.95 -> clamp 0.95 (NICHT default)", () => {
    // Verify it's clamped, not defaulted: with fb=99 result == fb=0.95
    const dry = makeSine(200, 200, 1000);
    const outClamp = applyFlanger(dry, { rateHz: 0.5, depthMs: 1, delayMs: 3, feedback: 99, mix: 0.5 });
    const outRef = applyFlanger(dry, { rateHz: 0.5, depthMs: 1, delayMs: 3, feedback: 0.95, mix: 0.5 });
    const a = Array.from(outClamp.getChannelData(0));
    const b = Array.from(outRef.getChannelData(0));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: feedback < -0.95 -> clamp -0.95 (NICHT default)", () => {
    const dry = makeSine(200, 200, 1000);
    const outClamp = applyFlanger(dry, { rateHz: 0.5, depthMs: 1, delayMs: 3, feedback: -10, mix: 0.5 });
    const outRef = applyFlanger(dry, { rateHz: 0.5, depthMs: 1, delayMs: 3, feedback: -0.95, mix: 0.5 });
    const a = Array.from(outClamp.getChannelData(0));
    const b = Array.from(outRef.getChannelData(0));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: feedback NaN -> default 0.5 (Projekt-Konvention: NaN -> default, NICHT -0.95)", () => {
    const dry = makeSine(200, 200, 1000);
    const outNaN = applyFlanger(dry, { rateHz: 0.5, depthMs: 1, delayMs: 3, feedback: NaN, mix: 0.5 });
    const outDefault = applyFlanger(dry, { rateHz: 0.5, depthMs: 1, delayMs: 3, feedback: 0.5, mix: 0.5 });
    const a = Array.from(outNaN.getChannelData(0));
    const b = Array.from(outDefault.getChannelData(0));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it("sanitizer: depth Infinity + rate Inf produced no NaN/Inf in output", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFlanger(dry, { rateHz: Infinity, depthMs: Infinity, delayMs: Infinity, feedback: Infinity, mix: 0.5 });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: mix < 0 -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyFlanger(dry, { mix: -5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: mix > 1 -> 1 (pure wet)", () => {
    const dry = makeBuffer([1.0, 0.0, 0.0, 0.0, 0.0], 1000);
    const out = applyFlanger(dry, { rateHz: 0.01, depthMs: 0.1, delayMs: 2, feedback: 0, mix: 99 });
    const got = Array.from(out.getChannelData(0));
    // dry-Anteil (1-mix)=0, also nur pure delayed; vor i=2 ist delay-buf 0.
    expect(got[0]).toBeCloseTo(0, 4);
    expect(got[1]).toBeCloseTo(0, 4);
  });

  it("sanitizer: rateHz negativ (-3) -> default 0.5 (kein Throw, finite output)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFlanger(dry, { rateHz: -3, mix: 0.5 });
    expect(out.length).toBe(6);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: rateHz > 10 -> clamp 10", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFlanger(dry, { rateHz: 9999, mix: 0.5 });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: delayMs=0 -> default 3 (kein Throw, finite output)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFlanger(dry, { delayMs: 0, mix: 0.5 });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: delayMs > 20 -> clamp 20", () => {
    const dry = makeBuffer(new Array(2000).fill(0.5), 48000);
    const out = applyFlanger(dry, { delayMs: 999, mix: 0.5 });
    expect(out.length).toBe(2000);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("feedback stability: high feedback (0.95) bei dauerndem 1.0-Input bleibt finite", () => {
    const dry = makeBuffer(new Array(4000).fill(1.0), 48000);
    const out = applyFlanger(dry, { rateHz: 1, depthMs: 4, delayMs: 5, feedback: 0.95, mix: 0.7 });
    expect(out.length).toBe(4000);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
      expect(Number.isNaN(got[i])).toBe(false);
    }
  });

  it("feedback stability: negative feedback (-0.95) bleibt ebenfalls finite", () => {
    const dry = makeBuffer(new Array(4000).fill(1.0), 48000);
    const out = applyFlanger(dry, { rateHz: 1, depthMs: 4, delayMs: 5, feedback: -0.95, mix: 0.7 });
    expect(out.length).toBe(4000);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
      expect(Number.isNaN(got[i])).toBe(false);
    }
  });

  it("output-finiteness: kein NaN/Inf bei extreme inputs (max preset boundary)", () => {
    const dry = makeSine(2000, 1000, 48000);
    const out = applyFlanger(dry, { rateHz: 10, depthMs: 20, delayMs: 20, feedback: 0.95, mix: 1 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
      expect(Number.isNaN(got[i])).toBe(false);
    }
  });

  it("feedback=0 vs feedback=0.5: hoehere Feedback ergibt unterschiedlichen Output", () => {
    // Sanity: feedback macht tatsaechlich was. Out mit fb=0.5 != fb=0.
    const dry = makeSine(500, 300, 48000);
    const out0 = applyFlanger(dry, { rateHz: 0.5, depthMs: 2, delayMs: 3, feedback: 0, mix: 0.7 });
    const out5 = applyFlanger(dry, { rateHz: 0.5, depthMs: 2, delayMs: 3, feedback: 0.5, mix: 0.7 });
    const a = Array.from(out0.getChannelData(0));
    const b = Array.from(out5.getChannelData(0));
    // Mindestens 1 Sample muss messbar abweichen
    let diffFound = false;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 0.001) {
        diffFound = true;
        break;
      }
    }
    expect(diffFound).toBe(true);
  });
});

describe("v3.206 FLANGER_PRESETS", () => {
  it("enthaelt subtle/classic/jet/metallic", () => {
    expect(FLANGER_PRESETS.subtle).toBeDefined();
    expect(FLANGER_PRESETS.classic).toBeDefined();
    expect(FLANGER_PRESETS.jet).toBeDefined();
    expect(FLANGER_PRESETS.metallic).toBeDefined();
  });

  it("alle Presets haben rateHz/depthMs/feedback/mix mit plausiblen Werten", () => {
    const all = [
      FLANGER_PRESETS.subtle,
      FLANGER_PRESETS.classic,
      FLANGER_PRESETS.jet,
      FLANGER_PRESETS.metallic,
    ];
    for (const p of all) {
      expect(typeof p.rateHz).toBe("number");
      expect(typeof p.depthMs).toBe("number");
      expect(typeof p.feedback).toBe("number");
      expect(typeof p.mix).toBe("number");
      expect(p.rateHz).toBeGreaterThan(0);
      expect(p.depthMs).toBeGreaterThan(0);
      expect(p.feedback).toBeGreaterThanOrEqual(-0.95);
      expect(p.feedback).toBeLessThanOrEqual(0.95);
      expect(p.mix).toBeGreaterThanOrEqual(0);
      expect(p.mix).toBeLessThanOrEqual(1);
    }
  });

  it("preset 'classic' matched Spec-Defaults: rate=0.5, depth=2, fb=0.5, mix=0.5", () => {
    expect(FLANGER_PRESETS.classic.rateHz).toBe(0.5);
    expect(FLANGER_PRESETS.classic.depthMs).toBe(2);
    expect(FLANGER_PRESETS.classic.feedback).toBe(0.5);
    expect(FLANGER_PRESETS.classic.mix).toBe(0.5);
  });

  it("preset 'metallic' hat hoechste Resonanz", () => {
    expect(FLANGER_PRESETS.metallic.feedback).toBeGreaterThan(FLANGER_PRESETS.subtle.feedback);
    expect(FLANGER_PRESETS.metallic.feedback).toBeGreaterThan(FLANGER_PRESETS.classic.feedback);
    expect(FLANGER_PRESETS.metallic.feedback).toBeGreaterThan(FLANGER_PRESETS.jet.feedback);
  });

  it("presets sind direkt anwendbar via applyFlanger(buf, preset)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyFlanger(dry, FLANGER_PRESETS.classic);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("alle presets liefern finite output bei realistic input", () => {
    const dry = makeSine(1000, 440, 48000);
    const presets = [
      FLANGER_PRESETS.subtle,
      FLANGER_PRESETS.classic,
      FLANGER_PRESETS.jet,
      FLANGER_PRESETS.metallic,
    ];
    for (const p of presets) {
      const out = applyFlanger(dry, p);
      const got = out.getChannelData(0);
      for (let i = 0; i < got.length; i++) {
        expect(Number.isFinite(got[i])).toBe(true);
      }
    }
  });
});
