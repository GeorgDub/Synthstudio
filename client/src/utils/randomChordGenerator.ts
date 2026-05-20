/**
 * Synthstudio – randomChordGenerator.ts (v3.175.0)
 *
 * Random-Chord-Generator: pure Helpers, die musikalisch sinnvolle
 * Chord-Voicings basierend auf Scale + Mood zufaellig generieren.
 * Foundation fuer kuenftige Performance-Mode-Action "Random Chord"
 * oder OmniTribe-Chord-Slot-Filler.
 *
 * Public Surface:
 *  - generateRandomChords: Hauptfunktion, liefert GeneratedChord[]
 *  - midiNoteToName: MIDI -> "C4"-Style Note-Name
 *  - CHORD_INTERVALS: Halftone-Pattern pro Chord-Quality
 *  - SCALE_INTERVALS: Halftone-Pattern pro Scale-Type
 *  - MOOD_PRESETS: Mood -> Scale + erlaubte Qualities
 *
 * Determinismus via mulberry32 (inline, kein Cross-Util-Import um
 * zirkuläre Imports zu vermeiden). Nichts mutiert die Eingabe.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "sus2"
  | "sus4"
  | "7"
  | "maj7"
  | "m7"
  | "9";

export type ScaleType =
  | "major"
  | "minor-natural"
  | "minor-harmonic"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian";

export type MoodPreset = "happy" | "sad" | "tense" | "dreamy" | "dark";

export interface RandomChordOptions {
  /** Root-Note MIDI 0..127. Default 60 (Middle-C). */
  rootMidi?: number;
  /** Scale-Type. Default "major". */
  scale?: ScaleType;
  /** PRNG-Seed. Default 1. */
  seed?: number;
  /** Anzahl Voicings zu generieren. Default 4. */
  count?: number;
  /** Mood-Preset ueberschreibt scale wenn gesetzt. */
  mood?: MoodPreset;
}

export interface GeneratedChord {
  /** MIDI-Notes des Chord (sortiert ascending). */
  notes: number[];
  /** Root-Note des Chord. */
  rootNote: number;
  /** Quality (z.B. "minor", "7"). */
  quality: ChordQuality;
  /** Human-readable name (z.B. "Cm7"). */
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const CHORD_INTERVALS: Record<ChordQuality, readonly number[]> = {
  major:      [0, 4, 7],
  minor:      [0, 3, 7],
  diminished: [0, 3, 6],
  augmented:  [0, 4, 8],
  sus2:       [0, 2, 7],
  sus4:       [0, 5, 7],
  "7":        [0, 4, 7, 10],
  maj7:       [0, 4, 7, 11],
  m7:         [0, 3, 7, 10],
  "9":        [0, 4, 7, 10, 14],
};

export const SCALE_INTERVALS: Record<ScaleType, readonly number[]> = {
  major:            [0, 2, 4, 5, 7, 9, 11],
  "minor-natural":  [0, 2, 3, 5, 7, 8, 10],
  "minor-harmonic": [0, 2, 3, 5, 7, 8, 11],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
};

export const MOOD_PRESETS: Record<MoodPreset, { scale: ScaleType; qualities: readonly ChordQuality[] }> = {
  happy:  { scale: "major",          qualities: ["major", "maj7", "sus2", "9"] },
  sad:    { scale: "minor-natural",  qualities: ["minor", "m7", "sus4"] },
  tense:  { scale: "phrygian",       qualities: ["diminished", "augmented", "7"] },
  dreamy: { scale: "lydian",         qualities: ["maj7", "sus2", "9"] },
  dark:   { scale: "minor-harmonic", qualities: ["minor", "diminished", "m7"] },
};

const ALL_QUALITIES: readonly ChordQuality[] = [
  "major",
  "minor",
  "diminished",
  "augmented",
  "sus2",
  "sus4",
  "7",
  "maj7",
  "m7",
  "9",
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  major:      "",
  minor:      "m",
  diminished: "dim",
  augmented:  "aug",
  sus2:       "sus2",
  sus4:       "sus4",
  "7":        "7",
  maj7:       "maj7",
  m7:         "m7",
  "9":        "9",
};

const MAX_COUNT = 64;

// ─── PRNG: mulberry32 (inline) ────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = Number.isFinite(seed) ? Math.floor(seed) | 0 : 1;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeRoot(midi: number | undefined): number {
  if (midi === undefined) return 60;
  if (!Number.isFinite(midi)) return 60;
  if (midi < 0 || midi > 127) return 60;
  return Math.floor(midi);
}

