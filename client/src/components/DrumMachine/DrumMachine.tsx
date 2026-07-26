/**
 * Synthstudio – DrumMachine.tsx  (v2)
 *
 * Vollständige Drum Machine UI:
 * - 9 Kanäle mit eigenen Effekt-Reglern (Filter, EQ, Reverb, Delay, Distortion, Compressor)
 * - Step-Auflösung (1/8, 1/16, 1/32) pro Pattern und pro Kanal
 * - Pattern-BPM-Sync (eigenes BPM pro Pattern oder globales BPM)
 * - 16/32-Step-Grid mit Velocity-Farbkodierung
 * - Velocity-Editing per Drag
 * - Pitch-Popover per Rechtsklick
 * - Sample-Picker per Drag & Drop
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  memo,
} from "react";
import type {
  DrumMachineState,
  DrumMachineActions,
} from "@/store/useDrumMachineStore";
// TASK-247: Playhead aus dem geteilten dm-Render-Pfad gelöst.
import { getPlayheadStep, subscribePlayhead } from "@/store/usePlayheadStore";
import { drumMachinePropsAreEqual } from "./drumMachineMemo";
import type { PartData, ChannelFx, StepResolution } from "@/audio/AudioEngine";
import { AudioEngine } from "@/audio/AudioEngine";
import { PianoRollModal } from "@/components/PianoRoll/PianoRollModal";
import { NoteRepeatPanel } from "@/components/PerformanceMode/NoteRepeatPanel";
import { LooperPanel } from "@/components/PerformanceMode/LooperPanel";
import { TransposeControl } from "@/components/PianoRoll/TransposeControl";
import { PatternMorphPanel } from "@/components/PatternMorph";
import { PatternVariationPanel } from "@/components/PatternVariation";
import { ChordSuggestionPanel } from "@/components/ChordSuggestion/ChordSuggestionPanel";
import { applyVariationToPattern } from "@/store/usePatternVariationStore";
import {
  usePatternVariationsStore,
  createVariationSet,
  updateVariationSlot,
  setActiveVariation,
  findSetContainingPattern,
} from "@/store/usePatternVariationsStore";
import { MacroPanel } from "@/components/Macro/MacroPanel";
import { ArpeggiatorPanel } from "@/components/Arpeggiator/ArpeggiatorPanel";
import { useArpEnabled, setArpEnabled } from "@/store/useArpStore";
import { MuteSoloGroupPanel } from "@/components/MuteSoloGroups/MuteSoloGroupPanel";
import { EnvelopeFollowerPanel } from "./EnvelopeFollowerPanel";
import { useMidiLearn } from "@/hooks/useMidiLearn";
import { toast } from "@/store/useToastStore";
import { useMidiStepRecorderStore } from "@/store/useMidiStepRecorderStore";
// v3.65.0: Pre-Action AutoBackup via globaler Registry.
import { getRegisteredAutoBackup } from "@/utils/autoBackupController";
// v3.66.0: Pattern als PNG/SVG exportieren.
import { PatternImageExportModal } from "@/components/PatternImageExport/PatternImageExportModal";
import { PatternCompareModal } from "@/components/PatternCompare/PatternCompareModal";
import type { PatternForExport } from "@/utils/patternImageExport";
// v3.169.0: Clipboard-Copy/Paste für Patterns (Magic-Header-JSON).
import { serializePattern, parsePattern } from "@/utils/patternSerializer";
// v3.173.0: Pattern → MIDI-Events JSON-Export (Pure-Helper).
import { patternToMidiEvents } from "@/utils/patternMidiExport";
// v3.175.0: Pattern → echtes .mid-Binary (SMF Format 0) Pure-Helper.
import { encodeMidiFile, type MidiNote } from "@/utils/midiFileEncoder";
import { DEFAULT_CHANNEL_FX } from "@/audio/AudioEngine";
import { MixAssistantPanel } from "./MixAssistantPanel";
import type { MixAnalysisInput, MixRecommendation } from "@/utils/mixAnalysis";
import { parseMidiFile } from "../../../../src/utils/midiParser.js";
import {
  parseFlp,
  flpPositionToStep,
  groupNotesByBar,
  calculateBarCount,
} from "@/utils/flpImport";
import {
  parseElectribeBank,
  convertParsedPatternToSynthstudio,
  type ParsedPattern,
  type SynthstudioPatternImport,
} from "@/utils/electribeImport";
import { ElectribePickerModal } from "./ElectribePickerModal";
import { parseE2sBank } from "@/utils/korg/e2sBankReader";
import {
  buildE2sSampleMap,
  summarizeE2sSampleLink,
} from "@/utils/korg/e2sPatternSampleLink";
// v3.297: Pattern ⇄ Gerät (Korg E2/E2S SysEx) direkt im Sequenzer.
import {
  useE2sDeviceStore,
  getE2sDeviceState,
} from "@/store/useE2sDeviceStore";
import { synthstudioPatternToBody } from "@/utils/korg/synthstudioToE2Pattern";
import { e2FilterToImportedFilter } from "@/utils/korg/e2FilterMap";
import type { E2PatternDecoded } from "@/utils/korg/e2Sysex";
import { encodeWavStereo } from "@/audio/wavEncoder";
import {
  requireProFeature,
  PRO_FEATURE_ELECTRIBE_IMPORT,
  PRO_FEATURE_KORG_BANK_WRITE,
  PRO_FEATURE_E2_PATTERN_EXPORT,
} from "@/utils/proFeatures";
import { buildE2PatternFileV2, buildE2AllPatFile } from "@/utils/e2sExport";
import { convertSynthstudioPatternToE2 } from "@/utils/electribePatternConvert";
import { useElectron } from "../../../../electron/useElectron";
import { ProLockBadge } from "@/components/License/ProLockBadge";
import { GranularSynthPanel } from "./GranularSynthPanel";
import { DEFAULT_GRANULAR_PARAMS } from "@/audio/GranularEngine";
import {
  PlayheadChannelStrip,
  PlayheadPolyrhythmVisualizer,
  PlayheadStepNumberRow,
  PlayheadFooterStep,
} from "./PlayheadComponents";
import { SampleSliceEditor } from "@/components/SampleEditor/SampleSliceEditor";
import type { SliceSpec } from "@/utils/sampleSlicing";
import { encodeWavMono } from "@/audio/wavEncoder";
// v3.164.0: Pattern-Mutator Pure-Helpers für Toolbar (shift/double/half/reverse/invert).
import {
  shiftPattern as shiftPatternBoolArr,
  doubleTimePattern,
  halfTimePattern,
  invertPattern,
  reversePattern,
} from "@/utils/drumPatternMutator";
import { variatePattern } from "@/utils/patternProbability";
// v3.168.0: Pattern-Fill-Generator Pure-Helpers für Fill-Toolbar.
import {
  generateFill,
  generateBuildUp,
  generateRoll,
} from "@/utils/patternFillGenerator";
// v3.169.0: Pattern-Humanize Pure-Helper für Humanize-Toolbar.
import {
  humanizePattern,
  type HumanizeIntensity,
} from "@/utils/patternHumanize";
// v3.175.0: Step-Probability Lock-Mode Preview (store-prob-API pending v3.176+).
import { applyLockMode, type LockMode } from "@/utils/patternStepProbability";
// v3.181.0: Pattern-Morph-Interpolate Pure-Helper (smooth Blend zwischen 2 Patterns).
import {
  morphPatterns,
  MORPH_STRATEGY_LABELS,
  type MorphStrategy,
} from "@/utils/patternMorphInterpolate";
// v3.182.0: Pattern-Branch-Variations Pure-Helper (N deterministische Variationen).
import { generateBranchVariations } from "@/utils/patternBranchVariations";
// v3.184.0: Pattern-Stutter Pure-Helper (Stutter Last Half-Action in Mutator-Toolbar).
import { applyHalfStutter } from "@/utils/patternStutter";
// v3.192.0: Pattern-Rhythm-Rotate Pure-Helper (Beat-Shift Buttons in Mutator-Toolbar).
import { rotatePatternByBeats } from "@/utils/patternRhythmRotate";
// v3.197.0: Random Mutation-Chain Pure-Helper (Random-Button in Mutator-Toolbar).
import { randomMutate } from "@/utils/patternMutateRandom";
// v3.183.0: Melodic Sequence Pure-Helper (Rhythm + Scale + Strategy → MIDI-Notes).
import {
  generateMelodicSequence,
  applyMelodicPitches,
  MELODIC_STRATEGY_LABELS,
  type MelodicStrategy,
} from "@/utils/patternMelodicSeq";
// v3.188.0: Pattern-Evolve Pure-Helper (genetic-algorithm-style crossover + mutation).
import { evolvePattern } from "@/utils/patternEvolve";
// v3.189.0: Live Beat-Repeat State-Machine. v3.240: Audio-Engine-Wire über
// beatRepeatReadIndex → __synthstudio_beatrepeat__ Singleton (Read-Remap).
import {
  createBeatRepeatState,
  triggerBeatRepeat,
  releaseBeatRepeat,
  beatRepeatReadIndex,
  type BeatRepeatState,
} from "@/utils/patternBeatRepeatLive";

import { resolveFollowAction } from "@/utils/patternFollowActionChain";

import { inferPatternBpm } from "@/utils/patternBpmInfer";

// v3.193.0: Pattern-Harmonizer (scale-aware Harmonie-Generator).
import { harmonizeNote } from "@/utils/patternHarmonizer";
// v3.196.0: Pattern-Emphasis (Velocity-Akzentuierung per Step).
import {
  generateEmphasis,
  applyEmphasisVelocities,
  EMPHASIS_PRESET_LABELS,
  type EmphasisPreset,
} from "@/utils/patternEmphasis";
// Ausgelagerte Sub-Components
import { FxPanel } from "./FxPanel";
import { ResizableDrumPanel } from "./ResizableDrumPanel";
import { StepInspector } from "./StepInspector";
import { AudioClipLaneList } from "./AudioClipLane";
import {
  ingestLoopSamplerFile,
  type LoopSamplerMode,
} from "@/utils/loopSamplerIngest";
import { EsxImportController } from "@/components/ImportDialog/EsxImportController";
import { importResultToPatterns } from "@/utils/imports";
import type { ImportResult } from "@/utils/imports/types";
import { getPageCount, getPageForStep } from "./drumMachineHelpers";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Props {
  dm: DrumMachineState & DrumMachineActions;
  samples: Array<{ id: string; name: string; path: string; category: string }>;
  isPlaying: boolean;
  bpm: number;
  onPlayStop: () => void;
  onBpmChange: (bpm: number) => void;
  className?: string;
  /**
   * v3.38.0 — External MIDI-Clock-IN active flag. When true AND
   * `externalSyncStatus` indicates an active sync, the BPM-Slider is
   * disabled with a tooltip indicating "BPM extern gesynced".
   */
  externalSyncEnabled?: boolean;
  /**
   * v3.38.0 — Current external sync status. Slider is locked when this is
   * "running" or "tempo-only" (we know the master tempo). For "off"/"lost"
   * the slider remains writable.
   */
  externalSyncStatus?: "off" | "tempo-only" | "running" | "lost";
}

/**
 * v3.38.0 — Pure helper: when is the BPM slider locked by an external MIDI
 * clock master? Exported so tests can assert behaviour without rendering.
 */
export function isBpmExternallyLocked(
  enabled: boolean | undefined,
  status: "off" | "tempo-only" | "running" | "lost" | undefined
): boolean {
  if (!enabled) return false;
  return status === "running" || status === "tempo-only";
}

// ─── v3.161: Pattern-Density-Berechnung über alle Parts ────────────────────────
import {
  categorizeDensity,
  type DensityCategory,
} from "@/utils/patternDensityAnalyzer";
import { analyzePatternBank } from "@/utils/patternBankDensity";
import {
  computePatternComplexity,
  categorizeComplexity,
  type ComplexityCategory,
} from "@/utils/patternComplexity";
// v3.195: Pattern-Fitness-Score Badge (interestingness-Heuristik).
import {
  computeFitnessScore,
  type FitnessScoreResult,
} from "@/utils/patternFitnessScore";
// v3.201: Pattern-Row Pulse-Count Badge — Burst-Detection via Sliding-Window
// auf OR-aggregierten Steps (alle Parts kombiniert).
import { detectDensityPulses } from "@/utils/patternDensityPulse";
// v3.203: Pattern-Row Mini-Heatmap — sparse 2D-Density-Viz pro Pattern.
import { buildHeatmap, findHotspot } from "@/utils/patternDensityHeatmap";
// v3.205: Pattern-Row Similarity-Badge ("vs current active pattern").
import { patternSimilarity } from "@/utils/patternSequenceCorrelation";
// v3.207: Pattern-Row Complexity-Badge — Shannon-Entropy (Bit + Bigram).
import { complexityIndex } from "@/utils/patternEntropy";
// v3.209: Pattern-Row Tension-Badge — Off-Beat + Velocity-Variance + Syncopation.
import { computeTension } from "@/utils/patternTension";
// v3.212: Pattern-Row Energy-Curve — Mini-Spark-Line aus computeEnergyCurve.
import { computeEnergyCurve } from "@/utils/patternEnergyCurve";
// v3.214: Pattern-Row Flow-Direction-Badge — detectFlowDirection.
import { detectFlowDirection } from "@/utils/patternFlowDirection";
// v3.216: Pattern-Row Repetition-Badge — computeRepetitionScore.
import { computeRepetitionScore } from "@/utils/patternRepetitionScore";
// v3.218: Pattern-Row Symmetry-Badge — symmetryScore (Palindrome + Mirror-Axis).
import { symmetryScore } from "@/utils/patternSymmetryScore";
// v3.222: Pattern-Row Motion-Badge — Step-to-Step Energy-Vektoren mit
// overall/net/acceleration (Pure-Helper v3.221).
import { computeMotion } from "@/utils/patternMotion";
// v3.223: Pattern-Row Groove-Feel-Badge — Swing/Push/Laidback Klassifikation
// aus aktiven Off-Beat-Steps (Pure-Helper v3.222).
import { perceiveGroove } from "@/utils/patternGroovePerception";
// v3.224: Pattern-Row KickSnare-Style-Badge — backbeat/kick-heavy/snare-heavy/
// broken Klassifikation aus Kick/Snare-Step-Platzierung (Pure-Helper v3.223).
import { analyzeKickSnare } from "@/utils/patternKickSnareDetect";
import { analyzeHihat } from "@/utils/patternHihatDetect";
// v3.227: Pattern-Row Fill/Transition-Badge — detectFillTransitions identifiziert
// Last-Bar-Fills + multi-fill-regions in Step-Patterns (Pure-Helper v3.226).
import { detectFillTransitions } from "@/utils/patternFillTransition";
// v3.228: Pattern-Row Mood-Badge — classifyMood mappt {energy, tension, warmth,
// complexity, flow} auf ein dominantes Mood-Label (Pure-Helper v3.227).
import { classifyMood } from "@/utils/patternMoodVector";
import type { PatternData } from "@/audio/AudioEngine";

// ─── v3.205: Pattern-Flatten-Helper (module-level Cache via Closure) ───────────
// Flacht alle Parts eines Patterns per OR-Aggregation der active-Flags zu einem
// boolean[] ab. Hartes Limit auf 16 Steps (Performance — Pattern-Row-List
// rendert pro Render N Patterns; jeder Pattern fließt durch dieses Helper).
// Pure: gleiches Input → gleiches Output (kein Date.now/Math.random).
function flattenPatternForSimilarity(p: PatternData): boolean[] {
  const n = Math.min(p.stepCount, 16);
  if (n <= 0) return [];
  const flat = new Array<boolean>(n).fill(false);
  for (const part of p.parts) {
    const len = Math.min(part.steps.length, n);
    for (let i = 0; i < len; i++) {
      if (part.steps[i].active) flat[i] = true;
    }
  }
  return flat;
}

function computePatternDensityCategory(pattern: PatternData): DensityCategory {
  let hits = 0;
  let total = 0;
  for (const part of pattern.parts) {
    for (const step of part.steps) {
      total++;
      if (step.active) hits++;
    }
  }
  if (total === 0) return "empty";
  return categorizeDensity(hits / total);
}

// ─── v3.172: Pattern-Complexity-Berechnung über alle Parts ─────────────────────
function computePatternComplexityCategory(
  pattern: PatternData
): ComplexityCategory {
  const score = computePatternComplexity(pattern);
  return categorizeComplexity(score.total);
}

// ─── v3.195: Pattern-Fitness-Berechnung (interestingness-Heuristik) ────────────
function computePatternFitnessLabel(
  pattern: PatternData
): FitnessScoreResult["label"] {
  const result = computeFitnessScore(pattern);
  return result.label;
}

// ─── Pattern-Row mit Right-Click MIDI-Learn (v1.92) ───────────────────────────

interface PatternRowProps {
  /**
   * v3.201: widened from {id,name,bpm} to PatternData — call site (line ~1599)
   * already passes the full PatternData, and the new pulse-count badge needs
   * access to stepCount + parts.steps. Existing consumers only read
   * .id/.name/.bpm, so this is a safe widening.
   */
  pattern: PatternData;
  patternIndex: number;
  /** v3.161: Density-Kategorie für visuelle Hervorhebung (empty/sparse/medium/dense/full). */
  densityCategory?: import("@/utils/patternDensityAnalyzer").DensityCategory;
  /** v3.172: Complexity-Kategorie für visuelle Hervorhebung (minimal/simple/balanced/complex/chaotic). */
  complexityCategory?: ComplexityCategory;
  /** v3.195: Fitness-Label für visuelle Hervorhebung (boring/minimal/balanced/interesting/chaotic). */
  fitnessLabel?: FitnessScoreResult["label"];
  isActive: boolean;
  isPlaying: boolean;
  isLiveEditing: boolean;
  showDelete: boolean;
  /** v2.4: ob ein vorheriges Pattern existiert (für Sample-Übernahme-Button). */
  hasPrevPattern: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** v2.4: Sampler vom angegebenen Source-Pattern in dieses übernehmen. */
  onCopySamplesFrom: (sourcePatternId: string, sourceName: string) => void;
  /** v2.4: ID des vorherigen Patterns (für die Quick-Action). */
  prevPatternId: string | null;
  /** v2.5: Alle Patterns für den Picker-Submenu. */
  allPatterns: ReadonlyArray<{ id: string; name: string }>;
  /** v2.8: Drag-Drop Reorder callback (fromIndex, toIndex). */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** v3.66.0: Pattern als PNG/SVG exportieren. */
  onExportImage?: () => void;
  /** v3.91.0: Pattern als Slot A im Compare-Modal öffnen. */
  onCompare?: () => void;
  /** v3.169.0: Pattern als JSON-Envelope ins Clipboard kopieren. */
  onCopy?: () => void;
  /** v3.173.0: Pattern → MIDI-Events als JSON exportieren (Quick-Action). */
  onExportMidiEvents?: () => void;
  /** v3.175.0: Pattern → echtes .mid-Binary (SMF Format 0) exportieren. */
  onExportMidiBinary?: () => void;
  /**
   * v3.205: ID des aktuell aktiven Patterns (zum Vergleich für die
   * Similarity-Badge). Falls null/undefined oder identisch mit pattern.id
   * wird keine Badge gerendert.
   */
  activePatternId?: string | null;
  /**
   * v3.205: Flatten der active-Steps (OR über alle Parts, max 16 Steps) des
   * aktuell aktiven Patterns. Wird vom Parent EINMAL berechnet und an alle
   * Rows weitergereicht — vermeidet O(N) Recompute pro Row.
   */
  activePatternFlat?: boolean[];
  /**
   * v3.231 ext-2: User-Toggle "Analytics-Badges anzeigen". Gated alle
   * analytics-Badges (pulse, heatmap, similarity, entropy, tension,
   * energycurve, flow, repetition, symmetry, motion, groove, kicksnare,
   * hihat, fill, mood). MIDI-Learn-CC-Badge + density/complexity/fitness-
   * Dots bleiben sichtbar. Default true.
   */
  showAnalyticsBadges?: boolean;
}

