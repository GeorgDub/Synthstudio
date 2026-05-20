// @vitest-environment node
/**
 * sample-delay.test.ts - v3.191.0
 * Tests fuer sampleDelay Pure-Helpers (Echo + Feedback).
 */

import { describe, it, expect } from "vitest";
import {
  applyDelay,
  DELAY_PRESETS,
} from "../../client/src/utils/sampleDelay";
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

describe("v3.191 applyDelay", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyDelay(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("wet=0 ergibt identity, output truncated == dry", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125, 0.0625]);
    const out = applyDelay(dry, {
      delayMs: 10,
      feedback: 0.5,
      wet: 0,
      tailMs: 0,
    });
    expect(out.length).toBe(4);
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0.5, 5);
    expect(got[1]).toBeCloseTo(0.25, 5);
    expect(got[2]).toBeCloseTo(0.125, 5);
    expect(got[3]).toBeCloseTo(0.0625, 5);
  });

  it("wet=1 ergibt nur Echos, dry-Position bleibt 0", () => {
    const dry = makeBuffer([1.0, 0.0, 0.0, 0.0, 0.0], 1000);
    const out = applyDelay(dry, {
      delayMs: 2,
      feedback: 0,
      wet: 1,
      tailMs: 0,
    });
    const got = Array.from(out.getChannelData(0));
    expect(got[0]).toBeCloseTo(0, 5);
    expect(got[1]).toBeCloseTo(0, 5);
    expect(got[2]).toBeCloseTo(1.0, 5);
  });

  it("feedback=0 ergibt genau ein Echo, kein Repeat", () => {
    const dry = makeBuffer([1.0, 0, 0, 0, 0, 0, 0], 1000);
    const out = applyDelay(dry, {
      delayMs: 2,
      feedback: 0,
      wet: 0.5,
      tailMs: 5,
    });
    const got = Array.from(out.getChannelData(0));
    expect(got[2]).toBeCloseTo(0.5, 5);
    expect(got[4]).toBeCloseTo(0, 5);
  });

  it("feedback groesser 0 ergibt mehrere decaying Echos", () => {
    const dry = makeBuffer([1.0, 0, 0, 0, 0, 0, 0, 0, 0], 1000);
    const out = applyDelay(dry, {
      delayMs: 2,
      feedback: 0.5,
      wet: 1,
      tailMs: 8,
    });
    const got = Array.from(out.getChannelData(0));
    expect(got[2]).toBeCloseTo(1.0, 5);
    expect(got[4]).toBeCloseTo(0.5, 5);
    expect(got[6]).toBeCloseTo(0.25, 5);
    expect(Math.abs(got[6])).toBeLessThan(Math.abs(got[4]));
    expect(Math.abs(got[4])).toBeLessThan(Math.abs(got[2]));
  });

  it("tail verlaengert output-Laenge: dry.length + tailSamples", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125], 1000);
    const out = applyDelay(dry, {
      delayMs: 1,
      feedback: 0.5,
      wet: 0.5,
      tailMs: 10,
    });
    expect(out.length).toBe(3 + 10);
  });

  it("multi-channel: pro Channel eigene Delay-Line, beide bleiben erhalten", () => {
    const dry = makeStereoBuffer([1.0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 1000);
    const out = applyDelay(dry, {
      delayMs: 2,
      feedback: 0,
      wet: 1,
      tailMs: 0,
    });
    expect(out.numberOfChannels).toBe(2);
    const L = Array.from(out.getChannelData(0));
    const R = Array.from(out.getChannelData(1));
    expect(L[2]).toBeCloseTo(1.0, 5);
    for (let i = 0; i < R.length; i++) {
      expect(R[i]).toBeCloseTo(0, 5);
    }
  });

  it("defensive: NaN-Optionen fallen auf Defaults zurueck", () => {
    const dry = makeBuffer([0.5, 0.25], 1000);
    const out = applyDelay(dry, {
      delayMs: NaN,
      feedback: NaN,
      wet: NaN,
      tailMs: NaN,
    });
    expect(out.length).toBe(2 + 1000);
    const got = out.getChannelData(0);
    expect(got[0]).toBeCloseTo(0.3, 5);
  });

  it("feedback groesser 0.95 wird auf 0.95 geclamped (verhindert Runaway)", () => {
    const dry = makeBuffer([1.0, 0, 0, 0, 0], 1000);
    const out = applyDelay(dry, {
      delayMs: 2,
      feedback: 99,
      wet: 1,
      tailMs: 0,
    });
    const got = Array.from(out.getChannelData(0));
    expect(got[2]).toBeCloseTo(1.0, 5);
  });

  it("delayMs<=0 ergibt fallback auf Default (250ms)", () => {
    const dry = makeBuffer([1.0], 1000);
    const out = applyDelay(dry, {
      delayMs: 0,
      feedback: 0,
      wet: 1,
      tailMs: 300,
    });
    const got = out.getChannelData(0);
    expect(got[250]).toBeCloseTo(1.0, 5);
    expect(got[0]).toBeCloseTo(0, 5);
    expect(got[100]).toBeCloseTo(0, 5);
  });

  it("delayMs negativ ergibt fallback auf Default", () => {
    const dry = makeBuffer([1.0], 1000);
    const out = applyDelay(dry, {
      delayMs: -50,
      feedback: 0,
      wet: 1,
      tailMs: 300,
    });
    expect(out.getChannelData(0)[250]).toBeCloseTo(1.0, 5);
  });

  it("wet wird auf [0,1] geclamped", () => {
    const dry = makeBuffer([0.5, 0.25], 1000);
    const outHi = applyDelay(dry, { delayMs: 1, feedback: 0, wet: 5, tailMs: 0 });
    expect(outHi.getChannelData(0)[0]).toBeCloseTo(0, 5);
    const outLo = applyDelay(dry, { delayMs: 1, feedback: 0, wet: -5, tailMs: 0 });
    expect(outLo.getChannelData(0)[0]).toBeCloseTo(0.5, 5);
  });

  it("ohne options-Objekt: alle Defaults greifen, kein Throw", () => {
    const dry = makeBuffer([0.5, 0.25, 0.125], 48000);
    const out = applyDelay(dry);
    expect(out.length).toBe(3 + 48000);
    expect(out.numberOfChannels).toBe(1);
  });
});