function sanitizeScale(scale: ScaleType | undefined): ScaleType {
  if (scale && scale in SCALE_INTERVALS) return scale;
  return "major";
}

function sanitizeCount(count: number | undefined): number {
  if (count === undefined) return 4;
  if (!Number.isFinite(count)) return 4;
  const n = Math.floor(count);
  if (n <= 0) return 0;
  if (n > MAX_COUNT) return MAX_COUNT;
  return n;
}

function sanitizeMood(mood: MoodPreset | undefined): MoodPreset | undefined {
  if (mood === undefined) return undefined;
  if (mood in MOOD_PRESETS) return mood;
  return undefined;
}

function clampMidi(n: number): number {
  if (n < 0) return 0;
  if (n > 127) return 127;
  return Math.floor(n);
}

/**
 * Liefert den Note-Namen (z.B. "C4", "F#3") für eine MIDI-Note.
 * MIDI 60 -> "C4", MIDI 0 -> "C-1".
 */
export function midiNoteToName(midi: number): string {
  if (!Number.isFinite(midi)) return "C4";
  const m = clampMidi(midi);
  const octave = Math.floor(m / 12) - 1;
  const name = NOTE_NAMES[m % 12];
  return `${name}${octave}`;
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

/**
 * Generiert deterministisch (per Seed) eine Liste zufaelliger Chord-Voicings.
 * Mood ueberschreibt scale + filtert Qualities, andernfalls werden alle
 * Qualities erlaubt.
 */
export function generateRandomChords(options: RandomChordOptions = {}): GeneratedChord[] {
  const rootMidi = sanitizeRoot(options.rootMidi);
  const mood = sanitizeMood(options.mood);
  const scale: ScaleType = mood
    ? MOOD_PRESETS[mood].scale
    : sanitizeScale(options.scale);
  const seed = Number.isFinite(options.seed) ? (options.seed as number) : 1;
  const count = sanitizeCount(options.count);

  if (count === 0) return [];

  const scaleIntervals = SCALE_INTERVALS[scale];
  const qualities: readonly ChordQuality[] = mood
    ? MOOD_PRESETS[mood].qualities
    : ALL_QUALITIES;

  const rng = makeRng(seed);
  const out: GeneratedChord[] = [];

  for (let i = 0; i < count; i++) {
    const degreeRoll = rng();
    const qualityRoll = rng();

    const degree = Math.floor(degreeRoll * scaleIntervals.length) % scaleIntervals.length;
    const quality = qualities[Math.floor(qualityRoll * qualities.length) % qualities.length];

    const chordRoot = clampMidi(rootMidi + scaleIntervals[degree]);
    const intervals = CHORD_INTERVALS[quality];

    const notes = intervals
      .map((iv) => clampMidi(chordRoot + iv))
      .slice()
      .sort((a, b) => a - b);

    const rootName = midiNoteToName(chordRoot);
    // strip octave-suffix? — Keep octave in name; e.g. "C4m7"
    // Spec example "Cm7" suggests no octave. Use only note-letter portion.
    const noteLetter = NOTE_NAMES[chordRoot % 12];
    const name = `${noteLetter}${QUALITY_SUFFIX[quality]}`;

    // rootName-Variable used for symmetric mental model; not exposed
    void rootName;

    out.push({
      notes,
      rootNote: chordRoot,
      quality,
      name,
    });
  }

  return out;
}
