/**
 * Synthstudio – useLiveStepRecorder (post-v1.30.0, Welle 2 in v1.31.0+)
 *
 * Live Step Recording (MPC/Maschine-Overdub-Style):
 * MIDI-Noten und andere Step-Input-Events während Playback werden DIREKT
 * als Steps in die aktuell aktive Pattern aufgezeichnet — wie bei klassischen
 * Hardware-Drum-Machines.
 *
 * Modi (Welle 2):
 *  - **Overdub** (Default): bestehende Steps bleiben, neue werden überlagert.
 *  - **Replace**: beim Vorrücken der Playback-Position wird der Step gecleart,
 *    bevor neue Hits aufgezeichnet werden können. Erlaubt es, eine Pattern-
 *    Sektion live neu zu spielen ohne erst clearen zu müssen.
 *
 * Punch-In/Out-Range (Welle 2):
 *  - `punchInStep` (optional): nur ab diesem Step (inkl.) aufzeichnen.
 *  - `punchOutStep` (optional): nur bis zu diesem Step (inkl.) aufzeichnen.
 *  - Wenn punchIn > punchOut, wird die Range um den Loop herum interpretiert
 *    (z.B. punchIn=14, punchOut=2 → Steps 14, 15, 0, 1, 2).
 *  - null + null = keine Punch-Grenze, immer recorden (Default).
 *
 * Nicht abgedeckt (Phase 3):
 *  - Per-Channel Record-Arm (z.B. nur Kick-Spur recorden)
 *  - Quantize-Threshold (50% Snap-to-Nearest statt currentStep)
 *  - Pad-Hit-Input zusätzlich zu MIDI
 */
import { useEffect, useRef } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import { AudioEngine } from "@/audio/AudioEngine";
import { getGmDrumInfo, type DrumCategory } from "@/utils/gmDrumMap";

/** Maps DrumCategory → part-name keywords (lowercased substring match). */
const CATEGORY_KEYWORDS: Record<DrumCategory, string[]> = {
  kicks: ["kick", "bd", "bass drum"],
  snares: ["snare", "sd", "side stick", "rim"],
  hihats: ["hat", "hh", "hi-hat"],
  claps: ["clap", "cp"],
  toms: ["tom", "floor"],
  percussion: ["perc", "cymbal", "ride", "crash", "cowbell", "bongo", "conga", "tambourine"],
  other: [],
};

/**
 * Liefert die Part-ID im aktiven Pattern die zu einer Drum-Kategorie passt.
 * Match-Strategie: case-insensitive substring auf part.name.
 * Returnt null wenn nichts matcht.
 */
export function findPartIdByCategory(
  partNames: Array<{ id: string; name: string }>,
  category: DrumCategory,
): string | null {
  const keywords = CATEGORY_KEYWORDS[category];
  if (keywords.length === 0) return null;
  for (const part of partNames) {
    const nameLower = part.name.toLowerCase();
    for (const kw of keywords) {
      if (nameLower.includes(kw)) return part.id;
    }
  }
  return null;
}

/**
 * Mapt eine MIDI-Note auf die Part-ID im aktiven Pattern.
 * Returnt null wenn keine passende Drum-Kategorie / kein matchender Part.
 */
export function mapMidiNoteToPart(
  note: number,
  partNames: Array<{ id: string; name: string }>,
): string | null {
  const info = getGmDrumInfo(note);
  return findPartIdByCategory(partNames, info.category);
}

/**
 * Prüft ob ein Step innerhalb der Punch-In/Out-Range liegt.
 *
 * Cases:
 *  - punchIn=null && punchOut=null → immer true (kein Punch).
 *  - Nur punchIn gesetzt → step >= punchIn.
 *  - Nur punchOut gesetzt → step <= punchOut.
 *  - Beide gesetzt + punchIn <= punchOut → step in [punchIn, punchOut].
 *  - Beide gesetzt + punchIn > punchOut → wrap-around: step >= punchIn ODER step <= punchOut.
 */
