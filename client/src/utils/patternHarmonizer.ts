/**
 * Synthstudio – patternHarmonizer.ts (v3.193.0)
 *
 * Pattern-Harmonizer: pure Helpers, die fuer eine gegebene Melodic-Note
 * harmonisch sinnvolle Begleit-Notes (3rd, 5th, octave-up/down, 10th, 12th)
 * generieren. Scale-aware via SCALE_INTERVALS aus randomChordGenerator.
 *
 * Foundation fuer kuenftige Performance-Mode "Harmonize Selection"-Actions,
 * Auto-Doubling im Piano-Roll und OmniTribe-Chord-Slot-Filler.
 *
 * Public Surface:
 *  - harmonizeNote: Einzelne Note + Options -> HarmonizedNote
 *  - harmonizeNotes: Array von Notes -> HarmonizedNote[]
 *  - HARMONY_INTERVAL_SEMITONES: chromatische Semitone-Approximation
 *    (UI/debug-friendly Konstanten)
 *
 * Verhalten:
 *  - "third"       : scale-degree+2 (scale-aware)
 *  - "fifth"       : scale-degree+4 (scale-aware)
 *  - "octave-up"   : +12
 *  - "octave-down" : -12
 *  - "tenth"       : +12 plus scale-aware 3rd (Oktav + scale-3rd)
 *  - "twelfth"     : +19 (Oktav + perfect-5th, fix-chromatisch)
 *
 * Alle Outputs werden auf 0..127 geclampt. Defensive Defaults:
 *  - rootMidi NaN/<0/>127 -> 60
 *  - scale invalid        -> "major"
 *  - scaleRoot invalid    -> 0
 *  - intervals leer/inval -> ["third","fifth"]
 *
 * Eingaben werden nicht mutiert.
 */

import { SCALE_INTERVALS, type ScaleType } from "@/utils/randomChordGenerator";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type HarmonyInterval =
  | "third"
  | "fifth"
  | "octave-up"
  | "octave-down"
  | "tenth"
  | "twelfth";

export interface HarmonizeOptions {
  scale?: ScaleType;
  /** Pitch-class 0..11. Default 0 (C). */
  scaleRoot?: number;
  intervals?: readonly HarmonyInterval[];
}

export interface HarmonizedNote {
  /** Original-Note. */
  rootMidi: number;
  /** Generierte Harmonie-Notes (sorted ascending). */
  harmonies: { midi: number; interval: HarmonyInterval }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const HARMONY_INTERVAL_SEMITONES: Record<HarmonyInterval, number> = {
  third:         4,
  fifth:         7,
  "octave-up":   12,
  "octave-down": -12,
  tenth:         16,
  twelfth:       19,
};

const VALID_INTERVALS: ReadonlySet<HarmonyInterval> = new Set<HarmonyInterval>([
  "third",
  "fifth",
  "octave-up",
  "octave-down",
  "tenth",
  "twelfth",
]);

const DEFAULT_INTERVALS: readonly HarmonyInterval[] = ["third", "fifth"];

// ─── Sanitizers ───────────────────────────────────────────────────────────────

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

function sanitizeScaleRoot(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) return 0;
  const n = Math.floor(value);
  if (n < 0 || n > 11) return 0;
  return n;
}

function sanitizeIntervals(
  intervals: readonly HarmonyInterval[] | undefined,
): readonly HarmonyInterval[] {
  if (!intervals || !Array.isArray(intervals) || intervals.length === 0) {
    return DEFAULT_INTERVALS;
  }
  const filtered = intervals.filter((iv) => VALID_INTERVALS.has(iv));
  if (filtered.length === 0) return DEFAULT_INTERVALS;
  return filtered;
}

function clampMidi(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 127) return 127;
  return Math.floor(n);
}

// ─── Scale-Degree-Logik ───────────────────────────────────────────────────────

/**
 * Liefert (degreeIndex, octaveShift) so, dass das Pitch-Class-Offset
 * (rootMidi - scaleRoot)%12 als Scale-Degree dargestellt wird.
 *
 * Faellt rootMidi nicht exakt auf einen Scale-Ton, wird der naechsttiefere
 * Scale-Ton verwendet (round-down). So bleibt 3rd/5th-Berechnung deterministisch.
 *
 * Beispiel: rootMidi=60 (C4), scaleRoot=0 (C), scale=major:
 *   offset = 0 -> degreeIndex 0
 * Beispiel: rootMidi=61 (C#4), scaleRoot=0, scale=major:
 *   offset = 1 -> kein direkter Treffer -> degreeIndex 0 (C), nicht D
 */
