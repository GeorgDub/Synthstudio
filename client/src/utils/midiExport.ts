/**
 * Synthstudio – midiExport.ts
 *
 * Exportiert alle DrumMachine-Patterns als Standard MIDI Format 1 (.mid).
 * Jedes Pattern wird als separate Track-Spur exportiert.
 * Jeder Part eines Patterns wird als eigener MIDI-Kanal kodiert.
 *
 * MIDI-Format 1:
 *  - Header-Chunk: Format 1, N Tracks, TPQN Resolution
 *  - Track 0: Tempo-Map
 *  - Track 1..N: Drum-Parts (je ein MIDI-Kanal)
 *
 * GM Drum Map (Kanal 10):
 *  Kick=36, Snare=38, HiHat=42, OpenHat=46, Clap=39, Tom=41, etc.
 */

import type { PatternData } from "@/audio/AudioEngine";

const TPQN = 480; // Ticks per Quarter Note

// ─── MIDI-Schreib-Utilities ───────────────────────────────────────────────────

function writeUint32BE(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value);
  return offset + 4;
}

function writeUint16BE(view: DataView, offset: number, value: number): number {
  view.setUint16(offset, value);
  return offset + 2;
}

function writeUint8(view: DataView, offset: number, value: number): number {
  view.setUint8(offset, value);
  return offset + 1;
}

/**
 * v2.59: exportiert für Unit-Tests. MIDI Variable-Length-Quantity-Encoding
 * (1–4 Bytes, MSB=1 markiert Continuation, letztes Byte hat MSB=0).
 * Werte bis 0x0FFFFFFF (268,435,455) sind valide.
 */
export function writeVarLen(arr: number[], value: number): void {
  if (value < 0x80) { arr.push(value); return; }
  if (value < 0x4000) { arr.push((value >> 7) | 0x80, value & 0x7f); return; }
  if (value < 0x200000) { arr.push((value >> 14) | 0x80, ((value >> 7) & 0x7f) | 0x80, value & 0x7f); return; }
  arr.push((value >> 21) | 0x80, ((value >> 14) & 0x7f) | 0x80, ((value >> 7) & 0x7f) | 0x80, value & 0x7f);
}

/** v2.59: exportiert für Test-Validation. Lookup-Map drum-name → GM-MIDI. */
export const GM_DRUM_NOTES: Record<string, number> = {
  kick: 36, bass: 36, bd: 36,
  snare: 38, sn: 38, clap: 39,
  "hi-hat": 42, hihat: 42, hat: 42, hh: 42,
  "open-hat": 46, openhat: 46, oh: 46,
  "tom-hi": 48, tom: 47, tomhi: 48,
  "tom-lo": 45, tomlo: 45,
  perc: 75, fx: 56,
};

/**
 * v2.59: Match-Reihenfolge specific→generic. Ohne explizite Reihenfolge
 * würde „Open Hat" als „hat" (closed) gematched bevor „open-hat" geprüft
 * wird — Bug aus Pre-v2.59. Längere Keys haben semantisch mehr Information
 * und müssen zuerst probiert werden.
 */
const GM_DRUM_KEYS_BY_SPECIFICITY: string[] = Object.keys(GM_DRUM_NOTES)
  .sort((a, b) => b.length - a.length);

/**
 * v2.59: exportiert für Tests. Heuristik die einen Part-Namen auf eine
 * GM-Drum-Map-Note mappt; Fallback ist Index-basierter Offset ab MIDI 36.
 *
 * Match-Order: specific→generic (siehe GM_DRUM_KEYS_BY_SPECIFICITY).
 * Bsp.: „Open Hat" matched zuerst „open-hat"-äquivalent („openhat" via
 * Leerzeichen-Strip), nicht „hat".
 */
export function guessNote(partName: string, partIndex: number): number {
  // v2.59 Bug-Fix: Leerzeichen/Bindestriche zu kanonischer Form normalisieren
  // damit „Open Hat" und „open-hat" und „openhat" alle gleich matchen.
  const normalized = partName.toLowerCase();
  const stripped = normalized.replace(/[\s_-]+/g, "");
  for (const key of GM_DRUM_KEYS_BY_SPECIFICITY) {
    if (normalized.includes(key)) return GM_DRUM_NOTES[key];
    // Stripped-Variante: matcht Mehrfach-Form ohne Trennzeichen (z.B. „Open Hat" → „openhat")
    const strippedKey = key.replace(/[\s_-]+/g, "");
    if (strippedKey !== key && stripped.includes(strippedKey)) return GM_DRUM_NOTES[key];
  }
  // Fallback: GM Drum Map Offset
  return 36 + (partIndex % 32);
}

// ─── Track-Erstellung ─────────────────────────────────────────────────────────

