/**
 * Synthstudio – midiHardwareTemplates.ts (v3.121.0)
 *
 * Structured, browsable view of the existing 13 built-in MIDI hardware
 * templates from `midiTemplates.ts`. This module does NOT duplicate the
 * mapping definitions — it re-exports the existing `MIDI_TEMPLATES` from
 * `midiTemplates.ts` and adds metadata (category, tips, icon hint) plus
 * helper functions for the new TemplatesLibrary UI.
 *
 * Pure logic — no React, no DOM, no localStorage.
 */
import {
  MIDI_TEMPLATES,
  type MidiTemplate,
} from "@/utils/midiTemplates";
import type { MidiMapping, MidiNoteMapping } from "@/hooks/useMidi";

/** Kategorie eines Hardware-Templates für UI-Filter. */
export type HardwareTemplateCategory =
  | "pad-grid"        // Launchpad, Push, Maschine, padKONTROL, MPC, BeatStep
  | "controller"      // nanoKONTROL2, X-Touch Mini, MPK Mini (Fader/Knobs zentral)
  | "sequencer"       // BeatStep Pro, Digitakt (Step-Sequencer zentral)
  | "drum-machine";   // Volca Beats, TR-8, Electribe 2

/**
 * Erweitertes Template-Schema mit UI-Metadaten. `mappings`-Felder bleiben
 * identisch zu `MidiTemplate` (kein eigener Storage-Pfad).
 */
export interface HardwareTemplate {
  id: string;
  name: string;
  manufacturer: string;
  category: HardwareTemplateCategory;
  description: string;
  /** Optional: Pfad/URL zu einem Thumbnail. UI darf Emoji-Fallback nutzen. */
  imageUrl?: string;
  /** Optional: Icon-Emoji als visueller Hinweis ohne Image-Download. */
  iconEmoji?: string;
  /** Optionale Hinweise für den User (z.B. "Shift+Pad öffnet zweite Bank"). */
  tips?: string[];
  ccMappings: Omit<MidiMapping, "label">[];
  noteMappings: Omit<MidiNoteMapping, "label">[];
}

/**
 * Metadaten-Overlay pro Template-ID. Lookup-Tabelle damit `midiTemplates.ts`
 * pure bleibt (keine UI-Annotation dort).
 */
interface TemplateMeta {
  category: HardwareTemplateCategory;
  iconEmoji: string;
  tips?: string[];
}

