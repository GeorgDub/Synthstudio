// @vitest-environment node
/**
 * sample-spectral-centroid.test.ts — v3.177.0
 * Tests für Spectral-Centroid + Brightness-Kategorisierung Pure-Helper.
 *
 * fftSize 256 für Tests (naive DFT O(n²) — 256 ist ~65k ops pro Frame,
 * schnell genug für die Testsuite). Default-1024 wird in 1-2 Tests
 * explizit referenziert.
 */

import { describe, it, expect } from "vitest";
import {
  computeSpectralCentroid,
  categorizeBrightness,
  hannWindow,
  DEFAULT_FFT_SIZE,
  BRIGHTNESS_THRESHOLDS,
} from "../../client/src/utils/sampleSpectralCentroid";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Test-Helpers ────────────────────────────────────────────────────────────

function makeSineBuffer(
  freq: number,
  durationSec: number,
  sampleRate = 48000,
): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
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

function makeSilentBuffer(length: number, sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(length);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeEmptyBuffer(): AudioBufferLike {
  const data = new Float32Array(0);
  return {
    sampleRate: 48000,
    numberOfChannels: 1,
    length: 0,
    getChannelData: () => data,
  };
}

/** Deterministisches White-Noise mit mulberry32. */
function makeNoiseBuffer(
  length: number,
  seed = 42,
  sampleRate = 48000,
): AudioBufferLike {
  const data = new Float32Array(length);
  let s = seed >>> 0;
  for (let i = 0; i < length; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    data[i] = u * 2 - 1; // -1..1
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

function makeStereoSineBuffer(
  freqL: number,
  freqR: number,
  durationSec: number,
  sampleRate = 48000,
): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    L[i] = Math.sin((2 * Math.PI * freqL * i) / sampleRate);
    R[i] = Math.sin((2 * Math.PI * freqR * i) / sampleRate);
  }
  return {
    sampleRate,
    numberOfChannels: 2,
    length,
    getChannelData: (c: number) => (c === 0 ? L : R),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("v3.177 computeSpectralCentroid", () => {
  it("empty buffer → centroid 0, brightness dark", () => {
    const result = computeSpectralCentroid(makeEmptyBuffer());
    expect(result.centroidHz).toBe(0);
    expect(result.spreadHz).toBe(0);
    expect(result.brightness).toBe("dark");
  });

  it("silent buffer (zeros) → centroid 0", () => {
    const result = computeSpectralCentroid(makeSilentBuffer(2048), {
      fftSize: 256,
    });
    expect(result.centroidHz).toBe(0);
    expect(result.brightness).toBe("dark");
  });

  it("200 Hz sine → centroid near 200 Hz, brightness dark", () => {
    const result = computeSpectralCentroid(makeSineBuffer(200, 0.2), {
      fftSize: 256,
    });
    // Mit fftSize 256 @ 48kHz ist die Bin-Breite ~188 Hz — der Centroid
    // kann nicht perfekt 200 Hz treffen, sollte aber deutlich unter
    // 500 Hz liegen (dark).
    expect(result.centroidHz).toBeGreaterThan(50);
    expect(result.centroidHz).toBeLessThan(500);
    expect(result.brightness).toBe("dark");
  });

  it("5000 Hz sine → centroid near 5000 Hz, brightness bright", () => {
    const result = computeSpectralCentroid(makeSineBuffer(5000, 0.2), {
      fftSize: 256,
    });
    expect(result.centroidHz).toBeGreaterThan(3500);
    expect(result.centroidHz).toBeLessThan(7000);
    expect(result.brightness).toBe("bright");
  });

  it("white noise → centroid im mittleren Bereich", () => {
    const result = computeSpectralCentroid(makeNoiseBuffer(2048), {
      fftSize: 256,
    });
    // White Noise hat (theoretisch) eine flache Spektral-Verteilung;
    // mit Hann-Window verschiebt sich der Centroid in Richtung ~Nyquist/2.
    expect(result.centroidHz).toBeGreaterThan(2000);
    expect(result.centroidHz).toBeLessThan(20000); // < Nyquist (24kHz)
  });

  it("spread > 0 für broadband (noise)", () => {
    const result = computeSpectralCentroid(makeNoiseBuffer(2048), {
      fftSize: 256,
    });
    expect(result.spreadHz).toBeGreaterThan(500);
  });

  it("spread klein für reinen Sine (relativ zum Mittenfrequenz-Bereich)", () => {
    const sine = computeSpectralCentroid(makeSineBuffer(3000, 0.2), {
      fftSize: 256,
    });
    const noise = computeSpectralCentroid(makeNoiseBuffer(2048), {
      fftSize: 256,
    });
    // Ein reiner Sine sollte signifikant weniger Spread haben
    // als Broadband-Noise.
    expect(sine.spreadHz).toBeLessThan(noise.spreadHz);
  });

  it("Stereo-Buffer mit mix-Downmix verarbeitet beide Kanäle", () => {
    // Links 500 Hz, Rechts 5000 Hz — Mix-Downmix hat beide Komponenten
    // → Centroid liegt irgendwo dazwischen, deutlich über 500 Hz.
    const result = computeSpectralCentroid(
      makeStereoSineBuffer(500, 5000, 0.2),
      { fftSize: 256, channelMode: "mix" },
    );
    expect(result.centroidHz).toBeGreaterThan(1000);
    expect(result.centroidHz).toBeLessThan(6000);
  });

  it("channelMode left vs right liefert unterschiedliche Centroids", () => {
    const buf = makeStereoSineBuffer(300, 8000, 0.2);
    const left = computeSpectralCentroid(buf, {
      fftSize: 256,
      channelMode: "left",
    });
    const right = computeSpectralCentroid(buf, {
      fftSize: 256,
      channelMode: "right",
    });
    expect(left.centroidHz).toBeLessThan(1500);
    expect(right.centroidHz).toBeGreaterThan(5000);
  });

  it("Sample kürzer als fftSize → zero-padded Single-Frame, kein Throw", () => {
    const shortSine = makeSineBuffer(1000, 0.001); // 48 samples @ 48k
    const result = computeSpectralCentroid(shortSine, { fftSize: 256 });
    expect(result.centroidHz).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.centroidHz)).toBe(true);
  });

  it("DEFAULT_FFT_SIZE ist 1024", () => {
    expect(DEFAULT_FFT_SIZE).toBe(1024);
  });

  it("rect-Window funktioniert (Sanity)", () => {
    const result = computeSpectralCentroid(makeSineBuffer(2000, 0.2), {
      fftSize: 256,
      window: "rect",
    });
    // Rect-Window hat starke Spectral-Leakage (sinc-Side-Lobes),
    // daher liegt der Centroid für eine 2kHz-Sine deutlich über 2kHz —
    // wir prüfen nur dass das Ergebnis im plausiblen Range liegt.
    expect(result.centroidHz).toBeGreaterThan(500);
    expect(result.centroidHz).toBeLessThan(8000);
  });

  it("hamming-Window funktioniert (Sanity)", () => {
    const result = computeSpectralCentroid(makeSineBuffer(2000, 0.2), {
      fftSize: 256,
      window: "hamming",
    });
    expect(result.centroidHz).toBeGreaterThan(500);
    expect(result.centroidHz).toBeLessThan(4000);
  });
});

describe("v3.177 categorizeBrightness", () => {
  it("0 Hz → dark", () => {
    expect(categorizeBrightness(0)).toBe("dark");
  });

  it("499 Hz → dark (knapp unter Schwelle)", () => {
    expect(categorizeBrightness(499)).toBe("dark");
  });

  it("500 Hz → warm (genau auf Schwelle)", () => {
    expect(categorizeBrightness(500)).toBe("warm");
  });

  it("1499 Hz → warm (knapp unter Schwelle)", () => {
    expect(categorizeBrightness(1499)).toBe("warm");
  });

  it("1500 Hz → neutral", () => {
    expect(categorizeBrightness(1500)).toBe("neutral");
  });

  it("3500 Hz → bright", () => {
    expect(categorizeBrightness(3500)).toBe("bright");
  });

  it("6999 Hz → bright", () => {
    expect(categorizeBrightness(6999)).toBe("bright");
  });

  it("7000 Hz → harsh", () => {
    expect(categorizeBrightness(7000)).toBe("harsh");
  });

  it("20000 Hz → harsh", () => {
    expect(categorizeBrightness(20000)).toBe("harsh");
  });

  it("NaN → dark (defensive)", () => {
    expect(categorizeBrightness(NaN)).toBe("dark");
  });

  it("Infinity → dark (defensive — Number.isFinite false)", () => {
    expect(categorizeBrightness(Infinity)).toBe("dark");
  });

  it("negativer Wert → dark", () => {
    expect(categorizeBrightness(-100)).toBe("dark");
  });

  it("BRIGHTNESS_THRESHOLDS exportiert die Werte", () => {
    expect(BRIGHTNESS_THRESHOLDS.dark).toBe(500);
    expect(BRIGHTNESS_THRESHOLDS.warm).toBe(1500);
    expect(BRIGHTNESS_THRESHOLDS.neutral).toBe(3500);
    expect(BRIGHTNESS_THRESHOLDS.bright).toBe(7000);
  });
});

describe("v3.177 hannWindow", () => {
  it("hannWindow(0, 100) ≈ 0 (linker Rand)", () => {
    expect(hannWindow(0, 100)).toBeCloseTo(0, 5);
  });

  it("hannWindow(99, 100) ≈ 0 (rechter Rand)", () => {
    expect(hannWindow(99, 100)).toBeCloseTo(0, 5);
  });

  it("hannWindow(49, 100) ≈ 1 (mittlere Position)", () => {
    // Für eine 100-er Hann-Funktion ist die Spitze bei n=(N-1)/2 = 49.5.
    // n=49 ist sehr nahe daran → Wert sehr nah an 1.
    const v = hannWindow(49, 100);
    expect(v).toBeGreaterThan(0.99);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("hannWindow(n, 1) → 1 (Edge-Case length 1)", () => {
    expect(hannWindow(0, 1)).toBe(1);
  });

  it("hannWindow ist symmetrisch um die Mitte", () => {
    // hannWindow(n, N) == hannWindow(N-1-n, N) für alle n.
    const N = 64;
    for (let n = 0; n < N; n++) {
      const a = hannWindow(n, N);
      const b = hannWindow(N - 1 - n, N);
      expect(a).toBeCloseTo(b, 10);
    }
  });
});
