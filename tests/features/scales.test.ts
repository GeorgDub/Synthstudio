/**
 * tests/features/scales.test.ts (TASK-CVG-SCALES / v2.60)
 *
 * Pure-Coverage für client/src/utils/scales.ts (119 LOC).
 *
 * Music-Theory ist heikel — gerade snapToScale wird vom Piano-Roll auf
 * jedem User-Click aufgerufen und darf weder crashen (BUG-025) noch
 * falsche Noten produzieren. Diese Suite verifiziert alle 13 Skalen,
 * den Type-Guard für Persistenz-Boundaries und die Pitch-Class-Math
 * inklusive negativer Eingaben.
 */
import { describe, it, expect } from "vitest";
import {
  SCALES,
  KNOWN_SCALE_IDS,
  NOTE_NAMES,
  isKnownScaleId,
  getScale,
  pitchClass,
  isInScale,
  snapToScale,
  scalePitchClasses,
  pitchClassName,
  type ScaleId,
} from "@/utils/scales";

describe("Scales – Schema-Integrität", () => {
  it("SCALES enthält genau 13 Definitionen", () => {
    expect(SCALES).toHaveLength(13);
  });

  it("jede Scale hat id, label und Intervals startend mit 0", () => {
    for (const s of SCALES) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.intervals.length).toBeGreaterThan(0);
      expect(s.intervals[0]).toBe(0);
    }
  });

  it("jede Scale hat aufsteigend sortierte Intervalle", () => {
    for (const s of SCALES) {
      for (let i = 1; i < s.intervals.length; i++) {
        expect(s.intervals[i]).toBeGreaterThan(s.intervals[i - 1]);
      }
    }
  });

  it("jedes Intervall liegt im [0, 11] Bereich (Halbtöne innerhalb einer Oktave)", () => {
    for (const s of SCALES) {
      for (const iv of s.intervals) {
        expect(iv).toBeGreaterThanOrEqual(0);
        expect(iv).toBeLessThanOrEqual(11);
      }
    }
  });

  it("KNOWN_SCALE_IDS deckt alle Scale-IDs ab", () => {
    expect(KNOWN_SCALE_IDS.size).toBe(SCALES.length);
    for (const s of SCALES) expect(KNOWN_SCALE_IDS.has(s.id)).toBe(true);
  });

  it("NOTE_NAMES hat 12 Einträge in Standard-Reihenfolge", () => {
    expect(NOTE_NAMES).toEqual(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
  });
});

describe("Scales – isKnownScaleId Type-Guard", () => {
  it("true für alle bekannten IDs", () => {
    for (const s of SCALES) expect(isKnownScaleId(s.id)).toBe(true);
  });

  it("false für unbekannte Strings", () => {
    expect(isKnownScaleId("not-a-scale")).toBe(false);
    expect(isKnownScaleId("")).toBe(false);
    expect(isKnownScaleId("MAJOR")).toBe(false); // case-sensitive
  });

  it("false für non-string Werte (Persistenz-Boundary)", () => {
    expect(isKnownScaleId(null)).toBe(false);
    expect(isKnownScaleId(undefined)).toBe(false);
    expect(isKnownScaleId(42)).toBe(false);
    expect(isKnownScaleId({})).toBe(false);
    expect(isKnownScaleId([])).toBe(false);
  });
});

