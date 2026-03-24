/**
 * Synthstudio – useDrumMachineStore.ts
 *
 * Zentraler State für die Drum Machine.
 * Verwaltet:
 * - Patterns (mehrere, wechselbar)
 * - Parts (Zeilen) mit Sample-Zuweisung, Mute/Solo, Volume, Pan
 * - Steps mit Velocity und Pitch
 * - Undo/Redo (bis 50 Schritte)
 * - Aktiver Step (für Playback-Visualisierung)
 */

import { useState, useCallback, useRef } from "react";
import type { PatternData, PartData, StepData } from "../audio/AudioEngine";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface DrumMachineState {
  patterns: PatternData[];
  activePatternId: string;
  activePartId: string | null;
  currentStep: number;
  /** Ob Velocity-Editing-Modus aktiv */
  velocityMode: boolean;
  /** Ob Pitch-Editing-Modus aktiv */
  pitchMode: boolean;
}

export interface DrumMachineActions {
  // Pattern-Verwaltung
  addPattern: (name?: string) => void;
  removePattern: (id: string) => void;
  renamePattern: (id: string, name: string) => void;
  setActivePattern: (id: string) => void;
  duplicatePattern: (id: string) => void;

  // Part-Verwaltung
  addPart: (name?: string) => void;
  removePart: (id: string) => void;
  renamePart: (id: string, name: string) => void;
  setPartSample: (partId: string, sampleUrl: string, sampleName?: string) => void;
  setPartMuted: (partId: string, muted: boolean) => void;
  setPartSoloed: (partId: string, soloed: boolean) => void;
  setPartVolume: (partId: string, volume: number) => void;
  setPartPan: (partId: string, pan: number) => void;
  setActivePart: (partId: string | null) => void;
  movePart: (fromIndex: number, toIndex: number) => void;

  // Step-Verwaltung
  toggleStep: (partId: string, stepIndex: number) => void;
  setStepVelocity: (partId: string, stepIndex: number, velocity: number) => void;
  setStepPitch: (partId: string, stepIndex: number, pitch: number) => void;
  clearPattern: () => void;
  fillPattern: (partId: string, density?: number) => void;
  randomizePattern: (partId: string) => void;
  shiftPattern: (partId: string, direction: "left" | "right") => void;

  // Step-Count
  setStepCount: (count: 16 | 32) => void;

  // Playback-Position
  setCurrentStep: (step: number) => void;

  // Editing-Modi
  setVelocityMode: (active: boolean) => void;
  setPitchMode: (active: boolean) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Getter
  getActivePattern: () => PatternData | undefined;
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
    steps: makeSteps(stepCount),
  };
}

function makePattern(name: string, stepCount: 16 | 32 = 16): PatternData {
  const defaultParts = [
    "Kick", "Snare", "Hi-Hat (cl.)", "Hi-Hat (op.)",
    "Clap", "Tom Hi", "Tom Lo", "FX",
  ];
  return {
    id: makeId(),
    name,
    stepCount,
    parts: defaultParts.map(n => makePart(n, stepCount)),
  };
}

const INITIAL_PATTERN = makePattern("Pattern 1");

