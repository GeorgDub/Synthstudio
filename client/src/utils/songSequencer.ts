/**
 * Synthstudio – songSequencer.ts (v3.109.0)
 *
 * Pure helper for the Song-Mode / Pattern-Chain-Sequencer feature.
 *
 * A Song is an ordered list of SongSteps, each referencing a patternId and
 * a repeatCount (1..64). When a step has been played N times (where N =
 * repeatCount), the sequencer advances to the next step.
 *
 * Loop modes:
 *   - "once":     stop after last step (returns isFinished=true)
 *   - "loop":     wrap around from last to first
 *   - "pingpong": at end reverse direction; at start reverse again
 *
 * All functions are pure and side-effect free.
 */

export interface SongStep {
  id: string;
  patternId: string;
  /** how many times this step is played before advancing (1..64) */
  repeatCount: number;
  label?: string;
}

export type SongLoopMode = "once" | "loop" | "pingpong";

export interface Song {
  id: string;
  name: string;
  steps: SongStep[];
  loopMode: SongLoopMode;
}

export interface NextStepResult {
  /** index of the step that should play next (-1 if finished) */
  nextStepIdx: number;
  /** repeat counter for the next play */
  nextRepeat: number;
  /** patternId of the next step, or null if finished */
  patternId: string | null;
  /** true when the song has fully finished (only "once" mode) */
  isFinished: boolean;
  /** internal direction flag used by pingpong (+1 forward, -1 backward) */
  direction: 1 | -1;
}

export const MIN_REPEAT = 1;
export const MAX_REPEAT = 64;

/**
 * Clamps a repeat-count value to MIN_REPEAT..MAX_REPEAT. Integer-rounded.
 * NaN / non-finite → MIN_REPEAT.
 */
export function clampRepeatCount(n: number): number {
  if (!Number.isFinite(n)) return MIN_REPEAT;
  const r = Math.round(n);
  if (r < MIN_REPEAT) return MIN_REPEAT;
  if (r > MAX_REPEAT) return MAX_REPEAT;
  return r;
}

const FINISHED: NextStepResult = {
  nextStepIdx: -1,
  nextRepeat: 0,
  patternId: null,
  isFinished: true,
  direction: 1,
};

/**
 * Compute the next step in the song.
 *
 * @param song            The song definition
 * @param currentStepIdx  Index of the step currently playing (0-based)
 * @param currentRepeat   How often this step has already played (0-based; 0
 *                        means this is the first play, so result advances to
 *                        repeat=1 etc.)
 * @param direction       +1 forward / -1 backward (only meaningful for
 *                        pingpong). Defaults to +1.
 *
 * Algorithm:
 *   - If repeatCount > currentRepeat + 1 → same step, repeat = currentRepeat + 1
 *   - Else → advance step depending on loopMode
 */
export function getNextStep(
  song: Song,
  currentStepIdx: number,
  currentRepeat: number,
  direction: 1 | -1 = 1
): NextStepResult {
  const steps = song.steps;
  if (!Array.isArray(steps) || steps.length === 0) return { ...FINISHED };

  // Boundary defense
  if (currentStepIdx < 0 || currentStepIdx >= steps.length) return { ...FINISHED };

  const cur = steps[currentStepIdx];
  const curRepeat = Math.max(0, Math.floor(currentRepeat));
  const cap = clampRepeatCount(cur.repeatCount);

  // Stay on same step?
  if (curRepeat + 1 < cap) {
    return {
      nextStepIdx: currentStepIdx,
      nextRepeat: curRepeat + 1,
      patternId: cur.patternId,
      isFinished: false,
      direction,
    };
  }

  // Advance to next step
  const len = steps.length;
  const dir = direction === -1 ? -1 : 1;

  if (song.loopMode === "once") {
    // Forward-only in once mode
    const nextIdx = currentStepIdx + 1;
    if (nextIdx >= len) return { ...FINISHED };
    return {
      nextStepIdx: nextIdx,
      nextRepeat: 0,
      patternId: steps[nextIdx].patternId,
      isFinished: false,
      direction: 1,
    };
  }

  if (song.loopMode === "loop") {
    const nextIdx = (currentStepIdx + 1) % len;
    return {
      nextStepIdx: nextIdx,
      nextRepeat: 0,
      patternId: steps[nextIdx].patternId,
      isFinished: false,
      direction: 1,
    };
  }

  // pingpong
  // Single-step song: just stay
  if (len === 1) {
    return {
      nextStepIdx: 0,
      nextRepeat: 0,
      patternId: steps[0].patternId,
      isFinished: false,
      direction: dir,
    };
  }

  // Compute candidate
  let nextDir: 1 | -1 = dir;
  let nextIdx = currentStepIdx + dir;
  if (nextIdx >= len) {
    // bounce backwards
    nextDir = -1;
    nextIdx = currentStepIdx - 1;
  } else if (nextIdx < 0) {
    // bounce forwards
    nextDir = 1;
    nextIdx = currentStepIdx + 1;
  }
  // Re-clamp (defensive: should not be needed for len>=2)
  if (nextIdx < 0) nextIdx = 0;
  if (nextIdx >= len) nextIdx = len - 1;

  return {
    nextStepIdx: nextIdx,
    nextRepeat: 0,
    patternId: steps[nextIdx].patternId,
    isFinished: false,
    direction: nextDir,
  };
}

/**
 * Convenience helper: returns the patternId of the *first* step (or null when
 * empty). Useful when activating a song.
 */
export function firstPatternId(song: Song): string | null {
  return song.steps[0]?.patternId ?? null;
}

/**
 * Generates the full pattern-id sequence for a finite "once"-mode song.
 *
 * Useful for tests and previews. Returns a list of patternIds; if the song
 * is in "loop" or "pingpong" mode, the result is capped at `maxLength`
 * (default 256) so iteration terminates.
 */
export function expandSong(song: Song, maxLength = 256): string[] {
  if (!Array.isArray(song.steps) || song.steps.length === 0) return [];

  const out: string[] = [];
  let idx = 0;
  let rep = 0;
  let dir: 1 | -1 = 1;

  // First play
  if (song.steps[0]) out.push(song.steps[0].patternId);

  while (out.length < maxLength) {
    const r = getNextStep(song, idx, rep, dir);
    if (r.isFinished || r.patternId === null) break;
    out.push(r.patternId);
    idx = r.nextStepIdx;
    rep = r.nextRepeat;
    dir = r.direction;
  }
  return out;
}