describe("Scales – getScale", () => {
  it("major liefert [0,2,4,5,7,9,11]", () => {
    expect(getScale("major").intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it("minor liefert [0,2,3,5,7,8,10]", () => {
    expect(getScale("minor").intervals).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });

  it("pentatonic-major hat genau 5 Noten", () => {
    expect(getScale("pentatonic-major").intervals).toHaveLength(5);
  });

  it("chromatic hat 12 Noten (alle Halbtöne)", () => {
    expect(getScale("chromatic").intervals).toHaveLength(12);
  });

  it("wirft für unbekannte ID (sollte durch isKnownScaleId-Boundary nie erreicht werden)", () => {
    expect(() => getScale("invalid" as ScaleId)).toThrow(/Unknown scale id/);
  });
});

describe("Scales – pitchClass", () => {
  it("MIDI 60 (C4) → 0", () => expect(pitchClass(60)).toBe(0));
  it("MIDI 61 (C#4) → 1", () => expect(pitchClass(61)).toBe(1));
  it("MIDI 72 (C5) → 0", () => expect(pitchClass(72)).toBe(0));
  it("MIDI 0 → 0", () => expect(pitchClass(0)).toBe(0));
  it("MIDI 127 → 7 (G)", () => expect(pitchClass(127)).toBe(7));

  it("negative Note: -1 → 11 (B, eine Oktave unter C)", () => {
    expect(pitchClass(-1)).toBe(11);
  });

  it("negative Note: -12 → 0", () => {
    expect(pitchClass(-12)).toBe(0);
  });
});

describe("Scales – isInScale", () => {
  it("C-Dur: C(60) ist in der Skala mit Root C(60)", () => {
    expect(isInScale(60, 60, "major")).toBe(true);
  });

  it("C-Dur: C#(61) ist NICHT in der Skala", () => {
    expect(isInScale(61, 60, "major")).toBe(false);
  });

  it("C-Dur: E(64) ist in der Skala", () => {
    expect(isInScale(64, 60, "major")).toBe(true);
  });

  it("C-Dur: über Oktaven hinweg: C5(72) ist auch in C-Dur", () => {
    expect(isInScale(72, 60, "major")).toBe(true);
  });

  it("Chromatic akzeptiert alle Noten", () => {
    for (let n = 0; n <= 11; n++) {
      expect(isInScale(60 + n, 60, "chromatic")).toBe(true);
    }
  });

  it("D-Dorian: D(62) Root, F(65) ist in", () => {
    expect(isInScale(65, 62, "dorian")).toBe(true);
  });
});

describe("Scales – snapToScale", () => {
  it("Chromatic: gibt Note unverändert zurück", () => {
    expect(snapToScale(73, 60, "chromatic")).toBe(73);
    expect(snapToScale(0, 60, "chromatic")).toBe(0);
  });

  it("In-Scale Note bleibt unverändert", () => {
    // C-Major mit Root C: E(64) ist drin → bleibt
    expect(snapToScale(64, 60, "major")).toBe(64);
  });

  it("C-Dur: C#(61) snappt zur nächstgelegenen Scale-Note", () => {
    // Distanz 1 hoch zu D(62) und 1 runter zu C(60) → Konvention: höhere bevorzugen
    const result = snapToScale(61, 60, "major");
    expect([60, 62]).toContain(result);
  });

  it("C-Dur: F#(66) snappt zu F(65) oder G(67)", () => {
    const result = snapToScale(66, 60, "major");
    expect([65, 67]).toContain(result);
  });

  it("Pentatonic-Major: nur 5-Noten-Skala, Snap ist aggressiv", () => {
    // Pentatonic-Major: [0,2,4,7,9] → C,D,E,G,A. F(65) → snappt zu E(64) oder G(67).
    const result = snapToScale(65, 60, "pentatonic-major");
    expect([64, 67]).toContain(result);
  });
});

describe("Scales – scalePitchClasses", () => {
  it("C-Major: [0,2,4,5,7,9,11]", () => {
    expect(scalePitchClasses(60, "major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it("D-Major (Root=62 → PC=2): rotiert um 2", () => {
    expect(scalePitchClasses(62, "major")).toEqual([2, 4, 6, 7, 9, 11, 1]);
  });

  it("Chromatic: alle 12 PCs in Reihenfolge ab Root", () => {
    expect(scalePitchClasses(60, "chromatic")).toHaveLength(12);
  });

  it("Egal welche Oktave: gleiche Pitch-Classes wie für gleichen Root", () => {
    expect(scalePitchClasses(60, "major")).toEqual(scalePitchClasses(72, "major"));
  });
});

describe("Scales – pitchClassName", () => {
  it("0 → C", () => expect(pitchClassName(0)).toBe("C"));
  it("1 → C#", () => expect(pitchClassName(1)).toBe("C#"));
  it("11 → B", () => expect(pitchClassName(11)).toBe("B"));

  it("akzeptiert auch MIDI-Noten (wendet pitchClass selbst an)", () => {
    expect(pitchClassName(60)).toBe("C");
    expect(pitchClassName(127)).toBe("G");
  });

  it("akzeptiert negative Werte", () => {
    expect(pitchClassName(-1)).toBe("B");
  });
});
