// @vitest-environment node
/**
 * sample-auto-tune.test.ts — v3.187.0
 *
 * Tests für sampleAutoTune Pure-Helper:
 *   - detectPitchAutocorrelation (direkt-testbar)
 *   - analyzeAutoTune (integration mit Snap-to-Scale)
 *   - hzToMidi + snapToScale (units)
 *
 * Sine-Buffer-Durations sind großzügig bemessen (>= 0.1s @ 48kHz =
 * 4800 samples), damit auch der niedrigste Pitch (80 Hz → 600 samples
 * Lag) eindeutig in einem Buffer mit mehreren Perioden gefunden wird.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeAutoTune,
  detectPitchAutocorrelation,
  hzToMidi,
  snapToScale,
  DEFAULT_MIN_FREQ,
  DEFAULT_MAX_FREQ,
  DEFAULT_ROOT_MIDI,
} from "../../client/src/utils/sampleAutoTune";
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

// ─── analyzeAutoTune ─────────────────────────────────────────────────────────

describe("v3.187 analyzeAutoTune", () => {
  it("empty buffer → detectedHz=-1, confidence=0, targetMidi=rootMidi(default 60)", () => {
    const result = analyzeAutoTune(makeEmptyBuffer());
    expect(result.detectedHz).toBe(-1);
    expect(result.detectedMidi).toBe(-1);
    expect(result.confidence).toBe(0);
    expect(result.targetMidi).toBe(DEFAULT_ROOT_MIDI);
    expect(result.semitoneShift).toBe(0);
  });

  it("silent buffer (zeros) → detectedHz=-1, confidence=0", () => {
    const result = analyzeAutoTune(makeSilentBuffer(4800));
    expect(result.detectedHz).toBe(-1);
    expect(result.detectedMidi).toBe(-1);
    expect(result.confidence).toBe(0);
    expect(result.targetMidi).toBe(DEFAULT_ROOT_MIDI);
  });

  it("440 Hz pure sine → detectedHz ≈ 440, midi ≈ 69 (A4)", () => {
    const result = analyzeAutoTune(makeSineBuffer(440, 0.2));
    expect(result.detectedHz).toBeGreaterThan(430);
    expect(result.detectedHz).toBeLessThan(450);
    // 440 Hz = MIDI 69 (A4)
    expect(result.detectedMidi).toBeGreaterThan(68.5);
    expect(result.detectedMidi).toBeLessThan(69.5);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("220 Hz pure sine → detectedHz ≈ 220, midi ≈ 57 (A3)", () => {
    const result = analyzeAutoTune(makeSineBuffer(220, 0.2));
    expect(result.detectedHz).toBeGreaterThan(215);
    expect(result.detectedHz).toBeLessThan(225);
    // 220 Hz = MIDI 57 (A3)
    expect(result.detectedMidi).toBeGreaterThan(56.5);
    expect(result.detectedMidi).toBeLessThan(57.5);
  });

  it("snap C-major: detect ~C#5 → target C5 (72) or D5 (74) (equidistant)", () => {
    // C#5 = MIDI 73 ≈ 554.37 Hz.
    // In C-major (rootMidi=60, scale=major): distance zu C (interval 0
    // in next octave = 72) = 1; distance zu D (interval 2 = 62) = 11.
    // ABER mit Octave-Wrap: nearest ist C (72) = 1 oder D in NEXT octave?
    // Tatsächlich: detectedMidi=73, candidates für interval=0:
    //   rootMidi+1*12+0 = 72  → dist 1
    //   rootMidi+0*12+0 = 60  → dist 13
    //   rootMidi+2*12+0 = 84  → dist 11
    // candidates für interval=2 (D):
    //   rootMidi+1*12+2 = 74  → dist 1
    //   rootMidi+0*12+2 = 62  → dist 11
    // → Tie zwischen 72 und 74. First-wins (intervals in order) = C wins (72).
    // Wir akzeptieren beide.
    const result = analyzeAutoTune(makeSineBuffer(554.37, 0.2), {
      scale: "major",
      rootMidi: 60,
    });
    expect([72, 74]).toContain(result.targetMidi);
  });

  it("snap arbitrary scale (minor-natural) → snap zur nearest minor-Skala-Note", () => {
    // 261.63 Hz ≈ MIDI 60 (C4). Bei rootMidi=60, scale=minor-natural
    // (intervals 0,2,3,5,7,8,10), MIDI 60 selbst ist die Root → targetMidi=60.
    const result = analyzeAutoTune(makeSineBuffer(261.63, 0.2), {
      scale: "minor-natural",
      rootMidi: 60,
    });
    expect(result.targetMidi).toBe(60);
  });

  it("confidence ist im Range [0, 1]", () => {
    const result = analyzeAutoTune(makeSineBuffer(440, 0.2));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("semitoneShift = targetMidi - detectedMidi", () => {
    const result = analyzeAutoTune(makeSineBuffer(440, 0.2), {
      scale: "major",
      rootMidi: 60,
    });
    const expected = result.targetMidi - result.detectedMidi;
    expect(result.semitoneShift).toBeCloseTo(expected, 10);
  });

  it("min/max freq filter constrains detection (out-of-range → -1 oder weit weg von 200Hz)", () => {
    // 200 Hz sine, aber minFreq=300, maxFreq=1000 → 200 Hz liegt unter dem
    // Detection-Range. Erwartung: entweder -1 ODER ein Wert klar verschieden
    // von 200 Hz (Autocorrelation findet einen Pseudo-Peak im erlaubten
    // Lag-Range, der NICHT die echte Periode ist).
    const result = analyzeAutoTune(makeSineBuffer(200, 0.2), {
      minFreq: 300,
      maxFreq: 1000,
    });
    if (result.detectedHz > 0) {
      // Wenn etwas detected → muss IM erlaubten Range sein.
      expect(result.detectedHz).toBeGreaterThanOrEqual(300);
      expect(result.detectedHz).toBeLessThanOrEqual(1000);
      // ... und NICHT die echte 200 Hz sein.
      expect(Math.abs(result.detectedHz - 200)).toBeGreaterThan(20);
    } else {
      expect(result.detectedHz).toBe(-1);
    }
  });

  it("ungültige scale-string → fallback auf major (rootMidi=60, 440Hz → A4=69 ist in major)", () => {
    const result = analyzeAutoTune(makeSineBuffer(440, 0.2), {
      // @ts-expect-error — intentional invalid scale für Defensive-Test.
      scale: "totally-not-a-scale",
      rootMidi: 60,
    });
    // A4 ist in C-major (interval 9). Target sollte MIDI 69 sein.
    expect(result.targetMidi).toBe(69);
  });

  it("ungültige rootMidi (NaN) → fallback auf 60", () => {
    const result = analyzeAutoTune(makeEmptyBuffer(), {
      rootMidi: Number.NaN,
    });
    expect(result.targetMidi).toBe(60);
  });

  it("ungültige rootMidi (out-of-range > 127) → fallback auf 60", () => {
    const result = analyzeAutoTune(makeEmptyBuffer(), {
      rootMidi: 999,
    });
    expect(result.targetMidi).toBe(60);
  });
});

// ─── detectPitchAutocorrelation (direkt) ─────────────────────────────────────

describe("v3.187 detectPitchAutocorrelation", () => {
  it("empty samples → {hz: -1, confidence: 0}", () => {
    const result = detectPitchAutocorrelation(new Float32Array(0), 48000);
    expect(result.hz).toBe(-1);
    expect(result.confidence).toBe(0);
  });

  it("silent samples (zeros) → {hz: -1, confidence: 0} (r(0)=0)", () => {
    const result = detectPitchAutocorrelation(
      new Float32Array(4800),
      48000,
    );
    expect(result.hz).toBe(-1);
    expect(result.confidence).toBe(0);
  });

  it("zu kurzes Sample (< maxLag) → {hz: -1, confidence: 0}", () => {
    // Mit minFreq=80, sampleRate=48000 → maxLag=600. Sample mit nur 100
    // samples ist zu kurz.
    const tiny = new Float32Array(100);
    for (let i = 0; i < tiny.length; i++) tiny[i] = Math.sin(i * 0.1);
    const result = detectPitchAutocorrelation(tiny, 48000);
    expect(result.hz).toBe(-1);
    expect(result.confidence).toBe(0);
  });

  it("440 Hz sine → hz ≈ 440, confidence > 0.5", () => {
    const sr = 48000;
    const data = new Float32Array(Math.floor(0.2 * sr));
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    }
    const result = detectPitchAutocorrelation(data, sr);
    expect(result.hz).toBeGreaterThan(430);
    expect(result.hz).toBeLessThan(450);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("min/max freq defaults (negative → 80, 0 → 1000)", () => {
    const sr = 48000;
    const data = new Float32Array(Math.floor(0.2 * sr));
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    }
    // Negative + 0 sollten als Defaults behandelt werden (gleiches Ergebnis
    // wie mit undefined → 80..1000).
    const result = detectPitchAutocorrelation(data, sr, -100, 0);
    expect(result.hz).toBeGreaterThan(430);
    expect(result.hz).toBeLessThan(450);
  });
});

// ─── hzToMidi ────────────────────────────────────────────────────────────────

describe("v3.187 hzToMidi", () => {
  it("440 Hz → 69 (A4)", () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 6);
  });

  it("220 Hz → 57 (A3, eine Oktave runter)", () => {
    expect(hzToMidi(220)).toBeCloseTo(57, 6);
  });

  it("880 Hz → 81 (A5, eine Oktave hoch)", () => {
    expect(hzToMidi(880)).toBeCloseTo(81, 6);
  });

  it("0 Hz → -1 (defensive)", () => {
    expect(hzToMidi(0)).toBe(-1);
  });

  it("negative Hz → -1", () => {
    expect(hzToMidi(-100)).toBe(-1);
  });
});

// ─── snapToScale ─────────────────────────────────────────────────────────────

describe("v3.187 snapToScale", () => {
  it("detectedMidi=60, scale=major, root=60 → 60 (Root selbst ist in der Scale)", () => {
    expect(snapToScale(60, 60, "major")).toBe(60);
  });

  it("detectedMidi=61 (C#), scale=major, root=60 → 60 oder 62 (equidistant)", () => {
    expect([60, 62]).toContain(snapToScale(61, 60, "major"));
  });

  it("detectedMidi=-1 → rootMidi (defensive)", () => {
    expect(snapToScale(-1, 60, "major")).toBe(60);
  });

  it("snap mit Octave-Wrap: B (MIDI 71) bei mixolydian → C (72) oder Bb (70)", () => {
    // mixolydian intervals [0,2,4,5,7,9,10]; root=60.
    // detectedMidi=71. octaveOffset=0, noteInOctave=11.
    // candidates:
    //   interval=10 (Bb): 70 → dist 1
    //   interval=0 (C), oct+1 = 72 → dist 1
    // → Tie 70/72.
    expect([70, 72]).toContain(snapToScale(71, 60, "mixolydian"));
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("v3.187 Constants", () => {
  it("DEFAULT_MIN_FREQ = 80", () => {
    expect(DEFAULT_MIN_FREQ).toBe(80);
  });

  it("DEFAULT_MAX_FREQ = 1000", () => {
    expect(DEFAULT_MAX_FREQ).toBe(1000);
  });

  it("DEFAULT_ROOT_MIDI = 60", () => {
    expect(DEFAULT_ROOT_MIDI).toBe(60);
  });
});