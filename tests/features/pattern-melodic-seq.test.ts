/**
 * tests/features/pattern-melodic-seq.test.ts (v3.183.0)
 *
 * Unit-Tests fuer patternMelodicSeq.ts – Melodic Sequence Generator.
 * Verifiziert generateMelodicSequence-Determinismus, Strategien,
 * defensive Behavior und MELODIC_STRATEGY_LABELS.
 */
import { describe, it, expect } from "vitest";
import {
  generateMelodicSequence,
  applyMelodicPitches,
  MELODIC_STRATEGY_LABELS,
  type MelodicNote,
} from "../../client/src/utils/patternMelodicSeq";

// Hilfs-Pattern: vier aktive Steps an Positionen 0, 4, 8, 12
const FOUR_STEPS: readonly boolean[] = [
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
];

// Hilfsfunktion: nur stepIndex+midi extrahieren (velocity ist humanized)
function stripVelocity(notes: MelodicNote[]): Array<{ stepIndex: number; midi: number }> {
  return notes.map((n) => ({ stepIndex: n.stepIndex, midi: n.midi }));
}

// --- 1. Empty Pattern ----------------------------------------------------------

describe("generateMelodicSequence – empty pattern", () => {
  it("empty rhythmPattern → []", () => {
    expect(generateMelodicSequence({ rhythmPattern: [] })).toEqual([]);
  });

  it("all-false rhythmPattern → []", () => {
    const allFalse = [false, false, false, false, false, false, false, false];
    expect(generateMelodicSequence({ rhythmPattern: allFalse })).toEqual([]);
  });
});

// --- 2. Ascending --------------------------------------------------------------

describe("generateMelodicSequence – ascending", () => {
  it("4 active steps + ascending → 4 notes, monoton steigend", () => {
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "ascending",
      scale: "major",
      rootMidi: 60,
      octaveRange: 1,
    });
    expect(result).toHaveLength(4);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].midi).toBeGreaterThan(result[i - 1].midi);
    }
  });

  it("ascending: erste Note == rootMidi", () => {
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "ascending",
      rootMidi: 60,
    });
    expect(result[0].midi).toBe(60);
  });
});

// --- 3. Descending -------------------------------------------------------------

describe("generateMelodicSequence – descending", () => {
  it("4 active steps + descending → 4 notes, monoton fallend", () => {
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "descending",
      scale: "major",
      rootMidi: 60,
      octaveRange: 1,
    });
    expect(result).toHaveLength(4);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].midi).toBeLessThan(result[i - 1].midi);
    }
  });
});

// --- 4. Random Determinismus ---------------------------------------------------

describe("generateMelodicSequence – random", () => {
  it("determinismus: gleicher Seed → gleicher Output", () => {
    const a = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "random",
      seed: 42,
    });
    const b = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "random",
      seed: 42,
    });
    expect(b).toEqual(a);
  });

  it("unterschiedlicher Seed → unterschiedlicher Output", () => {
    const a = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "random",
      seed: 1,
    });
    const b = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "random",
      seed: 9999,
    });
    const sameMidi =
      JSON.stringify(stripVelocity(a)) === JSON.stringify(stripVelocity(b));
    expect(sameMidi).toBe(false);
  });
});

// --- 5. Arpeggio ---------------------------------------------------------------

describe("generateMelodicSequence – arpeggio", () => {
  it("notes folgen chord-tones (root/third/fifth)", () => {
    // major-Scale: degrees [0, 2, 4, 5, 7, 9, 11]
    // Arpeggio durchlaeuft degrees [0, 2, 4] = halftones [0, 4, 7] über rootMidi=60.
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "arpeggio",
      scale: "major",
      rootMidi: 60,
      octaveRange: 1,
    });
    expect(result).toHaveLength(4);
    expect(result[0].midi).toBe(60); // root
    expect(result[1].midi).toBe(64); // third
    expect(result[2].midi).toBe(67); // fifth
    expect(result[3].midi).toBe(60); // wrap
  });
});

// --- 6. rootMidi-Bound ---------------------------------------------------------

describe("generateMelodicSequence – rootMidi bounds", () => {
  it("alle notes >= rootMidi (ascending, octaveRange 1)", () => {
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "ascending",
      rootMidi: 72,
      octaveRange: 1,
    });
    for (const note of result) {
      expect(note.midi).toBeGreaterThanOrEqual(72);
    }
  });
});

