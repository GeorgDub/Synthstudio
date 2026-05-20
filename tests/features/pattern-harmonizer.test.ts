/**
 * tests/features/pattern-harmonizer.test.ts (v3.193.0)
 *
 * Unit-Tests fuer patternHarmonizer.ts – Pattern-Harmonizer Pure-Helpers.
 * Verifiziert harmonizeNote / harmonizeNotes / HARMONY_INTERVAL_SEMITONES.
 */
import { describe, it, expect } from "vitest";
import {
  harmonizeNote,
  harmonizeNotes,
  HARMONY_INTERVAL_SEMITONES,
  type HarmonyInterval,
  type HarmonizedNote,
} from "../../client/src/utils/patternHarmonizer";

// --- 1. Default Behavior -------------------------------------------------------

describe("harmonizeNote – defaults", () => {
  it("ohne options + C4 → 2 harmonies (third + fifth, sorted ascending)", () => {
    const result = harmonizeNote(60);
    expect(result.rootMidi).toBe(60);
    expect(result.harmonies).toHaveLength(2);
    expect(result.harmonies[0].interval).toBe("third");
    expect(result.harmonies[0].midi).toBe(64);
    expect(result.harmonies[1].interval).toBe("fifth");
    expect(result.harmonies[1].midi).toBe(67);
  });
});

// --- 2. Scale-Aware Third / Fifth ---------------------------------------------

describe("harmonizeNote – scale-aware third/fifth", () => {
  it("major C4: 3rd=E4(64), 5th=G4(67)", () => {
    const r = harmonizeNote(60, {
      scale: "major",
      scaleRoot: 0,
      intervals: ["third", "fifth"],
    });
    const third = r.harmonies.find((h) => h.interval === "third");
    const fifth = r.harmonies.find((h) => h.interval === "fifth");
    expect(third?.midi).toBe(64);
    expect(fifth?.midi).toBe(67);
  });

  it("minor-natural C4: 3rd=Eb4(63), 5th=G4(67)", () => {
    const r = harmonizeNote(60, {
      scale: "minor-natural",
      scaleRoot: 0,
      intervals: ["third", "fifth"],
    });
    const third = r.harmonies.find((h) => h.interval === "third");
    const fifth = r.harmonies.find((h) => h.interval === "fifth");
    expect(third?.midi).toBe(63);
    expect(fifth?.midi).toBe(67);
  });

  it("phrygian C4: 3rd=Eb4(63) (degree 2 = 3 semitones)", () => {
    const r = harmonizeNote(60, {
      scale: "phrygian",
      scaleRoot: 0,
      intervals: ["third"],
    });
    expect(r.harmonies[0].midi).toBe(63);
  });

  it("lydian C4: 3rd=E4(64) (degree 2 = 4 semitones)", () => {
    const r = harmonizeNote(60, {
      scale: "lydian",
      scaleRoot: 0,
      intervals: ["third"],
    });
    expect(r.harmonies[0].midi).toBe(64);
  });
});

// --- 3. Octave-Up / Octave-Down -----------------------------------------------

describe("harmonizeNote – octaves", () => {
  it("octave-up: rootMidi+12", () => {
    const r = harmonizeNote(60, { intervals: ["octave-up"] });
    expect(r.harmonies).toHaveLength(1);
    expect(r.harmonies[0].midi).toBe(72);
    expect(r.harmonies[0].interval).toBe("octave-up");
  });

  it("octave-down: rootMidi-12", () => {
    const r = harmonizeNote(60, { intervals: ["octave-down"] });
    expect(r.harmonies[0].midi).toBe(48);
    expect(r.harmonies[0].interval).toBe("octave-down");
  });

  it("octave-up+octave-down: harmonies sorted ascending (low first)", () => {
    const r = harmonizeNote(60, { intervals: ["octave-up", "octave-down"] });
    expect(r.harmonies[0].interval).toBe("octave-down");
    expect(r.harmonies[0].midi).toBe(48);
    expect(r.harmonies[1].interval).toBe("octave-up");
    expect(r.harmonies[1].midi).toBe(72);
  });
});

// --- 4. Tenth / Twelfth -------------------------------------------------------

