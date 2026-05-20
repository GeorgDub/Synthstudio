// @vitest-environment node
/**
 * sample-stutter-buffer.test.ts - v3.211.0
 *
 * Tests fuer sampleStutterBuffer Pure-Helper (Sample-Level-Stutter).
 *
 * Sample-Rate-Trick: viele Tests nutzen sampleRate=1000 oder 2000
 * damit (sliceMs * sampleRate / 1000) auf integer-Werte faellt
 * (z.B. sr=1000, sliceMs=10 -> 10 samples; sr=2000, sliceMs=5 -> 10 samples).
 */

import { describe, it, expect } from "vitest";
import {
  applyStutterBuffer,
  STUTTER_PRESETS,
} from "../../client/src/utils/sampleStutterBuffer";
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

function makeRamp(len: number, sampleRate = 1000): AudioBufferLike {
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = (i + 1) / len; // 1/len .. 1
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

describe("v3.211 applyStutterBuffer", () => {
  it("empty buffer ergibt empty output mit fallback sampleRate=48000", () => {
    const out = applyStutterBuffer(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("empty buffer behaelt eigenen sampleRate (44100)", () => {
    const out = applyStutterBuffer(makeEmptyBuffer(44100), { sliceMs: 50, repeats: 4 });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("Output-Laenge = repeats * sliceSamples (Length-Override)", () => {
    // sr=1000, sliceMs=10 -> sliceSamples=10. repeats=3 -> outLen=30.
    // Input ist 100 samples lang — Output ist 30, NICHT 100.
    const buf = makeRamp(100, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 3 });
    expect(out.length).toBe(30);
    expect(buf.length).toBe(100); // Sicherheits-Check: input unveraendert
  });

  it("Identity-ish: repeats=1, decay=0, startMs=0 -> output == ersten sliceSamples des Inputs", () => {
    // sr=1000, sliceMs=10 -> sliceSamples=10. repeats=1 -> outLen=10.
    const buf = makeRamp(100, 1000);
    const dry = buf.getChannelData(0);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 1, decay: 0 });
    expect(out.length).toBe(10);
    const got = out.getChannelData(0);
    for (let i = 0; i < 10; i++) {
      expect(got[i]).toBeCloseTo(dry[i], 6);
    }
  });

  it("decay=0: alle Repeats haben gleiche Amplitude (per-element-Wiederholung)", () => {
    // sr=1000, sliceMs=10 -> 10 samples. repeats=3 -> outLen=30.
    const buf = makeRamp(100, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 3, decay: 0 });
    expect(out.length).toBe(30);
    const got = out.getChannelData(0);
    // Repeat 0 [0..9], Repeat 1 [10..19], Repeat 2 [20..29] sollen alle identisch sein
    for (let i = 0; i < 10; i++) {
      expect(got[i + 10]).toBeCloseTo(got[i], 6);
      expect(got[i + 20]).toBeCloseTo(got[i], 6);
    }
  });

  it("decay > 0 reduziert Amplitude pro Repeat (decay=0.5 -> [1.0, 0.5, 0])", () => {
    // sr=1000, sliceMs=10 -> 10 samples. repeats=3, decay=0.5
    // amps = [1.0, 0.5, 0.0] (3. ist 1-2*0.5=0)
    const buf = makeRamp(20, 1000); // ramp 0.05..1
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 3, decay: 0.5 });
    const got = out.getChannelData(0);
    const slice = Array.from(buf.getChannelData(0).slice(0, 10));
    for (let i = 0; i < 10; i++) {
      expect(got[i]).toBeCloseTo(slice[i] * 1.0, 6);
      expect(got[10 + i]).toBeCloseTo(slice[i] * 0.5, 6);
      expect(got[20 + i]).toBeCloseTo(0, 6);
    }
  });

  it("decay=0.2 mit repeats=8: amplitudes = [1.0, 0.8, 0.6, 0.4, 0.2, 0, 0, 0] (negativ -> 0 clamp)", () => {
    // sr=1000, sliceMs=10 -> 10 samples. repeats=8, decay=0.2
    const buf = makeRamp(100, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 8, decay: 0.2 });
    expect(out.length).toBe(80);
    const got = out.getChannelData(0);
    const slice0 = got[0]; // = (1/100)
    const expectedAmps = [1.0, 0.8, 0.6, 0.4, 0.2, 0, 0, 0];
    for (let n = 0; n < 8; n++) {
      // erstes Sample jedes Repeats: slice0 * amp
      const expected = slice0 * expectedAmps[n];
      expect(got[n * 10]).toBeCloseTo(expected, 6);
    }
  });

  it("decay=1: erster Repeat voll, alle weiteren = 0", () => {
    const buf = makeRamp(50, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 4, decay: 1 });
    expect(out.length).toBe(40);
    const got = out.getChannelData(0);
    const slice = Array.from(buf.getChannelData(0).slice(0, 10));
    // Repeat 0 voll
    for (let i = 0; i < 10; i++) expect(got[i]).toBeCloseTo(slice[i], 6);
    // Repeat 1..3 alle 0
    for (let i = 10; i < 40; i++) expect(got[i]).toBeCloseTo(0, 6);
  });

  it("startMs offsetet die Slice korrekt", () => {
    // sr=1000 -> 1ms = 1 sample. startMs=5 -> startSample=5.
    const buf = makeRamp(50, 1000);
    const dry = buf.getChannelData(0);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 2, startMs: 5, decay: 0 });
    expect(out.length).toBe(20);
    const got = out.getChannelData(0);
    // Slice ist dry[5..14] mit Laenge 10
    for (let i = 0; i < 10; i++) {
      expect(got[i]).toBeCloseTo(dry[5 + i], 6);
      expect(got[10 + i]).toBeCloseTo(dry[5 + i], 6);
    }
  });

  it("Multi-Channel: jeder Channel unabhaengig sliced+repeated", () => {
    // sr=1000, 2 channels, je 20 samples
    const L = Array.from({ length: 20 }, (_, i) => i * 0.05);
    const R = Array.from({ length: 20 }, (_, i) => -(i * 0.05));
    const buf = makeStereoBuffer(L, R, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 2, decay: 0 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(20);
    const outL = out.getChannelData(0);
    const outR = out.getChannelData(1);
    for (let i = 0; i < 10; i++) {
      expect(outL[i]).toBeCloseTo(L[i], 6);
      expect(outL[10 + i]).toBeCloseTo(L[i], 6);
      expect(outR[i]).toBeCloseTo(R[i], 6);
      expect(outR[10 + i]).toBeCloseTo(R[i], 6);
    }
  });

  it("Verschiedene sampleRates (8000/44100/96000) liefern korrekte Output-Laengen", () => {
    // sliceMs=50 -> sliceSamples = 50*sr/1000
    // sr=8000 -> 400, repeats=2 -> 800
    // sr=44100 -> 2205, repeats=2 -> 4410
    // sr=96000 -> 4800, repeats=2 -> 9600
    const cases = [
      { sr: 8000, expected: 800 },
      { sr: 44100, expected: 4410 },
      { sr: 96000, expected: 9600 },
    ];
    for (const { sr, expected } of cases) {
      const buf = makeRamp(10000, sr);
      const out = applyStutterBuffer(buf, { sliceMs: 50, repeats: 2 });
      expect(out.length).toBe(expected);
      expect(out.sampleRate).toBe(sr);
    }
  });

  it("Slice > Buffer-Laenge -> verfuegbare Samples + silence-pad (NICHT startMs-Reset)", () => {
    // sr=1000, input length=8. sliceMs=10 (10 samples), startMs=4 (startSample=4).
    // verfuegbar: dry[4..7] (4 Samples), Rest 6 samples = silence-pad
    // startMs=4 ist NICHT > duration (duration=8ms), also kein Reset.
    const buf = makeRamp(8, 1000);
    const dry = buf.getChannelData(0);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 2, startMs: 4, decay: 0 });
    expect(out.length).toBe(20);
    const got = out.getChannelData(0);
    // Slice: [dry[4], dry[5], dry[6], dry[7], 0, 0, 0, 0, 0, 0]
    expect(got[0]).toBeCloseTo(dry[4], 6);
    expect(got[1]).toBeCloseTo(dry[5], 6);
    expect(got[2]).toBeCloseTo(dry[6], 6);
    expect(got[3]).toBeCloseTo(dry[7], 6);
    for (let i = 4; i < 10; i++) expect(got[i]).toBeCloseTo(0, 6);
    // Repeat 2: gleiches Slice
    expect(got[10]).toBeCloseTo(dry[4], 6);
    expect(got[11]).toBeCloseTo(dry[5], 6);
    for (let i = 14; i < 20; i++) expect(got[i]).toBeCloseTo(0, 6);
  });

  it("startMs > duration -> Reset auf 0 (NICHT clamp)", () => {
    // sr=1000, length=10 -> duration=10ms. startMs=999 (>>duration) -> 0.
    const buf = makeRamp(10, 1000);
    const dry = buf.getChannelData(0);
    const out = applyStutterBuffer(buf, { sliceMs: 5, repeats: 2, startMs: 999, decay: 0 });
    expect(out.length).toBe(10);
    const got = out.getChannelData(0);
    for (let i = 0; i < 5; i++) {
      expect(got[i]).toBeCloseTo(dry[i], 6); // bestaetigt: Slice ab 0
    }
  });

  it("Input wird NIE mutiert", () => {
    const buf = makeRamp(50, 1000);
    const snapshotBefore = Array.from(buf.getChannelData(0));
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 4, decay: 0.3 });
    const snapshotAfter = Array.from(buf.getChannelData(0));
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(out.length).toBe(40); // sanity: Effekt war aktiv
  });

  it("Output-Array ist getrennt vom Input-Array (kein Aliasing)", () => {
    const buf = makeRamp(50, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 2 });
    expect(out.getChannelData(0)).not.toBe(buf.getChannelData(0));
  });

  it("getChannelData out-of-range wirft RangeError", () => {
    const buf = makeRamp(50, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 2 });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(1)).toThrow(RangeError); // mono input -> only ch 0
  });
});

