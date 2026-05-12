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

export interface ImportResult {
  /** Quell-Format (für UI-Anzeige) */
  sourceFormat: "flp" | "als" | "esx" | "elst";
  /** Original-Dateiname */
  fileName: string;
  /** Globales BPM (falls extrahiert) */
  bpm?: number;
  /** Gefundene Patterns */
  patterns: ImportedPattern[];
  /** Warnungen die der User sehen sollte (z.B. „Wavetable-Synth nicht unterstützt") */
  warnings: string[];
}

export class ImportError extends Error {
  constructor(message: string, public format: string) {
    super(message);
    this.name = "ImportError";
  }
}
