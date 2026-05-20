// @vitest-environment node
/**
 * sample-gain-envelope.test.ts — v3.212.0
 * Tests fuer ADSR-Gain-Envelope Pure-Helper.
 */

import { describe, it, expect } from "vitest";
import {
  applyAdsr,
  ADSR_PRESETS,
  DEFAULT_ATTACK_MS,
  DEFAULT_DECAY_MS,
  DEFAULT_SUSTAIN_LEVEL,
  DEFAULT_RELEASE_MS,
  MAX_ATTACK_MS,
  MAX_DECAY_MS,
  MAX_RELEASE_MS,
  FALLBACK_SAMPLE_RATE,
} from "../../client/src/utils/sampleGainEnvelope";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeBuffer(
  samples: number[],
  channels = 1,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: channels,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeStereoBuffer(L: number[], R: number[]): AudioBufferLike {
  const left = new Float32Array(L);
  const right = new Float32Array(R);
  return {
    sampleRate: 48000,
    numberOfChannels: 2,
    length: Math.max(L.length, R.length),
    getChannelData: (c: number) => (c === 0 ? left : right),
  };
}

function makeConstBuffer(
  value: number,
  length: number,
  channels = 1,
  sampleRate = 48000,
): AudioBufferLike {
  return makeBuffer(new Array(length).fill(value), channels, sampleRate);
}

function makeEmptyBuffer(sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("v3.212 applyAdsr basics", () => {
  it("empty buffer -> empty result with fallback sampleRate 48000", () => {
    const result = applyAdsr(makeEmptyBuffer(0));
    expect(result.length).toBe(0);
    expect(result.numberOfChannels).toBe(0);
    expect(result.sampleRate).toBe(FALLBACK_SAMPLE_RATE);
  });

  it("empty buffer preserves its own sampleRate", () => {
    const result = applyAdsr(makeEmptyBuffer(44100));
    expect(result.sampleRate).toBe(44100);
  });

  it("identity case: attackMs=0, sustain=1, releaseMs=0, decayMs=0 -> sample-exact identity", () => {
    const input = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const buf = makeBuffer(input);
    const out = applyAdsr(buf, {
      attackMs: 0,
      decayMs: 0,
      sustainLevel: 1,
      releaseMs: 0,
    });
    const data = Array.from(out.getChannelData(0));
    for (let i = 0; i < input.length; i++) {
      expect(data[i]).toBeCloseTo(input[i], 6);
    }
  });

  it("identity case with sustain=1 holds regardless of decayMs", () => {
    // Mit sustainLevel=1 liefert decay-Branch env = 1 + (1-1)*t = 1, also identity
    // egal welche decayMs gesetzt ist.
    const input = new Array(100).fill(0.5);
    const buf = makeBuffer(input);
    const out = applyAdsr(buf, {
      attackMs: 0,
      decayMs: 50,
      sustainLevel: 1,
      releaseMs: 0,
    });
    const data = Array.from(out.getChannelData(0));
    for (let i = 0; i < input.length; i++) {
      expect(data[i]).toBeCloseTo(0.5, 6);
    }
  });

  it("length preservation: output length == input length", () => {
    const buf = makeConstBuffer(1.0, 1000);
    const out = applyAdsr(buf, { attackMs: 50, decayMs: 50, sustainLevel: 0.5, releaseMs: 50 });
    expect(out.length).toBe(1000);
  });

  it("numberOfChannels preservation: stereo in -> stereo out", () => {
    const buf = makeStereoBuffer(new Array(500).fill(1), new Array(500).fill(0.5));
    const out = applyAdsr(buf);
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(500);
  });

  it("various sampleRates produce correct envelope timing (44100 vs 48000 vs 96000)", () => {
    for (const sr of [44100, 48000, 96000]) {
      const buf = makeConstBuffer(1.0, sr, 1, sr);
      const out = applyAdsr(buf, {
        attackMs: 100,
        decayMs: 0,
        sustainLevel: 1,
        releaseMs: 0,
      });
      const attackSamples = Math.floor((100 * sr) / 1000);
      // Mid-attack approximately 0.5
      const data = out.getChannelData(0);
      expect(data[Math.floor(attackSamples / 2)]).toBeCloseTo(0.5, 2);
    }
  });

  it("attack ramp linearity: mid-attack approximately 0.5", () => {
    // 10ms @ 48kHz = 480 samples, mid at 240, env = 240/480 = 0.5 exact
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, {
      attackMs: 10,
      decayMs: 0,
      sustainLevel: 1,
      releaseMs: 0,
    });
    const data = out.getChannelData(0);
    expect(data[240]).toBeCloseTo(0.5, 5);
  });

  it("attack first sample = 0 (ramp start)", () => {
    const buf = makeConstBuffer(1.0, 1000);
    const out = applyAdsr(buf, { attackMs: 5, decayMs: 0, sustainLevel: 1, releaseMs: 0 });
    expect(out.getChannelData(0)[0]).toBeCloseTo(0, 6);
  });

  it("release fades to approximately 0 at last sample", () => {
    // release 200ms @ 48k = 9600 samples; at i=totalSamples-1:
    //   t = (releaseSamples - 1) / releaseSamples => env = sustainLevel*(1/releaseSamples)
    // Total length must be larger than attack+decay+release.
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, {
      attackMs: 10,
      decayMs: 50,
      sustainLevel: 0.7,
      releaseMs: 200,
    });
    const data = out.getChannelData(0);
    expect(data[data.length - 1]).toBeCloseTo(0, 3);
  });

  it("pluck preset: short attack, low sustain -> ramp-down test", () => {
    // sample of constant 1.0 for 48000 samples (1s @ 48k)
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, ADSR_PRESETS.pluck);
    const data = out.getChannelData(0);
    // attack 1ms -> 48 samples; decay 50ms -> 2400 samples
    // After attack+decay, env should be approximately sustainLevel = 0.3
    expect(data[2448]).toBeCloseTo(0.3, 2);
    // Last sample should approach 0 (release 100ms = 4800 samples)
    expect(data[data.length - 1]).toBeCloseTo(0, 2);
  });

  it("pad preset: long attack, high sustain", () => {
    // 2 seconds @ 48k = 96000 samples - enough room for pad's 500ms attack
    const buf = makeConstBuffer(1.0, 96000);
    const out = applyAdsr(buf, ADSR_PRESETS.pad);
    const data = out.getChannelData(0);
    // attack 500ms -> 24000 samples; decay 200ms -> 9600 samples
    // sustain region begins at sample 33600
    // At mid attack (12000), env should be approximately 0.5
    expect(data[12000]).toBeCloseTo(0.5, 2);
    // In sustain region, env should be 0.8
    expect(data[40000]).toBeCloseTo(0.8, 2);
  });

  it("multi-channel symmetry: same envelope applied to each channel", () => {
    // L and R both constant 1.0, envelope should produce identical curves
    const L = new Array(1000).fill(1.0);
    const R = new Array(1000).fill(1.0);
    const buf = makeStereoBuffer(L, R);
    const out = applyAdsr(buf, {
      attackMs: 10,
      decayMs: 20,
      sustainLevel: 0.5,
      releaseMs: 10,
    });
    const left = out.getChannelData(0);
    const right = out.getChannelData(1);
    for (let i = 0; i < left.length; i++) {
      expect(left[i]).toBeCloseTo(right[i], 6);
    }
  });

  it("output amplitude clamped 0..1 times input value (no overshoot)", () => {
    const buf = makeConstBuffer(1.0, 5000);
    const out = applyAdsr(buf, {
      attackMs: 5,
      decayMs: 10,
      sustainLevel: 0.7,
      releaseMs: 20,
    });
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1.0);
    }
  });

  it("immutability: original input buffer unchanged", () => {
    const orig = [0.1, 0.2, 0.3, 0.4, 0.5];
    const buf = makeBuffer([...orig]);
    const before = Array.from(buf.getChannelData(0));
    applyAdsr(buf, { attackMs: 1, decayMs: 1, sustainLevel: 0.5, releaseMs: 1 });
    const after = Array.from(buf.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("output not aliased with input", () => {
    const buf = makeConstBuffer(0.5, 100);
    const out = applyAdsr(buf);
    expect(out.getChannelData(0)).not.toBe(buf.getChannelData(0));
  });

  it("getChannelData out-of-range throws RangeError", () => {
    const buf = makeConstBuffer(1.0, 10);
    const out = applyAdsr(buf);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
    expect(() => out.getChannelData(1)).toThrow(RangeError);
  });

  it("defaults: applyAdsr() with no opts uses 10/100/0.7/200", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf);
    const data = out.getChannelData(0);
    // attack default 10ms -> 480 samples, mid@240 -> 0.5
    expect(data[240]).toBeCloseTo(0.5, 2);
    // sustain region: after attack(480) + decay(4800) = 5280
    // Hold until release start = 48000 - (200ms*48 samples) = 48000 - 9600 = 38400
    expect(data[20000]).toBeCloseTo(DEFAULT_SUSTAIN_LEVEL, 2);
  });

  it("attack+decay+release > totalSamples -> proportional scaling, no crash", () => {
    // 100ms total but ADSR sums to 10+100+200 = 310ms -> must scale down
    const buf = makeConstBuffer(1.0, 4800); // 100ms @ 48k
    const out = applyAdsr(buf, {
      attackMs: 10,
      decayMs: 100,
      sustainLevel: 0.5,
      releaseMs: 200,
    });
    expect(out.length).toBe(4800);
    const data = out.getChannelData(0);
    // No NaN/Infinity
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
  });
});

