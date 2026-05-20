// @vitest-environment node
/**
 * pattern-harmonic-analysis.test.ts (v3.178.0)
 *
 * Tests für patternHarmonicAnalysis.ts:
 *  - analyzeHarmony: Root + Quality + Confidence aus MIDI-Notes
 *  - formatHarmonyResult: human-readable Ausgabe
 *  - PITCH_CLASS_NAMES: 12 Einträge
 */
import { describe, it, expect } from "vitest";
import {
  analyzeHarmony,
  formatHarmonyResult,
  PITCH_CLASS_NAMES,
} from "@/utils/patternHarmonicAnalysis";

describe("patternHarmonicAnalysis", () => {
  describe("analyzeHarmony", () => {
    it("empty notes → defaults (root=0, major, conf=0)", () => {
      const r = analyzeHarmony([]);
      expect(r.rootPitchClass).toBe(0);
      expect(r.quality).toBe("major");
      expect(r.confidence).toBe(0);
      expect(r.pitchClasses).toEqual([]);
    });

    it("C-major chord [60, 64, 67] → root=0, major, conf=1", () => {
      const r = analyzeHarmony([60, 64, 67]);
      expect(r.rootPitchClass).toBe(0);
      expect(r.quality).toBe("major");
      expect(r.confidence).toBe(1);
      expect(r.pitchClasses).toEqual([0, 4, 7]);
    });

    it("A-minor chord [69, 72, 76] → root=9, minor, conf=1", () => {
      // A=9, C=0, E=4 → A-minor (9 + [0,3,7] = [9,0,4])
      const r = analyzeHarmony([69, 72, 76]);
      expect(r.rootPitchClass).toBe(9);
      expect(r.quality).toBe("minor");
      expect(r.confidence).toBe(1);
    });

    it("C-major7 [60, 64, 67, 71] → quality maj7", () => {
      const r = analyzeHarmony([60, 64, 67, 71]);
      expect(r.rootPitchClass).toBe(0);
      expect(r.quality).toBe("maj7");
      expect(r.confidence).toBe(1);
    });

    it("partial match [60, 64] → suggests major but conf < 1", () => {
      const r = analyzeHarmony([60, 64]);
      // [0,4] matches C-major template {0,4,7}: 2/3 = 0.6666…
      expect(r.quality).toBe("major");
      expect(r.confidence).toBeLessThan(1);
      expect(r.confidence).toBeGreaterThan(0.5);
    });

    it("ambiguous [60, 67] (root + fifth) → confidence < 1", () => {
      const r = analyzeHarmony([60, 67]);
      // matches a couple templates partially; nothing is full match
      expect(r.confidence).toBeLessThan(1);
      expect(r.confidence).toBeGreaterThan(0);
    });

    it("sus2 [60, 62, 67] → quality sus2", () => {
      const r = analyzeHarmony([60, 62, 67]);
      expect(r.rootPitchClass).toBe(0);
      expect(r.quality).toBe("sus2");
      expect(r.confidence).toBe(1);
    });

    it("diminished [60, 63, 66] → quality diminished", () => {
      const r = analyzeHarmony([60, 63, 66]);
      expect(r.rootPitchClass).toBe(0);
      expect(r.quality).toBe("diminished");
      expect(r.confidence).toBe(1);
    });

    it("negative MIDI [-5] → pitch-class 7", () => {
      // -5 mod 12 = 7 (G)
      const r = analyzeHarmony([-5]);
      expect(r.pitchClasses).toEqual([7]);
    });

    it("non-finite notes are filtered (NaN/Infinity)", () => {
      const r = analyzeHarmony([60, NaN, 64, Infinity, 67]);
      expect(r.pitchClasses).toEqual([0, 4, 7]);
      expect(r.quality).toBe("major");
      expect(r.confidence).toBe(1);
    });

    it("all non-finite → defaults", () => {
      const r = analyzeHarmony([NaN, Infinity, -Infinity]);
      expect(r.rootPitchClass).toBe(0);
      expect(r.quality).toBe("major");
      expect(r.confidence).toBe(0);
      expect(r.pitchClasses).toEqual([]);
    });

    it("tie-break: simpler quality wins (major over sus4 if equal)", () => {
      // [60] alone matches the 'root' of every template with score 1/n
      // major has priority 0 → should win on tie
      const r = analyzeHarmony([60]);
      expect(r.quality).toBe("major");
    });

    it("non-array input → defaults (defensive)", () => {
      // @ts-expect-error — runtime defensive check
      const r = analyzeHarmony(null);
      expect(r.confidence).toBe(0);
      expect(r.pitchClasses).toEqual([]);
    });

    it("pitchClasses are sorted ascending", () => {
      const r = analyzeHarmony([67, 60, 64]);
      expect(r.pitchClasses).toEqual([0, 4, 7]);
    });

    it("duplicate notes collapse to unique pitch-classes", () => {
      const r = analyzeHarmony([60, 60, 60, 64, 67]);
      expect(r.pitchClasses).toEqual([0, 4, 7]);
      expect(r.confidence).toBe(1);
    });
  });

  describe("formatHarmonyResult", () => {
    it("C major 100% → 'C (100%)'", () => {
      const s = formatHarmonyResult({
        rootPitchClass: 0,
        quality: "major",
        confidence: 1,
        pitchClasses: [0, 4, 7],
      });
      expect(s).toBe("C (100%)");
    });

    it("A minor 80% → 'Am (80%)'", () => {
      const s = formatHarmonyResult({
        rootPitchClass: 9,
        quality: "minor",
        confidence: 0.8,
        pitchClasses: [9, 0, 4],
      });
      expect(s).toBe("Am (80%)");
    });

    it("G7 45% → 'G7 (45%)'", () => {
      const s = formatHarmonyResult({
        rootPitchClass: 7,
        quality: "7",
        confidence: 0.45,
        pitchClasses: [7, 11, 2, 5],
      });
      expect(s).toBe("G7 (45%)");
    });

    it("F maj7 → 'Fmaj7 (62%)'", () => {
      const s = formatHarmonyResult({
        rootPitchClass: 5,
        quality: "maj7",
        confidence: 0.62,
        pitchClasses: [5, 9, 0, 4],
      });
      expect(s).toBe("Fmaj7 (62%)");
    });

    it("clamps confidence > 1 to 100%", () => {
      const s = formatHarmonyResult({
        rootPitchClass: 0,
        quality: "major",
        confidence: 1.5,
        pitchClasses: [],
      });
      expect(s).toBe("C (100%)");
    });

    it("clamps negative confidence to 0%", () => {
      const s = formatHarmonyResult({
        rootPitchClass: 0,
        quality: "major",
        confidence: -0.2,
        pitchClasses: [],
      });
      expect(s).toBe("C (0%)");
    });
  });

  describe("PITCH_CLASS_NAMES", () => {
    it("has exactly 12 entries", () => {
      expect(PITCH_CLASS_NAMES).toHaveLength(12);
    });

    it("starts with C and ends with B", () => {
      expect(PITCH_CLASS_NAMES[0]).toBe("C");
      expect(PITCH_CLASS_NAMES[11]).toBe("B");
    });

    it("contains all expected names", () => {
      expect(PITCH_CLASS_NAMES).toEqual([
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
      ]);
    });
  });
});
