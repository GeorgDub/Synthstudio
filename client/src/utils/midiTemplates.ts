/**
 * Synthstudio – midiTemplates.ts
 *
 * Vordefinierte MIDI-Mappings für gängige Hardware-Controller
 * der Techno / Hardtekk / Hardcore / Maschine / MPC-Szene.
 *
 * Jede Vorlage definiert:
 *   - cc-Mappings: CC-Nr → Action (BPM, Volume, Mute, Step etc.)
 *   - noteMappings: MIDI-Note → Drum-Pad (GM Drum Map als Default)
 *
 * Nutzung im MidiSettings-Panel:
 *   loadMidiTemplate("launchpad-mk2") → ersetzt aktuelle Mappings
 */
import type { MidiMapping, MidiNoteMapping } from "@/hooks/useMidi";

export interface MidiTemplate {
  id: string;
  /** Anzeigename */
  name: string;
  /** Hardware-Hersteller */
  manufacturer: string;
  /** Kurzbeschreibung */
  description: string;
  /** CC-Mappings (Knobs, Fader, Buttons) */
  ccMappings: Omit<MidiMapping, "label">[];
  /** Note-Mappings (Drum-Pads, Keyboard) */
  noteMappings: Omit<MidiNoteMapping, "label">[];
}

// ─── Standard GM Drum Map (für alle Pad-Controller) ──────────────────────────

const GM_DRUM_DEFAULTS: Array<{ note: number; partIndex: number }> = [
  { note: 36, partIndex: 0 },  // Kick
  { note: 38, partIndex: 1 },  // Snare
  { note: 42, partIndex: 2 },  // Hi-Hat closed
  { note: 46, partIndex: 3 },  // Hi-Hat open
  { note: 39, partIndex: 4 },  // Clap
  { note: 45, partIndex: 5 },  // Tom Hi
  { note: 41, partIndex: 6 },  // Tom Lo
  { note: 49, partIndex: 7 },  // FX
];

// ─── Templates ────────────────────────────────────────────────────────────────