describe("v3.212 sanitizers", () => {
  it("attackMs NaN -> default 10", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const outDefault = applyAdsr(buf, { attackMs: 10, decayMs: 0, sustainLevel: 1, releaseMs: 0 });
    const outNaN = applyAdsr(buf, { attackMs: NaN, decayMs: 0, sustainLevel: 1, releaseMs: 0 });
    expect(outNaN.getChannelData(0)[240]).toBeCloseTo(outDefault.getChannelData(0)[240], 5);
  });

  it("attackMs negative -> default 10", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: -100, decayMs: 0, sustainLevel: 1, releaseMs: 0 });
    // attack default 10ms -> 480 samples; mid@240 approximately 0.5
    expect(out.getChannelData(0)[240]).toBeCloseTo(0.5, 2);
  });

  it("attackMs > MAX (99999) -> clamp 10000", () => {
    // sampleRate=1000 -> 10000ms attack = 10000 samples. Buffer 15000.
    const buf = makeConstBuffer(1.0, 15000, 1, 1000);
    const out = applyAdsr(buf, {
      attackMs: 99999,
      decayMs: 0,
      sustainLevel: 1,
      releaseMs: 0,
    });
    // attack 10000 samples, mid@5000 -> 0.5
    expect(out.getChannelData(0)[5000]).toBeCloseTo(0.5, 2);
  });

  it("attackMs +Infinity -> clamp to MAX 10000", () => {
    const buf = makeConstBuffer(1.0, 15000, 1, 1000);
    const out = applyAdsr(buf, {
      attackMs: Infinity,
      decayMs: 0,
      sustainLevel: 1,
      releaseMs: 0,
    });
    expect(out.getChannelData(0)[5000]).toBeCloseTo(0.5, 2);
  });

  it("attackMs -Infinity -> default 10", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: -Infinity, decayMs: 0, sustainLevel: 1, releaseMs: 0 });
    // attack default 10ms -> 480 samples; mid@240
    expect(out.getChannelData(0)[240]).toBeCloseTo(0.5, 2);
  });

  it("decayMs NaN -> default 100", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: NaN, sustainLevel: 0.5, releaseMs: 0 });
    // decay default 100ms -> 4800 samples; at sample 4800 should reach sustain 0.5
    expect(out.getChannelData(0)[4800]).toBeCloseTo(0.5, 2);
  });

  it("decayMs > MAX -> clamp 10000", () => {
    // sampleRate=1000 -> 10000ms decay = 10000 samples. Buffer 15000.
    const buf = makeConstBuffer(1.0, 15000, 1, 1000);
    const out = applyAdsr(buf, {
      attackMs: 0,
      decayMs: 99999,
      sustainLevel: 0.5,
      releaseMs: 0,
    });
    // decay ends at sample 10000 -> env = sustain = 0.5
    expect(out.getChannelData(0)[10000]).toBeCloseTo(0.5, 2);
  });

  it("sustainLevel NaN -> 0 (NOT default)", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: 0, sustainLevel: NaN, releaseMs: 0 });
    // sustain = 0 -> envelope = 0 throughout sustain region
    // attack=0, decay=0, release=0, totalSamples=48000 -> sustain region = all samples
    expect(out.getChannelData(0)[24000]).toBeCloseTo(0, 5);
  });

  it("sustainLevel undefined -> default 0.7", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: 0, releaseMs: 0 });
    expect(out.getChannelData(0)[24000]).toBeCloseTo(DEFAULT_SUSTAIN_LEVEL, 5);
  });

  it("sustainLevel negative -> 0", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: 0, sustainLevel: -0.5, releaseMs: 0 });
    expect(out.getChannelData(0)[24000]).toBeCloseTo(0, 5);
  });

  it("sustainLevel > 1 -> clamp 1", () => {
    const buf = makeConstBuffer(0.5, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: 0, sustainLevel: 99, releaseMs: 0 });
    // sustain=1 -> env=1 -> output=0.5
    expect(out.getChannelData(0)[24000]).toBeCloseTo(0.5, 5);
  });

  it("sustainLevel +Infinity -> clamp 1", () => {
    const buf = makeConstBuffer(0.5, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: 0, sustainLevel: Infinity, releaseMs: 0 });
    expect(out.getChannelData(0)[24000]).toBeCloseTo(0.5, 5);
  });

  it("releaseMs NaN -> default 200", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: 0, sustainLevel: 0.5, releaseMs: NaN });
    // release default 200ms -> 9600 samples; release starts at 48000-9600=38400
    // at last sample env approximately 0
    expect(out.getChannelData(0)[48000 - 1]).toBeCloseTo(0, 3);
  });

  it("releaseMs > MAX -> clamp 20000 (not 10000!)", () => {
    // releaseMs 99999 should be clamped to 20000ms.
    // Use small sampleRate (1000) so 20000ms = 20000 samples; use 30000-sample buffer.
    const buf = makeConstBuffer(1.0, 30000, 1, 1000);
    const out = applyAdsr(buf, {
      attackMs: 0,
      decayMs: 0,
      sustainLevel: 1,
      releaseMs: 99999,
    });
    // release should be 20000ms @ 1000Hz = 20000 samples, releaseStart = 30000-20000 = 10000
    // Mid-release at 10000 + 10000 = 20000 -> t = 10000/20000 = 0.5 -> env = 0.5
    expect(out.getChannelData(0)[20000]).toBeCloseTo(0.5, 2);
  });

  it("releaseMs +Infinity -> clamp 20000", () => {
    const buf = makeConstBuffer(1.0, 30000, 1, 1000);
    const out = applyAdsr(buf, {
      attackMs: 0,
      decayMs: 0,
      sustainLevel: 1,
      releaseMs: Infinity,
    });
    // Mid-release should be 0.5
    expect(out.getChannelData(0)[20000]).toBeCloseTo(0.5, 2);
  });

  it("releaseMs negative -> default 200", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf, { attackMs: 0, decayMs: 0, sustainLevel: 0.5, releaseMs: -100 });
    // release default 200ms
    expect(out.getChannelData(0)[48000 - 1]).toBeCloseTo(0, 3);
  });

  it("opts undefined -> defaults all", () => {
    const buf = makeConstBuffer(1.0, 48000);
    const out = applyAdsr(buf);
    expect(out.length).toBe(48000);
    // No crash, finite output
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
  });

  it("all-Infinity opts -> all clamped finite output", () => {
    // attack/decay clamp to 10000ms, release to 20000ms, sustain to 1.
    // Use a smaller buffer so all phases must scale down -> covers scaling AND finite check.
    const buf = makeConstBuffer(1.0, 4800); // 100ms @ 48k - all phases must scale
    const out = applyAdsr(buf, {
      attackMs: Infinity,
      decayMs: Infinity,
      sustainLevel: Infinity,
      releaseMs: Infinity,
    });
    const data = out.getChannelData(0);
    // Sentinel checks at start/mid/end + spot samples
    expect(Number.isFinite(data[0])).toBe(true);
    expect(Number.isFinite(data[2400])).toBe(true);
    expect(Number.isFinite(data[data.length - 1])).toBe(true);
    // Full scan (smaller buffer now, fast)
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
    }
  });
});

