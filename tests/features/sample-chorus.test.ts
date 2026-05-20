// @vitest-environment node
/**
 * sample-chorus.test.ts - v3.205.0
 *
 * Tests fuer sampleChorus Pure-Helper (single-voice modulierte Delay-Line).
 *
 * Sample-Rate-Trick: viele Tests nutzen sampleRate=1000 + delayMs als
 * exakte Integer-Anzahl Samples (z.B. delayMs=2 -> 2 Samples), so dass
 * bei t=0 (sin=0, lfo=depthMs/2, modDelayMs=delayMs) exakt deterministisch
 * gelesen wird ohne Float-Wackler.
 */

import { describe, it, expect } from "vitest";
import { applyChorus, CHORUS_PRESETS } from "../../client/src/utils/sampleChorus";
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

describe("v3.205 applyChorus", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyChorus(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("empty buffer mit defaults wirft nicht und ist DOM-frei (AudioBufferLike interface)", () => {
    const buf = makeEmptyBuffer(44100);
    const out = applyChorus(buf, { rateHz: 1, depthMs: 5, delayMs: 15, mix: 0.5 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
  });

  it("mix=0 ergibt exakt dry (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, -0.0625, 0.9], 1000);
    const out = applyChorus(dry, { rateHz: 1, depthMs: 5, delayMs: 15, mix: 0 });
    expect(out.length).toBe(5);
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(-0.0625, 6);
    expect(got[4]).toBeCloseTo(0.9, 6);
  });

  it("mix=1 ergibt pure delay-line, output startet bei 0 (delay-buffer initial zero)", () => {
    // sampleRate=1000, delayMs=2 -> delaySamples=2 (Center, bei t=0).
    // depthMs=0.1 (min legal) -> Modulation fast 0. mix=1 -> nur Delayed.
    const dry = makeBuffer([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1000);
    const out = applyChorus(dry, { rateHz: 0.05, depthMs: 0.1, delayMs: 2, mix: 1 });
    const got = Array.from(out.getChannelData(0));
    // Erste delaySamples Samples (i=0,1) muessen 0 sein - delay-Buffer noch leer.
    expect(got[0]).toBeCloseTo(0, 4);
    expect(got[1]).toBeCloseTo(0, 4);
    // Bei i=2 erscheint dry[0]=1.0 wieder (LFO ~ 0 bei t=0, kleinste Rate).
    expect(got[2]).toBeGreaterThan(0.9);
  });

  it("length-preservation: output.length === input.length, kein Tail", () => {
    const dry = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 48000);
    const out = applyChorus(dry, { mix: 0.5 });
    expect(out.length).toBe(10);
  });

  it("multi-channel: alle channels gleich behandelt (shared LFO-Phase)", () => {
    // Beide Channels identisch -> Output muss identisch sein (shared LFO).
    const dry = makeStereoBuffer(
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
      48000,
    );
    const out = applyChorus(dry, { rateHz: 2, depthMs: 3, delayMs: 10, mix: 0.6 });
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
    const out = applyChorus(dry, { rateHz: 0.1, depthMs: 0.5, delayMs: 2, mix: 1 });
    expect(out.numberOfChannels).toBe(2);
    const R = Array.from(out.getChannelData(1));
    // R-Channel sollte komplett 0 sein (sein dry war 0, sein delay-buf war 0).
    for (const v of R) {
      expect(v).toBeCloseTo(0, 6);
    }
  });

  it("defaults greifen ohne options-objekt", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyChorus(dry);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
    // Mit defaults (mix=0.5) ist out nicht gleich dry (modulation aktiv).
    const got = Array.from(out.getChannelData(0));
    expect(got.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("immutability: input-buffer wird nicht mutiert", () => {
    const src = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 1000);
    const before = Array.from(src.getChannelData(0));
    applyChorus(src, { rateHz: 2, depthMs: 5, delayMs: 10, mix: 0.7 });
    const after = Array.from(src.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("verschiedene sampleRates: 8000 Hz funktioniert", () => {
    const dry = makeSine(800, 100, 8000);
    const out = applyChorus(dry, { rateHz: 1, depthMs: 5, delayMs: 15, mix: 0.5 });
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(800);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("verschiedene sampleRates: 44100 Hz funktioniert", () => {
    const dry = makeSine(4410, 440, 44100);
    const out = applyChorus(dry, { rateHz: 1, depthMs: 5, delayMs: 15, mix: 0.5 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(4410);
  });

  it("verschiedene sampleRates: 96000 Hz funktioniert", () => {
    const dry = makeSine(9600, 440, 96000);
    const out = applyChorus(dry, { rateHz: 1, depthMs: 5, delayMs: 15, mix: 0.5 });
    expect(out.sampleRate).toBe(96000);
    expect(out.length).toBe(9600);
  });

  it("sanitizer: rateHz NaN -> default 1", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    // mit NaN sollte default rate gewaehlt werden, kein Throw, finite output
    const out = applyChorus(dry, { rateHz: NaN, depthMs: 5, delayMs: 15, mix: 0.5 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: depthMs Infinity -> clamp 50", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyChorus(dry, { depthMs: Infinity, delayMs: 15, mix: 0.5 });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: mix < 0 -> 0 (identity)", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625], 48000);
    const out = applyChorus(dry, { mix: -5 });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 6);
    expect(got[1]).toBeCloseTo(0.25, 6);
    expect(got[2]).toBeCloseTo(0.125, 6);
    expect(got[3]).toBeCloseTo(0.0625, 6);
  });

  it("sanitizer: mix > 1 -> 1 (pure wet)", () => {
    const dry = makeBuffer([1.0, 0.0, 0.0, 0.0, 0.0], 1000);
    const out = applyChorus(dry, { rateHz: 0.05, depthMs: 0.1, delayMs: 2, mix: 99 });
    const got = Array.from(out.getChannelData(0));
    // dry-Anteil (1-mix)=0, also nur pure delayed
    expect(got[0]).toBeCloseTo(0, 4);
    expect(got[1]).toBeCloseTo(0, 4);
  });

  it("sanitizer: rateHz negativ (-3) -> default 1 (kein Throw, finite output)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyChorus(dry, { rateHz: -3, mix: 0.5 });
    expect(out.length).toBe(6);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: rateHz > 20 -> clamp 20", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyChorus(dry, { rateHz: 9999, mix: 0.5 });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: delayMs=0 -> default 15ms (spec says 'no delay or default'; impl says default)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyChorus(dry, { delayMs: 0, mix: 0.5 });
    expect(out.length).toBe(8);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("sanitizer: delayMs > 100 -> clamp 100", () => {
    const dry = makeBuffer(new Array(2000).fill(0.5), 48000);
    const out = applyChorus(dry, { delayMs: 999, mix: 0.5 });
    expect(out.length).toBe(2000);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("finiteness: kein NaN, kein Inf bei extreme inputs", () => {
    const dry = makeSine(1000, 1000, 48000);
    const out = applyChorus(dry, { rateHz: 20, depthMs: 50, delayMs: 100, mix: 1 });
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
      expect(Number.isNaN(got[i])).toBe(false);
    }
  });
});

describe("v3.205 CHORUS_PRESETS", () => {
  it("enthaelt subtle/classic/lush/shimmer", () => {
    expect(CHORUS_PRESETS.subtle).toBeDefined();
    expect(CHORUS_PRESETS.classic).toBeDefined();
    expect(CHORUS_PRESETS.lush).toBeDefined();
    expect(CHORUS_PRESETS.shimmer).toBeDefined();
  });

  it("alle Presets haben rateHz/depthMs/mix mit plausiblen Werten", () => {
    const all = [
      CHORUS_PRESETS.subtle,
      CHORUS_PRESETS.classic,
      CHORUS_PRESETS.lush,
      CHORUS_PRESETS.shimmer,
    ];
    for (const p of all) {
      expect(typeof p.rateHz).toBe("number");
      expect(typeof p.depthMs).toBe("number");
      expect(typeof p.mix).toBe("number");
      expect(p.rateHz).toBeGreaterThan(0);
      expect(p.depthMs).toBeGreaterThan(0);
      expect(p.mix).toBeGreaterThanOrEqual(0);
      expect(p.mix).toBeLessThanOrEqual(1);
    }
  });

  it("preset 'classic' matched Spec-Defaults: rate=1, depth=5, mix=0.5", () => {
    expect(CHORUS_PRESETS.classic.rateHz).toBe(1.0);
    expect(CHORUS_PRESETS.classic.depthMs).toBe(5);
    expect(CHORUS_PRESETS.classic.mix).toBe(0.5);
  });

  it("preset 'shimmer' hat schnellsten LFO", () => {
    expect(CHORUS_PRESETS.shimmer.rateHz).toBeGreaterThan(CHORUS_PRESETS.classic.rateHz);
    expect(CHORUS_PRESETS.shimmer.rateHz).toBeGreaterThan(CHORUS_PRESETS.subtle.rateHz);
    expect(CHORUS_PRESETS.shimmer.rateHz).toBeGreaterThan(CHORUS_PRESETS.lush.rateHz);
  });

  it("presets sind direkt anwendbar via applyChorus(buf, preset)", () => {
    const dry = makeBuffer([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 48000);
    const out = applyChorus(dry, CHORUS_PRESETS.classic);
    expect(out.length).toBe(8);
    expect(out.numberOfChannels).toBe(1);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });
});
