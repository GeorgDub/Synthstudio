/**
 * tests/features/sample-transform.test.ts (v3.116.0)
 *
 * Unit-Tests für client/src/utils/sampleTransform.ts.
 * Pure-fn Coverage: Stretch + Pitch-Shift + Combined-Transform.
 *
 * Reuse: existing timeStretchBuffer (OLA) → wir testen primär die Wrapper-
 * Logik (Clamp, Identity-Shortcut, Resample-Roundtrip, Mehrkanal-Erhaltung).
 */
import { describe, it, expect } from "vitest";
import {
  stretchSample,
  pitchShiftSample,
  combinedTransform,
  semitonesToRatio,
  resampleLinear,
  STRETCH_MIN,
  STRETCH_MAX,
  PITCH_MIN,
  PITCH_MAX,
} from "../../client/src/utils/sampleTransform";

// ─── Mock AudioBuffer + Context ─────────────────────────────────────────────

class MockAudioBuffer implements AudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private data: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c: number): Float32Array { return this.data[c]; }
  copyFromChannel(): void {}
  copyToChannel(): void {}
}

class MockAudioContext {
  createBuffer(c: number, l: number, sr: number) {
    return new MockAudioBuffer(c, l, sr) as unknown as AudioBuffer;
  }
}
const ctx = new MockAudioContext() as unknown as BaseAudioContext;

function makeSineBuffer(durationSec: number, freq: number, sr = 44100, channels = 1): AudioBuffer {
  const length = Math.round(durationSec * sr);
  const buf = new MockAudioBuffer(channels, length, sr);
  for (let c = 0; c < channels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return buf as unknown as AudioBuffer;
}

// ─── semitonesToRatio ────────────────────────────────────────────────────────

describe("semitonesToRatio", () => {
  it("0 semitones → 1.0 (identity)", () => {
    expect(semitonesToRatio(0)).toBeCloseTo(1, 6);
  });

  it("+12 semitones → 2.0 (one octave up)", () => {
    expect(semitonesToRatio(12)).toBeCloseTo(2, 6);
  });

  it("-12 semitones → 0.5 (one octave down)", () => {
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 6);
  });

  it("+7 semitones ≈ 1.4983 (perfect fifth)", () => {
    expect(semitonesToRatio(7)).toBeCloseTo(1.4983, 3);
  });
});

// ─── resampleLinear ──────────────────────────────────────────────────────────

describe("resampleLinear", () => {
  it("outLength === source.length → exakte Kopie", () => {
    const src = new Float32Array([1, 2, 3, 4]);
    const out = resampleLinear(src, 4);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  it("Verdopplung (outLength=2×): Interpolation zwischen den Originalen", () => {
    const src = new Float32Array([0, 1]);
    const out = resampleLinear(src, 3);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0.5, 5);
    expect(out[2]).toBeCloseTo(1, 5);
  });

  it("Halbierung (outLength=½): nimmt jedes zweite Sample (mit Interpolation)", () => {
    const src = new Float32Array([0, 1, 2, 3]);
    const out = resampleLinear(src, 2);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(3, 5);
  });

  it("Leere Source → Zero-Output ohne Crash", () => {
    const out = resampleLinear(new Float32Array(0), 5);
    expect(out.length).toBe(5);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0]);
  });
});

// ─── stretchSample ───────────────────────────────────────────────────────────

describe("stretchSample", () => {
  it("ratio=1.0 → gleiche Länge (Identity)", () => {
    const src = makeSineBuffer(0.1, 440);
    const out = stretchSample(ctx, src, 1.0);
    expect(out.length).toBe(src.length);
    expect(out).not.toBe(src); // immutable: neue Instanz
  });

  it("ratio=2.0 → doppelte Länge (innerhalb 5% Toleranz wegen OLA-Padding)", () => {
    const src = makeSineBuffer(0.1, 440);
    const out = stretchSample(ctx, src, 2.0);
    expect(out.length).toBeGreaterThan(src.length * 1.9);
    expect(out.length).toBeLessThan(src.length * 2.1);
  });

  it("ratio=0.5 → halbe Länge", () => {
    const src = makeSineBuffer(0.1, 440);
    const out = stretchSample(ctx, src, 0.5);
    expect(out.length).toBeGreaterThan(src.length * 0.4);
    expect(out.length).toBeLessThan(src.length * 0.6);
  });

  it("Clamp: ratio < STRETCH_MIN wird auf MIN geclampt (kein Crash, kein NaN)", () => {
    const src = makeSineBuffer(0.1, 440);
    const out = stretchSample(ctx, src, 0.01);
    // Erwartete Länge = src.length * STRETCH_MIN (≈25%)
    expect(out.length).toBeGreaterThan(src.length * 0.2);
    expect(out.length).toBeLessThan(src.length * 0.3);
  });

  it("Clamp: ratio > STRETCH_MAX wird auf MAX geclampt", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = stretchSample(ctx, src, 100);
    // Erwartete Länge ≈ src.length * STRETCH_MAX (4×)
    expect(out.length).toBeGreaterThan(src.length * 3.5);
    expect(out.length).toBeLessThan(src.length * 4.5);
    void STRETCH_MAX; // tsc-Anchor
  });

  it("NaN ratio → Identity-Fallback (gleiche Länge)", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = stretchSample(ctx, src, NaN);
    expect(out.length).toBe(src.length);
  });

  it("Leerer Buffer wirft Error", () => {
    const empty = new MockAudioBuffer(1, 0, 44100) as unknown as AudioBuffer;
    expect(() => stretchSample(ctx, empty, 1.5)).toThrow(/length 0/);
  });

  it("Stereo-Eingang erhält Kanalzahl", () => {
    const src = makeSineBuffer(0.05, 440, 44100, 2);
    const out = stretchSample(ctx, src, 1.5);
    expect(out.numberOfChannels).toBe(2);
  });
});

