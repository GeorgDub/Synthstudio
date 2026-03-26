/**
 * useSampleSlicerStore.ts – SampleSlicer State und CRUD-Aktionen
 * Phase 3: Sample Slicer & Loop Manager
 */
import { useState, useCallback } from "react";

export interface SliceRegion {
  id: string;
  startOffset: number;    // Frames
  endOffset: number;      // Frames (0 = bis Ende des Samples)
  loopMode: "one-shot" | "loop" | "ping-pong";
  reverse: boolean;
  name?: string;
}

export interface SampleSlicerState {
  sampleUrl?: string;
  audioDuration: number;   // Sekunden
  slices: SliceRegion[];
}

export interface SampleSlicerActions {
  setSample: (url: string, duration: number) => void;
  addSlice: (slice: Omit<SliceRegion, "id">) => string;
  removeSlice: (id: string) => void;
  updateSlice: (id: string, update: Partial<Omit<SliceRegion, "id">>) => void;
  clearSlices: () => void;
  setSlicesFromTransients: (offsets: number[], totalFrames: number, sampleRate: number) => void;
}

function makeSliceId(): string {
  return `slice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useSampleSlicerStore(): SampleSlicerState & SampleSlicerActions {
  const [state, setState] = useState<SampleSlicerState>({
    sampleUrl: undefined,
    audioDuration: 0,
    slices: [],
  });

  const setSample = useCallback((url: string, duration: number) => {
    setState(prev => ({ ...prev, sampleUrl: url, audioDuration: duration, slices: [] }));
  }, []);

  const addSlice = useCallback((slice: Omit<SliceRegion, "id">): string => {
    const id = makeSliceId();
    setState(prev => ({
      ...prev,
      slices: [...prev.slices, { ...slice, id }].sort((a, b) => a.startOffset - b.startOffset),
    }));
    return id;
  }, []);

  const removeSlice = useCallback((id: string) => {
    setState(prev => ({ ...prev, slices: prev.slices.filter(s => s.id !== id) }));
  }, []);

  const updateSlice = useCallback((id: string, update: Partial<Omit<SliceRegion, "id">>) => {
    setState(prev => ({
      ...prev,
      slices: prev.slices
        .map(s => s.id === id ? { ...s, ...update } : s)
        .sort((a, b) => a.startOffset - b.startOffset),
    }));
  }, []);

  const clearSlices = useCallback(() => {
    setState(prev => ({ ...prev, slices: [] }));
  }, []);

  /** Erstellt Slices automatisch aus Transient-Offsets */
  const setSlicesFromTransients = useCallback(
    (offsets: number[], totalFrames: number, sampleRate: number) => {
      if (offsets.length === 0) return;
      const sorted = [...offsets].sort((a, b) => a - b);
      const newSlices: SliceRegion[] = sorted.map((startOffset, i) => ({
        id: makeSliceId(),
        startOffset,
        endOffset: sorted[i + 1] ?? totalFrames,
        loopMode: "one-shot",
        reverse: false,
        name: `Slice ${i + 1}`,
      }));
      setState(prev => ({ ...prev, slices: newSlices }));
    },
    []
  );

  return {
    ...state,
    setSample,
    addSlice,
    removeSlice,
    updateSlice,
    clearSlices,
    setSlicesFromTransients,
  };
}
