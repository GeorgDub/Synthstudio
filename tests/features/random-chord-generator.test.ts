/**
 * tests/features/random-chord-generator.test.ts (v3.175.0)
 *
 * Unit-Tests fuer randomChordGenerator.ts - Random-Chord-Generator.
 * Verifiziert generateRandomChords-Determinismus, Constants,
 * midiNoteToName und defensive Behavior.
 */
import { describe, it, expect } from "vitest";
import {
  generateRandomChords,
  midiNoteToName,
  CHORD_INTERVALS,
  SCALE_INTERVALS,
  MOOD_PRESETS,
  type GeneratedChord,
} from "../../client/src/utils/randomChordGenerator";

// --- generateRandomChords ------------------------------------------------------

describe("generateRandomChords", () => {
  it("liefert per Default 4 Chords", () => {
    const result = generateRandomChords();
    expect(result).toHaveLength(4);
    for (const chord of result) {
      expect(Array.isArray(chord.notes)).toBe(true);
      expect(chord.notes.length).toBeGreaterThan(0);
      expect(typeof chord.rootNote).toBe("number");
      expect(typeof chord.quality).toBe("string");
      expect(typeof chord.name).toBe("string");
    }
  });

  it("ist deterministisch: gleicher Seed -> gleiches Output", () => {
    const a = generateRandomChords({ seed: 42, count: 6 });
    const b = generateRandomChords({ seed: 42, count: 6 });
    expect(b).toEqual(a);
  });

  it("unterschiedlicher Seed -> unterschiedliches Output", () => {
    const a = generateRandomChords({ seed: 1, count: 8 });
    const b = generateRandomChords({ seed: 999, count: 8 });
    // Mind. eines der Chord-Objekte muss sich unterscheiden
    const sameJson = JSON.stringify(a) === JSON.stringify(b);
    expect(sameJson).toBe(false);
  });

  it("count=0 -> leeres Array", () => {
    expect(generateRandomChords({ count: 0 })).toEqual([]);
  });

  it("mood='dark' -> alle qualities aus MOOD_PRESETS.dark.qualities", () => {
    const allowed = new Set(MOOD_PRESETS.dark.qualities);
    const result = generateRandomChords({ mood: "dark", count: 32, seed: 7 });
    expect(result.length).toBe(32);
    for (const chord of result) {
      expect(allowed.has(chord.quality)).toBe(true);
    }
  });
});

// --- CHORD_INTERVALS -----------------------------------------------------------

describe("CHORD_INTERVALS", () => {
  it("major = [0, 4, 7]", () => {
    expect(CHORD_INTERVALS.major).toEqual([0, 4, 7]);
  });

  it("m7 = [0, 3, 7, 10]", () => {
    expect(CHORD_INTERVALS.m7).toEqual([0, 3, 7, 10]);
  });
});

// --- SCALE_INTERVALS -----------------------------------------------------------

describe("SCALE_INTERVALS", () => {
  it("major = [0, 2, 4, 5, 7, 9, 11], length 7", () => {
    expect(SCALE_INTERVALS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(SCALE_INTERVALS.major.length).toBe(7);
  });
});

// --- MOOD_PRESETS --------------------------------------------------------------

describe("MOOD_PRESETS", () => {
  it("dreamy.scale = 'lydian'", () => {
    expect(MOOD_PRESETS.dreamy.scale).toBe("lydian");
  });
});

// --- midiNoteToName ------------------------------------------------------------

describe("midiNoteToName", () => {
  it("60 -> 'C4'", () => {
    expect(midiNoteToName(60)).toBe("C4");
  });

  it("61 -> 'C#4'", () => {
    expect(midiNoteToName(61)).toBe("C#4");
  });

  it("0 -> 'C-1'", () => {
    expect(midiNoteToName(0)).toBe("C-1");
  });
});

// --- Defensive -----------------------------------------------------------------

describe("defensive behavior", () => {
  it("rootMidi NaN -> 60 default (chord notes liegen bei C4-Region)", () => {
    const result = generateRandomChords({ rootMidi: NaN, count: 1, seed: 1 });
    expect(result).toHaveLength(1);
    // Mit scale=major + seed=1 muss rootNote im C-major-scale (relativ zu 60) liegen.
    // scale intervals: [0,2,4,5,7,9,11] -> rootNote element of [60,62,64,65,67,69,71]
    const validRoots = [60, 62, 64, 65, 67, 69, 71];
    expect(validRoots).toContain(result[0].rootNote);
  });

  it("count negativ -> leeres Array", () => {
    expect(generateRandomChords({ count: -5 })).toEqual([]);
    expect(generateRandomChords({ count: -1 })).toEqual([]);
  });

  it("rootMidi <0 oder >127 -> 60 default", () => {
    const r1 = generateRandomChords({ rootMidi: -10, count: 1, seed: 1 });
    const r2 = generateRandomChords({ rootMidi: 200, count: 1, seed: 1 });
    const validRoots = [60, 62, 64, 65, 67, 69, 71];
    expect(validRoots).toContain(r1[0].rootNote);
    expect(validRoots).toContain(r2[0].rootNote);
  });

  it("invalide scale -> 'major' fallback", () => {
    // @ts-expect-error - bewusst invalider scale-Type fuer defensive test
    const result = generateRandomChords({ scale: "klingon", count: 4, seed: 5 });
    const baseline = generateRandomChords({ scale: "major", count: 4, seed: 5 });
    expect(result).toEqual(baseline);
  });

  it("invalide mood -> wird ignoriert, scale wird verwendet", () => {
    // @ts-expect-error - bewusst invalider mood
    const result = generateRandomChords({ mood: "nonsense", scale: "dorian", count: 4, seed: 3 });
    const baseline = generateRandomChords({ scale: "dorian", count: 4, seed: 3 });
    expect(result).toEqual(baseline);
  });

  it("count > 64 -> auf 64 geclamped", () => {
    const result = generateRandomChords({ count: 200, seed: 1 });
    expect(result.length).toBe(64);
  });

  it("midiNoteToName mit NaN -> fallback 'C4'", () => {
    expect(midiNoteToName(NaN)).toBe("C4");
  });
});

// --- GeneratedChord-Shape ------------------------------------------------------

describe("GeneratedChord shape", () => {
  it("notes sind sortiert ascending und liegen alle in 0..127", () => {
    const chords = generateRandomChords({ count: 16, seed: 12345, rootMidi: 120 });
    for (const chord of chords) {
      // ascending
      for (let i = 1; i < chord.notes.length; i++) {
        expect(chord.notes[i]).toBeGreaterThanOrEqual(chord.notes[i - 1]);
      }
      // range
      for (const n of chord.notes) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(127);
      }
    }
  });

  it("name beginnt mit Note-Letter (kein Octave-Suffix im Chord-Name)", () => {
    const chords: GeneratedChord[] = generateRandomChords({ count: 8, seed: 11 });
    // Acceptable first chars: NOTE_NAMES
    const noteLetters = ["C", "D", "E", "F", "G", "A", "B"];
    for (const chord of chords) {
      expect(noteLetters).toContain(chord.name[0]);
      // Spec: "Cm7" — kein Digit fuer Octave als zweites Zeichen
      // (außer es ist "#" oder direkt Quality-Suffix)
      expect(/^[A-G](#)?(m|dim|aug|sus2|sus4|maj7|m7|7|9)?$/.test(chord.name)).toBe(true);
    }
  });
});
