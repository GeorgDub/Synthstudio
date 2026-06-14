/**
 * Synthstudio – useLaunchpad
 *
 * Novation Launchpad / Push / APC40 Integration.
 * Mappt das 8×8 Button-Grid auf DrumMachine-Steps.
 *
 * Unterstützte Geräte (auto-detektiert nach Name):
 *  - Novation Launchpad (MK1/MK2/Mini)
 *  - Ableton Push
 *  - Akai APC40/APC Mini
 *  - Generisches 8×8 MIDI-Grid (konfigurierbar)
 *
 * Protokoll:
 *  - NoteOn: Grid-Button gedrückt → Step togglen
 *  - SysEx: LED-Farbe setzen (Launchpad MK1 Protokoll)
 *
 * Farb-Codes (Launchpad MK1):
 *  - 0x0C = Grün (aktiver Step)
 *  - 0x0F = Gelb (aktueller Playback-Step)
 *  - 0x00 = Aus (inaktiver Step)
 *  - 0x0D = Amber (Part-Auswahl-Indikator)
 */
import { useEffect, useRef } from "react";
import type { MidiState, MidiActions } from "./useMidi";
import { getPlayheadStep, subscribePlayhead } from "@/store/usePlayheadStore";

export interface LaunchpadOptions {
  midi: MidiState & MidiActions;
  /** Aktuelle Steps (16 Werte, aktiv/inaktiv) */
  steps: Array<{ active: boolean; velocity: number }>;
  /** Callback wenn Grid-Button gedrückt */
  onStepToggle: (stepIndex: number) => void;
  /** Ob Integration aktiv ist */
  enabled: boolean;
}

/** Erkennt ob ein MIDI-Gerät ein unterstütztes Grid-Controller ist */
export function isGridDevice(deviceName: string): boolean {
  const lower = deviceName.toLowerCase();
  return lower.includes("launchpad") || lower.includes("push") || lower.includes("apc") || lower.includes("grid");
}

/**
 * Konvertiert Note-Nummer zu Step-Index für Launchpad 8×8 Grid.
 * Launchpad MK1: Noten 0–63 (Reihen × 16 + Spalte)
 */
function noteToStep(note: number): number | null {
  // Launchpad: oberste Reihe = Noten 0–7, zweite = 16–23, etc.
  const row = Math.floor(note / 16);
  const col = note % 16;
  if (row === 0 && col < 8) return col;    // Erste Reihe = Steps 0–7
  if (row === 1 && col < 8) return col + 8; // Zweite Reihe = Steps 8–15
  return null;
}

/** Sendet eine LED-Farbe an einen Launchpad-Button via NoteOn */
function sendLedColor(
  output: MIDIOutput | null,
  note: number,
  color: number,
  channel: number = 0,
) {
  if (!output) return;
  try { output.send([0x90 | channel, note, color]); } catch { /* ignore */ }
}

export function useLaunchpad({ midi, steps, onStepToggle, enabled }: LaunchpadOptions) {
  const outputRef = useRef<MIDIOutput | null>(null);

  // Ausgabe-Device finden (erstes Grid-Gerät)
  useEffect(() => {
    if (!enabled || !midi.isEnabled) return;
    const outDevice = midi.outputDevices.find(d => isGridDevice(d.name));
    if (!outDevice) { outputRef.current = null; return; }

    // Über Web MIDI API auf das Output zugreifen
    navigator.requestMIDIAccess?.().then(access => {
      const out = access.outputs.get(outDevice.id);
      outputRef.current = out ?? null;
    }).catch(() => { outputRef.current = null; });
  }, [enabled, midi.isEnabled, midi.outputDevices]);

  // LED-Update wenn sich Steps ändern ODER der Playhead-Step tickt.
  // TASK-251: Der Playhead-Step kommt NICHT mehr als Prop (das hätte einen
  // App.tsx-Rerender pro Step erzwungen). Stattdessen abonnieren wir den
  // usePlayheadStore imperativ via subscribePlayhead und lesen den Step bei
  // jedem Tick mit getPlayheadStep() — kein React-Rerender involviert.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => {
    if (!enabled) return;
    const renderLeds = () => {
      const out = outputRef.current;
      if (!out) return;
      const s = stepsRef.current;
      const currentStep = getPlayheadStep();
      // Erste Reihe (Steps 0–7) updaten
      for (let i = 0; i < Math.min(8, s.length); i++) {
        const isPlaying = i === currentStep;
        const color = isPlaying ? 0x3F : s[i]?.active ? 0x3C : 0x00;
        sendLedColor(out, i, color);
      }
      // Zweite Reihe (Steps 8–15) updaten
      for (let i = 8; i < Math.min(16, s.length); i++) {
        const note = 16 + (i - 8);
        const isPlaying = i === currentStep;
        const color = isPlaying ? 0x3F : s[i]?.active ? 0x3C : 0x00;
        sendLedColor(out, note, color);
      }
    };
    renderLeds();
    return subscribePlayhead(renderLeds);
  }, [enabled, steps]);

  // Input-Handler: Grid-Buttons → Step-Toggle
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: Event) => {
      const { type, byte1: note, byte2: velocity } = (e as CustomEvent).detail;
      if (type !== 0x90 || velocity === 0) return;
      const stepIdx = noteToStep(note);
      if (stepIdx !== null && stepIdx < steps.length) {
        onStepToggle(stepIdx);
      }
    };

    window.addEventListener("midi:rawmessage", handler);
    return () => window.removeEventListener("midi:rawmessage", handler);
  }, [enabled, steps.length, onStepToggle]);
}
