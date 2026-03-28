/**
 * Synthstudio – Projekt-Templates
 *
 * Vordefinierte Starter-Projekte für verschiedene Musikstile.
 * Jedes Template enthält:
 * - Metadaten (Name, BPM, Takt, Beschreibung)
 * - Platzhalter-Samples (werden beim ersten Laden durch echte Samples ersetzt)
 * - Grundlegende Pattern-Struktur
 *
 * Templates sind rein datenseitig – keine Audio-Engine-Abhängigkeiten.
 * Sie werden im "Neues Projekt"-Dialog angeboten.
 */

import type { Sample } from "./useProjectStore";

// ─── Template-Typen ───────────────────────────────────────────────────────────

export interface PatternStep {
  /** 0-basierter Step-Index (0-15 für 16-Step-Pattern) */
  step: number;
  /** Velocity 0-127 */
  velocity: number;
  /** Pitch-Offset in Halbtönen (0 = Standard) */
  pitch?: number;
}

export interface PatternTrack {
  /** Track-ID (entspricht Sample-Slot) */
  id: string;
  /** Anzeigename */
  name: string;
  /** Kategorie für Sample-Zuordnung */
  category: string;
  /** Aktive Steps */
  steps: PatternStep[];
  /** Lautstärke 0-1 */
  volume: number;
  /** Pan -1 (links) bis 1 (rechts) */
  pan: number;
  /** Stummschalten */
  muted: boolean;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  genre: string;
  bpm: number;
  /** Taktart: Zähler */
  timeSignatureNumerator: number;
  /** Taktart: Nenner */
  timeSignatureDenominator: number;
  /** Anzahl Steps pro Pattern */
  stepsPerPattern: number;
  tracks: PatternTrack[];
  /** Platzhalter-Samples (werden durch echte Samples ersetzt) */
  placeholderSamples: Omit<Sample, "path">[];
  /** Farb-Akzent für die UI */
  accentColor: string;
  /** Emoji-Icon */
  icon: string;
}

// ─── Template-Definitionen ────────────────────────────────────────────────────

/**
 * Techno – Minimalistisches 4/4 Techno-Pattern
 * BPM: 135, 16 Steps, typisches Kick-Muster
 */
const TECHNO_TEMPLATE: ProjectTemplate = {
  id: "techno-basic",
  name: "Techno Basic",
  description: "Minimalistisches 4/4 Techno-Pattern mit Kick auf jedem Beat, offener Hi-Hat und Clap auf 2 und 4.",
  genre: "Techno",
  bpm: 135,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  stepsPerPattern: 16,
  accentColor: "#ef4444",
  icon: "⚡",
  tracks: [
    {
      id: "kick",
      name: "Kick",
      category: "kicks",
      volume: 1.0,
      pan: 0,
      muted: false,
      steps: [
        { step: 0,  velocity: 127 },
        { step: 4,  velocity: 127 },
        { step: 8,  velocity: 127 },
        { step: 12, velocity: 127 },
      ],
    },
    {
      id: "clap",
      name: "Clap",
      category: "claps",
      volume: 0.85,
      pan: 0,
      muted: false,
      steps: [
        { step: 4,  velocity: 110 },
        { step: 12, velocity: 110 },
      ],
    },
    {
      id: "hihat-closed",
      name: "Hi-Hat (closed)",
      category: "hihats",
      volume: 0.7,
      pan: 0.1,
      muted: false,
      steps: [
        { step: 2,  velocity: 80 },
        { step: 6,  velocity: 80 },
        { step: 10, velocity: 80 },
        { step: 14, velocity: 80 },
      ],
    },
    {
      id: "hihat-open",
      name: "Hi-Hat (open)",
      category: "hihats",
      volume: 0.6,
      pan: 0.2,
      muted: false,
      steps: [
        { step: 3,  velocity: 70 },
        { step: 11, velocity: 70 },
      ],
    },
    {
      id: "perc",
      name: "Percussion",
      category: "percussion",
      volume: 0.65,
      pan: -0.1,
      muted: false,
      steps: [
        { step: 7,  velocity: 90 },
        { step: 15, velocity: 75 },
      ],
    },
    {
      id: "fx",
      name: "FX / Riser",
      category: "fx",
      volume: 0.5,
      pan: 0,
      muted: true, // standardmäßig stumm
      steps: [
        { step: 0,  velocity: 60 },
      ],
    },
  ],
  placeholderSamples: [
    { id: "kick",         name: "Kick",          category: "kicks" },
    { id: "clap",         name: "Clap",          category: "claps" },
    { id: "hihat-closed", name: "Hi-Hat Closed", category: "hihats" },
    { id: "hihat-open",   name: "Hi-Hat Open",   category: "hihats" },
    { id: "perc",         name: "Percussion",    category: "percussion" },
    { id: "fx",           name: "FX",            category: "fx" },
  ],
};