describe("v3.212 ADSR_PRESETS", () => {
  it("contains 4 expected presets", () => {
    expect(ADSR_PRESETS.pluck).toBeDefined();
    expect(ADSR_PRESETS.pad).toBeDefined();
    expect(ADSR_PRESETS.stab).toBeDefined();
    expect(ADSR_PRESETS.drone).toBeDefined();
  });

  it("pluck preset values match spec", () => {
    expect(ADSR_PRESETS.pluck.attackMs).toBe(1);
    expect(ADSR_PRESETS.pluck.decayMs).toBe(50);
    expect(ADSR_PRESETS.pluck.sustainLevel).toBe(0.3);
    expect(ADSR_PRESETS.pluck.releaseMs).toBe(100);
  });

  it("pad preset values match spec", () => {
    expect(ADSR_PRESETS.pad.attackMs).toBe(500);
    expect(ADSR_PRESETS.pad.decayMs).toBe(200);
    expect(ADSR_PRESETS.pad.sustainLevel).toBe(0.8);
    expect(ADSR_PRESETS.pad.releaseMs).toBe(1000);
  });

  it("stab preset values match spec", () => {
    expect(ADSR_PRESETS.stab.attackMs).toBe(5);
    expect(ADSR_PRESETS.stab.decayMs).toBe(30);
    expect(ADSR_PRESETS.stab.sustainLevel).toBe(0.5);
    expect(ADSR_PRESETS.stab.releaseMs).toBe(100);
  });

  it("drone preset values match spec", () => {
    expect(ADSR_PRESETS.drone.attackMs).toBe(2000);
    expect(ADSR_PRESETS.drone.decayMs).toBe(500);
    expect(ADSR_PRESETS.drone.sustainLevel).toBe(0.95);
    expect(ADSR_PRESETS.drone.releaseMs).toBe(2000);
  });

  it("all presets produce finite output of correct length", () => {
    // 5s @ 48k - room for drone (attack 2000ms + decay 500ms + release 2000ms = 4500ms)
    const buf = makeConstBuffer(1.0, 240000);
    for (const presetName of Object.keys(ADSR_PRESETS) as (keyof typeof ADSR_PRESETS)[]) {
      const out = applyAdsr(buf, ADSR_PRESETS[presetName]);
      expect(out.length).toBe(buf.length);
      const data = out.getChannelData(0);
      // Spot-check sentinels: first, last, middle
      expect(Number.isFinite(data[0])).toBe(true);
      expect(Number.isFinite(data[Math.floor(data.length / 2)])).toBe(true);
      expect(Number.isFinite(data[data.length - 1])).toBe(true);
    }
  });
});

describe("v3.212 constants exports", () => {
  it("DEFAULT_ATTACK_MS = 10", () => expect(DEFAULT_ATTACK_MS).toBe(10));
  it("DEFAULT_DECAY_MS = 100", () => expect(DEFAULT_DECAY_MS).toBe(100));
  it("DEFAULT_SUSTAIN_LEVEL = 0.7", () => expect(DEFAULT_SUSTAIN_LEVEL).toBe(0.7));
  it("DEFAULT_RELEASE_MS = 200", () => expect(DEFAULT_RELEASE_MS).toBe(200));
  it("MAX_ATTACK_MS = 10000", () => expect(MAX_ATTACK_MS).toBe(10000));
  it("MAX_DECAY_MS = 10000", () => expect(MAX_DECAY_MS).toBe(10000));
  it("MAX_RELEASE_MS = 20000", () => expect(MAX_RELEASE_MS).toBe(20000));
  it("FALLBACK_SAMPLE_RATE = 48000", () => expect(FALLBACK_SAMPLE_RATE).toBe(48000));
});
