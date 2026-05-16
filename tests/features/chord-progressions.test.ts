/**
 * Synthstudio – chordProgressions Tests (v2.58)
 *
 * Pure-Function-Coverage für die bisher untestete utils/chordProgressions.ts:
 * 7 Modi, 7 Progression-Styles, 10 Chord-Qualities, Diatonic-Qualities-
 * Tabelle, generateProgression + progressionToSteps.
 */
import { describe, it, expect } from "vitest";
import {
  NOTE_NAMES_SHARP,
  NOTE_NAMES_FLAT,
  MODAL_INTERVALS,
  PROGRESSIONS,
  generateProgression,
  progressionToSteps,
  type Mode,
  type ProgressionStyle,
} from "../../client/src/utils/chordProgressions";

describe("Schema-Invarianten", () => {
  it("NOTE_NAMES_SHARP + FLAT haben je 12 Einträge", () => {
    expect(NOTE_NAMES_SHARP).toHaveLength(12);
    expect(NOTE_NAMES_FLAT).toHaveLength(12);
  });

  it("MODAL_INTERVALS hat 7 Modi mit je 7 Tönen (Heptatonisch)", () => {
    const modes: Mode[] = ["major","dorian","phrygian","lydian","mixolydian","minor","locrian"];
    expect(Object.keys(MODAL_INTERVALS)).toHaveLength(7);
    for (const m of modes) {
      expect(MODAL_INTERVALS[m]).toHaveLength(7);
      // Erste Stufe ist immer 0 (Grundton)
      expect(MODAL_INTERVALS[m][0]).toBe(0);
      // Werte aufsteigend
      for (let i = 1; i < 7; i++) {
        expect(MODAL_INTERVALS[m][i]).toBeGreaterThan(MODAL_INTERVALS[m][i - 1]);
      }
      // Letzte Stufe < 12 (innerhalb einer Oktave)
      expect(MODAL_INTERVALS[m][6]).toBeLessThan(12);
    }
  });

  it("Major-Modus: Standard Dur-Tonleiter [0,2,4,5,7,9,11]", () => {
    expect(MODAL_INTERVALS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it("Minor-Modus: natürliche Moll-Tonleiter [0,2,3,5,7,8,10]", () => {
    expect(MODAL_INTERVALS.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });

  it("PROGRESSIONS hat 7 Styles", () => {
    const styles: ProgressionStyle[] = [
      "I-IV-V-I","I-V-vi-IV","ii-V-I","I-vi-IV-V","vi-IV-I-V","I-IV-vi-V","random",
    ];
    for (const s of styles) {
      expect(PROGRESSIONS[s]).toBeDefined();
    }
  });

  it("Pop-Progression I-V-vi-IV: Stufen [0,4,5,3]", () => {
    expect(PROGRESSIONS["I-V-vi-IV"]).toEqual([0, 4, 5, 3]);
  });
});

describe("generateProgression — Defaults + Determinismus", () => {
  it("Defaults: key=C major, style=I-V-vi-IV, bpm=120, octave=4", () => {
    const p = generateProgression({});
    expect(p.key).toBe(0);
    expect(p.mode).toBe("major");
    expect(p.style).toBe("I-V-vi-IV");
    expect(p.bpm).toBe(120);
    expect(p.chords).toHaveLength(4);
    expect(p.keyName).toBe("C major");
  });

  it("C-Major I-V-vi-IV: erster Akkord ist C-major (root=0)", () => {
    const p = generateProgression({ key: 0, mode: "major", style: "I-V-vi-IV" });
    expect(p.chords[0].rootName).toBe("C");
    expect(p.chords[0].quality).toBe("maj");
    expect(p.chords[0].notes[0].midi).toBe(60); // C4
  });

  it("C-Major I-V-vi-IV: vi-Akkord ist a-minor (lowercase Roman = minor)", () => {
    const p = generateProgression({ key: 0, mode: "major", style: "I-V-vi-IV" });
    const vi = p.chords[2];
    expect(vi.rootName).toBe("Am");
    expect(vi.stepRoman).toBe("vi");
    expect(vi.quality).toBe("min");
  });

  it("C-Major I-V-vi-IV: V-Akkord ist G-dom7 (Major-V ist immer dom7)", () => {
    const p = generateProgression({ key: 0, mode: "major", style: "I-V-vi-IV" });
    const v = p.chords[1];
    expect(v.rootName).toBe("Gdom7");
    expect(v.quality).toBe("dom7");
  });

  it("Octave-Param verschiebt Base-MIDI um 12 pro Oktave", () => {
    const p1 = generateProgression({ key: 0, octave: 4 });
    const p2 = generateProgression({ key: 0, octave: 5 });
    expect(p2.chords[0].notes[0].midi - p1.chords[0].notes[0].midi).toBe(12);
  });

  it("addExtensions: maj → maj7", () => {
    const plain = generateProgression({ key: 0, mode: "major", style: "I-IV-V-I" });
    const ext   = generateProgression({ key: 0, mode: "major", style: "I-IV-V-I", addExtensions: true });
    // Akkord 0 ist I (maj) → wird zu maj7
    expect(plain.chords[0].quality).toBe("maj");
    expect(ext.chords[0].quality).toBe("maj7");
    // Akkord 1 ist IV (maj) → wird zu maj7
    expect(ext.chords[1].quality).toBe("maj7");
  });

  it("addExtensions: min → min7", () => {
    // dorian Stufe 0 ist minor
    const ext = generateProgression({ mode: "dorian", style: "I-IV-V-I", addExtensions: true });
    expect(ext.chords[0].quality).toBe("min7");
  });

  it("Transpose: D-Major I = D-major (root=2)", () => {
    const p = generateProgression({ key: 2, mode: "major", style: "I-IV-V-I" });
    expect(p.chords[0].rootName).toBe("D");
    expect(p.chords[0].notes[0].midi).toBe(62); // D4
  });

  it("Different Style: ii-V-I hat 3 chords (kürzer)", () => {
    const p = generateProgression({ style: "ii-V-I" });
    expect(p.chords).toHaveLength(3);
    expect(p.chords[0].stepRoman).toBe("ii");
  });
});

describe("generateProgression — random Style", () => {
  it("random Style erzeugt 4 Akkorde aus dem 7-Stufen-Pool", () => {
    const p = generateProgression({ style: "random" });
    expect(p.chords).toHaveLength(4);
    for (const c of p.chords) {
      expect(c.step).toBeGreaterThanOrEqual(0);
      expect(c.step).toBeLessThanOrEqual(6);
    }
  });
});

describe("generateProgression — Chord-Note-Math", () => {
  it("Maj-Akkord hat 3 Töne (Triade), Maj7-Akkord hat 4 Töne", () => {
    const plain = generateProgression({ style: "I-IV-V-I" });
    const ext   = generateProgression({ style: "I-IV-V-I", addExtensions: true });
    expect(plain.chords[0].notes).toHaveLength(3); // maj
    expect(ext.chords[0].notes).toHaveLength(4);   // maj7
  });

  it("C-Major Triade: Noten C-E-G (MIDI 60-64-67)", () => {
    const p = generateProgression({ key: 0, mode: "major", style: "I-IV-V-I" });
    const cMajor = p.chords[0];
    expect(cMajor.notes.map(n => n.midi)).toEqual([60, 64, 67]);
  });

  it("Chord-Note-Names enthalten Oktav-Suffix (z.B. C4)", () => {
    const p = generateProgression({ key: 0, octave: 4 });
    expect(p.chords[0].notes[0].name).toMatch(/^[A-G]#?\d$/);
  });
});

describe("progressionToSteps", () => {
  it("Default 16-Step-Pattern: 4 Akkorde × 4 Steps", () => {
    const prog = generateProgression({});
    const steps = progressionToSteps(prog);
    expect(steps).toHaveLength(16);
    // Steps 0, 4, 8, 12 sollten active sein (Akkord-Start)
    expect(steps[0].some(s => s.active)).toBe(true);
    expect(steps[4].some(s => s.active)).toBe(true);
    // Step 1 sollte inactive sein
    expect(steps[1][0].active).toBe(false);
  });

  it("Custom stepCount=8: 4 Akkorde × 2 Steps", () => {
    const prog = generateProgression({});
    const steps = progressionToSteps(prog, 8);
    expect(steps).toHaveLength(8);
    expect(steps[0].some(s => s.active)).toBe(true);
    expect(steps[2].some(s => s.active)).toBe(true);
  });

  it("Erste Note in Chord-Start-Step hat velocity=90 (lead)", () => {
    const prog = generateProgression({});
    const steps = progressionToSteps(prog);
    expect(steps[0][0].velocity).toBe(90);
    // Folge-Noten (Akkord-Voicings) haben velocity=80
    expect(steps[0][1].velocity).toBe(80);
  });

  it("Inactive Steps haben Default-Empty-Note (note=60, active=false)", () => {
    const prog = generateProgression({});
    const steps = progressionToSteps(prog);
    expect(steps[1][0].active).toBe(false);
    expect(steps[1][0].note).toBe(60);
  });

  it("Progression mit nur 3 Akkorden + 16 Steps: 5 Steps/Akkord (Math.floor)", () => {
    const prog = generateProgression({ style: "ii-V-I" });
    const steps = progressionToSteps(prog, 16);
    expect(steps).toHaveLength(16);
    expect(steps[0].some(s => s.active)).toBe(true);
    expect(steps[5].some(s => s.active)).toBe(true);  // 2. Akkord
    expect(steps[10].some(s => s.active)).toBe(true); // 3. Akkord
  });
});

describe("Mode-spezifische Akkord-Qualitäten", () => {
  it("Dorian-Stufe 0 (i): min-Akkord", () => {
    const p = generateProgression({ mode: "dorian", style: "I-IV-V-I" });
    expect(p.chords[0].quality).toBe("min");
  });

  it("Phrygian-Stufe 1 (II): maj-Akkord (charakteristischer Phrygian-Sound)", () => {
    const p = generateProgression({ mode: "phrygian", style: "ii-V-I" });
    expect(p.chords[0].quality).toBe("maj"); // ii in phrygian ist actually II major
  });

  it("Locrian-Stufe 0 (i): dim (b5-Modal)", () => {
    const p = generateProgression({ mode: "locrian", style: "I-IV-V-I" });
    expect(p.chords[0].quality).toBe("dim");
  });
});
