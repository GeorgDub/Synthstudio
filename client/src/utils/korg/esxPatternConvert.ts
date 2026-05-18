/**
 * Synthstudio – ESX-1 Pattern → Synthstudio-Pattern Konverter (v3.5.0)
 *
 * TASK-237-FOLLOWUP-5-PATTERNS — pure-Logik Bridge zwischen
 * EsxPattern (aus client/src/utils/korg/esxParser.ts) und dem
 * Synthstudio-Import-Format (SynthstudioPatternImport in
 * client/src/utils/electribeImport.ts).
 *
 * Mapping-Strategie:
 *   - 16 ESX-1-Parts → 16 Synthstudio-drum-parts (1:1 partIndex 0..15)
 *   - sampleId/volume/pan/pitch werden als Hardware-Defaults uebernommen,
 *     da die exakten Byte-Offsets im 4280-B Pattern-Block noch nicht
 *     reverse-engineered sind (siehe esxParser.ts:parseEsxPattern Doc).
 *   - Steps: in v3.5 immer inactive — der Caller (KorgBankModal) signalisiert
 *     dem User dass die Step-Daten manuell rekonstruiert werden muessen
 *     wenn sie aus der .esx-Bank uebernommen werden sollen.
 *   - Motion-Sequencer: NICHT geliefert (analog ElectribeMotion-Adapter).
 *
 * Diese Konvertierung ist PURE; sie schreibt KEINE Stores. Der Caller
 * verteilt das Output:
 *   - drumParts        → useDrumMachineStore.setPartSteps/setPartName etc.
 *   - bpm              → useDrumMachineStore.setPatternBpm
 *   - name             → useDrumMachineStore.renamePattern
 *   - automationLanes  → useAutomationStore (v3.5: leer)
 */

import type { EsxPattern } from "./esxParser";

/** Synthstudio-Drum-Part-Slot wie er fuer Pattern-Import benoetigt wird. */
export interface SynthstudioDrumPartImport {
  /** 0..15. */
  partIndex: number;
  /** Original ESX-1 Sample-Slot (informativ — kein Auto-Loading in v3.5). */
  sampleId: number;
  /** Label fuer die UI (z.B. "ESX Drum 1", "ESX Synth 9"). */
  sampleHint: string;
  /** 0..1. */
  volume: number;
  /** -1..+1 (0 = center). */
  pan: number;
  /** Signed semitones. */
  pitchSemitones: number;
  /** Boolean trigger pro Step. */
  steps: boolean[];
  /** 0..127 pro Step. Default 100 wenn nicht extrahierbar. */
  velocities: number[];
}

/** Synthstudio-Pattern-Import wie es der Caller in die Stores faechert. */
export interface SynthstudioPatternImport {
  /** Pattern-Anzeigename. */
  name: string;
  /** BPM. */
  bpm: number;
  /** Pattern-Step-Count (16 oder 32). ESX-1 ist immer 16. */
  stepCount: 16 | 32;
  /** Swing 0..100 (Info — Synthstudio hat eigenes Groove-System). */
  swing: number;
  /** 16 Parts. */
  drumParts: SynthstudioDrumPartImport[];
  /** Automation-Lanes aus Motion-Sequencer. v3.5: immer leer. */
  automationLanes: Array<{
    target: string;
    label: string;
    points: Record<number, number>;
    min: number;
    max: number;
  }>;
}

/** Optionale Konvertier-Optionen. */
export interface ConvertEsxPatternOpts {
  /** Wenn true: Default-Velocity 100 wird auf 0 reduziert wenn step inaktiv. */
  zeroVelocityForInactive?: boolean;
}

/**
 * Liefert ein Sample-Hint-Label fuer eine ESX-1-Part-Position.
 *
 * ESX-1 Part-Layout (User-Manual): 9 Drum, 2 Stretch, 2 Slice, 1 Audio-In,
 * 2 Synth. Wir halten das Mapping konservativ:
 *   0..8  → Drum 1..9
 *   9..10 → Stretch 1..2
 *   11..12 → Slice 1..2
 *   13    → Audio In
 *   14..15 → Synth 1..2
 */
export function esxPartHint(partIndex: number): string {
  if (partIndex < 0 || partIndex >= 16) return `Part ${partIndex + 1}`;
  if (partIndex < 9) return `ESX Drum ${partIndex + 1}`;
  if (partIndex < 11) return `ESX Stretch ${partIndex - 8}`;
  if (partIndex < 13) return `ESX Slice ${partIndex - 10}`;
  if (partIndex === 13) return "ESX Audio-In";
  return `ESX Synth ${partIndex - 13}`;
}

/**
 * Konvertiert ein geparstes ESX-1-Pattern in das Synthstudio-Import-Format.
 *
 * Annahmen:
 *   - StepCount immer 16 (Hardware-Spec). Falls esxPattern.lengthSteps > 16:
 *     wir klampen auf 32 (Synthstudio's Maximum) und uebernehmen die ersten N.
 *   - Volume 0..127 → 0..1, Pan 0..127 (64=center) → -1..+1.
 *   - Sample-Id wird informativ uebernommen (kein Auto-Load der Slots).
 *
 * @param esxPattern  Geparsetes Pattern aus parseEsxPattern.
 * @param opts        Konvertier-Optionen.
 * @returns           Pattern im Synthstudio-Import-Format.
 */
export function convertEsxPatternToSynthstudio(
  esxPattern: EsxPattern,
  opts: ConvertEsxPatternOpts = {},
): SynthstudioPatternImport {
  const stepCount: 16 | 32 = esxPattern.lengthSteps > 16 ? 32 : 16;
  const sourceSteps = Math.min(esxPattern.parts[0]?.steps.length ?? 0, stepCount);

  const drumParts: SynthstudioDrumPartImport[] = esxPattern.parts.map((part) => {
    const steps = new Array<boolean>(stepCount).fill(false);
    const velocities = new Array<number>(stepCount).fill(100);
    for (let s = 0; s < sourceSteps; s++) {
      const ev = part.steps[s];
      steps[s] = ev.active;
      if (ev.active) {
        velocities[s] = ev.velocity > 0 ? ev.velocity : 100;
      } else if (opts.zeroVelocityForInactive) {
        velocities[s] = 0;
      }
    }
    return {
      partIndex: part.partIndex,
      sampleId: part.sampleId,
      sampleHint: esxPartHint(part.partIndex),
      volume: clamp01(part.volume / 127),
      pan: clampPan((part.pan - 64) / 63),
      pitchSemitones: part.pitch,
      steps,
      velocities,
    };
  });

  return {
    name: esxPattern.name || `PATTERN_${esxPattern.index + 1}`,
    bpm: esxPattern.bpm,
    stepCount,
    swing: esxPattern.swing,
    drumParts,
    automationLanes: [], // v3.5: Motion-Daten nicht RE-d
  };
}

/**
 * Convenience: konvertiert ein Array von EsxPatterns als Bulk.
 * Leere Patterns sollten vom Caller bereits ausgefiltert werden — wenn doch
 * eines durchrutscht, wird es als "empty"-Pattern-Import zurueckgegeben.
 */
export function convertEsxPatternsToSynthstudio(
  patterns: ReadonlyArray<EsxPattern>,
  opts: ConvertEsxPatternOpts = {},
): SynthstudioPatternImport[] {
  return patterns.map((p) => convertEsxPatternToSynthstudio(p, opts));
}

// ─── kleine Helper (intern) ───────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}
