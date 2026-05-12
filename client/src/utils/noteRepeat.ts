/**
 * Synthstudio – Note-Repeat Utility (MPC-Style Live Retrigger)
 *
 * Definiert die Rate-Konstanten und Helper für das Live-Retriggering
 * eines Drum-Pads in einem rhythmischen Subdivision (z.B. 1/16, 1/8T).
 *
 * Verwendung: `rateToIntervalMs(rate, bpm)` liefert den Abstand in ms
 * zwischen zwei aufeinanderfolgenden Triggers.
 */

export type NoteRepeatRate =
  | "1/4"
  | "1/8"
  | "1/16"
  | "1/32"
  | "1/4T"
  | "1/8T"
  | "1/16T"
  | "1/32T";

export interface NoteRepeatRateDef {
  rate: NoteRepeatRate;
  label: string;
  /** Anzahl Beats (Quarter-Notes) zwischen zwei Triggers. */
  beats: number;
}

/**
 * Beats pro Trigger – wir definieren 1 Beat = Quarter-Note.
 * - 1/4 = 1 Beat
 * - 1/8 = 1/2 Beat
 * - 1/16 = 1/4 Beat
 * - 1/32 = 1/8 Beat
 * - Triplets (T): drei Trigger pro Standard-Subdivision, daher 2/3 × Standardwert
 */
export const NOTE_REPEAT_RATES: readonly NoteRepeatRateDef[] = [
  { rate: "1/4",   label: "1/4",   beats: 1     },
  { rate: "1/8",   label: "1/8",   beats: 1 / 2 },
  { rate: "1/16",  label: "1/16",  beats: 1 / 4 },
  { rate: "1/32",  label: "1/32",  beats: 1 / 8 },
  { rate: "1/4T",  label: "1/4T",  beats: 2 / 3 },
  { rate: "1/8T",  label: "1/8T",  beats: 1 / 3 },
  { rate: "1/16T", label: "1/16T", beats: 1 / 6 },
  { rate: "1/32T", label: "1/32T", beats: 1 / 12 },
];

const RATE_INDEX = new Map(NOTE_REPEAT_RATES.map((r) => [r.rate, r] as const));

export function getRateDef(rate: NoteRepeatRate): NoteRepeatRateDef {
  const def = RATE_INDEX.get(rate);
  if (!def) throw new Error(`Unknown note-repeat rate: ${rate}`);
  return def;
}

/**
 * Liefert den Abstand zwischen zwei Triggers in Millisekunden.
 *
 * Formel: ms = (beats * 60_000) / bpm
 */
export function rateToIntervalMs(rate: NoteRepeatRate, bpm: number): number {
  if (bpm <= 0) throw new Error("BPM must be > 0");
  const beats = getRateDef(rate).beats;
  return (beats * 60_000) / bpm;
}

/**
 * Min-Intervall in ms, um Browser-/Timer-Overhead nicht zu unterschreiten.
 * setInterval kann unter ~4ms unzuverlässig werden. Wir clampen daher
 * auf 10ms (eher konservativ).
 */
export const MIN_INTERVAL_MS = 10;

export function safeIntervalMs(rate: NoteRepeatRate, bpm: number): number {
  return Math.max(MIN_INTERVAL_MS, rateToIntervalMs(rate, bpm));
}
