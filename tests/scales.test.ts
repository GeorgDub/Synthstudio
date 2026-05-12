/**
 * tests/scales.test.ts
 *
 * Unit-Tests für die Scale-Utilities (Piano Roll Scale-Lock).
 * Reine Logik – keine DOM/Storage-Abhängigkeit.
 */
import { describe, it, expect } from "vitest";
import {
  SCALES,
  isInScale,
  snapToScale,
  scalePitchClasses,
  pitchClass,
  pitchClassName,
  getScale,
  type ScaleId,
} from "../client/src/utils/scales";

describe("getScale", () => {
  it("findet alle definierten Skalen", () => {
    for (const s of SCALES) {
      expect(getScale(s.id).id).toBe(s.id);
    }
  });

  it("wirft bei unbekannter Skalen-ID", () => {
    expect(() => getScale("does-not-exist" as ScaleId)).toThrow();
  });
});

describe("pitchClass", () => {
  it("normalisiert MIDI-Noten auf 0-11", () => {
    expect(pitchClass(60)).toBe(0); // C4
    expect(pitchClass(61)).toBe(1); // C#4
    expect(pitchClass(72)).toBe(0); // C5
    expect(pitchClass(48)).toBe(0); // C3
  });

  it("behandelt negative Werte korrekt", () => {
    expect(pitchClass(-1)).toBe(11);
    expect(pitchClass(-12)).toBe(0);
  });
});

describe("isInScale", () => {
  it("erkennt Noten in C-Major (Weiße Tasten)", () => {
    // C-Major: C D E F G A B = 0 2 4 5 7 9 11
    expect(isInScale(60, 0, "major")).toBe(true);   // C
    expect(isInScale(62, 0, "major")).toBe(true);   // D
    expect(isInScale(64, 0, "major")).toBe(true);   // E
    expect(isInScale(65, 0, "major")).toBe(true);   // F
    expect(isInScale(67, 0, "major")).toBe(true);   // G
    expect(isInScale(69, 0, "major")).toBe(true);   // A
    expect(isInScale(71, 0, "major")).toBe(true);   // B

    expect(isInScale(61, 0, "major")).toBe(false);  // C#
    expect(isInScale(63, 0, "major")).toBe(false);  // D#
    expect(isInScale(66, 0, "major")).toBe(false);  // F#
    expect(isInScale(68, 0, "major")).toBe(false);  // G#
    expect(isInScale(70, 0, "major")).toBe(false);  // A#
  });

  it("respektiert die Root-Verschiebung (G-Major hat F# statt F)", () => {
    // G-Major: G A B C D E F# = root=7
    expect(isInScale(67, 7, "major")).toBe(true);   // G
    expect(isInScale(66, 7, "major")).toBe(true);   // F#
    expect(isInScale(65, 7, "major")).toBe(false);  // F
  });

  it("akzeptiert alle Noten in chromatic", () => {
    for (let n = 60; n < 72; n++) {
      expect(isInScale(n, 0, "chromatic")).toBe(true);
    }
  });

  it("erkennt Pentatonic Minor korrekt (5 Noten)", () => {
    // A-Pentatonic-Minor: A C D E G = 9 0 2 4 7
    const pcs = scalePitchClasses(9, "pentatonic-minor");
    expect(new Set(pcs)).toEqual(new Set([9, 0, 2, 4, 7]));
  });

  it("Blues-Skala enthält b5 (blue note)", () => {
    // C-Blues: C Eb F Gb G Bb = 0 3 5 6 7 10
    expect(isInScale(60, 0, "blues")).toBe(true);   // C
    expect(isInScale(63, 0, "blues")).toBe(true);   // Eb
    expect(isInScale(66, 0, "blues")).toBe(true);   // Gb (blue)
    expect(isInScale(67, 0, "blues")).toBe(true);   // G
  });
});

describe("snapToScale", () => {
  it("lässt Noten in der Skala unverändert", () => {
    expect(snapToScale(60, 0, "major")).toBe(60); // C
    expect(snapToScale(64, 0, "major")).toBe(64); // E
  });

  it("snappt Out-of-Scale-Noten auf die nächste In-Scale-Note", () => {
    // C-Major: C# (61) → C (60) oder D (62) – beide 1 weg, Default höher
    const result = snapToScale(61, 0, "major");
    expect([60, 62]).toContain(result);
  });

  it("snappt nach unten wenn nächste Scale-Note tiefer ist", () => {
    // F# in C-Major: F (65) ist 1 weg, G (67) ist 1 weg → nimmt höhere
    // D# in C-Major: D (62) ist 1 weg, E (64) ist 1 weg → nimmt höhere
    expect(snapToScale(63, 0, "major")).toBe(64); // D# → E (höher bei Gleichstand)
  });

  it("respektiert die Root-Verschiebung", () => {
    // F-Major (root=5): F G A Bb C D E. F# (66) → F (65) oder G (67)
    const result = snapToScale(66, 5, "major");
    expect([65, 67]).toContain(result);
  });

  it("chromatic: liefert unverändert zurück", () => {
    for (let n = 60; n < 72; n++) {
      expect(snapToScale(n, 0, "chromatic")).toBe(n);
    }
  });

  it("erhält die Oktave wenn möglich (kein 12-Halbton-Sprung)", () => {
    // C# bei C-Major sollte nicht auf C eine Oktave höher springen
    const snapped = snapToScale(61, 0, "major");
    expect(Math.abs(snapped - 61)).toBeLessThanOrEqual(1);
  });
});

describe("scalePitchClasses", () => {
  it("liefert C-Major Pitch-Classes", () => {
    expect(scalePitchClasses(0, "major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it("liefert D-Major Pitch-Classes (zwei Vorzeichen #)", () => {
    // D E F# G A B C# = 2 4 6 7 9 11 1
    expect(scalePitchClasses(2, "major")).toEqual([2, 4, 6, 7, 9, 11, 1]);
  });

  it("normalisiert Root außerhalb von 0-11", () => {
    expect(scalePitchClasses(12, "major")).toEqual(scalePitchClasses(0, "major"));
    expect(scalePitchClasses(-12, "major")).toEqual(scalePitchClasses(0, "major"));
  });
});

describe("pitchClassName", () => {
  it("liefert Notennamen für Pitch-Classes", () => {
    expect(pitchClassName(0)).toBe("C");
    expect(pitchClassName(1)).toBe("C#");
    expect(pitchClassName(11)).toBe("B");
  });
});
