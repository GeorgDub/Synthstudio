/**
 * Synthstudio – tests/features/beat-repeat.test.ts (v3.142.0)
 *
 * Tests für applyBeatRepeat + rateSamplesFromBpm.
 */
import { describe, it, expect } from "vitest";
import type { AudioBufferLike } from "@/utils/sampleEmbedding";
import {
  applyBeatRepeat,
  rateSamplesFromBpm,
  BEAT_REPEAT_DIVISIONS,
  MIN_REPEAT_SAMPLES,
} from "@/utils/beatRepeat";

function makeBuffer(
  fn: (i: number) => number,
  length: number,
  channels = 1,
  sampleRate = 48000,
): AudioBufferLike {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i++) arr[i] = fn(i);
    data.push(arr);
  }
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: (c: number) => data[c],
  };
}

describe("beatRepeat", () => {
  describe("rateSamplesFromBpm", () => {
    it("liefert 12000 samples für 1/4 bei 120 BPM @ 48kHz", () => {
      // 60/120 = 0.5 sec/quarter; 0.5 × 48000 = 24000 samples. Bei division=1 (1/4) → 24000.
      // Wait: 1/4 = quarter = 1.0; 0.5sec * 48000 = 24000. Re-check.
      expect(rateSamplesFromBpm(120, 48000, 1.0)).toBe(24000);
    });

    it("liefert 12000 samples für 1/8 bei 120 BPM @ 48kHz", () => {
      // quarter=0.5sec → 1/8 = 0.25sec → 12000 samples
      expect(rateSamplesFromBpm(120, 48000, 0.5)).toBe(12000);
    });

    it("clampt auf MIN_REPEAT_SAMPLES bei extrem hoher BPM/kleinem division", () => {
      expect(rateSamplesFromBpm(120, 48000, 0.0001)).toBe(MIN_REPEAT_SAMPLES);
    });

    it("liefert MIN_REPEAT_SAMPLES bei invalid inputs (NaN, 0, negativ)", () => {
      expect(rateSamplesFromBpm(NaN, 48000, 1.0)).toBe(MIN_REPEAT_SAMPLES);
      expect(rateSamplesFromBpm(120, 0, 1.0)).toBe(MIN_REPEAT_SAMPLES);
      expect(rateSamplesFromBpm(-100, 48000, 1.0)).toBe(MIN_REPEAT_SAMPLES);
      expect(rateSamplesFromBpm(120, 48000, NaN)).toBe(MIN_REPEAT_SAMPLES);
    });
  });

  describe("BEAT_REPEAT_DIVISIONS", () => {
    it("enthält Standard-Note-Längen (1/2, 1/4, 1/8, 1/16, 1/32)", () => {
      expect(BEAT_REPEAT_DIVISIONS["1/4"]).toBe(1.0);
      expect(BEAT_REPEAT_DIVISIONS["1/8"]).toBe(0.5);
      expect(BEAT_REPEAT_DIVISIONS["1/16"]).toBe(0.25);
      expect(BEAT_REPEAT_DIVISIONS["1/32"]).toBe(0.125);
    });

    it("hat Triolen-Varianten 1/8T und 1/16T", () => {
      expect(BEAT_REPEAT_DIVISIONS["1/8T"]).toBeCloseTo(1 / 3, 5);
      expect(BEAT_REPEAT_DIVISIONS["1/16T"]).toBeCloseTo(1 / 6, 5);
    });
  });

  describe("applyBeatRepeat", () => {
    it("loopt die ersten N samples durch den ganzen Buffer (no feedback, no crossfade)", () => {
      // Input: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 (10 samples)
      const buf = makeBuffer((i) => i, 10);
      const out = applyBeatRepeat(buf, { rateSamples: 32 < 10 ? 32 : 4 });
      // rateSamples wird auf MIN_REPEAT_SAMPLES (16) gepushed, also >= len → no-op identical copy.
      // Test mit rate=4 → MIN=16 push → identische Kopie
      const ch = out.getChannelData(0);
      expect(Array.from(ch)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("loopt korrekt mit MIN_REPEAT_SAMPLES (16) und buffer länger als rate", () => {
      // rate=16 (minimum), buffer-length=64 → 4 repeats
      const buf = makeBuffer((i) => i, 64);
      const out = applyBeatRepeat(buf, { rateSamples: 16 });
      const ch = out.getChannelData(0);
      // Repeat 0: src[0..15] = 0..15
      expect(ch[0]).toBe(0);
      expect(ch[15]).toBe(15);
      // Repeat 1: src[0..15] = 0..15 (gleich gain, kein feedback)
      expect(ch[16]).toBe(0);
      expect(ch[31]).toBe(15);
      // Repeat 2
      expect(ch[32]).toBe(0);
      // Repeat 3
      expect(ch[48]).toBe(0);
      expect(ch[63]).toBe(15);
    });

    it("dämpft Repeats mit feedback=1.0 (jeder Repeat 50%)", () => {
      const buf = makeBuffer(() => 1.0, 64);
      const out = applyBeatRepeat(buf, { rateSamples: 16, feedback: 1.0 });
      const ch = out.getChannelData(0);
      // Repeat 0: gain = 1.0
      expect(ch[0]).toBeCloseTo(1.0, 5);
      // Repeat 1: gain = 0.5
      expect(ch[16]).toBeCloseTo(0.5, 5);
      // Repeat 2: gain = 0.25
      expect(ch[32]).toBeCloseTo(0.25, 5);
      // Repeat 3: gain = 0.125
      expect(ch[48]).toBeCloseTo(0.125, 5);
    });

    it("Identität bei rate >= length (no-op copy)", () => {
      const buf = makeBuffer((i) => i * 0.1, 10);
      const out = applyBeatRepeat(buf, { rateSamples: 100 });
      expect(out.length).toBe(10);
      const ch = out.getChannelData(0);
      for (let i = 0; i < 10; i++) {
        expect(ch[i]).toBeCloseTo(i * 0.1, 5);
      }
    });

    it("crossfade glättet Loop-Boundary (kein Hard-Cut)", () => {
      // src[0..15] linearer Ramp 0→15, dann Loop
      // ohne crossfade: ch[16] = 0 (hart von 15 auf 0)
      // mit crossfade=4: ch[16] = mix von src[12..15] und src[0..3]
      const buf = makeBuffer((i) => i, 64);
      const out = applyBeatRepeat(buf, { rateSamples: 16, crossfadeSamples: 4 });
      const ch = out.getChannelData(0);
      // ch[16] = (1-0)*src[12]*1 + (0)*src[0]*1 = 12
      // Eigentlich: t = 0/4 = 0, val = prev * 1 + cur * 0 = src[12]
      expect(ch[16]).toBeCloseTo(12, 5);
      // ch[19] = (1-3/4)*src[15] + (3/4)*src[3] = 0.25*15 + 0.75*3 = 3.75 + 2.25 = 6
      expect(ch[19]).toBeCloseTo(6, 5);
      // ch[20] = src[4] (kein crossfade mehr)
      expect(ch[20]).toBe(4);
    });

    it("handlet empty buffer ohne crash (returns 0-length empty)", () => {
      const buf: AudioBufferLike = {
        sampleRate: 48000,
        numberOfChannels: 0,
        length: 0,
        getChannelData: () => new Float32Array(0),
      };
      const out = applyBeatRepeat(buf, { rateSamples: 16 });
      expect(out.length).toBe(0);
      expect(out.numberOfChannels).toBe(0);
    });

    it("multi-channel: beide Kanäle werden gleich gelooped", () => {
      // L: i*0.1, R: i*0.2
      const buf = makeBuffer((i) => i * 0.1, 32, 2);
      // override channel 2:
      const r = buf.getChannelData(1);
      for (let i = 0; i < 32; i++) r[i] = i * 0.2;

      const out = applyBeatRepeat(buf, { rateSamples: 16 });
      // Repeat 1: L[16]=0, R[16]=0
      expect(out.getChannelData(0)[16]).toBeCloseTo(0, 5);
      expect(out.getChannelData(1)[16]).toBeCloseTo(0, 5);
      // Repeat 1: L[20]=0.4, R[20]=0.8
      expect(out.getChannelData(0)[20]).toBeCloseTo(0.4, 5);
      expect(out.getChannelData(1)[20]).toBeCloseTo(0.8, 5);
    });

    it("clampt invalid options (negative feedback, negative crossfade)", () => {
      const buf = makeBuffer(() => 1.0, 64);
      const out = applyBeatRepeat(buf, {
        rateSamples: 16,
        feedback: -0.5,
        crossfadeSamples: -10,
      });
      // negative feedback → clamp to 0 → no damping
      const ch = out.getChannelData(0);
      expect(ch[16]).toBe(1.0);
      expect(ch[63]).toBe(1.0);
    });
  });
});
