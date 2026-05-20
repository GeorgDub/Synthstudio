/**
 * Synthstudio – patternScaleQuantize.ts (v3.176.0)
 *
 * Pitch-zu-Scale-Quantize: Snappt MIDI-Note-Pitches auf eine Scale.
 * Verwendet z.B. von Pattern-Generator / OmniTribe-Note-Cleanup, um
 * "schiefe" Noten in eine zur Track-Tonart passende Scale zu zwingen.
 *
 * Public Surface:
 *  - quantizeNoteToScale   — Einzel-Note auf Scale snappen
 *  - quantizeNotesToScale  — Batch über ein Array (immutable)
 *  - isNoteInScale         — Predicate ohne Modifikation
 *  - generateScaleNotes    — alle MIDI 0..127 die in Scale liegen
 *
 * Pure & deterministisch. Keine Mutation der Eingabe.
 */

import { SCALE_INTERVALS, type ScaleType } from "@/utils/randomChordGenerator";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type SnapDirection = "nearest" | "up" | "down";

export interface QuantizeOptions {
  /** Scale-Root MIDI 0..11 (C=0, C#=1, ...). Default 0 (C). */
  scaleRoot?: number;
  /** Scale-Type. Default "major". */
  scale?: ScaleType;
  /** Wenn note bereits in scale: nichts ändern. Sonst: snap. Default "nearest". */
  snapDirection?: SnapDirection;
}

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function sanitizeScale(scale: ScaleType | undefined): ScaleType {
  if (scale && scale in SCALE_INTERVALS) return scale;
  return "major";
}

function sanitizeScaleRoot(root: number | undefined): number {
  if (root === undefined) return 0;
  if (!Number.isFinite(root)) return 0;
  const r = Math.floor(root);
  if (r < 0 || r > 11) return 0;
  return r;
}

function sanitizeSnapDirection(dir: SnapDirection | undefined): SnapDirection {
  if (dir === "nearest" || dir === "up" || dir === "down") return dir;
  return "nearest";
}

function clampMidi(n: number): number {
  if (n < 0) return 0;
  if (n > 127) return 127;
  return Math.floor(n);
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Berechnet die Pitch-Class einer MIDI-Note relativ zur Scale-Root.
 * Resultat in [0..11].
 */
function relPitchClass(note: number, scaleRoot: number): number {
  return ((Math.floor(note) - scaleRoot) % 12 + 12) % 12;
}

/**
 * Findet die nächste erlaubte Pitch-Class via Direction.
 * Liefert Delta (Halbtöne, signed) — 0 wenn note bereits passt.
 *
 * "nearest": gleiche Distanz nach oben/unten → prefer up.
 * "up":      nur positive Delta (1..11).
 * "down":    nur negative Delta (-1..-11).
 */
function findSnapDelta(
  relPc: number,
  allowed: ReadonlySet<number>,
  direction: SnapDirection,
): number {
  if (allowed.has(relPc)) return 0;

  if (direction === "up") {
    for (let d = 1; d <= 12; d++) {
      const pc = (relPc + d) % 12;
      if (allowed.has(pc)) return d;
    }
    return 0; // defensive: should never happen for valid scales
  }

  if (direction === "down") {
    for (let d = 1; d <= 12; d++) {
      const pc = (relPc - d + 12 * 12) % 12;
      if (allowed.has(pc)) return -d;
    }
    return 0;
  }

  // nearest — prefer up on tie
  for (let d = 1; d <= 6; d++) {
    const up = (relPc + d) % 12;
    if (allowed.has(up)) return d;
    const down = (relPc - d + 12) % 12;
    if (allowed.has(down)) return -d;
  }
  return 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Quantize eine MIDI-Note auf die nächste Scale-Note.
 *
 * - NaN / <0  → 0
 * - >127      → 127
 * - bereits in Scale → unverändert (unabhängig von snapDirection)
 * - sonst: snap gemäß Direction, dann clamp 0..127
 */
export function quantizeNoteToScale(
  note: number,
  options: QuantizeOptions = {},
): number {
  if (!Number.isFinite(note)) return 0;
  if (note < 0) return 0;
  if (note > 127) return 127;

  const scaleRoot = sanitizeScaleRoot(options.scaleRoot);
  const scale = sanitizeScale(options.scale);
  const direction = sanitizeSnapDirection(options.snapDirection);

  const allowed = new Set<number>(SCALE_INTERVALS[scale]);
  const intNote = Math.floor(note);
  const relPc = relPitchClass(intNote, scaleRoot);

  if (allowed.has(relPc)) return intNote;

  const delta = findSnapDelta(relPc, allowed, direction);
  return clampMidi(intNote + delta);
}

/**
 * Quantize ein Array von MIDI-Notes batch.
 * Liefert ein neues Array — Eingabe wird nicht mutiert.
 */
export function quantizeNotesToScale(
  notes: readonly number[],
  options: QuantizeOptions = {},
): number[] {
  if (!notes || notes.length === 0) return [];
  const out: number[] = new Array(notes.length);
  for (let i = 0; i < notes.length; i++) {
    out[i] = quantizeNoteToScale(notes[i], options);
  }
  return out;
}

/**
 * Prüft ob eine MIDI-Note bereits in der Scale liegt.
 * Note out-of-range / NaN → false.
 */
export function isNoteInScale(
  note: number,
  options: Pick<QuantizeOptions, "scaleRoot" | "scale"> = {},
): boolean {
  if (!Number.isFinite(note)) return false;
  if (note < 0 || note > 127) return false;
  const scaleRoot = sanitizeScaleRoot(options.scaleRoot);
  const scale = sanitizeScale(options.scale);
  const allowed = new Set<number>(SCALE_INTERVALS[scale]);
  return allowed.has(relPitchClass(Math.floor(note), scaleRoot));
}

/**
 * Generiert alle gültigen MIDI-Notes (0..127), die in der Scale liegen.
 * Ascending sortiert.
 */
export function generateScaleNotes(
  scaleRoot: number,
  scale: ScaleType,
): number[] {
  const root = sanitizeScaleRoot(scaleRoot);
  const s = sanitizeScale(scale);
  const allowed = new Set<number>(SCALE_INTERVALS[s]);
  const out: number[] = [];
  for (let n = 0; n <= 127; n++) {
    if (allowed.has(relPitchClass(n, root))) out.push(n);
  }
  return out;
}
