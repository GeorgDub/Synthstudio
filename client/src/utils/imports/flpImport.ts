/**
 * Synthstudio – flpImport.ts
 *
 * Vereinfachter FL Studio (.flp) Projekt-Parser.
 *
 * Format-Übersicht:
 *   Datei beginnt mit "FLhd" Header-Chunk (6 Bytes nach Chunk-Header):
 *     - format (uint16): 0 = Pattern, 1 = Score
 *     - nChannels (uint16)
 *     - ppq (uint16): Pulses per Quarter Note
 *
 *   Danach "FLdt" Data-Chunk mit Events:
 *     Events haben einen Event-ID (uint8) + variable Datengröße:
 *       0x00-0x3F: 1 Byte Daten   (z.B. Tempo: 0x9C)
 *       0x40-0x7F: 2 Bytes Daten
 *       0x80-0xBF: 4 Bytes Daten  (z.B. Tempo Float)
 *       0xC0-0xFF: variable Länge (TEXT events – Pattern-Namen etc.)
 *
 * Diese Implementierung extrahiert nur:
 *   - PPQ + Tempo
 *   - Pattern-Namen
 *   - Pattern-Nummer
 *
 * Vollständige Step-Daten würden komplexes XXSubChannel-Parsing brauchen
 * (Channel-Settings, Pattern-Events, Piano-Roll-Notes). Das ist als
 * zukünftige Erweiterung markiert.
 */

import type { ImportResult, ImportedPattern, ImportedPart, ImportedStep, ImportedMelodicPart, ImportedMelodicNote } from "./types";
import { ImportError } from "./types";
import {
  parseFlp as parseFlpFull,
  calculateBarCount,
  groupNotesByBar,
  flpPositionToStep,
  type FlpNote,
} from "../flpImport";

// ─── Event-IDs (Auszug aus der inoffiziellen FLP-Doku) ───────────────────────

const FLP_EVENT = {
  // 1-Byte
  CHANNEL_TYPE:       0x15, // Instrument type
  // 2-Byte
  TEMPO:              0x9C, // BPM × 1000
  PATTERN_NEW:        0x40, // New pattern (pattern-id)
  // 4-Byte
  TEMPO_FINE:         0xA9,
  PPQ:                0x86,
  // Variable
  TEXT_CHANNEL_NAME:  0xC3,
  TEXT_PATTERN_NAME:  0xC1,
  TEXT_TITLE:         0xC2,
  TEXT_VERSION:       0xC7,
};

// ─── Reader ──────────────────────────────────────────────────────────────────

class FlpReader {
  private view: DataView;
  private offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  get remaining() {
    return this.view.byteLength - this.offset;
  }

  readString(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
      s += String.fromCharCode(this.view.getUint8(this.offset + i));
    }
    this.offset += n;
    return s;
  }

  readU8(): number {
    return this.view.getUint8(this.offset++);
  }

  readU16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Liest eine variable-length-Quantity (LEB128) für TEXT-Events. */
  readVarLen(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readU8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new ImportError("VarLen overflow", "flp");
    }
    return result;
  }

  /** Liest n Bytes als Latin-1 String (FLP nutzt teilweise UTF-16LE für TEXT). */
  readUtf16Le(n: number): string {
    let s = "";
    for (let i = 0; i < n; i += 2) {
      const code = this.view.getUint16(this.offset + i, true);
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    this.offset += n;
    return s;
  }

  skip(n: number): void {
    this.offset += n;
  }
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

/** Default: 8 Drum-Parts, Channel mapped per modulo. */
const DEFAULT_PART_COUNT = 8;
const STEP_COUNT = 16;
const MAX_BARS = 16;

function emptyPart(name: string, stepCount: number): ImportedPart {
  const steps: ImportedStep[] = [];
  for (let i = 0; i < stepCount; i++) steps.push({ active: false, velocity: 100 });
  return { name, steps };
}

function buildPartsForBar(barNotes: FlpNote[], ppq: number, partCount: number): ImportedPart[] {
  const parts: ImportedPart[] = [];
  for (let i = 0; i < partCount; i++) parts.push(emptyPart(`Part ${i + 1}`, STEP_COUNT));
  for (const note of barNotes) {
    const step = flpPositionToStep(note.position, ppq) % STEP_COUNT;
    const partIdx = note.channel % partCount;
    // pitch wird mitgeführt — Drum-Machine ignoriert es, aber zukünftige
    // Konsumenten (MelodicPart-Routing, MIDI-Export) können es nutzen.
    parts[partIdx].steps[step] = { active: true, velocity: note.velocity, pitch: note.key };
  }
  return parts;
}

/**
 * Liefert pro FL-Channel die Menge der gespielten Pitches (MIDI-Keys).
 * Ein Channel mit nur einer Pitch ist drum-artig (gleicher Sample-Trigger),
 * ein Channel mit ≥2 Pitches ist melodisch (Synth/Sampler mit Notes).
 */
export function detectChannelPitches(notes: FlpNote[]): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const n of notes) {
    let set = map.get(n.channel);
    if (!set) {
      set = new Set();
      map.set(n.channel, set);
    }
    set.add(n.key);
  }
  return map;
}

function keyToNoteName(key: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(key / 12) - 1;
  return `${names[key % 12]}${octave}`;
}

/**
 * Konvertiert melodische FL-Channels in strukturierte `ImportedMelodicPart`s.
 * Phase 1 (v1.65): nur Extraktion — keinem Konsumenten zugewiesen.
 * Phase 2: MelodicPart-Routing im ProjectManager → echte Pattern-Erzeugung.
 *
 * Position-Umrechnung: PPQ-Ticks → Steps (1/16, Float erlaubt für off-grid).
 */
