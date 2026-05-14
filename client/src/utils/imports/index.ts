/**
 * Synthstudio – imports/index.ts
 *
 * Zentraler Dispatcher für Projekt-Imports.
 * Wählt anhand der Datei-Endung den passenden Parser.
 */
import type { ImportResult, ImportedMelodicPart } from "./types";
import { ImportError } from "./types";
import { importFlp } from "./flpImport";
import { importAls } from "./alsImport";
import { importElectribe } from "./electribeImport";

export type {
  ImportResult,
  ImportedPattern,
  ImportedPart,
  ImportedStep,
  ImportedMelodicPart,
  ImportedMelodicNote,
} from "./types";
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

/**
 * Pro Melodic-Note ein Eintrag mit dem konkreten Drum-Pattern-Part-Ziel
 * (partId aus `importResultToPatterns`) + 16-Step-Grid-Position + Pitch + Velocity.
 *
 * Wird in `routeMelodicPartsToPatterns` erzeugt und vom Konsumenten (App.tsx)
 * 1:1 in `useMelodicPartStore.setNote / setVelocity` eingespeist.
 */
export interface MelodicPartMapping {
  partId: string;
  stepIdx: number;
  pitch: number;
  velocity: number;
}

/**
 * BaseNote-Empfehlung pro partId (FLP-MELODIC-POLISH v1.69). Konsument
 * ruft `useMelodicPartStore.setBaseNote(partId, baseNote)` auf, damit der
 * Piano-Roll-View nach dem Import auf den tatsächlichen Notenbereich
 * zentriert öffnet (sonst Default C4=60).
 */
export interface MelodicBaseNoteMapping {
  partId: string;
  baseNote: number;
}

interface RouteablePart { id: string }
interface RouteablePattern { parts: RouteablePart[] }

/**
 * Phase 2 von FLP-MELODIC-ROUTE (v1.66): nimmt die in Phase 1 extrahierten
 * `ImportedMelodicPart`-Daten und mappt sie auf konkrete Part-IDs der bereits
 * konvertierten Drum-Patterns (Output von `importResultToPatterns`).
 *
 * Mapping-Regel pro Note:
 *   - bar = floor(startStep / stepsPerBar) → out-of-range = ignoriert (Warning)
 *   - stepIdx = round(startStep) - bar * stepsPerBar
 *   - partIdx = sourceChannel % partCount (gleich wie in flpImport.buildPartsForBar)
 *   - partId  = patterns[bar].parts[partIdx].id
 *
 * Konflikt: schreibt zwei Notes auf den gleichen (partId, stepIdx) → die spätere
 * Note überschreibt die frühere; warning wird aufgesammelt.
 *
 * Pure Funktion — kein Side-Effect am Store; der Konsument iteriert über das
 * Ergebnis und ruft `setNote`/`setVelocity` selbst auf.
 */
export function routeMelodicPartsToPatterns(
  melodicParts: ImportedMelodicPart[] | undefined,
  patterns: RouteablePattern[],
  stepsPerBar = 16,
  partCount = 8,
): {
  mappings: MelodicPartMapping[];
  baseNotes: MelodicBaseNoteMapping[];
  warnings: string[];
} {
  const mappings: MelodicPartMapping[] = [];
  const baseNotes: MelodicBaseNoteMapping[] = [];
  const warnings: string[] = [];

  if (!melodicParts || melodicParts.length === 0) return { mappings, baseNotes, warnings };
  if (patterns.length === 0) {
    warnings.push("Melodic-Routing übersprungen: keine Drum-Patterns als Routing-Ziel vorhanden.");
    return { mappings, baseNotes, warnings };
  }

  const occupied = new Map<string, MelodicPartMapping>(); // key = `${partId}#${stepIdx}`
  // FLP-MELODIC-POLISH v1.69: pro partId der einmalige baseNote-Eintrag.
  // Wir nehmen den baseNote des ImportedMelodicPart der die erste Note auf
  // diesen partId schreibt — deterministisch via Insertion-Order.
  const baseNoteByPartId = new Map<string, number>();
  let droppedOutOfRange = 0;
  let conflicts = 0;

  for (const part of melodicParts) {
    const partIdx = ((part.sourceChannel % partCount) + partCount) % partCount;
    for (const note of part.notes) {
      const bar = Math.floor(note.startStep / stepsPerBar);
      if (bar < 0 || bar >= patterns.length) { droppedOutOfRange++; continue; }
      const stepIdx = Math.round(note.startStep) - bar * stepsPerBar;
      if (stepIdx < 0 || stepIdx >= stepsPerBar) { droppedOutOfRange++; continue; }
      const targetPart = patterns[bar].parts[partIdx];
      if (!targetPart) { droppedOutOfRange++; continue; }

      const key = `${targetPart.id}#${stepIdx}`;
      const mapping: MelodicPartMapping = {
        partId: targetPart.id,
        stepIdx,
        pitch: note.pitch,
        velocity: note.velocity,
      };
      if (occupied.has(key)) conflicts++;
      occupied.set(key, mapping);

      if (part.baseNote !== undefined && !baseNoteByPartId.has(targetPart.id)) {
        baseNoteByPartId.set(targetPart.id, part.baseNote);
      }
    }
  }

  for (const m of occupied.values()) mappings.push(m);
  for (const [partId, baseNote] of baseNoteByPartId) {
    baseNotes.push({ partId, baseNote });
  }

  if (droppedOutOfRange > 0) {
    warnings.push(
      `${droppedOutOfRange} melodische Note(n) lagen außerhalb der importierten Bars und wurden verworfen.`,
    );
  }
  if (conflicts > 0) {
    warnings.push(
      `${conflicts} melodische Note(n) auf bereits belegten Steps — letzte Note pro Step gewinnt (16-Step-Grid Limitierung).`,
    );
  }

  return { mappings, baseNotes, warnings };
}
