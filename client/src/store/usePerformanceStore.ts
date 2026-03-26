/**
 * usePerformanceStore.ts – Performance Mode State
 * Phase 4: Performance Mode / Live View
 */
import { useState, useCallback } from "react";

export interface PerformancePad {
  patternId: string;
  color?: string;   // CSS-Farbe (z.B. "#22d3ee")
  label?: string;
}

export interface PerformanceState {
  active: boolean;
  pads: PerformancePad[];
  queuedPatternId: string | null;
  quantizeMode: "bar" | "beat" | "step";
}

export interface PerformanceActions {
  setActive: (active: boolean) => void;
  setPads: (pads: PerformancePad[]) => void;
  queuePattern: (patternId: string) => void;
  clearQueue: () => void;
  setQuantizeMode: (mode: "bar" | "beat" | "step") => void;
}

export function usePerformanceStore(): PerformanceState & PerformanceActions {
  const [state, setState] = useState<PerformanceState>({
    active: false,
    pads: [],
    queuedPatternId: null,
    quantizeMode: "bar",
  });

  const setActive = useCallback((active: boolean) => {
    setState(prev => ({ ...prev, active }));
  }, []);

  const setPads = useCallback((pads: PerformancePad[]) => {
    setState(prev => ({ ...prev, pads }));
  }, []);

  const queuePattern = useCallback((patternId: string) => {
    setState(prev => ({
      ...prev,
      // Gleiches Pattern nochmal → Queue leeren (Toggle)
      queuedPatternId: prev.queuedPatternId === patternId ? null : patternId,
    }));
  }, []);

  const clearQueue = useCallback(() => {
    setState(prev => ({ ...prev, queuedPatternId: null }));
  }, []);

  const setQuantizeMode = useCallback((quantizeMode: "bar" | "beat" | "step") => {
    setState(prev => ({ ...prev, quantizeMode }));
  }, []);

  return { ...state, setActive, setPads, queuePattern, clearQueue, setQuantizeMode };
}
