/**
 * Synthstudio – imports/types.ts
 *
 * Gemeinsame Typen für alle Projekt-Import-Konverter.
 * Format-spezifische Parser liefern ein `ImportResult` zurück, das in
 * `useDrumMachineStore.addPatternData()` einspeisbar ist.
 */

export interface ImportedStep {
  active: boolean;
  velocity?: number;
  pitch?: number;
}

export interface ImportedPart {
  name: string;
  /** Optionaler Sample-Name (nicht-bindend, nur Metadata) */
  sampleName?: string;
  /** Liste von Steps (i.d.R. 16 oder 32) */
  steps: ImportedStep[];
  volume?: number; // 0-1
  pan?: number;    // -1..+1
}

export interface ImportedPattern {
  name: string;
  /** 16 oder 32 */
  stepCount: number;
  bpm?: number;
  parts: ImportedPart[];
}

/**
 * Eine Note in einem melodischen Part.
 * Im Gegensatz zu `ImportedStep` (Drum-Grid) trägt sie volle Pitch- + Duration-
 * Information und ist nicht an ein festes Step-Raster gebunden.
 */
export interface ImportedMelodicNote {
  /** Position in Steps (1/16) ab Pattern-Start. Float erlaubt für off-grid Notes. */
  startStep: number;
  /** Länge in Steps (1/16). */
  durationSteps: number;
  /** MIDI-Key (0-127). */
  pitch: number;
  /** MIDI-Velocity (0-127). */
  velocity: number;
}

/**
 * Ein melodischer Part — entspricht einem FL-Channel mit mehreren Tonhöhen
 * (Synth, Sampler mit Notes). Wird vom FLP-Importer ab v1.65 extrahiert,
 * konsumiert (Phase 2): MelodicPart-Routing im ProjectManager.
 */
export interface ImportedMelodicPart {
  /** Quell-Channel-Index aus dem FLP. */
  sourceChannel: number;
  /** Anzeigename (i.d.R. aus Channel-Name oder generisch). */
  name: string;
  /** Notes mit voller Pitch+Duration-Info. */
  notes: ImportedMelodicNote[];
  /**
   * Empfohlener Grundton (MIDI-Pitch). Ab v1.69 vom Importer gesetzt als
   * Median der Note-Pitches, damit der Piano-Roll-View beim Öffnen direkt
   * auf den importierten Tonbereich zentriert. Undefined → Konsument
   * verwendet seinen eigenen Default (C4=60).
   */
  baseNote?: number;
}

export interface ImportResult {
  /** Quell-Format (für UI-Anzeige) */
  sourceFormat: "flp" | "als" | "esx" | "elst";
  /** Original-Dateiname */
  fileName: string;
  /** Globales BPM (falls extrahiert) */
  bpm?: number;
  /** Gefundene Patterns */
  patterns: ImportedPattern[];
  /**
   * Melodische Parts (Channels mit ≥2 verschiedenen Pitches). Ab v1.65
   * extrahiert; aktuell kein Konsument im UI — vorbereitet für Phase 2.
   */
  melodicParts?: ImportedMelodicPart[];
  /** Warnungen die der User sehen sollte (z.B. „Wavetable-Synth nicht unterstützt") */
  warnings: string[];
}

export class ImportError extends Error {
  constructor(message: string, public format: string) {
    super(message);
    this.name = "ImportError";
  }
}
