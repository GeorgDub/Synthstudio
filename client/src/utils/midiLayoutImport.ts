/**
 * Synthstudio – MIDI Layout Import (post-v1.38.0)
 *
 * Pure-logic Parser für externe MIDI-Controller-Mapping-Dateien.
 *
 * Wave 1: generisches JSON-Format. Konkrete proprietäre Formate (FL Studio
 * .scr, Ableton .adv, Akai MPC .midi-map, NI Maschine, Mackie/HUI Profile)
 * sind eigene Reverse-Engineering-Projekte; das generische JSON dient als
 * lingua-franca zwischen Community-Konvertern und Synthstudio.
 *
 * Format-Beispiel:
 *
 * ```json
 * {
 *   "synthstudioLayout": "v1",
 *   "name": "Akai MPK Mini",
 *   "ccMappings": [
 *     { "cc": 1, "channel": 0, "target": { "type": "bpm" }, "label": "Modwheel → BPM" },
 *     { "cc": 7, "channel": 0, "target": { "type": "masterVolume" }, "label": "Master" }
 *   ],
 *   "noteMappings": [
 *     { "note": 36, "channel": 9, "partId": "kick",  "label": "Kick" },
 *     { "note": 38, "channel": 9, "partId": "snare", "label": "Snare" }
 *   ]
 * }
 * ```
 *
 * Validation:
 *  - JSON parsbar
 *  - `synthstudioLayout`-Marker vorhanden (oder gefolgt von Migration)
 *  - cc 0-127, channel 0-16, note 0-127
 *  - target ist eines der erlaubten MidiLearnTarget-shapes (deren `type` matcht)
 *  - Max 10kB Datei-Größe (Sicherheits-Schranke)
 *
 * NICHT validiert (NUR Warnings):
 *  - partId aus noteMappings existiert nicht im aktuellen Projekt → User-Warning
 */
import type { MidiMapping, MidiNoteMapping, MidiLearnTarget } from "@/hooks/useMidi";

export const MAX_LAYOUT_FILE_BYTES = 10 * 1024; // 10kB

/** Liste der erlaubten Target-Typ-Strings. Sync mit MidiLearnTarget-Union. */
export const VALID_TARGET_TYPES = new Set<string>([
  "bpm", "playStop", "record", "tapTempo", "bpmUp", "bpmDown", "masterVolume",
  "volume", "mute", "solo", "pan", "step", "partUp", "partDown",
  "pattern", "patternNext", "patternPrev", "patternClear", "patternFill",
  "patternRandomize", "patternDuplicate",
  "tab",
  "toggleNoteRepeat", "toggleMorph",
]);

export interface ParsedMidiLayout {
  /** Optional human-readable name aus dem Layout. */
  name?: string;
  ccMappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
}

export interface MidiLayoutParseResult {
  ok: boolean;
  /** Bei ok=true: die parsed Mappings. */
  layout?: ParsedMidiLayout;
  /** Bei ok=false: error-Beschreibung. */
  error?: string;
  /** Optionale Warnings (z.B. ungültige Einzel-Einträge die übersprungen wurden). */
  warnings?: string[];
}

interface AnyRecord { [key: string]: unknown }

function isObject(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCcValid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 127;
}
function isNoteValid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 127;
}
function isChannelValid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 16;
}
function isTargetValid(v: unknown): v is MidiLearnTarget {
  if (!isObject(v)) return false;
  if (typeof v.type !== "string") return false;
  return VALID_TARGET_TYPES.has(v.type);
}

/**
 * Parsed + validated den Inhalt einer Synthstudio-MIDI-Layout-JSON.
 * Returnt das geparste Layout ODER eine error-Beschreibung.
 */
