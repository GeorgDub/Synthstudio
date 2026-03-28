/**
 * gmDrumMap.ts
 *
 * General MIDI (GM) Level 1 Drum-Map.
 * Mappt MIDI-Noten-Nummern (35–81) auf Synthstudio-Drum-Kategorien.
 * Enthält Hilfsfunktionen für den automatischen MIDI-Import.
 */

import type { ParsedMidiNote } from "./smfParser";

// ─── Öffentliche Typen ────────────────────────────────────────────────────────

export type DrumCategory =
  | "kicks"
  | "snares"
  | "hihats"
  | "claps"
  | "toms"
  | "percussion"
  | "other";

export interface GmDrumMapping {
  note: number;
  name: string;
  category: DrumCategory;
}

export interface PartStepData {
  category: DrumCategory;
  /** Name der ersten Note in dieser Kategorie (= „Master-Name" des Parts) */
  name: string;
  steps: Array<{ stepIndex: number; velocity: number }>;
}

// ─── GM Level-1 Drum-Map (Noten 35–81) ───────────────────────────────────────

const GM_DRUM_MAP: readonly GmDrumMapping[] = [
  { note: 35, name: "Acoustic Bass Drum", category: "kicks" },
  { note: 36, name: "Bass Drum 1",        category: "kicks" },
  { note: 37, name: "Side Stick",         category: "snares" },
  { note: 38, name: "Acoustic Snare",     category: "snares" },
  { note: 39, name: "Hand Clap",          category: "claps" },
  { note: 40, name: "Electric Snare",     category: "snares" },
  { note: 41, name: "Low Floor Tom",      category: "toms" },
  { note: 42, name: "Closed Hi Hat",      category: "hihats" },
  { note: 43, name: "High Floor Tom",     category: "toms" },
  { note: 44, name: "Pedal Hi-Hat",       category: "hihats" },
  { note: 45, name: "Low Tom",            category: "toms" },
  { note: 46, name: "Open Hi-Hat",        category: "hihats" },
  { note: 47, name: "Low-Mid Tom",        category: "toms" },
  { note: 48, name: "Hi-Mid Tom",         category: "toms" },
  { note: 49, name: "Crash Cymbal 1",     category: "percussion" },
  { note: 50, name: "High Tom",           category: "toms" },
  { note: 51, name: "Ride Cymbal 1",      category: "percussion" },
  { note: 52, name: "Chinese Cymbal",     category: "percussion" },
  { note: 53, name: "Ride Bell",          category: "percussion" },
  { note: 54, name: "Tambourine",         category: "percussion" },
  { note: 55, name: "Splash Cymbal",      category: "percussion" },
  { note: 56, name: "Cowbell",            category: "percussion" },
  { note: 57, name: "Crash Cymbal 2",     category: "percussion" },
  { note: 58, name: "Vibraslap",          category: "percussion" },
  { note: 59, name: "Ride Cymbal 2",      category: "percussion" },
  { note: 60, name: "Hi Bongo",           category: "percussion" },
  { note: 61, name: "Low Bongo",          category: "percussion" },
  { note: 62, name: "Mute Hi Conga",      category: "percussion" },
  { note: 63, name: "Open Hi Conga",      category: "percussion" },
  { note: 64, name: "Low Conga",          category: "percussion" },
  { note: 65, name: "High Timbale",       category: "percussion" },
  { note: 66, name: "Low Timbale",        category: "percussion" },
  { note: 67, name: "High Agogo",         category: "percussion" },
  { note: 68, name: "Low Agogo",          category: "percussion" },
  { note: 69, name: "Cabasa",             category: "percussion" },
  { note: 70, name: "Maracas",            category: "percussion" },
  { note: 71, name: "Short Whistle",      category: "percussion" },
  { note: 72, name: "Long Whistle",       category: "percussion" },
  { note: 73, name: "Short Guiro",        category: "percussion" },
  { note: 74, name: "Long Guiro",         category: "percussion" },
  { note: 75, name: "Claves",             category: "percussion" },
  { note: 76, name: "Hi Wood Block",      category: "percussion" },
  { note: 77, name: "Low Wood Block",     category: "percussion" },
  { note: 78, name: "Mute Cuica",         category: "percussion" },
  { note: 79, name: "Open Cuica",         category: "percussion" },
  { note: 80, name: "Mute Triangle",      category: "percussion" },
  { note: 81, name: "Open Triangle",      category: "percussion" },
] as const;

/** Schnellzugriff-Index: MIDI-Note → GmDrumMapping */
const GM_DRUM_INDEX = new Map<number, GmDrumMapping>(
  GM_DRUM_MAP.map((m) => [m.note, m]),
);

// ─── Öffentliche Funktionen ───────────────────────────────────────────────────

/**
 * Gibt Kategorie und Klangname für eine GM-Drum-Noten-Nummer zurück.
 * Noten außerhalb des GM-Bereichs erhalten die Kategorie "other".
 */
export function getGmDrumInfo(note: number): GmDrumMapping {
  return (
    GM_DRUM_INDEX.get(note) ?? {
      note,
      name: `MIDI Note ${note}`,
      category: "other",
    }
  );
}

/**
 * Konvertiert geparste MIDI-Noten in eine druckfertige Part-Step-Map.
 *
 * Noten gleicher Kategorie werden zu einem Part zusammengefasst.
 * Der Name des ersten anzutreffenden Sounds der Kategorie dient als Part-Name.
 * Die Reihenfolge der Parts entspricht der Reihenfolge des ersten Auftretens
 * jeder Kategorie im Noten-Array.
 *
 * @returns Array von PartStepData, einer pro gefundener Kategorie.
 */
export function midiNotesToParts(notes: ParsedMidiNote[]): PartStepData[] {
  const categoryMap = new Map<
    DrumCategory,
    { name: string; steps: Array<{ stepIndex: number; velocity: number }> }
  >();

  for (const n of notes) {
    const { category, name } = getGmDrumInfo(n.note);
    if (!categoryMap.has(category)) {
      categoryMap.set(category, { name, steps: [] });
    }
    categoryMap.get(category)!.steps.push({
      stepIndex: n.stepIndex,
      velocity: n.velocity,
    });
  }

  return Array.from(categoryMap.entries()).map(([category, { name, steps }]) => ({
    category,
    name,
    steps,
  }));
}
