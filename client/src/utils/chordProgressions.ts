/**
 * Synthstudio – chordProgressions.ts
 *
 * Akkordfolgen-Generator mit Musik-Theorie-Grundlagen.
 * Generiert diatonische Progressionen in beliebigen Tonarten und Modi.
 *
 * Features:
 *  - 7 Kirchentonarten (Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian)
 *  - Klassische Progressionen (I-IV-V, I-V-vi-IV, ii-V-I, etc.)
 *  - Akkorderweiterungen (maj7, min7, dom7, sus4, add9)
 *  - MIDI-Noten-Output für Piano Roll Integration
 */

export const NOTE_NAMES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
export const NOTE_NAMES_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

export type Mode = "major" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "minor" | "locrian";
export type ChordQuality = "maj" | "min" | "dim" | "aug" | "maj7" | "min7" | "dom7" | "sus4" | "sus2" | "add9";
export type ProgressionStyle = "I-IV-V-I" | "I-V-vi-IV" | "ii-V-I" | "I-vi-IV-V" | "vi-IV-I-V" | "I-IV-vi-V" | "random";

// Intervall-Semitöne für Kirchentonarten (7 Stufen)
export const MODAL_INTERVALS: Record<Mode, number[]> = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  locrian:    [0, 1, 3, 5, 6, 8, 10],
};

// Akkord-Qualität pro Stufe (0-indexed) in der Durtonleiter
const DIATONIC_QUALITIES: Record<Mode, ChordQuality[]> = {
  major:      ["maj","min","min","maj","dom7","min","dim"],
  dorian:     ["min","min","maj","dom7","min","dim","maj"],
  phrygian:   ["min","maj","dom7","min","dim","maj","min"],
  lydian:     ["maj","dom7","min","dim","maj","min","min"],
  mixolydian: ["dom7","min","dim","maj","min","min","maj"],
  minor:      ["min","dim","maj","min","min","maj","dom7"],
  locrian:    ["dim","maj","min","min","maj","dom7","min"],
};

// Klassische Progressionsmuster (Stufen-Indizes 0–6)
export const PROGRESSIONS: Record<ProgressionStyle, number[]> = {
  "I-IV-V-I":   [0, 3, 4, 0],
  "I-V-vi-IV":  [0, 4, 5, 3],
  "ii-V-I":     [1, 4, 0],
  "I-vi-IV-V":  [0, 5, 3, 4],
  "vi-IV-I-V":  [5, 3, 0, 4],
  "I-IV-vi-V":  [0, 3, 5, 4],
  "random":     [0],  // wird zur Laufzeit zufällig generiert
};

export interface ChordNote {
  midi: number;      // MIDI-Notennummer
  name: string;      // z.B. "C4"
  octave: number;
}

export interface Chord {
  root: number;         // Semitöne von C (0=C, 1=C#, ...)
  rootName: string;     // z.B. "Am7"
  quality: ChordQuality;
  notes: ChordNote[];   // MIDI-Noten des Akkords
  step: number;         // Stufenindex 0–6
  stepRoman: string;    // z.B. "ii", "V", "I"
}

export interface ChordProgression {
  key: number;          // Grundton in Semitönen (0=C)
  keyName: string;
  mode: Mode;
  style: ProgressionStyle;
  chords: Chord[];
  bpm: number;
}

// MIDI-Noten-Intervalle pro Akkord-Qualität
const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  maj:  [0, 4, 7],
  min:  [0, 3, 7],
  dim:  [0, 3, 6],
  aug:  [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  add9: [0, 4, 7, 14],
};

const ROMAN_NUMERALS = ["I","II","III","IV","V","VI","VII"];

function midiToName(midi: number): string {
  const note = NOTE_NAMES_SHARP[midi % 12];
  const oct  = Math.floor(midi / 12) - 1;
  return `${note}${oct}`;
}

function buildChord(root: number, quality: ChordQuality, step: number, mode: Mode, baseOctave = 4): Chord {
  const intervals = CHORD_INTERVALS[quality];
  const baseMidi  = 60 + (baseOctave - 4) * 12 + root;
  const notes: ChordNote[] = intervals.map(i => ({
    midi: baseMidi + i,
    name: midiToName(baseMidi + i),
    octave: Math.floor((baseMidi + i) / 12) - 1,
  }));

  const rootName = NOTE_NAMES_SHARP[root % 12];
  const qual = quality === "maj" ? "" : quality === "min" ? "m" : quality;
  const roman = ROMAN_NUMERALS[step];
  const stepRoman = ["min","dim"].includes(quality) ? roman.toLowerCase() : roman;

  return { root, rootName: `${rootName}${qual}`, quality, notes, step, stepRoman };
}

/** Generiert eine Akkordfolge. */
export function generateProgression(opts: {
  key?: number;
  mode?: Mode;
  style?: ProgressionStyle;
  octave?: number;
  bpm?: number;
  addExtensions?: boolean;
}): ChordProgression {
  const key    = opts.key    ?? 0;
  const mode   = opts.mode   ?? "major";
  const style  = opts.style  ?? "I-V-vi-IV";
  const octave = opts.octave ?? 4;
  const bpm    = opts.bpm    ?? 120;

  const scale    = MODAL_INTERVALS[mode];
  const qualities = DIATONIC_QUALITIES[mode];
  const pattern  = style === "random"
    ? Array.from({ length: 4 }, () => Math.floor(Math.random() * 7))
    : PROGRESSIONS[style];

  const chords: Chord[] = pattern.map(stepIdx => {
    const semitone  = (key + scale[stepIdx]) % 12;
    let quality: ChordQuality = qualities[stepIdx];
    if (opts.addExtensions && quality === "dom7") quality = "dom7";
    if (opts.addExtensions && quality === "maj")  quality = "maj7";
    if (opts.addExtensions && quality === "min")  quality = "min7";
    return buildChord(semitone, quality, stepIdx, mode, octave);
  });

  const keyName = NOTE_NAMES_SHARP[key % 12];
  return { key, keyName: `${keyName} ${mode}`, mode, style, chords, bpm };
}

/** Konvertiert eine Progression in Piano-Roll-Noten (Steps 0–15). */
export function progressionToSteps(
  prog: ChordProgression,
  stepCount = 16,
): Array<Array<{ note: number; velocity: number; active: boolean }>> {
  const stepsPerChord = Math.floor(stepCount / prog.chords.length);
  const result: Array<Array<{ note: number; velocity: number; active: boolean }>> = [];

  // Leere Steps initialisieren
  const empty = { note: 60, velocity: 100, active: false };
  for (let i = 0; i < stepCount; i++) result.push([{ ...empty }]);

  prog.chords.forEach((chord, ci) => {
    const startStep = ci * stepsPerChord;
    chord.notes.forEach((note, ni) => {
      const step = startStep; // Alle Noten gleichzeitig auf demselben Step
      if (!result[step]) return;
      if (ni === 0) {
        result[step] = [{ note: note.midi, velocity: 90, active: true }];
      } else {
        result[step].push({ note: note.midi, velocity: 80, active: true });
      }
    });
  });

  return result;
}