// --- 7. Octave Range Cap -------------------------------------------------------

describe("generateMelodicSequence – octaveRange", () => {
  it("octaveRange 2 → max note <= rootMidi + 24", () => {
    const longPattern: boolean[] = [];
    for (let i = 0; i < 32; i++) longPattern.push(true);
    const result = generateMelodicSequence({
      rhythmPattern: longPattern,
      strategy: "ascending",
      scale: "major",
      rootMidi: 60,
      octaveRange: 2,
    });
    for (const note of result) {
      expect(note.midi).toBeLessThanOrEqual(60 + 24);
    }
  });

  it("octaveRange clamps: octaveRange=5 → effectively 3", () => {
    const longPattern: boolean[] = [];
    for (let i = 0; i < 40; i++) longPattern.push(true);
    const result = generateMelodicSequence({
      rhythmPattern: longPattern,
      strategy: "ascending",
      scale: "major",
      rootMidi: 60,
      octaveRange: 5,
    });
    for (const note of result) {
      expect(note.midi).toBeLessThanOrEqual(60 + 36);
    }
  });
});

// --- 8. Velocity ---------------------------------------------------------------

describe("generateMelodicSequence – velocity", () => {
  it("velocity in 1..127", () => {
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "random",
      seed: 123,
    });
    for (const note of result) {
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
    }
  });
});

// --- 9. stepIndex matches active pattern positions ----------------------------

describe("generateMelodicSequence – stepIndex mapping", () => {
  it("stepIndex matches aktive rhythmPattern-Indices", () => {
    const pattern: readonly boolean[] = [
      false, true, false, true, false, false, true, false,
      true, false, false, false, true, false, false, true,
    ];
    const expectedStepIndices = pattern
      .map((on, idx) => (on ? idx : -1))
      .filter((i) => i >= 0);

    const result = generateMelodicSequence({
      rhythmPattern: pattern,
      strategy: "ascending",
    });
    expect(result.map((n) => n.stepIndex)).toEqual(expectedStepIndices);
  });
});

// --- 10. Defensive Behaviour ---------------------------------------------------

describe("generateMelodicSequence – defensive", () => {
  it("invalid strategy → fallback ascending", () => {
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      // @ts-expect-error – simulate invalid strategy from external source
      strategy: "spaghetti",
      rootMidi: 60,
      scale: "major",
      octaveRange: 1,
    });
    expect(result).toHaveLength(4);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].midi).toBeGreaterThan(result[i - 1].midi);
    }
  });

  it("rootMidi NaN → fallback 60", () => {
    const result = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "ascending",
      rootMidi: Number.NaN,
    });
    expect(result[0].midi).toBe(60);
  });

  it("rootMidi <0 oder >127 → fallback 60", () => {
    const a = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "ascending",
      rootMidi: -5,
    });
    const b = generateMelodicSequence({
      rhythmPattern: FOUR_STEPS,
      strategy: "ascending",
      rootMidi: 200,
    });
    expect(a[0].midi).toBe(60);
    expect(b[0].midi).toBe(60);
  });

  it("octaveRange NaN / <1 → 1", () => {
    const long: boolean[] = [];
    for (let i = 0; i < 20; i++) long.push(true);
    const result = generateMelodicSequence({
      rhythmPattern: long,
      strategy: "ascending",
      octaveRange: Number.NaN,
      rootMidi: 60,
      scale: "major",
    });
    for (const n of result) {
      expect(n.midi).toBeLessThanOrEqual(60 + 12);
    }
  });
});

// --- 11. MELODIC_STRATEGY_LABELS ----------------------------------------------

describe("MELODIC_STRATEGY_LABELS", () => {
  it("hat 6 Eintraege", () => {
    expect(Object.keys(MELODIC_STRATEGY_LABELS)).toHaveLength(6);
  });

  it("enthaelt alle Strategien", () => {
    expect(MELODIC_STRATEGY_LABELS.ascending).toBe("Ascending");
    expect(MELODIC_STRATEGY_LABELS.descending).toBe("Descending");
    expect(MELODIC_STRATEGY_LABELS.alternating).toBe("Alternating (UpDown)");
    expect(MELODIC_STRATEGY_LABELS.random).toBe("Random");
    expect(MELODIC_STRATEGY_LABELS.stepwise).toBe("Stepwise");
    expect(MELODIC_STRATEGY_LABELS.arpeggio).toBe("Arpeggio (Root-3rd-5th)");
  });
});

