/**
 * tests/features/audio-edit.test.ts
 *
 * Unit-Tests für die Audacity-ähnlichen Audio-Bearbeitungs-Utilities.
 */
import { describe, it, expect } from "vitest";
import {
  trimBuffer, reverseBuffer, normalizeBuffer,
  fadeIn, fadeOut, insertSilence, applyGain,
  cutSelection, pasteBuffer, getPeak, getRms,
} from "../../client/src/audio/../utils/audioEdit";

// ─── Mock AudioBuffer ─────────────────────────────────────────────────────────

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

function makeSineBuffer(durationSec: number, freq: number, sr = 44100): AudioBuffer {
  const length = Math.round(durationSec * sr);
  const buf = new MockAudioBuffer(1, length, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return buf as unknown as AudioBuffer;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("trimBuffer", () => {
  it("schneidet einen Ausschnitt korrekt heraus", () => {
    const src = makeSineBuffer(2, 440);
    const trimmed = trimBuffer(ctx, src, 0.5, 1.5);
    expect(trimmed.length).toBe(44100); // 1 Sekunde
  });

  it("clamping bei out-of-range startSec", () => {
    const src = makeSineBuffer(1, 440);
    const trimmed = trimBuffer(ctx, src, -1, 0.5);
    expect(trimmed.length).toBeGreaterThan(0);
  });
});

describe("reverseBuffer", () => {
  it("kehrt den Buffer korrekt um", () => {
    const src = makeSineBuffer(0.01, 1000);
    const reversed = reverseBuffer(ctx, src);
    expect(reversed.length).toBe(src.length);
    expect(reversed.getChannelData(0)[0]).toBeCloseTo(src.getChannelData(0)[src.length - 1]);
  });
});

describe("normalizeBuffer", () => {
  it("normalisiert leise Buffer auf Peak=1.0", () => {
    const src = new MockAudioBuffer(1, 100, 44100) as unknown as AudioBuffer;
    const data = src.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = 0.1;
    const norm = normalizeBuffer(ctx, src);
    expect(getPeak(norm)).toBeCloseTo(1.0);
  });

  it("Stille bleibt Stille", () => {
    const src = new MockAudioBuffer(1, 100, 44100) as unknown as AudioBuffer;
    const norm = normalizeBuffer(ctx, src);
    expect(getPeak(norm)).toBe(0);
  });

  it("normalisiert auf custom targetPeak", () => {
    const src = new MockAudioBuffer(1, 100, 44100) as unknown as AudioBuffer;
    src.getChannelData(0).fill(0.5);
    const norm = normalizeBuffer(ctx, src, 0.7);
    expect(getPeak(norm)).toBeCloseTo(0.7);
  });
});

describe("fadeIn / fadeOut", () => {
  it("fadeIn startet bei 0 und endet bei vollem Pegel", () => {
    const src = new MockAudioBuffer(1, 1000, 44100) as unknown as AudioBuffer;
    src.getChannelData(0).fill(1.0);
    const out = fadeIn(ctx, src, 0.01); // 441 samples
    expect(out.getChannelData(0)[0]).toBe(0);
    expect(out.getChannelData(0)[500]).toBeCloseTo(1.0); // nach Fade voll
  });

  it("fadeOut endet bei 0", () => {
    const src = new MockAudioBuffer(1, 1000, 44100) as unknown as AudioBuffer;
    src.getChannelData(0).fill(1.0);
    const out = fadeOut(ctx, src, 0.01);
    expect(out.getChannelData(0)[999]).toBeLessThan(0.05);
  });
});

describe("insertSilence", () => {
  it("fügt Stille ein und verlängert den Buffer", () => {
    const src = new MockAudioBuffer(1, 1000, 44100) as unknown as AudioBuffer;
    src.getChannelData(0).fill(1.0);
    const out = insertSilence(ctx, src, 0.01, 0.02); // 882 samples Stille
    expect(out.length).toBeGreaterThan(src.length);
    // Mitte des Inserts muss 0 sein
    const mid = Math.floor(0.01 * 44100) + 100;
    expect(out.getChannelData(0)[mid]).toBe(0);
  });
});

describe("applyGain", () => {
  it("multipliziert alle Samples", () => {
    const src = new MockAudioBuffer(1, 100, 44100) as unknown as AudioBuffer;
    src.getChannelData(0).fill(0.5);
    const out = applyGain(ctx, src, 2);
    expect(out.getChannelData(0)[0]).toBe(1.0);
  });
});

describe("cutSelection", () => {
  it("liefert remainder und cut", () => {
    const src = makeSineBuffer(1, 440);
    const { remainder, cut } = cutSelection(ctx, src, 0.25, 0.5);
    expect(cut.length).toBeCloseTo(44100 * 0.25, -3); // ~25% der Länge
    expect(remainder.length).toBeCloseTo(44100 * 0.75, -3); // ~75% der Länge
  });
});

describe("pasteBuffer", () => {
  it("fügt clip ein und verlängert den Buffer", () => {
    const src = makeSineBuffer(0.1, 440);
    const clip = makeSineBuffer(0.05, 220);
    const out = pasteBuffer(ctx, src, clip, 0.05);
    expect(out.length).toBe(src.length + clip.length);
  });
});

describe("getPeak / getRms", () => {
  it("getPeak findet das absolute Maximum", () => {
    const src = new MockAudioBuffer(1, 100, 44100) as unknown as AudioBuffer;
    const data = src.getChannelData(0);
    data[50] = -0.8;
    data[20] = 0.3;
    expect(getPeak(src)).toBeCloseTo(0.8);
  });

  it("getRms ist 0 für Stille", () => {
    const src = new MockAudioBuffer(1, 100, 44100) as unknown as AudioBuffer;
    expect(getRms(src)).toBe(0);
  });

  it("getRms eines konstanten Signals = der Wert", () => {
    const src = new MockAudioBuffer(1, 100, 44100) as unknown as AudioBuffer;
    src.getChannelData(0).fill(0.5);
    expect(getRms(src)).toBeCloseTo(0.5);
  });
});
