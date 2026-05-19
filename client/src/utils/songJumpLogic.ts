/**
 * Synthstudio – songJumpLogic.ts (v3.117.0)
 *
 * Pure helper for conditional Song-Jumps (extends v3.109 Song-Mode).
 *
 * A Jump defines a "from step → to step" transition that fires when a
 * condition evaluates to true. Conditions can read macros (0..1) or react
 * to recent MIDI events (note/cc) — perfect for live performance.
 *
 * All functions are pure and side-effect free.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type JumpCondition =
  | { kind: "always" }
  | { kind: "macro-above"; macroIdx: number; threshold: number }
  | { kind: "macro-below"; macroIdx: number; threshold: number }
  | { kind: "midi-note"; note: number; channel?: number }
  | { kind: "midi-cc"; cc: number; valueAbove: number };

export interface Jump {
  id: string;
  /** ID of the song-step from which the jump originates. */
  fromStepId: string;
  /** ID of the target song-step. */
  toStepId: string;
  condition: JumpCondition;
  /** Optional human-readable label shown in the editor. */
  label?: string;
}

export interface MidiNoteEvent {
  note: number;
  channel: number;
  /** Timestamp in milliseconds (performance.now() or Date.now()). */
  timestamp?: number;
}

export interface MidiCcEvent {
  cc: number;
  value: number;
  channel: number;
  timestamp?: number;
}

export interface JumpEvalContext {
  /** Macro values, indexed 0..7, range 0..1. */
  macros: number[];
  /** Most recent MIDI note received (or null). */
  lastMidiNote?: MidiNoteEvent | null;
  /** Most recent MIDI CC received (or null). */
  lastMidiCc?: MidiCcEvent | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const MACRO_COUNT = 8;
export const MIDI_NOTE_MIN = 0;
export const MIDI_NOTE_MAX = 127;
export const MIDI_CC_MIN = 0;
export const MIDI_CC_MAX = 127;
export const MIDI_CHANNEL_MIN = 0;
export const MIDI_CHANNEL_MAX = 15;

// ─── Validation helpers ──────────────────────────────────────────────────────

function safeNumber(n: unknown, fallback = 0): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return n;
}

function clampMacroValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ─── Pure evaluator ──────────────────────────────────────────────────────────

/**
 * Evaluates a JumpCondition against a context.
 *
 * - "always":        true (unconditional jump)
 * - "macro-above":   macros[idx] > threshold
 * - "macro-below":   macros[idx] < threshold
 * - "midi-note":     lastMidiNote matches note (and optional channel)
 * - "midi-cc":       lastMidiCc matches cc AND value > valueAbove
 *
 * Defensive against malformed input — returns false on any garbage.
 */
export function evaluateCondition(cond: JumpCondition, ctx: JumpEvalContext): boolean {
  if (!cond || typeof cond !== "object") return false;
  if (!ctx || typeof ctx !== "object") return false;

  switch (cond.kind) {
    case "always":
      return true;

    case "macro-above": {
      const idx = Math.floor(safeNumber(cond.macroIdx, -1));
      if (idx < 0 || idx >= MACRO_COUNT) return false;
      const arr = Array.isArray(ctx.macros) ? ctx.macros : [];
      const val = clampMacroValue(safeNumber(arr[idx], 0));
      const thr = clampMacroValue(safeNumber(cond.threshold, 0));
      return val > thr;
    }

    case "macro-below": {
      const idx = Math.floor(safeNumber(cond.macroIdx, -1));
      if (idx < 0 || idx >= MACRO_COUNT) return false;
      const arr = Array.isArray(ctx.macros) ? ctx.macros : [];
      const val = clampMacroValue(safeNumber(arr[idx], 0));
      const thr = clampMacroValue(safeNumber(cond.threshold, 0));
      return val < thr;
    }

    case "midi-note": {
      const target = Math.floor(safeNumber(cond.note, -1));
      if (target < MIDI_NOTE_MIN || target > MIDI_NOTE_MAX) return false;
      const last = ctx.lastMidiNote;
      if (!last || typeof last !== "object") return false;
      if (Math.floor(safeNumber(last.note, -1)) !== target) return false;
      // Optional channel filter
      if (typeof cond.channel === "number") {
        const wantedCh = Math.floor(cond.channel);
        if (wantedCh < MIDI_CHANNEL_MIN || wantedCh > MIDI_CHANNEL_MAX) return false;
        if (Math.floor(safeNumber(last.channel, -1)) !== wantedCh) return false;
      }
      return true;
    }

    case "midi-cc": {
      const target = Math.floor(safeNumber(cond.cc, -1));
      if (target < MIDI_CC_MIN || target > MIDI_CC_MAX) return false;
      const last = ctx.lastMidiCc;
      if (!last || typeof last !== "object") return false;
      if (Math.floor(safeNumber(last.cc, -1)) !== target) return false;
      const valueAbove = Math.floor(safeNumber(cond.valueAbove, -1));
      const actual = Math.floor(safeNumber(last.value, -1));
      return actual > valueAbove;
    }

    default:
      return false;
  }
}

/**
 * Iterates over `jumps`, returns the first jump whose `fromStepId` matches
 * `currentStepId` AND whose condition evaluates to true. Returns null when
 * none triggers.
 *
 * Order of jumps determines priority — earlier entries win.
 */
export function findTriggeredJump(
  jumps: Jump[],
  currentStepId: string,
  ctx: JumpEvalContext
): Jump | null {
  if (!Array.isArray(jumps) || jumps.length === 0) return null;
  if (typeof currentStepId !== "string" || !currentStepId) return null;
  for (const j of jumps) {
    if (!j || typeof j !== "object") continue;
    if (j.fromStepId !== currentStepId) continue;
    if (typeof j.toStepId !== "string" || !j.toStepId) continue;
    if (evaluateCondition(j.condition, ctx)) return j;
  }
  return null;
}

// ─── Human-readable labels ───────────────────────────────────────────────────

/**
 * Formats a condition into a short string for UI display.
 * e.g. "Macro 1 > 50%", "MIDI Note 60", "Always".
 */
export function describeCondition(cond: JumpCondition): string {
  if (!cond || typeof cond !== "object") return "?";
  switch (cond.kind) {
    case "always":
      return "Always";
    case "macro-above":
      return `Macro ${cond.macroIdx + 1} > ${Math.round(cond.threshold * 100)}%`;
    case "macro-below":
      return `Macro ${cond.macroIdx + 1} < ${Math.round(cond.threshold * 100)}%`;
    case "midi-note": {
      const ch = typeof cond.channel === "number" ? ` (ch ${cond.channel + 1})` : "";
      return `MIDI Note ${cond.note}${ch}`;
    }
    case "midi-cc":
      return `MIDI CC ${cond.cc} > ${cond.valueAbove}`;
    default:
      return "?";
  }
}