const TEMPLATE_META: Record<string, TemplateMeta> = {
  "launchpad-mk2": {
    category: "pad-grid",
    iconEmoji: "🟦",
    tips: [
      "8×8 Pad-Grid: Reihen 1-8 für Steps, Top-Row für Transport.",
      "User-Mode (Mixer-Mode) sendet CCs 104-111 für Transport-Bindings.",
    ],
  },
  "push-2": {
    category: "pad-grid",
    iconEmoji: "🟪",
    tips: [
      "8 Encoder mappen auf Volume Part 0-7 (CCs 71-78).",
      "Touch-Strip optional als BPM-Modulation via Auto-Learn lernbar.",
    ],
  },
  "mpc-one": {
    category: "pad-grid",
    iconEmoji: "🟧",
    tips: [
      "4×4 Pads im GM-Drum-Layout (Note 36-49).",
      "Q-Link 1-4 = BPM / Master / Vol Part 0 / Vol Part 1.",
    ],
  },
  "maschine-mikro": {
    category: "pad-grid",
    iconEmoji: "🟫",
    tips: [
      "Touch-Strip → BPM via CC 1 (links/rechts) lernbar.",
      "16 Pads gemappt auf GM-Drums; Group-Buttons via Auto-Learn als Pattern-Switch.",
    ],
  },
  "nanokontrol2": {
    category: "controller",
    iconEmoji: "🎚️",
    tips: [
      "9. Slider = Master-Volume (CC 7).",
      "LED-Feedback im Settings-Panel separat aktivieren (PC-Mode benötigt).",
      "Marker-Buttons cyclen Scenes wenn Scene-Mode aktiv ist.",
    ],
  },
  "mpk-mini-mk3": {
    category: "controller",
    iconEmoji: "🎹",
    tips: [
      "25-Key Keyboard für Synth-Spielen + 8 Pads für Drums.",
      "Joystick optional als BPM/Pitch-Bend lernbar.",
    ],
  },
  "behringer-x-touch-mini": {
    category: "controller",
    iconEmoji: "🎛️",
    tips: [
      "8 Encoder = Volume Part 0-7, Fader = Master.",
      "16 Buttons (oben Mute, unten Solo) im MC-Mode.",
    ],
  },
  "korg-padkontrol": {
    category: "pad-grid",
    iconEmoji: "🟥",
    tips: [
      "16 Velocity-Pads im 4×4-Grid.",
      "X/Y-Pad optional als Macro 1/2 lernbar.",
    ],
  },
  "korg-volca-beats": {
    category: "drum-machine",
    iconEmoji: "🥁",
    tips: [
      "Pads sendet auf Channel 10 (GM-Drum-Default).",
      "8 Sound-Edit-Knöpfe = CCs 40-46 (Decay/Pitch/Level pro Track).",
    ],
  },
  "roland-tr-8": {
    category: "drum-machine",
    iconEmoji: "🔴",
    tips: [
      "Drum-Pads auf Ch 10, Part-Levels auf CCs 84-91.",
      "Behringer RD-8 (1:1 Clone) kompatibel mit diesem Template.",
    ],
  },
  "arturia-beatstep-pro": {
    category: "sequencer",
    iconEmoji: "🎯",
    tips: [
      "16 RGB-Pads im Drum-Mode (Ch 10) — beide Reihen triggern dieselben Parts.",
      "16 Encoder: oben Volume, unten Mute (CCs 10-17, 74-81).",
    ],
  },
  "elektron-digitakt": {
    category: "sequencer",
    iconEmoji: "⚙️",
    tips: [
      "8 Sample-Tracks auf eigenen MIDI-Channels (Ch 1-8).",
      "Trigger-Note pro Track = 60 (Default), via Auto-Learn anpassbar.",
    ],
  },
  "korg-electribe-2": {
    category: "drum-machine",
    iconEmoji: "🎚️",
    tips: [
      "16 Pads im 2×8-Grid auf Ch 10 — beide Reihen mappen auf part-0..7.",
      "MIDI Start/Stop (Status 0xFA/0xFC) automatisch als Transport gehandhabt.",
      "E2 + E2S identisch unterstützt.",
    ],
  },
};

const DEFAULT_META: TemplateMeta = {
  category: "controller",
  iconEmoji: "🎹",
};

function decorate(t: MidiTemplate): HardwareTemplate {
  const meta = TEMPLATE_META[t.id] ?? DEFAULT_META;
  return {
    id: t.id,
    name: t.name,
    manufacturer: t.manufacturer,
    category: meta.category,
    description: t.description,
    iconEmoji: meta.iconEmoji,
    tips: meta.tips,
    ccMappings: t.ccMappings,
    noteMappings: t.noteMappings,
  };
}

/** Vollständige Liste aller Hardware-Templates mit UI-Metadaten. */
export const HARDWARE_TEMPLATES: HardwareTemplate[] =
  MIDI_TEMPLATES.map(decorate);

/** Lookup per ID, returnt undefined wenn unbekannt. */
export function getTemplateById(id: string): HardwareTemplate | undefined {
  return HARDWARE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Filtert nach Kategorie. `"all"` als Sonderwert returnt alle Templates
 * (für UI-Filter-Chips).
 */
export function getTemplatesByCategory(
  cat: HardwareTemplateCategory | "all",
): HardwareTemplate[] {
  if (cat === "all") return [...HARDWARE_TEMPLATES];
  return HARDWARE_TEMPLATES.filter((t) => t.category === cat);
}

/** Liste aller in der Library vorkommenden Kategorien (immer in fester Reihenfolge). */
export const ALL_CATEGORIES: HardwareTemplateCategory[] = [
  "pad-grid",
  "controller",
  "sequencer",
  "drum-machine",
];

/** Übersetzungen für Category-Chips. */
export const CATEGORY_LABELS: Record<HardwareTemplateCategory, string> = {
  "pad-grid":     "Pad-Grid",
  "controller":   "Controller",
  "sequencer":    "Sequencer",
  "drum-machine": "Drum-Machine",
};
