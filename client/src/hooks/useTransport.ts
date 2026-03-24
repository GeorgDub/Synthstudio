/**
 * Synthstudio – useTransport.ts
 *
 * Verbindet die Audio-Engine mit dem React-State.
 * - Synchronisiert BPM, isPlaying, isRecording
 * - Registriert Pattern-Getter für das Scheduling
 * - Leitet Position-Callbacks an den DrumMachine-Store weiter
 * - Verwaltet Metronom-State
 */

import { useEffect, useRef, useCallback } from "react";
import { AudioEngine } from "../audio/AudioEngine";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";

interface UseTransportOptions {
  isPlaying: boolean;
  bpm: number;
  dm: DrumMachineState & DrumMachineActions;
  metronomEnabled?: boolean;
  metronomGain?: number;
  onPlayStateChange?: (playing: boolean) => void;
}

export function useTransport({
  isPlaying,
  bpm,
  dm,
  metronomEnabled = false,
  metronomGain = 0.5,
  onPlayStateChange,
}: UseTransportOptions) {
  const prevPlaying = useRef(false);
  const prevBpm = useRef(bpm);

  // Pattern-Getter registrieren (immer aktuell durch Ref)
  const patternRef = useRef(dm.getActivePattern);
  patternRef.current = dm.getActivePattern;

  useEffect(() => {
    AudioEngine.setPatternGetter(() => {
      const p = patternRef.current();
      if (!p) return { id: "", name: "", stepCount: 16, parts: [] };
      return p;
    });
  }, []);

  // BPM synchronisieren
  useEffect(() => {
    if (bpm !== prevBpm.current) {
      AudioEngine.setBpm(bpm);
      prevBpm.current = bpm;
    }
  }, [bpm]);

  // Metronom synchronisieren
  useEffect(() => {
    AudioEngine.setMetronom(metronomEnabled, metronomGain);
  }, [metronomEnabled, metronomGain]);

  // Play/Stop synchronisieren
  useEffect(() => {
    if (isPlaying === prevPlaying.current) return;
    prevPlaying.current = isPlaying;

    if (isPlaying) {
      const pattern = dm.getActivePattern();
      AudioEngine.setBpm(bpm);
      AudioEngine.setSteps(pattern?.stepCount ?? 16);
      AudioEngine.play(0).catch(err => {
        console.error("[Transport] Play fehlgeschlagen:", err);
        onPlayStateChange?.(false);
      });
    } else {
      AudioEngine.stop();
      dm.setCurrentStep(0);
    }
  }, [isPlaying, bpm, dm, onPlayStateChange]);

  // Position-Callback registrieren
  useEffect(() => {
    const unsubscribe = AudioEngine.onPosition(step => {
      dm.setCurrentStep(step);
    });
    return unsubscribe;
  }, [dm]);

  // Step-Count-Änderungen an Engine weitergeben
  useEffect(() => {
    const pattern = dm.getActivePattern();
    if (pattern && isPlaying) {
      AudioEngine.setSteps(pattern.stepCount);
    }
  }, [dm, isPlaying]);

  // Sample-Preview-Funktion
  const previewSample = useCallback(async (url: string, volume = 1.0) => {
    await AudioEngine.previewSample(url, volume);
  }, []);

  return { previewSample };
}
