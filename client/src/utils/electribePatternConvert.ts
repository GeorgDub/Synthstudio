/**
 * client/src/utils/electribePatternConvert.ts
 *
 * v3.26.0 — Synthstudio → KORG E2 Sampler `.e2spat` adapter.
 *
 * Bridges the Synthstudio `PatternData` (16 / 32 steps × 16 drum parts) to the
 * `E2PatternInput` accepted by `buildE2PatternFile`.
 *
 * Mapping rules (kept in sync with reader-side `convertParsedPatternToSynthstudio`):
 *   - PatternData.bpm (`null` → fallback 120 BPM)            → bpm
 *   - Synthstudio 16/32 stepCount                            → E2 stepLength
 *       16  → 16   (E2 code 0)
 *       32  → 32   (E2 code 1)
 *       (other) → 16 (defensive default)
 *     Synthstudio does not currently produce 64-step patterns, but if a caller
 *     hands one in (cast as `unknown`), we accept it and emit code 3.
 *   - PartData.volume (0..1)         → E2 part volume 0..127 (× 127, round)
 *   - PartData.pan (-1..+1)          → E2 part pan 0..127 (64 + value × 63, round)
 *   - StepData.active                → step.active
 *   - StepData.velocity (0..127)     → step.velocity (default 96 if undefined)
 *   - StepData.pitch (semitones)     → step.note = 0x48 (C5) + pitch, clamped
 *                                     0..127
 *   - StepData.accent? (not in Synthstudio) → defaults to false
 *
 * Padding behaviour:
 *   - Synthstudio Pattern has up to 16 parts. If fewer, the remaining E2
 *     parts are empty (all-default) so the resulting `.e2spat` is always
 *     16 × 816 bytes after the header.
 *   - Synthstudio steps array (16 or 32 entries) is zero-padded to E2's
 *     hardware-fixed 64 step records per part. The chosen `stepLength` code
 *     (0/1/3) tells the hardware how many of those 64 to actually play.
 *
 * NOTE: This module imports only TYPES from AudioEngine; no runtime audio code
 * is touched, keeping it isomorphic and safe to call from Node test contexts.
 */

import type { PatternData, PartData, StepData } from "../audio/AudioEngine";
import type {
  E2PatternInput,
  E2PartInput,
  E2StepInput,
  E2MotionSlot,
} from "./electribePatternBuilder";

// ─── Constants ───────────────────────────────────────────────────────────────

/** MIDI note for "no pitch shift" — matches the read-side default 0x48 = C5. */
const E2_BASE_NOTE = 0x48;
/** Maximum parts an E2 pattern has. */
const E2_MAX_PARTS = 16;
/** Default BPM used when PatternData.bpm is null. */
const E2_DEFAULT_BPM = 120;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const v = Math.floor(value);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

/** Synthstudio volume (0..1) → KORG E2 volume (0..127). */
export function synthVolumeToE2(volume: number | undefined): number {
  if (typeof volume !== "number") return 127;
  return clampInt(Math.round(clamp01(volume) * 127), 0, 127);
}

/** Synthstudio pan (-1..+1) → KORG E2 pan (0..127, 64 = center). */
export function synthPanToE2(pan: number | undefined): number {
  if (typeof pan !== "number") return 64;
  const p = clampPan(pan);
  // p = -1 → 1, p = 0 → 64, p = +1 → 127
  return clampInt(Math.round(64 + p * 63), 0, 127);
}

/** Synthstudio step.pitch (semitones, signed) → KORG E2 note number 0..127.
 *  E2 hardware default is C5 (0x48 = 72); pitch is applied as an offset. */
export function synthPitchToE2Note(pitch: number | undefined): number {
  if (typeof pitch !== "number") return E2_BASE_NOTE;
  const note = E2_BASE_NOTE + Math.floor(pitch);
  return clampInt(note, 0, 127);
}