describe("v3.211 applyStutterBuffer sanitizers", () => {
  it("sliceMs NaN -> default 50 (NICHT clamp auf 5)", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: NaN, repeats: 2 });
    // 50ms * 1000/1000 = 50 samples. repeats=2 -> 100 outLen
    expect(out.length).toBe(100);
  });

  it("sliceMs < 5 (e.g. 2) -> default 50 (NICHT clamp auf 5)", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 2, repeats: 2 });
    expect(out.length).toBe(100); // default 50 -> 50 samples * 2 = 100
  });

  it("sliceMs > 500 -> clamp auf 500", () => {
    const buf = makeRamp(10000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 9999, repeats: 2 });
    // 500ms * 1000/1000 = 500 samples * 2 = 1000
    expect(out.length).toBe(1000);
  });

  it("sliceMs Infinity -> clamp auf 500", () => {
    const buf = makeRamp(10000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: Infinity, repeats: 2 });
    expect(out.length).toBe(1000);
  });

  it("repeats NaN -> default 4 (NICHT clamp auf 1)", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: NaN });
    expect(out.length).toBe(40); // 10 samples * default 4
  });

  it("repeats < 1 (e.g. 0) -> default 4 (NICHT clamp auf 1)", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 0 });
    expect(out.length).toBe(40);
  });

  it("repeats > 32 -> clamp auf 32", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 9999 });
    expect(out.length).toBe(320);
  });

  it("repeats non-integer (e.g. 3.7) -> floor 3", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 3.7 });
    expect(out.length).toBe(30);
  });

  it("repeats=1 boundary", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 1 });
    expect(out.length).toBe(10);
  });

  it("repeats=32 boundary", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 32 });
    expect(out.length).toBe(320);
  });

  it("sliceMs=5 boundary (minimum)", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 5, repeats: 2 });
    // 5ms*1000/1000 = 5 samples. repeats=2 -> 10
    expect(out.length).toBe(10);
  });

  it("startMs NaN -> 0", () => {
    const buf = makeRamp(50, 1000);
    const dry = buf.getChannelData(0);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 1, startMs: NaN });
    expect(out.length).toBe(10);
    const got = out.getChannelData(0);
    for (let i = 0; i < 10; i++) expect(got[i]).toBeCloseTo(dry[i], 6);
  });

  it("startMs negativ -> 0", () => {
    const buf = makeRamp(50, 1000);
    const dry = buf.getChannelData(0);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 1, startMs: -100 });
    const got = out.getChannelData(0);
    for (let i = 0; i < 10; i++) expect(got[i]).toBeCloseTo(dry[i], 6);
  });

  it("decay NaN -> 0 (no decay)", () => {
    const buf = makeRamp(50, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 3, decay: NaN });
    const got = out.getChannelData(0);
    // alle 3 Repeats identisch
    for (let i = 0; i < 10; i++) {
      expect(got[10 + i]).toBeCloseTo(got[i], 6);
      expect(got[20 + i]).toBeCloseTo(got[i], 6);
    }
  });

  it("decay negativ -> 0", () => {
    const buf = makeRamp(50, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 3, decay: -1 });
    const got = out.getChannelData(0);
    for (let i = 0; i < 10; i++) {
      expect(got[10 + i]).toBeCloseTo(got[i], 6);
      expect(got[20 + i]).toBeCloseTo(got[i], 6);
    }
  });

  it("decay > 1 -> clamp auf 1 (= decay=1: nur Repeat 0 voll)", () => {
    const buf = makeRamp(50, 1000);
    const out = applyStutterBuffer(buf, { sliceMs: 10, repeats: 3, decay: 99 });
    const got = out.getChannelData(0);
    // Repeat 0 voll, Repeat 1 + 2 alle 0
    for (let i = 10; i < 30; i++) expect(got[i]).toBeCloseTo(0, 6);
  });

  it("alle-Infinity -> finite output", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyStutterBuffer(buf, {
      sliceMs: Infinity,
      repeats: Infinity,
      startMs: Infinity,
      decay: Infinity,
    });
    expect(out.length).toBeGreaterThan(0);
    const got = out.getChannelData(0);
    for (let i = 0; i < got.length; i++) {
      expect(Number.isFinite(got[i])).toBe(true);
    }
  });

  it("opts undefined -> defaults (sliceMs=50, repeats=4)", () => {
    // sr=1000, defaults 50/4 -> 50 * 4 = 200
    const buf = makeRamp(5000, 1000);
    const out = applyStutterBuffer(buf);
    expect(out.length).toBe(200);
  });
});