/**
 * House – Chicago House Pattern
 * BPM: 125, 16 Steps, 4-on-the-floor Kick, Off-Beat Hi-Hat
 */
const HOUSE_TEMPLATE: ProjectTemplate = {
  id: "house-chicago",
  name: "House Classic",
  description: "Chicago House Pattern mit 4-on-the-floor Kick, Off-Beat Hi-Hat und Snare auf 2 und 4.",
  genre: "House",
  bpm: 125,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  stepsPerPattern: 16,
  accentColor: "#f59e0b",
  icon: "🏠",
  tracks: [
    {
      id: "kick",
      name: "Kick",
      category: "kicks",
      volume: 1.0,
      pan: 0,
      muted: false,
      steps: [
        { step: 0,  velocity: 127 },
        { step: 4,  velocity: 127 },
        { step: 8,  velocity: 127 },
        { step: 12, velocity: 127 },
      ],
    },
    {
      id: "snare",
      name: "Snare",
      category: "snares",
      volume: 0.9,
      pan: 0,
      muted: false,
      steps: [
        { step: 4,  velocity: 115 },
        { step: 12, velocity: 115 },
      ],
    },
    {
      id: "hihat-closed",
      name: "Hi-Hat (closed)",
      category: "hihats",
      volume: 0.65,
      pan: 0.15,
      muted: false,
      steps: [
        { step: 0,  velocity: 70 },
        { step: 2,  velocity: 85 },
        { step: 4,  velocity: 70 },
        { step: 6,  velocity: 85 },
        { step: 8,  velocity: 70 },
        { step: 10, velocity: 85 },
        { step: 12, velocity: 70 },
        { step: 14, velocity: 85 },
      ],
    },
    {
      id: "hihat-open",
      name: "Hi-Hat (open)",
      category: "hihats",
      volume: 0.55,
      pan: 0.2,
      muted: false,
      steps: [
        { step: 6,  velocity: 75 },
        { step: 14, velocity: 75 },
      ],
    },
    {
      id: "clap",
      name: "Clap",
      category: "claps",
      volume: 0.75,
      pan: 0,
      muted: false,
      steps: [
        { step: 4,  velocity: 100 },
        { step: 8,  velocity: 80 },
        { step: 12, velocity: 100 },
      ],
    },
    {
      id: "bass",
      name: "Bass / Sub",
      category: "loops",
      volume: 0.8,
      pan: 0,
      muted: false,
      steps: [
        { step: 0,  velocity: 110 },
        { step: 3,  velocity: 90 },
        { step: 8,  velocity: 110 },
        { step: 11, velocity: 90 },
      ],
    },
  ],
  placeholderSamples: [
    { id: "kick",         name: "Kick",          category: "kicks" },
    { id: "snare",        name: "Snare",         category: "snares" },
    { id: "hihat-closed", name: "Hi-Hat Closed", category: "hihats" },
    { id: "hihat-open",   name: "Hi-Hat Open",   category: "hihats" },
    { id: "clap",         name: "Clap",          category: "claps" },
    { id: "bass",         name: "Bass / Sub",    category: "loops" },
  ],
};

/**
 * Hip-Hop – Boom Bap Pattern
 * BPM: 90, 16 Steps, synkopierter Kick, Snare auf 2 und 4
 */