export function buildMelodicParts(notes: FlpNote[], ppq: number): ImportedMelodicPart[] {
  const pitchesByChannel = detectChannelPitches(notes);
  const ticksPerStep = ppq / 4;
  if (ticksPerStep <= 0) return [];

  const parts: ImportedMelodicPart[] = [];
  for (const [channel, pitches] of pitchesByChannel) {
    if (pitches.size < 2) continue; // drum-like — skip
    const channelNotes = notes.filter(n => n.channel === channel);
    const melodicNotes: ImportedMelodicNote[] = channelNotes
      .map<ImportedMelodicNote>(n => ({
        startStep: n.position / ticksPerStep,
        durationSteps: n.duration / ticksPerStep,
        pitch: n.key,
        velocity: n.velocity,
      }))
      .sort((a, b) => a.startStep - b.startStep);
    parts.push({
      sourceChannel: channel,
      name: `Channel ${channel}`,
      notes: melodicNotes,
    });
  }
  return parts;
}

export async function importFlp(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();

  // FLP-IMPORT v1.62: nutzt den vollwertigen Parser aus utils/flpImport.ts
  // (Headers + NotesEvents 0xE0/0xE7 + multi-bar grouping).
  let parsed;
  try {
    parsed = parseFlpFull(arrayBuffer);
  } catch (err) {
    throw new ImportError((err as Error).message, "flp");
  }

  const warnings: string[] = [];

  // BPM aus separatem Event-Pfad gewinnen (nicht im vollen Parser-Output enthalten,
  // da der nur Notes extrahiert). Wir lesen via FlpReader explizit für TEMPO_FINE.
  const reader = new FlpReader(arrayBuffer);
  reader.readString(4); reader.readU32();
  reader.readU16(); reader.readU16(); reader.readU16();
  reader.readString(4); reader.readU32();
  let bpm: number | undefined;
  while (reader.remaining > 0) {
    const eventId = reader.readU8();
    if (eventId < 0x40) reader.readU8();
    else if (eventId < 0x80) {
      const d = reader.readU16();
      if (eventId === FLP_EVENT.TEMPO) { bpm = d > 1000 ? d / 1000 : d; }
    } else if (eventId < 0xC0) {
      const d = reader.readU32();
      if (eventId === FLP_EVENT.TEMPO_FINE) {
        bpm = d > 1_000_000 ? d / 1000 : d;
        if (bpm > 999) bpm = bpm / 1000;
      }
      void d;
    } else {
      const len = reader.readVarLen();
      if (len > reader.remaining) break;
      reader.skip(len);
    }
  }

  // Notes auf Bars aufteilen
  const firstPattern = parsed.patterns[0];
  if (!firstPattern || !firstPattern.notes.length) {
    warnings.push("Keine Notes im FLP gefunden — FL Studio Versionen vor 11 oder leere Projekte werden nicht unterstützt.");
    return {
      sourceFormat: "flp",
      fileName: file.name,
      bpm,
      patterns: [{
        name: file.name.replace(/\.flp$/i, ""),
        stepCount: STEP_COUNT,
        bpm,
        parts: Array.from({ length: DEFAULT_PART_COUNT }, (_, i) => emptyPart(`Part ${i + 1}`, STEP_COUNT)),
      }],
      warnings,
    };
  }

  const ppq = parsed.header.ppq;
  const totalBars = Math.min(MAX_BARS, calculateBarCount(firstPattern.notes, ppq, STEP_COUNT));
  const byBar = groupNotesByBar(firstPattern.notes, ppq, STEP_COUNT);

  // Melodische Channels erkennen: Pitch-Varianz ≥2 → der Channel triggert echte
  // Notes, kein Drum-Sample. Die Drum-Machine ignoriert Pitch, daher warnen wir.
  const pitchesByChannel = detectChannelPitches(firstPattern.notes);
  for (const [channel, pitches] of pitchesByChannel) {
    if (pitches.size < 2) continue;
    const sorted = [...pitches].sort((a, b) => a - b);
    const lo = keyToNoteName(sorted[0]);
    const hi = keyToNoteName(sorted[sorted.length - 1]);
    warnings.push(
      `Channel ${channel}: melodischer Inhalt (${pitches.size} Tonhöhen, ${lo}..${hi}) — nur Step-Positionen importiert, Pitch-Info verworfen.`,
    );
  }

  const baseName = file.name.replace(/\.flp$/i, "");
  const patternsList: ImportedPattern[] = [];
  let imported = 0;
  for (let bar = 0; bar < totalBars; bar++) {
    const barNotes = byBar.get(bar) ?? [];
    imported += barNotes.length;
    patternsList.push({
      name: totalBars === 1 ? baseName : `${baseName} bar ${bar + 1}`,
      stepCount: STEP_COUNT,
      bpm,
      parts: buildPartsForBar(barNotes, ppq, DEFAULT_PART_COUNT),
    });
  }

  const droppedNotes = firstPattern.notes.length - imported;
  if (droppedNotes > 0) {
    warnings.push(`${droppedNotes} Notes jenseits ${MAX_BARS} Bars wurden ignoriert (Multi-Bar-Limit).`);
  }

  // Phase 1 (v1.65): melodische Parts extrahieren — noch kein Konsument.
  const melodicParts = buildMelodicParts(firstPattern.notes, ppq);

  return {
    sourceFormat: "flp",
    fileName: file.name,
    bpm,
    patterns: patternsList,
    melodicParts: melodicParts.length > 0 ? melodicParts : undefined,
    warnings,
  };
}