export function parseMidiLayoutJson(text: string): MidiLayoutParseResult {
  if (!text || text.trim().length === 0) {
    return { ok: false, error: "Datei ist leer." };
  }
  if (text.length > MAX_LAYOUT_FILE_BYTES) {
    return { ok: false, error: `Datei zu groß: ${text.length} Bytes (max ${MAX_LAYOUT_FILE_BYTES}).` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `JSON-Parse-Fehler: ${msg}` };
  }

  if (!isObject(raw)) {
    return { ok: false, error: "Top-Level muss ein Objekt sein." };
  }

  if (raw.synthstudioLayout !== "v1") {
    return { ok: false, error: 'Fehlender oder falscher "synthstudioLayout"-Marker (erwartet "v1").' };
  }

  const warnings: string[] = [];
  const ccMappings: MidiMapping[] = [];
  const noteMappings: MidiNoteMapping[] = [];

  if (raw.ccMappings !== undefined) {
    if (!Array.isArray(raw.ccMappings)) {
      return { ok: false, error: '"ccMappings" muss ein Array sein.' };
    }
    raw.ccMappings.forEach((entry, idx) => {
      if (!isObject(entry)) {
        warnings.push(`ccMappings[${idx}] ist kein Objekt — übersprungen.`);
        return;
      }
      if (!isCcValid(entry.cc)) {
        warnings.push(`ccMappings[${idx}] ungültiger cc (${entry.cc}) — übersprungen.`);
        return;
      }
      if (!isChannelValid(entry.channel)) {
        warnings.push(`ccMappings[${idx}] ungültiger channel (${entry.channel}) — übersprungen.`);
        return;
      }
      if (!isTargetValid(entry.target)) {
        warnings.push(`ccMappings[${idx}] ungültiges target — übersprungen.`);
        return;
      }
      const label = typeof entry.label === "string" ? entry.label : `CC ${entry.cc}`;
      ccMappings.push({
        cc: entry.cc,
        channel: entry.channel,
        target: entry.target,
        label,
      });
    });
  }

  if (raw.noteMappings !== undefined) {
    if (!Array.isArray(raw.noteMappings)) {
      return { ok: false, error: '"noteMappings" muss ein Array sein.' };
    }
    raw.noteMappings.forEach((entry, idx) => {
      if (!isObject(entry)) {
        warnings.push(`noteMappings[${idx}] ist kein Objekt — übersprungen.`);
        return;
      }
      if (!isNoteValid(entry.note)) {
        warnings.push(`noteMappings[${idx}] ungültige note (${entry.note}) — übersprungen.`);
        return;
      }
      if (!isChannelValid(entry.channel)) {
        warnings.push(`noteMappings[${idx}] ungültiger channel (${entry.channel}) — übersprungen.`);
        return;
      }
      if (typeof entry.partId !== "string" || entry.partId.length === 0) {
        warnings.push(`noteMappings[${idx}] partId fehlt oder leer — übersprungen.`);
        return;
      }
      const label = typeof entry.label === "string" ? entry.label : `Note ${entry.note}`;
      noteMappings.push({
        note: entry.note,
        channel: entry.channel,
        partId: entry.partId,
        label,
      });
    });
  }

  if (ccMappings.length === 0 && noteMappings.length === 0) {
    return { ok: false, error: "Keine gültigen Mappings im Layout — leeres Resultat." };
  }

  return {
    ok: true,
    layout: {
      name: typeof raw.name === "string" ? raw.name : undefined,
      ccMappings,
      noteMappings,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Hilfsfunktion zum Cross-check der partIds gegen aktuelle Pattern-Parts.
 * Gibt eine Liste von Warnings zurück, wenn partIds nicht existieren.
 * Aufrufer kann entscheiden ob er diese als blocker oder nur als Info behandelt.
 */
export function checkPartIdsExist(
  noteMappings: MidiNoteMapping[],
  knownPartIds: string[],
): string[] {
  const known = new Set(knownPartIds);
  const missing = new Set<string>();
  for (const m of noteMappings) {
    if (!known.has(m.partId)) missing.add(m.partId);
  }
  if (missing.size === 0) return [];
  return [
    `Note-Mappings referenzieren ${missing.size} unbekannte partId(s): ${[...missing].slice(0, 5).join(", ")}` +
    (missing.size > 5 ? ", …" : "") +
    ". Diese Note-Mappings werden zwar importiert, lösen aber erst aus wenn die Parts entsprechend erstellt sind.",
  ];
}