const HIPHOP_TEMPLATE: ProjectTemplate = {
  id: "hiphop-boombap",
  name: "Hip-Hop Boom Bap",
  description: "Klassisches Boom Bap Pattern mit synkopiertem Kick, Snare auf 2 und 4 und Off-Beat Hi-Hat.",
  genre: "Hip-Hop",
  bpm: 90,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  stepsPerPattern: 16,
  accentColor: "#8b5cf6",
  icon: "🎤",
  tracks: [
    {
      id: "kick",
      name: "Kick",
      category: "kicks",
      volume: 1.0,
      pan: 0,
      muted: false,
      steps: [
        { step: 0,  velocity: 127 },
        { step: 3,  velocity: 100 },
        { step: 6,  velocity: 110 },
        { step: 10, velocity: 100 },
        { step: 14, velocity: 90 },
      ],
    },
    {
      id: "snare",
      name: "Snare",
      category: "snares",
      volume: 0.95,
      pan: 0,
      muted: false,
      steps: [
        { step: 4,  velocity: 120 },
        { step: 12, velocity: 120 },
      ],
    },
    {
      id: "hihat-closed",
      name: "Hi-Hat (closed)",
      category: "hihats",
      volume: 0.6,
      pan: 0.1,
      muted: false,
      steps: [
        { step: 2,  velocity: 75 },
        { step: 6,  velocity: 65 },
        { step: 10, velocity: 75 },
        { step: 14, velocity: 65 },
      ],
    },
    {
      id: "hihat-open",
      name: "Hi-Hat (open)",
      category: "hihats",
      volume: 0.55,
      pan: 0.15,
      muted: false,
      steps: [
        { step: 8,  velocity: 80 },
      ],
    },
    {
      id: "sample-chop",
      name: "Sample Chop",
      category: "loops",
      volume: 0.7,
      pan: 0,
      muted: false,
      steps: [
        { step: 0,  velocity: 100 },
        { step: 5,  velocity: 90 },
        { step: 9,  velocity: 95 },
        { step: 13, velocity: 85 },
      ],
    },
    {
      id: "scratch",
      name: "Scratch / FX",
      category: "fx",
      volume: 0.6,
      pan: -0.2,
      muted: true,
      steps: [
        { step: 7,  velocity: 85 },
        { step: 15, velocity: 75 },
      ],
    },
  ],
  placeholderSamples: [
    { id: "kick",         name: "Kick",          category: "kicks" },
    { id: "snare",        name: "Snare",         category: "snares" },
    { id: "hihat-closed", name: "Hi-Hat Closed", category: "hihats" },
    { id: "hihat-open",   name: "Hi-Hat Open",   category: "hihats" },
    { id: "sample-chop",  name: "Sample Chop",   category: "loops" },
    { id: "scratch",      name: "Scratch / FX",  category: "fx" },
  ],
};

/**
 * Leeres Projekt – Blank Canvas
 */
const BLANK_TEMPLATE: ProjectTemplate = {
  id: "blank",
  name: "Leeres Projekt",
  description: "Leere Leinwand – starte von Grund auf neu.",
  genre: "Alle",
  bpm: 120,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  stepsPerPattern: 16,
  accentColor: "#64748b",
  icon: "🎹",
  tracks: [
    { id: "track-1", name: "Track 1", category: "other", volume: 1.0, pan: 0, muted: false, steps: [] },
    { id: "track-2", name: "Track 2", category: "other", volume: 1.0, pan: 0, muted: false, steps: [] },
    { id: "track-3", name: "Track 3", category: "other", volume: 1.0, pan: 0, muted: false, steps: [] },
    { id: "track-4", name: "Track 4", category: "other", volume: 1.0, pan: 0, muted: false, steps: [] },
  ],
  placeholderSamples: [],
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  BLANK_TEMPLATE,
  TECHNO_TEMPLATE,
  HOUSE_TEMPLATE,
  HIPHOP_TEMPLATE,
];

/**
 * Template nach ID abrufen
 */
export function getTemplateById(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}

/**
 * Template in einen Projekt-State konvertieren
 * (Samples werden als Platzhalter ohne Pfad erstellt)
 */
export function templateToProjectState(template: ProjectTemplate): {
  projectName: string;
  bpm: number;
  samples: Sample[];
  tracks: PatternTrack[];
} {
  return {
    projectName: template.name,
    bpm: template.bpm,
    samples: template.placeholderSamples.map((s) => ({
      ...s,
      path: "", // Platzhalter – wird durch echtes Sample ersetzt
    })),
    tracks: template.tracks,
  };
}