// --- 12. Default Behavior -----------------------------------------------------

describe("generateMelodicSequence – defaults", () => {
  it("ohne rhythmPattern → benutzt default ([1,0,0,0]x4 = 4 notes)", () => {
    const result = generateMelodicSequence();
    expect(result).toHaveLength(4);
    expect(result[0].midi).toBe(60);
    expect(result.map((n) => n.stepIndex)).toEqual([0, 4, 8, 12]);
  });
});

// --- 13. Alternating Behavior --------------------------------------------------

describe("generateMelodicSequence – alternating", () => {
  it("alternating: erste Note unten, zweite oben (degree-Sequenz 0, total-1, 1, ...)", () => {
    const sixSteps: readonly boolean[] = [
      true, true, true, true, true, true,
    ];
    const result = generateMelodicSequence({
      rhythmPattern: sixSteps,
      strategy: "alternating",
      scale: "major",
      rootMidi: 60,
      octaveRange: 1,
    });
    expect(result).toHaveLength(6);
    // i=0 → half=0, i%2==0 → degree=0 → midi 60
    expect(result[0].midi).toBe(60);
    // i=1 → half=0, i%2!=0 → degree=totalDegrees-1=6 → halftone 11 → 71
    expect(result[1].midi).toBe(71);
  });
});

// ─── v3.242: applyMelodicPitches (MIDI-Noten → Step-Pitch-Offsets) ────────────

describe("applyMelodicPitches", () => {
  it("setzt (midi - rootMidi) als Halbton-Offset für Noten-Steps", () => {
    const notes: MelodicNote[] = [
      { stepIndex: 0, midi: 60, velocity: 100 }, // root → 0
      { stepIndex: 2, midi: 67, velocity: 100 }, // +7
      { stepIndex: 3, midi: 55, velocity: 100 }, // -5
    ];
    const out = applyMelodicPitches(4, notes, 60, [0, 0, 0, 0]);
    expect(out).toEqual([0, 0, 7, -5]);
  });

  it("Steps ohne Note behalten ihren aktuellen Pitch (Fallback 0)", () => {
    const out = applyMelodicPitches(4, [{ stepIndex: 1, midi: 62, velocity: 100 }], 60, [3, 99, 5]);
    expect(out).toEqual([3, 2, 5, 0]);
  });

  it("anderer rootMidi verschiebt die Offsets", () => {
    const out = applyMelodicPitches(2, [{ stepIndex: 0, midi: 60, velocity: 100 }], 48, []);
    expect(out[0]).toBe(12); // 60 - 48
  });

  it("stepCount 0/negativ/NaN → leeres Array", () => {
    expect(applyMelodicPitches(0, [{ stepIndex: 0, midi: 60, velocity: 100 }], 60, [])).toEqual([]);
    expect(applyMelodicPitches(-2, [], 60, [])).toEqual([]);
    expect(applyMelodicPitches(NaN, [], 60, [])).toEqual([]);
  });

  it("nicht-finite midi/rootMidi/currentPitch werden defensiv behandelt", () => {
    const out = applyMelodicPitches(
      3,
      [{ stepIndex: 0, midi: NaN, velocity: 100 }],
      Infinity, // → root 60
      [NaN, 4, Infinity],
    );
    // Step 0: midi NaN → keine Note gesetzt → currentPitch NaN → 0
    // Step 1: 4, Step 2: Infinity → 0
    expect(out).toEqual([0, 4, 0]);
  });

  it("Round-Trip: generateMelodicSequence → applyMelodicPitches nur auf aktive Steps", () => {
    const rhythm = [true, false, true, false];
    const notes = generateMelodicSequence({
      rhythmPattern: rhythm,
      scale: "minor-natural",
      rootMidi: 60,
      strategy: "ascending",
      octaveRange: 1,
      seed: 42,
    });
    const out = applyMelodicPitches(4, notes, 60, [9, 9, 9, 9]);
    // inaktive Steps (1,3) behalten 9; aktive (0,2) sind Offsets aus der Skala
    expect(out[1]).toBe(9);
    expect(out[3]).toBe(9);
    expect(out[0]).not.toBe(9);
    expect(out[2]).not.toBe(9);
  });
});
