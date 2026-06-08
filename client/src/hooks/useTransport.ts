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
import type { FollowAction } from "../audio/AudioEngine";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import { getPattern } from "@/store/useMelodicPartStore";
import { useTransposeStore } from "@/store/useTransposeStore";
import { getArpState, getArpSteps } from "@/store/useArpStore";
import { usePatternCrossfadeStore } from "@/store/usePatternCrossfadeStore";
import { clearQueue as clearPerformanceQueue } from "@/store/usePerformanceStore";

interface UseTransportOptions {
  isPlaying: boolean;
  bpm: number;
  dm: DrumMachineState & DrumMachineActions;
  onPlayStateChange?: (playing: boolean) => void;
  /** MIDI Out: wird bei jedem Step-Trigger aufgerufen */
  onMidiOut?: (note: number, velocity: number, partId: string) => void;
  /** MIDI Output-Device-ID für MIDI Clock Output (optional) */
  midiOutputDeviceId?: string | null;
  /** Follow Action: wird ausgelöst wenn Pattern N Bars gespielt hat */
  onFollowAction?: (action: FollowAction, currentPatternId: string) => void;
}

export function useTransport({
  isPlaying,
  midiOutputDeviceId,
  bpm,
  dm,
  onPlayStateChange,
  onMidiOut,
  onFollowAction,
}: UseTransportOptions) {
  const prevPlaying = useRef(false);
  const prevBpm = useRef(bpm);

  // MIDI Out Callback registrieren
  const midiOutRef = useRef(onMidiOut);
  midiOutRef.current = onMidiOut;
  useEffect(() => {
    AudioEngine.setMidiOutCallback(
      midiOutRef.current
        ? (note, vel, partId) => midiOutRef.current?.(note, vel, partId)
        : null
    );
    // MIDI Clock Output (0xF8 Pulse — 24 pro Viertelnote)
    if (onMidiOut && midiOutputDeviceId) {
      AudioEngine.setMidiClockCallback((pulse) => {
        navigator.requestMIDIAccess?.().then(access => {
          const out = access.outputs.get(midiOutputDeviceId);
          out?.send(pulse);
        }).catch(() => {/* ignore */});
      });
    } else {
      AudioEngine.setMidiClockCallback(null);
    }

    return () => { AudioEngine.setMidiOutCallback(null); AudioEngine.setMidiClockCallback(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!onMidiOut, midiOutputDeviceId]);

  // Follow Action Callback registrieren
  const followActionRef = useRef(onFollowAction);
  followActionRef.current = onFollowAction;
  useEffect(() => {
    AudioEngine.setFollowActionCallback(
      (action, patternId) => followActionRef.current?.(action, patternId)
    );
    return () => AudioEngine.setFollowActionCallback(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Globaler Transpose-Wert: an die Audio-Engine weiterleiten
  const { semitones: transposeSemitones } = useTransposeStore();
  useEffect(() => {
    AudioEngine.setGlobalTranspose(transposeSemitones);
  }, [transposeSemitones]);

  // Pattern-Crossfade-Config (v3.269): Store → Engine. Bisher gab es KEINEN
  // Aufrufer von setPatternCrossfade — die Engine-Logik lief nie an. Wirkt nur
  // bei bar-quantisierten (queued) Pattern-Switches im Performance-Mode.
  const crossfadeCfg = usePatternCrossfadeStore();
  useEffect(() => {
    AudioEngine.setPatternCrossfade(crossfadeCfg);
  }, [crossfadeCfg]);

  // Pattern-Getter registrieren (immer aktuell durch Ref)
  const patternRef = useRef(dm.getPlaybackPattern);
  patternRef.current = dm.getPlaybackPattern;

  useEffect(() => {
    AudioEngine.setPatternGetter(() => {
      const p = patternRef.current();
      if (!p) return { id: "", name: "", stepCount: 16 as const, stepResolution: "1/16" as const, bpm: null, parts: [] };
      return p;
    });
    // Melodic getter: liest direkt aus dem Modul-Singleton (kein React-State nötig)
    AudioEngine.setMelodicGetter((partId: string) => {
      const pattern = getPattern(partId);
      return pattern?.steps;
    });
    // Arp getter (v3.268): Snapshot der Arp-Config pro Step. Liest direkt aus
    // useArpStore-Singleton → kein Zirkular-Import, immer aktuell.
    AudioEngine.setArpGetter(() => {
      const s = getArpState();
      if (!s.enabled) return null;
      return {
        enabled: true,
        outputMode: s.outputMode,
        targetPartId: s.targetPartId,
        steps: getArpSteps(),
      };
    });
  }, []);

  // BPM synchronisieren (berücksichtigt Pattern-eigenes BPM + Ratio)
  const dmRef2 = useRef(dm);
  dmRef2.current = dm;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  // patternSwitchCallback (v3.269): Wenn der Engine-Scheduler einen queued
  // (quantisierten) Pattern-Switch am Boundary konsumiert, führen wir hier den
  // tatsächlichen Wechsel aus + leeren die Performance-Display-Queue. Ref-basiert
  // (dmRef2) → kein stale Closure. Vorher war diese Engine-Capability tot.
  useEffect(() => {
    const unsub = AudioEngine.onPatternSwitch((nextId: string) => {
      dmRef2.current.setActivePattern(nextId);
      clearPerformanceQueue();
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (bpm === prevBpm.current) return;
    // Pattern-BPM hat Vorrang
    const pattern = dmRef2.current.getPlaybackPattern();
    let targetBpm = bpm;
    if (pattern?.bpmRatio && pattern.bpmRatio !== 1) {
      targetBpm = Math.round(bpm * pattern.bpmRatio);
    } else if (pattern?.bpm !== null && pattern?.bpm !== undefined) {
      targetBpm = pattern.bpm;
    }
    AudioEngine.setBpm(targetBpm);
    prevBpm.current = bpm;
  }, [bpm]);

  // Play/Stop synchronisieren
  useEffect(() => {
    if (isPlaying === prevPlaying.current) return;
    prevPlaying.current = isPlaying;

    if (isPlaying) {
      const pattern = dm.getPlaybackPattern();
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

  // Position-Callback: Step-Counter + Quantized Commit
  const dmRef = useRef(dm);
  dmRef.current = dm;
  useEffect(() => {
    const unsubscribe = AudioEngine.onPosition(step => {
      const d = dmRef.current;
      d.setCurrentStep(step);
      // Quantized Commit: beim nächsten Bar-Anfang (Step 0) einrasten
      if (step === 0 && d.commitPending) {
        d.commitLivePatternEdit();
      }
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step-Count-Änderungen an Engine weitergeben
  useEffect(() => {
    const pattern = dm.getPlaybackPattern();
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
