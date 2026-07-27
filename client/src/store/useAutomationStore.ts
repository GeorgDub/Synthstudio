/**
 * Synthstudio – useAutomationStore
 *
 * Step-basierte Parameter-Automation.
 * Jede Lane steuert einen Parameter über Zeit (16 Steps pro Bar).
 *
 * Targets:
 *  "bpm"          → Globales Tempo
 *  "master-vol"   → Master-Lautstärke
 *  "vol:<partId>" → Kanalvolume eines Drum-Parts
 *  "pan:<partId>" → Kanal-Panorama eines Drum-Parts
 *  "send-rev:<partId>" → Reverb-Send
 *  "send-dly:<partId>" → Delay-Send
 */
import { useState, useCallback } from "react";

export type AutomationTarget =
  | "bpm"
  | "master-vol"
  | `vol:${string}`
  | `pan:${string}`
  | `send-rev:${string}`
  | `send-dly:${string}`;

export interface AutomationLane {
  id: string;
  target: AutomationTarget;
  label: string;
  /** Sparse step map: stepIndex → value */
  points: Record<number, number>;
  enabled: boolean;
  min: number;
  max: number;
  defaultValue: number;
}

export interface AutomationState {
  lanes: AutomationLane[];
  /** Anzahl Steps (Pattern-Steps, typisch 16 oder 32) */
  stepCount: 16 | 32 | 64 | 128;
  /** Ob Aufnahme aktiv ist (Live-Recording von Parameteränderungen) */
  recording: boolean;
}

