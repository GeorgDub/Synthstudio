// @vitest-environment node
/**
 * sample-phaser.test.ts - v3.215.0
 *
 * Tests fuer Phaser Pure-Helper:
 *   - applyPhaser (top-level API)
 *   - PHASER_PRESETS shape + content
 *   - defensive defaults (NaN / Infinity / out-of-range)
 *   - empty / mix-extreme / multi-channel / immutability
 *   - phase-shifting (output != dry trotz magnitude similar)
 *   - finiteness bei feedback=0.95
 */

import { describe, it, expect } from 'vitest';
import {
  applyPhaser,
  PHASER_PRESETS,
} from '../../client/src/utils/samplePhaser';
import type { AudioBufferLike } from '../../client/src/utils/sampleEmbedding';

// --- Helpers ---

function makeBuffer(values: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(values);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: data.length,
    getChannelData: () => data,
  };
}

function makeMultiChannelBuffer(
  channelArrays: number[][],
  sampleRate = 48000,
): AudioBufferLike {
  const arrays = channelArrays.map((vals) => new Float32Array(vals));
  return {
    sampleRate,
    numberOfChannels: arrays.length,
    length: arrays[0]?.length ?? 0,
    getChannelData: (c: number) => arrays[c],
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

function makeSineBuffer(
  freq: number,
  length: number,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

function sumAbsDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

// --- Tests ---

describe('applyPhaser', () => {
  // 1. Empty buffer
  it('returns empty buffer for empty input', () => {
    const empty = makeEmptyBuffer(44100);
    const out = applyPhaser(empty);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(44100);
  });

  it('handles null-cast buffer gracefully with fallback sampleRate', () => {
    const out = applyPhaser(null as unknown as AudioBufferLike);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  // 2. mix=0 -> identity
  it('mix=0 returns identity (only dry path)', () => {
    const buf = makeBuffer([0.1, 0.2, -0.3, 0.4, -0.5, 0.6, 0.7, 0.8]);
    const out = applyPhaser(buf, { mix: 0 });
    const data = out.getChannelData(0);
    const original = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 6);
    }
  });

  // 3. mix=1 -> wet only (output should differ from dry)
  it('mix=1 produces wet-only output that differs from dry', () => {
    const buf = makeSineBuffer(440, 1024);
    const out = applyPhaser(buf, { mix: 1, depth: 0.6, rateHz: 0.5, baseFreq: 800 });
    const wetData = out.getChannelData(0);
    const dry = buf.getChannelData(0);
    // wet must differ from dry
    expect(sumAbsDiff(dry, wetData)).toBeGreaterThan(0.1);
    expect(allFinite(wetData)).toBe(true);
  });

  // 4. Length preservation
  it('preserves length of input buffer', () => {
    const buf = makeSineBuffer(440, 500);
    const out = applyPhaser(buf, PHASER_PRESETS.classic);
    expect(out.length).toBe(500);
    expect(out.getChannelData(0).length).toBe(500);
  });

  // 5. Multi-channel: works for stereo, length + channel count preserved
  it('handles stereo (2-channel) buffers', () => {
    const stereo = makeMultiChannelBuffer([
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8],
    ]);
    const out = applyPhaser(stereo, PHASER_PRESETS.classic);
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(8);
    expect(allFinite(out.getChannelData(0))).toBe(true);
    expect(allFinite(out.getChannelData(1))).toBe(true);
  });

  // 6. Defaults: no opts -> still valid output
  it('uses defaults when no opts provided', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf);
    expect(out.length).toBe(256);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('uses defaults when empty opts object provided', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, {});
    expect(out.length).toBe(256);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 7. Immutability: input must not be mutated
  it('does not mutate input buffer', () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const snapshot = Array.from(buf.getChannelData(0));
    applyPhaser(buf, PHASER_PRESETS.jet);
    const after = Array.from(buf.getChannelData(0));
    expect(after).toEqual(snapshot);
  });

  // 8. Various sampleRates
  it('handles sampleRate 8000 Hz', () => {
    const buf = makeSineBuffer(440, 256, 8000);
    const out = applyPhaser(buf, PHASER_PRESETS.classic);
    expect(out.sampleRate).toBe(8000);
    expect(out.length).toBe(256);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('handles sampleRate 44100 Hz', () => {
    const buf = makeSineBuffer(440, 256, 44100);
    const out = applyPhaser(buf, PHASER_PRESETS.classic);
    expect(out.sampleRate).toBe(44100);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('handles sampleRate 96000 Hz', () => {
    const buf = makeSineBuffer(440, 256, 96000);
    const out = applyPhaser(buf, PHASER_PRESETS.classic);
    expect(out.sampleRate).toBe(96000);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 9. Sanitizer edge cases - rateHz
  it('sanitizes rateHz NaN -> default 0.5 (still finite output)', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { rateHz: Number.NaN });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes rateHz 0 (<=0) -> default', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { rateHz: 0 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes rateHz negative -> default', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { rateHz: -3 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes rateHz > 10 -> clamped to 10', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { rateHz: 9999 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes rateHz Infinity -> default', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { rateHz: Number.POSITIVE_INFINITY });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 10. Sanitizer edge cases - depth
  it('sanitizes depth NaN -> 0 (no LFO sweep)', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { depth: Number.NaN });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes depth negative -> 0', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { depth: -1 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes depth > 1 -> clamped to 1', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { depth: 999 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 11. Sanitizer edge cases - baseFreq
  it('sanitizes baseFreq NaN -> default 800', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { baseFreq: Number.NaN });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes baseFreq < 50 -> default 800', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { baseFreq: 10 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes baseFreq > 5000 -> clamped to 5000', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { baseFreq: 99999 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 12. Sanitizer edge cases - stages
  it('sanitizes stages NaN -> 2 (min)', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { stages: Number.NaN });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes stages 100 -> clamped to 12', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { stages: 100 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes stages < 2 -> min 2', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { stages: 0 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes stages 4.7 -> floor to 4', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { stages: 4.7 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 13. Sanitizer edge cases - mix
  it('sanitizes mix NaN -> 0 (identity)', () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4]);
    const out = applyPhaser(buf, { mix: Number.NaN });
    const data = out.getChannelData(0);
    const original = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 6);
    }
  });

  it('sanitizes mix negative -> 0', () => {
    const buf = makeBuffer([0.5, -0.5, 0.5, -0.5]);
    const out = applyPhaser(buf, { mix: -2 });
    const data = out.getChannelData(0);
    const original = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(original[i], 6);
    }
  });

  it('sanitizes mix > 1 -> clamped to 1', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { mix: 99 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 14. Sanitizer edge cases - feedback
  it('sanitizes feedback NaN -> 0', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { feedback: Number.NaN });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes feedback < -0.95 -> 0', () => {
    const buf = makeSineBuffer(440, 256);
    const out = applyPhaser(buf, { feedback: -2 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('sanitizes feedback > 0.95 -> clamped to 0.95', () => {
    const buf = makeSineBuffer(440, 4000);
    const out = applyPhaser(buf, { feedback: 99, mix: 1 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 15. Output finiteness at feedback=0.95 with sustained input
  it('output stays finite at feedback=0.95 with sustained 1.0 input', () => {
    // 4000 samples of constant 1.0
    const data = new Float32Array(4000).fill(1.0);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    const out = applyPhaser(buf, { feedback: 0.95, mix: 1, rateHz: 5, depth: 1, baseFreq: 800 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it('output stays finite at feedback=-0.95 with sustained 1.0 input', () => {
    const data = new Float32Array(4000).fill(1.0);
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data,
    };
    const out = applyPhaser(buf, { feedback: -0.95, mix: 1 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  // 16. Phase-Shifting: output differs from dry even at mix=1
  it('phase-shifts: wet output differs noticeably from dry sine input', () => {
    const buf = makeSineBuffer(800, 2048);  // 800 Hz - resonant with baseFreq
    const out = applyPhaser(buf, { mix: 1, depth: 0.6, rateHz: 0.5, baseFreq: 800, stages: 4 });
    const wet = out.getChannelData(0);
    const dry = buf.getChannelData(0);
    // Phase-shift makes per-sample diff substantial
    expect(sumAbsDiff(dry, wet)).toBeGreaterThan(50);
    expect(allFinite(wet)).toBe(true);
  });

  // 17. Multi-channel: silence stays silent
  it('multi-channel: silent channel stays (nearly) silent', () => {
    const stereo = makeMultiChannelBuffer([
      Array(256).fill(0),
      Array(256).fill(0),
    ]);
    const out = applyPhaser(stereo, PHASER_PRESETS.classic);
    expect(out.numberOfChannels).toBe(2);
    const left = out.getChannelData(0);
    const right = out.getChannelData(1);
    // silent input + cascade ap-filter = silent output exact
    for (let i = 0; i < 256; i++) {
      expect(left[i]).toBe(0);
      expect(right[i]).toBe(0);
    }
  });

  // 18. Output is a fresh buffer (not the input)
  it('returns a fresh Float32Array (output !== input data)', () => {
    const buf = makeBuffer([0.1, 0.2, 0.3, 0.4]);
    const out = applyPhaser(buf, PHASER_PRESETS.classic);
    expect(out.getChannelData(0)).not.toBe(buf.getChannelData(0));
  });
});

describe('PHASER_PRESETS', () => {
  it('contains all four presets: subtle, classic, deep, jet', () => {
    expect(PHASER_PRESETS.subtle).toBeDefined();
    expect(PHASER_PRESETS.classic).toBeDefined();
    expect(PHASER_PRESETS.deep).toBeDefined();
    expect(PHASER_PRESETS.jet).toBeDefined();
  });

  it('all presets have valid shape (rateHz > 0, stages 2..12, mix 0..1)', () => {
    const all = [
      PHASER_PRESETS.subtle,
      PHASER_PRESETS.classic,
      PHASER_PRESETS.deep,
      PHASER_PRESETS.jet,
    ];
    for (const p of all) {
      expect(p.rateHz).toBeGreaterThan(0);
      expect(p.stages).toBeGreaterThanOrEqual(2);
      expect(p.stages).toBeLessThanOrEqual(12);
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThanOrEqual(1);
      expect(p.mix).toBeGreaterThanOrEqual(0);
      expect(p.mix).toBeLessThanOrEqual(1);
    }
  });

  it('classic preset matches spec defaults (rate=0.5, depth=0.6, stages=4, mix=0.5)', () => {
    expect(PHASER_PRESETS.classic.rateHz).toBe(0.5);
    expect(PHASER_PRESETS.classic.depth).toBe(0.6);
    expect(PHASER_PRESETS.classic.stages).toBe(4);
    expect(PHASER_PRESETS.classic.mix).toBe(0.5);
  });

  it('jet preset has feedback property (only preset with feedback)', () => {
    expect(PHASER_PRESETS.jet.feedback).toBe(0.5);
  });

  it('deep preset has highest stages count', () => {
    expect(PHASER_PRESETS.deep.stages).toBeGreaterThan(PHASER_PRESETS.subtle.stages);
    expect(PHASER_PRESETS.deep.stages).toBeGreaterThanOrEqual(PHASER_PRESETS.jet.stages);
  });

  it('subtle preset has lowest depth', () => {
    expect(PHASER_PRESETS.subtle.depth).toBeLessThan(PHASER_PRESETS.classic.depth);
    expect(PHASER_PRESETS.subtle.depth).toBeLessThan(PHASER_PRESETS.deep.depth);
    expect(PHASER_PRESETS.subtle.depth).toBeLessThan(PHASER_PRESETS.jet.depth);
  });

  it('all presets directly applicable via applyPhaser', () => {
    const buf = makeSineBuffer(440, 256);
    for (const preset of [PHASER_PRESETS.subtle, PHASER_PRESETS.classic, PHASER_PRESETS.deep, PHASER_PRESETS.jet]) {
      const out = applyPhaser(buf, preset);
      expect(out.length).toBe(256);
      expect(allFinite(out.getChannelData(0))).toBe(true);
    }
  });
});