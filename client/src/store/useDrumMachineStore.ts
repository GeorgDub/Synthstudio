/**
 * Synthstudio – useDrumMachineStore.ts  (v2)
 *
 * Erweiterter State für die Drum Machine:
 * - 9 Kanäle (Kick, Snare, Hi-Hat cl./op., Clap, Tom Hi/Lo, Perc, FX)
 * - Per-Kanal Effekt-State (Filter, Reverb, Delay, Distortion, Compressor, EQ)
 * - Step-Auflösung (1/8, 1/16, 1/32) pro Pattern und pro Kanal
 * - BPM-Sync: Patterns können eigenes BPM oder globales BPM nutzen
 * - Undo/Redo (bis 50 Schritte)
 */

import { useState, useCallback, useRef } from "react";
import type { PatternData, PartData, StepData, StepResolution, ChannelFx, StepCondition } from "../audio/AudioEngine";
import { DEFAULT_CHANNEL_FX } from "../audio/AudioEngine";
import { euclidean } from "../utils/euclidean";
import { clampStepLength } from "../utils/polymeter";
import { quantizeSteps } from "../utils/quantizeGrid";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface DrumMachineState {
  patterns: PatternData[];
  activePatternId: string;
  playbackPatternId: string | null;
  liveEditSourcePatternId: string | null;
  activePartId: string | null;
  currentStep: number;
  velocityMode: boolean;
  pitchMode: boolean;
  fxPanelPartId: string | null;
  /** Wenn true → commitLivePatternEdit() wird beim nächsten Bar-Anfang ausgelöst */
  commitPending: boolean;
  /** Pattern-IDs die zusätzlich zum aktiven Pattern abgespielt werden */
  stackedPatternIds: string[];
}

export interface DrumMachineActions {
  addPattern: (name?: string) => void;
  /** Fügt ein vollständiges Pattern-Objekt hinzu (z.B. Morph-Resultat). Gibt die zugewiesene ID zurück. */
  addPatternData: (pattern: PatternData) => string;
  removePattern: (id: string) => void;
  renamePattern: (id: string, name: string) => void;
  setActivePattern: (id: string) => void;
  duplicatePattern: (id: string) => void;
  /**
   * v2.4: Kopiert Sample-Belegung + FX + Volume/Pan eines Source-Patterns
   * in ein Target-Pattern. Steps bleiben unverändert. Matches Parts per
   * Index — d.h. Part 1 von Source → Part 1 von Target, etc.
   * No-op wenn Source/Target nicht existieren.
   */
  copySamplesFromPattern: (sourcePatternId: string, targetPatternId: string) => void;
  /**
   * v2.8: Sortiert Patterns im Array neu — verschiebt das Pattern an
   * fromIndex an die Position toIndex. Pattern-IDs bleiben stabil,
   * activePatternId folgt dem Pattern (nicht dem Index).
   */
  reorderPatterns: (fromIndex: number, toIndex: number) => void;
  startLivePatternEdit: () => void;
  commitLivePatternEdit: () => void;
  cancelLivePatternEdit: () => void;
  /** Markiert Commit als ausstehend – wird beim nächsten Bar-Anfang ausgeführt */
  scheduleCommit: () => void;
  setPatternBpm: (id: string, bpm: number | null) => void;
  setPatternBpmRatio: (id: string, ratio: number | null) => void;
  stackedPatternIds: string[];
  toggleStackedPattern: (id: string) => void;
  clearStackedPatterns: () => void;
  setPatternBpmTransitionBars: (id: string, bars: number) => void;
  setPatternStepResolution: (id: string, res: StepResolution) => void;
  setPatternFollowAction: (id: string, action: import("../audio/AudioEngine").FollowAction | undefined) => void;

  addPart: (name?: string) => void;
  removePart: (id: string) => void;
  renamePart: (id: string, name: string) => void;
  setPartSample: (partId: string, sampleUrl: string, sampleName?: string) => void;
  setPartMuted: (partId: string, muted: boolean) => void;
  /**
   * Setzt den Solo-Status eines Drum-Parts.
   * @param exclusive Default `true` (Radio-Button-Verhalten — un-solo't alle
   *                  anderen Parts). `false` = additiv (toggle nur diesen Part,
   *                  andere bleiben unverändert; DAW-Konvention).
   *                  UI: Click = exclusive, Shift+Click = additive (FOLLOWUP-102-3).
   */
  setPartSoloed: (partId: string, soloed: boolean, exclusive?: boolean) => void;
  setPartVolume: (partId: string, volume: number) => void;
  setPartPan: (partId: string, pan: number) => void;
  setPartStepResolution: (partId: string, res: StepResolution | undefined) => void;
  /** Polymeter: setzt eine eigene Loop-Länge für den Part (undefined = Pattern-Default). */
  setPartStepLength: (partId: string, length: number | undefined) => void;
  setActivePart: (partId: string | null) => void;
  movePart: (fromIndex: number, toIndex: number) => void;