const INITIAL_STATE: DrumMachineState = {
  patterns: [INITIAL_PATTERN],
  activePatternId: INITIAL_PATTERN.id,
  activePartId: null,
  currentStep: 0,
  velocityMode: false,
  pitchMode: false,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDrumMachineStore(): DrumMachineState & DrumMachineActions {
  const [state, setState] = useState<DrumMachineState>(INITIAL_STATE);

  // Undo/Redo-Stack (nur Pattern-Daten, nicht UI-State)
  const undoStack = useRef<PatternData[][]>([]);
  const redoStack = useRef<PatternData[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Snapshot für Undo pushen
  const pushUndo = useCallback((patterns: PatternData[]) => {
    undoStack.current.push(JSON.parse(JSON.stringify(patterns)));
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  // Pattern-Update mit Undo-Support
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

  // ── Pattern-Aktionen ────────────────────────────────────────────────────

  const addPattern = useCallback((name?: string) => {
    const p = makePattern(name ?? `Pattern ${Date.now() % 1000}`);
    setState(prev => ({
      ...prev,
      patterns: [...prev.patterns, p],
      activePatternId: p.id,
    }));
  }, []);

  const removePattern = useCallback((id: string) => {
    setState(prev => {
      if (prev.patterns.length <= 1) return prev;
      const next = prev.patterns.filter(p => p.id !== id);
      return {
        ...prev,
        patterns: next,
        activePatternId: prev.activePatternId === id ? next[0].id : prev.activePatternId,
      };
    });
  }, []);

  const renamePattern = useCallback((id: string, name: string) => {
    updatePatterns(ps => ps.map(p => p.id === id ? { ...p, name } : p), false);
  }, [updatePatterns]);

  const setActivePattern = useCallback((id: string) => {
    setState(prev => ({ ...prev, activePatternId: id }));
  }, []);

  const duplicatePattern = useCallback((id: string) => {
    setState(prev => {
      const src = prev.patterns.find(p => p.id === id);
      if (!src) return prev;
      const copy: PatternData = {
        ...JSON.parse(JSON.stringify(src)),
        id: makeId(),
        name: `${src.name} (Kopie)`,
      };
      return { ...prev, patterns: [...prev.patterns, copy], activePatternId: copy.id };
    });
  }, []);

  // ── Part-Aktionen ───────────────────────────────────────────────────────

  const addPart = useCallback((name?: string) => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      const part = makePart(name ?? `Part ${p.parts.length + 1}`, p.stepCount);
      return { ...p, parts: [...p.parts, part] };
    }));
  }, [updatePatterns, state.activePatternId]);

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
        ? { ...pt, sampleUrl, name: sampleName ?? pt.name }
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

  const setPartSoloed = useCallback((partId: string, soloed: boolean) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      // Solo: alle anderen desoloen, außer wenn man den aktiven deaktiviert
      parts: p.parts.map(pt => ({
        ...pt,
        soloed: pt.id === partId ? soloed : false,
        muted: soloed && pt.id !== partId ? true : (pt.id === partId ? false : pt.muted),
      })),
    })), false);
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

  // ── Step-Aktionen ───────────────────────────────────────────────────────

  const toggleStep = useCallback((partId: string, stepIndex: number) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        steps[stepIndex] = {
          ...steps[stepIndex],
          active: !steps[stepIndex].active,
        };
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
        steps[stepIndex] = { ...steps[stepIndex], pitch: Math.max(-24, Math.min(24, pitch)) };
        return { ...pt, steps };
      }),
    })), false);
  }, [updatePatterns]);

  const clearPattern = useCallback(() => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      return {
        ...p,
        parts: p.parts.map(pt => ({
          ...pt,
          steps: makeSteps(p.stepCount),
        })),
      };
    }));
  }, [updatePatterns, state.activePatternId]);

  const fillPattern = useCallback((partId: string, density = 1.0) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        return {
          ...pt,
          steps: pt.steps.map((s, i) => ({
            ...s,
            active: i % Math.round(1 / density) === 0,
          })),
        };
      }),
    })));
  }, [updatePatterns]);

  const randomizePattern = useCallback((partId: string) => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        return {
          ...pt,
          steps: pt.steps.map(s => ({
            ...s,
            active: Math.random() < 0.3,
            velocity: Math.floor(Math.random() * 60) + 67,
          })),
        };
      }),
    })));
  }, [updatePatterns]);

  const shiftPattern = useCallback((partId: string, direction: "left" | "right") => {
    updatePatterns(ps => ps.map(p => ({
      ...p,
      parts: p.parts.map(pt => {
        if (pt.id !== partId) return pt;
        const steps = [...pt.steps];
        if (direction === "right") {
          steps.unshift(steps.pop()!);
        } else {
          steps.push(steps.shift()!);
        }
        return { ...pt, steps };
      }),
    })));
  }, [updatePatterns]);

  const setStepCount = useCallback((count: 16 | 32) => {
    updatePatterns(ps => ps.map(p => {
      if (p.id !== state.activePatternId) return p;
      return {
        ...p,
        stepCount: count,
        parts: p.parts.map(pt => {
          const newSteps = makeSteps(count);
          // Vorhandene Steps übernehmen
          pt.steps.forEach((s, i) => { if (i < count) newSteps[i] = { ...s }; });
          return { ...pt, steps: newSteps };
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

  // ── Undo/Redo ───────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setState(s => {
      redoStack.current.push(JSON.parse(JSON.stringify(s.patterns)));
      setCanUndo(undoStack.current.length > 0);
      setCanRedo(true);
      return { ...s, patterns: prev };
    });
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setState(s => {
      undoStack.current.push(JSON.parse(JSON.stringify(s.patterns)));
      setCanUndo(true);
      setCanRedo(redoStack.current.length > 0);
      return { ...s, patterns: next };
    });
  }, []);

  // ── Getter ──────────────────────────────────────────────────────────────

  const getActivePattern = useCallback(() => {
    return state.patterns.find(p => p.id === state.activePatternId);
  }, [state.patterns, state.activePatternId]);

  return {
    ...state,
    canUndo,
    canRedo,
    addPattern,
    removePattern,
    renamePattern,
    setActivePattern,
    duplicatePattern,
    addPart,
    removePart,
    renamePart,
    setPartSample,
    setPartMuted,
    setPartSoloed,
    setPartVolume,
    setPartPan,
    setActivePart,
    movePart,
    toggleStep,
    setStepVelocity,
    setStepPitch,
    clearPattern,
    fillPattern,
    randomizePattern,
    shiftPattern,
    setStepCount,
    setCurrentStep,
    setVelocityMode,
    setPitchMode,
    undo,
    redo,
    getActivePattern,
  };
}