export const MIDI_TEMPLATES: MidiTemplate[] = [
  {
    id: "launchpad-mk2",
    name: "Launchpad MK2 / MK3",
    manufacturer: "Novation",
    description: "8×8 Pad-Grid für Step-Programming. Pads in Reihe 1–8 für Steps, Top-Row für Transport.",
    ccMappings: [
      // Top-Row Buttons als Transport
      { cc: 104, channel: 0, target: { type: "playStop" } },
      { cc: 105, channel: 0, target: { type: "record" } },
      { cc: 106, channel: 0, target: { type: "patternPrev" } },
      { cc: 107, channel: 0, target: { type: "patternNext" } },
      { cc: 108, channel: 0, target: { type: "patternClear" } },
      { cc: 109, channel: 0, target: { type: "patternFill" } },
      { cc: 110, channel: 0, target: { type: "patternRandomize" } },
      { cc: 111, channel: 0, target: { type: "openSettings" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    id: "push-2",
    name: "Ableton Push 2",
    manufacturer: "Ableton",
    description: "8×8 RGB-Pads, 8 Encoder, Touch-Strip. Pads für Step-Programming, Encoder für Volume.",
    ccMappings: [
      // 8 Encoder als Volume-Slider für Parts 0–7
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 71 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // Transport
      { cc: 85, channel: 0, target: { type: "playStop" } },
      { cc: 86, channel: 0, target: { type: "record" } },
      { cc: 87, channel: 0, target: { type: "tapTempo" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note: 36 + (partIndex < 8 ? partIndex : note - 36),
      channel: 0,
      partId: `part-${partIndex}`,
    })),
  },
  {
    id: "mpc-one",
    name: "Akai MPC One / MPC Live",
    manufacturer: "Akai Professional",
    description: "4×4 Pads + Q-Link Knobs. Klassisches MPC-Layout, perfekt für Beat-Making.",
    ccMappings: [
      // Q-Link 1–4: BPM, Master Volume, Pan, Filter
      { cc: 14, channel: 0, target: { type: "bpm" } },
      { cc: 15, channel: 0, target: { type: "masterVolume" } },
      { cc: 16, channel: 0, target: { type: "volume", partId: "part-0", partName: "Kick" } },
      { cc: 17, channel: 0, target: { type: "volume", partId: "part-1", partName: "Snare" } },
      // Transport
      { cc: 118, channel: 0, target: { type: "playStop" } },
      { cc: 119, channel: 0, target: { type: "record" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    id: "maschine-mikro",
    name: "NI Maschine Mikro MK3",
    manufacturer: "Native Instruments",
    description: "16 Pads (4×4) + Touch-Strip. Ideal für Live-Performance und Step-Sequencing.",
    ccMappings: [
      { cc: 1, channel: 0, target: { type: "bpm" } },
      { cc: 7, channel: 0, target: { type: "masterVolume" } },
      // Footer-Buttons als Transport
      { cc: 112, channel: 0, target: { type: "playStop" } },
      { cc: 113, channel: 0, target: { type: "record" } },
      { cc: 114, channel: 0, target: { type: "patternNext" } },
      { cc: 115, channel: 0, target: { type: "patternPrev" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    // v2.84 (TASK-231): LED-Feedback wird über die MidiSettings → "LED-Feedback"-
    // Section aktiviert (separater Output-Picker + Toggle). PC-Mode-Default des
    // nanoKONTROL2: Solo CC 32-39, Mute CC 48-55. Solo+Mute hier sind die
    // **Track-Buttons** (CC 32-39 in nanoKONTROL2-Default), die wir auf
    // useMixerStore-Channels mute/solo mappen. Im PC-Mode ist die Solo-Zeile
    // CC 32-39 — entspricht dem was wir hier mit `mute` belegen. Das ist KEIN
    // Fehler: KORG nennt die obere Button-Reihe historisch "Solo", aber die
    // CCs sind frei zuweisbar. Wir folgen der Default-Belegung des KORG-Editors
    // (Werks-Reset).
    id: "nanokontrol2",
    name: "Korg nanoKONTROL2",
    manufacturer: "Korg",
    description: "9 Slider + 9 Knobs + Buttons + Marker. LED-Feedback via Settings-Toggle. Marker-Buttons cyclen Scenes wenn aktiviert.",
    ccMappings: [
      // 8 Slider: Volume Parts 0–7
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // 8 Knobs: Pan Parts 0–7
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 16 + i, channel: 0,
        target: { type: "pan" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // 8 Solo-Buttons (PC-Mode-Default CC 32-39)
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 32 + i, channel: 0,
        target: { type: "solo" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // 8 Mute-Buttons (PC-Mode-Default CC 48-55)
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 48 + i, channel: 0,
        target: { type: "mute" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // Master + Transport
      { cc: 7, channel: 0, target: { type: "masterVolume" } },
      { cc: 41, channel: 0, target: { type: "playStop" } },
      { cc: 45, channel: 0, target: { type: "record" } },
      // v2.84: Marker-PREV/NEXT — fallen automatisch in Scene-Mode wenn aktiv
      // (siehe useMidi.ts handleMidiMessage); zusätzlich CC-Mapping als Fallback,
      // falls Scene-Mode aus ist.
      { cc: 61, channel: 0, target: { type: "patternPrev" } },
      { cc: 62, channel: 0, target: { type: "patternNext" } },
    ],
    noteMappings: [],
  },
  {
    id: "mpk-mini-mk3",
    name: "Akai MPK Mini MK3",
    manufacturer: "Akai Professional",
    description: "25-Key Keyboard + 8 Pads + 8 Knobs. Kompakter Controller für Studio und Live.",
    ccMappings: [
      // 8 Knobs: BPM, Master, 6× Volume
      { cc: 70, channel: 0, target: { type: "bpm" } },
      { cc: 71, channel: 0, target: { type: "masterVolume" } },
      ...Array.from({ length: 6 }, (_, i) => ({
        cc: 72 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
    ],
    noteMappings: GM_DRUM_DEFAULTS.slice(0, 8).map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    id: "behringer-x-touch-mini",
    name: "Behringer X-Touch Mini",
    manufacturer: "Behringer",
    description: "8 Encoder + 1 Slider + 16 Buttons – kostengünstige Mixer-Alternative.",
    ccMappings: [
      // 8 Encoder als Volume
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 1 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // Slider = Master
      { cc: 9, channel: 0, target: { type: "masterVolume" } },
      // 8 obere Buttons als Mute
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 89 + i, channel: 0,
        target: { type: "mute" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
    ],
    noteMappings: [],
  },
  {
    id: "korg-padkontrol",
    name: "Korg padKONTROL",
    manufacturer: "Korg",
    description: "16 Velocity-sensitive Pads + 2 Encoder + X/Y-Pad. Klassiker der elektronischen Musik.",
    ccMappings: [
      { cc: 16, channel: 0, target: { type: "bpm" } },
      { cc: 17, channel: 0, target: { type: "masterVolume" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    // v1.82: Korg Volca Beats — kompakte Drum-Box, beliebt in Techno/Hardtekk.
    // Sendet Drums per Default auf Ch10 mit Standard-GM-Drum-Notes. CCs für
    // die 8 Drum-Sound-Edit-Knöpfe (Decay/Pitch/Level).
    id: "korg-volca-beats",
    name: "Korg Volca Beats",
    manufacturer: "Korg",
    description: "Kompakte analoge Drum-Maschine. 10 Drum-Parts, Step-Sequenzer + Live-Performance.",
    ccMappings: [
      // Standard Volca-Beats CC-Map (Auswahl der wichtigsten)
      { cc: 40, channel: 0, target: { type: "volume", partId: "part-0", partName: "Kick" } },
      { cc: 41, channel: 0, target: { type: "volume", partId: "part-1", partName: "Snare" } },
      { cc: 42, channel: 0, target: { type: "volume", partId: "part-2", partName: "Lo Tom" } },
      { cc: 43, channel: 0, target: { type: "volume", partId: "part-3", partName: "Hi Tom" } },
      { cc: 44, channel: 0, target: { type: "volume", partId: "part-4", partName: "CH" } },
      { cc: 45, channel: 0, target: { type: "volume", partId: "part-5", partName: "OH" } },
      { cc: 46, channel: 0, target: { type: "volume", partId: "part-6", partName: "Clap" } },
    ],
    noteMappings: [
      // GM Drum Map auf Ch10 — Volca-Standard
      { note: 36, channel: 10, partId: "part-0" }, // Kick
      { note: 38, channel: 10, partId: "part-1" }, // Snare
      { note: 43, channel: 10, partId: "part-2" }, // Lo Tom
      { note: 50, channel: 10, partId: "part-3" }, // Hi Tom
      { note: 42, channel: 10, partId: "part-4" }, // Closed HH
      { note: 46, channel: 10, partId: "part-5" }, // Open HH
      { note: 39, channel: 10, partId: "part-6" }, // Clap
      { note: 75, channel: 10, partId: "part-7" }, // Claves
    ],
  },
  {
    // v1.82: Roland TR-8 / TR-8S / TR-6S — moderne x0x-Style Drum-Maschinen.
    // Auch der Behringer RD-8 (1:1 Clone) kommt mit diesem Template klar.
    // Default-Channel 10 mit Roland-eigenen Note-Assignments.
    id: "roland-tr-8",
    name: "Roland TR-8 / TR-8S / RD-8",
    manufacturer: "Roland",
    description: "TR-style Drum-Maschine mit 11–12 Drum-Tracks. Live-Performance + Fill-In + Mute-Buttons.",
    ccMappings: [
      // TR-8 standard CC layout: 84-95 per part level, 105 master volume
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 84 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Track ${i + 1}` },
      })),
      { cc: 105, channel: 0, target: { type: "masterVolume" } },
    ],
    noteMappings: [
      // TR-8 Pad-Notes (typische Roland-Belegung auf Ch10)
      { note: 36, channel: 10, partId: "part-0" }, // BD
      { note: 38, channel: 10, partId: "part-1" }, // SD
      { note: 39, channel: 10, partId: "part-2" }, // Clap
      { note: 37, channel: 10, partId: "part-3" }, // Rim
      { note: 41, channel: 10, partId: "part-4" }, // Low Tom
      { note: 42, channel: 10, partId: "part-5" }, // CH
      { note: 46, channel: 10, partId: "part-6" }, // OH
      { note: 49, channel: 10, partId: "part-7" }, // Crash
    ],
  },
  {
    // v1.82: Arturia BeatStep Pro — sehr beliebter günstiger Sequencer-Controller.
    // 16 RGB-Pads (Drum-Mode auf Ch10), Sequencer + 8 Encoder.
    id: "arturia-beatstep-pro",
    name: "Arturia BeatStep Pro",
    manufacturer: "Arturia",
    description: "16 Pads + Sequencer + 16 Encoder. Standard für Synth-Performances und Step-Sequencing.",
    ccMappings: [
      // 16 Encoder als Volumes für Parts 0-7 + Mute für 0-7
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 10 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Part ${i + 1}` },
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 74 + i, channel: 0,
        target: { type: "mute" as const, partId: `part-${i}`, partName: `Part ${i + 1}` },
      })),
    ],
    noteMappings: [
      // 16 Pads (untere Reihe) mit Standard-Drum-Map auf Ch10
      ...Array.from({ length: 8 }, (_, i) => ({
        note: 36 + i, channel: 10, partId: `part-${i}`,
      })),
      // Zweite Pad-Reihe (Notes 44-51) auf dieselben Parts
      ...Array.from({ length: 8 }, (_, i) => ({
        note: 44 + i, channel: 10, partId: `part-${i}`,
      })),
    ],
  },
  {
    // v1.82: Elektron Digitakt — beliebt in Techno/Hardtekk-Studios.
    // 8 Sample-Tracks + 8 MIDI-Tracks. Default-MIDI-Out auf Ch1-8 mit Notes
    // pro Track. Encoder senden CCs 16-23 (Volume) und 24-31 (Pan).
    id: "elektron-digitakt",
    name: "Elektron Digitakt",
    manufacturer: "Elektron",
    description: "8-Spur Sampler + 8 MIDI-Spuren. Live-Sequencing-Workhorse für Techno-Studios.",
    ccMappings: [
      // Elektron-Encoder: typische Param-CC-Map
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 16 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Track ${i + 1}` },
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 24 + i, channel: 0,
        target: { type: "pan" as const, partId: `part-${i}`, partName: `Track ${i + 1}` },
      })),
    ],
    noteMappings: [
      // Digitakt-Trigger-Notes per Track (Ch1-8)
      ...Array.from({ length: 8 }, (_, i) => ({
        note: 60, channel: i + 1, partId: `part-${i}`,
      })),
    ],
  },
  {
    // v1.82: Direkt motiviert durch User-Workflow mit Korg Electribe 2 Sampler.
    // Electribe 2 (E2 / E2S) sendet per Default auf MIDI-Channel 10 (Drum-Channel)
    // 16 Pad-Note-On-Events (Notes 36-51, C2-D#3). Synthstudio hat nur 8 Default-Parts,
    // also mappen wir die ersten 8 Pads auf part-0..part-7 und die zweite Reihe (8 Pads)
    // erneut auf dieselben Parts — beide Pad-Reihen triggern dieselben Drums.
    // User kann via Auto-Learn jedes Mapping individuell überschreiben wenn er
    // mehr Parts angelegt hat oder eine andere Pad-Belegung präferiert.
    // Transport ist auf der Electribe MIDI Start/Stop (status 0xFA/0xFC) — wird
    // separat im handleMidiMessage gehandhabt, kein CC-Mapping nötig.
    id: "korg-electribe-2",
    name: "Korg Electribe 2 / 2S",
    manufacturer: "Korg",
    description: "16 Pads (Ch10) + Filter/EG-Knobs + Slider. Hardware-Sampler-Workhorse für Techno/Hardtekk/IDM.",
    ccMappings: [
      // Master-Slider
      { cc: 7,  channel: 0, target: { type: "masterVolume" } },
      // Mod-Wheel → BPM (oft am Electribe als Joystick-X mappable)
      { cc: 1,  channel: 0, target: { type: "bpm" } },
      // Filter-Sektion (Cutoff/Resonance via Standard-CCs) auf Master-Volume bzw.
      // Volume Part 0/1 als Fallback bis FX-Parameter-Targets (v1.76) verfügbar sind.
      { cc: 74, channel: 0, target: { type: "volume", partId: "part-0", partName: "Kick" } },
      { cc: 71, channel: 0, target: { type: "volume", partId: "part-1", partName: "Snare" } },
      { cc: 73, channel: 0, target: { type: "volume", partId: "part-2", partName: "Hi-Hat cl." } },
      { cc: 72, channel: 0, target: { type: "volume", partId: "part-3", partName: "Hi-Hat op." } },
    ],
    noteMappings: [
      // Erste Pad-Reihe (untere 8 Pads) auf Ch10
      ...Array.from({ length: 8 }, (_, i) => ({
        note: 36 + i, channel: 10, partId: `part-${i}`,
      })),
      // Zweite Pad-Reihe (obere 8 Pads) — repliziert die Belegung damit beide
      // Reihen denselben Drum-Sound triggern (User-Erwartung bei 8-Part-Setup)
      ...Array.from({ length: 8 }, (_, i) => ({
        note: 44 + i, channel: 10, partId: `part-${i}`,
      })),
    ],
  },
];

// ─── MIDI-Note-Out Drum-Maps (TASK-240 / v2.92.0) ────────────────────────────
//
// Anders als die MIDI_TEMPLATES oben (die DEFINIERE was wir lesen, wenn die
// Hardware uns triggern soll) beschreiben diese Drum-Maps was Synthstudio
// SCHICKT, wenn die Hardware als Sound-Modul agiert. Sie werden pro Part im
// useMidiNoteOutStore eingetragen via `applyElectribeDrumMap` (oder analog).

export interface NoteOutDrumMapping {
  /** 0-basierter Part-Index in der Drum-Bank. */
  partIndex: number;
  /** MIDI-Note die für diesen Part rausgeschickt wird (0..127). */
  note: number;
  /** MIDI-Channel (0..15). Drum-Default = 9 (== MIDI Channel 10). */
  channel: number;
  /** Anzeigename für UI. */
  label: string;
}

export interface NoteOutTemplate {
  id: string;
  name: string;
  manufacturer: string;
  description: string;
  mappings: NoteOutDrumMapping[];
}

/**
 * KORG Electribe 2 (E2 / E2S) als Sound-Modul. Pads triggern auf Channel 10
 * mit GM-Drum-Notes. Bei der Electribe kann der MIDI-Channel pro Part im
 * Global-Menü geändert werden — Default-Layout entspricht aber dem GM-Drum-Map.
 *
 * Mapping bewährt für Techno/Hardtekk-Workflow: User baut Patterns in
 * Synthstudio (mit Morph/Humanize/Probability) und schickt sie zur Electribe
 * → Electribe spielt die Hardware-Samples → Mix kommt zurück über Audio-In
 * oder USB.
 */
export const ELECTRIBE_2_DRUM_MAP: NoteOutTemplate = {
  id: "korg-electribe-2-drumout",
  name: "KORG Electribe 2 / 2S — Drum-Out",
  manufacturer: "Korg",
  description:
    "Sendet Drum-Triggers an Electribe 2 (Channel 10, GM Drum-Map). Pads 1-8 → Note 36/38/42/46/39/45/41/49.",
  mappings: [
    { partIndex: 0, note: 36, channel: 9, label: "Kick (C2)" },
    { partIndex: 1, note: 38, channel: 9, label: "Snare (D2)" },
    { partIndex: 2, note: 42, channel: 9, label: "Hi-Hat cl. (F#2)" },
    { partIndex: 3, note: 46, channel: 9, label: "Hi-Hat op. (A#2)" },
    { partIndex: 4, note: 39, channel: 9, label: "Clap (D#2)" },
    { partIndex: 5, note: 45, channel: 9, label: "Tom Hi (A2)" },
    { partIndex: 6, note: 41, channel: 9, label: "Tom Lo (F2)" },
    { partIndex: 7, note: 49, channel: 9, label: "Crash (C#3)" },
  ],
};

/** Liste aller verfügbaren Note-Out-Drum-Maps. */
export const NOTE_OUT_TEMPLATES: NoteOutTemplate[] = [
  ELECTRIBE_2_DRUM_MAP,
];

/** Findet eine Vorlage anhand der ID. */
export function getMidiTemplate(id: string): MidiTemplate | undefined {
  return MIDI_TEMPLATES.find(t => t.id === id);
}

/** Liefert alle verfügbaren Template-IDs. */
export function listTemplateIds(): string[] {
  return MIDI_TEMPLATES.map(t => t.id);
}

/** Konvertiert ein Template zu MidiMapping[] + MidiNoteMapping[] (mit auto-generierten Labels). */
export function templateToMappings(
  template: MidiTemplate,
  partResolver?: (partId: string) => string | undefined,
): { cc: MidiMapping[]; notes: MidiNoteMapping[] } {
  const cc: MidiMapping[] = template.ccMappings.map(m => ({
    ...m,
    label: ccTargetToLabel(m.target),
  }));
  const notes: MidiNoteMapping[] = template.noteMappings.map(n => ({
    ...n,
    label: partResolver?.(n.partId) ?? n.partId,
  }));
  return { cc, notes };
}

function ccTargetToLabel(t: MidiMapping["target"]): string {
  switch (t.type) {
    case "bpm":            return "BPM";
    case "masterVolume":   return "Master Volume";
    case "playStop":       return "Play/Stop";
    case "record":         return "Record";
    case "tapTempo":       return "Tap Tempo";
    case "volume":         return `Volume ${t.partName ?? t.partId}`;
    case "pan":            return `Pan ${t.partName ?? t.partId}`;
    case "mute":           return `Mute ${t.partName ?? t.partId}`;
    case "solo":           return `Solo ${t.partName ?? t.partId}`;
    case "patternNext":    return "Next Pattern";
    case "patternPrev":    return "Previous Pattern";
    case "patternClear":   return "Clear Pattern";
    case "patternFill":    return "Fill Pattern";
    case "patternRandomize": return "Randomize Pattern";
    case "openSettings":   return "Settings";
    default:               return t.type;
  }
}
