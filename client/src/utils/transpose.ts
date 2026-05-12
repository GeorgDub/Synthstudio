/**
 * Synthstudio – Global Transpose Utility
 *
 * Reine Funktionen für die Anwendung eines globalen Transpose-Werts auf
 * MIDI-Noten. Wird vom Piano-Roll-Playback und der AudioEngine genutzt.
 *
 * Transpose-Range: ±24 Halbtöne (±2 Oktaven) – DAW-Standard.
 * MIDI-Noten werden auf 0–127 geclamped.
 */

export const TRANSPOSE_MIN = -24;
export const TRANSPOSE_MAX = 24;
export const MIDI_MIN = 0;
export const MIDI_MAX = 127;

/** Clampt einen Halbton-Wert auf [-24, +24]. */
export function clampSemitones(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.round(n);
  if (i < TRANSPOSE_MIN) return TRANSPOSE_MIN;
  if (i > TRANSPOSE_MAX) return TRANSPOSE_MAX;
  return i;
}

/**
 * Wendet einen Transpose-Offset auf eine MIDI-Note an.
 * Das Ergebnis wird auf den gültigen MIDI-Bereich (0–127) geclamped.
 */
export function transposeNote(note: number, semitones: number): number {
  const result = Math.round(note) + Math.round(semitones);
  if (result < MIDI_MIN) return MIDI_MIN;
  if (result > MIDI_MAX) return MIDI_MAX;
  return result;
}

/**
 * Erzeugt ein UI-Label für einen Transpose-Wert.
 *  0   → "0"
 *  +5  → "+5"
 *  -7  → "-7"
 *  +12 → "+12 (8va)"
 *  -12 → "-12 (8vb)"
 *  +24 → "+24 (15ma)"
 */
export function semitoneLabel(n: number): string {
  const v = clampSemitones(n);
  if (v === 0) return "0";
  const prefix = v > 0 ? "+" : "";
  if (v === 12)  return `${prefix}${v} (8va)`;
  if (v === -12) return `${v} (8vb)`;
  if (v === 24)  return `${prefix}${v} (15ma)`;
  if (v === -24) return `${v} (15mb)`;
  return `${prefix}${v}`;
}