function PatternRow({
  pattern,
  patternIndex,
  densityCategory,
  complexityCategory,
  fitnessLabel,
  isActive,
  isPlaying,
  isLiveEditing,
  showDelete,
  hasPrevPattern,
  prevPatternId,
  allPatterns,
  onSelect,
  onDuplicate,
  onRemove,
  onCopySamplesFrom,
  onReorder,
  onExportImage,
  onCompare,
  onCopy,
  onExportMidiEvents,
  onExportMidiBinary,
  activePatternId,
  activePatternFlat,
  showAnalyticsBadges = true,
}: PatternRowProps) {
  const isDraft = isLiveEditing && isActive;
  const isLocked = isLiveEditing && isPlaying;
  // v1.92: jede Pattern-Zeile ist via Rechtsklick MIDI-bindbar
  const learn = useMidiLearn({ type: "pattern", patternIndex });
  // v3.201: Pulse-Count über alle Parts kombiniert (OR-Aggregation der Steps).
  // useMemo verhindert Re-Computation pro Render — Recompute nur bei pattern-Change.
  const pulseCount = useMemo(() => {
    const stepCount = pattern.stepCount;
    const flat = new Array<boolean>(stepCount).fill(false);
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        if (part.steps[i].active) flat[i] = true;
      }
    }
    return detectDensityPulses(flat).length;
  }, [pattern]);
  // v3.203: Mini-Heatmap-Daten (sparse) — limited auf 16 parts x 32 steps
  // für SVG-Performance. velocity wird von 0-127 → 0-1 normalisiert,
  // damit sanitizeVelocity nicht alles auf 1 clampt.
  const heatmapData = useMemo(() => {
    const parts = pattern.parts.slice(0, 16).map(p => ({
      partId: p.id,
      partName: p.name,
      steps: p.steps.slice(0, 32).map(s => ({
        active: s.active,
        velocity: typeof s.velocity === "number" ? s.velocity / 127 : undefined,
      })),
    }));
    return buildHeatmap(parts);
  }, [pattern]);
  const heatmapHotspot = useMemo(() => findHotspot(heatmapData), [heatmapData]);
  // v3.205: Similarity zum aktuellen aktiven Pattern (0..1).
  // Berechnet nur wenn aktive Pattern bekannt UND nicht identisch — sonst 0.
  // dep includes activePatternFlat so theme-renders ohne State-Change skippen.
  const similarityToActive = useMemo(() => {
    if (
      !activePatternId ||
      !activePatternFlat ||
      activePatternFlat.length === 0
    )
      return 0;
    if (pattern.id === activePatternId) return 1; // self — wird unten gegated
    const rowFlat = flattenPatternForSimilarity(pattern);
    return patternSimilarity(activePatternFlat, rowFlat);
  }, [pattern, activePatternId, activePatternFlat]);
  // v3.207: Shannon-Entropy basierter Komplexitäts-Index (0..1) über
  // OR-aggregierte Steps aller Parts. Dep [pattern] — Recompute nur bei
  // Pattern-Change, nicht bei Theme/Render.
  const entropy = useMemo(() => {
    const stepCount = pattern.stepCount;
    const flat = new Array<boolean>(stepCount).fill(false);
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        if (part.steps[i].active) flat[i] = true;
      }
    }
    return complexityIndex(flat);
  }, [pattern]);
  // v3.209: Tension-Score (off-beat + velocity-variance + syncopation) auf
  // OR-aggregierten Steps. Velocity: max über alle aktiven Parts an dem Step.
  // 4 = 16th-Note-Grid (typisches Drum-Pattern).
  const tension = useMemo(() => {
    const stepCount = pattern.stepCount;
    const flat: { active: boolean; velocity?: number }[] = new Array(stepCount);
    for (let i = 0; i < stepCount; i++) {
      flat[i] = { active: false };
    }
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        const s = part.steps[i];
        if (!s.active) continue;
        const v = s.velocity;
        if (!flat[i].active) {
          flat[i] = { active: true, velocity: v };
        } else {
          const prev = flat[i].velocity;
          if (typeof v === "number" && (typeof prev !== "number" || v > prev)) {
            flat[i] = { active: true, velocity: v };
          }
        }
      }
    }
    return computeTension(flat, 4);
  }, [pattern]);
  // v3.212: Energy-Curve — Mini-Spark-Line pro Pattern-Row.
  // OR-aggregierte Steps (max velocity wenn mehrere Parts an einem Step aktiv),
  // limit 32 steps. windowSize=4 (typischer 16th-Note-Trailing-Smoother).
  const energyCurve = useMemo(() => {
    const stepCount = Math.min(pattern.stepCount, 32);
    const flat: { active: boolean; velocity?: number }[] = new Array(stepCount);
    for (let i = 0; i < stepCount; i++) {
      flat[i] = { active: false };
    }
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        const s = part.steps[i];
        if (!s.active) continue;
        const v = s.velocity;
        if (!flat[i].active) {
          flat[i] = { active: true, velocity: v };
        } else {
          const prev = flat[i].velocity;
          if (typeof v === "number" && (typeof prev !== "number" || v > prev)) {
            flat[i] = { active: true, velocity: v };
          }
        }
      }
    }
    return computeEnergyCurve(flat, 4);
  }, [pattern]);
  // v3.214: Flow-Direction — grobe Struktur der Step-Aktivitaet entlang der
  // Zeit-Achse (forward/backward/center-out/edges-in/uniform). OR-aggregiert
  // alle Parts auf flat boolean[], limit 32 Steps (analog energyCurve).
  const flowDirection = useMemo(() => {
    const stepCount = Math.min(pattern.stepCount, 32);
    const flat: boolean[] = new Array(stepCount).fill(false);
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        if (part.steps[i].active) flat[i] = true;
      }
    }
    return detectFlowDirection(flat);
  }, [pattern]);
  // v3.216: Repetition-Score — selbst-aehnliche Sub-Patterns innerhalb der
  // OR-aggregierten Step-Sequenz. Limit 32 Steps (analog flowDirection /
  // energyCurve). Badge zeigt nur an wenn Score > 0.4 (strong repetition).
  const repetition = useMemo(() => {
    const stepCount = Math.min(pattern.stepCount, 32);
    const flat: boolean[] = new Array(stepCount).fill(false);
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        if (part.steps[i].active) flat[i] = true;
      }
    }
    return computeRepetitionScore(flat);
  }, [pattern]);
  // v3.218: Symmetry-Score — Palindrome- + Mirror-Axis-Detection auf der
  // OR-aggregierten Step-Sequenz. Limit 32 Steps (analog repetition /
  // flowDirection / energyCurve). Badge zeigt isPalindrome ODER
  // halfMirrorScore > 0.7 (deutliche Spiegel-Symmetrie).
  const symmetry = useMemo(() => {
    const stepCount = Math.min(pattern.stepCount, 32);
    const flat: boolean[] = new Array(stepCount).fill(false);
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        if (part.steps[i].active) flat[i] = true;
      }
    }
    return symmetryScore(flat);
  }, [pattern]);
  // v3.222: Motion — Step-zu-Step Energie-Vektoren aus OR-aggregierten
  // {active, velocity?}-Steps (max velocity wenn mehrere Parts an einem
  // Step aktiv), limit 32. Badge zeigt nur wenn overallMotion > 0.3.
  const motion = useMemo(() => {
    const stepCount = Math.min(pattern.stepCount, 32);
    const flat: { active: boolean; velocity?: number }[] = new Array(stepCount);
    for (let i = 0; i < stepCount; i++) {
      flat[i] = { active: false };
    }
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        const s = part.steps[i];
        if (!s.active) continue;
        const v = s.velocity;
        if (!flat[i].active) {
          flat[i] = { active: true, velocity: v };
        } else {
          const prev = flat[i].velocity;
          if (typeof v === "number" && (typeof prev !== "number" || v > prev)) {
            flat[i] = { active: true, velocity: v };
          }
        }
      }
    }
    return computeMotion(flat);
  }, [pattern]);
  // v3.223: Groove-Feel — perceiveGroove auf OR-aggregierten Steps
  // (active + velocity; timing existiert nicht im Step-Modell, Helper
  // sanitized undefined → 0). feel ∈ {tight, push, laidback, loose}.
  const groove = useMemo(() => {
    const stepCount = Math.min(pattern.stepCount, 32);
    const flat: { active: boolean; velocity?: number; timing?: number }[] =
      new Array(stepCount);
    for (let i = 0; i < stepCount; i++) {
      flat[i] = { active: false };
    }
    for (const part of pattern.parts) {
      const len = Math.min(part.steps.length, stepCount);
      for (let i = 0; i < len; i++) {
        const s = part.steps[i];
        if (!s.active) continue;
        const v = s.velocity;
        if (!flat[i].active) {
          flat[i] = { active: true, velocity: v };
        } else {
          const prev = flat[i].velocity;
          if (typeof v === "number" && (typeof prev !== "number" || v > prev)) {
            flat[i] = { active: true, velocity: v };
          }
        }
      }
    }
    return perceiveGroove(flat);
  }, [pattern]);
  // v3.224: KickSnare-Style — analyzeKickSnare auf pattern.parts. Liefert
  // groovePattern ∈ {backbeat, kick-heavy, snare-heavy, broken, sparse,
  // unknown}. Badge nur sichtbar wenn ≠ "unknown" und ≠ "sparse"
  // (informativer Mehrwert).
  const kickSnare = useMemo(() => {
    const parts = pattern.parts.map(p => ({
      name: p.name,
      steps: p.steps.map(s => ({ active: s.active })),
    }));
    return analyzeKickSnare(parts);
  }, [pattern]);
  // v3.226: Hihat-Style — analyzeHihat auf pattern.parts. Liefert
  // hatStyle ∈ {off-beat, all-16, all-8, syncopated, sparse, none}.
  // Badge sichtbar wenn hatStyle ≠ "none" (alle anderen Styles informativ).
  const hihat = useMemo(() => {
    const parts = pattern.parts.map(p => ({
      name: p.name,
      steps: p.steps.map(s => ({ active: s.active })),
    }));
    return analyzeHihat(parts);
  }, [pattern]);
  // v3.227: Fill/Transition-Detection — kombiniere alle Parts per OR zu flat
  // boolean[], limit auf 32 Steps (Pattern-Row-List rendert pro Render N Rows).
  // detectFillTransitions liefert { fillRegions, lastBarIsFill, fillIntensity,
  // baselineDensity }. Badge sichtbar wenn lastBarIsFill || fillRegions.length>0.
  const fillTransition = useMemo(() => {
    const maxLen = 32;
    let len = 0;
    for (const p of pattern.parts) {
      if (p.steps.length > len) len = p.steps.length;
    }
    if (len > maxLen) len = maxLen;
    const flat: { active: boolean }[] = new Array(len);
    for (let i = 0; i < len; i++) {
      let active = false;
      for (const p of pattern.parts) {
        if (p.steps[i]?.active) {
          active = true;
          break;
        }
      }
      flat[i] = { active };
    }
    return detectFillTransitions(flat);
  }, [pattern]);
  // v3.228: Mood-Classification — classifyMood auf pattern.parts mapped zu
  // {name, steps:{active,velocity}}. Liefert primary ∈ {calm, energetic,
  // aggressive, tense, playful, minimal, chaotic} + confidence (0..1).
  // Badge sichtbar wenn confidence > 0.2 (kein Mehrwert für Fallback-Werte).
  const mood = useMemo(() => {
    const parts = pattern.parts.map(p => ({
      name: p.name,
      steps: p.steps.map(s => ({ active: s.active, velocity: s.velocity })),
    }));
    return classifyMood(parts);
  }, [pattern]);
  // v2.5: Submenu zum Auswählen welcher Pattern als Source dient
  const [pickerOpen, setPickerOpen] = useState(false);
  // v2.8: Drag-Drop-Reorder State (drop-indicator: above|below|null)
  const [dropIndicator, setDropIndicator] = useState<"above" | "below" | null>(
    null
  );

  return (
    <div
      className="flex items-center group relative"
      // v2.8: Drag-Drop-Reorder. Visual: blauer Strich oberhalb/unterhalb der Zeile
      // beim Drag-Over zeigt wo das Pattern eingefügt wird.
      onDragOver={e => {
        if (
          e.dataTransfer.types.includes("application/x-synthstudio-pattern-row")
        ) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          setDropIndicator(e.clientY < midY ? "above" : "below");
        }
      }}
      onDragLeave={() => setDropIndicator(null)}
      onDrop={e => {
        const raw = e.dataTransfer.getData(
          "application/x-synthstudio-pattern-row"
        );
        if (!raw) return;
        e.preventDefault();
        const fromIndex = parseInt(raw, 10);
        if (isNaN(fromIndex) || fromIndex === patternIndex) {
          setDropIndicator(null);
          return;
        }
        // Drop above N: insert at N (if from>N) or N-1 (if from<N)
        // Drop below N: insert at N+1 (if from>N) or N (if from<N)
        const targetIdx =
          dropIndicator === "below" ? patternIndex + 1 : patternIndex;
        const adjustedTarget =
          fromIndex < targetIdx ? targetIdx - 1 : targetIdx;
        onReorder(fromIndex, adjustedTarget);
        setDropIndicator(null);
      }}
    >
      {dropIndicator === "above" && (
        <div className="absolute left-0 right-0 -top-px h-0.5 bg-accent-secondary z-10 pointer-events-none" />
      )}
      {dropIndicator === "below" && (
        <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent-secondary z-10 pointer-events-none" />
      )}
      {/* v2.8: Drag-Handle für Pattern-Reorder */}
      {!isLocked && (
        <span
          draggable
          onDragStart={e => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(
              "application/x-synthstudio-pattern-row",
              String(patternIndex)
            );
          }}
          className="cursor-grab active:cursor-grabbing px-1 text-text-dim hover:text-text-primary text-[10px] opacity-0 group-hover:opacity-100"
          title="Drag&Drop zum Sortieren"
        >
          ☰
        </span>
      )}
      <button
        onClick={() => {
          if (!isLocked) onSelect();
        }}
        onContextMenu={learn.onContextMenu}
        disabled={isLocked}
        title={`${isLocked ? "Wird abgespielt – während Live-Edit nicht bearbeitbar" : pattern.name}${learn.isMapped ? ` · CC${learn.mappedCC}` : ""} · Rechtsklick: MIDI-Learn`}
        className={[
          "flex-1 text-left px-3 py-1.5 text-xs transition-colors",
          isDraft
            ? "text-accent-primary bg-accent-primary/20 font-semibold"
            : isActive
              ? "text-accent-secondary bg-accent-secondary/20"
              : isLocked
                ? "text-text-dim cursor-not-allowed opacity-50"
                : "text-text-primary hover:bg-bg-panel",
        ].join(" ")}
      >
        {isPlaying && (
          <span
            className="mr-1.5 text-accent-danger"
            title="Wird gerade abgespielt"
          >
            ▶
          </span>
        )}
        {isDraft && (
          <span
            className="mr-1.5 text-accent-primary"
            title="Draft – wird bearbeitet"
          >
            ✏
          </span>
        )}
        {densityCategory && densityCategory !== "empty" && (
          <span
            className={[
              "inline-block w-1.5 h-1.5 rounded-full mr-1.5",
              densityCategory === "sparse" && "bg-accent-success/50",
              densityCategory === "medium" && "bg-accent-secondary",
              densityCategory === "dense" && "bg-accent-danger/70",
              densityCategory === "full" && "bg-accent-danger",
            ]
              .filter(Boolean)
              .join(" ")}
            title={`Pattern-Density: ${densityCategory}`}
            data-testid={`pattern-density-badge-${densityCategory}`}
          />
        )}
        {pattern.name}
        {pattern.bpm !== null && (
          <span className="ml-1 text-[9px] text-text-dim">
            {pattern.bpm} BPM
          </span>
        )}
        {complexityCategory && complexityCategory !== "minimal" && (
          <span
            className={[
              "ml-1 inline-block w-1.5 h-1.5 rounded-full",
              complexityCategory === "simple" && "bg-accent-success/40",
              complexityCategory === "balanced" && "bg-accent-primary",
              complexityCategory === "complex" && "bg-accent-secondary",
              complexityCategory === "chaotic" && "bg-accent-warning",
            ]
              .filter(Boolean)
              .join(" ")}
            title={`Complexity: ${complexityCategory}`}
            data-testid={`pattern-complexity-badge-${complexityCategory}`}
          />
        )}
        {fitnessLabel && fitnessLabel !== "boring" && (
          <span
            className={[
              "ml-1 inline-block w-1.5 h-1.5 rounded-full",
              fitnessLabel === "minimal" && "bg-text-dim/40",
              fitnessLabel === "balanced" && "bg-accent-success",
              fitnessLabel === "interesting" && "bg-accent-primary",
              fitnessLabel === "chaotic" && "bg-accent-warning",
            ]
              .filter(Boolean)
              .join(" ")}
            title={`Fitness: ${fitnessLabel}`}
            data-testid={`pattern-fitness-badge-${fitnessLabel}`}
          />
        )}
        {/* v3.201: Density-Pulse-Count Badge — Bursts hoher Hit-Dichte. */}
        {showAnalyticsBadges && pulseCount > 0 && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-secondary/20 text-accent-secondary"
            title={`${pulseCount} Density-Pulse(s) detected`}
            data-testid={`pattern-row-pulse-${pattern.id}`}
          >
            ~{pulseCount}
          </span>
        )}
        {/* v3.203: Mini-Heatmap-Visualisierung pro Pattern-Row (32x16 SVG). */}
        {showAnalyticsBadges &&
          heatmapData.partCount > 0 &&
          heatmapData.stepCount > 0 && (
            <span
              className="inline-block ml-1 align-middle border border-border-color rounded text-accent-secondary"
              title={`Heatmap: avgDensity=${(heatmapData.avgDensity * 100).toFixed(0)}%, hotspot at part ${heatmapHotspot?.partIndex ?? "-"}`}
              data-testid={`pattern-row-heatmap-${pattern.id}`}
            >
              <svg
                width={32}
                height={16}
                viewBox={`0 0 ${heatmapData.stepCount} ${heatmapData.partCount}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {heatmapData.cells.map((cell, i) => (
                  <rect
                    key={i}
                    x={cell.stepIndex}
                    y={cell.partIndex}
                    width={1}
                    height={1}
                    fill="currentColor"
                    opacity={cell.value}
                  />
                ))}
              </svg>
            </span>
          )}
        {/* v3.205: Similarity-Badge "vs active" — nur wenn nicht self UND >=50%. */}
        {showAnalyticsBadges &&
          pattern.id !== activePatternId &&
          similarityToActive >= 0.5 && (
            <span
              className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-success/20 text-accent-success"
              title={`${Math.round(similarityToActive * 100)}% similar zum aktiven Pattern`}
              data-testid={`pattern-row-similarity-${pattern.id}`}
            >
              ~{Math.round(similarityToActive * 100)}%
            </span>
          )}
        {/* v3.207: Complexity-Badge — Shannon-Entropy (analog pulse-badge). */}
        {showAnalyticsBadges && entropy > 0.3 && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-primary/20 text-accent-primary"
            title={`Komplexität: ${Math.round(entropy * 100)}% (Shannon-Entropy)`}
            data-testid={`pattern-row-entropy-${pattern.id}`}
          >
            H{Math.round(entropy * 100)}
          </span>
        )}
        {/* v3.209: Tension-Badge — Off-Beat + Velocity-Variance + Syncopation. */}
        {showAnalyticsBadges && tension.overallTension > 0.4 && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-danger/20 text-accent-danger"
            title={`Tension: ${Math.round(tension.overallTension * 100)}% (off-beat ${Math.round(tension.offBeatScore * 100)}%, sync ${Math.round(tension.syncopationScore * 100)}%)`}
            data-testid={`pattern-row-tension-${pattern.id}`}
          >
            T{Math.round(tension.overallTension * 100)}
          </span>
        )}
        {/* v3.212: Energy-Curve Spark-Line — Sliding-Window-Energy ueber Step-Achse. */}
        {showAnalyticsBadges && energyCurve.points.length >= 2 && (
          <span
            className="inline-block ml-1 align-middle border border-border-color rounded text-accent-primary"
            title={`Energy: avg=${Math.round(energyCurve.averageEnergy * 100)}% peak@step${energyCurve.peakStepIndex}, trend: ${energyCurve.trend}`}
            data-testid={`pattern-row-energycurve-${pattern.id}`}
          >
            <svg
              width={32}
              height={10}
              viewBox={`0 0 ${energyCurve.points.length} 1`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                points={energyCurve.points
                  .map(p => `${p.stepIndex},${1 - p.energy}`)
                  .join(" ")}
                stroke="currentColor"
                fill="none"
                strokeWidth="0.1"
              />
            </svg>
          </span>
        )}
        {/* v3.214: Flow-Direction-Badge — Pfeil/Icon je nach detectFlowDirection. */}
        {showAnalyticsBadges &&
          flowDirection.direction !== "uniform" &&
          flowDirection.confidence > 0.15 && (
            <span
              className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-bg-elevated text-text-muted"
              title={`Flow: ${flowDirection.direction} (${Math.round(flowDirection.confidence * 100)}% confidence)`}
              data-testid={`pattern-row-flow-${pattern.id}`}
            >
              {flowDirection.direction === "forward"
                ? "→"
                : flowDirection.direction === "backward"
                  ? "←"
                  : flowDirection.direction === "center-out"
                    ? "←·→"
                    : flowDirection.direction === "edges-in"
                      ? "→·←"
                      : ""}
            </span>
          )}
        {/* v3.216: Repetition-Badge — selbst-aehnliche Sub-Patterns (ABAB, AAAA, ...). */}
        {showAnalyticsBadges && repetition.repetitionScore > 0.4 && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-bg-elevated text-text-primary border border-border-color"
            title={`Repetition: ${Math.round(repetition.repetitionScore * 100)}%, ${repetition.uniqueRegions} unique regions`}
            data-testid={`pattern-row-repetition-${pattern.id}`}
          >
            R{Math.round(repetition.repetitionScore * 100)}
          </span>
        )}
        {/* v3.218: Symmetry-Badge — Palindrome (⟷) oder Mirror-Symmetry (◐). */}
        {showAnalyticsBadges &&
          (symmetry.isPalindrome || symmetry.halfMirrorScore > 0.7) && (
            <span
              className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-success/20 text-accent-success"
              title={`Symmetry: palindrome=${Math.round(symmetry.palindromeScore * 100)}%, mirror=${Math.round(symmetry.halfMirrorScore * 100)}%@axis${symmetry.mirrorAxis}`}
              data-testid={`pattern-row-symmetry-${pattern.id}`}
            >
              {symmetry.isPalindrome ? "⟷" : "◐"}
              {Math.round(
                (symmetry.isPalindrome
                  ? symmetry.palindromeScore
                  : symmetry.halfMirrorScore) * 100
              )}
            </span>
          )}
        {/* v3.222: Motion-Badge — Step-zu-Step Energy-Vektoren (Arrow + M-Score). */}
        {showAnalyticsBadges && motion.overallMotion > 0.3 && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-bg-elevated text-text-muted border border-border-color"
            title={`Motion: ${Math.round(motion.overallMotion * 100)}%, net=${motion.netDirection.toFixed(2)}, accel=${motion.acceleration.toFixed(2)}`}
            data-testid={`pattern-row-motion-${pattern.id}`}
          >
            {motion.netDirection > 0.05
              ? "↗"
              : motion.netDirection < -0.05
                ? "↘"
                : "↔"}
            M{Math.round(motion.overallMotion * 100)}
          </span>
        )}
        {/* v3.223: Groove-Feel-Badge — Swing/Push/Laidback aus Off-Beat-Timing.
            Nur sichtbar wenn feel !== "tight" (tight = neutral, kein Mehrwert). */}
        {groove.feel !== "tight" && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-secondary/20 text-accent-secondary"
            title={`Groove: ${groove.feel} (swing ${Math.round(groove.swingPercent)}%, push=${groove.microPushScore.toFixed(2)})`}
            data-testid={`pattern-row-groove-${pattern.id}`}
          >
            {groove.feel === "push"
              ? "⇡"
              : groove.feel === "laidback"
                ? "⇣"
                : "⇋"}{" "}
            {groove.feel.toUpperCase()}
          </span>
        )}
        {/* v3.224: KickSnare-Style-Badge — backbeat / kick-heavy / snare-heavy /
            broken. "sparse" und "unknown" werden ausgeblendet (kein Mehrwert). */}
        {kickSnare.groovePattern !== "unknown" &&
          kickSnare.groovePattern !== "sparse" && (
            <span
              className="ml-1 px-1 py-0.5 rounded text-[9px] bg-bg-elevated text-text-muted border border-border-color"
              title={`Style: ${kickSnare.groovePattern}, kickOnStrong=${Math.round(kickSnare.kickOnStrong * 100)}%, snareOnWeak=${Math.round(kickSnare.snareOnWeak * 100)}%`}
              data-testid={`pattern-row-kicksnare-${pattern.id}`}
            >
              {kickSnare.groovePattern === "backbeat"
                ? "🥁"
                : kickSnare.groovePattern === "kick-heavy"
                  ? "🦶"
                  : kickSnare.groovePattern === "snare-heavy"
                    ? "🥁"
                    : kickSnare.groovePattern === "broken"
                      ? "💥"
                      : ""}
            </span>
          )}
        {/* v3.226: Hihat-Style-Badge — off-beat / all-16 / all-8 / syncopated /
            sparse. "none" wird ausgeblendet (kein Hihat-Part vorhanden). */}
        {hihat.hatStyle !== "none" && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-bg-elevated text-text-muted border border-border-color"
            title={`HH: ${hihat.hatStyle}, consistency=${Math.round(hihat.consistencyScore * 100)}%`}
            data-testid={`pattern-row-hihat-${pattern.id}`}
          >
            {hihat.hatStyle === "all-16"
              ? "⌷⌷⌷⌷"
              : hihat.hatStyle === "all-8"
                ? "⌷⌷"
                : hihat.hatStyle === "off-beat"
                  ? "⌷·⌷·"
                  : hihat.hatStyle === "syncopated"
                    ? "~"
                    : hihat.hatStyle === "sparse"
                      ? "·"
                      : ""}
          </span>
        )}
        {/* v3.227: Fill/Transition-Badge — sichtbar wenn lastBarIsFill (typischer
            Last-Bar-Fill, Anzeige "FILL") oder mehrere fillRegions (Anzeige
            "F<n>"). Tooltip zeigt fillIntensity + baselineDensity. */}
        {(fillTransition.lastBarIsFill ||
          fillTransition.fillRegions.length > 0) && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-success/20 text-accent-success"
            title={`Fill: ${fillTransition.fillRegions.length} region(s), lastBar=${fillTransition.lastBarIsFill}, intensity=${Math.round(fillTransition.fillIntensity * 100)}%`}
            data-testid={`pattern-row-fill-${pattern.id}`}
          >
            {fillTransition.lastBarIsFill
              ? "FILL"
              : `F${fillTransition.fillRegions.length}`}
          </span>
        )}
        {/* v3.228: Mood-Badge — calm / energetic / aggressive / tense / playful /
            minimal / chaotic. Sichtbar wenn confidence > 0.2 (filtert fallback). */}
        {mood.confidence > 0.2 && (
          <span
            className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono bg-accent-primary/20 text-accent-primary"
            title={`Mood: ${mood.primary} (${Math.round(mood.confidence * 100)}% confidence)`}
            data-testid={`pattern-row-mood-${pattern.id}`}
          >
            {mood.primary === "calm"
              ? "🧘"
              : mood.primary === "energetic"
                ? "⚡"
                : mood.primary === "aggressive"
                  ? "💥"
                  : mood.primary === "tense"
                    ? "😬"
                    : mood.primary === "playful"
                      ? "🎯"
                      : mood.primary === "minimal"
                        ? "·"
                        : mood.primary === "chaotic"
                          ? "🌪"
                          : ""}
            {mood.primary.slice(0, 3).toUpperCase()}
          </span>
        )}
        {learn.isMapped && (
          <span className="ml-1.5 text-[9px] font-mono text-accent-secondary">
            CC{learn.mappedCC}
          </span>
        )}
        {isLocked && (
          <span className="ml-1.5 text-[9px] text-text-dim">[gesperrt]</span>
        )}
      </button>
      {/* v2.4 + v2.5: Sampler-Übernahme — Split-Button + Picker-Submenu */}
      {!isLocked && allPatterns.length > 1 && (
        <div className="relative inline-flex opacity-0 group-hover:opacity-100">
          {hasPrevPattern &&
            prevPatternId &&
            (() => {
              const prevPat = allPatterns.find(p => p.id === prevPatternId);
              return (
                <button
                  onClick={() =>
                    onCopySamplesFrom(prevPatternId, prevPat?.name ?? "")
                  }
                  className="px-1.5 py-1.5 text-text-dim hover:text-accent-secondary text-xs"
                  title={`Sampler+FX vom vorherigen Pattern „${prevPat?.name ?? "..."}" übernehmen (Steps bleiben). Tastenkombination: Ctrl+Shift+S`}
                >
                  📥
                </button>
              );
            })()}
          <button
            onClick={() => setPickerOpen(o => !o)}
            className="px-1 py-1.5 text-text-dim hover:text-accent-secondary text-[10px]"
            title="Sampler aus einem beliebigen Pattern übernehmen"
            aria-label="Sampler-Quelle wählen"
          >
            ▾
          </button>
          {pickerOpen && (
            <div
              className="absolute left-0 top-full mt-0.5 bg-bg-elevated border border-border-color rounded shadow-xl z-50 min-w-[180px] py-1"
              onMouseLeave={() => setPickerOpen(false)}
            >
              <div className="px-3 py-1 text-[10px] text-text-dim uppercase tracking-wider border-b border-border-color">
                Sampler übernehmen aus
              </div>
              {allPatterns
                .filter(p => p.id !== pattern.id)
                .map(src => (
                  <button
                    key={src.id}
                    onClick={() => {
                      onCopySamplesFrom(src.id, src.name);
                      setPickerOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-accent-secondary/20 truncate"
                    title={`Sampler+FX von „${src.name}" in „${pattern.name}" übernehmen`}
                  >
                    📥 {src.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      {!isLocked && onExportImage && (
        <button
          onClick={onExportImage}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-primary text-xs opacity-0 group-hover:opacity-100"
          title="Als Bild exportieren (PNG / SVG)"
          data-testid={`pattern-row-export-image-${patternIndex}`}
        >
          🖼
        </button>
      )}
      {/* v3.91.0: Pattern-Compare — öffnet Diff-Modal mit dieser Pattern als Slot A. */}
      {!isLocked && onCompare && allPatterns.length > 1 && (
        <button
          onClick={onCompare}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-secondary text-xs opacity-0 group-hover:opacity-100"
          title="Mit anderem Pattern vergleichen (Diff)"
          data-testid={`pattern-row-compare-${patternIndex}`}
        >
          🔀
        </button>
      )}
      {/* v3.169.0: Pattern als JSON-Envelope ins Clipboard kopieren. */}
      {!isLocked && onCopy && (
        <button
          onClick={onCopy}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-primary text-xs opacity-0 group-hover:opacity-100"
          title="Pattern als JSON ins Clipboard kopieren"
          data-testid={`pattern-copy-${pattern.id}`}
        >
          📋
        </button>
      )}
      {/* v3.173.0: Pattern → MIDI-Events als JSON exportieren (Quick-Action). */}
      {!isLocked && onExportMidiEvents && (
        <button
          type="button"
          onClick={onExportMidiEvents}
          data-testid={`pattern-export-midi-${pattern.id}`}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-secondary text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          title="MIDI-Events exportieren (JSON)"
        >
          🎹
        </button>
      )}
      {/* v3.175.0: Pattern → echtes .mid-Binary (SMF Format 0) für DAW-Import. */}
      {!isLocked && onExportMidiBinary && (
        <button
          type="button"
          onClick={onExportMidiBinary}
          data-testid={`pattern-export-mid-${pattern.id}`}
          className="text-text-dim hover:text-accent-primary text-xs p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          title="MIDI-Datei (.mid) exportieren — echtes Binary für DAWs"
        >
          💾
        </button>
      )}
      {!isLocked && (
        <button
          onClick={onDuplicate}
          className="px-1.5 py-1.5 text-text-dim hover:text-text-primary text-xs opacity-0 group-hover:opacity-100"
          title="Duplizieren"
        >
          ⧉
        </button>
      )}
      {showDelete && !isLocked && !isDraft && (
        <button
          onClick={onRemove}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-danger text-xs opacity-0 group-hover:opacity-100"
          title="Löschen"
        >
          ✕
        </button>
      )}
      {learn.menu}
    </div>
  );
}

// ─── E2-Sample-Bank → Part-Sample-Resolver (v3.272) ───────────────────────────

/**
 * Baut aus einer geparsten .all-Sample-Bank einen Resolver, der eine
 * Geräte-Sample-Nummer (Pattern-Part-Ref +0x08, z.B. 501+) auf eine abspielbare
 * WAV-Blob-URL + Namen abbildet. Encoding via shared wavEncoder; Blob-URLs
 * werden pro Nummer gecacht. Match per OSC_0index (value-based, robust).
 */
/** Resolver + zugrunde liegende Sample-Map (für Link-Diagnose im Import-Toast). */
interface E2sSampleLink {
  resolve: (sampleId: number) => { url: string; name: string } | null;
  /** Geräte-Sample-Nr. → Slot. Für diagnoseE2sLink (nur .has/.keys genutzt). */
  map: ReadonlyMap<number, unknown>;
}

function makeE2sSampleResolver(
  bank: ReturnType<typeof parseE2sBank>
): E2sSampleLink {
  const map = buildE2sSampleMap(bank);
  const cache = new Map<number, { url: string; name: string }>();
  const resolve = (sampleId: number) => {
    const hit = cache.get(sampleId);
    if (hit) return hit;
    const slot = map.get(sampleId);
    if (!slot) return null;
    let wav: ArrayBuffer;
    if (slot.channels === 2) {
      const n = (slot.pcmData.length / 2) | 0;
      const left = new Float32Array(n);
      const right = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        left[i] = slot.pcmData[i * 2];
        right[i] = slot.pcmData[i * 2 + 1];
      }
      wav = encodeWavStereo(left, right, slot.sampleRate);
    } else {
      wav = encodeWavMono(slot.pcmData, slot.sampleRate);
    }
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    const res = { url, name: slot.name || `Sample ${sampleId}` };
    cache.set(sampleId, res);
    return res;
  };
  return { resolve, map };
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

function DrumMachineInner({
  dm,
  samples,
  isPlaying,
  bpm,
  onPlayStop,
  onBpmChange,
  className = "",
  externalSyncEnabled,
  externalSyncStatus,
}: Props) {
  // v3.38.0 — BPM-Slider lock-state when external MIDI Clock-IN sync is active.
  const bpmLocked = isBpmExternallyLocked(
    externalSyncEnabled,
    externalSyncStatus
  );
  const pattern = dm.getActivePattern();
  // Index des aktiven Patterns für Prev/Next-Navigation (−1 falls nicht gefunden).
  const patternNavIndex = dm.patterns.findIndex(
    p => p.id === dm.activePatternId
  );
  // v3.26.0 — Electron-Bridge für E2 Pattern Export
  const electron = useElectron();
  const [showPatternMenu, setShowPatternMenu] = useState(false);
  // v3.181.0: Pattern-Morph-Interpolate State (Target-Pattern, t-Faktor, Strategy).
  const [morphTargetId, setMorphTargetId] = useState<string | null>(null);
  const [morphT, setMorphT] = useState(0.5);
  const [morphStrategy, setMorphStrategy] =
    useState<MorphStrategy>("probability");
  // v3.182.0: Pattern-Branch-Variations — N Variations + Intensity.
  const [branchCount, setBranchCount] = useState(3);
  const [branchIntensity, setBranchIntensity] = useState(0.4);
  // v3.183.0: Melodic Sequence Generator — Strategy-Auswahl für "Generate Preview".
  const [melodicStrategy, setMelodicStrategy] =
    useState<MelodicStrategy>("ascending");
  // v3.188.0: Pattern-Evolve UI-State (Generations + Pop-Size Slider).
  const [evolveGens, setEvolveGens] = useState(2);
  const [evolvePopSize, setEvolvePopSize] = useState(4);
  const [metronomOn, setMetronomOn] = useState(false);
  const [metronomGain, setMetronomGain] = useState(0.5);
  const [metronomAccent, setMetronomAccent] = useState(1.0);
  const [metronomTone, setMetronomTone] = useState(0.5);
  const [metronomBeatsPerBar, setMetronomBeatsPerBar] = useState(4);
  const [metronomOscType, setMetronomOscType] =
    useState<OscillatorType>("sine");
  const [metronomSubdivision, setMetronomSubdivision] = useState<
    "beat" | "eighth" | "sixteenth"
  >("beat");
  const [showMetronomPanel, setShowMetronomPanel] = useState(false);
  const metronomPanelRef = useRef<HTMLDivElement>(null);
  // Arpeggiator-Toolbar (v3.270): kompaktes Cluster neben dem Metronom.
  // TASK-253: nur `enabled` abonnieren — kein DrumMachine-Rerender bei
  // Mode-/Notes-/Octaves-Änderungen (die nur die ArpeggiatorPanel betreffen).
  const arpEnabled = useArpEnabled();
  const [showArpPanel, setShowArpPanel] = useState(false);
  const arpPanelRef = useRef<HTMLDivElement>(null);
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  // v1.86: Right-Click-MIDI-Learn auf BPM + Play/Stop
  const bpmLearn = useMidiLearn({ type: "bpm" });
  const playStopLearn = useMidiLearn({ type: "playStop" });
  const bpmInputRef = useRef<HTMLInputElement>(null);
  const [pianoRollPartId, setPianoRollPartId] = useState<string | null>(null);
  const [abSlotA, setAbSlotA] = useState<string | null>(null);
  const [abSlotB, setAbSlotB] = useState<string | null>(null);
  const [abActive, setAbActive] = useState<"A" | "B">("A");
  // Pattern Variations A/B/C/D
  // Pattern-Variations A/B/C/D: verknüpft mit dem persistierten Store
  // (usePatternVariationsStore) — dieselben Slots wie die Variations-Bar im
  // Patterns-Tab, geteilt + projekt-übergreifend gespeichert (v3.270).
  const { sets: variationSets } = usePatternVariationsStore();
  const [showNoteRepeat, setShowNoteRepeat] = useState(false);
  // v3.97.0: MIDI-Step-Recorder (Logic Pro Step Input Style).
  const stepRec = useMidiStepRecorderStore();
  // Auto-Arm: wenn Recorder aktiv ist UND ein activePart selektiert ist UND
  // dieses sich vom armed Part unterscheidet → armed auf activePart updaten.
  // So kann der User per Click auf einen Channel-Header direkt den Aufnahme-
  // Channel wählen.
  useEffect(() => {
    if (!stepRec.enabled) return;
    if (!dm.activePartId) return;
    if (stepRec.armedPartId === dm.activePartId) return;
    stepRec.setArmedPart(dm.activePartId);
  }, [stepRec.enabled, dm.activePartId, stepRec.armedPartId, stepRec]);
  // Esc disabled den Recorder + resetted Cursor (analog Logic Pro "Stop Step Input").
  useEffect(() => {
    if (!stepRec.enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Nicht resetten wenn ein Modal/Input fokussiert ist — sonst eskaliert das
        // Verhalten unerwartet. Wir prüfen den activeElement.
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        stepRec.setEnabled(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [stepRec.enabled, stepRec]);
  const [showLooper, setShowLooper] = useState(false);
  const [showMorph, setShowMorph] = useState(false);
  const [showVariation, setShowVariation] = useState(false);
  const [showMixAssistant, setShowMixAssistant] = useState(false);
  const [showEnvFollower, setShowEnvFollower] = useState(false);
  // v3.268: selten genutzte Import/Export-Buttons hinter ein aufklappbares
  // "I/O"-Cluster legen (Toolbar beruhigen). Hidden-File-Inputs bleiben immer
  // im DOM (Refs für Drag-&-Drop valide), nur die Buttons werden eingeklappt.
  const [ioExpanded, setIoExpanded] = useState(false);
  const [showMacros, setShowMacros] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showPolyrhythm, setShowPolyrhythm] = useState(false);
  // v3.176.0: Chord-Suggestion-Panel als Floating-Overlay (Toggle via Toolbar-Button).
  const [showChordPanel, setShowChordPanel] = useState(false);
  // v3.40 — 64-Step Page-Switcher: bei stepCount > 16 wird das Grid in 16er-Pages
  // aufgeteilt. State ist lokal (nicht im Store) damit jedes geöffnete Pattern
  // mit Page-0 startet; Auto-Follow während Playback synchronisiert die Page mit
  // currentStep.
  const [currentPatternPage, setCurrentPatternPage] = useState(0);
  const [autoPageFollow, setAutoPageFollow] = useState(true);
  const midiImportRef = useRef<HTMLInputElement>(null);
  const flpImportRef = useRef<HTMLInputElement>(null);
  const electribeImportRef = useRef<HTMLInputElement>(null);
  const sliceImportRef = useRef<HTMLInputElement>(null);
  const [selectedStep, setSelectedStep] = useState<{
    partId: string;
    stepIndex: number;
  } | null>(null);
  const [granularPartId, setGranularPartId] = useState<string | null>(null);
  // TASK-237: nach Bank-Parse haelt der Dialog die Pattern-Liste fuer User-Auswahl.
  const [electribePicker, setElectribePicker] = useState<{
    fileName: string;
    patterns: ParsedPattern[];
    /** v3.272: optionaler Sample-Resolver aus einer mitgeladenen .all-Bank.
     *  sampleId (Geräte-Nr. 501+) → Blob-URL + Name, sonst null. v3.297: bündelt
     *  zusätzlich die Sample-Map für die Link-Diagnose im Import-Toast. */
    sampleLink?: E2sSampleLink;
  } | null>(null);
  // TASK-238 (v2.89): Sample-Slice-Editor-State. channelData ist mono (Kanal 0).
  const [sliceEditor, setSliceEditor] = useState<{
    sampleName: string;
    channelData: Float32Array;
    sampleRate: number;
  } | null>(null);
  // v3.66.0: Pattern-Image-Export-Modal-State.
  const [patternImageExport, setPatternImageExport] =
    useState<PatternForExport | null>(null);
  // v3.91.0: Pattern-Compare-Modal-State. Wenn !== null wird das Modal mit
  // dieser Pattern-ID als Slot A geöffnet; Slot B wird vom Modal selbst gewählt.
  const [compareModalAId, setCompareModalAId] = useState<string | null>(null);

  // MIDI-Import: MIDI-Datei in aktives Pattern übertragen
  /**
   * v2.12: Pure-File-Variante für Drag-Drop und File-Picker.
   * handleMidiImport (file-input ChangeEvent) delegiert an diese Funktion.
   */
  const handleMidiFile = useCallback(
    (file: File) => {
      if (!file || !pattern) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const buffer = ev.target?.result as ArrayBuffer;
          const parsed = parseMidiFile(buffer);
          if (!parsed?.tracks?.length) {
            toast(`Keine Tracks im MIDI-File: ${file.name}`, {
              kind: "warning",
            });
            return;
          }
          const tpqn: number = parsed.ticksPerQuarterNote ?? 480;
          const stepCount = pattern.stepCount;
          // GM Drum Map: MIDI-Note → Part-Index
          const noteToPartIdx: Record<number, number> = {
            36: 0,
            35: 0,
            38: 1,
            40: 1,
            42: 2,
            44: 2,
            46: 3,
            49: 4,
            51: 4,
            41: 5,
            43: 6,
            45: 6,
            75: 7,
            56: 7,
            37: 8,
          };

          // Alle NoteOn-Events aus allen Tracks in absolute Ticks umrechnen
          const noteOns: Array<{
            note: number;
            velocity: number;
            absTick: number;
          }> = [];
          for (const track of parsed.tracks) {
            let abs = 0;
            for (const ev of track) {
              abs += ev.deltaTime ?? 0;
              if (
                ev.type === "noteOn" &&
                ev.note !== undefined &&
                (ev.velocity ?? 0) > 0
              ) {
                noteOns.push({
                  note: ev.note,
                  velocity: ev.velocity ?? 100,
                  absTick: abs,
                });
              }
            }
          }
          if (!noteOns.length) {
            toast(`Keine Notes im MIDI-File: ${file.name}`, {
              kind: "warning",
            });
            return;
          }

          // Normalisierung: Quantize auf 1/16 Steps (tpqn/4 ticks per step)
          const ticksPerStep = tpqn / 4;
          const newSteps: boolean[][] = pattern.parts.map(() =>
            Array(stepCount).fill(false)
          );
          const newVels: number[][] = pattern.parts.map(() =>
            Array(stepCount).fill(100)
          );

          for (const { note, velocity, absTick } of noteOns) {
            const step = Math.round(absTick / ticksPerStep) % stepCount;
            const partIdx = noteToPartIdx[note] ?? note % pattern.parts.length;
            if (partIdx < pattern.parts.length) {
              newSteps[partIdx][step] = true;
              newVels[partIdx][step] = velocity;
            }
          }
          pattern.parts.forEach((part, i) =>
            dm.setPartSteps(part.id, newSteps[i], newVels[i])
          );
          toast(`MIDI importiert: ${file.name} (${noteOns.length} Notes)`, {
            kind: "success",
          });
        } catch (err) {
          console.error("[MIDI Import]", err);
          const msg = err instanceof Error ? err.message : String(err);
          toast(`MIDI-Import fehlgeschlagen: ${msg}`, {
            kind: "error",
            duration: 5000,
          });
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [pattern, dm]
  );

  const handleMidiImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleMidiFile(file);
      e.target.value = "";
    },
    [handleMidiFile]
  );

  /**
   * v3.164.0: Pattern-Mutator-Toolbar.
   * Wendet einen Pure-Helper (boolean[] → boolean[]) auf ALLE Parts des
   * aktiven Patterns gleichzeitig an. Schreibt das Resultat batched via
   * setPartSteps zurueck. Mutator-Output mit abweichender Laenge (z.B.
   * halfTime) wird auf die Step-Anzahl der Part-Steps gepaddet/getrimmt.
   */
  const applyMutator = useCallback(
    (mutator: (p: boolean[]) => boolean[]) => {
      if (!pattern) return;
      // v3.294: Mutator NUR auf den SICHTBAREN Bereich (pattern.stepCount)
      // anwenden. Seit dem nicht-destruktiven Step-Umschalten kann part.steps
      // länger sein als stepCount (ausgeblendete höhere Steps) — ein Fill/Roll
      // muss trotzdem im sichtbaren letzten Drittel landen, nicht in den
      // versteckten Steps. Der ausgeblendete Rest bleibt unverändert erhalten.
      const visible = pattern.stepCount;
      for (const part of pattern.parts) {
        const full = part.steps.map(s => s.active);
        const mutated = mutator(full.slice(0, visible));
        // Länge exakt wie part.steps beibehalten (setPartSteps erwartet das);
        // versteckten Tail (>= visible) unangetastet lassen.
        const newSteps = full.slice();
        for (let i = 0; i < visible; i++) newSteps[i] = mutated[i] ?? false;
        dm.setPartSteps(part.id, newSteps);
      }
    },
    [pattern, dm]
  );

  // v3.205: Active-Pattern-Flatten (max 16 Steps) für Similarity-Badges in
  // PatternRow. EINMAL pro Render der Pattern-Liste berechnet, an alle Rows
  // weitergereicht — vermeidet O(N) Recompute pro Row.
  const activePatternFlat = useMemo(() => {
    const active = dm.patterns.find(p => p.id === dm.activePatternId);
    return active ? flattenPatternForSimilarity(active) : [];
  }, [dm.activePatternId, dm.patterns]);

  // v3.169.0: Pattern-Humanize-Toolbar State + Handler.
  const [humanizeIntensity, setHumanizeIntensity] =
    useState<HumanizeIntensity>("subtle");
  const handleHumanize = useCallback(() => {
    const seed = Date.now();
    applyMutator(p => {
      // humanizePattern liefert HumanizedStep[]. Extrahiere nur die active-Komponente.
      const humanized = humanizePattern(p, {
        intensity: humanizeIntensity,
        seed,
        keepProbability: 0.95,
      });
      return humanized.map(h => h.active);
    });
  }, [applyMutator, humanizeIntensity]);

  // v3.175.0: Step-Probability Lock-Mode Preview.
  // CAVEAT: applyLockMode SETZT probability-Felder auf Steps. Die aktuelle
  // dm.setPartSteps API nimmt nur boolean[] (active-Felder) — Step-Probability
  // wäre eine separate Store-Extension (geplant für v3.176+). Diese Toolbar
  // visualisiert nur das Preset (Ø-Probability + active-Step-Count) per Toast,
  // analog zur v3.174 Distribute-Preview.
  const [lockMode, setLockMode] = useState<LockMode>("all");
  const handleShowLockMode = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!activePattern) return;
    let totalActive = 0;
    let lockedSum = 0;
    for (const part of activePattern.parts) {
      const stepsWithProb = part.steps.map(s => ({ active: s.active }));
      const locked = applyLockMode(stepsWithProb, lockMode);
      for (const l of locked) {
        if (l.active) {
          totalActive++;
          lockedSum += l.probability ?? 1;
        }
      }
    }
    const avgProb = totalActive > 0 ? lockedSum / totalActive : 0;
    toast(
      `Lock "${lockMode}": ${totalActive} aktive Steps, Ø ${Math.round(avgProb * 100)}% probability`,
      { kind: "info", duration: 4000 }
    );
  }, [dm.patterns, dm.activePatternId, lockMode]);

  // v3.179.0: Pattern-BPM-Infer-Action — Density+Syncopation-Heuristik → toast.
  const handleInferBpm = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!activePattern) return;
    const result = inferPatternBpm(activePattern);
    toast(
      `BPM-Vorschlag: ${result.suggestedBpm} (${result.genreHint}, ${Math.round(result.confidence * 100)}% confidence). ${result.reasoning}`,
      { kind: "info", duration: 6000 }
    );
  }, [dm.patterns, dm.activePatternId]);

  // v2.12: Drag-Drop für .mid-Files via globales Event (von ElectronDropZone dispatched).
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file instanceof File) handleMidiFile(file);
    };
    window.addEventListener("midi:fileImport", handler);
    return () => window.removeEventListener("midi:fileImport", handler);
  }, [handleMidiFile]);

  /**
   * FLP-Import: extrahiert ALLE Notes aus dem ersten FL-Pattern und verteilt
   * sie auf mehrere Synthstudio-Patterns falls die Notes über mehrere Bars
   * gehen.
   *
   * Workflow:
   *   - Bar 0 → aktives Pattern überschreiben
   *   - Bar 1..N → neue Patterns via addPatternData()
   *   - Bei mehr als MAX Bars: clamping mit Console-Warn
   */
  const handleFlpImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !pattern) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const buffer = ev.target?.result as ArrayBuffer;
          const parsed = parseFlp(buffer);
          if (!parsed.patterns.length) {
            console.warn("[FLP Import] Keine Patterns im FLP gefunden");
            return;
          }
          const firstPattern = parsed.patterns[0];
          if (!firstPattern.notes.length) {
            console.warn("[FLP Import] Erstes Pattern ist leer");
            return;
          }

          const ppq = parsed.header.ppq;
          const stepCount = pattern.stepCount;
          const partCount = pattern.parts.length;
          const fileName = file.name.replace(/\.flp$/i, "");

          // Pro Bar gruppieren (bar-relative positions). Max 16 Bars um nicht
          // versehentlich aus einem riesigen Projekt 100 Patterns zu erzeugen.
          const MAX_BARS = 16;
          const totalBars = Math.min(
            MAX_BARS,
            calculateBarCount(firstPattern.notes, ppq, stepCount)
          );
          const byBar = groupNotesByBar(firstPattern.notes, ppq, stepCount);

          const buildPattern = (
            barNotes: import("@/utils/flpImport").FlpNote[]
          ) => {
            const steps: boolean[][] = pattern.parts.map(() =>
              Array(stepCount).fill(false)
            );
            const vels: number[][] = pattern.parts.map(() =>
              Array(stepCount).fill(100)
            );
            for (const note of barNotes) {
              const step = flpPositionToStep(note.position, ppq) % stepCount;
              const partIdx = note.channel % partCount;
              steps[partIdx][step] = true;
              vels[partIdx][step] = note.velocity;
            }
            return { steps, vels };
          };

          // Bar 0 → aktives Pattern überschreiben
          const bar0 = byBar.get(0) ?? [];
          const bar0Built = buildPattern(bar0);
          pattern.parts.forEach((part, i) =>
            dm.setPartSteps(part.id, bar0Built.steps[i], bar0Built.vels[i])
          );

          // Bar 1..N → neue Patterns
          const createdPatternIds: string[] = [];
          for (let bar = 1; bar < totalBars; bar++) {
            const barNotes = byBar.get(bar) ?? [];
            const { steps, vels } = buildPattern(barNotes);
            const newParts = pattern.parts.map((p, i) => ({
              ...p,
              steps: p.steps.map((s, idx) => ({
                ...s,
                active: steps[i][idx] ?? false,
                velocity: vels[i][idx] ?? 100,
              })),
            }));
            const newPatternData = {
              ...pattern,
              id: `flp-${Date.now()}-${bar}`,
              name: `${fileName} bar ${bar + 1}`,
              parts: newParts,
            };
            const id = dm.addPatternData(newPatternData);
            createdPatternIds.push(id);
          }

          const totalNotesInRange = Array.from(byBar.entries())
            .filter(([bar]) => bar < totalBars)
            .reduce((sum, [, ns]) => sum + ns.length, 0);
          const fullTotal = firstPattern.notes.length;
          console.log(
            `[FLP Import] ${fullTotal} notes → ${totalBars} bar(s), ${totalNotesInRange} importiert${fullTotal > totalNotesInRange ? ` (${fullTotal - totalNotesInRange} jenseits MAX_BARS=${MAX_BARS} getruncated)` : ""}`
          );
          if (createdPatternIds.length > 0) {
            alert(
              `FLP importiert: ${totalBars} Bars als ${totalBars} Patterns.\nAktuelles Pattern = Bar 1, neue Patterns hinzugefügt: ${createdPatternIds.length}.`
            );
          }
        } catch (err) {
          console.error("[FLP Import]", err);
          alert(
            "FLP-Import fehlgeschlagen. Vermutlich ungültige oder neuere FLP-Version.\n\n" +
              (err as Error).message
          );
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = "";
    },
    [pattern, dm]
  );

  // ── KORG Electribe Pattern-Import (TASK-237 / v2.88) ───────────────────────
  //
  // .e2pattern   → single pattern, sofort importieren
  // .e2sallpat   → bank, zeigt Picker-Dialog mit allen Patterns drin
  //
  // Konvertierung via convertParsedPatternToSynthstudio:
  //   - 16 Electribe-Parts → maximal pattern.parts.length Synthstudio-Drum-Parts
  //   - Steps + Velocities → setPartSteps
  //   - Volume/Pan → setPartVolume/setPartPan
  //   - BPM → setPatternBpm
  //   - Motion-Slots werden derzeit verworfen mit Console-Info — Mapping auf
  //     useAutomationStore braucht App-Level-Wiring (Drum-Part-IDs unbekannt
  //     auf Util-Ebene). Follow-up via App.tsx-Bridge.
  const importElectribePatternIntoActive = useCallback(
    (parsed: ParsedPattern, fileName: string, sampleLink?: E2sSampleLink) => {
      if (!pattern) return;
      const conv: SynthstudioPatternImport =
        convertParsedPatternToSynthstudio(parsed);

      // Pattern-Name + BPM uebernehmen.
      dm.renamePattern(pattern.id, conv.name || pattern.name);
      dm.setPatternBpm(pattern.id, conv.bpm);

      // Per-Part Steps + Volume + Pan (so viele Parts wie im aktiven Pattern existieren).
      const partLimit = Math.min(conv.drumParts.length, pattern.parts.length);
      let linked = 0;
      // v3.297: Sample-Refs aktiver Parts sammeln → aussagekräftige Link-Diagnose.
      const requestedSampleIds: number[] = [];
      for (let i = 0; i < partLimit; i++) {
        const part = pattern.parts[i];
        const src = conv.drumParts[i];
        // Steps duerfen kuerzer/laenger als das aktive Pattern sein — clampen.
        const targetSteps = pattern.stepCount;
        const steps = new Array<boolean>(targetSteps).fill(false);
        const vels = new Array<number>(targetSteps).fill(100);
        const cap = Math.min(targetSteps, src.steps.length);
        for (let s = 0; s < cap; s++) {
          steps[s] = src.steps[s];
          vels[s] = src.velocities[s];
        }
        dm.setPartSteps(part.id, steps, vels);
        dm.setPartVolume(part.id, src.volume);
        dm.setPartPan(part.id, src.pan);

        // v3.272: Sample aus mitgeladener .all-Bank verlinken (Part-Ref +0x08
        // 501+ → OSC_0index). Nur Parts mit aktiven Steps; ohne Treffer bleibt der
        // Part unverändert (kein Mislink, kein Crash) — analog zum ESX-Pfad.
        if (steps.some(a => a) && src.sampleId > 0) {
          requestedSampleIds.push(src.sampleId);
          if (sampleLink) {
            const s = sampleLink.resolve(src.sampleId);
            if (s) {
              dm.setPartSample(part.id, s.url, s.name);
              linked++;
            }
          }
        }
      }

      const motionInfo =
        conv.automationLanes.length > 0
          ? ` + ${conv.automationLanes.length} Motion-Lane(s)`
          : "";
      const sampleInfo = summarizeE2sSampleLink(
        !!sampleLink,
        requestedSampleIds,
        linked,
        sampleLink?.map ?? null
      );
      toast(
        `Electribe importiert: ${fileName} → ${conv.name} (${partLimit}/16 Parts${motionInfo}${sampleInfo.summary})`,
        { kind: "success" }
      );
      if (sampleInfo.hint) {
        toast(sampleInfo.hint, { kind: "warning", duration: 6000 });
      }

      // Motion-Sequencer-Daten als CustomEvent rausreichen — App.tsx bridge
      // entscheidet, ob er sie in useAutomationStore einspeist (braucht Store-Ref).
      if (conv.automationLanes.length > 0) {
        try {
          window.dispatchEvent(
            new CustomEvent("electribe:motion-lanes", {
              detail: { patternId: pattern.id, lanes: conv.automationLanes },
            })
          );
        } catch (err) {
          console.warn("[Electribe Import] CustomEvent dispatch failed", err);
        }
      }
    },
    [pattern, dm]
  );

  // v3.272: Ganze Bank → mehrere NEUE Patterns (statt eines ins aktive Pattern).
  // Jedes Pattern wird zu PatternData gemappt; ist ein Sample-Resolver da, werden
  // Parts mit aktiven Steps per Geräte-Nummer (501+) mit Samples verlinkt.
  const importElectribeBankAsPatterns = useCallback(
    (patterns: ParsedPattern[], fileName: string, sampleLink?: E2sSampleLink) => {
      if (patterns.length === 0) return;
      let totalLinked = 0;
      // v3.297: über ALLE Patterns gesammelte Sample-Refs → Bank-weite Diagnose.
      const requestedSampleIds: number[] = [];
      const patternDatas: PatternData[] = patterns.map(parsed => {
        const conv = convertParsedPatternToSynthstudio(parsed);
        return {
          id: "",
          name: conv.name,
          stepCount: conv.stepCount,
          stepResolution: "1/16" as const,
          bpm: conv.bpm,
          parts: conv.drumParts.map(dp => {
            const active = dp.steps.some(a => a);
            if (active && dp.sampleId > 0) requestedSampleIds.push(dp.sampleId);
            const linked =
              sampleLink && active && dp.sampleId > 0
                ? sampleLink.resolve(dp.sampleId)
                : null;
            if (linked) totalLinked++;
            return {
              id: "",
              name: dp.sampleHint,
              sampleName: linked?.name ?? dp.sampleHint,
              sampleUrl: linked?.url,
              sourceType: "sample" as const,
              muted: false,
              soloed: false,
              volume: dp.volume,
              pan: dp.pan,
              steps: dp.steps.map((act, i) => ({
                active: act,
                velocity: dp.velocities[i] ?? 100,
                pitch: dp.pitchSemitones,
              })),
              fx: { ...DEFAULT_CHANNEL_FX },
            };
          }),
          followAction: { type: "none" as const, barsBeforeSwitch: 1 },
        };
      });
      const ids = dm.addPatternsData(patternDatas);
      const sampleInfo = summarizeE2sSampleLink(
        !!sampleLink,
        requestedSampleIds,
        totalLinked,
        sampleLink?.map ?? null
      );
      toast(
        `Electribe-Bank importiert: ${fileName} → ${ids.length} Pattern(s)${sampleInfo.summary}`,
        { kind: "success", duration: 3500 }
      );
      if (sampleInfo.hint) {
        toast(sampleInfo.hint, { kind: "warning", duration: 6000 });
      }
    },
    [dm]
  );

  // Pure-File-Variante (fuer Drag-Drop + File-Picker). v3.272: optionaler
  // Sample-Resolver aus einer mitgeladenen .all-Bank verlinkt Parts mit Samples.
  const handleElectribeFile = useCallback(
    (file: File, sampleLink?: E2sSampleLink) => {
      if (!pattern) return;
      // TASK-232 (v2.97): Electribe-Import ist ein Pro-Feature.
      if (!requireProFeature(PRO_FEATURE_ELECTRIBE_IMPORT)) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const buffer = ev.target?.result as ArrayBuffer;
          const bank = parseElectribeBank(buffer);
          if (!bank.patterns.length) {
            toast(`Keine Patterns in: ${file.name}`, { kind: "warning" });
            return;
          }
          if (bank.patterns.length === 1) {
            // Single-Pattern → direkt importieren.
            importElectribePatternIntoActive(
              bank.patterns[0],
              file.name,
              sampleLink
            );
          } else {
            // Bank → Picker-Dialog oeffnen.
            setElectribePicker({
              fileName: file.name,
              patterns: bank.patterns,
              sampleLink,
            });
          }
        } catch (err) {
          console.error("[Electribe Import]", err);
          const msg = err instanceof Error ? err.message : String(err);
          toast(`Electribe-Import fehlgeschlagen: ${msg}`, {
            kind: "error",
            duration: 5000,
          });
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [pattern, importElectribePatternIntoActive]
  );

  // v3.272: verarbeitet MEHRERE Dateien — eine Pattern-Bank (.e2sallpat/.e2spat)
  // und optional die zugehörige .all-Sample-Bank. Ist die .all dabei, werden die
  // Pattern-Parts über die Geräte-Sample-Nummer (501+) mit den Samples verlinkt
  // → in der Software abspielbar (analog zum ESX-Import). Geteilt von File-Picker
  // (handleElectribeImport) und Drag-Drop (electribe:filesImport).
  const processElectribeFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const sampleFile = files.find(f => /\.all$/i.test(f.name));
      const patternFile =
        files.find(f => /\.(e2sallpat|e2spat|e2pattern)$/i.test(f.name)) ??
        (sampleFile ? undefined : files[0]);

      let sampleLink: E2sSampleLink | undefined;
      if (sampleFile) {
        try {
          const buf = await sampleFile.arrayBuffer();
          const bank = parseE2sBank(new Uint8Array(buf), sampleFile.name);
          sampleLink = makeE2sSampleResolver(bank);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast(`Sample-Bank "${sampleFile.name}" nicht lesbar: ${msg}`, {
            kind: "warning",
            duration: 4000,
          });
        }
      }

      if (patternFile) {
        handleElectribeFile(patternFile, sampleLink);
      } else if (sampleFile) {
        toast(
          "Nur eine .all-Sample-Bank gewählt — wähle/droppe zusätzlich eine .e2sallpat/.e2spat-Pattern-Datei.",
          { kind: "warning", duration: 5000 }
        );
      }
    },
    [handleElectribeFile]
  );

  const handleElectribeImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      void processElectribeFiles(files);
    },
    [processElectribeFiles]
  );

  // ── Sample-Slicing (TASK-238 / v2.89) ──────────────────────────────────────
  // File-Picker → decodeAudioData → channelData (Kanal 0) → Modal-Open.
  // Kein Electron-Direktzugriff — isomorph ueber Browser-File-API.
  //
  // v3.1.0: handleSliceFile extrahiert als reine File→Modal-Pipeline, damit
  // sowohl der Picker-Pfad (handleSliceImport) als auch der Drag-Drop-Pfad
  // (onReplaceSample in SampleSliceEditor) dieselbe Decode-Logik nutzen.
  const handleSliceFile = useCallback(async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      type AnyWin = typeof window & {
        webkitAudioContext?: typeof AudioContext;
      };
      const AC = window.AudioContext || (window as AnyWin).webkitAudioContext;
      if (!AC) {
        toast("Web-Audio nicht verfuegbar in diesem Browser", {
          kind: "error",
        });
        return;
      }
      const ctx = new AC();
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const channelData = new Float32Array(audioBuffer.getChannelData(0));
        setSliceEditor({
          sampleName: file.name,
          channelData,
          sampleRate: audioBuffer.sampleRate,
        });
      } finally {
        if (typeof ctx.close === "function") {
          try {
            await ctx.close();
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      console.error("[SampleSlicer] decode failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Sample-Decode fehlgeschlagen: ${msg}`, {
        kind: "error",
        duration: 5000,
      });
    }
  }, []);

  const handleSliceImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      await handleSliceFile(file);
    },
    [handleSliceFile]
  );

  // ── Loop-Sampler (pattern-unabhängige Melodie-Loops / Vocal-One-Shots) ───────
  // Reuse des Audio-Track-Systems: die Spur läuft frei über den Transport und
  // ignoriert Pattern-Wechsel. `loopSamplerModeRef` merkt sich den beim
  // Button-Klick gewählten Modus, damit ein einziges File-Input beide Fälle
  // bedient.
  const loopSamplerInputRef = useRef<HTMLInputElement>(null);
  const loopSamplerModeRef = useRef<LoopSamplerMode>("loop");
  const openLoopSamplerPicker = useCallback((mode: LoopSamplerMode) => {
    loopSamplerModeRef.current = mode;
    loopSamplerInputRef.current?.click();
  }, []);

  // ── ESX-Import (Unified-Dialog: konvertieren vs. direkt in Sequenzer) ────────
  const esxImportInputRef = useRef<HTMLInputElement>(null);
  const [esxImportFile, setEsxImportFile] = useState<File | null>(null);
  const handleEsxImportPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      // v3.285: EIN Korg-Import-Button. .esx/.ess → editierbarer Pattern-Import-
      // Dialog. .all (E2S-Bank) kann parseEsxBank nicht → direkt in den Bank/
      // Sample-Editor (KorgBankModal via korg:bank:open).
      if (/\.all$/i.test(file.name)) {
        try {
          window.dispatchEvent(
            new CustomEvent<File>("korg:bank:open", { detail: file })
          );
        } catch {
          /* test-env without CustomEvent */
        }
        return;
      }
      setEsxImportFile(file);
    },
    []
  );
  const handleEsxLoadResult = useCallback(
    (result: ImportResult) => {
      const patterns = importResultToPatterns(result);
      if (patterns.length === 0) return;
      const newIds = dm.addPatternsData(
        patterns as Parameters<typeof dm.addPatternsData>[0]
      );
      // v3.285-FIX: nach dem Import auf das INHALTSREICHSTE importierte Pattern
      // springen (setActivePattern). Vorher blieb der User auf dem alten (leeren)
      // Pattern → wirkte als wären die Steps „nicht geladen". Wahl analog zum
      // FLP-Import (App.tsx): das Pattern mit den meisten aktiven Steps.
      if (newIds.length > 0) {
        let bestIdx = 0;
        let bestActive = -1;
        patterns.forEach((p, i) => {
          const active = p.parts.reduce(
            (a, pt) => a + pt.steps.filter(s => s.active).length,
            0
          );
          if (active > bestActive) {
            bestActive = active;
            bestIdx = i;
          }
        });
        const targetId = newIds[bestIdx] ?? newIds[0];
        if (targetId) dm.setActivePattern(targetId);
      }
    },
    [dm]
  );

  // ── v3.297: Pattern ⇄ Gerät (Korg E2/E2S SysEx) direkt im Sequenzer ─────────
  // Nutzt die bestehende useE2sDeviceStore-Infrastruktur (E2SysexBridge) — die
  // gleiche, die der E2sDevicePanel verwendet. „→ Gerät" schreibt das aktive
  // Pattern in den Edit-Buffer (Current Pattern), „← Gerät" holt es zurück und
  // legt Steps/Volume/Pan/Filter auf die aktiven Parts.
  const e2sDevice = useE2sDeviceStore();

  const handlePushPatternToDevice = useCallback(async () => {
    const active = dm.getActivePattern();
    if (!active) return;
    if (e2sDevice.status !== "connected") {
      toast("Kein Korg E2/E2S verbunden — im E2S-Tab verbinden.", {
        kind: "warning",
        duration: 4000,
      });
      return;
    }
    try {
      const body = synthstudioPatternToBody(active);
      const ok = await e2sDevice.pushCurrent(body);
      toast(
        ok
          ? `Pattern „${active.name}" ans Gerät gesendet (Current Pattern).`
          : `Senden fehlgeschlagen${e2sDevice.error ? ": " + e2sDevice.error : " — läuft der Geräte-Sequencer? (Stop drücken)"}`,
        { kind: ok ? "success" : "error", duration: 4500 }
      );
    } catch (err) {
      toast(
        `Senden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        { kind: "error", duration: 5000 }
      );
    }
  }, [dm, e2sDevice]);

  const handlePullPatternFromDevice = useCallback(async () => {
    const active = dm.getActivePattern();
    if (!active) return;
    if (e2sDevice.status !== "connected") {
      toast("Kein Korg E2/E2S verbunden — im E2S-Tab verbinden.", {
        kind: "warning",
        duration: 4000,
      });
      return;
    }
    try {
      const summary = await e2sDevice.pullCurrent();
      const decoded = getE2sDeviceState().currentDecoded;
      if (!summary || !decoded) {
        toast("Gerät hat kein Pattern geliefert (Timeout?).", {
          kind: "error",
          duration: 4500,
        });
        return;
      }
      applyE2DecodedToActivePattern(decoded);
      toast(`Pattern „${decoded.name || summary.name}" vom Gerät geladen.`, {
        kind: "success",
        duration: 4000,
      });
    } catch (err) {
      toast(
        `Laden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        { kind: "error", duration: 5000 }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dm, e2sDevice]);

  /** Legt ein per SysEx geholtes E2-Pattern auf die Parts des aktiven Patterns. */
  const applyE2DecodedToActivePattern = useCallback(
    (decoded: E2PatternDecoded) => {
      const active = dm.getActivePattern();
      if (!active) return;
      dm.setPatternBpm(active.id, decoded.bpm);
      const limit = Math.min(decoded.parts.length, active.parts.length);
      for (let i = 0; i < limit; i++) {
        const part = active.parts[i];
        const src = decoded.parts[i];
        const target = active.stepCount;
        const steps = new Array<boolean>(target).fill(false);
        const vels = new Array<number>(target).fill(100);
        const cap = Math.min(target, src.steps.length);
        for (let s = 0; s < cap; s++) {
          steps[s] = src.steps[s].active;
          vels[s] = src.steps[s].velocity || 100;
        }
        dm.setPartSteps(part.id, steps, vels);
        dm.setPartVolume(part.id, src.volume);
        dm.setPartPan(part.id, src.pan);
        // Verifizierten Part-Filter (Type/Cutoff/Res) auf die ChannelFx mappen.
        const f = e2FilterToImportedFilter(
          src.filterType,
          src.cutoff,
          src.resonance
        );
        if (f) {
          dm.setPartFx(part.id, {
            filterEnabled: f.enabled,
            filterType: f.type,
            filterFreq: f.freq,
            filterQ: f.q,
          });
        }
      }
    },
    [dm]
  );

  // ESX-Song → Song-Arrangement. DrumMachine kennt den Song-Store nicht;
  // wir bridgen via CustomEvent nach App.tsx (analog electribe:motion-lanes),
  // wo useSongStore.createArrangement + Song-Modus verdrahtet sind.
  const handleEsxLoadSong = useCallback(
    (arrangement: {
      name: string;
      bpm: number;
      slots: Array<{ bank: "A" | "B" | "C" | "D"; repeats: number }>;
    }) => {
      try {
        window.dispatchEvent(
          new CustomEvent("esx:load-song", { detail: arrangement })
        );
      } catch (err) {
        console.warn("[ESX Song] CustomEvent dispatch failed", err);
      }
    },
    []
  );
  const handleLoopSamplerImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const mode = loopSamplerModeRef.current;
      const res = await ingestLoopSamplerFile(file, mode);
      if (res.broken || !res.trackId) {
        toast(res.error ?? "Loop-Sampler konnte nicht geladen werden", {
          kind: "error",
        });
        return;
      }
      const syncSuffix = res.tempoSynced
        ? ` · Tempo-Sync an (${Math.round(res.detectedBpm ?? 0)} BPM → Projekt)`
        : "";
      toast(
        mode === "loop"
          ? `Loop-Sampler „${file.name}" hinzugefügt (läuft pattern-unabhängig)${syncSuffix}`
          : `One-Shot „${file.name}" hinzugefügt`,
        { kind: "success", duration: 4000 }
      );
    },
    []
  );

  const handleSlicesApply = useCallback(
    (slices: Float32Array[], _specs: SliceSpec[]) => {
      const sampleRate = sliceEditor?.sampleRate ?? 44100;
      const baseName = sliceEditor?.sampleName ?? "Slice";

      // v3.266: Direct-Assign — jeden Slice als WAV-Blob-URL encoden und der Reihe
      // nach auf die Drum-Kanäle des aktiven Patterns legen (setPartSample). So
      // sind die Slices sofort sequenzierbar. Überzählige Slices (mehr als Kanäle)
      // gehen zusätzlich an die Performance-Slice-Pads via CustomEvent.
      let assigned = 0;
      const parts = dm.getActivePattern()?.parts ?? [];
      for (let i = 0; i < slices.length && i < parts.length; i++) {
        try {
          const wav = encodeWavMono(slices[i], sampleRate);
          const url = URL.createObjectURL(
            new Blob([wav], { type: "audio/wav" })
          );
          dm.setPartSample(parts[i].id, url, `${baseName} ${i + 1}`);
          assigned++;
        } catch (err) {
          console.warn("[SampleSlicer] slice→part assign failed", err);
        }
      }

      // Slice-Pad-System (Performance-Pads) weiterhin füttern — auch für Slices,
      // die über die Kanal-Anzahl hinausgehen.
      try {
        window.dispatchEvent(
          new CustomEvent("sample-slicer:apply", {
            detail: { sampleName: baseName, sampleRate, slices },
          })
        );
      } catch (err) {
        console.warn("[SampleSlicer] CustomEvent dispatch failed", err);
      }

      const extra = slices.length - assigned;
      toast(
        assigned > 0
          ? `${assigned} Slice(s) auf Drum-Kanäle gelegt${extra > 0 ? ` (+${extra} auf Slice-Pads)` : ""}`
          : `${Math.min(slices.length, 16)} Slice(s) auf Slice-Pads gelegt`,
        { kind: "success", duration: 4000 }
      );
      setSliceEditor(null);
    },
    [sliceEditor, dm]
  );

  // ── v3.169.0: Pattern Clipboard-Copy/Paste ─────────────────────────────────
  // Serialisiert ein PatternData via patternSerializer in einen Magic-Header-
  // JSON-String und legt ihn ins System-Clipboard. Browser-Permission-fail wird
  // freundlich gemeldet (kein Throw).
  const handleCopyPattern = useCallback(async (p: PatternData) => {
    try {
      const json = serializePattern(p);
      await navigator.clipboard.writeText(json);
      toast(`Pattern "${p.name}" kopiert (JSON)`, { kind: "success" });
    } catch (err) {
      console.warn("[Pattern-Copy] failed:", err);
      toast("Copy fehlgeschlagen — Clipboard-Permission?", { kind: "error" });
    }
  }, []);

  // ── v3.173.0: Pattern → MIDI-Events JSON-Export ────────────────────────────
  // patternToMidiEvents liefert eine sortierte Event-Liste (KEIN .mid-Binary).
  // Wir serialisieren als JSON und triggern einen Browser-Download via Blob-URL
  // + anchor-Click. Funktioniert in Web- und Electron-Renderer gleichermassen.
  const handleExportMidiEvents = useCallback((p: PatternData) => {
    try {
      const result = patternToMidiEvents(p);
      const safeName =
        p.name.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 64) || "pattern";
      const filename = `${safeName}.midi-events.json`;
      const json = JSON.stringify(result, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`MIDI-Events exportiert: ${filename}`, { kind: "success" });
    } catch (err) {
      console.warn("[Export-MIDI] failed:", err);
      toast("MIDI-Export fehlgeschlagen", { kind: "error" });
    }
  }, []);

  // ── v3.175.0: Pattern → echtes .mid-Binary (SMF Format 0) ──────────────────
  // Schließt das v3.174-Caveat: patternToMidiEvents liefert nur abstrakte Events,
  // hier mappen wir auf MidiNote (mit channel 9 = GM-Drum) und encodieren via
  // midiFileEncoder zu einem standard-konformen SMF-Binary. Download analog zur
  // JSON-Variante via Blob-URL.
  const handleExportMidiBinary = useCallback((p: PatternData) => {
    try {
      const result = patternToMidiEvents(p);
      // MidiNoteEvent (ohne channel) → MidiNote (mit channel 9 = GM-Drum).
      const notes: MidiNote[] = result.events.map(e => ({
        tickPos: e.tickPos,
        tickDuration: e.tickDuration,
        note: e.note,
        velocity: e.velocity,
        channel: 9,
      }));
      const ppqn = result.ppqn;
      const bin = encodeMidiFile(notes, {
        ppqn,
        bpm: p.bpm ?? 120,
        trackName: p.name,
        timeSignature: { numerator: 4, denominator: 4 },
      });
      const filename = `${p.name.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 64) || "pattern"}.mid`;
      // TS5+ Uint8Array<ArrayBufferLike>: explicit ArrayBuffer-cast für BlobPart.
      const blob = new Blob([bin.buffer as ArrayBuffer], {
        type: "audio/midi",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`MIDI-Datei exportiert: ${filename}`, { kind: "success" });
    } catch (err) {
      console.warn("[Export-MIDI-Binary] failed:", err);
      toast("MIDI-Export fehlgeschlagen", { kind: "error" });
    }
  }, []);

  // Liest den Clipboard-Inhalt, validiert via parsePattern (Magic + Schema
  // strikt), rekonstruiert ein vollwertiges PatternData (mit frischen IDs +
  // Default-FX/Steps damit AudioEngine/Store-Invarianten gewahrt bleiben) und
  // legt es per dm.addPatternData() ans Ende der Pattern-Liste.
  const handlePastePattern = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text.trim().length === 0) {
        toast("Clipboard ist leer", { kind: "warning" });
        return;
      }
      const parsed = parsePattern(text);
      if (!parsed) {
        toast("Clipboard enthält kein gültiges Synthstudio-Pattern", {
          kind: "error",
        });
        return;
      }
      const newId = `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // stepCount ist in PatternData auf 16|32|64 eng-typisiert. Wenn der
      // Clipboard-String einen anderen Step-Count trägt (sollte parsePattern
      // schon ausgrenzen, aber defensiv), runden wir auf den nächsten validen
      // Wert. Sonst nehmen wir den Wert direkt.
      const sc = parsed.stepCount;
      const safeStepCount: 16 | 32 | 64 =
        sc === 16 || sc === 32 || sc === 64
          ? sc
          : sc <= 16
            ? 16
            : sc <= 32
              ? 32
              : 64;
      const newPattern: PatternData = {
        id: newId,
        name: `${parsed.name} (Pasted)`,
        stepCount: safeStepCount,
        stepResolution: "1/16",
        bpm: parsed.bpm,
        parts: parsed.parts.map((pp, i) => ({
          id: `${newId}-p${i}`,
          name: pp.name,
          muted: pp.muted,
          soloed: pp.soloed,
          volume: pp.volume,
          pan: pp.pan,
          steps: pp.steps.map(s =>
            typeof s.velocity === "number"
              ? { active: s.active, velocity: s.velocity }
              : { active: s.active }
          ),
          fx: { ...DEFAULT_CHANNEL_FX },
        })),
      };
      dm.addPatternData(newPattern);
      toast(`Pattern eingefügt: "${newPattern.name}"`, { kind: "success" });
      setShowPatternMenu(false);
    } catch (err) {
      console.warn("[Pattern-Paste] failed:", err);
      toast("Paste fehlgeschlagen", { kind: "error" });
    }
  }, [dm]);

  // v3.181.0: Pattern-Morph anwenden — schreibt morphed boolean[] pro Part zurück.
  const handleApplyMorph = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    const targetPattern = dm.patterns.find(p => p.id === morphTargetId);
    if (!activePattern || !targetPattern) return;
    // Morph each part separately (Part-ID-Match; missing Parts werden uebersprungen).
    const seed = Date.now();
    for (const partA of activePattern.parts) {
      const partB = targetPattern.parts.find(p => p.id === partA.id);
      if (!partB) continue;
      const aSteps = partA.steps.map(s => s.active);
      const bSteps = partB.steps.map(s => s.active);
      const morphed = morphPatterns(aSteps, bSteps, morphT, {
        strategy: morphStrategy,
        seed,
      });
      dm.setPartSteps(partA.id, morphed.slice(0, partA.steps.length));
    }
    toast(`Morph applied: t=${morphT.toFixed(2)} (${morphStrategy})`, {
      kind: "success",
    });
  }, [dm, morphTargetId, morphT, morphStrategy]);

  // v3.182.0: Branch-Variations — erstellt N neue Patterns als branched-Variationen
  // des active Pattern. Union-of-parts wird als Source genutzt; jede Variation kriegt
  // dieselben branched-Steps auf allen Parts (Pragmatic-Approach).
  const handleBranchOut = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!activePattern) return;
    // Union der parts als source.
    const len = activePattern.parts[0]?.steps.length ?? 16;
    const unionSteps = new Array<boolean>(len).fill(false);
    for (const part of activePattern.parts) {
      for (let i = 0; i < Math.min(len, part.steps.length); i++) {
        if (part.steps[i].active) unionSteps[i] = true;
      }
    }
    const variations = generateBranchVariations(unionSteps, {
      count: branchCount,
      baseSeed: Date.now(),
      intensity: branchIntensity,
    });
    // Für jede Variation: erstelle neues Pattern als clone von activePattern.
    for (let vi = 0; vi < variations.length; vi++) {
      const v = variations[vi];
      const newId = `branch-${Date.now()}-${vi}`;
      const newPattern = {
        ...activePattern,
        id: newId,
        name: `${activePattern.name} v${vi + 1}`,
        parts: activePattern.parts.map((p, i) => ({
          ...p,
          id: `${newId}-p${i}`,
          steps: p.steps.map((s, si) => ({
            ...s,
            active: si < v.pattern.length ? v.pattern[si] : false,
          })),
        })),
      };
      dm.addPatternData(newPattern as Parameters<typeof dm.addPatternData>[0]);
    }
    toast(
      `${variations.length} Pattern-Variationen erstellt (intensity ${branchIntensity.toFixed(2)})`,
      { kind: "success" }
    );
  }, [dm, branchCount, branchIntensity]);

  // v3.183.0/v3.242.0: Melodic Sequence — generiert aus dem Rhythmus des aktiven
  // Parts eine melodische Sequenz (minor-natural) und WENDET die Pitches als
  // Halbton-Offsets an (vorher reine Toast/console.log-Vorschau).
  const MELODIC_ROOT_MIDI = 60;
  const handleApplyMelodic = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!activePattern || activePattern.parts.length === 0) return;
    const part =
      activePattern.parts.find(p => p.id === dm.activePartId) ??
      activePattern.parts[0];
    const rhythm = part.steps.map(s => s.active);
    const notes = generateMelodicSequence({
      rhythmPattern: rhythm,
      scale: "minor-natural",
      rootMidi: MELODIC_ROOT_MIDI,
      strategy: melodicStrategy,
      octaveRange: 1,
      seed: Date.now(),
    });
    if (notes.length === 0) {
      toast("Keine aktiven Steps für eine Melodie", { kind: "warning" });
      return;
    }
    const newPitches = applyMelodicPitches(
      part.steps.length,
      notes,
      MELODIC_ROOT_MIDI,
      part.steps.map(s => s.pitch ?? 0)
    );
    dm.setPartSteps(part.id, rhythm, undefined, newPitches);
    toast(`Melodie "${melodicStrategy}": ${notes.length} Pitches angewendet`, {
      kind: "success",
      duration: 2500,
    });
  }, [dm, melodicStrategy]);

  // v3.186.0: Chain-Simulator — fuehrt resolveFollowAction 10x mit "next"-Action
  // aus und zeigt die besuchten Pattern-Namen als Toast. Reine Preview-Hilfe.
  const handleSimulateChain = useCallback(() => {
    if (dm.patterns.length === 0 || !dm.activePatternId) return;
    let state = {
      currentPatternId: dm.activePatternId,
      currentRepeats: 0,
      chainPosition: 0,
    };
    const visited: string[] = [state.currentPatternId];
    // Simulate 10 steps with "next" action as demo
    const action = { type: "next" as const };
    for (let i = 0; i < 10; i++) {
      const res = resolveFollowAction(dm.patterns, action, state, i);
      state = res.nextState;
      state.currentPatternId = res.nextPatternId;
      const p = dm.patterns.find(pp => pp.id === res.nextPatternId);
      visited.push(p?.name ?? res.nextPatternId);
    }
    toast(`Chain-Preview (10 steps, "next"): ${visited.join(" → ")}`, {
      kind: "info",
      duration: 8000,
    });
  }, [dm]);

  // v3.188.0: Pattern-Evolve — genetic-algorithm-style Variationen aus dem
  // aktiven Pattern (Union aller Parts → boolean[]). Generiert pop-size
  // evolved Patterns nach N Generations und legt sie via addPatternData ab.
  const handleEvolve = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!activePattern) return;
    const len = activePattern.parts[0]?.steps.length ?? 16;
    const unionSteps = new Array<boolean>(len).fill(false);
    for (const part of activePattern.parts) {
      for (let i = 0; i < Math.min(len, part.steps.length); i++) {
        if (part.steps[i].active) unionSteps[i] = true;
      }
    }
    const result = evolvePattern(unionSteps, {
      generations: evolveGens,
      populationSize: evolvePopSize,
      seed: Date.now(),
    });
    let created = 0;
    for (let vi = 0; vi < result.population.length; vi++) {
      const evolved = result.population[vi];
      if (!evolved || evolved.length === 0) continue;
      const newId = `evolved-${Date.now()}-${vi}`;
      const newPattern = {
        ...activePattern,
        id: newId,
        name: `${activePattern.name} evo${vi + 1}`,
        parts: activePattern.parts.map((p, i) => ({
          ...p,
          id: `${newId}-p${i}`,
          steps: p.steps.map((s, si) => ({
            ...s,
            active: si < evolved.length ? evolved[si] : false,
          })),
        })),
      };
      dm.addPatternData(newPattern as Parameters<typeof dm.addPatternData>[0]);
      created++;
    }
    toast(
      `Evolution: ${created} Patterns nach ${result.generation} Generations`,
      { kind: "success" }
    );
  }, [dm, evolveGens, evolvePopSize]);

  // v3.189.0: Beat-Repeat-Live — State-Machine. v3.240: am Sequencer verkabelt.
  // Trigger friert ein N-Step-Fenster ab dem aktuellen Playhead-Step ein; die
  // AudioEngine loopt dieses Fenster über das __synthstudio_beatrepeat__-Singleton.
  const [brBufferSteps, setBrBufferSteps] = useState(4);
  const [brState, setBrState] = useState<BeatRepeatState>(() =>
    createBeatRepeatState(4)
  );

  // v3.196.0: Emphasis-Preset-Auswahl fuer Velocity-Akzentuierung Preview.
  const [emphasisPreset, setEmphasisPreset] =
    useState<EmphasisPreset>("natural");

  // Beat-Repeat ↔ AudioEngine Bridge: spiegelt brState in den Singleton-Slot,
  // den _scheduleStep pro Step ausliest. Identität solange !active.
  useEffect(() => {
    (globalThis as Record<string, unknown>)["__synthstudio_beatrepeat__"] = {
      readIndex: (i: number) => beatRepeatReadIndex(brState, i),
    };
    return () => {
      delete (globalThis as Record<string, unknown>)[
        "__synthstudio_beatrepeat__"
      ];
    };
  }, [brState]);

  const handleTriggerBR = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!activePattern) return;
    const len = activePattern.parts[0]?.steps.length ?? 16;
    // Buffer (für State/Anzeige) als Union über Parts ab dem aktuellen Playhead.
    // TASK-247: Playhead imperativ aus dem Store lesen (kein Render-Read).
    const start = getPlayheadStep();
    const unionSteps = new Array<boolean>(len).fill(false);
    for (const part of activePattern.parts) {
      for (let i = 0; i < Math.min(len, part.steps.length); i++) {
        if (part.steps[i].active) unionSteps[i] = true;
      }
    }
    const fresh = createBeatRepeatState(brBufferSteps);
    setBrState(triggerBeatRepeat(fresh, unionSteps, start));
    toast(`Beat-Repeat: ${brBufferSteps}-Step-Fenster ab Step ${start + 1}`, {
      kind: "info",
      duration: 1500,
    });
  }, [dm.patterns, dm.activePatternId, brBufferSteps]);

  const handleReleaseBR = useCallback(() => {
    setBrState(s => releaseBeatRepeat(s));
    toast("Beat-Repeat: released", { kind: "info", duration: 1500 });
  }, []);

  // v3.193.0: Harmonize Preview — demo-Action, generiert Harmonies fuer C5
  // in C-major Scale via patternHarmonizer pure helper.
  const handleHarmonizePreview = useCallback(() => {
    const result = harmonizeNote(72, {
      scale: "major",
      scaleRoot: 0,
      intervals: ["third", "fifth", "octave-up"],
    });
    const noteStr = result.harmonies
      .map(h => `${h.midi}(${h.interval})`)
      .join(", ");
    toast(`Harmonize C5 → ${noteStr}`, { kind: "info", duration: 5000 });
  }, []);

  // v3.196.0/v3.241.0: Emphasis — generiert Velocity-Akzente via patternEmphasis
  // und WENDET sie auf den aktiven Part an (vorher reine Toast-Vorschau).
  const handleApplyEmphasis = useCallback(() => {
    const activePattern = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!activePattern || activePattern.parts.length === 0) return;
    const part =
      activePattern.parts.find(p => p.id === dm.activePartId) ??
      activePattern.parts[0];
    const rhythm = part.steps.map(s => s.active);
    const emp = generateEmphasis(rhythm, { preset: emphasisPreset });
    if (emp.length === 0) {
      toast("Keine aktiven Steps zum Akzentuieren", { kind: "warning" });
      return;
    }
    const newVelocities = applyEmphasisVelocities(
      part.steps.length,
      emp,
      part.steps.map(s => s.velocity ?? 100)
    );
    dm.setPartSteps(part.id, rhythm, newVelocities);
    toast(`Emphasis "${emphasisPreset}" auf ${emp.length} Steps angewendet`, {
      kind: "success",
      duration: 2500,
    });
  }, [dm, emphasisPreset]);

  // Drag-Drop fuer .e2pattern/.e2sallpat (Browser-Fallback, eine Datei).
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file instanceof File) handleElectribeFile(file);
    };
    window.addEventListener("electribe:fileImport", handler);
    return () => window.removeEventListener("electribe:fileImport", handler);
  }, [handleElectribeFile]);

  // v3.273: kombinierter Drag-Drop von .e2sallpat + .all (Pattern-Bank + Samples)
  // → verknüpfter Import. ElectronDropZone bündelt beide Dateien in dieses Event.
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent<File[]>).detail;
      if (Array.isArray(files) && files.length > 0)
        void processElectribeFiles(files);
    };
    window.addEventListener("electribe:filesImport", handler);
    return () => window.removeEventListener("electribe:filesImport", handler);
  }, [processElectribeFiles]);

  // Keyboard-Shortcuts werden zentral durch useKeyboardShortcuts in App.tsx gehandhabt

  // BPM-Input synchronisieren
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

  // v3.40: Page-Switcher-State zurücksetzen bei Pattern-Wechsel oder wenn
  // stepCount kleiner wird (z. B. 64 → 16 → currentPatternPage könnte 3 sein).
  useEffect(() => {
    if (!pattern) return;
    const pages = getPageCount(pattern.stepCount);
    if (currentPatternPage >= pages) {
      setCurrentPatternPage(0);
    }
    // pattern.id wechselt → starte stets auf Page 0 (User-Erwartung beim
    // Pattern-Sprung).
  }, [pattern?.id, pattern?.stepCount, currentPatternPage]);

  // v3.40: Auto-Page-Follow während Playback — Page wechselt automatisch mit
  // currentStep wenn isPlaying && autoPageFollow && stepCount > 16. User kann
  // Follow per Toggle deaktivieren um manuell zu editieren während Playback.
  // TASK-247: Imperativ über den Playhead-Store abonnieren statt dm.currentStep
  // in den Deps zu führen — sonst bräuchte der Effekt einen Parent-Rerender pro
  // Step und der Full-Rerender-Fix wäre wirkungslos. Funktionales setState →
  // re-rendert nur, wenn sich die Page tatsächlich ändert.
  const patternStepCount = pattern?.stepCount;
  useEffect(() => {
    if (!isPlaying || !autoPageFollow) return;
    if (!patternStepCount || patternStepCount <= 16) return;
    const update = () => {
      const target = getPageForStep(getPlayheadStep(), patternStepCount);
      setCurrentPatternPage(prev => (prev !== target ? target : prev));
    };
    update();
    return subscribePlayhead(update);
  }, [isPlaying, autoPageFollow, patternStepCount]);

  // Metronom-Panel schließen bei Klick außerhalb
  useEffect(() => {
    if (!showMetronomPanel) return;
    const handler = (e: MouseEvent) => {
      if (!metronomPanelRef.current?.contains(e.target as Node)) {
        setShowMetronomPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMetronomPanel]);

  // Arp-Panel schließen bei Klick außerhalb (analog Metronom)
  useEffect(() => {
    if (!showArpPanel) return;
    const handler = (e: MouseEvent) => {
      if (!arpPanelRef.current?.contains(e.target as Node)) {
        setShowArpPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showArpPanel]);

  // Metronom-Sync
  useEffect(() => {
    const downbeatFreq = 800 + metronomTone * 1200;
    const beatFreq = 500 + metronomTone * 700;
    AudioEngine.setMetronom(
      metronomOn,
      metronomGain,
      metronomAccent,
      downbeatFreq,
      beatFreq,
      metronomBeatsPerBar,
      metronomSubdivision,
      metronomOscType
    );
  }, [
    metronomOn,
    metronomGain,
    metronomAccent,
    metronomTone,
    metronomBeatsPerBar,
    metronomOscType,
    metronomSubdivision,
  ]);

  // Master-Volume-Sync
  useEffect(() => {
    AudioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  // Effekte live aktualisieren
  useEffect(() => {
    if (!pattern) return;
    pattern.parts.forEach(part => {
      AudioEngine.updateChannelFx(part.id, part.fx);
    });
  }, [pattern]);

  if (!pattern) return null;

  const effectiveBpm = pattern.bpm ?? bpm;
  const isLiveEditing = !!dm.liveEditSourcePatternId;
  const playbackPattern = isLiveEditing
    ? dm.patterns.find(p => p.id === dm.liveEditSourcePatternId)
    : null;

  return (
    <div
      className={`flex flex-col bg-bg-base text-text-primary select-none overflow-hidden ${className}`}
      role="region"
      aria-label="Drum Machine Sequencer"
    >
      {/* ── Live Edit Banner ────────────────────────────────────────────── */}
      {isLiveEditing && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-danger/10 border-b-2 border-accent-danger text-xs flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-accent-danger animate-pulse flex-shrink-0" />
          <span className="font-bold text-accent-danger">LIVE EDIT</span>
          <span className="text-text-muted">
            ▶ spielt:{" "}
            <strong className="text-text-primary">
              {playbackPattern?.name ?? "–"}
            </strong>
          </span>
          <span className="text-text-dim mx-1">·</span>
          <span className="text-text-muted">
            ✏ bearbeite:{" "}
            <strong className="text-text-primary">{pattern.name}</strong>
          </span>
          <div className="flex-1" />
          {/* Commit: sofort */}
          <button
            onClick={dm.commitLivePatternEdit}
            className="px-2 py-0.5 rounded bg-accent-success text-white text-[10px] font-bold hover:opacity-80 transition-opacity"
            title="Jetzt wechseln – sofortiger Pattern-Tausch"
          >
            ✓ Commit
          </button>
          {/* Commit: quantisiert (nächste Bar) */}
          <button
            onClick={dm.scheduleCommit}
            className={[
              "px-2 py-0.5 rounded text-[10px] font-bold transition-colors border",
              dm.commitPending
                ? "bg-accent-primary text-white border-accent-primary animate-pulse"
                : "border-accent-primary text-accent-primary hover:bg-accent-primary/20",
            ].join(" ")}
            title="Beim nächsten Bar-Anfang wechseln (quantisiert)"
          >
            {dm.commitPending ? "⏳ nächste Bar…" : "⏱ nächste Bar"}
          </button>
          {/* Abbrechen */}
          <button
            onClick={dm.cancelLivePatternEdit}
            className="px-2 py-0.5 rounded bg-bg-elevated text-text-muted text-[10px] hover:text-accent-danger transition-colors"
            title="Live-Edit abbrechen – Draft verwerfen"
          >
            ✕ Verwerfen
          </button>
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-panel border-b border-border-color flex-wrap">
        {/* Pattern-Auswahl mit Prev/Next-Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (patternNavIndex > 0)
                dm.setActivePattern(dm.patterns[patternNavIndex - 1].id);
            }}
            disabled={patternNavIndex <= 0}
            title="Vorheriges Pattern"
            aria-label="Vorheriges Pattern"
            className="px-1.5 py-1.5 bg-bg-elevated rounded text-xs text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ◀
          </button>
          <div className="relative">
            <button
              onClick={() => setShowPatternMenu(prev => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated hover:text-text-primary rounded text-xs font-medium transition-colors"
            >
              <span>{pattern.name}</span>
              {dm.patterns.length > 1 && (
                <span className="text-text-dim text-[10px]">
                  {patternNavIndex + 1}/{dm.patterns.length}
                </span>
              )}
              <span className="text-text-dim">▾</span>
            </button>
            {showPatternMenu && (
              <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-color rounded-lg shadow-xl z-50 min-w-[220px] max-h-[80vh] overflow-y-auto">
                {isLiveEditing && (
                  <div className="px-3 py-1.5 border-b border-border-color text-[10px] text-text-dim">
                    Live-Edit aktiv: nur der Draft ist bearbeitbar
                  </div>
                )}
                {/* Pattern-Zeilen scrollen mit dem gesamten Dropdown (max-h-80vh).
                  Bei sehr vielen Patterns: der dedizierte Pattern-Manager-Tab. */}
                <div className="max-h-[55vh] overflow-y-auto border-b border-border-color">
                  {dm.patterns.map((p, idx) => (
                    <PatternRow
                      key={p.id}
                      pattern={p}
                      patternIndex={idx}
                      densityCategory={computePatternDensityCategory(p)}
                      complexityCategory={computePatternComplexityCategory(p)}
                      fitnessLabel={computePatternFitnessLabel(p)}
                      isActive={p.id === dm.activePatternId}
                      isPlaying={p.id === dm.playbackPatternId}
                      isLiveEditing={isLiveEditing}
                      showDelete={dm.patterns.length > 1}
                      hasPrevPattern={idx > 0}
                      prevPatternId={idx > 0 ? dm.patterns[idx - 1].id : null}
                      allPatterns={dm.patterns.map(pp => ({
                        id: pp.id,
                        name: pp.name,
                      }))}
                      onSelect={() => {
                        dm.setActivePattern(p.id);
                        setShowPatternMenu(false);
                      }}
                      onDuplicate={() => dm.duplicatePattern(p.id)}
                      onRemove={() => {
                        // v3.65.0: Pre-Action AutoBackup vor Delete-Pattern.
                        void getRegisteredAutoBackup()(
                          `Delete Pattern: ${p.name}`
                        ).finally(() => {
                          dm.removePattern(p.id);
                        });
                      }}
                      onCopySamplesFrom={(srcId, srcName) => {
                        dm.copySamplesFromPattern(srcId, p.id);
                        toast(
                          `Sampler aus „${srcName}" in „${p.name}" übernommen`,
                          { kind: "success" }
                        );
                      }}
                      onReorder={(from, to) => {
                        dm.reorderPatterns(from, to);
                        toast(
                          `Pattern „${dm.patterns[from]?.name ?? "?"}" verschoben`,
                          { kind: "info", duration: 2000 }
                        );
                      }}
                      onExportImage={() => {
                        // v3.66.0: Snapshot des Patterns für den Export-Modal.
                        setPatternImageExport({
                          id: p.id,
                          name: p.name,
                          stepCount: p.stepCount,
                          bpm: p.bpm,
                          parts: p.parts.map(pp => ({
                            id: pp.id,
                            name: pp.name,
                            steps: pp.steps,
                          })),
                        });
                        setShowPatternMenu(false);
                      }}
                      onCompare={() => {
                        // v3.91.0: Compare-Modal mit diesem Pattern als Slot A öffnen.
                        setCompareModalAId(p.id);
                        setShowPatternMenu(false);
                      }}
                      onCopy={() => {
                        // v3.169.0: Pattern als JSON-Envelope ins Clipboard kopieren.
                        void handleCopyPattern(p);
                      }}
                      onExportMidiEvents={() => {
                        // v3.173.0: Pattern → MIDI-Events JSON-Download.
                        handleExportMidiEvents(p);
                      }}
                      onExportMidiBinary={() => {
                        // v3.175.0: Pattern → echtes .mid-Binary-Download.
                        handleExportMidiBinary(p);
                      }}
                      activePatternId={dm.activePatternId}
                      activePatternFlat={activePatternFlat}
                    />
                  ))}
                </div>
                {/* v3.162: Bank-Summary-Footer (Multi-Pattern Density-Aggregation) */}
                {dm.patterns.length > 1 &&
                  (() => {
                    const report = analyzePatternBank(dm.patterns);
                    return (
                      <div
                        className="px-3 py-1.5 border-t border-border-color text-[10px] text-text-dim flex items-center gap-2"
                        data-testid="pattern-bank-summary"
                      >
                        <span>Bank: {dm.patterns.length} Patterns</span>
                        <span className="text-text-muted">·</span>
                        <span>
                          Ø {Math.round(report.averageDensity * 100)}%
                        </span>
                        <span
                          className={[
                            "ml-auto inline-block w-1.5 h-1.5 rounded-full",
                            report.dominantCategory === "empty" &&
                              "bg-text-dim/30",
                            report.dominantCategory === "sparse" &&
                              "bg-accent-success/50",
                            report.dominantCategory === "medium" &&
                              "bg-accent-secondary",
                            report.dominantCategory === "dense" &&
                              "bg-accent-danger/70",
                            report.dominantCategory === "full" &&
                              "bg-accent-danger",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          title={`Dominante Kategorie: ${report.dominantCategory}`}
                        />
                        <span
                          className="capitalize"
                          data-testid="pattern-bank-summary-category"
                        >
                          {report.dominantCategory}
                        </span>
                      </div>
                    );
                  })()}
                {/* Follow Action für aktives Pattern */}
                <div className="border-t border-border-color px-2 py-2">
                  <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">
                    Follow Action
                  </div>
                  <div className="flex gap-1 flex-wrap mb-1">
                    {(["none", "next", "prev", "random"] as const).map(type => {
                      const current = pattern.followAction?.type ?? "none";
                      return (
                        <button
                          key={type}
                          onClick={() =>
                            dm.setPatternFollowAction(
                              pattern.id,
                              type === "none"
                                ? undefined
                                : {
                                    type,
                                    barsBeforeSwitch:
                                      pattern.followAction?.barsBeforeSwitch ??
                                      1,
                                  }
                            )
                          }
                          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${current === type ? "bg-accent-secondary/30 text-accent-secondary" : "bg-bg-elevated text-text-dim hover:text-text-primary"}`}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                  {(pattern.followAction?.type ?? "none") !== "none" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-text-dim">nach</span>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={pattern.followAction?.barsBeforeSwitch ?? 1}
                        onChange={e =>
                          dm.setPatternFollowAction(pattern.id, {
                            ...pattern.followAction!,
                            barsBeforeSwitch: Math.max(
                              1,
                              Math.min(16, Number(e.target.value))
                            ),
                          })
                        }
                        className="w-10 bg-bg-elevated text-text-primary text-[10px] px-1 py-0.5 rounded border border-border-color"
                      />
                      <span className="text-[10px] text-text-dim">Bars</span>
                    </div>
                  )}
                </div>
                {/* Pattern Stacking */}
                <div className="border-t border-border-color px-2 py-2">
                  <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide flex items-center gap-2">
                    Stacking
                    {dm.stackedPatternIds.length > 0 && (
                      <button
                        onClick={() => dm.clearStackedPatterns()}
                        className="text-[9px] text-accent-danger hover:opacity-80"
                      >
                        Alle löschen
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {dm.patterns
                      .filter(p => p.id !== pattern.id)
                      .map(p => {
                        const isStacked = dm.stackedPatternIds.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => dm.toggleStackedPattern(p.id)}
                            className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${isStacked ? "border-accent-secondary text-accent-secondary bg-accent-secondary/10" : "border-border-color text-text-dim hover:text-text-primary"}`}
                            title={
                              isStacked
                                ? "Stack entfernen"
                                : "Pattern zum Stack hinzufügen"
                            }
                          >
                            {isStacked ? "✓ " : ""}
                            {p.name}
                          </button>
                        );
                      })}
                    {dm.patterns.length <= 1 && (
                      <span className="text-[9px] text-text-dim">
                        Weitere Patterns erstellen
                      </span>
                    )}
                  </div>
                </div>

                {/* BPM-Sync */}
                <div className="border-t border-border-color px-2 py-2">
                  <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">
                    BPM-Sync
                  </div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] text-text-dim">Ratio:</span>
                    {[
                      ["½", 0.5],
                      ["¾", 0.75],
                      ["1×", 1],
                      ["1½", 1.5],
                      ["2×", 2],
                    ].map(([label, ratio]) => (
                      <button
                        key={String(ratio)}
                        onClick={() =>
                          dm.setPatternBpmRatio(
                            pattern.id,
                            ratio === 1 ? null : Number(ratio)
                          )
                        }
                        className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                          (pattern.bpmRatio ?? 1) === ratio
                            ? "bg-accent-primary/30 text-accent-primary"
                            : "bg-bg-elevated text-text-dim hover:text-text-primary"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="text-[10px] text-accent-secondary ml-1 font-mono">
                      {pattern.bpmRatio
                        ? `→ ${Math.round(effectiveBpm * pattern.bpmRatio)} BPM`
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-text-dim">
                      Transition:
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={16}
                      value={pattern.bpmTransitionBars ?? 0}
                      onChange={e =>
                        dm.setPatternBpmTransitionBars(
                          pattern.id,
                          Number(e.target.value)
                        )
                      }
                      className="w-10 bg-bg-elevated text-text-primary text-[10px] px-1 py-0.5 rounded border border-border-color"
                    />
                    <span className="text-[10px] text-text-dim">
                      Bars (0 = sofort)
                    </span>
                  </div>
                </div>

                {/* v3.181.0: Pattern-Morph-Interpolate — Slider 0..1 morpht active->target. */}
                {dm.patterns.length >= 2 && (
                  <div
                    className="px-3 py-2 border-t border-border-color space-y-1.5"
                    data-testid="pattern-morph-block"
                  >
                    <div className="text-[10px] text-text-dim font-semibold">
                      Morph from active to:
                    </div>
                    <select
                      value={morphTargetId ?? ""}
                      onChange={e => setMorphTargetId(e.target.value || null)}
                      className="w-full bg-bg-panel border border-border-color rounded px-2 py-0.5 text-[11px] text-text-primary focus:outline-none"
                      data-testid="pattern-morph-target"
                    >
                      <option value="">— Target wählen —</option>
                      {dm.patterns
                        .filter(p => p.id !== dm.activePatternId)
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-dim">t:</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={morphT}
                        onChange={e => setMorphT(parseFloat(e.target.value))}
                        className="flex-1 accent-accent-secondary"
                        data-testid="pattern-morph-slider"
                      />
                      <span className="font-mono text-[10px] text-text-muted w-8">
                        {morphT.toFixed(2)}
                      </span>
                    </div>
                    <select
                      value={morphStrategy}
                      onChange={e =>
                        setMorphStrategy(e.target.value as MorphStrategy)
                      }
                      className="w-full bg-bg-panel border border-border-color rounded px-2 py-0.5 text-[10px] text-text-muted"
                      data-testid="pattern-morph-strategy"
                    >
                      {Object.entries(MORPH_STRATEGY_LABELS).map(
                        ([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        )
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={handleApplyMorph}
                      disabled={!morphTargetId}
                      data-testid="pattern-morph-apply"
                      className="w-full px-2 py-1 rounded text-[11px] bg-accent-secondary text-bg-base font-semibold hover:bg-accent-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Apply Morph
                    </button>
                  </div>
                )}

                {/* v3.182.0: Pattern-Branch-Variations — erstellt N neue Patterns als branched Variationen. */}
                <div
                  className="px-3 py-2 border-t border-border-color space-y-1.5"
                  data-testid="pattern-branch-block"
                >
                  <div className="text-[10px] text-text-dim font-semibold">
                    Branch Variations:
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim">N:</span>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={branchCount}
                      onChange={e =>
                        setBranchCount(parseInt(e.target.value, 10))
                      }
                      className="flex-1 accent-accent-primary"
                      data-testid="pattern-branch-count"
                    />
                    <span className="font-mono text-[10px] text-text-muted w-6">
                      {branchCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim">
                      Intensity:
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={branchIntensity}
                      onChange={e =>
                        setBranchIntensity(parseFloat(e.target.value))
                      }
                      className="flex-1 accent-accent-primary"
                      data-testid="pattern-branch-intensity"
                    />
                    <span className="font-mono text-[10px] text-text-muted w-8">
                      {Math.round(branchIntensity * 100)}%
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleBranchOut}
                    data-testid="pattern-branch-apply"
                    className="w-full px-2 py-1 rounded text-[11px] bg-accent-primary text-bg-base font-semibold hover:bg-accent-primary/80 transition-colors"
                  >
                    🌿 Branch out
                  </button>
                </div>

                {/* v3.183.0: Melodic Sequence Generator — Rhythm-of-parts[0] + Scale + Strategy → Preview. */}
                <div
                  className="px-3 py-2 border-t border-border-color space-y-1.5"
                  data-testid="pattern-melodic-block"
                >
                  <div className="text-[10px] text-text-dim font-semibold">
                    Melodic Sequence:
                  </div>
                  <select
                    value={melodicStrategy}
                    onChange={e =>
                      setMelodicStrategy(e.target.value as MelodicStrategy)
                    }
                    className="w-full bg-bg-panel border border-border-color rounded px-2 py-0.5 text-[10px] text-text-muted"
                    data-testid="pattern-melodic-strategy"
                  >
                    {Object.entries(MELODIC_STRATEGY_LABELS).map(
                      ([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={handleApplyMelodic}
                    data-testid="pattern-melodic-apply"
                    className="w-full px-2 py-1 rounded text-[11px] bg-bg-elevated text-text-primary hover:bg-accent-primary/20 hover:text-accent-primary transition-colors"
                  >
                    🎼 Apply Melodic
                  </button>
                </div>

                {/* v3.186.0: Chain-Simulator — simuliert 10 "next"-Steps via
                  resolveFollowAction und zeigt die Reihenfolge als Toast. */}
                {dm.patterns.length >= 2 && (
                  <div
                    className="px-3 py-2 border-t border-border-color"
                    data-testid="pattern-chain-sim-block"
                  >
                    <button
                      type="button"
                      onClick={handleSimulateChain}
                      data-testid="pattern-chain-sim-button"
                      className="w-full px-2 py-1 rounded text-[11px] bg-bg-elevated text-text-primary hover:bg-accent-secondary/20 hover:text-accent-secondary transition-colors"
                    >
                      🔗 Simulate Chain (10 steps next)
                    </button>
                  </div>
                )}

                {/* v3.188.0: Evolve N Patterns — genetic-algorithm-style Variationen
                  des aktiven Patterns (Union aller Parts). Generations + Pop-Size
                  via Slider, Apply legt evolved Patterns via addPatternData ab. */}
                <div
                  className="px-3 py-2 border-t border-border-color space-y-1.5"
                  data-testid="pattern-evolve-block"
                >
                  <div className="text-[10px] text-text-dim font-semibold">
                    🧬 Evolve:
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim">Gens:</span>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={evolveGens}
                      onChange={e =>
                        setEvolveGens(parseInt(e.target.value, 10))
                      }
                      className="flex-1 accent-accent-primary"
                      data-testid="pattern-evolve-gens"
                    />
                    <span className="font-mono text-[10px] text-text-muted w-6">
                      {evolveGens}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim">Pop:</span>
                    <input
                      type="range"
                      min={4}
                      max={16}
                      step={2}
                      value={evolvePopSize}
                      onChange={e =>
                        setEvolvePopSize(parseInt(e.target.value, 10))
                      }
                      className="flex-1 accent-accent-primary"
                      data-testid="pattern-evolve-pop"
                    />
                    <span className="font-mono text-[10px] text-text-muted w-6">
                      {evolvePopSize}
                    </span>
                  </div>
                  <button
                    onClick={handleEvolve}
                    data-testid="pattern-evolve-apply"
                    className="w-full px-2 py-1 rounded text-[11px] bg-accent-secondary text-bg-base font-semibold hover:bg-accent-secondary/80 transition-colors"
                  >
                    🧬 Evolve
                  </button>
                </div>

                {/* v3.189.0: Beat-Repeat Live. v3.240: am Sequencer verkabelt —
                  Trigger loopt ein N-Step-Fenster ab dem Playhead, Release
                  kehrt zum normalen Pattern zurück. */}
                <div
                  className="px-3 py-2 border-t border-border-color space-y-1.5"
                  data-testid="pattern-br-live-block"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-dim font-semibold">
                      ⏯ Beat-Repeat Live
                    </span>
                    <span
                      className={[
                        "text-[10px] font-mono px-1.5 py-0.5 rounded",
                        brState.active
                          ? "bg-accent-danger/30 text-accent-danger"
                          : "bg-bg-elevated text-text-dim",
                      ].join(" ")}
                      data-testid="pattern-br-live-status"
                    >
                      {brState.active ? "ACTIVE" : "off"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleTriggerBR}
                      data-testid="pattern-br-live-trigger"
                      className="flex-1 px-2 py-1 rounded text-[11px] bg-accent-danger/20 text-accent-danger hover:bg-accent-danger/40 transition-colors"
                    >
                      Trigger
                    </button>
                    <button
                      onClick={handleReleaseBR}
                      disabled={!brState.active}
                      data-testid="pattern-br-live-release"
                      className="flex-1 px-2 py-1 rounded text-[11px] bg-bg-elevated text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Release
                    </button>
                  </div>
                  <div
                    className="flex items-center gap-1"
                    data-testid="pattern-br-live-rates"
                  >
                    <span className="text-[10px] text-text-dim">Fenster:</span>
                    {[1, 2, 4, 8].map(n => (
                      <button
                        key={n}
                        onClick={() => setBrBufferSteps(n)}
                        data-testid={`pattern-br-live-rate-${n}`}
                        className={[
                          "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                          brBufferSteps === n
                            ? "bg-accent-secondary/30 text-accent-secondary"
                            : "bg-bg-elevated text-text-dim hover:text-text-primary",
                        ].join(" ")}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-[10px] text-text-dim ml-auto">
                      Steps
                    </span>
                  </div>
                  <div className="text-[10px] text-text-dim italic">
                    Loopt ein {brBufferSteps}-Step-Fenster ab dem Playhead, bis
                    Release.
                  </div>
                </div>

                {/* v3.193.0: Harmonize Preview — demo-Action via patternHarmonizer. */}
                <div
                  className="px-3 py-2 border-t border-border-color"
                  data-testid="pattern-harmonize-block"
                >
                  <button
                    onClick={handleHarmonizePreview}
                    data-testid="pattern-harmonize-preview"
                    className="w-full px-2 py-1 rounded text-[11px] bg-bg-elevated text-text-primary hover:bg-accent-primary/20 hover:text-accent-primary transition-colors"
                  >
                    🎵 Harmonize Preview (C5 major)
                  </button>
                </div>

                {/* v3.196.0/v3.241.0: Emphasis — wendet Velocity-Akzente auf den
                  aktiven Part an (vorher reine Toast-Vorschau). */}
                <div
                  className="px-3 py-2 border-t border-border-color space-y-1.5"
                  data-testid="pattern-emphasis-block"
                >
                  <div className="text-[10px] text-text-dim font-semibold">
                    Emphasis:
                  </div>
                  <select
                    value={emphasisPreset}
                    onChange={e =>
                      setEmphasisPreset(e.target.value as EmphasisPreset)
                    }
                    data-testid="pattern-emphasis-preset"
                    className="w-full bg-bg-panel border border-border-color rounded px-2 py-0.5 text-[10px] text-text-muted"
                  >
                    {Object.entries(EMPHASIS_PRESET_LABELS).map(
                      ([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                  <button
                    onClick={handleApplyEmphasis}
                    data-testid="pattern-emphasis-apply"
                    className="w-full px-2 py-1 rounded text-[11px] bg-bg-elevated text-text-primary hover:bg-accent-primary/20 hover:text-accent-primary transition-colors"
                  >
                    🎚 Apply Emphasis
                  </button>
                </div>

                {!isLiveEditing && (
                  <div className="border-t border-border-color p-1">
                    <button
                      onClick={() => {
                        dm.addPattern();
                        setShowPatternMenu(false);
                      }}
                      className="w-full text-left px-2 py-1 text-xs text-text-dim hover:text-text-primary hover:bg-bg-panel rounded"
                    >
                      + Neues Pattern
                    </button>
                    {/* v3.169.0: Pattern aus Clipboard einfügen. */}
                    <button
                      type="button"
                      onClick={handlePastePattern}
                      data-testid="pattern-paste"
                      className="w-full text-left px-2 py-1 text-xs text-text-dim hover:text-accent-primary hover:bg-bg-panel rounded"
                      title="Pattern aus Clipboard einfügen (JSON)"
                    >
                      📋 Paste Pattern
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              if (
                patternNavIndex >= 0 &&
                patternNavIndex < dm.patterns.length - 1
              )
                dm.setActivePattern(dm.patterns[patternNavIndex + 1].id);
            }}
            disabled={
              patternNavIndex < 0 || patternNavIndex >= dm.patterns.length - 1
            }
            title="Nächstes Pattern"
            aria-label="Nächstes Pattern"
            className="px-1.5 py-1.5 bg-bg-elevated rounded text-xs text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ▶
          </button>
        </div>

        {/* Step-Auflösung (Pattern-Global) */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Auflösung:</span>
          {(["1/8", "1/16", "1/32"] as StepResolution[]).map(res => (
            <button
              key={res}
              onClick={() => dm.setPatternStepResolution(pattern.id, res)}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                pattern.stepResolution === res
                  ? "bg-accent-primary/70 text-white"
                  : "bg-bg-elevated text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {res}
            </button>
          ))}
        </div>

        {/* Step-Count (v3.39: 64 für KORG-Parität — ESX-1 + E2 Sampler max) */}
        <div
          className="flex items-center gap-1"
          data-testid="dm-step-count-toggle"
        >
          {([16, 32, 64, 128] as const).map(n => (
            <button
              key={n}
              onClick={() => dm.setStepCount(n)}
              data-testid={`dm-step-count-${n}`}
              title={
                n === 64
                  ? "64 Steps (KORG ESX-1 / E2 Max)"
                  : n === 128
                    ? "128 Steps (Synthstudio — alle auf einer Seite, horizontal scrollbar)"
                    : `${n} Steps`
              }
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                pattern.stepCount === n
                  ? "bg-bg-elevated text-white"
                  : "bg-bg-elevated text-text-dim hover:text-text-primary",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
          {/* v3.264: aktuelle Step-Anzahl projektweit auf alle Patterns anwenden. */}
          <button
            onClick={() => dm.applyStepCountToAllPatterns(pattern.stepCount)}
            data-testid="dm-step-count-apply-all"
            title={`${pattern.stepCount} Steps auf ALLE Patterns anwenden (projektweit)`}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-text-dim hover:text-accent-primary hover:bg-bg-elevated transition-colors border border-border-color"
          >
            →&nbsp;alle
          </button>
        </div>

        <div className="flex-1" />

        {/* Pattern-BPM-Sync */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-dim">BPM:</span>
          <button
            onClick={() =>
              dm.setPatternBpm(pattern.id, pattern.bpm === null ? bpm : null)
            }
            title={
              pattern.bpm === null
                ? "Eigenes BPM setzen"
                : "Globales BPM verwenden"
            }
            className={[
              "px-2 py-0.5 rounded text-[9px] transition-colors",
              pattern.bpm !== null
                ? "bg-accent-secondary text-bg-base"
                : "bg-bg-elevated text-text-dim hover:text-text-primary",
            ].join(" ")}
          >
            {pattern.bpm !== null ? "Eigenes" : "Global"}
          </button>
          {pattern.bpm !== null && (
            <input
              type="number"
              min={20}
              max={300}
              value={pattern.bpm}
              onChange={e =>
                dm.setPatternBpm(pattern.id, parseInt(e.target.value) || bpm)
              }
              className="w-14 bg-bg-elevated text-text-primary text-xs rounded px-1.5 py-0.5 border border-border-color text-center"
            />
          )}
        </div>

        {/* Velocity / Pitch Mode */}
        <button
          onClick={() => dm.setVelocityMode(!dm.velocityMode)}
          className={[
            "px-2 py-1 rounded text-[10px] font-medium transition-colors",
            dm.velocityMode
              ? "bg-accent-secondary text-bg-base"
              : "bg-bg-elevated text-text-dim hover:text-text-primary",
          ].join(" ")}
          title="Velocity-Modus"
        >
          VEL
        </button>

        {/* Velocity Ramp Presets — nur im VEL-Modus sichtbar */}
        {dm.velocityMode && dm.activePartId && (
          <>
            {(
              [
                {
                  label: "↑",
                  fn: (i: number, n: number) =>
                    Math.round(40 + (i / (n - 1)) * 87),
                },
                {
                  label: "↓",
                  fn: (i: number, n: number) =>
                    Math.round(127 - (i / (n - 1)) * 87),
                },
                {
                  label: "∩",
                  fn: (i: number, n: number) =>
                    Math.round(40 + Math.sin((Math.PI * i) / (n - 1)) * 87),
                },
                {
                  label: "∿",
                  fn: (i: number, n: number) =>
                    Math.round(64 + Math.sin((2 * Math.PI * i) / n) * 63),
                },
                { label: "R", fn: () => Math.round(40 + Math.random() * 87) },
              ] as const
            ).map(({ label, fn }) => (
              <button
                key={label}
                onClick={() => {
                  const part = pattern.parts.find(
                    p => p.id === dm.activePartId
                  );
                  if (!part) return;
                  const n = pattern.stepCount;
                  part.steps.forEach((step, i) => {
                    if (step.active)
                      dm.setStepVelocity(dm.activePartId!, i, fn(i, n));
                  });
                }}
                className="px-1.5 py-0.5 rounded text-[10px] bg-accent-secondary/20 text-accent-secondary hover:bg-accent-secondary/40 transition-colors font-mono"
                title={`Velocity-Ramp: ${label}`}
              >
                {label}
              </button>
            ))}
            <span className="text-[10px] text-text-dim">Kurve</span>
          </>
        )}

        <button
          onClick={() => dm.setPitchMode(!dm.pitchMode)}
          className={[
            "px-2 py-1 rounded text-[10px] font-medium transition-colors",
            dm.pitchMode
              ? "bg-accent-secondary text-bg-base"
              : "bg-bg-elevated text-text-dim hover:text-text-primary",
          ].join(" ")}
          title="Pitch-Modus (Rechtsklick auf Step)"
        >
          PITCH
        </button>

        {/* Quantize */}
        {dm.activePartId && (
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] text-text-dim">Q:</span>
            {(["1/8", "1/16", "1/32"] as const).map(grid => (
              <button
                key={grid}
                onClick={() =>
                  dm.quantizePartSteps(dm.activePartId!, grid, 1.0)
                }
                className="px-1.5 py-0.5 text-[9px] rounded bg-bg-elevated text-text-dim hover:bg-accent-primary/20 hover:text-accent-primary border border-border-color transition-colors font-mono"
                title={`Quantize auf ${grid} (100% Stärke)`}
              >
                {grid}
              </button>
            ))}
          </div>
        )}

        {/* Arpeggiator (neben Metronom) — v3.270 */}
        <div ref={arpPanelRef} className="relative">
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded bg-bg-panel border border-border-color">
            <button
              onClick={() => setArpEnabled(!arpEnabled)}
              data-testid="arp-toolbar-toggle"
              aria-pressed={arpEnabled}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-bold transition-colors",
                arpEnabled
                  ? "bg-accent-primary text-bg-base"
                  : "bg-bg-elevated text-text-dim hover:text-text-primary",
              ].join(" ")}
              title={arpEnabled ? "Arpeggiator aus" : "Arpeggiator ein"}
            >
              ARP
            </button>
            <button
              onClick={() => setShowArpPanel(prev => !prev)}
              data-testid="arp-toolbar-settings"
              className={[
                "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                showArpPanel
                  ? "bg-bg-elevated text-white"
                  : "text-text-dim hover:text-text-primary",
              ].join(" ")}
              title="Arpeggiator-Einstellungen"
            >
              ⚙
            </button>
          </div>

          {showArpPanel && (
            <div
              className="absolute top-full right-0 z-50 mt-1 w-72 max-h-[75vh] overflow-y-auto"
              data-testid="arp-toolbar-panel"
            >
              <ArpeggiatorPanel />
            </div>
          )}
        </div>

        {/* Metronom */}
        <div ref={metronomPanelRef} className="relative">
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded bg-bg-panel border border-border-color">
            <button
              onClick={() => setMetronomOn(prev => !prev)}
              className={[
                "px-2 py-0.5 rounded text-[10px] transition-colors",
                metronomOn
                  ? "bg-bg-elevated text-white"
                  : "bg-bg-elevated text-text-dim hover:text-text-primary",
              ].join(" ")}
              title={metronomOn ? "Metronom aus" : "Metronom ein"}
            >
              ♩
            </button>
            <button
              onClick={() => setShowMetronomPanel(prev => !prev)}
              className={[
                "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                showMetronomPanel
                  ? "bg-bg-elevated text-white"
                  : "text-text-dim hover:text-text-primary",
              ].join(" ")}
              title="Metronom-Einstellungen"
            >
              ⚙
            </button>
          </div>

          {showMetronomPanel && (
            <div className="absolute top-full right-0 z-50 mt-1 p-3 bg-bg-elevated border border-border-color rounded-lg shadow-xl w-64">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-text-primary">
                  Metronom
                </span>
                <button
                  onClick={() => setShowMetronomPanel(false)}
                  className="text-text-dim hover:text-white text-sm leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Schieberegler */}
              <div className="space-y-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-16 shrink-0">
                    Lautstärke
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={metronomGain}
                    onChange={e => setMetronomGain(parseFloat(e.target.value))}
                    className="flex-1 accent-accent-primary cursor-pointer"
                  />
                  <span className="text-[10px] text-text-dim w-8 text-right">
                    {Math.round(metronomGain * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-16 shrink-0">
                    Akzent
                  </span>
                  <input
                    type="range"
                    min={0.2}
                    max={2}
                    step={0.01}
                    value={metronomAccent}
                    onChange={e =>
                      setMetronomAccent(parseFloat(e.target.value))
                    }
                    className="flex-1 accent-accent-primary cursor-pointer"
                  />
                  <span className="text-[10px] text-text-dim w-8 text-right">
                    {metronomAccent.toFixed(1)}×
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-16 shrink-0">
                    Tonhöhe
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={metronomTone}
                    onChange={e => setMetronomTone(parseFloat(e.target.value))}
                    className="flex-1 accent-accent-secondary cursor-pointer"
                  />
                  <span className="text-[10px] text-text-dim w-8 text-right">
                    {Math.round(metronomTone * 100)}%
                  </span>
                </div>
              </div>

              <div className="border-t border-border-color my-2" />

              {/* Schläge / Takt */}
              <div className="mb-2">
                <span className="text-[10px] text-text-dim block mb-1">
                  Schläge / Takt
                </span>
                <div className="flex gap-1">
                  {([2, 3, 4, 5, 6, 7] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => setMetronomBeatsPerBar(n)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] font-mono transition-colors",
                        metronomBeatsPerBar === n
                          ? "bg-accent-primary/70 text-white"
                          : "bg-bg-elevated text-text-dim hover:text-text-primary",
                      ].join(" ")}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unterteilung */}
              <div className="mb-2">
                <span className="text-[10px] text-text-dim block mb-1">
                  Unterteilung
                </span>
                <div className="flex gap-1">
                  {(["beat", "eighth", "sixteenth"] as const).map(sub => (
                    <button
                      key={sub}
                      onClick={() => setMetronomSubdivision(sub)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] transition-colors",
                        metronomSubdivision === sub
                          ? "bg-accent-primary/70 text-white"
                          : "bg-bg-elevated text-text-dim hover:text-text-primary",
                      ].join(" ")}
                    >
                      {sub === "beat"
                        ? "1/4"
                        : sub === "eighth"
                          ? "1/8"
                          : "1/16"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Klangtyp */}
              <div>
                <span className="text-[10px] text-text-dim block mb-1">
                  Klangtyp
                </span>
                <div className="flex gap-1">
                  {(["sine", "square", "triangle"] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setMetronomOscType(type)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] transition-colors",
                        metronomOscType === type
                          ? "bg-accent-secondary text-bg-base"
                          : "bg-bg-elevated text-text-dim hover:text-text-primary",
                      ].join(" ")}
                    >
                      {type === "sine"
                        ? "Sinus"
                        : type === "square"
                          ? "Rechteck"
                          : "Dreieck"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Master */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={e => setMasterVolume(parseFloat(e.target.value))}
            title={`Master-Lautstärke: ${Math.round(masterVolume * 100)}%`}
            className="w-16 accent-accent-primary cursor-pointer"
          />
        </div>

        {/* Clear */}
        <button
          onClick={() => {
            // v3.65.0: Pre-Action AutoBackup vor Clear-Pattern.
            void getRegisteredAutoBackup()("Clear Pattern").finally(() => {
              dm.clearPattern();
            });
          }}
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-accent-danger/30 hover:text-accent-danger transition-colors"
          title="Pattern leeren"
        >
          CLR
        </button>

        {/* Undo/Redo */}
        <button
          onClick={dm.undo}
          disabled={!dm.canUndo}
          className="w-6 h-6 rounded text-xs bg-bg-elevated text-text-dim hover:text-text-primary disabled:opacity-30 transition-colors"
          title="Rückgängig (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          onClick={dm.redo}
          disabled={!dm.canRedo}
          className="w-6 h-6 rounded text-xs bg-bg-elevated text-text-dim hover:text-text-primary disabled:opacity-30 transition-colors"
          title="Wiederholen (Ctrl+Y)"
        >
          ↪
        </button>

        {/* Play/Stop — v1.86: right-click für MIDI-Learn */}
        <button
          onClick={onPlayStop}
          onContextMenu={playStopLearn.onContextMenu}
          title={`${isPlaying ? "Stop" : "Play"} (Space) · Rechtsklick: MIDI-Learn${playStopLearn.isMapped ? ` · CC${playStopLearn.mappedCC}` : ""}`}
          className={[
            "relative w-8 h-8 rounded flex items-center justify-center text-sm font-bold transition-colors",
            isPlaying
              ? "bg-accent-danger hover:bg-accent-danger/80 text-bg-base"
              : "bg-accent-primary hover:bg-accent-primary text-bg-base",
          ].join(" ")}
        >
          {isPlaying ? "■" : "▶"}
          {playStopLearn.isMapped && (
            <span className="absolute -top-1 -right-1 text-[8px] font-mono bg-accent-secondary text-bg-base px-0.5 rounded leading-tight">
              CC{playStopLearn.mappedCC}
            </span>
          )}
        </button>
        {playStopLearn.menu}

        {/* BPM — v1.86: right-click für MIDI-Learn; v3.38: disabled-State im Sync-Mode */}
        <div
          className={`flex items-center gap-1 relative ${bpmLocked ? "opacity-50" : ""}`}
          onContextMenu={bpmLearn.onContextMenu}
          data-testid="dm-bpm-control"
          data-bpm-locked={bpmLocked ? "true" : "false"}
          title={
            bpmLocked ? "BPM extern gesynced — Slider gesperrt" : undefined
          }
        >
          {bpmLocked && (
            <span
              data-testid="dm-bpm-lock-icon"
              className="text-[10px] text-accent-secondary mr-0.5 select-none"
              aria-hidden="true"
              title="BPM extern gesynced — Slider gesperrt"
            >
              🔒
            </span>
          )}
          <button
            onClick={() => onBpmChange(Math.max(20, bpm - 1))}
            disabled={bpmLocked}
            title={
              bpmLocked
                ? "BPM extern gesynced — Slider gesperrt"
                : "BPM −1 (Taste: −)"
            }
            aria-label="BPM verringern"
            className="w-5 h-6 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95 transition-colors disabled:cursor-not-allowed disabled:hover:bg-bg-elevated disabled:hover:text-text-muted"
          >
            −
          </button>
          <input
            ref={bpmInputRef}
            type="number"
            min={20}
            max={300}
            value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={() => {
              if (bpmLocked) {
                setBpmInput(String(bpm));
                return;
              }
              const v = parseInt(bpmInput);
              if (!isNaN(v)) onBpmChange(Math.max(20, Math.min(300, v)));
              else setBpmInput(String(bpm));
            }}
            onKeyDown={e => {
              if (e.key === "Enter") bpmInputRef.current?.blur();
            }}
            disabled={bpmLocked}
            readOnly={bpmLocked}
            title={
              bpmLocked
                ? "BPM extern gesynced — Slider gesperrt"
                : "BPM (Doppelklick zum Bearbeiten, Tasten + und − für ±1)"
            }
            data-testid="dm-bpm-input"
            className="w-14 bg-bg-elevated text-text-primary text-xs rounded px-1.5 py-1 border border-border-color text-center disabled:cursor-not-allowed"
          />
          <button
            onClick={() => onBpmChange(Math.min(300, bpm + 1))}
            disabled={bpmLocked}
            title={
              bpmLocked
                ? "BPM extern gesynced — Slider gesperrt"
                : "BPM +1 (Taste: +)"
            }
            aria-label="BPM erhöhen"
            className="w-5 h-6 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95 transition-colors disabled:cursor-not-allowed disabled:hover:bg-bg-elevated disabled:hover:text-text-muted"
          >
            +
          </button>
          {bpmLearn.isMapped && (
            <span className="text-[8px] font-mono bg-accent-secondary text-bg-base px-1 rounded leading-tight">
              CC{bpmLearn.mappedCC}
            </span>
          )}
        </div>
        {bpmLearn.menu}

        {/* v3.179.0: Infer-BPM — Density+Syncopation-Heuristik → toast. */}
        <button
          type="button"
          onClick={handleInferBpm}
          data-testid="drum-machine-infer-bpm"
          className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-accent-secondary hover:bg-accent-secondary/20 transition-colors"
          title="BPM-Vorschlag basierend auf Pattern-Density+Syncopation"
        >
          🎯 BPM
        </button>

        {/* v3.176.0: Chord-Suggestion-Panel Toggle (Floating-Overlay). */}
        <button
          type="button"
          onClick={() => setShowChordPanel(v => !v)}
          data-testid="chord-panel-toggle"
          className={`px-2 py-0.5 rounded text-[10px] border border-border-color transition-colors ${showChordPanel ? "bg-accent-secondary/30 text-accent-secondary" : "bg-bg-elevated text-text-muted hover:text-text-primary"}`}
          title="Chord-Suggestions ein/ausblenden"
        >
          🎵 Chords
        </button>

        {/* v3.164.0: Pattern-Mutator-Toolbar — wendet shift/double/half/reverse/invert
            auf ALLE Parts des aktiven Patterns gleichzeitig an. */}
        <div
          className="flex items-center gap-1 px-2 py-1 border-l border-border-color"
          data-testid="pattern-mutator-toolbar"
          title="Pattern-Mutationen (alle Parts gleichzeitig)"
        >
          <span className="text-[10px] text-text-dim mr-1">Mutate:</span>
          <button
            onClick={() => applyMutator(p => shiftPatternBoolArr(p, -1))}
            data-testid="pattern-mutator-shift-left"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Shift links"
          >
            ◀
          </button>
          <button
            onClick={() => applyMutator(p => shiftPatternBoolArr(p, 1))}
            data-testid="pattern-mutator-shift-right"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Shift rechts"
          >
            ▶
          </button>
          <button
            onClick={() => applyMutator(doubleTimePattern)}
            data-testid="pattern-mutator-double"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Double-Time"
          >
            2×
          </button>
          <button
            onClick={() => applyMutator(halfTimePattern)}
            data-testid="pattern-mutator-half"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Half-Time"
          >
            ½
          </button>
          <button
            onClick={() => applyMutator(reversePattern)}
            data-testid="pattern-mutator-reverse"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Reverse"
          >
            ⇄
          </button>
          <button
            onClick={() => applyMutator(invertPattern)}
            data-testid="pattern-mutator-invert"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Invert"
          >
            ¬
          </button>
          <button
            onClick={() => {
              const seed = Date.now();
              applyMutator(p => variatePattern(p, 0.7, 0.05, { seed }));
            }}
            data-testid="pattern-mutator-variate"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Variate (subtle keep+add) — neue Variation des Patterns"
          >
            ⚡
          </button>
          <button
            onClick={() => applyMutator(p => applyHalfStutter(p, 2))}
            data-testid="pattern-mutator-stutter"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Stutter — letzte Hälfte als 2-Step-Roll"
          >
            ⋯
          </button>
          {/* v3.192.0: Beat-Shift Buttons (rotate pattern by full beats). */}
          <button
            onClick={() =>
              applyMutator(p =>
                rotatePatternByBeats(p, { stepsPerBeat: 4, beats: 1 })
              )
            }
            data-testid="pattern-mutator-beat-fwd"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="+1 Beat shift"
          >
            +B
          </button>
          <button
            onClick={() =>
              applyMutator(p =>
                rotatePatternByBeats(p, { stepsPerBeat: 4, beats: -1 })
              )
            }
            data-testid="pattern-mutator-beat-bwd"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="-1 Beat shift"
          >
            -B
          </button>
          {/* v3.197.0: Random Mutation-Chain Button (3 ops chained, intensity 0.5). */}
          <button
            onClick={() =>
              applyMutator(
                p =>
                  randomMutate(p, {
                    intensity: 0.5,
                    maxOps: 3,
                    seed: Date.now(),
                  }).pattern
              )
            }
            data-testid="pattern-mutator-random"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Random mutation chain (3 ops, intensity 0.5)"
          >
            🎲
          </button>
        </div>

        {/* v3.168: Pattern-Fill-Toolbar (Drum-Fill-Generation pro Pattern-Ende) */}
        <div
          className="flex items-center gap-1 px-2 py-1 border-l border-border-color"
          data-testid="pattern-fill-toolbar"
          title="Pattern-Fill-Generation (alle Parts gleichzeitig)"
        >
          <span className="text-[10px] text-text-dim mr-1">Fill:</span>
          <button
            onClick={() =>
              applyMutator(p =>
                generateFill(p, { density: 0.3, seed: Date.now() })
              )
            }
            data-testid="pattern-fill-subtle"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-primary/30 hover:text-accent-primary transition-colors"
            title="Subtle Fill — sparse density 0.3 im letzten Drittel"
          >
            Subtle
          </button>
          <button
            onClick={() =>
              applyMutator(p =>
                generateFill(p, {
                  density: 0.7,
                  fillLength: 4,
                  seed: Date.now(),
                })
              )
            }
            data-testid="pattern-fill-busy"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-primary/30 hover:text-accent-primary transition-colors"
            title="Busy Fill — hohe density 0.7 in den letzten 4 Steps"
          >
            Busy
          </button>
          <button
            onClick={() =>
              applyMutator(p =>
                generateBuildUp(p, { density: 0.5, seed: Date.now() })
              )
            }
            data-testid="pattern-fill-buildup"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-primary/30 hover:text-accent-primary transition-colors"
            title="Build-Up — dichter werdend zum Pattern-Ende"
          >
            Build
          </button>
          <button
            onClick={() =>
              applyMutator(p => generateRoll(p, { fillLength: 4 }))
            }
            data-testid="pattern-fill-roll"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-primary/30 hover:text-accent-primary transition-colors"
            title="Drum-Roll — alle letzten 4 Steps aktiv"
          >
            Roll
          </button>
        </div>

        {/* v3.169: Humanize-Toolbar */}
        <div
          className="flex items-center gap-1 px-2 py-1 border-l border-border-color"
          data-testid="pattern-humanize-toolbar"
          title="Pattern-Humanize (Probability-Decay basierend auf Intensity)"
        >
          <span className="text-[10px] text-text-dim mr-1">Humanize:</span>
          <select
            value={humanizeIntensity}
            onChange={e =>
              setHumanizeIntensity(e.target.value as HumanizeIntensity)
            }
            className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-[10px] text-text-muted hover:text-text-primary focus:outline-none"
            data-testid="pattern-humanize-intensity"
          >
            <option value="none">none</option>
            <option value="subtle">subtle</option>
            <option value="moderate">moderate</option>
            <option value="heavy">heavy</option>
          </select>
          <button
            onClick={handleHumanize}
            data-testid="pattern-humanize-apply"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-secondary/30 hover:text-accent-secondary transition-colors"
            title="Pattern humanisieren (kleine Probability-Drops je nach Intensity)"
          >
            Apply
          </button>
        </div>

        {/* v3.175: Step-Probability Lock-Toolbar (Preview-only, store-step-prob-API pending) */}
        <div
          className="flex items-center gap-1 px-2 py-1 border-l border-border-color"
          data-testid="pattern-lock-toolbar"
          title="Per-Step Probability-Locks (Display-Preview, store-probability-API pending v3.176+)"
        >
          <span className="text-[10px] text-text-dim mr-1">Lock:</span>
          <select
            value={lockMode}
            onChange={e => setLockMode(e.target.value as LockMode)}
            data-testid="pattern-lock-mode"
            className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-[10px] text-text-muted hover:text-text-primary focus:outline-none"
          >
            <option value="all">all (75%)</option>
            <option value="downbeats">downbeats (1.0/0.5)</option>
            <option value="offbeats">offbeats (0.7/1.0)</option>
            <option value="fills">fills (last quarter 0.6)</option>
          </select>
          <button
            onClick={handleShowLockMode}
            data-testid="pattern-lock-preview"
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-warning/30 hover:text-accent-warning transition-colors"
            title="Lock-Mode auf aktives Pattern visualisieren (toast preview)"
          >
            Preview
          </button>
        </div>

        {/* v3.268: Import/Export-Cluster — einklappbar (Toolbar beruhigen). */}
        <div className="flex items-center gap-1 px-2 border-l border-border-color">
          <button
            onClick={() => setIoExpanded(v => !v)}
            data-testid="io-cluster-toggle"
            aria-expanded={ioExpanded}
            title="Import / Export (MIDI, FLP, KORG, Slice …)"
            className={[
              "px-2 py-1 rounded text-[10px] font-medium transition-colors inline-flex items-center gap-1",
              ioExpanded
                ? "bg-accent-primary/20 text-accent-primary"
                : "bg-bg-elevated text-text-dim hover:text-text-primary",
            ].join(" ")}
          >
            📁 I/O
            <span
              className={`inline-block transition-transform ${ioExpanded ? "" : "-rotate-90"}`}
            >
              ▾
            </span>
          </button>
          <div
            className={
              ioExpanded ? "flex items-center gap-1 flex-wrap" : "hidden"
            }
          >
            {/* MIDI-Import */}
            <button
              onClick={() => midiImportRef.current?.click()}
              title="MIDI-Datei importieren"
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
            >
              ♪ MIDI
            </button>
            <input
              ref={midiImportRef}
              type="file"
              accept=".mid,.midi"
              className="hidden"
              onChange={handleMidiImport}
            />

            {/* FLP-Import (FL-Studio Pattern-Extraktion) */}
            <button
              onClick={() => flpImportRef.current?.click()}
              title="FL-Studio Projekt importieren (erstes Pattern)"
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
              data-testid="flp-import"
            >
              🎛 FLP
            </button>
            <input
              ref={flpImportRef}
              type="file"
              accept=".flp"
              className="hidden"
              onChange={handleFlpImport}
            />

            {/* KORG Electribe Pattern-Import (TASK-237) */}
            <button
              onClick={() => electribeImportRef.current?.click()}
              title="KORG Electribe Pattern importieren (.e2pattern/.e2spat/.e2sallpat). Tipp: zusätzlich die .all-Sample-Bank mit auswählen (Mehrfachauswahl) → Samples werden den Kanälen zugewiesen und sind abspielbar."
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors inline-flex items-center gap-1"
              data-testid="electribe-import"
            >
              🎚 Electribe
              <ProLockBadge feature={PRO_FEATURE_ELECTRIBE_IMPORT} />
            </button>
            <input
              ref={electribeImportRef}
              type="file"
              accept=".e2pattern,.e2sallpat,.e2spat,.all"
              multiple
              className="hidden"
              onChange={handleElectribeImport}
              data-testid="electribe-import-input"
            />

            {/* v3.297: Pattern ⇄ Korg E2/E2S per SysEx direkt aus dem Sequenzer */}
            <button
              onClick={() => void handlePushPatternToDevice()}
              disabled={e2sDevice.status !== "connected" || e2sDevice.busy}
              title={
                e2sDevice.status === "connected"
                  ? "Aktives Pattern an das Korg E2/E2S senden (Current Pattern, SysEx)"
                  : "Kein Korg E2/E2S verbunden — im E2S-Tab verbinden"
              }
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors inline-flex items-center gap-1 disabled:opacity-40"
              data-testid="e2s-push-pattern"
            >
              ⇧ Gerät
            </button>
            <button
              onClick={() => void handlePullPatternFromDevice()}
              disabled={e2sDevice.status !== "connected" || e2sDevice.busy}
              title={
                e2sDevice.status === "connected"
                  ? "Aktuelles Pattern vom Korg E2/E2S holen und ins aktive Pattern laden (SysEx)"
                  : "Kein Korg E2/E2S verbunden — im E2S-Tab verbinden"
              }
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors inline-flex items-center gap-1 disabled:opacity-40"
              data-testid="e2s-pull-pattern"
            >
              ⇩ Gerät
            </button>

            {/* v3.285: „📦 KORG Bank" entfernt — der eine „📥 Korg Import"-
                Button (neben One-Shot) übernimmt Bank/Sample/Pattern-Import;
                der Bank/Sample-Editor ist aus dessen Dialog erreichbar. */}

            {/* KORG E2 Sampler EXPORT (v3.4.0) — Synthstudio → .all */}
            <button
              onClick={() => {
                if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
                try {
                  window.dispatchEvent(
                    new CustomEvent("korg:bank:export-open")
                  );
                } catch {
                  /* test-env without CustomEvent */
                }
              }}
              title="Sample-Bank für KORG Electribe 2 Sampler exportieren (.all)"
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors inline-flex items-center gap-1"
              data-testid="korg-bank-export"
            >
              📤 KORG Export
              <ProLockBadge feature={PRO_FEATURE_KORG_BANK_WRITE} />
            </button>

            {/* KORG E2 Pattern EXPORT (v3.26.0) — Synthstudio-Pattern → .e2spat */}
            <button
              onClick={async () => {
                if (!requireProFeature(PRO_FEATURE_E2_PATTERN_EXPORT)) return;
                const currentPattern = dm.getActivePattern();
                if (!currentPattern) {
                  toast("Kein Pattern aktiv", { kind: "warning" });
                  return;
                }
                try {
                  const e2Input = convertSynthstudioPatternToE2(
                    currentPattern,
                    { globalBpm: bpm }
                  );
                  const buffer = buildE2PatternFileV2(e2Input);
                  // Sanitize name for filename — only ASCII alnum + _ - .
                  const safeName =
                    (currentPattern.name || "pattern")
                      .replace(/[^A-Za-z0-9._-]+/g, "_")
                      .slice(0, 60) || "pattern";
                  const filename = `${safeName}.e2spat`;

                  if (electron.isElectron) {
                    const result = await electron.saveE2Pattern(
                      filename,
                      buffer
                    );
                    if (result.success) {
                      toast(`E2 Pattern gespeichert: ${result.filePath}`, {
                        kind: "success",
                      });
                    } else if (result.error && result.error !== "canceled") {
                      toast(`Speichern fehlgeschlagen: ${result.error}`, {
                        kind: "error",
                      });
                    }
                  } else {
                    // Browser-Fallback: Blob-Download
                    const blob = new Blob([buffer], {
                      type: "application/octet-stream",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast(`E2 Pattern heruntergeladen: ${filename}`, {
                      kind: "success",
                    });
                  }
                } catch (err) {
                  console.error("[E2 Pattern Export] error:", err);
                  toast(
                    `Export-Fehler: ${(err as Error)?.message ?? "unbekannt"}`,
                    { kind: "error" }
                  );
                }
              }}
              title="Aktuelles Pattern für KORG Electribe 2 Sampler exportieren (.e2spat)"
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors inline-flex items-center gap-1"
              data-testid="e2-pattern-export"
            >
              📤 E2 Pattern
              <ProLockBadge feature={PRO_FEATURE_E2_PATTERN_EXPORT} />
            </button>

            {/* KORG E2 ALL-Pattern Bank EXPORT (v3.271.0) — alle Projekt-Patterns → .e2sallpat */}
            <button
              onClick={async () => {
                if (!requireProFeature(PRO_FEATURE_E2_PATTERN_EXPORT)) return;
                const allPatterns = dm.patterns ?? [];
                if (allPatterns.length === 0) {
                  toast("Keine Patterns im Projekt", { kind: "warning" });
                  return;
                }
                try {
                  const e2Inputs = allPatterns
                    .slice(0, 250)
                    .map(p =>
                      convertSynthstudioPatternToE2(p, { globalBpm: bpm })
                    );
                  const buffer = buildE2AllPatFile(e2Inputs);
                  const dropped =
                    allPatterns.length > 250 ? allPatterns.length - 250 : 0;

                  const filename = "synthstudio-bank.e2sallpat";

                  if (electron.isElectron) {
                    const result = await electron.saveE2AllPat(
                      filename,
                      buffer
                    );
                    if (result.success) {
                      toast(
                        `E2 Pattern-Bank gespeichert (${e2Inputs.length} Patterns${dropped ? `, ${dropped} übersprungen` : ""}): ${result.filePath}`,
                        { kind: "success" }
                      );
                    } else if (result.error && result.error !== "canceled") {
                      toast(`Speichern fehlgeschlagen: ${result.error}`, {
                        kind: "error",
                      });
                    }
                  } else {
                    const blob = new Blob([buffer], {
                      type: "application/octet-stream",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast(
                      `E2 Pattern-Bank heruntergeladen (${e2Inputs.length} Patterns${dropped ? `, ${dropped} übersprungen` : ""}): ${filename}`,
                      { kind: "success" }
                    );
                  }
                } catch (err) {
                  console.error("[E2 AllPat Export] error:", err);
                  toast(
                    `Export-Fehler: ${(err as Error)?.message ?? "unbekannt"}`,
                    { kind: "error" }
                  );
                }
              }}
              title="Alle Projekt-Patterns als KORG Electribe 2 Sampler Pattern-Bank exportieren (.e2sallpat, max. 250)"
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors inline-flex items-center gap-1"
              data-testid="e2-allpat-export"
            >
              📦 E2 Bank
              <ProLockBadge feature={PRO_FEATURE_E2_PATTERN_EXPORT} />
            </button>

            {/* Sample-Slicing (TASK-238 / v2.89) */}
            <button
              onClick={() => sliceImportRef.current?.click()}
              title="Sample slicen / choppen (WAV/MP3/OGG → 16 Performance-Pads)"
              className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
              data-testid="slice-sample"
            >
              ✂ Slice Sample
            </button>
            <input
              ref={sliceImportRef}
              type="file"
              accept="audio/*,.wav,.mp3,.ogg,.flac,.aiff,.m4a"
              className="hidden"
              onChange={handleSliceImport}
              data-testid="slice-sample-input"
            />
          </div>
        </div>

        {/* Pattern Morph */}
        <button
          onClick={() => setShowMorph(prev => !prev)}
          title="Pattern Morph"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showMorph
              ? "bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/50"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          ⟷ Morph
        </button>

        {/* Pattern Variation (v3.105.0) */}
        <button
          onClick={() => setShowVariation(prev => !prev)}
          title="Pattern-Variation-Generator"
          data-testid="toggle-pattern-variation"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showVariation
              ? "bg-accent-primary/20 text-accent-primary border border-accent-primary/50"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          ✨ Variation
        </button>

        {/* Envelope Follower Toggle */}
        <button
          onClick={() => setShowEnvFollower(prev => !prev)}
          title="Envelope Follower"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showEnvFollower
              ? "bg-accent-success/20 text-accent-success border border-accent-success/50"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          ∿ EF
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-border-color mx-1" />

        {/* Transpose */}
        <TransposeControl />

        {/* Note Repeat Toggle */}
        <button
          onClick={() => setShowNoteRepeat(prev => !prev)}
          title="Note Repeat (MPC-Style)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showNoteRepeat
              ? "bg-accent-primary/70 text-white"
              : "bg-bg-elevated text-text-dim hover:text-text-primary",
          ].join(" ")}
        >
          🔁 NR
        </button>

        {/* v3.97.0: MIDI-Step-Recorder Toggle */}
        <div className="flex items-center gap-1 bg-bg-base rounded border border-border-color px-1 py-0.5">
          <button
            data-testid="toggle-midi-step-recorder"
            onClick={() => stepRec.setEnabled(!stepRec.enabled)}
            title={
              stepRec.enabled
                ? `MIDI-Step-Recorder AKTIV — Step ${stepRec.currentStep + 1}/${pattern?.stepCount ?? 16}${stepRec.armedPartId ? "" : " (kein Channel armed)"}`
                : "MIDI-Step-Recorder: Note-On schreibt direkt in den aktuellen Step (Logic Pro Style)"
            }
            className={[
              "px-2 py-0.5 rounded text-[10px] font-bold transition-colors flex items-center gap-1",
              stepRec.enabled
                ? "bg-accent-danger/30 text-accent-danger border border-accent-danger/60"
                : "bg-bg-elevated text-text-dim hover:text-text-primary ",
            ].join(" ")}
          >
            {/* Rote LED wenn aktiv */}
            <span
              className={[
                "inline-block w-2 h-2 rounded-full",
                stepRec.enabled
                  ? "bg-accent-danger animate-pulse"
                  : "bg-text-dim/40",
              ].join(" ")}
              aria-hidden="true"
            />
            <span>📝 Step-Rec</span>
            {stepRec.enabled && (
              <span
                data-testid="midi-step-recorder-display"
                className="text-text-primary font-mono"
              >
                {stepRec.currentStep + 1}/{pattern?.stepCount ?? 16}
              </span>
            )}
          </button>
          {stepRec.enabled && (
            <button
              data-testid="midi-step-recorder-mode-toggle"
              onClick={() =>
                stepRec.setMode(
                  stepRec.mode === "overwrite" ? "overdub" : "overwrite"
                )
              }
              title={
                stepRec.mode === "overwrite"
                  ? "Mode: Overwrite — Step wird vor Write geleert"
                  : "Mode: Overdub — additiv, Velocity-Update wenn bereits aktiv"
              }
              className={[
                "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase transition-colors",
                stepRec.mode === "overwrite"
                  ? "bg-accent-danger/20 text-accent-danger"
                  : "bg-accent-success/20 text-accent-success",
              ].join(" ")}
            >
              {stepRec.mode === "overwrite" ? "OW" : "OD"}
            </button>
          )}
          {stepRec.enabled && stepRec.armedPartId && pattern && (
            <span
              className="text-[9px] text-text-muted max-w-[60px] truncate"
              title="Armed Channel"
            >
              ▸{" "}
              {pattern.parts.find(p => p.id === stepRec.armedPartId)?.name ??
                "?"}
            </span>
          )}
        </div>

        {/* Live-Looper Toggle (TASK-235 / v2.87) */}
        <button
          data-testid="toggle-looper-panel"
          onClick={() => setShowLooper(prev => !prev)}
          title="Live-Looper (RC-505 Style, 4 Loops)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showLooper
              ? "bg-accent-success/20 text-accent-success border border-accent-success/50"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          ⟲ Loop
        </button>

        {/* Kanal hinzufügen */}
        <button
          onClick={() => dm.addPart()}
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
          title="Kanal hinzufügen"
        >
          + Kanal
        </button>

        {/* Loop-Sampler: pattern-unabhängige Melodie-Loops + Vocal-One-Shots.
            Legt einen Audio-Track (loop bzw. one-shot) an, der frei über den
            Transport läuft und von Pattern-Wechseln nicht gestoppt wird. */}
        <button
          onClick={() => openLoopSamplerPicker("loop")}
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
          title="Melodie/Loop als pattern-unabhängige Spur laden (nahtlose Schleife)"
          data-testid="add-loop-sampler-loop"
        >
          🔁 Loop-Sampler
        </button>
        <button
          onClick={() => openLoopSamplerPicker("oneshot")}
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
          title="Vocal/One-Shot als pattern-unabhängige Spur laden (spielt einmal durch)"
          data-testid="add-loop-sampler-oneshot"
        >
          🎤 One-Shot
        </button>
        <input
          ref={loopSamplerInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac,.aiff,.m4a"
          className="hidden"
          onChange={handleLoopSamplerImport}
          data-testid="loop-sampler-input"
        />

        {/* v3.285: EIN Korg-Import-Button (ersetzt „📦 KORG Bank" + „📥 ESX
            Import"). Öffnet den Unified-Dialog: editierbare Pattern/Step-
            Vorschau → in Sequenzer laden ODER zu E2S konvertieren ODER Samples/
            Bank-Editor öffnen. .all (E2S) geht direkt in den Bank-Editor. */}
        <button
          onClick={() => esxImportInputRef.current?.click()}
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
          title="Korg importieren — ESX-1 (.esx/.ess) Patterns+Samples oder E2S (.all) Bank. Editierbare Vorschau, dann laden/konvertieren."
          data-testid="esx-import-open"
        >
          📥 Korg Import
        </button>
        <input
          ref={esxImportInputRef}
          type="file"
          accept=".esx,.ess,.all"
          className="hidden"
          onChange={handleEsxImportPick}
          data-testid="esx-import-input"
        />

        {/* Makro-Panel */}
        <button
          data-testid="toggle-macro-panel"
          onClick={() => setShowMacros(prev => !prev)}
          title="Makro-Steuerung (8 Makros)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showMacros
              ? "bg-accent-primary/20 text-accent-primary border border-accent-primary/40"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          M1–8
        </button>

        {/* Mute/Solo Bus Groups (v3.125/v3.126) */}
        <button
          data-testid="toggle-groups-panel"
          onClick={() => setShowGroups(prev => !prev)}
          title="Mute/Solo Bus-Groups (Drums/Synths/Vocals)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showGroups
              ? "bg-accent-success/20 text-accent-success border border-accent-success/40"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          🎚 Groups
        </button>

        {/* Polyrhythm Visualizer */}
        <button
          onClick={() => setShowPolyrhythm(prev => !prev)}
          title="Polyrhythm Visualizer"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showPolyrhythm
              ? "bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/40"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          ⬡ Poly
        </button>

        {/* v2.0.0: Mix-Assistent — analysiert das Pattern und gibt Mix-Tipps */}
        <button
          onClick={() => setShowMixAssistant(prev => !prev)}
          title="Mix-Assistent (regelbasiert + optional KI-Analyse)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showMixAssistant
              ? "bg-accent-success/20 text-accent-success border border-accent-success/40"
              : "bg-bg-elevated text-text-dim hover:text-text-primary ",
          ].join(" ")}
        >
          🧠 Mix
        </button>

        {/* Pattern Variations A/B/C/D — verknüpft mit usePatternVariationsStore */}
        <div
          className="flex items-center gap-0 bg-bg-base rounded border border-border-color"
          title="Pattern Variations — Variationen speichern & wechseln (geteilt mit Patterns-Tab)"
        >
          {(["A", "B", "C", "D"] as const).map((v, i) => {
            const varSet = pattern
              ? findSetContainingPattern(variationSets, pattern.id)
              : undefined;
            const slotId = varSet?.slots[v] ?? null;
            const hasSaved = slotId !== null;
            const isActive =
              !!varSet &&
              varSet.activeSlot === v &&
              hasSaved &&
              pattern?.id === slotId;
            const corners = i === 0 ? "rounded-l" : i === 3 ? "rounded-r" : "";
            return (
              <button
                key={v}
                data-testid={`seq-var-slot-${v}`}
                aria-pressed={isActive}
                onClick={() => {
                  if (!pattern) return;
                  if (!varSet) {
                    // Erste Nutzung: Variation-Set für das aktuelle Pattern anlegen
                    // (Slot A = aktuelles Pattern).
                    const created = createVariationSet(
                      pattern.id,
                      pattern.name,
                      pattern.id
                    );
                    if (v !== "A") {
                      // Direkt in den geklickten Slot kopieren + aktivieren.
                      const newId = dm.addPatternData({
                        ...pattern,
                        name: `${pattern.name} [${v}]`,
                      });
                      updateVariationSlot(created.basePatternId, v, newId);
                      setActiveVariation(created.basePatternId, v);
                      dm.setActivePattern(newId);
                    }
                    return;
                  }
                  if (slotId) {
                    // Gefüllter Slot → Live-Switch.
                    setActiveVariation(varSet.basePatternId, v);
                    dm.setActivePattern(slotId);
                  } else {
                    // Leerer Slot → aktuelles Pattern hineinkopieren + aktivieren.
                    const newId = dm.addPatternData({
                      ...pattern,
                      name: `${pattern.name} [${v}]`,
                    });
                    updateVariationSlot(varSet.basePatternId, v, newId);
                    setActiveVariation(varSet.basePatternId, v);
                    dm.setActivePattern(newId);
                  }
                }}
                className={[
                  `px-2 py-0.5 text-[10px] font-bold transition-colors ${corners}`,
                  isActive
                    ? "bg-accent-primary text-white"
                    : hasSaved
                      ? "bg-accent-primary/20 text-accent-primary"
                      : "text-text-dim hover:text-text-primary",
                ].join(" ")}
                title={
                  hasSaved
                    ? `Variation ${v} (gespeichert) — klick zum Wechseln`
                    : `Variation ${v} — klick zum Erstellen`
                }
              >
                {v}
              </button>
            );
          })}
        </div>

        {/* Live Pattern Edit */}
        {!isLiveEditing ? (
          <button
            onClick={dm.startLivePatternEdit}
            className="px-2 py-1 rounded text-[10px] font-bold bg-accent-danger/10 text-accent-danger border border-accent-danger/40 hover:bg-accent-danger/20 transition-colors"
            title="Live-Edit: Pattern live bearbeiten während Playback weiterläuft"
          >
            ● Live Edit
          </button>
        ) : null}
      </div>

      {/* ── Makro-Panel ──────────────────────────────────────────────────── */}
      {/* v1.94: Title gesetzt für prominente Close-Button-Discoverability */}
      {showMacros && (
        <ResizableDrumPanel
          storageKey="ss-panel-macros"
          defaultHeight={160}
          minHeight={100}
          maxHeight={280}
          title="Makros (8 × bindbar)"
          onClose={() => setShowMacros(false)}
        >
          <MacroPanel parts={pattern.parts} />
        </ResizableDrumPanel>
      )}

      {/* ── Mute/Solo Bus Groups (v3.126) ────────────────────────────────── */}
      {showGroups && (
        <ResizableDrumPanel
          storageKey="ss-panel-groups"
          defaultHeight={260}
          minHeight={180}
          maxHeight={500}
          title="Mute/Solo Bus-Groups"
          onClose={() => setShowGroups(false)}
        >
          <MuteSoloGroupPanel
            availableChannels={pattern.parts.map(p => ({
              id: p.id,
              name: p.name ?? p.id,
            }))}
            channelMutes={pattern.parts.reduce<Record<string, boolean>>(
              (acc, p) => {
                acc[p.id] = p.muted;
                return acc;
              },
              {}
            )}
            onClose={() => setShowGroups(false)}
          />
        </ResizableDrumPanel>
      )}

      {/* ── Note Repeat Panel ────────────────────────────────────────────── */}
      {/* BUG-008 Reaffirmation: KEIN title= damit der Inner-Panel-Header
          (inkl. Status-Info wie BPM) der einzige sichtbare Header ist.
          Close-Button rendert dank onClose unabhängig vom title. */}
      {showNoteRepeat && (
        <ResizableDrumPanel
          storageKey="ss-panel-notrepeat"
          defaultHeight={110}
          minHeight={80}
          maxHeight={240}
          onClose={() => setShowNoteRepeat(false)}
        >
          <NoteRepeatPanel bpm={effectiveBpm} compact={true} />
        </ResizableDrumPanel>
      )}

      {/* ── Live-Looper Panel (TASK-235 / v2.87) ─────────────────────────── */}
      {showLooper && (
        <ResizableDrumPanel
          storageKey="ss-panel-looper"
          defaultHeight={180}
          minHeight={140}
          maxHeight={320}
          onClose={() => setShowLooper(false)}
        >
          <LooperPanel onClose={() => setShowLooper(false)} />
        </ResizableDrumPanel>
      )}

      {/* ── Pattern Morph Panel ──────────────────────────────────────────── */}
      {showMorph && (
        <ResizableDrumPanel
          storageKey="ss-panel-morph"
          defaultHeight={160}
          minHeight={100}
          maxHeight={320}
          onClose={() => setShowMorph(false)}
        >
          <PatternMorphPanel
            patterns={dm.patterns}
            onApplyMorph={morphed => {
              const id = dm.addPatternData(morphed);
              dm.setActivePattern(id);
              setShowMorph(false);
            }}
          />
        </ResizableDrumPanel>
      )}

      {/* ── Pattern Variation Panel (v3.105.0) ────────────────────────────── */}
      {showVariation && (
        <ResizableDrumPanel
          storageKey="ss-panel-variation"
          defaultHeight={280}
          minHeight={200}
          maxHeight={420}
          onClose={() => setShowVariation(false)}
        >
          <PatternVariationPanel
            pattern={pattern}
            onApplyVariation={(source, config, suggestedName) => {
              const varied = applyVariationToPattern(
                source,
                config,
                suggestedName
              );
              const newId = dm.addPatternData(varied);
              return newId;
            }}
            onSwitchToPattern={id => {
              dm.setActivePattern(id);
            }}
            onClose={() => setShowVariation(false)}
          />
        </ResizableDrumPanel>
      )}

      {/* ── Envelope Follower Panel ──────────────────────────────────────── */}
      {showEnvFollower && (
        <ResizableDrumPanel
          storageKey="ss-panel-envfollower"
          defaultHeight={180}
          minHeight={120}
          maxHeight={400}
          onClose={() => setShowEnvFollower(false)}
        >
          <EnvelopeFollowerPanel parts={pattern.parts} />
        </ResizableDrumPanel>
      )}

      {/* ── v3.285: Single-Page Step-Grid (16/32/64/128 — ALLE auf einer Seite) ──
          Kein Page-Switcher mehr. Header + Kanal-Zeilen liegen in EINEM
          overflow-auto-Container mit gemeinsamer minWidth → horizontaler Scroll
          bewegt Header und Zeilen synchron (Spalten bleiben ausgerichtet). Der
          Header ist sticky und bleibt beim vertikalen Scrollen sichtbar. Bei 128
          Steps wird die Reihe breiter als der Viewport → horizontal scrollbar,
          Zellen behalten via minWidth eine klickbare Mindestbreite. */}
      {(() => {
        // Gutter (Kanal-Steuerung links) + Step-Spalten. Ab ~13px/Step wird die
        // Reihe bei 128 Steps breiter als der Viewport → Container scrollt.
        const GRID_GUTTER_PX = 296;
        const MIN_STEP_PX = 13;
        const gridMinWidth = GRID_GUTTER_PX + pattern.stepCount * MIN_STEP_PX;
        // Single-Page: immer ALLE Steps rendern (kein Page-Fenster mehr).
        const visibleStepRange = null;
        return (
          <div className="flex-1 overflow-auto min-h-0">
            <div style={{ minWidth: gridMinWidth }}>
              {/* Step-Grid Header (sticky — bleibt beim Scrollen oben) */}
              <div className="sticky top-0 z-10 flex items-center gap-1 px-2 py-1 bg-bg-panel border-b border-border-color/50">
                <div className="w-[88px] flex-shrink-0" />
                <div className="w-5 flex-shrink-0" />
                <div className="w-5 flex-shrink-0" />
                <div className="w-12 flex-shrink-0" />
                <div className="w-10 flex-shrink-0" />
                <div className="w-14 flex-shrink-0" />
                <div className="w-6 flex-shrink-0" />
                <div className="flex gap-[2px] flex-1 min-w-0">
                  <PlayheadStepNumberRow stepCount={pattern.stepCount} />
                </div>
              </div>

              {/* Kanal-Zeilen */}
              {pattern.parts.map((part, partIndex) => (
                <PlayheadChannelStrip
                  key={part.id}
                  part={part}
                  partIndex={partIndex}
                  stepCount={pattern.stepCount}
                  visibleStepRange={visibleStepRange}
                  isActive={dm.activePartId === part.id}
                  velocityMode={dm.velocityMode}
                  pitchMode={dm.pitchMode}
                  patternResolution={pattern.stepResolution}
                  fxPanelOpen={dm.fxPanelPartId === part.id}
                  samples={samples}
                  onToggleStep={stepIndex => dm.toggleStep(part.id, stepIndex)}
                  onSetVelocity={(stepIndex, v) =>
                    dm.setStepVelocity(part.id, stepIndex, v)
                  }
                  onSetPitch={(stepIndex, p) =>
                    dm.setStepPitch(part.id, stepIndex, p)
                  }
                  onMute={() => dm.setPartMuted(part.id, !part.muted)}
                  onSolo={e =>
                    dm.setPartSoloed(part.id, !part.soloed, !e.shiftKey)
                  }
                  onVolumeChange={v => dm.setPartVolume(part.id, v)}
                  onPanChange={v => dm.setPartPan(part.id, v)}
                  onSampleDrop={(url, name) =>
                    dm.setPartSample(part.id, url, name)
                  }
                  onFxChange={fx => {
                    dm.setPartFx(part.id, fx);
                    const updatedPart = { ...part, fx: { ...part.fx, ...fx } };
                    AudioEngine.updateChannelFx(part.id, updatedPart.fx);
                  }}
                  onFxToggle={() =>
                    dm.setFxPanelPartId(
                      dm.fxPanelPartId === part.id ? null : part.id
                    )
                  }
                  onResolutionChange={res =>
                    dm.setPartStepResolution(part.id, res)
                  }
                  onClick={() => dm.setActivePart(part.id)}
                  onPianoRollOpen={() => setPianoRollPartId(part.id)}
                  onStepSelect={stepIndex =>
                    setSelectedStep({ partId: part.id, stepIndex })
                  }
                  selectedStepIndex={
                    selectedStep?.partId === part.id
                      ? selectedStep.stepIndex
                      : null
                  }
                  onGranularOpen={() =>
                    setGranularPartId(prev =>
                      prev === part.id ? null : part.id
                    )
                  }
                  onSourceTypeChange={type =>
                    dm.setPartSourceType(part.id, type)
                  }
                  onColorChange={color => dm.setPartColor(part.id, color)}
                />
              ))}

              {/* ── Audio-Clip-Lanes (TASK-246, Option B) ──────────────────────
                  Continuous-Wellenform-Lanes für importierte/aufgenommene
                  Audio-Tracks. KEIN Step-Grid (continuous AudioTrackChannelData-
                  Modell). Eigene memoisierte Liste, die den useAudioTrackStore
                  selbst abonniert, damit Track-Add/Remove/Mute den memoisierten
                  DrumMachine nicht re-rendern. */}
              <AudioClipLaneList />
            </div>
          </div>
        );
      })()}

      {/* ── Step Inspector ───────────────────────────────────────────────── */}
      {selectedStep &&
        (() => {
          const insPart = pattern.parts.find(p => p.id === selectedStep.partId);
          if (!insPart) return null;
          return (
            <StepInspector
              partName={insPart.name}
              stepIndex={selectedStep.stepIndex}
              step={insPart.steps[selectedStep.stepIndex]}
              onSetVelocity={v =>
                dm.setStepVelocity(insPart.id, selectedStep.stepIndex, v)
              }
              onSetPitch={p =>
                dm.setStepPitch(insPart.id, selectedStep.stepIndex, p)
              }
              onSetProbability={p =>
                dm.setStepProbability(insPart.id, selectedStep.stepIndex, p)
              }
              onSetSlide={s =>
                dm.setStepSlide(insPart.id, selectedStep.stepIndex, s)
              }
              onSetCondition={c =>
                dm.setStepCondition(insPart.id, selectedStep.stepIndex, c)
              }
              onSetReverse={r =>
                dm.setStepReverse(insPart.id, selectedStep.stepIndex, r)
              }
              onSetParamLock={lock =>
                dm.setStepParamLock(insPart.id, selectedStep.stepIndex, lock)
              }
              onSetLength={len =>
                dm.setStepLength(insPart.id, selectedStep.stepIndex, len)
              }
              onSetChainNext={chain =>
                dm.setStepChainNext(insPart.id, selectedStep.stepIndex, chain)
              }
              onToggle={() => dm.toggleStep(insPart.id, selectedStep.stepIndex)}
              onClose={() => setSelectedStep(null)}
            />
          );
        })()}

      {/* ── Mix-Assistent (v2.0.0) ──────────────────────────────────────── */}
      {showMixAssistant &&
        (() => {
          const mixInput: MixAnalysisInput = {
            bpm,
            parts: pattern.parts.map(p => ({
              id: p.id,
              name: p.name,
              volume: Math.round((p.volume ?? 0.8) * 127),
              pan: Math.round((p.pan ?? 0) * 100),
              activeSteps: p.steps.filter(s => s.active).length,
              totalSteps: p.steps.length,
              filterCutoff: p.fx.filterEnabled ? p.fx.filterFreq : undefined,
              trackType: p.name.toLowerCase(),
            })),
            masterVolume: 100,
          };
          const handleApply = (rec: MixRecommendation) => {
            if (!rec.partId || rec.suggestedValue === undefined) return;
            if (rec.targetProperty === "volume") {
              dm.setPartVolume(
                rec.partId,
                Math.max(0, Math.min(1, rec.suggestedValue / 127))
              );
            } else if (rec.targetProperty === "pan") {
              dm.setPartPan(
                rec.partId,
                Math.max(-1, Math.min(1, rec.suggestedValue / 100))
              );
            } else if (rec.targetProperty === "filterCutoff") {
              dm.setPartFx(rec.partId, {
                filterEnabled: true,
                filterFreq: rec.suggestedValue,
              });
            }
          };
          return (
            <ResizableDrumPanel
              storageKey="ss-panel-mix-assistant"
              defaultHeight={360}
              minHeight={200}
              maxHeight={620}
              title="🧠 Mix-Assistent"
              onClose={() => setShowMixAssistant(false)}
            >
              <MixAssistantPanel
                input={mixInput}
                onApply={handleApply}
                onClose={() => setShowMixAssistant(false)}
              />
            </ResizableDrumPanel>
          );
        })()}

      {/* ── Granular Synth Panel ─────────────────────────────────────────── */}
      {granularPartId &&
        (() => {
          const grPart = pattern.parts.find(p => p.id === granularPartId);
          if (!grPart) return null;
          // v3.17: Part-Index 0..15 fuer OmniTribe-NRPN herausfinden.
          const grPartIndex = pattern.parts.findIndex(
            p => p.id === granularPartId
          );
          return (
            // v1.94: title gesetzt damit der Header (mit Close-Button) prominent ist.
            // User-Feedback aus neue_todos.md: 'alle fenster sollen mit X zumachbar
            // sein, granular und polyrhythm' — der X war zwar da, aber bei title=undefined
            // ohne Beschriftung schwer auffindbar.
            <ResizableDrumPanel
              storageKey="ss-panel-granular"
              defaultHeight={320}
              minHeight={200}
              maxHeight={520}
              title={`Granular: ${grPart.name}`}
              onClose={() => setGranularPartId(null)}
            >
              <GranularSynthPanel
                partId={grPart.id}
                partIndex={grPartIndex >= 0 ? grPartIndex : 0}
                sampleUrl={grPart.sampleUrl}
                params={{
                  ...DEFAULT_GRANULAR_PARAMS,
                  ...grPart.granularParams,
                }}
                onChange={params => dm.setPartGranularParams(grPart.id, params)}
              />
            </ResizableDrumPanel>
          );
        })()}

      {/* ── Polyrhythm Visualizer ────────────────────────────────────────── */}
      {showPolyrhythm && (
        <ResizableDrumPanel
          storageKey="ss-panel-polyrhythm"
          defaultHeight={180}
          minHeight={100}
          maxHeight={380}
          title="Polyrhythm-Visualizer"
          onClose={() => setShowPolyrhythm(false)}
        >
          <PlayheadPolyrhythmVisualizer pattern={pattern} />
        </ResizableDrumPanel>
      )}

      {/* ── Status-Leiste ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1 bg-bg-panel border-t border-border-color text-[9px] text-text-dim">
        <span>{pattern.parts.length} Kanäle</span>
        <span>·</span>
        <span>{pattern.stepCount} Steps</span>
        <span>·</span>
        <span>{pattern.stepResolution}</span>
        <span>·</span>
        <span>
          {effectiveBpm} BPM{pattern.bpm !== null ? " (eigenes)" : ""}
        </span>
        <span>·</span>
        <PlayheadFooterStep stepCount={pattern.stepCount} />
        {dm.velocityMode && (
          <>
            <span>·</span>
            <span className="text-accent-secondary">VELOCITY-MODUS</span>
          </>
        )}
        {dm.pitchMode && (
          <>
            <span>·</span>
            <span className="text-accent-secondary">PITCH-MODUS</span>
          </>
        )}
        {/* Time-Stretch für aktiven Kanal */}
        {dm.activePartId &&
          (() => {
            const activePart = pattern.parts.find(
              p => p.id === dm.activePartId
            );
            if (!activePart) return null;
            const stretch = activePart.stretchRatio ?? 1;
            return (
              <>
                <span>·</span>
                <span>Stretch:</span>
                <input
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={stretch}
                  onChange={e =>
                    dm.setPartStretchRatio(
                      dm.activePartId!,
                      Number(e.target.value)
                    )
                  }
                  className="w-16 accent-accent-primary cursor-pointer"
                  title={`Time-Stretch: ${stretch.toFixed(2)}× (${stretch >= 1 ? `+${((stretch - 1) * 100).toFixed(0)}%` : `${((1 - stretch) * 100).toFixed(0)}% kürzer`})`}
                />
                <button
                  onClick={() => dm.setPartStretchRatio(dm.activePartId!, 1)}
                  className="hover:text-accent-danger transition-colors"
                >
                  {stretch !== 1 ? `${stretch.toFixed(2)}× ×` : "1×"}
                </button>
                {/* Micro-Timing */}
                <span>·</span>
                <span title="Micro-Timing (ms vor/hinter dem Beat)">μT:</span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={activePart.microTiming ?? 0}
                  onChange={e =>
                    dm.setPartMicroTiming(
                      dm.activePartId!,
                      Number(e.target.value)
                    )
                  }
                  className="w-14 accent-accent-secondary cursor-pointer"
                  title={`Micro-Timing: ${activePart.microTiming ?? 0}ms`}
                />
                {(activePart.microTiming ?? 0) !== 0 && (
                  <button
                    onClick={() => dm.setPartMicroTiming(dm.activePartId!, 0)}
                    className="hover:text-accent-danger transition-colors text-accent-secondary"
                  >
                    {(activePart.microTiming ?? 0) > 0 ? "+" : ""}
                    {activePart.microTiming}ms ×
                  </button>
                )}
              </>
            );
          })()}
      </div>

      {/* ── Piano Roll Modal ─────────────────────────────────────────────── */}
      {pianoRollPartId &&
        (() => {
          const prPart = pattern.parts.find(p => p.id === pianoRollPartId);
          return (
            <PianoRollModal
              partId={pianoRollPartId}
              partName={prPart?.name ?? pianoRollPartId}
              isOpen={true}
              onClose={() => setPianoRollPartId(null)}
            />
          );
        })()}

      {/* ── Electribe-Bank-Pattern-Picker (TASK-237, v3.11 multi-pattern) ─── */}
      {electribePicker && (
        <ElectribePickerModal
          picker={electribePicker}
          onSelect={p => {
            importElectribePatternIntoActive(
              p,
              electribePicker.fileName,
              electribePicker.sampleLink
            );
            setElectribePicker(null);
          }}
          onSelectAll={pats => {
            importElectribeBankAsPatterns(
              pats,
              electribePicker.fileName,
              electribePicker.sampleLink
            );
            setElectribePicker(null);
          }}
          onClose={() => setElectribePicker(null)}
        />
      )}

      {/* ── Sample-Slice-Editor (TASK-238 / v2.89) ──────────────────────── */}
      {sliceEditor && (
        <SampleSliceEditor
          sampleName={sliceEditor.sampleName}
          channelData={sliceEditor.channelData}
          sampleRate={sliceEditor.sampleRate}
          onApply={handleSlicesApply}
          onClose={() => setSliceEditor(null)}
          onReplaceSample={handleSliceFile}
        />
      )}

      {/* ── ESX-Import (Unified-Dialog) ─────────────────────────────────── */}
      <EsxImportController
        file={esxImportFile}
        onClose={() => setEsxImportFile(null)}
        onLoadResult={handleEsxLoadResult}
        onLoadSong={handleEsxLoadSong}
        onToast={(m, kind) => toast(m, { kind })}
      />

      {/* ── Pattern als Bild exportieren (v3.66.0) ──────────────────────── */}
      <PatternImageExportModal
        isOpen={patternImageExport !== null}
        pattern={patternImageExport}
        onClose={() => setPatternImageExport(null)}
      />

      {/* ── Pattern Compare/Diff Modal (v3.91.0) ────────────────────────── */}
      <PatternCompareModal
        isOpen={compareModalAId !== null}
        patterns={dm.patterns}
        initialAId={compareModalAId}
        onClose={() => setCompareModalAId(null)}
      />

      {/* ── Chord-Suggestion Floating-Panel (v3.176.0) ──────────────────── */}
      {showChordPanel && (
        <div
          className="fixed bottom-4 right-4 z-40 w-80 shadow-2xl"
          data-testid="chord-panel-floating"
        >
          <ChordSuggestionPanel
            visible={true}
            count={4}
            initialMood="happy"
            onChordSelected={chord => {
              // Apply: Chord als Arpeggio auf die ersten Steps des aktiven Parts
              // legen (Steps sind monophon → eine Note pro Step). Pitch relativ zu
              // C4 (MIDI 60), wie die AudioEngine Sample-Pitch erwartet. Restliche
              // Steps bleiben erhalten.
              const pat = dm.getActivePattern();
              const part =
                pat?.parts.find(p => p.id === dm.activePartId) ?? pat?.parts[0];
              if (!part) {
                toast("Kein Part aktiv — Chord nicht angewendet", {
                  kind: "warning",
                });
                return;
              }
              const active = part.steps.map(s => s.active);
              const velocities = part.steps.map(s => s.velocity ?? 100);
              const pitches = part.steps.map(s => s.pitch ?? 0);
              let placed = 0;
              chord.notes.forEach((note, i) => {
                if (i < active.length) {
                  active[i] = true;
                  pitches[i] = note - 60;
                  velocities[i] = 100;
                  placed++;
                }
              });
              dm.setPartSteps(part.id, active, velocities, pitches);
              toast(
                `Akkord ${chord.name} als Arpeggio (${placed} Steps) auf „${part.name}" gelegt`,
                { kind: "success", duration: 2800 }
              );
            }}
          />
          <button
            type="button"
            onClick={() => setShowChordPanel(false)}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-accent-danger text-white text-xs shadow-lg hover:scale-110 transition-transform"
            title="Schließen"
            data-testid="chord-panel-close"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * TASK-247: memoisierter Export. App.tsx besitzt den dm-State und erzeugt bei
 * jedem Playback-Step ein frisches dm-Objekt → App re-rendert → DrumMachine
 * würde komplett neu rendern. Der Comparator überspringt den Rerender, wenn
 * sich AUSSCHLIESSLICH dm.currentStep unterscheidet; der Playhead läuft über
 * usePlayheadStore in kleinen abonnierten Kindern weiter.
 */
export const DrumMachine = memo(
  DrumMachineInner,
  drumMachinePropsAreEqual as unknown as (
    p: Readonly<Props>,
    n: Readonly<Props>
  ) => boolean
);
