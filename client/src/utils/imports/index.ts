/**
 * Synthstudio – imports/index.ts
 *
 * Zentraler Dispatcher für Projekt-Imports.
 * Wählt anhand der Datei-Endung den passenden Parser.
 */
import type { ImportResult } from "./types";
import { ImportError } from "./types";
import { importFlp } from "./flpImport";
import { importAls } from "./alsImport";
import { importElectribe } from "./electribeImport";

export type { ImportResult, ImportedPattern, ImportedPart, ImportedStep } from "./types";
export { ImportError } from "./types";

export async function importProjectFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".flp")) {
    return importFlp(file);
  }
  if (name.endsWith(".als")) {
    return importAls(file);
  }
  if (name.endsWith(".esx") || name.endsWith(".elst") ||
      name.endsWith(".e2spat") || name.endsWith(".e2sallpat")) {
    return importElectribe(file);
  }

  throw new ImportError(
    `Nicht unterstütztes Format: ${file.name}. ` +
    `Unterstützt: .flp (FL Studio), .als (Ableton), .esx/.elst (KORG Electribe).`,
    "unknown",
  );
}

/**
 * Konvertiert ein ImportResult in das interne PatternData-Format.
 * Generiert IDs für Patterns und Parts.
 */
export function importResultToPatterns(result: ImportResult): Array<{
  id: string;
  name: string;
  stepCount: 16 | 32;
  stepResolution: "1/16";
  bpm: number | null;
  parts: Array<{
    id: string;
    name: string;
    sampleName?: string;
    muted: boolean;
    soloed: boolean;
    volume: number;
    pan: number;
    steps: Array<{ active: boolean; velocity?: number; pitch?: number }>;
    fx: unknown;
  }>;
}> {
  const makeId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  return result.patterns.map(p => ({
    id: makeId("pat"),
    name: p.name,
    stepCount: (p.stepCount === 32 ? 32 : 16) as 16 | 32,
    stepResolution: "1/16",
    bpm: p.bpm ?? null,
    parts: p.parts.map(part => ({
      id: makeId("part"),
      name: part.name,
      sampleName: part.sampleName,
      muted: false,
      soloed: false,
      volume: part.volume ?? 0.8,
      pan: part.pan ?? 0,
      steps: part.steps.map(s => ({ active: s.active, velocity: s.velocity ?? 100, pitch: s.pitch ?? 0 })),
      fx: {
        filterEnabled: false, filterType: "lowpass", filterFreq: 8000, filterQ: 1, filterGain: 0,
        distortionEnabled: false, distortionAmount: 50,
        compressorEnabled: false, compressorThreshold: -24, compressorRatio: 4, compressorAttack: 0.003, compressorRelease: 0.25,
        delayEnabled: false, delayTime: 0.25, delayFeedback: 0.3, delayMix: 0.3,
        reverbEnabled: false, reverbDecay: 2.0, reverbMix: 0.3,
        eqEnabled: false, eqLow: 0, eqMid: 0, eqHigh: 0,
      },
    })),
  }));
}
