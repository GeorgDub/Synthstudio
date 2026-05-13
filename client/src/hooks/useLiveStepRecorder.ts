/**
 * Synthstudio – useLiveStepRecorder (post-v1.30.0)
 *
 * Live Step Recording (MPC/Maschine-Overdub-Style):
 * MIDI-Noten und andere Step-Input-Events während Playback werden DIREKT
 * als Steps in die aktuell aktive Pattern aufgezeichnet — wie bei klassischen
 * Hardware-Drum-Machines.
 *
 * Flow:
 *  1. User aktiviert Record-Arm im Transport (rote `isRecording` flag).
 *  2. User startet Playback (`isPlaying = true`).
 *  3. User triggert MIDI-Note (oder Pad-Hit) via Hardware-Keyboard / Trigger Pad.
 *  4. Der Hook fängt das `stepinput:noteon`-Event ab.
 *  5. MIDI-Note → Drum-Kategorie (via gmDrumMap) → passender Part im
 *     aktuellen Pattern (Name-Match).
 *  6. Der aktuell spielende Step (`AudioEngine.currentStep`) wird im Part
 *     aktiviert + Velocity-Wert übernommen.
 *
 * Modi:
 *  - **Overdub** (Default): bestehende Steps bleiben, neue werden überlagert.
 *  - **Replace**: wenn der Step beim Aufzeichnen schon aktiv ist, wird er
 *    auch beim erneuten Trigger NICHT gelöscht (Overdub-only-v1).
 *
 * Nicht abgedeckt (Phase 2):
 *  - Punch-In/Out-Range
 *  - Velocity-Curve (linear vs scaled)
 *  - Per-Channel Record-Arm
 *  - Quantize-Threshold (50% Schritt-Snap statt currentStep)
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

interface UseLiveStepRecorderOptions {
  dm: DrumMachineState & DrumMachineActions;
  isRecording: boolean;
  isPlaying: boolean;
}

export function useLiveStepRecorder({ dm, isRecording, isPlaying }: UseLiveStepRecorderOptions) {
  // Refs damit der Event-Listener-Closure nicht bei jedem Re-render neu
  // gemountet werden muss.
  const dmRef = useRef(dm);
  dmRef.current = dm;
  const armedRef = useRef(isRecording && isPlaying);
  armedRef.current = isRecording && isPlaying;

  useEffect(() => {
    const handler = (e: Event) => {
      // Defensive: niemals zur aufzeichnen wenn nicht armed + playing
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

      // Step aktivieren wenn er noch nicht aktiv ist (Overdub-Verhalten —
      // bestehende aktive Steps bleiben unverändert).
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
  }, []); // armedRef + dmRef gelesen — kein Re-Mount nötig
}