/** Maps Synthstudio's 16/32 stepCount → KORG E2 stepLength.
 *  Permissively accepts a 64 value too (for callers handing in raw numbers). */
export function synthStepCountToE2StepLength(
  stepCount: number | undefined,
): 16 | 32 | 64 {
  if (stepCount === 32) return 32;
  if (stepCount === 64) return 64;
  // 16 is the only other Synthstudio-supported value, plus a safe default.
  return 16;
}

// ─── Step + Part conversion ──────────────────────────────────────────────────

/** Convert one Synthstudio step → E2 step. */
export function convertStepToE2(step: StepData | undefined): E2StepInput {
  if (!step) return { active: false };
  // v3.309: Chord-Noten (aus E2-Import, im Step-Editor sichtbar) beim Export
  // zurückgeben — nur gültige MIDI-Werte, max. 3 Slots (E2-Bytes 5..7).
  const chord = Array.isArray(step.chordNotes)
    ? step.chordNotes.filter(n => Number.isFinite(n) && n > 0 && n <= 127).slice(0, 3)
    : [];
  return {
    active: !!step.active,
    velocity:
      typeof step.velocity === "number" ? clampInt(step.velocity, 0, 127) : undefined,
    note: synthPitchToE2Note(step.pitch),
    accent: false, // Synthstudio has no first-class accent flag.
    ...(chord.length > 0 ? { chordNotes: chord } : {}),
  };
}

/** Convert one Synthstudio part → E2 part. */
export function convertPartToE2(part: PartData | undefined): E2PartInput {
  if (!part) {
    return { steps: [] };
  }
  // Steps: copy as-is (length up to 32). Builder pads to 64.
  const steps: E2StepInput[] = (part.steps ?? []).map(convertStepToE2);
  return {
    volume: synthVolumeToE2(part.volume),
    pan: synthPanToE2(part.pan),
    pitch: 0,
    fxSend: 0,
    steps,
  };
}

// ─── Top-level adapter ───────────────────────────────────────────────────────

export interface ConvertSynthstudioOptions {
  /** Global BPM fallback if PatternData.bpm is null. Default 120. */
  globalBpm?: number;
  /** Optional motion-slot passthrough (caller provides them already encoded in
   *  E2 layout — we do not synthesize them from Synthstudio Automation Lanes
   *  in this initial v3.26.0 cut). */
  motionSlots?: E2MotionSlot[];
}

/**
 * Converts a Synthstudio `PatternData` into the `E2PatternInput` shape consumed
 * by `buildE2PatternFile`. The output is always structurally valid:
 *
 *   - exactly 16 parts (padded with empty parts if fewer)
 *   - stepLength ∈ {16, 32, 64}
 *   - BPM clamped to [20, 300]
 *   - name truncated to 16 chars (the builder does the truncation too — we
 *     pass the full string through and let the builder enforce the limit).
 */
export function convertSynthstudioPatternToE2(
  pattern: PatternData,
  options?: ConvertSynthstudioOptions,
): E2PatternInput {
  const globalBpm = options?.globalBpm ?? E2_DEFAULT_BPM;
  const bpm =
    typeof pattern.bpm === "number" && Number.isFinite(pattern.bpm) && pattern.bpm > 0
      ? pattern.bpm
      : globalBpm;

  const stepLength = synthStepCountToE2StepLength(pattern.stepCount);

  // Pad / truncate parts list to exactly 16 entries.
  const partsIn = Array.isArray(pattern.parts) ? pattern.parts : [];
  const parts: E2PartInput[] = new Array(E2_MAX_PARTS);
  for (let i = 0; i < E2_MAX_PARTS; i++) {
    parts[i] = convertPartToE2(partsIn[i]);
  }

  return {
    name: pattern.name ?? "Synthstudio",
    bpm,
    stepLength,
    swing: 0,
    parts,
    motionSlots: options?.motionSlots,
  };
}
