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
  /**
   * Sample-Slot-Referenz aus dem Quellformat (ESX-1: part.sampleId ==
   * EsxSample.index). Bleibt beim Load-Pfad erhalten, damit der Controller
   * das PCM des passenden Bank-Slots als Blob-URL nachreichen kann.
   */
  sampleId?: number;
  /**
   * Blob-/Object-URL des zugeordneten Samples. Wird vom Import-Controller
   * (Browser) via `attachSampleUrlsToImportResult` nachgereicht — dann spielt
   * der Sequencer die importierten Steps HÖRBAR ab statt stumm.
   */
  sampleUrl?: string;
  /** Liste von Steps (i.d.R. 16 oder 32) */
  steps: ImportedStep[];
  volume?: number; // 0-1
  pan?: number; // -1..+1
  /** v3.287: Mute-Zustand (z.B. aus ESX-Pattern-muteStatus). Default false. */
  muted?: boolean;
  /**
   * v3.293: Per-Part Filter aus dem Quellformat (ESX-1 verifiziert). Wird beim
   * Load auf die ChannelFx des Parts angewandt. Undefined = kein/neutraler Filter.
   */
  filter?: {
    enabled: boolean;
    type: "lowpass" | "highpass" | "bandpass" | "notch";
    freq: number;
    q: number;
  };
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
  /**
   * Position in Steps (1/16). Ohne `patternIndex` ist dies die Position ab
   * Pattern-Start (altes globales Mapping). Mit gesetztem `patternIndex` ist es
   * die Position INNERHALB des Ziel-Patterns (0..stepCount-1).
   */
  startStep: number;
  /**
   * Index des Ziel-Patterns in der flachen Patterns-Liste (vom FLP-Importer
   * gesetzt, wenn jeder Channel pro Pattern aufgelöst wird). Ist er gesetzt,
   * routet `routeMelodicPartsToPatterns` direkt zu patterns[patternIndex] statt
   * `bar = floor(startStep/stepsPerBar)` zu rechnen.
   */
  patternIndex?: number;
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
   * Aufgelöster Ziel-Part-Index in der (dichten) Part-Liste der importierten
   * Patterns. Wird beim FLP-Import gesetzt, wenn jeder genutzte FL-Channel
   * einen eigenen Part bekommt — dann darf der Konsument NICHT mehr
   * `sourceChannel % partCount` rechnen (das gilt nur für das alte
   * 8-Part-Modulo-Mapping). `routeMelodicPartsToPatterns` bevorzugt diesen Wert.
   */
  targetPartIndex?: number;
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
  constructor(
    message: string,
    public format: string
  ) {
    super(message);
    this.name = "ImportError";
  }
}