function buildTempoTrack(bpm: number): Uint8Array {
  const tempoMicros = Math.round(60_000_000 / bpm);
  const events: number[] = [
    // Tempo Event (delta=0)
    0x00, 0xFF, 0x51, 0x03,
    (tempoMicros >> 16) & 0xFF, (tempoMicros >> 8) & 0xFF, tempoMicros & 0xFF,
    // End of Track
    0x00, 0xFF, 0x2F, 0x00,
  ];

  // Track Header
  const header = new Uint8Array(8);
  const view   = new DataView(header.buffer);
  header[0] = 0x4D; header[1] = 0x54; header[2] = 0x72; header[3] = 0x6B; // "MTrk"
  writeUint32BE(view, 4, events.length);

  const result = new Uint8Array(header.length + events.length);
  result.set(header);
  result.set(events, header.length);
  return result;
}

function buildPatternTrack(pattern: PatternData, bpm: number): Uint8Array {
  const stepsPerBeat  = 4; // 1 Bar = 4 Beats, 16 Steps → 4 Steps/Beat
  const ticksPerStep  = TPQN / stepsPerBeat;
  const events: number[] = [];
  const DRUM_CH = 0x09; // Kanal 10 (0-indexed)

  // Track Name Event
  const nameBytes = Array.from(new TextEncoder().encode(pattern.name));
  events.push(0x00, 0xFF, 0x03, nameBytes.length, ...nameBytes);

  // Steps aller Parts
  const allEvents: Array<{ tick: number; type: "on" | "off"; note: number; velocity: number }> = [];

  for (let bar = 0; bar < 4; bar++) { // 4 Bars
    for (let s = 0; s < pattern.stepCount; s++) {
      const tick = (bar * pattern.stepCount + s) * ticksPerStep;
      pattern.parts.forEach((part, pi) => {
        const step = part.steps[s];
        if (!step?.active) return;
        const note = guessNote(part.name, pi);
        const vel  = step.velocity ?? 100;
        const durTicks = Math.max(1, Math.round(ticksPerStep * (step.length ?? 1) * 0.9));
        allEvents.push({ tick, type: "on",  note, velocity: vel });
        allEvents.push({ tick: tick + durTicks, type: "off", note, velocity: 0 });
      });
    }
  }

  allEvents.sort((a, b) => a.tick - b.tick || (a.type === "off" ? -1 : 1));

  let prevTick = 0;
  for (const ev of allEvents) {
    const delta = ev.tick - prevTick;
    prevTick = ev.tick;
    writeVarLen(events, delta);
    if (ev.type === "on") {
      events.push(0x90 | DRUM_CH, ev.note, ev.velocity);
    } else {
      events.push(0x80 | DRUM_CH, ev.note, 0);
    }
  }

  // End of Track
  events.push(0x00, 0xFF, 0x2F, 0x00);

  const header = new Uint8Array(8);
  const view   = new DataView(header.buffer);
  header[0] = 0x4D; header[1] = 0x54; header[2] = 0x72; header[3] = 0x6B;
  writeUint32BE(view, 4, events.length);

  const result = new Uint8Array(header.length + events.length);
  result.set(header);
  result.set(new Uint8Array(events), header.length);
  return result;
}

// ─── Haupt-Export-Funktion ────────────────────────────────────────────────────

/** Exportiert alle Patterns als MIDI Format 1 (.mid). */
export function exportMidiBundle(patterns: PatternData[], bpm: number): Blob {
  const numTracks = 1 + patterns.length; // Tempo-Track + 1 Track pro Pattern

  // MIDI Header
  const midiHeader = new Uint8Array(14);
  const headerView = new DataView(midiHeader.buffer);
  midiHeader[0] = 0x4D; midiHeader[1] = 0x54; midiHeader[2] = 0x68; midiHeader[3] = 0x64; // "MThd"
  writeUint32BE(headerView, 4, 6);         // Header-Länge = 6
  writeUint16BE(headerView, 8, 1);         // Format 1
  writeUint16BE(headerView, 10, numTracks);// Anzahl Tracks
  writeUint16BE(headerView, 12, TPQN);     // Ticks per Quarter Note

  const tracks: Uint8Array[] = [
    buildTempoTrack(bpm),
    ...patterns.map(p => buildPatternTrack(p, bpm)),
  ];

  const totalSize = midiHeader.length + tracks.reduce((sum, t) => sum + t.length, 0);
  const output    = new Uint8Array(totalSize);
  let offset = 0;
  output.set(midiHeader, offset); offset += midiHeader.length;
  for (const track of tracks) { output.set(track, offset); offset += track.length; }

  return new Blob([output], { type: "audio/midi" });
}

/** Download-Hilfsfunktion */
export function downloadMidiBundle(patterns: PatternData[], bpm: number, projectName: string): void {
  const blob = exportMidiBundle(patterns, bpm);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/[^\w\s-]/g, "")}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