  setPartFx: (partId: string, fx: Partial<ChannelFx>) => void;
  setFxPanelPartId: (partId: string | null) => void;
  setPartSourceType: (partId: string, type: "sample" | "wavetable" | "fm" | "granular") => void;
  setPartMicroTiming: (partId: string, offsetMs: number) => void;
  setPartGranularParams: (partId: string, params: Partial<import("../audio/GranularEngine").GranularParams>) => void;
  setPartStretchRatio: (partId: string, ratio: number) => void;
  /**
   * Wendet einen kompletten Patch (v2.16 Sound-Library) auf einen Part an —
   * `applyPatch()` aus utils/patchSerialize in einem Store-Update gebündelt.
   * `replaceFx=false` bewahrt die existierende FX-Chain.
   */
  applyPatchToPart: (partId: string, patch: import("@/utils/patchSerialize").Patch, options?: { replaceFx?: boolean }) => void;

  toggleStep: (partId: string, stepIndex: number) => void;
  setPartSteps: (partId: string, steps: boolean[], velocities?: number[]) => void;
  setStepVelocity: (partId: string, stepIndex: number, velocity: number) => void;
  setStepPitch: (partId: string, stepIndex: number, pitch: number) => void;
  setStepProbability: (partId: string, stepIndex: number, probability: number) => void;
  /** v2.24: Per-Step Slide/Glide-Toggle (TB-303-Style). Wirkt auf den NÄCHSTEN Step. */
  setStepSlide: (partId: string, stepIndex: number, slide: boolean) => void;
  setStepCondition: (partId: string, stepIndex: number, condition: StepCondition) => void;
  setStepReverse: (partId: string, stepIndex: number, reverse: boolean) => void;
  setStepParamLock: (partId: string, stepIndex: number, lock: import("../audio/AudioEngine").StepParamLock | undefined) => void;
  setStepLength: (partId: string, stepIndex: number, length: number) => void;
  setStepChainNext: (partId: string, stepIndex: number, chain: "up" | "down" | "none" | undefined) => void;
  quantizePartSteps: (partId: string, grid: import("../utils/quantizeGrid").QuantizeGrid, strength: number) => void;
  setPartEuclidean: (partId: string, hits: number, steps: number, rotation?: number) => void;
  clearPattern: () => void;
  /** Vollständiger Reset auf den initialen Pattern-State (für 'Neues Projekt'). */
  resetAll: () => void;
  fillPattern: (partId: string, density?: number) => void;
  randomizePattern: (partId: string) => void;
  shiftPattern: (partId: string, direction: "left" | "right") => void;

