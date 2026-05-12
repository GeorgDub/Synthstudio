/**
 * Synthstudio – DrumMachine Helpers
 *
 * Reine Utility-Funktionen + Konstanten aus DrumMachine.tsx ausgelagert.
 */
import type { StepCondition } from "@/audio/AudioEngine";

export function velocityColor(velocity: number, active: boolean): string {
  if (!active) return "bg-bg-elevated hover:bg-bg-elevated";
  const v = velocity / 127;
  if (v > 0.85) return "bg-accent-secondary hover:bg-accent-secondary";
  if (v > 0.65) return "bg-accent-primary hover:bg-accent-secondary";
  if (v > 0.45) return "bg-accent-primary hover:bg-accent-primary";
  if (v > 0.25) return "bg-accent-primary/70 hover:bg-accent-primary";
  return "bg-accent-primary/40 hover:bg-accent-primary/70";
}

export function stepGroupBorder(index: number, total: number): string {
  if (total === 16) {
    return index % 4 === 0 ? "ml-1" : "";
  }
  return index % 8 === 0 ? "ml-1.5" : index % 4 === 0 ? "ml-0.5" : "";
}

export const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","A","A#","B"];

export function pitchToLabel(semitones: number): string {
  const base = 60 + semitones; // C4 = 60
  return `${NOTE_NAMES[base % 12]}${Math.floor(base / 12) - 1} (${semitones >= 0 ? "+" : ""}${semitones})`;
}

export const CONDITION_OPTIONS: Array<{ label: string; value: StepCondition }> = [
  { label: "Immer",    value: { type: "always" } },
  { label: "1:2",      value: { type: "every", n: 1, of: 2 } },
  { label: "2:2",      value: { type: "every", n: 2, of: 2 } },
  { label: "1:3",      value: { type: "every", n: 1, of: 3 } },
  { label: "1:4",      value: { type: "every", n: 1, of: 4 } },
  { label: "2:4",      value: { type: "every", n: 2, of: 4 } },
  { label: "3:4",      value: { type: "every", n: 3, of: 4 } },
  { label: "4:4",      value: { type: "every", n: 4, of: 4 } },
  { label: "Fill",     value: { type: "fill" } },
  { label: "!Fill",    value: { type: "not_fill" } },
];

export function conditionToLabel(c: StepCondition | undefined): string {
  if (!c || c.type === "always") return "Immer";
  if (c.type === "fill")     return "Fill";
  if (c.type === "not_fill") return "!Fill";
  return `${c.n}:${c.of}`;
}

export const NOTE_LENGTH_PRESETS: Array<{ label: string; value: number }> = [
  { label: "1/4", value: 0.25 },
  { label: "1/2", value: 0.5 },
  { label: "1",   value: 1 },
  { label: "2",   value: 2 },
  { label: "4",   value: 4 },
];
