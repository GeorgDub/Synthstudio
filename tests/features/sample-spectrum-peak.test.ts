// @vitest-environment node
/**
 * sample-spectrum-peak.test.ts -- v3.217.0
 *
 * Tests fuer den Goertzel-basierten Spektrum-Peak-Finder.  Verifiziert alle
 * 8 Pins aus sampleSpectrumPeak.ts plus die Spec-genannten Edge-Cases.
 *
 * sampleRate 48000, windowSize default 1024 -> Bin-Breite ~47Hz; das ist
 * fein genug, dass eine reine 440Hz-Sine im Test-Bin von 440Hz dominiert.
 */

import { describe, it, expect } from "vitest";
import {
  findPeakFrequencies,
  topNPeaks,
  DEFAULT_FREQS_TO_TEST,
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  MAX_WINDOW_SIZE,
} from "../../client/src/utils/sampleSpectrumPeak";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// --- Test-Helpers ----------------------------------------------------------

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

// --- findPeakFrequencies --------------------------------------------------

describe("v3.217 findPeakFrequencies -- empty / degenerate", () => {
  it("empty buffer -> []", () => {
    expect(findPeakFrequencies(makeEmptyBuffer())).toEqual([]);
  });

  it("null-cast buffer -> []", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(findPeakFrequencies(null as any)).toEqual([]);
  });

  it("buffer mit sampleRate <= 0 -> []", () => {
    const bad: AudioBufferLike = {
      sampleRate: 0,
      numberOfChannels: 1,
      length: 1024,
      getChannelData: () => new Float32Array(1024),
    };
    expect(findPeakFrequencies(bad)).toEqual([]);
  });

  it("buffer mit numberOfChannels = 0 -> []", () => {
    const bad: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 0,
      length: 1024,
      getChannelData: () => new Float32Array(1024),
    };
    expect(findPeakFrequencies(bad)).toEqual([]);
  });
});

describe("v3.217 findPeakFrequencies -- Sine-Detection", () => {
  it("pure 440Hz sine -> 440Hz ist der staerkste Peak", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05));
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
    const sorted = [...res].sort((a, b) => b.amplitude - a.amplitude);
    expect(sorted[0].frequencyHz).toBe(440);
    // Pin #8: amplitude einer unit-sine ist ~0.5, nicht ~1.
    expect(sorted[0].amplitude).toBeGreaterThan(0.1);
    expect(sorted[0].amplitude).toBeLessThan(1.0);
  });

  it("pure 1000Hz sine -> Custom-Freq 1000Hz dominiert", () => {
    const res = findPeakFrequencies(makeSineBuffer(1000, 0.05), {
      freqsToTest: [100, 500, 1000, 2000, 4000],
    });
    expect(res.length).toBe(5);
    const sorted = [...res].sort((a, b) => b.amplitude - a.amplitude);
    expect(sorted[0].frequencyHz).toBe(1000);
  });

  it("silence -> alle Amplituden ~= 0", () => {
    const res = findPeakFrequencies(makeSilentBuffer(2048));
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
    for (const peak of res) {
      expect(peak.amplitude).toBeLessThan(1e-6);
    }
  });

  it("60Hz sine -> 60Hz dominiert (Sub-Bass)", () => {
    const res = findPeakFrequencies(makeSineBuffer(60, 0.1));
    const sorted = [...res].sort((a, b) => b.amplitude - a.amplitude);
    expect(sorted[0].frequencyHz).toBe(60);
  });
});

describe("v3.217 findPeakFrequencies -- Pin #4 (Nyquist-Skip)", () => {
  it("Frequenz >= Nyquist wird uebersprungen (kuerzere Result-Liste)", () => {
    // sampleRate 48000 -> Nyquist 24000.  Custom-Liste mit einer Freq drueber.
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      freqsToTest: [200, 440, 30000], // 30kHz > 24kHz Nyquist
    });
    expect(res.length).toBe(2);
    expect(res.map((p) => p.frequencyHz)).toEqual([200, 440]);
  });

  it("Frequenz exakt = Nyquist wird auch uebersprungen", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      freqsToTest: [440, 24000],
    });
    expect(res.length).toBe(1);
    expect(res[0].frequencyHz).toBe(440);
  });

  it("alle Frequenzen > Nyquist -> []", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      freqsToTest: [25000, 30000, 40000],
    });
    expect(res).toEqual([]);
  });
});