export function isStepInPunchRange(
  step: number,
  punchInStep: number | null,
  punchOutStep: number | null,
): boolean {
  if (punchInStep === null && punchOutStep === null) return true;
  if (punchInStep === null) return step <= (punchOutStep ?? Infinity);
  if (punchOutStep === null) return step >= punchInStep;
  if (punchInStep <= punchOutStep) {
    return step >= punchInStep && step <= punchOutStep;
  }
  // Wrap-around: in oder out
  return step >= punchInStep || step <= punchOutStep;
}

interface UseLiveStepRecorderOptions {
  dm: DrumMachineState & DrumMachineActions;
  isRecording: boolean;
  isPlaying: boolean;
  /** Welle 2: "overdub" (Default) oder "replace". */
  recordingMode?: "overdub" | "replace";
  /** Welle 2: nur ab diesem Step recorden (inkl.). null = unbegrenzt. */
  punchInStep?: number | null;
  /** Welle 2: nur bis zu diesem Step recorden (inkl.). null = unbegrenzt. */
  punchOutStep?: number | null;
}

export function useLiveStepRecorder({
  dm,
  isRecording,
  isPlaying,
  recordingMode = "overdub",
  punchInStep = null,
  punchOutStep = null,
}: UseLiveStepRecorderOptions) {
  // Refs damit der Event-Listener-Closure nicht bei jedem Re-render neu
  // gemountet werden muss.
  const dmRef = useRef(dm);
  dmRef.current = dm;
  const armedRef = useRef(isRecording && isPlaying);
  armedRef.current = isRecording && isPlaying;
  const modeRef = useRef(recordingMode);
  modeRef.current = recordingMode;
  const punchInRef = useRef(punchInStep);
  punchInRef.current = punchInStep;
  const punchOutRef = useRef(punchOutStep);
  punchOutRef.current = punchOutStep;

  // ─── Replace-Mode: AudioEngine.onPosition Hook ─────────────────────────────
  // Beim Vorrücken auf einen neuen Step: wenn replace + armed + Step in Punch-
  // Range → alle Parts in diesem Step clearen, BEVOR neue Hits eingehen können.
  useEffect(() => {
    const unsub = AudioEngine.onPosition((currentStep) => {
      if (!armedRef.current) return;
      if (modeRef.current !== "replace") return;
      if (!isStepInPunchRange(currentStep, punchInRef.current, punchOutRef.current)) return;

      const d = dmRef.current;
      const pattern = d.getActivePattern();
      if (!pattern) return;
      // Alle Parts in diesem Step clearen
      for (const part of pattern.parts) {
        if (part.steps[currentStep]?.active) {
          d.toggleStep(part.id, currentStep);
        }
      }
    });
    return unsub;
  }, []);

  // ─── MIDI-Input → Step ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      // Defensive: niemals aufzeichnen wenn nicht armed + playing
      if (!armedRef.current) return;
      const detail = (e as CustomEvent<{ note: number; velocity: number }>).detail;
      if (!detail || typeof detail.note !== "number") return;

      const d = dmRef.current;
      const pattern = d.getActivePattern();
      if (!pattern) return;

      const partId = mapMidiNoteToPart(detail.note, pattern.parts);
      if (!partId) return; // keine matchende Drum-Kategorie

      const stepIndex = AudioEngine.currentStep;
      if (stepIndex < 0 || stepIndex >= pattern.stepCount) return;

      // Punch-Range check
      if (!isStepInPunchRange(stepIndex, punchInRef.current, punchOutRef.current)) return;

      // Step aktivieren wenn er noch nicht aktiv ist (Overdub-Verhalten —
      // bestehende aktive Steps bleiben unverändert in Overdub-Mode; in
      // Replace-Mode wurde der Step beim onPosition-Callback bereits gecleart).
      const part = pattern.parts.find((p) => p.id === partId);
      if (!part) return;
      const stepCurrent = part.steps[stepIndex];
      if (!stepCurrent?.active) {
        d.toggleStep(partId, stepIndex);
      }
      // Velocity vom MIDI-Event übernehmen (Range 1-127)
      const vel = Math.max(1, Math.min(127, detail.velocity ?? 100));
      d.setStepVelocity(partId, stepIndex, vel);
    };

    window.addEventListener("stepinput:noteon", handler);
    return () => window.removeEventListener("stepinput:noteon", handler);
  }, []); // armedRef + dmRef + modeRef + punchRefs gelesen — kein Re-Mount nötig
}