function findScaleDegree(
  rootMidi: number,
  scaleRoot: number,
  scaleIntervals: readonly number[],
): { degreeIndex: number; baseMidi: number } {
  const pitchClass = ((rootMidi - scaleRoot) % 12 + 12) % 12;

  // Exact match?
  for (let i = 0; i < scaleIntervals.length; i++) {
    if (scaleIntervals[i] === pitchClass) {
      // baseMidi entspricht dem Ton, der dem rootMidi-pitchClass zugeordnet ist
      return { degreeIndex: i, baseMidi: rootMidi };
    }
  }

  // Round-down: finde groesstes Interval <= pitchClass
  let bestIndex = 0;
  for (let i = scaleIntervals.length - 1; i >= 0; i--) {
    if (scaleIntervals[i] <= pitchClass) {
      bestIndex = i;
      break;
    }
  }
  // Differenz Semitones zur naechsten Scale-Note nach unten
  const diff = pitchClass - scaleIntervals[bestIndex];
  return { degreeIndex: bestIndex, baseMidi: rootMidi - diff };
}

/**
 * Berechnet das Scale-Aware-Interval von einer Base-Note um +deg Scale-Degrees
 * (positiv) und liefert die resultierende MIDI-Note.
 */
function shiftByScaleDegree(
  baseMidi: number,
  degreeIndex: number,
  degreesAdded: number,
  scaleIntervals: readonly number[],
): number {
  const scaleLen = scaleIntervals.length;
  const targetDegree = degreeIndex + degreesAdded;
  const wrapped = ((targetDegree % scaleLen) + scaleLen) % scaleLen;
  const octaveShift = Math.floor(targetDegree / scaleLen);
  const baseInterval = scaleIntervals[degreeIndex];
  const targetInterval = scaleIntervals[wrapped];
  // Differenz in Semitones (innerhalb der Oktav-Wraps)
  const semitoneDiff = targetInterval - baseInterval + octaveShift * 12;
  return baseMidi + semitoneDiff;
}

// ─── Hauptfunktionen ──────────────────────────────────────────────────────────

/**
 * Generiert harmonische Begleit-Notes fuer eine Root-Note.
 * Scale-aware fuer 3rd/5th/10th; fix-chromatisch fuer octaves/12th.
 */
export function harmonizeNote(
  rootMidi: number,
  options: HarmonizeOptions = {},
): HarmonizedNote {
  const sanitizedRoot = sanitizeRoot(rootMidi);
  const scale = sanitizeScale(options.scale);
  const scaleRoot = sanitizeScaleRoot(options.scaleRoot);
  const intervals = sanitizeIntervals(options.intervals);

  const scaleIntervals = SCALE_INTERVALS[scale];
  const { degreeIndex, baseMidi } = findScaleDegree(
    sanitizedRoot,
    scaleRoot,
    scaleIntervals,
  );

  const harmonies: { midi: number; interval: HarmonyInterval }[] = [];

  for (const interval of intervals) {
    let midi: number;
    switch (interval) {
      case "third":
        midi = shiftByScaleDegree(baseMidi, degreeIndex, 2, scaleIntervals);
        break;
      case "fifth":
        midi = shiftByScaleDegree(baseMidi, degreeIndex, 4, scaleIntervals);
        break;
      case "octave-up":
        midi = sanitizedRoot + 12;
        break;
      case "octave-down":
        midi = sanitizedRoot - 12;
        break;
      case "tenth":
        // Oktav + scale-aware-3rd
        midi = shiftByScaleDegree(baseMidi, degreeIndex, 2, scaleIntervals) + 12;
        break;
      case "twelfth":
        midi = sanitizedRoot + 19;
        break;
    }
    harmonies.push({ midi: clampMidi(midi), interval });
  }

  harmonies.sort((a, b) => a.midi - b.midi);

  return { rootMidi: sanitizedRoot, harmonies };
}

/**
 * Batch-Variante: harmonisiert ein Array von Root-Notes mit identischen Options.
 */
export function harmonizeNotes(
  rootNotes: readonly number[],
  options: HarmonizeOptions = {},
): HarmonizedNote[] {
  if (!Array.isArray(rootNotes) || rootNotes.length === 0) return [];
  return rootNotes.map((midi) => harmonizeNote(midi, options));
}