describe("v3.191 DELAY_PRESETS", () => {
  it("hat genau 4 entries", () => {
    expect(DELAY_PRESETS.length).toBe(4);
  });

  it("enthaelt slap/echo/long/dub IDs", () => {
    const ids = DELAY_PRESETS.map((p) => p.id);
    expect(ids).toContain("slap");
    expect(ids).toContain("echo");
    expect(ids).toContain("long");
    expect(ids).toContain("dub");
  });

  it("alle presets haben id/name/delayMs/feedback/wet, Werte plausibel", () => {
    for (const preset of DELAY_PRESETS) {
      expect(typeof preset.id).toBe("string");
      expect(typeof preset.name).toBe("string");
      expect(typeof preset.delayMs).toBe("number");
      expect(typeof preset.feedback).toBe("number");
      expect(typeof preset.wet).toBe("number");
      expect(preset.delayMs).toBeGreaterThan(0);
      expect(preset.feedback).toBeGreaterThanOrEqual(0);
      expect(preset.feedback).toBeLessThanOrEqual(0.95);
      expect(preset.wet).toBeGreaterThanOrEqual(0);
      expect(preset.wet).toBeLessThanOrEqual(1);
    }
  });

  it("Preset echo matched die Spec-Defaults", () => {
    const echo = DELAY_PRESETS.find((p) => p.id === "echo");
    expect(echo).toBeDefined();
    expect(echo!.delayMs).toBe(250);
    expect(echo!.feedback).toBeCloseTo(0.4, 5);
    expect(echo!.wet).toBeCloseTo(0.4, 5);
  });
});