describe("v3.217 findPeakFrequencies -- Pin #5 (Order-Preservation)", () => {
  it("Output-Reihenfolge == Input-Reihenfolge von freqsToTest", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      freqsToTest: [3520, 100, 880, 60, 1760],
    });
    expect(res.map((p) => p.frequencyHz)).toEqual([
      3520, 100, 880, 60, 1760,
    ]);
  });
});

describe("v3.217 findPeakFrequencies -- Pin #6 (sanitize freqsToTest)", () => {
  it("freqsToTest=[] -> Defaults werden benutzt", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      freqsToTest: [],
    });
    expect(res.map((p) => p.frequencyHz)).toEqual([
      ...DEFAULT_FREQS_TO_TEST,
    ]);
  });

  it("freqsToTest=undefined -> Defaults werden benutzt", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05));
    expect(res.map((p) => p.frequencyHz)).toEqual([
      ...DEFAULT_FREQS_TO_TEST,
    ]);
  });

  it("freqsToTest mit NaN/negativ/Infinity -> silent gefiltert", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      freqsToTest: [200, NaN, 440, -100, Infinity, 880, "abc" as any],
    });
    expect(res.map((p) => p.frequencyHz)).toEqual([200, 440, 880]);
  });

  it("freqsToTest nur mit invaliden Werten -> Defaults", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      freqsToTest: [NaN, -1, Infinity] as any,
    });
    expect(res.map((p) => p.frequencyHz)).toEqual([
      ...DEFAULT_FREQS_TO_TEST,
    ]);
  });

  it("Custom freqsToTest [220, 880, 1760] wird verwendet", () => {
    const res = findPeakFrequencies(makeSineBuffer(880, 0.05), {
      freqsToTest: [220, 880, 1760],
    });
    expect(res.map((p) => p.frequencyHz)).toEqual([220, 880, 1760]);
    const sorted = [...res].sort((a, b) => b.amplitude - a.amplitude);
    expect(sorted[0].frequencyHz).toBe(880);
  });
});

describe("v3.217 findPeakFrequencies -- Pin #7 (Multi-Channel Mix)", () => {
  it("Stereo (links 200Hz, rechts 3000Hz) -> beide tauchen im Mix auf", () => {
    const res = findPeakFrequencies(
      makeStereoSineBuffer(200, 3000, 0.1),
      { freqsToTest: [100, 200, 1000, 3000, 5000] },
    );
    const ampAt = (f: number) =>
      res.find((p) => p.frequencyHz === f)?.amplitude ?? 0;
    // Sowohl 200 als auch 3000 sollten deutlich groesser als 100/1000/5000 sein.
    expect(ampAt(200)).toBeGreaterThan(ampAt(100));
    expect(ampAt(200)).toBeGreaterThan(ampAt(1000));
    expect(ampAt(3000)).toBeGreaterThan(ampAt(1000));
    expect(ampAt(3000)).toBeGreaterThan(ampAt(5000));
  });

  it("Mono-Buffer wird unveraendert verarbeitet (kein Crash)", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05));
    expect(res.length).toBeGreaterThan(0);
  });
});

describe("v3.217 findPeakFrequencies -- Pin #3 (effective N for short buffers)", () => {
  it("Buffer kuerzer als windowSize -> kein Crash, plausible Werte", () => {
    // 100 Samples bei windowSize 1024
    const short = makeSineBuffer(440, 100 / 48000);
    expect(short.length).toBe(100);
    const res = findPeakFrequencies(short);
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
    for (const peak of res) {
      expect(Number.isFinite(peak.amplitude)).toBe(true);
      expect(peak.amplitude).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("v3.217 findPeakFrequencies -- windowSize-Sanitizer", () => {
  it("windowSize NaN -> 1024 Default", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      windowSize: NaN,
    });
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
  });

  it("windowSize < 64 -> 1024 Default", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      windowSize: 10,
    });
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
  });

  it("windowSize > 4096 -> clamped auf 4096 (kein Crash)", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.2), {
      windowSize: 99999,
    });
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
  });

  it("windowSize 64 (MIN) funktioniert", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      windowSize: 64,
    });
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
    for (const peak of res) {
      expect(Number.isFinite(peak.amplitude)).toBe(true);
    }
  });

  it("windowSize 2048 funktioniert", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.1), {
      windowSize: 2048,
    });
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
  });

  it("windowSize Infinity -> Default", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      windowSize: Infinity,
    });
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
  });

  it("windowSize negativ -> Default", () => {
    const res = findPeakFrequencies(makeSineBuffer(440, 0.05), {
      windowSize: -100,
    });
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
  });
});

