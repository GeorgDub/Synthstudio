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

// ─── v3.40 64-Step Page-Switcher Helpers ───────────────────────────────────
//
// Bei stepCount > 16 wird das Step-Grid in 16er-Pages aufgeteilt damit Cells
// nicht auf ~7px zusammengestaucht werden. Pure-funktional damit testbar.

/** Steps pro Page im 64-Step-Modus (immer 16). */
export const STEPS_PER_PAGE = 16;

/**
 * Liefert die Anzahl Pages für ein Pattern.
 * - stepCount 16 → 1 (kein Switcher nötig)
 * - stepCount 32 → 2
 * - stepCount 64 → 4
 * - sonst: ceil(stepCount / 16), defensiv mindestens 1.
 */
export function getPageCount(stepCount: number): number {
  if (!Number.isFinite(stepCount) || stepCount <= STEPS_PER_PAGE) return 1;
  return Math.max(1, Math.ceil(stepCount / STEPS_PER_PAGE));
}

/**
 * Liefert für eine Page-ID den [start, end)-Step-Range im Pattern.
 * Page wird auf gültiges Intervall geclampt.
 */
export function getPageStepRange(
  stepCount: number,
  page: number,
): { start: number; end: number } {
  const pages = getPageCount(stepCount);
  const safePage = Math.max(0, Math.min(pages - 1, Math.floor(page)));
  const start = safePage * STEPS_PER_PAGE;
  const end = Math.min(stepCount, start + STEPS_PER_PAGE);
  return { start, end };
}

/**
 * Liefert die Page-ID für einen gegebenen Step (z. B. für Auto-Follow während
 * Playback). Defensive bei negativen oder oversize-Indices.
 */
export function getPageForStep(stepIndex: number, stepCount: number): number {
  const pages = getPageCount(stepCount);
  if (!Number.isFinite(stepIndex) || stepIndex < 0) return 0;
  const safeIndex = Math.min(stepIndex, stepCount - 1);
  return Math.max(0, Math.min(pages - 1, Math.floor(safeIndex / STEPS_PER_PAGE)));
}

/**
 * Liefert ein Page-Label "1/N" für ein 1-basiertes Display.
 * Beispiele: (0, 64) → "1/4", (2, 64) → "3/4", (1, 32) → "2/2".
 */
export function getPageLabel(page: number, stepCount: number): string {
  const pages = getPageCount(stepCount);
  const safePage = Math.max(0, Math.min(pages - 1, Math.floor(page)));
  return `${safePage + 1}/${pages}`;
}

/**
 * Detaillierterer Label-Range "1-16", "17-32", … — wird im Header der
 * Page-Buttons gerendert.
 */
export function getPageRangeLabel(page: number, stepCount: number): string {
  const { start, end } = getPageStepRange(stepCount, page);
  return `${start + 1}-${end}`;
}

export const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","A","A#","B"];

/**
 * v2.51 (TASK-129 Welle 3): liefert das Badge-Label + Tooltip für den
 * aktuellen sourceType eines Parts. Wird in ChannelStrip neben dem
 * Part-Namen gerendert damit User auf einen Blick sieht, ob ein Kanal
 * sample/wavetable/fm/granular ist.
 *
 * Read-only Indicator — direktes UI-Switching braucht zusätzlich
 * Default-synthParams (für wavetable/fm) bzw. Granular-Setup, weshalb
 * der Switch über Patches/Granular-Panel bleibt.
 */
export type SourceTypeBadge = { label: string; long: string; isSample: boolean };

export function getSourceTypeBadge(sourceType?: string): SourceTypeBadge {
  switch (sourceType) {
    case "wavetable": return { label: "WT", long: "Wavetable-Synth", isSample: false };
    case "fm":        return { label: "FM", long: "FM-Synth", isSample: false };
    case "granular":  return { label: "GR", long: "Granular-Synth", isSample: false };
    default:          return { label: "SMP", long: "Sample-Player", isSample: true };
  }
}

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