export interface AutomationActions {
  addLane: (
    target: AutomationTarget,
    label: string,
    opts?: { min?: number; max?: number; defaultValue?: number }
  ) => string;
  removeLane: (id: string) => void;
  setPoint: (laneId: string, step: number, value: number) => void;
  clearPoint: (laneId: string, step: number) => void;
  clearLane: (laneId: string) => void;
  setLaneEnabled: (laneId: string, enabled: boolean) => void;
  setStepCount: (count: 16 | 32 | 64 | 128) => void;
  setRecording: (recording: boolean) => void;
  /** Resettet alle Automation-Lanes + StepCount auf Defaults (BUG-013 fix). */
  resetAutomation: () => void;
  /** Liefert den interpolierten Wert eines Targets bei einem bestimmten Step (null = kein Override) */
  getValueAt: (target: AutomationTarget, step: number) => number | null;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function makeId() {
  return `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function targetDefaults(target: AutomationTarget): {
  min: number;
  max: number;
  defaultValue: number;
  label: string;
} {
  if (target === "bpm")
    return { min: 60, max: 200, defaultValue: 120, label: "BPM" };
  if (target === "master-vol")
    return { min: 0, max: 1, defaultValue: 0.85, label: "Master Vol" };
  if (target.startsWith("vol:"))
    return {
      min: 0,
      max: 1,
      defaultValue: 1,
      label: `Vol: ${target.slice(4)}`,
    };
  if (target.startsWith("pan:"))
    return {
      min: -1,
      max: 1,
      defaultValue: 0,
      label: `Pan: ${target.slice(4)}`,
    };
  if (target.startsWith("send-rev:"))
    return {
      min: 0,
      max: 1,
      defaultValue: 0,
      label: `Reverb: ${target.slice(9)}`,
    };
  if (target.startsWith("send-dly:"))
    return {
      min: 0,
      max: 1,
      defaultValue: 0,
      label: `Delay: ${target.slice(9)}`,
    };
  return { min: 0, max: 1, defaultValue: 0, label: target };
}

/**
 * Lineares Interpolieren zwischen benachbarten Punkten.
 * Exportiert fuer isolierte Unit-Tests (siehe tests/features/automation.test.ts).
 * stepCount-Parameter ist reserviert fuer kuenftige Wrap-around-Modi und wird
 * in der aktuellen linearen Variante nicht ausgewertet.
 */
export function interpolate(
  points: Record<number, number>,
  step: number,
  _stepCount: number
): number | null {
  const keys = Object.keys(points)
    .map(Number)
    .sort((a, b) => a - b);
  if (keys.length === 0) return null;

  // Exakter Treffer
  if (points[step] !== undefined) return points[step];

  // Umrahmende Punkte finden
  const prev = keys.filter(k => k < step).pop();
  const next = keys.find(k => k > step);

  if (prev === undefined && next === undefined) return null;
  if (prev === undefined) return points[next!];
  if (next === undefined) return points[prev];

  // Lineare Interpolation
  const t = (step - prev) / (next - prev);
  return points[prev] + t * (points[next] - points[prev]);
}

// ─── Consumer-Mapping (TASK-249) ────────────────────────────────────────────
//
// Damit der Playback-Consumer (App.tsx onPosition) KEINE Per-Step-Allokationen
// macht, werden Lanes EINMAL bei Aenderung in eine flache, dichte Struktur
// kompiliert. Der Step-Hot-Path liest danach nur noch `values[step]` + dispatcht
// per `kind`/`partId` — kein .find(), kein .slice(), kein Object.keys() pro Step.

export type AutomationKind =
  | "bpm"
  | "master-vol"
  | "vol"
  | "pan"
  | "send-rev"
  | "send-dly";

export interface ParsedAutomationTarget {
  kind: AutomationKind;
  /** Nur fuer kanal-bezogene Kinds (vol/pan/send-*); sonst null. */
  partId: string | null;
}

/**
 * Zerlegt ein AutomationTarget in {kind, partId}. Pure + isoliert testbar.
 * Genau dieser String-Parse darf NICHT pro Step laufen → einmal beim Kompilieren.
 */
export function parseAutomationTarget(
  target: AutomationTarget
): ParsedAutomationTarget {
  if (target === "bpm") return { kind: "bpm", partId: null };
  if (target === "master-vol") return { kind: "master-vol", partId: null };
  if (target.startsWith("vol:"))
    return { kind: "vol", partId: target.slice(4) };
  if (target.startsWith("pan:"))
    return { kind: "pan", partId: target.slice(4) };
  if (target.startsWith("send-rev:"))
    return { kind: "send-rev", partId: target.slice(9) };
  if (target.startsWith("send-dly:"))
    return { kind: "send-dly", partId: target.slice(9) };
  // Unbekanntes Target → als master-vol-aehnlicher No-target-Fall behandeln.
  // (Sollte durch die AutomationTarget-Union nie auftreten.)
  return { kind: "master-vol", partId: null };
}

export interface CompiledAutomationLane {
  kind: AutomationKind;
  partId: string | null;
  /**
   * Dichte, vorab aufgeloeste Werte, Index = Step (0..stepCount-1).
   * Index ausserhalb [0, length) wird vom Consumer auf den letzten Index
   * geklemmt (gleiches Clamp-Verhalten wie interpolate's "nach letztem Punkt").
   */
  values: (number | null)[];
}

/**
 * Kompiliert alle ENABLED, nicht-leeren Lanes in eine flache Liste mit dichten
 * Wert-Arrays. Wird EINMAL pro Lanes/stepCount-Aenderung aufgerufen (useMemo),
 * nicht pro Step. Allokationen hier sind erlaubt; der Step-Hot-Path liest nur.
 */
export function compileAutomationLanes(
  lanes: AutomationLane[],
  stepCount: number
): CompiledAutomationLane[] {
  const out: CompiledAutomationLane[] = [];
  for (const lane of lanes) {
    if (!lane.enabled) continue;
    if (Object.keys(lane.points).length === 0) continue;
    const parsed = parseAutomationTarget(lane.target);
    const values: (number | null)[] = new Array(stepCount);
    for (let i = 0; i < stepCount; i++) {
      values[i] = interpolate(lane.points, i, stepCount);
    }
    out.push({ kind: parsed.kind, partId: parsed.partId, values });
  }
  return out;
}

/**
 * Liest den vorab kompilierten Wert eines Lanes an `step` — ALLOKATIONSFREI.
 * Index wird auf [0, length-1] geklemmt (entspricht interpolate-Clamp rechts;
 * links ist durch values[0] bereits abgedeckt). Leere values → null.
 */
export function readCompiledValue(
  lane: CompiledAutomationLane,
  step: number
): number | null {
  const len = lane.values.length;
  if (len === 0) return null;
  let idx = step;
  if (idx < 0) idx = 0;
  else if (idx >= len) idx = len - 1;
  return lane.values[idx];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_STATE: AutomationState = {
  lanes: [],
  stepCount: 16,
  recording: false,
};

export function useAutomationStore(): AutomationState & AutomationActions {
  const [state, setState] = useState<AutomationState>(DEFAULT_STATE);

  const addLane = useCallback(
    (
      target: AutomationTarget,
      label: string,
      opts?: { min?: number; max?: number; defaultValue?: number }
    ): string => {
      const defs = targetDefaults(target);
      const lane: AutomationLane = {
        id: makeId(),
        target,
        label: label || defs.label,
        points: {},
        enabled: true,
        min: opts?.min ?? defs.min,
        max: opts?.max ?? defs.max,
        defaultValue: opts?.defaultValue ?? defs.defaultValue,
      };
      setState(prev => ({ ...prev, lanes: [...prev.lanes, lane] }));
      return lane.id;
    },
    []
  );

  const removeLane = useCallback((id: string) => {
    setState(prev => ({ ...prev, lanes: prev.lanes.filter(l => l.id !== id) }));
  }, []);

  const setPoint = useCallback(
    (laneId: string, step: number, value: number) => {
      setState(prev => ({
        ...prev,
        lanes: prev.lanes.map(l =>
          l.id === laneId
            ? {
                ...l,
                points: {
                  ...l.points,
                  [step]: Math.max(l.min, Math.min(l.max, value)),
                },
              }
            : l
        ),
      }));
    },
    []
  );

  const clearPoint = useCallback((laneId: string, step: number) => {
    setState(prev => ({
      ...prev,
      lanes: prev.lanes.map(l => {
        if (l.id !== laneId) return l;
        const { [step]: _, ...rest } = l.points;
        return { ...l, points: rest };
      }),
    }));
  }, []);

  const clearLane = useCallback((laneId: string) => {
    setState(prev => ({
      ...prev,
      lanes: prev.lanes.map(l => (l.id === laneId ? { ...l, points: {} } : l)),
    }));
  }, []);

  const setLaneEnabled = useCallback((laneId: string, enabled: boolean) => {
    setState(prev => ({
      ...prev,
      lanes: prev.lanes.map(l => (l.id === laneId ? { ...l, enabled } : l)),
    }));
  }, []);

  const setStepCount = useCallback((count: 16 | 32 | 64 | 128) => {
    setState(prev => ({ ...prev, stepCount: count }));
  }, []);

  const setRecording = useCallback((recording: boolean) => {
    setState(prev => ({ ...prev, recording }));
  }, []);

  const getValueAt = useCallback(
    (target: AutomationTarget, step: number): number | null => {
      const lane = state.lanes.find(l => l.target === target && l.enabled);
      if (!lane) return null;
      return interpolate(lane.points, step, state.stepCount);
    },
    [state.lanes, state.stepCount]
  );

  const resetAutomation = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  return {
    ...state,
    addLane,
    removeLane,
    setPoint,
    clearPoint,
    clearLane,
    setLaneEnabled,
    setStepCount,
    setRecording,
    getValueAt,
    resetAutomation,
  };
}