describe("v3.211 STUTTER_PRESETS", () => {
  it("alle 4 Presets vorhanden", () => {
    expect(STUTTER_PRESETS.short).toBeDefined();
    expect(STUTTER_PRESETS.classic).toBeDefined();
    expect(STUTTER_PRESETS.glitch).toBeDefined();
    expect(STUTTER_PRESETS.fade).toBeDefined();
  });

  it("short matched Spec {30ms, 8, 0.1}", () => {
    expect(STUTTER_PRESETS.short.sliceMs).toBe(30);
    expect(STUTTER_PRESETS.short.repeats).toBe(8);
    expect(STUTTER_PRESETS.short.decay).toBeCloseTo(0.1, 6);
  });

  it("classic matched Spec {50ms, 4, 0}", () => {
    expect(STUTTER_PRESETS.classic.sliceMs).toBe(50);
    expect(STUTTER_PRESETS.classic.repeats).toBe(4);
    expect(STUTTER_PRESETS.classic.decay).toBe(0);
  });

  it("glitch matched Spec {20ms, 16, 0.05}", () => {
    expect(STUTTER_PRESETS.glitch.sliceMs).toBe(20);
    expect(STUTTER_PRESETS.glitch.repeats).toBe(16);
    expect(STUTTER_PRESETS.glitch.decay).toBeCloseTo(0.05, 6);
  });

  it("fade matched Spec {100ms, 6, 0.3}", () => {
    expect(STUTTER_PRESETS.fade.sliceMs).toBe(100);
    expect(STUTTER_PRESETS.fade.repeats).toBe(6);
    expect(STUTTER_PRESETS.fade.decay).toBeCloseTo(0.3, 6);
  });

  it("alle Presets liefern finite output bei realer Input-Buffer", () => {
    const buf = makeRamp(5000, 1000);
    for (const preset of Object.values(STUTTER_PRESETS)) {
      const out = applyStutterBuffer(buf, preset);
      expect(out.length).toBeGreaterThan(0);
      const got = out.getChannelData(0);
      for (let i = 0; i < got.length; i++) {
        expect(Number.isFinite(got[i])).toBe(true);
      }
    }
  });

  it("alle Presets — Output-Laenge == repeats * sliceSamples (Length-Override gilt)", () => {
    const buf = makeRamp(5000, 1000);
    for (const preset of Object.values(STUTTER_PRESETS)) {
      const out = applyStutterBuffer(buf, preset);
      const expectedSliceSamples = Math.round((preset.sliceMs * 1000) / 1000);
      expect(out.length).toBe(preset.repeats * expectedSliceSamples);
    }
  });
});
