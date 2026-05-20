// @vitest-environment node
/**
 * sample-sidechain.test.ts — v3.192.0
 *
 * Tests fuer Sample-Sidechain Pure-Helper:
 *   - applySidechain (top-level API)
 *   - SIDECHAIN_PRESETS shape + content
 *   - Defensive defaults / Edge-Cases
 *
 * Verifikations-Strategie:
 *   - Empty / identity -> direkte Array-Inspektion
 *   - All-true / all-false Patterns -> Konstantverhalten (steady-state)
 *   - On/off-Patterns -> alternierende gain-Bereiche
 *   - Attack-Vergleich -> langsamere Onset bei groesserem attackMs
 *   - Multi-channel -> shape preservation + unabhaengige envelopes
 *   - NaN/invalid -> finite Outputs, defaults greifen
 */

import { describe, it, expect } from "vitest";
import {
  applySidechain,
  SIDECHAIN_PRESETS,
  DEFAULT_BPM,
  DEFAULT_STEPS_PER_BEAT,
  DEFAULT_DUCK_DB,
  DEFAULT_ATTACK_MS,
  DEFAULT_RELEASE_MS,
} from "../../client/src/utils/sampleSidechain";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// --- Test Helpers ------------------------------------------------------------

function makeConstantBuffer(amplitude: number, length: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(length);
  data.fill(amplitude);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeMultiChannelBuffer(channelArrays: number[][], sampleRate = 48000): AudioBufferLike {
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

// --- Tests -------------------------------------------------------------------

describe("v3.192 applySidechain — basics", () => {
  it("empty buffer -> empty buffer", () => {
    const empty = makeEmptyBuffer();
    const out = applySidechain(empty, { triggerPattern: [true, false] });
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("empty triggerPattern -> identity (copy, no effect)", () => {
    const buf = makeConstantBuffer(0.5, 1000);
    const out = applySidechain(buf, { triggerPattern: [] });
    expect(out.length).toBe(1000);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(0.5);
    }
  });

  it("all-false triggerPattern -> identity (no duck, envelope stays at 1.0)", () => {
    const buf = makeConstantBuffer(0.5, 2000);
    const out = applySidechain(buf, {
      triggerPattern: [false, false, false, false],
      bpm: 120,
      stepsPerBeat: 4,
      duckDb: -12,
      attackMs: 1,
      releaseMs: 200,
    });
    const data = out.getChannelData(0);
    // Steady-state: envelope = 1.0, output identisch zu input.
    // (Erste samples auch — targetGain=1.0 von Anfang an.)
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(0.5, 6);
    }
  });
});

describe("v3.192 applySidechain — ducking behaviour", () => {
  it("all-true triggerPattern -> steady-state ducked output", () => {
    // Trigger-pattern dauerhaft true -> envelope sinkt auf duckedGain (10^(-12/20)≈0.25).
    // Schnelles Attack (1ms) bei 48k -> ~48 samples zum Annaehern.
    const buf = makeConstantBuffer(1.0, 8000);
    const out = applySidechain(buf, {
      triggerPattern: [true, true, true, true],
      bpm: 120,
      stepsPerBeat: 4,
      duckDb: -12,
      attackMs: 1,
      releaseMs: 200,
    });
    const data = out.getChannelData(0);
    const expectedGain = Math.pow(10, -12 / 20); // ≈ 0.2512
    // Nach langer Settling-Phase (~1000 samples weit jenseits 1ms) sollte das
    // envelope nah an duckedGain sein.
    expect(Math.abs(data[7900])).toBeGreaterThan(expectedGain * 0.99);
    expect(Math.abs(data[7900])).toBeLessThan(expectedGain * 1.01);
    // Frueh: noch nicht voll abgesunken — ausserhalb dieses Bereichs.
    expect(Math.abs(data[5])).toBeGreaterThan(expectedGain * 1.5);
  });

  it("on-off pattern -> alternating ducked vs open sections", () => {
    // Pattern [true, false] @ 120bpm, 4steps/beat. stepDurationSec = 60/120/4 = 0.125s.
    // @48k: 6000 samples pro Step.
    // 24000 samples total = 4 Steps = [duck, open, duck, open].
    const buf = makeConstantBuffer(1.0, 24000);
    const out = applySidechain(buf, {
      triggerPattern: [true, false],
      bpm: 120,
      stepsPerBeat: 4,
      duckDb: -12,
      attackMs: 1,
      releaseMs: 1, // bewusst schnell, damit die "open"-Phase hoch geht
    });
    const data = out.getChannelData(0);
    // Sample ~5500 (Ende vom ersten Duck-Step) — sollte ducked sein.
    const duckedSample = Math.abs(data[5500]);
    // Sample ~11500 (Ende vom Open-Step) — sollte zurueck Richtung 1.0.
    const openSample = Math.abs(data[11500]);
    // Sample ~17500 (Ende vom zweiten Duck-Step) — wieder ducked.
    const duckedSample2 = Math.abs(data[17500]);
    expect(duckedSample).toBeLessThan(0.5);
    expect(openSample).toBeGreaterThan(0.9);
    expect(duckedSample2).toBeLessThan(0.5);
  });

  it("duckDb=0 -> no effect (targetGain=1, envelope stays at 1.0)", () => {
    const buf = makeConstantBuffer(0.5, 2000);
    const out = applySidechain(buf, {
      triggerPattern: [true, true, true, true],
      bpm: 120,
      stepsPerBeat: 4,
      duckDb: 0,
      attackMs: 1,
      releaseMs: 200,
    });
    const data = out.getChannelData(0);
    // targetGain = 10^(0/20) = 1.0, envelope starts at 1.0 -> stays at 1.0.
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(0.5, 6);
    }
  });
});

describe("v3.192 applySidechain — envelope dynamics", () => {
  it("higher attackMs -> slower duck onset (more amplitude early in trigger)", () => {
    // Vergleiche zwei Sidechain-Calls mit identischem Pattern aber unter-
    // schiedlichem Attack. Bei schnellerem Attack ist die Amplitude in den
    // ersten samples des Triggers KLEINER (envelope sinkt schneller).
    const buf = makeConstantBuffer(1.0, 8000);
    const fast = applySidechain(buf, {
      triggerPattern: [true, true, true, true],
      bpm: 120,
      stepsPerBeat: 4,
      duckDb: -24,
      attackMs: 0.5,
      releaseMs: 200,
    });
    const slow = applySidechain(buf, {
      triggerPattern: [true, true, true, true],
      bpm: 120,
      stepsPerBeat: 4,
      duckDb: -24,
      attackMs: 50,
      releaseMs: 200,
    });
    // Frueher Sample (kurz nach Start): slow=hoeher (envelope noch nahe 1.0),
    // fast=tiefer (envelope schon abgesunken).
    const fastEarly = Math.abs(fast.getChannelData(0)[100]);
    const slowEarly = Math.abs(slow.getChannelData(0)[100]);
    expect(slowEarly).toBeGreaterThan(fastEarly);
  });
});

describe("v3.192 applySidechain — multi-channel", () => {
  it("multi-channel: shape preserved, each channel ducked independently", () => {
    const chL = new Array(8000).fill(1.0);
    const chR = new Array(8000).fill(0.5);
    const buf = makeMultiChannelBuffer([chL, chR]);
    const out = applySidechain(buf, {
      triggerPattern: [true, true, true, true],
      bpm: 120,
      stepsPerBeat: 4,
      duckDb: -12,
      attackMs: 1,
      releaseMs: 200,
    });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(8000);
    const expectedGain = Math.pow(10, -12 / 20);
    // Steady-state: jeder Kanal wird mit dem gleichen Envelope-Verhalten
    // gedueckt — output_ch = input_ch * envelope.
    const lSteady = Math.abs(out.getChannelData(0)[7900]);
    const rSteady = Math.abs(out.getChannelData(1)[7900]);
    expect(lSteady).toBeCloseTo(1.0 * expectedGain, 3);
    expect(rSteady).toBeCloseTo(0.5 * expectedGain, 3);
  });

  it("multi-channel: out-of-range channel access throws RangeError", () => {
    const buf = makeMultiChannelBuffer([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    const out = applySidechain(buf, { triggerPattern: [true, false] });
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(2)).toThrow(RangeError);
  });
});

describe("v3.192 SIDECHAIN_PRESETS", () => {
  it("has 4 entries with correct shape and ids", () => {
    expect(SIDECHAIN_PRESETS.length).toBe(4);
    for (const p of SIDECHAIN_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(Number.isFinite(p.duckDb)).toBe(true);
      expect(Number.isFinite(p.attackMs)).toBe(true);
      expect(p.attackMs).toBeGreaterThan(0);
      expect(Number.isFinite(p.releaseMs)).toBe(true);
      expect(p.releaseMs).toBeGreaterThan(0);
    }
    const ids = SIDECHAIN_PRESETS.map((p) => p.id);
    expect(ids).toContain("subtle-pump");
    expect(ids).toContain("edm-pump");
    expect(ids).toContain("heavy");
    expect(ids).toContain("ambient");
  });

  it("preset values match the spec", () => {
    const edm = SIDECHAIN_PRESETS.find((p) => p.id === "edm-pump")!;
    expect(edm.duckDb).toBe(-18);
    expect(edm.attackMs).toBe(1);
    expect(edm.releaseMs).toBe(180);

    const heavy = SIDECHAIN_PRESETS.find((p) => p.id === "heavy")!;
    expect(heavy.duckDb).toBe(-24);

    const ambient = SIDECHAIN_PRESETS.find((p) => p.id === "ambient")!;
    expect(ambient.releaseMs).toBe(400);
  });
});

describe("v3.192 applySidechain — defensive defaults", () => {
  it("NaN inputs fall back to defaults (finite output, no NaN propagation)", () => {
    const buf = makeConstantBuffer(0.5, 2000);
    const out = applySidechain(buf, {
      triggerPattern: [true, false, true, false],
      bpm: NaN,
      stepsPerBeat: NaN,
      duckDb: NaN,
      attackMs: NaN,
      releaseMs: NaN,
    });
    expect(out.length).toBe(2000);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
  });

  it("zero/negative bpm + stepsPerBeat -> defaults (no Infinity / division-by-zero)", () => {
    const buf = makeConstantBuffer(0.5, 2000);
    const out = applySidechain(buf, {
      triggerPattern: [true, false],
      bpm: 0,
      stepsPerBeat: -4,
      duckDb: -12,
      attackMs: 0, // -> 0.001 inside
      releaseMs: -10, // -> 0.001 inside
    });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
  });

  it("default constants are exported with expected values", () => {
    expect(DEFAULT_BPM).toBe(120);
    expect(DEFAULT_STEPS_PER_BEAT).toBe(4);
    expect(DEFAULT_DUCK_DB).toBe(-12);
    expect(DEFAULT_ATTACK_MS).toBe(1);
    expect(DEFAULT_RELEASE_MS).toBe(200);
  });
});