// ─── pitchShiftSample ────────────────────────────────────────────────────────

describe("pitchShiftSample", () => {
  it("semitones=0 → gleiche Länge (Identity)", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = pitchShiftSample(ctx, src, 0);
    expect(out.length).toBe(src.length);
  });

  it("semitones=12 (Oktave hoch): preserves length", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = pitchShiftSample(ctx, src, 12);
    // Länge bleibt erhalten (round-Rundung erlaubt ±1 Sample-Toleranz)
    expect(Math.abs(out.length - src.length)).toBeLessThanOrEqual(1);
  });

  it("semitones=-12 (Oktave runter): preserves length", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = pitchShiftSample(ctx, src, -12);
    expect(Math.abs(out.length - src.length)).toBeLessThanOrEqual(1);
  });

  it("Clamp: semitones > PITCH_MAX wird auf MAX geclampt (kein Crash)", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = pitchShiftSample(ctx, src, 99);
    expect(Math.abs(out.length - src.length)).toBeLessThanOrEqual(1);
    void PITCH_MAX;
  });

  it("Clamp: semitones < PITCH_MIN wird auf MIN geclampt", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = pitchShiftSample(ctx, src, -99);
    expect(Math.abs(out.length - src.length)).toBeLessThanOrEqual(1);
    void PITCH_MIN;
  });

  it("NaN semitones → Identity (gleiche Länge)", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = pitchShiftSample(ctx, src, NaN);
    expect(out.length).toBe(src.length);
  });

  it("Leerer Buffer wirft Error", () => {
    const empty = new MockAudioBuffer(1, 0, 44100) as unknown as AudioBuffer;
    expect(() => pitchShiftSample(ctx, empty, 5)).toThrow(/length 0/);
  });

  it("Stereo-Pitch-Shift erhält Kanalzahl", () => {
    const src = makeSineBuffer(0.05, 440, 44100, 2);
    const out = pitchShiftSample(ctx, src, 7);
    expect(out.numberOfChannels).toBe(2);
  });
});

// ─── combinedTransform ───────────────────────────────────────────────────────

describe("combinedTransform", () => {
  it("ratio=1, semitones=0 → Identity (gleiche Länge, neue Instanz)", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = combinedTransform(ctx, src, 1, 0);
    expect(out.length).toBe(src.length);
    expect(out).not.toBe(src);
  });

  it("Stretch + Pitch unabhängig: ratio=2, semitones=0 → 2× Länge, Pitch unverändert", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = combinedTransform(ctx, src, 2, 0);
    expect(out.length).toBeGreaterThan(src.length * 1.9);
    expect(out.length).toBeLessThan(src.length * 2.1);
  });

  it("Stretch + Pitch: ratio=1, semitones=+12 → Original-Länge (Pitch up)", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = combinedTransform(ctx, src, 1, 12);
    expect(Math.abs(out.length - src.length)).toBeLessThanOrEqual(1);
  });

  it("Stretch + Pitch combined: ratio=2, semitones=+12 → 2× Länge, Pitch up", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = combinedTransform(ctx, src, 2, 12);
    expect(Math.abs(out.length - src.length * 2)).toBeLessThanOrEqual(2);
  });

  it("Leerer Buffer wirft Error", () => {
    const empty = new MockAudioBuffer(1, 0, 44100) as unknown as AudioBuffer;
    expect(() => combinedTransform(ctx, empty, 1.5, 3)).toThrow(/length 0/);
  });

  it("Clamp greift bei Combined: ratio=0.01, semitones=99 → keine NaN-Länge", () => {
    const src = makeSineBuffer(0.05, 440);
    const out = combinedTransform(ctx, src, 0.01, 99);
    expect(Number.isFinite(out.length)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    void STRETCH_MIN;
  });
});

// ─── Stretch-Preset-Konstanten ───────────────────────────────────────────────

describe("Konstanten", () => {
  it("STRETCH_MIN < 1 < STRETCH_MAX", () => {
    expect(STRETCH_MIN).toBeLessThan(1);
    expect(STRETCH_MAX).toBeGreaterThan(1);
  });

  it("PITCH_MIN < 0 < PITCH_MAX", () => {
    expect(PITCH_MIN).toBeLessThan(0);
    expect(PITCH_MAX).toBeGreaterThan(0);
  });

  it("PITCH_MIN = -24, PITCH_MAX = +24", () => {
    expect(PITCH_MIN).toBe(-24);
    expect(PITCH_MAX).toBe(24);
  });
});