describe("harmonizeNote – tenth + twelfth", () => {
  it("tenth (major C4) = +12 + scale-3rd = 76 (E5)", () => {
    const r = harmonizeNote(60, {
      scale: "major",
      intervals: ["tenth"],
    });
    expect(r.harmonies[0].midi).toBe(76);
  });

  it("tenth (minor-natural C4) = +12 + minor-3rd = 75 (Eb5)", () => {
    const r = harmonizeNote(60, {
      scale: "minor-natural",
      intervals: ["tenth"],
    });
    expect(r.harmonies[0].midi).toBe(75);
  });

  it("twelfth = rootMidi+19 (fix-chromatisch)", () => {
    const r = harmonizeNote(60, { intervals: ["twelfth"] });
    expect(r.harmonies[0].midi).toBe(79);
  });
});

// --- 5. Clamping ---------------------------------------------------------------

describe("harmonizeNote – clamping", () => {
  it("octave-up bei rootMidi 120 → 127 (clamped, nicht 132)", () => {
    const r = harmonizeNote(120, { intervals: ["octave-up"] });
    expect(r.harmonies[0].midi).toBe(127);
  });

  it("octave-down bei rootMidi 5 → 0 (clamped, nicht -7)", () => {
    const r = harmonizeNote(5, { intervals: ["octave-down"] });
    expect(r.harmonies[0].midi).toBe(0);
  });

  it("twelfth bei rootMidi 115 → 127 (clamped)", () => {
    const r = harmonizeNote(115, { intervals: ["twelfth"] });
    expect(r.harmonies[0].midi).toBe(127);
  });
});

// --- 6. Defensive Behavior ----------------------------------------------------

describe("harmonizeNote – defensive", () => {
  it("rootMidi NaN → fallback 60", () => {
    const r = harmonizeNote(Number.NaN);
    expect(r.rootMidi).toBe(60);
    expect(r.harmonies).toHaveLength(2);
    expect(r.harmonies[0].midi).toBe(64);
    expect(r.harmonies[1].midi).toBe(67);
  });

  it("rootMidi <0 oder >127 → fallback 60", () => {
    const a = harmonizeNote(-5);
    const b = harmonizeNote(200);
    expect(a.rootMidi).toBe(60);
    expect(b.rootMidi).toBe(60);
  });

  it("invalid scale → fallback major", () => {
    const r = harmonizeNote(60, {
      // @ts-expect-error invalid scale from external source
      scale: "spaghetti",
      intervals: ["third"],
    });
    expect(r.harmonies[0].midi).toBe(64); // major-3rd
  });

  it("empty intervals → fallback [third, fifth]", () => {
    const r = harmonizeNote(60, { intervals: [] });
    expect(r.harmonies).toHaveLength(2);
    expect(r.harmonies.map((h) => h.interval).sort()).toEqual(["fifth", "third"]);
  });

  it("alle intervals invalid → fallback [third, fifth]", () => {
    const r = harmonizeNote(60, {
      intervals: ["nope", "nada"] as unknown as HarmonyInterval[],
    });
    expect(r.harmonies).toHaveLength(2);
  });

  it("scaleRoot >11 oder <0 → fallback 0", () => {
    const r = harmonizeNote(60, {
      scale: "major",
      scaleRoot: 99,
      intervals: ["third"],
    });
    expect(r.harmonies[0].midi).toBe(64);
  });
});

// --- 7. Multiple Intervals Combined ------------------------------------------

describe("harmonizeNote – multi-interval combos", () => {
  it("alle 6 intervals gleichzeitig liefert 6 harmonies sorted ascending", () => {
    const r = harmonizeNote(60, {
      scale: "major",
      intervals: ["third", "fifth", "octave-up", "octave-down", "tenth", "twelfth"],
    });
    expect(r.harmonies).toHaveLength(6);
    for (let i = 1; i < r.harmonies.length; i++) {
      expect(r.harmonies[i].midi).toBeGreaterThanOrEqual(r.harmonies[i - 1].midi);
    }
    const midis = r.harmonies.map((h) => h.midi);
    expect(midis).toEqual([48, 64, 67, 72, 76, 79]);
  });
});

// --- 8. Non-Scale-Note Root ---------------------------------------------------

