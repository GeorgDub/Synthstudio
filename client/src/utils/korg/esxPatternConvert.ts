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
import type {
  EsxPatternInput,
  EsxDrumPartInput,
  EsxShortPartInput,
  EsxStepInput,
} from "./esxPatternBuilder";

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

// ─── v3.27.0: Synthstudio → ESX WRITE-side adapter ───────────────────────────

/**
 * Minimal shape of a Synthstudio drum-part for ESX conversion.
 *
 * Kept structurally compatible with `PartData` from
 * `client/src/audio/AudioEngine.ts` but defined here as a structural type so
 * the converter remains pure (no AudioEngine dependency) and easy to test.
 */
export interface SynthstudioPartLike {
  /** 0..1 Synthstudio volume. */
  volume?: number;
  /** -1..+1 (0 = center) Synthstudio pan. */
  pan?: number;
  /** Per-step trigger data. Velocity > 100 → accent in ESX. */
  steps: Array<{ active: boolean; velocity?: number; pitch?: number }>;
}

/** Minimal shape of a Synthstudio pattern for ESX conversion. */
export interface SynthstudioPatternLike {
  /** Pattern display name. Truncated to 8 chars for ESX. */
  name?: string;
  /** Pattern BPM (Hardware-Range 20..300). */
  bpm?: number | null;
  /** Step-count: typically 16 (ESX hardware). */
  stepCount?: number;
  /** Swing 0..100. */
  swing?: number;
  /** Synthstudio drum-parts (up to 16 — extras are dropped). */
  parts: SynthstudioPartLike[];
}

/** Velocity threshold above which a step is treated as accented in ESX. */
export const ESX_ACCENT_VELOCITY_THRESHOLD = 100;

/** Convert Synthstudio volume (0..1) → ESX level (0..127). */
export function synthVolumeToEsxLevel(volume: number | undefined): number {
  if (typeof volume !== "number" || !Number.isFinite(volume)) return 100;
  const clamped = Math.max(0, Math.min(1, volume));
  return Math.round(clamped * 127);
}

/** Convert Synthstudio pan (-1..+1) → ESX pan (0..127, 64 = center). */
export function synthPanToEsxPan(pan: number | undefined): number {
  if (typeof pan !== "number" || !Number.isFinite(pan)) return 64;
  const clamped = Math.max(-1, Math.min(1, pan));
  return Math.round(64 + clamped * 63);
}

/** Convert a single Synthstudio step → ESX step (accent if velocity > threshold). */
export function synthStepToEsx(
  step: { active: boolean; velocity?: number } | undefined,
): EsxStepInput {
  if (!step || !step.active) return { active: false };
  const accent =
    typeof step.velocity === "number" &&
    Number.isFinite(step.velocity) &&
    step.velocity > ESX_ACCENT_VELOCITY_THRESHOLD;
  return { active: true, accent };
}

/**
 * Builds a default 16-step empty `steps` array (used for missing/padding parts).
 */
function emptyEsxSteps(): EsxStepInput[] {
  const out: EsxStepInput[] = new Array(16);
  for (let i = 0; i < 16; i++) out[i] = { active: false };
  return out;
}

/**
 * Convert one Synthstudio part → ESX drum/short part input.
 *
 * Volume/pan are mapped via {@link synthVolumeToEsxLevel} / {@link synthPanToEsxPan}.
 * Pitch is taken from the first step that has a defined `.pitch` field (the
 * ESX has only a single per-part pitch — step-level pitch motion is not
 * encoded in v3.27). Steps are converted via {@link synthStepToEsx}.
 */
export function synthPartToEsxDrumPart(
  part: SynthstudioPartLike | undefined,
): EsxDrumPartInput {
  if (!part) {
    return {
      level: 100,
      pan: 64,
      pitch: 0,
      fxSend: 0,
      steps: emptyEsxSteps(),
    };
  }
  const stepsIn = Array.isArray(part.steps) ? part.steps : [];
  const steps: EsxStepInput[] = new Array(16);
  let pitchSemis = 0;
  for (let s = 0; s < 16; s++) {
    const src = stepsIn[s];
    steps[s] = synthStepToEsx(src);
    if (src && typeof src.pitch === "number" && Number.isFinite(src.pitch) && src.active) {
      // Take the pitch from the first active step that defines it (best-effort).
      if (pitchSemis === 0) pitchSemis = Math.max(-64, Math.min(63, Math.floor(src.pitch)));
    }
  }
  return {
    level: synthVolumeToEsxLevel(part.volume),
    pan: synthPanToEsxPan(part.pan),
    pitch: pitchSemis,
    fxSend: 0,
    steps,
  };
}

/** Same shape mapping, but returned as a short-part (different stride at write time). */
export function synthPartToEsxShortPart(
  part: SynthstudioPartLike | undefined,
): EsxShortPartInput {
  // Structurally identical to drum mapping — the difference is only in the
  // binary encoding (stride / header layout), which the builder handles.
  return synthPartToEsxDrumPart(part);
}

/**
 * Convert a full Synthstudio pattern → ESX pattern input (ready for
 * {@link buildEsxPatternBlock}).
 *
 * Mapping convention (1:1 part-index 0..14):
 *   parts[0..9]   → drumParts[0..9]
 *   parts[10]     → stretchPart
 *   parts[11..14] → shortParts[0..3]
 *   parts[15]     → audioInPart (typically silent in real ESX files)
 *
 * Missing parts get all-default empty values. Extra parts beyond index 15
 * are dropped.
 */
export function convertSynthstudioPatternToEsx(
  pattern: SynthstudioPatternLike,
): EsxPatternInput {
  const safeName = (pattern.name ?? "").slice(0, 8);
  const bpm =
    typeof pattern.bpm === "number" && Number.isFinite(pattern.bpm) ? pattern.bpm : 120;

  const parts = Array.isArray(pattern.parts) ? pattern.parts : [];

  const drumParts: EsxDrumPartInput[] = new Array(10);
  for (let i = 0; i < 10; i++) drumParts[i] = synthPartToEsxDrumPart(parts[i]);

  const stretchPart = synthPartToEsxDrumPart(parts[10]);

  const shortParts: EsxShortPartInput[] = new Array(4);
  for (let i = 0; i < 4; i++) shortParts[i] = synthPartToEsxShortPart(parts[11 + i]);

  // Audio-In = part 15. Defaults to silent if not provided.
  const audioInPart = parts[15] ? synthPartToEsxShortPart(parts[15]) : undefined;

  const stepCount =
    typeof pattern.stepCount === "number" && Number.isFinite(pattern.stepCount)
      ? Math.max(1, Math.min(64, Math.floor(pattern.stepCount)))
      : 16;

  const swing =
    typeof pattern.swing === "number" && Number.isFinite(pattern.swing)
      ? Math.max(0, Math.min(100, Math.floor(pattern.swing)))
      : 0;

  return {
    name: safeName,
    bpm,
    stepLength: stepCount,
    swing,
    drumParts,
    stretchPart,
    shortParts,
    audioInPart,
  };
}
