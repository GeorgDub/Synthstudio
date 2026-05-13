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
  stepCount: 16 | 32;
  /** Ob Aufnahme aktiv ist (Live-Recording von Parameteränderungen) */
  recording: boolean;
}

export interface AutomationActions {
  addLane: (target: AutomationTarget, label: string, opts?: { min?: number; max?: number; defaultValue?: number }) => string;
  removeLane: (id: string) => void;
  setPoint: (laneId: string, step: number, value: number) => void;
  clearPoint: (laneId: string, step: number) => void;
  clearLane: (laneId: string) => void;
  setLaneEnabled: (laneId: string, enabled: boolean) => void;
  setStepCount: (count: 16 | 32) => void;
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

function targetDefaults(target: AutomationTarget): { min: number; max: number; defaultValue: number; label: string } {
  if (target === "bpm")        return { min: 60,  max: 200, defaultValue: 120, label: "BPM" };
  if (target === "master-vol") return { min: 0,   max: 1,   defaultValue: 0.85, label: "Master Vol" };
  if (target.startsWith("vol:"))      return { min: 0, max: 1,  defaultValue: 1,   label: `Vol: ${target.slice(4)}` };
  if (target.startsWith("pan:"))      return { min: -1,max: 1,  defaultValue: 0,   label: `Pan: ${target.slice(4)}` };
  if (target.startsWith("send-rev:")) return { min: 0, max: 1,  defaultValue: 0,   label: `Reverb: ${target.slice(9)}` };
  if (target.startsWith("send-dly:")) return { min: 0, max: 1,  defaultValue: 0,   label: `Delay: ${target.slice(9)}` };
  return { min: 0, max: 1, defaultValue: 0, label: target };
}

/** Lineares Interpolieren zwischen benachbarten Punkten */
function interpolate(points: Record<number, number>, step: number, stepCount: number): number | null {
  const keys = Object.keys(points).map(Number).sort((a, b) => a - b);
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_STATE: AutomationState = { lanes: [], stepCount: 16, recording: false };

export function useAutomationStore(): AutomationState & AutomationActions {
  const [state, setState] = useState<AutomationState>(DEFAULT_STATE);

  const addLane = useCallback((target: AutomationTarget, label: string, opts?: { min?: number; max?: number; defaultValue?: number }): string => {
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
  }, []);

  const removeLane = useCallback((id: string) => {
    setState(prev => ({ ...prev, lanes: prev.lanes.filter(l => l.id !== id) }));
  }, []);

  const setPoint = useCallback((laneId: string, step: number, value: number) => {
    setState(prev => ({
      ...prev,
      lanes: prev.lanes.map(l =>
        l.id === laneId
          ? { ...l, points: { ...l.points, [step]: Math.max(l.min, Math.min(l.max, value)) } }
          : l
      ),
    }));
  }, []);

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
      lanes: prev.lanes.map(l => l.id === laneId ? { ...l, points: {} } : l),
    }));
  }, []);

  const setLaneEnabled = useCallback((laneId: string, enabled: boolean) => {
    setState(prev => ({
      ...prev,
      lanes: prev.lanes.map(l => l.id === laneId ? { ...l, enabled } : l),
    }));
  }, []);

  const setStepCount = useCallback((count: 16 | 32) => {
    setState(prev => ({ ...prev, stepCount: count }));
  }, []);

  const setRecording = useCallback((recording: boolean) => {
    setState(prev => ({ ...prev, recording }));
  }, []);

  const getValueAt = useCallback((target: AutomationTarget, step: number): number | null => {
    const lane = state.lanes.find(l => l.target === target && l.enabled);
    if (!lane) return null;
    return interpolate(lane.points, step, state.stepCount);
  }, [state.lanes, state.stepCount]);

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