describe("harmonizeNote – non-scale-note root", () => {
  it("rootMidi=61 (C#) in C-major → round-down zu C-degree", () => {
    const r = harmonizeNote(61, {
      scale: "major",
      scaleRoot: 0,
      intervals: ["third", "fifth"],
    });
    const third = r.harmonies.find((h) => h.interval === "third");
    const fifth = r.harmonies.find((h) => h.interval === "fifth");
    // baseMidi = 60 (C), third = E (64), fifth = G (67)
    expect(third?.midi).toBe(64);
    expect(fifth?.midi).toBe(67);
    expect(r.rootMidi).toBe(61);
  });
});

// --- 9. ScaleRoot != 0 --------------------------------------------------------

describe("harmonizeNote – scaleRoot offset", () => {
  it("scaleRoot=2 (D), scale=major, rootMidi=62 (D4) → 3rd=F#4(66), 5th=A4(69)", () => {
    const r = harmonizeNote(62, {
      scale: "major",
      scaleRoot: 2,
      intervals: ["third", "fifth"],
    });
    const third = r.harmonies.find((h) => h.interval === "third");
    const fifth = r.harmonies.find((h) => h.interval === "fifth");
    expect(third?.midi).toBe(66);
    expect(fifth?.midi).toBe(69);
  });
});

// --- 10. HARMONY_INTERVAL_SEMITONES -------------------------------------------

describe("HARMONY_INTERVAL_SEMITONES", () => {
  it("hat 6 Eintraege", () => {
    expect(Object.keys(HARMONY_INTERVAL_SEMITONES)).toHaveLength(6);
  });

  it("enthaelt erwartete Semitone-Werte", () => {
    expect(HARMONY_INTERVAL_SEMITONES.third).toBe(4);
    expect(HARMONY_INTERVAL_SEMITONES.fifth).toBe(7);
    expect(HARMONY_INTERVAL_SEMITONES["octave-up"]).toBe(12);
    expect(HARMONY_INTERVAL_SEMITONES["octave-down"]).toBe(-12);
    expect(HARMONY_INTERVAL_SEMITONES.tenth).toBe(16);
    expect(HARMONY_INTERVAL_SEMITONES.twelfth).toBe(19);
  });
});

// --- 11. harmonizeNotes (Batch) -----------------------------------------------

describe("harmonizeNotes – batch", () => {
  it("Array von 3 Notes → 3 HarmonizedNote-Eintraege", () => {
    const result = harmonizeNotes([60, 62, 64], {
      scale: "major",
      intervals: ["third"],
    });
    expect(result).toHaveLength(3);
    expect(result[0].rootMidi).toBe(60);
    expect(result[1].rootMidi).toBe(62);
    expect(result[2].rootMidi).toBe(64);
    // C-major: C(60)->E(64), D(62)->F(65), E(64)->G(67)
    expect(result[0].harmonies[0].midi).toBe(64);
    expect(result[1].harmonies[0].midi).toBe(65);
    expect(result[2].harmonies[0].midi).toBe(67);
  });

  it("empty Array → []", () => {
    expect(harmonizeNotes([])).toEqual([]);
  });

  it("Batch-Output behaelt gleiche Options fuer alle Notes", () => {
    const result = harmonizeNotes([60, 72], {
      scale: "minor-natural",
      intervals: ["third"],
    });
    expect(result[0].harmonies[0].midi).toBe(63);
    expect(result[1].harmonies[0].midi).toBe(75);
  });
});

// --- 12. Immutability ---------------------------------------------------------

describe("harmonizeNote – immutability", () => {
  it("input intervals werden nicht mutiert", () => {
    const intervals: HarmonyInterval[] = ["third", "fifth"];
    const before = JSON.stringify(intervals);
    harmonizeNote(60, { intervals });
    expect(JSON.stringify(intervals)).toBe(before);
  });

  it("input rootNotes-Array wird nicht mutiert", () => {
    const arr = [60, 62, 64];
    const before = JSON.stringify(arr);
    harmonizeNotes(arr, { intervals: ["fifth"] });
    expect(JSON.stringify(arr)).toBe(before);
  });
});

// --- 13. Type-Safety / Return Shape -------------------------------------------

describe("harmonizeNote – return shape", () => {
  it("HarmonizedNote enthaelt rootMidi + harmonies-Array", () => {
    const r: HarmonizedNote = harmonizeNote(60);
    expect(typeof r.rootMidi).toBe("number");
    expect(Array.isArray(r.harmonies)).toBe(true);
    for (const h of r.harmonies) {
      expect(typeof h.midi).toBe("number");
      expect(typeof h.interval).toBe("string");
    }
  });
});
