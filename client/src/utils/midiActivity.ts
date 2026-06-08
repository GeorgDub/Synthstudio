/**
 * midiActivity.ts — pure Formatierung eingehender MIDI-Messages für die
 * Live-Aktivitätsanzeige (#11-Begleitung).
 *
 * Quelle: das `midi:rawmessage`-CustomEvent (useMidi.ts:1063) feuert pro
 * eingehender 3-Byte-Channel-Message mit `{type, channel, byte1, byte2}` —
 * für BEIDE Backends (Web-MIDI + nativer Shim routen durch denselben
 * handleMidiMessage). Clock/Realtime feuern es NICHT (kein Flackern durch
 * 24-PPQN-Clock).
 */

export type MidiActivityKind =
  | "noteOn" | "noteOff" | "cc" | "pitchbend"
  | "aftertouch" | "program" | "other";

export interface MidiActivityInfo {
  kind: MidiActivityKind;
  /** UI-Label, z.B. "Note On · Ch1 · C4 (60) v100". */
  label: string;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI-Notennummer → Name mit Oktave (60 = C4, Standard-Konvention). */
export function midiNoteName(note: number): string {
  if (!Number.isFinite(note) || note < 0 || note > 127) return String(note);
  const name = NOTE_NAMES[note % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

/**
 * Verdichtet eine rohe MIDI-Message zu einer menschenlesbaren Aktivitäts-Zeile.
 *
 * @param type    Status-Nibble (0x80,0x90,0xA0,0xB0,0xC0,0xD0,0xE0).
 * @param channel 1..16.
 * @param byte1   Daten-Byte 1 (Note/CC-Nr/Program).
 * @param byte2   Daten-Byte 2 (Velocity/CC-Wert).
 */
export function formatMidiActivity(
  type: number,
  channel: number,
  byte1: number,
  byte2: number,
): MidiActivityInfo {
  const ch = `Ch${channel}`;
  switch (type & 0xf0) {
    case 0x90:
      return byte2 > 0
        ? { kind: "noteOn", label: `Note On · ${ch} · ${midiNoteName(byte1)} (${byte1}) v${byte2}` }
        : { kind: "noteOff", label: `Note Off · ${ch} · ${midiNoteName(byte1)} (${byte1})` };
    case 0x80:
      return { kind: "noteOff", label: `Note Off · ${ch} · ${midiNoteName(byte1)} (${byte1})` };
    case 0xb0:
      return { kind: "cc", label: `CC · ${ch} · #${byte1} = ${byte2}` };
    case 0xe0:
      return { kind: "pitchbend", label: `Pitch Bend · ${ch} · ${(byte1 | (byte2 << 7))}` };
    case 0xa0:
      return { kind: "aftertouch", label: `Poly AT · ${ch} · ${midiNoteName(byte1)} ${byte2}` };
    case 0xd0:
      return { kind: "aftertouch", label: `Channel AT · ${ch} · ${byte1}` };
    case 0xc0:
      return { kind: "program", label: `Program · ${ch} · ${byte1}` };
    default:
      return { kind: "other", label: `MIDI · ${ch} · ${byte1} ${byte2}` };
  }
}