  setStepCount: (count: 16 | 32) => void;
  setCurrentStep: (step: number) => void;
  setVelocityMode: (active: boolean) => void;
  setPitchMode: (active: boolean) => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  getActivePattern: () => PatternData | undefined;
  getPlaybackPattern: () => PatternData | undefined;
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeSteps(count: number): StepData[] {
  return Array.from({ length: count }, () => ({ active: false, velocity: 100, pitch: 0 }));
}

function makePart(name: string, stepCount: number): PartData {
  return {
    id: makeId(),
    name,
    sampleUrl: undefined,
    muted: false,
    soloed: false,
    volume: 1.0,
    pan: 0,
    stepResolution: undefined,
    steps: makeSteps(stepCount),
    fx: { ...DEFAULT_CHANNEL_FX },
  };
}

function clonePatternForInsert(pattern: PatternData, name: string, id = makeId()): PatternData {
  const clone = JSON.parse(JSON.stringify(pattern)) as PatternData;
  return {
    ...clone,
    id,
    name,
    parts: clone.parts.map(part => ({ ...part, id: makeId() })),
  };
}

/**
 * v2.50 (FOLLOWUP-102-3): Pure transform für setPartSoloed-Logik.
 * Extrahiert damit das exclusive-vs-additive-Verhalten ohne React-Renderer
 * direkt testbar ist.
 *
 * @param patterns  Aktueller Patterns-Stack (z.B. von updatePatterns).
 * @param partId    Part der getoggelt wird.
 * @param soloed    Neuer soloed-Status für diesen Part.
 * @param exclusive true (Default, Radio-Button): un-solo alle anderen Parts in
 *                  jedem Pattern. false (additive, DAW-Konvention): andere
 *                  Parts bleiben unverändert; nur der Ziel-Part wird gesetzt.
 */
export function applySoloUpdate(
  patterns: PatternData[],
  partId: string,
  soloed: boolean,
  exclusive: boolean,
): PatternData[] {
  return patterns.map(p => ({
    ...p,
    parts: p.parts.map(pt => {
      if (pt.id === partId) return { ...pt, soloed };
      return exclusive ? { ...pt, soloed: false } : pt;
    }),
  }));
}

const DEFAULT_PART_NAMES = [
  "Kick", "Snare", "Hi-Hat cl.", "Hi-Hat op.",
  "Clap", "Tom Hi", "Tom Lo", "Perc", "FX",
];

function makePattern(name: string, stepCount: 16 | 32 = 16): PatternData {
  return {
    id: makeId(),
    name,
    stepCount,
    stepResolution: "1/16",
    bpm: null,
    parts: DEFAULT_PART_NAMES.map(n => makePart(n, stepCount)),
  };
}

const INITIAL_PATTERN = makePattern("Pattern 1");

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDrumMachineStore(): DrumMachineState & DrumMachineActions {
  const [state, setState] = useState<DrumMachineState>({
    patterns: [INITIAL_PATTERN],
    activePatternId: INITIAL_PATTERN.id,
    playbackPatternId: null,
    liveEditSourcePatternId: null,
    activePartId: INITIAL_PATTERN.parts[0]?.id ?? null,
    currentStep: 0,
    velocityMode: false,
    pitchMode: false,
    fxPanelPartId: null,
    commitPending: false,
    stackedPatternIds: [],
  });

  const undoStack = useRef<PatternData[][]>([]);
  const redoStack = useRef<PatternData[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushUndo = useCallback((patterns: PatternData[]) => {
    undoStack.current.push(JSON.parse(JSON.stringify(patterns)));
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const updatePatterns = useCallback(
    (updater: (patterns: PatternData[]) => PatternData[], withUndo = true) => {
      setState(prev => {
        if (withUndo) pushUndo(prev.patterns);
        const next = updater(JSON.parse(JSON.stringify(prev.patterns)));
        return { ...prev, patterns: next };
      });
    },
    [pushUndo]
  );

  // ── Pattern ───────────────────────────────────────────────────────────────

  const addPattern = useCallback((name?: string) => {
    setState(prev => {
      const stepCount = prev.patterns.find(p => p.id === prev.activePatternId)?.stepCount ?? 16;
      const p = makePattern(name ?? `Pattern ${prev.patterns.length + 1}`, stepCount);
      return {
        ...prev,
        patterns: [...prev.patterns, p],
        activePatternId: p.id,
        playbackPatternId: prev.playbackPatternId,
        activePartId: p.parts[0]?.id ?? null,
      };
    });
  }, []);

  const addPatternData = useCallback((pattern: PatternData): string => {
    const id = pattern.id || makeId();
    const newPattern = clonePatternForInsert(pattern, pattern.name, id);
    setState(prev => ({
      ...prev,
      patterns: [...prev.patterns, newPattern],
      activePatternId: id,
      activePartId: newPattern.parts[0]?.id ?? null,
    }));
    return id;
  }, []);

  const removePattern = useCallback((id: string) => {
    setState(prev => {
      if (prev.playbackPatternId === id) return prev;
      if (prev.patterns.length <= 1) return prev;
      const next = prev.patterns.filter(p => p.id !== id);
      return {
        ...prev,
        patterns: next,
        activePatternId: prev.activePatternId === id ? next[0].id : prev.activePatternId,
        liveEditSourcePatternId: prev.liveEditSourcePatternId === id ? null : prev.liveEditSourcePatternId,
      };
    });
  }, []);

  const renamePattern = useCallback((id: string, name: string) => {
    updatePatterns(ps => ps.map(p => p.id === id ? { ...p, name } : p), false);
  }, [updatePatterns]);

  const setActivePattern = useCallback((id: string) => {
    setState(prev => {
      const pattern = prev.patterns.find(p => p.id === id);
      if (!pattern) return prev;
      // Während Live-Edit darf nicht auf das eingefrorene Playback-Pattern gewechselt werden.
      // Der Nutzer muss im Draft bleiben, sonst würde er das Original bearbeiten.
      if (prev.liveEditSourcePatternId && id === prev.playbackPatternId) return prev;
      return {
        ...prev,
        activePatternId: id,
        activePartId: pattern.parts[0]?.id ?? null,
      };
    });
  }, []);

  const duplicatePattern = useCallback((id: string) => {
    setState(prev => {
      const src = prev.patterns.find(p => p.id === id);
      if (!src) return prev;
      const copy = clonePatternForInsert(src, `${src.name} (Kopie)`);
      return {
        ...prev,
        patterns: [...prev.patterns, copy],
        activePatternId: copy.id,
        activePartId: copy.parts[0]?.id ?? null,
      };
    });
  }, []);

  /**
   * v2.4: Übernimmt Sample-Belegung + FX + Volume/Pan von einem Source-Pattern
   * in ein Target-Pattern. Steps bleiben unverändert. Wird per Index gematched
   * (Part 0 → Part 0 etc.). Keine Änderung wenn Source oder Target unbekannt
   * oder identisch.
   *
   * Sinn: User hat in Pattern 1 sein perfektes Drum-Kit + FX-Setup aufgebaut
   * und will jetzt nur die Patterns 2-8 weiter-arrangieren ohne jedes Mal
   * 8 Samples + 8 FX-Settings neu zu setzen.
   */
  /**
   * v2.8: Pattern-Reorder. fromIndex/toIndex sind 0-basierte Array-Positionen.
   * No-op wenn beide gleich oder einer out-of-range.
   * activePatternId/playbackPatternId bleiben erhalten — die zeigen auf die
   * Pattern-ID, nicht den Index.
   */
  const reorderPatterns = useCallback((fromIndex: number, toIndex: number) => {
    setState(prev => {
      const len = prev.patterns.length;
      if (fromIndex === toIndex) return prev;
      if (fromIndex < 0 || fromIndex >= len) return prev;
      if (toIndex < 0 || toIndex >= len) return prev;
      const next = [...prev.patterns];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...prev, patterns: next };
    });
  }, []);

  const copySamplesFromPattern = useCallback((sourcePatternId: string, targetPatternId: string) => {
    if (sourcePatternId === targetPatternId) return;
    updatePatterns(ps => {
      const source = ps.find(p => p.id === sourcePatternId);
      if (!source) return ps;
      return ps.map(p => {
        if (p.id !== targetPatternId) return p;
        return {
          ...p,
          parts: p.parts.map((targetPart, idx) => {
            const sourcePart = source.parts[idx];
            if (!sourcePart) return targetPart; // mehr Parts im Target als in Source
            return {
              ...targetPart,
              // Sample-Belegung + Synth/Granular-Setup
              sampleUrl: sourcePart.sampleUrl,
              sampleName: sourcePart.sampleName,
              sourceType: sourcePart.sourceType,
              synthParams: sourcePart.synthParams,
              granularParams: sourcePart.granularParams,
              stretchRatio: sourcePart.stretchRatio,
              microTiming: sourcePart.microTiming,
              // Mixer-Settings
              volume: sourcePart.volume,
              pan: sourcePart.pan,
              // FX-Chain (komplett übernehmen)
              fx: { ...sourcePart.fx },
              // Steps + ID + Mute/Solo NICHT übernehmen — User will nur die Sounds
            };
          }),
        };
      });
    }, true);
  }, [updatePatterns]);

  const startLivePatternEdit = useCallback(() => {
    setState(prev => {
      if (prev.liveEditSourcePatternId) return prev;
      const sourceId = prev.playbackPatternId ?? prev.activePatternId;
      const source = prev.patterns.find(p => p.id === sourceId);
      if (!source) return prev;
      const draft = clonePatternForInsert(source, `${source.name} [DRAFT]`);
      return {
        ...prev,
        patterns: [...prev.patterns, draft],
        playbackPatternId: source.id,
        liveEditSourcePatternId: source.id,
        activePatternId: draft.id,
        activePartId: draft.parts[0]?.id ?? null,
      };
    });
  }, []);

  const commitLivePatternEdit = useCallback(() => {
    setState(prev => {
      if (!prev.liveEditSourcePatternId) return prev;
      const sourceId = prev.liveEditSourcePatternId;
      const source = prev.patterns.find(p => p.id === sourceId);
      const draftId = prev.activePatternId;
      // Draft übernimmt den Namen des Originals (kein "Live Edit"-Suffix dauerhaft)
      const nextPatterns = prev.patterns
        .filter(p => p.id !== sourceId)           // Original entfernen
        .map(p => p.id === draftId && source      // Draft umbenennen → Original-Name
          ? { ...p, name: source.name }
          : p
        );
      return {
        ...prev,
        patterns: nextPatterns,
        playbackPatternId: null,
        liveEditSourcePatternId: null,
        commitPending: false,
      };
    });
  }, []);

  const scheduleCommit = useCallback(() => {
    setState(prev => prev.liveEditSourcePatternId ? { ...prev, commitPending: true } : prev);
  }, []);

  const cancelLivePatternEdit = useCallback(() => {
    setState(prev => {
      const sourceId = prev.liveEditSourcePatternId;
      if (!sourceId) return prev;
      const source = prev.patterns.find(p => p.id === sourceId);
      // Draft (activePatternId) wegwerfen, zurück zum Original
      const nextPatterns = prev.patterns.length > 1
        ? prev.patterns.filter(p => p.id !== prev.activePatternId)
        : prev.patterns;
      return {
        ...prev,
        patterns: nextPatterns,
        activePatternId: source?.id ?? nextPatterns[0]?.id ?? prev.activePatternId,
        activePartId: source?.parts[0]?.id ?? nextPatterns[0]?.parts[0]?.id ?? null,
        playbackPatternId: null,
        liveEditSourcePatternId: null,
        commitPending: false,
      };
    });
  }, []);

  const setPatternBpm = useCallback((id: string, bpm: number | null) => {
    updatePatterns(ps => ps.map(p => p.id === id ? { ...p, bpm } : p), false);
  }, [updatePatterns]);

  const toggleStackedPattern = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      stackedPatternIds: prev.stackedPatternIds.includes(id)
        ? prev.stackedPatternIds.filter(x => x !== id)
        : [...prev.stackedPatternIds, id],
    }));
    // AudioEngine sync handled via useEffect in App.tsx
  }, []);

  const clearStackedPatterns = useCallback(() => {
    setState(prev => ({ ...prev, stackedPatternIds: [] }));
  }, []);

  const setPatternBpmRatio = useCallback((id: string, ratio: number | null) => {
    updatePatterns(ps => ps.map(p => p.id === id ? { ...p, bpmRatio: ratio } : p), false);
  }, [updatePatterns]);

  const setPatternBpmTransitionBars = useCallback((id: string, bars: number) => {
    updatePatterns(ps => ps.map(p => p.id === id ? { ...p, bpmTransitionBars: bars } : p), false);
  }, [updatePatterns]);

  const setPatternFollowAction = useCallback((id: string, action: import("../audio/AudioEngine").FollowAction | undefined) => {
    updatePatterns(ps => ps.map(p => p.id === id ? { ...p, followAction: action } : p), false);
  }, [updatePatterns]);

  const setPatternStepResolution = useCallback((id: string, res: StepResolution) => {
    updatePatterns(ps => ps.map(p => p.id === id ? { ...p, stepResolution: res } : p), false);
  }, [updatePatterns]);

  // ── Parts ─────────────────────────────────────────────────────────────────

  const addPart = useCallback((name?: string) => {
    setState(prev => {
      const pattern = prev.patterns.find(p => p.id === prev.activePatternId);
      if (!pattern) return prev;
      pushUndo(prev.patterns);
      const part = makePart(name ?? `Kanal ${pattern.parts.length + 1}`, pattern.stepCount);
      return {
        ...prev,
        patterns: prev.patterns.map(p =>
          p.id === prev.activePatternId ? { ...p, parts: [...p.parts, part] } : p
        ),
        activePartId: part.id,
      };
    });
  }, [pushUndo]);

  const removePart = useCallback((id: string) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.length > 1 ? p.parts.filter(pt => pt.id !== id) : p.parts,
    })));
  }, [updatePatterns]);

  const renamePart = useCallback((id: string, name: string) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === id ? { ...pt, name } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartSample = useCallback((partId: string, sampleUrl: string, sampleName?: string) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId
        ? { ...pt, sampleUrl, sampleName: sampleName ?? pt.sampleName }
        : pt
      ),
    })));
  }, [updatePatterns]);

  const setPartMuted = useCallback((partId: string, muted: boolean) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId ? { ...pt, muted } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartSoloed = useCallback((partId: string, soloed: boolean, exclusive = true) => {
    // v2.50: pure transform applySoloUpdate (testbar ohne React-Renderer).
    updatePatterns(ps => applySoloUpdate(ps, partId, soloed, exclusive), false);
    // Cross-Store Solo (FOLLOWUP-102/B): Notify Mixer-Layer (Audio-Tracks)
    // damit sie bei Drum-Solo mit-stummgeschaltet werden. Custom-Event statt
    // direkter AudioEngine-Import um den Store engine-agnostisch zu halten —
    // App.tsx hat zusätzlich eine useEffect-Bridge (zuverlaessiger Pfad nach
    // React-Commit), das Event ist die discoverable/testbare Sekundär-Quelle.
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      try {
        window.dispatchEvent(
          new CustomEvent("synthstudio:drum-solo-changed", {
            detail: { partId, soloed },
          }),
        );
      } catch {
        /* CustomEvent nicht verfuegbar (test environment) — kein Problem,
           der useEffect-Pfad in App.tsx ist primaer. */
      }
    }
  }, [updatePatterns]);

  const setPartVolume = useCallback((partId: string, volume: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId ? { ...pt, volume } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartPan = useCallback((partId: string, pan: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId ? { ...pt, pan } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartStepResolution = useCallback((partId: string, res: StepResolution | undefined) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId ? { ...pt, stepResolution: res } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartStepLength = useCallback((partId: string, length: number | undefined) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        // Doppel-Cap: max ist sowohl pattern.stepCount als auch part.steps.length
        // (verhindert dass stepLength außerhalb des Steps-Arrays liegt)
        const maxLen = Math.min(p.stepCount, pt.steps.length);
        return { ...pt, stepLength: clampStepLength(length, maxLen) };
      }),
    })));
  }, [updatePatterns]);

  const setActivePart = useCallback((partId: string | null) => {
    setState(prev => ({ ...prev, activePartId: partId }));
  }, []);

  const movePart = useCallback((fromIndex: number, toIndex: number) => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      const parts = [...p.parts];
      const [moved] = parts.splice(fromIndex, 1);
      parts.splice(toIndex, 0, moved);
      return { ...p, parts };
    }));
  }, [updatePatterns, state.activePatternId]);

  // ── Effekte ───────────────────────────────────────────────────────────────

  const setPartFx = useCallback((partId: string, fxUpdate: Partial<ChannelFx>) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt =>
        pt.id === partId ? { ...pt, fx: { ...pt.fx, ...fxUpdate } } : pt
      ),
    })), false);
  }, [updatePatterns]);

  const setFxPanelPartId = useCallback((partId: string | null) => {
    setState(prev => ({ ...prev, fxPanelPartId: partId }));
  }, []);

  const setPartMicroTiming = useCallback((partId: string, offsetMs: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId ? { ...pt, microTiming: Math.max(-50, Math.min(50, offsetMs)) } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartSourceType = useCallback((partId: string, type: "sample" | "wavetable" | "fm" | "granular") => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId ? { ...pt, sourceType: type } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartStretchRatio = useCallback((partId: string, ratio: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId ? { ...pt, stretchRatio: ratio } : pt),
    })), false);
  }, [updatePatterns]);

  const setPartGranularParams = useCallback((partId: string, params: Partial<import("../audio/GranularEngine").GranularParams>) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === partId
        ? { ...pt, granularParams: { ...(pt.granularParams ?? {}), ...params } as import("../audio/GranularEngine").GranularParams }
        : pt
      ),
    })), false);
  }, [updatePatterns]);

  const applyPatchToPart = useCallback((
    partId: string,
    patch: import("@/utils/patchSerialize").Patch,
    options: { replaceFx?: boolean } = {},
  ) => {
    const replaceFx = options.replaceFx ?? true;
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        return {
          ...pt,
          sourceType: patch.sourceType ?? pt.sourceType,
          sampleUrl: patch.sampleUrl ?? pt.sampleUrl,
          sampleName: patch.sampleName ?? pt.sampleName,
          synthParams: patch.synthParams ? { ...patch.synthParams } : pt.synthParams,
          granularParams: patch.granularParams ? { ...patch.granularParams } : pt.granularParams,
          fx: replaceFx && patch.fx ? { ...patch.fx } : pt.fx,
        };
      }),
    })), false);
  }, [updatePatterns]);

  // ── Steps ─────────────────────────────────────────────────────────────────

  const toggleStep = useCallback((partId: string, stepIndex: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], active: !steps[stepIndex].active };
        return { ...pt, steps };
      }),
    })));
  }, [updatePatterns]);

  const setPartSteps = useCallback((partId: string, newActive: boolean[], velocities?: number[]) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps: StepData[] = newActive.map((active, i) => ({
          ...pt.steps[i],
          active,
          ...(velocities?.[i] !== undefined ? { velocity: velocities[i] } : {}),
        }));
        return { ...pt, steps };
      }),
    })));
  }, [updatePatterns]);

  const setStepVelocity = useCallback((partId: string, stepIndex: number, velocity: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], velocity: Math.max(1, Math.min(127, velocity)) };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepPitch = useCallback((partId: string, stepIndex: number, pitch: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], pitch };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepProbability = useCallback((partId: string, stepIndex: number, probability: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], probability: Math.max(0, Math.min(100, probability)) };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepSlide = useCallback((partId: string, stepIndex: number, slide: boolean) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], slide };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepCondition = useCallback((partId: string, stepIndex: number, condition: StepCondition) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], condition };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepLength = useCallback((partId: string, stepIndex: number, length: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], length };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepChainNext = useCallback((partId: string, stepIndex: number, chain: "up" | "down" | "none" | undefined) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], chainNext: chain };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepParamLock = useCallback((partId: string, stepIndex: number, lock: import("../audio/AudioEngine").StepParamLock | undefined) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], paramLock: lock };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const setStepReverse = useCallback((partId: string, stepIndex: number, reverse: boolean) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = { ...steps[stepIndex], reverse };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const quantizePartSteps = useCallback((partId: string, grid: import("../utils/quantizeGrid").QuantizeGrid, strength: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        return { ...pt, steps: quantizeSteps(pt.steps, { grid, strength, stepCount: p.stepCount }) };
      }),
    })), true);
  }, [updatePatterns]);

  const setPartEuclidean = useCallback((partId: string, hits: number, steps: number, rotation = 0) => {
    const pattern = euclidean(hits, steps, rotation);
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        return {
          ...pt,
          steps: pt.steps.map((s, i) => ({ ...s, active: pattern[i] ?? false })),
        };
      }),
    })));
  }, [updatePatterns]);

  const clearPattern = useCallback(() => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      return {
        ...p,
        parts: p.parts.map(pt => ({
          ...pt,
          steps: pt.steps.map(() => ({ active: false, velocity: 100, pitch: 0 })),
        })),
      };
    }));
  }, [updatePatterns, state.activePatternId]);

  /** Setzt den kompletten DrumMachine-Store auf den initialen Zustand zurück. */
  const resetAll = useCallback(() => {
    // INITIAL_PATTERN-Clone mit frischer ID, damit Pattern-IDs nicht kollidieren
    const fresh = JSON.parse(JSON.stringify(INITIAL_PATTERN)) as typeof INITIAL_PATTERN;
    fresh.id = `pat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    fresh.parts = fresh.parts.map(p => ({
      ...p,
      id: `part-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    }));
    setState({
      patterns: [fresh],
      activePatternId: fresh.id,
      playbackPatternId: null,
      liveEditSourcePatternId: null,
      activePartId: fresh.parts[0]?.id ?? null,
      currentStep: 0,
      velocityMode: false,
      pitchMode: false,
      fxPanelPartId: null,
      commitPending: false,
      stackedPatternIds: [],
    });
    // Undo-History leeren damit User keinen Restore zum alten Projekt machen kann
    undoStack.current = [];
    redoStack.current = [];
  }, []);

  const fillPattern = useCallback((partId: string, density = 0.5) => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      return {
        ...p,
        parts: p.parts.map(pt => {
          if (pt.id !== partId) return pt;
          return {
            ...pt,
            steps: pt.steps.map(() => ({
              active: Math.random() < density,
              velocity: Math.floor(80 + Math.random() * 47),
              pitch: 0,
            })),
          };
        }),
      };
    }));
  }, [updatePatterns, state.activePatternId]);

  const randomizePattern = useCallback((partId: string) => {
    fillPattern(partId, 0.35);
  }, [fillPattern]);

  const shiftPattern = useCallback((partId: string, direction: "left" | "right") => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      return {
        ...p,
        parts: p.parts.map(pt => {
          if (pt.id !== partId) return pt;
          const steps = [...pt.steps];
          if (direction === "left") steps.push(steps.shift()!);
          else steps.unshift(steps.pop()!);
          return { ...pt, steps };
        }),
      };
    }));
  }, [updatePatterns, state.activePatternId]);

  const setStepCount = useCallback((count: 16 | 32) => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      return {
        ...p,
        stepCount: count,
        parts: p.parts.map(pt => {
          if (pt.steps.length === count) return pt;
          if (count > pt.steps.length) {
            return { ...pt, steps: [...pt.steps, ...makeSteps(count - pt.steps.length)] };
          }
          return { ...pt, steps: pt.steps.slice(0, count) };
        }),
      };
    }));
  }, [updatePatterns, state.activePatternId]);

  const setCurrentStep = useCallback((step: number) => {
    setState(prev => ({ ...prev, currentStep: step }));
  }, []);

  const setVelocityMode = useCallback((active: boolean) => {
    setState(prev => ({ ...prev, velocityMode: active, pitchMode: active ? false : prev.pitchMode }));
  }, []);

  const setPitchMode = useCallback((active: boolean) => {
    setState(prev => ({ ...prev, pitchMode: active, velocityMode: active ? false : prev.velocityMode }));
  }, []);

  // ── Undo/Redo ─────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    setState(prev => {
      const previous = undoStack.current.pop()!;
      redoStack.current.unshift(JSON.parse(JSON.stringify(prev.patterns)));
      if (redoStack.current.length > 50) redoStack.current.pop();
      setCanUndo(undoStack.current.length > 0);
      setCanRedo(true);
      return { ...prev, patterns: previous };
    });
  }, []);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    setState(prev => {
      const next = redoStack.current.shift()!;
      undoStack.current.push(JSON.parse(JSON.stringify(prev.patterns)));
      if (undoStack.current.length > 50) undoStack.current.shift();
      setCanRedo(redoStack.current.length > 0);
      setCanUndo(true);
      return { ...prev, patterns: next };
    });
  }, []);

  const getActivePattern = useCallback(() => {
    return state.patterns.find(p => p.id === state.activePatternId);
  }, [state.patterns, state.activePatternId]);

  const getPlaybackPattern = useCallback(() => {
    return state.patterns.find(p => p.id === (state.playbackPatternId ?? state.activePatternId));
  }, [state.patterns, state.playbackPatternId, state.activePatternId]);

  return {
    ...state,
    addPattern, addPatternData, removePattern, renamePattern, setActivePattern, duplicatePattern,
    copySamplesFromPattern,
    reorderPatterns,
    startLivePatternEdit, commitLivePatternEdit, cancelLivePatternEdit, scheduleCommit,
    setPatternBpm, setPatternBpmRatio, setPatternBpmTransitionBars, setPatternStepResolution, setPatternFollowAction,
    toggleStackedPattern, clearStackedPatterns,
    addPart, removePart, renamePart, setPartSample,
    setPartMuted, setPartSoloed, setPartVolume, setPartPan,
    setPartStepResolution, setPartStepLength, setActivePart, movePart,
    setPartFx, setFxPanelPartId, setPartSourceType, setPartGranularParams, setPartStretchRatio, setPartMicroTiming, applyPatchToPart,
    toggleStep, setPartSteps, setStepVelocity, setStepPitch, setStepProbability, setStepSlide, setStepCondition, setStepReverse, setStepParamLock, setStepLength, setStepChainNext, quantizePartSteps, setPartEuclidean,
    clearPattern, resetAll, fillPattern, randomizePattern, shiftPattern,
    setStepCount, setCurrentStep,
    setVelocityMode, setPitchMode,
    undo, redo, canUndo, canRedo,
    getActivePattern, getPlaybackPattern,
  };
}