// --- topNPeaks ------------------------------------------------------------

describe("v3.217 topNPeaks -- Sort + Limit", () => {
  it("topNPeaks(buffer, 1) liefert das Maximum", () => {
    const res = topNPeaks(makeSineBuffer(1760, 0.05), 1);
    expect(res.length).toBe(1);
    expect(res[0].frequencyHz).toBe(1760);
  });

  it("topNPeaks(buffer, 3) -- nach amplitude absteigend sortiert", () => {
    const res = topNPeaks(makeSineBuffer(440, 0.05), 3);
    expect(res.length).toBe(3);
    expect(res[0].amplitude).toBeGreaterThanOrEqual(res[1].amplitude);
    expect(res[1].amplitude).toBeGreaterThanOrEqual(res[2].amplitude);
  });

  it("topNPeaks(buffer, n > matches.length) -> komplette Liste", () => {
    const res = topNPeaks(makeSineBuffer(440, 0.05), 999);
    expect(res.length).toBe(DEFAULT_FREQS_TO_TEST.length);
  });

  it("topNPeaks(buffer, 0) -> []", () => {
    const res = topNPeaks(makeSineBuffer(440, 0.05), 0);
    expect(res).toEqual([]);
  });

  it("topNPeaks(buffer, -1) -> []", () => {
    const res = topNPeaks(makeSineBuffer(440, 0.05), -1);
    expect(res).toEqual([]);
  });

  it("topNPeaks(buffer, NaN) -> []", () => {
    const res = topNPeaks(makeSineBuffer(440, 0.05), NaN);
    expect(res).toEqual([]);
  });

  it("topNPeaks(emptyBuffer, 5) -> []", () => {
    const res = topNPeaks(makeEmptyBuffer(), 5);
    expect(res).toEqual([]);
  });

  it("topNPeaks respektiert custom freqsToTest", () => {
    const res = topNPeaks(makeSineBuffer(880, 0.05), 2, {
      freqsToTest: [220, 880, 1760, 3520],
    });
    expect(res.length).toBe(2);
    expect(res[0].frequencyHz).toBe(880);
  });
});

// --- Exports / Konstanten -------------------------------------------------

describe("v3.217 Exports / Konstanten", () => {
  it("DEFAULT_FREQS_TO_TEST hat 7 Eintraege", () => {
    expect(DEFAULT_FREQS_TO_TEST.length).toBe(7);
  });

  it("DEFAULT_FREQS_TO_TEST = [60, 100, 200, 440, 880, 1760, 3520]", () => {
    expect([...DEFAULT_FREQS_TO_TEST]).toEqual([
      60, 100, 200, 440, 880, 1760, 3520,
    ]);
  });

  it("DEFAULT_WINDOW_SIZE = 1024", () => {
    expect(DEFAULT_WINDOW_SIZE).toBe(1024);
  });

  it("MIN_WINDOW_SIZE = 64", () => {
    expect(MIN_WINDOW_SIZE).toBe(64);
  });

  it("MAX_WINDOW_SIZE = 4096", () => {
    expect(MAX_WINDOW_SIZE).toBe(4096);
  });
});

// --- Purity ---------------------------------------------------------------

describe("v3.217 Purity / Determinismus", () => {
  it("Zwei Aufrufe mit gleichem Input -> identische Outputs", () => {
    const buf = makeSineBuffer(440, 0.05);
    const a = findPeakFrequencies(buf);
    const b = findPeakFrequencies(buf);
    expect(a).toEqual(b);
  });

  it("findPeakFrequencies mutiert das Input-Buffer nicht", () => {
    const buf = makeSineBuffer(440, 0.05);
    const dataSnap = Array.from(buf.getChannelData(0));
    findPeakFrequencies(buf);
    const dataAfter = Array.from(buf.getChannelData(0));
    expect(dataAfter).toEqual(dataSnap);
  });

  it("Output-Array ist eine neue Instanz pro Call", () => {
    const buf = makeSineBuffer(440, 0.05);
    const a = findPeakFrequencies(buf);
    const b = findPeakFrequencies(buf);
    expect(a).not.toBe(b);
  });

  it("topNPeaks ist deterministisch", () => {
    const buf = makeSineBuffer(440, 0.05);
    const a = topNPeaks(buf, 3);
    const b = topNPeaks(buf, 3);
    expect(a).toEqual(b);
  });
});
