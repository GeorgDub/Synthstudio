/**
 * Synthstudio – Music Theory Scales
 *
 * Definiert gängige Skalen als Halbton-Offsets relativ zum Root.
 * Wird vom Piano Roll für Scale-Lock genutzt: nur Noten in der gewählten
 * Skala werden auf Click akzeptiert (Snap-on-Click).
 */

export type ScaleId =
  | "chromatic"
  | "major"
  | "minor"
  | "harmonic-minor"
  | "melodic-minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "pentatonic-major"
  | "pentatonic-minor"
  | "blues";

export interface ScaleDefinition {
  id: ScaleId;
  label: string;
  /** Halbton-Offsets vom Root (0 = Root). Sortiert aufsteigend. */
  intervals: readonly number[];
}

/** Skalen-Definitionen (Halbton-Offsets, aufsteigend, einschließlich Root=0). */
export const SCALES: readonly ScaleDefinition[] = [
  { id: "chromatic",        label: "Chromatic",        intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: "major",            label: "Major",            intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor",            label: "Minor",            intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonic-minor",   label: "Harmonic Minor",   intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodic-minor",    label: "Melodic Minor",    intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "dorian",           label: "Dorian",           intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian",         label: "Phrygian",         intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian",           label: "Lydian",           intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian",       label: "Mixolydian",       intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian",          label: "Locrian",          intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "pentatonic-major", label: "Pentatonic Major", intervals: [0, 2, 4, 7, 9] },
  { id: "pentatonic-minor", label: "Pentatonic Minor", intervals: [0, 3, 5, 7, 10] },
  { id: "blues",            label: "Blues",            intervals: [0, 3, 5, 6, 7, 10] },
];

const SCALE_INDEX: ReadonlyMap<ScaleId, ScaleDefinition> = new Map(
  SCALES.map((s) => [s.id, s])
);

/**
 * Set aller bekannten ScaleIds — verwendet von Persistenz-Migrationen
 * (z.B. `useMelodicPartStore._migratePattern`) um korrupte/veraltete
 * scaleId-Werte aus localStorage/Project-Files zu erkennen und auf
 * "chromatic" zu falsifizieren, statt später bei `getScale` zu crashen.
 * BUG-025 (v1.71): Quantize-Crash bei unbekannter scaleId-Persistenz.
 */
export const KNOWN_SCALE_IDS: ReadonlySet<ScaleId> = new Set(SCALES.map((s) => s.id));

/**
 * Type-Guard: prüft ob ein unbekannter String eine valide ScaleId ist.
 * Verwendung an Persistenz-Boundaries (Storage-Load, Project-Import).
 */
export function isKnownScaleId(s: unknown): s is ScaleId {
  return typeof s === "string" && KNOWN_SCALE_IDS.has(s as ScaleId);
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function getScale(id: ScaleId): ScaleDefinition {
  const scale = SCALE_INDEX.get(id);
  if (!scale) throw new Error(`Unknown scale id: ${id}`);
  return scale;
}

/** Pitch-Class einer MIDI-Note (0-11). */
export function pitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}

/** Prüft ob die MIDI-Note in der angegebenen Skala liegt. */
export function isInScale(note: number, root: number, scaleId: ScaleId): boolean {
  const scale = getScale(scaleId);
  const offset = ((pitchClass(note) - pitchClass(root)) + 12) % 12;
  return scale.intervals.includes(offset);
}

/**
 * Snappt eine MIDI-Note auf die nächstgelegene Note in der Skala.
 * Bei Gleichstand wird die höhere Note bevorzugt (Konvention DAW).
 * Chromatic gibt die Note unverändert zurück.
 */
export function snapToScale(note: number, root: number, scaleId: ScaleId): number {
  if (scaleId === "chromatic") return note;
  if (isInScale(note, root, scaleId)) return note;

  // Suche in beide Richtungen nach der nächsten Scale-Note (max. 6 Halbtöne)
  for (let delta = 1; delta <= 6; delta++) {
    const up = note + delta;
    if (isInScale(up, root, scaleId)) return up;
    const down = note - delta;
    if (isInScale(down, root, scaleId)) return down;
  }
  // Fallback (sollte nie passieren bei nicht-leerer Skala)
  return note;
}

/** Liefert alle Pitch-Classes (0-11) der Skala für eine bestimmte Root. */
export function scalePitchClasses(root: number, scaleId: ScaleId): readonly number[] {
  const scale = getScale(scaleId);
  const rootPc = pitchClass(root);
  return scale.intervals.map((iv) => (rootPc + iv) % 12);
}

/** Konvertiert einen Pitch-Class-Index (0-11) in einen Notennamen. */
export function pitchClassName(pc: number): string {
  return NOTE_NAMES[pitchClass(pc)];
}
