/**
 * tests/time-stretch.test.ts
 *
 * Unit-Tests für die OLA Time-Stretch-Utility.
 * Verwendet einen Mock-AudioContext mit createBuffer.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { timeStretchBuffer, clearStretchCache, getCachedStretchBuffer } from "../client/src/audio/timeStretchUtils";

// ─── Mock AudioBuffer + AudioContext ──────────────────────────────────────────

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

  getChannelData(channel: number): Float32Array { return this.data[channel]; }
  copyFromChannel(): void {}
  copyToChannel(): void {}
}

class MockAudioContext {
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
  }
}

const ctx = new MockAudioContext() as unknown as BaseAudioContext;

function makeSineBuffer(durationSec: number, freq: number, sampleRate = 44100): AudioBuffer {
  const length = Math.round(durationSec * sampleRate);
  const buf = new MockAudioBuffer(1, length, sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return buf as unknown as AudioBuffer;
}

beforeEach(() => {
  clearStretchCache();
});

describe("timeStretchBuffer", () => {
  it("gibt den Original-Buffer zurück wenn ratio ≈ 1.0", () => {
    const src = makeSineBuffer(0.5, 440);
    const result = timeStretchBuffer(ctx, src, 1.0);
    expect(result).toBe(src);
  });

  it("verdoppelt die Länge bei ratio=2.0", () => {
    const src = makeSineBuffer(0.1, 440);
    const result = timeStretchBuffer(ctx, src, 2.0);
    expect(result.length).toBe(src.length * 2);
  });

  it("halbiert die Länge bei ratio=0.5", () => {
    const src = makeSineBuffer(0.1, 440);
    const result = timeStretchBuffer(ctx, src, 0.5);
    expect(result.length).toBe(Math.round(src.length * 0.5));
  });

  it("clampt ratio auf den Bereich [0.25, 4.0]", () => {
    const src = makeSineBuffer(0.05, 440);
    const tooHigh = timeStretchBuffer(ctx, src, 10);
    expect(tooHigh.length).toBe(src.length * 4); // auf 4.0 geclampt

    const tooLow = timeStretchBuffer(ctx, src, 0.01);
    expect(tooLow.length).toBe(Math.round(src.length * 0.25));
  });

  it("erzeugt Audio-Output mit ähnlichem Pegel-Bereich wie Quelle", () => {
    const src = makeSineBuffer(0.1, 440);
    const result = timeStretchBuffer(ctx, src, 1.5);
    const data = result.getChannelData(0);
    // Sample-Werte sollten zwischen -1 und 1 sein
    let max = 0;
    for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
    expect(max).toBeLessThanOrEqual(1.01);
    expect(max).toBeGreaterThan(0.1); // Nicht still
  });

  it("erhält die Anzahl Kanäle", () => {
    const stereo = new MockAudioBuffer(2, 1000, 44100);
    const result = timeStretchBuffer(ctx, stereo as unknown as AudioBuffer, 1.5);
    expect(result.numberOfChannels).toBe(2);
  });

  it("erhält die Sample-Rate", () => {
    const src = makeSineBuffer(0.05, 440, 48000);
    const result = timeStretchBuffer(ctx, src, 2.0);
    expect(result.sampleRate).toBe(48000);
  });
});

describe("getCachedStretchBuffer", () => {
  it("liefert beim zweiten Aufruf den gecachten Buffer", () => {
    const src = makeSineBuffer(0.1, 440);
    const a = getCachedStretchBuffer(ctx, "test.wav", src, 1.5);
    const b = getCachedStretchBuffer(ctx, "test.wav", src, 1.5);
    expect(a).toBe(b);
  });

  it("erzeugt separate Cache-Einträge für unterschiedliche Ratios", () => {
    const src = makeSineBuffer(0.1, 440);
    const a = getCachedStretchBuffer(ctx, "test.wav", src, 1.5);
    const b = getCachedStretchBuffer(ctx, "test.wav", src, 2.0);
    expect(a).not.toBe(b);
    expect(a.length).not.toBe(b.length);
  });

  it("invalidiert Cache nach clearStretchCache()", () => {
    const src = makeSineBuffer(0.1, 440);
    const a = getCachedStretchBuffer(ctx, "test.wav", src, 1.5);
    clearStretchCache();
    const b = getCachedStretchBuffer(ctx, "test.wav", src, 1.5);
    expect(a).not.toBe(b); // Neue Instanz
    expect(a.length).toBe(b.length); // Aber gleiche Daten
  });
});
