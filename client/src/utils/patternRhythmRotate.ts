/**
 * client/src/utils/patternRhythmRotate.ts (v3.192)
 *
 * Pure-Helpers für Pattern-Rotation in musikalischen Einheiten (Beats),
 * statt in rohen Steps. Foundation für künftige "Shift by 1 Beat"-Action,
 * Pattern-Tools, Script-Commands und MIDI-Bindings.
 *
 * Alle Funktionen sind seiteneffekt-frei, geben NEUE Arrays zurück und
 * lassen den Input unverändert. Kein Store-Zugriff.
 *
 * Konzept:
 *   Ein 16-Step-Pattern mit stepsPerBeat=4 hat 4 Beats à 4 Steps.
 *   rotatePatternByBeats(p, {beats: 1}) shiftet das gesamte Pattern um
 *   einen ganzen Beat (= 4 Steps) nach rechts.
 *   rotateWithinBeats(p, {beats: 1}) rotiert nur INNERHALB jeder Beat-
 *   Group, lässt die Beat-Reihenfolge selbst aber unangetastet.
 */

export interface RhythmRotateOptions {
  /** Steps pro Beat. Default 4 (klassisches 1/16-Pattern). */
  stepsPerBeat?: number;
  /** Wie viele Beats rotieren. Default 1. Kann negativ sein. */
  beats?: number;
}

// ─── Defensive Defaults ──────────────────────────────────────────────────────

function resolveStepsPerBeat(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 4;
  return Math.floor(raw);
}

function resolveBeats(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.trunc(raw);
}

// ─── rotatePatternByBeats ────────────────────────────────────────────────────

/**
 * Rotiert das gesamte Pattern um (beats * stepsPerBeat) Steps nach rechts.
 * Äquivalent zu shiftPattern(p, beats*stepsPerBeat), wraps modulo length.
 *
 * beats > 0 → Rechts-Rotation (letzte Beats wandern nach vorn).
 * beats < 0 → Links-Rotation.
 * Empty → [].
 */
export function rotatePatternByBeats(
  pattern: readonly boolean[],
  options: RhythmRotateOptions = {},
): boolean[] {
  const n = pattern.length;
  if (n === 0) return [];

  const stepsPerBeat = resolveStepsPerBeat(options.stepsPerBeat);
  const beats = resolveBeats(options.beats);

  const rawShift = beats * stepsPerBeat;
  // Normalize: positive modulo (JS % kann negativ bleiben).
  const offset = ((rawShift % n) + n) % n;

  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = (i - offset + n) % n;
    out[i] = pattern[src];
  }
  return out;
}

// ─── rotateWithinBeats ───────────────────────────────────────────────────────

/**
 * Rotiert nur INNERHALB jeder Beat-Group. Die Group-Reihenfolge selbst
 * bleibt unangetastet.
 *
 * Beispiel mit stepsPerBeat=4, beats=1:
 *   [a,b,c,d, e,f,g,h, i,j,k,l, m,n,o,p]
 *   → [d,a,b,c, h,e,f,g, l,i,j,k, p,m,n,o]
 *
 * Jede 4er-Group wird per shiftPattern-Logik um 1 nach rechts rotiert.
 *
 * Trailing-Group: falls length kein Vielfaches von stepsPerBeat ist, wird
 * die letzte (unvollständige) Group ebenfalls modulo ihrer eigenen Länge
 * rotiert.
 *
 * Empty → [].
 */
export function rotateWithinBeats(
  pattern: readonly boolean[],
  options: RhythmRotateOptions = {},
): boolean[] {
  const n = pattern.length;
  if (n === 0) return [];

  const stepsPerBeat = resolveStepsPerBeat(options.stepsPerBeat);
  const beats = resolveBeats(options.beats);

  const out: boolean[] = new Array(n);
  for (let groupStart = 0; groupStart < n; groupStart += stepsPerBeat) {
    const groupEnd = Math.min(groupStart + stepsPerBeat, n);
    const groupLen = groupEnd - groupStart;
    if (groupLen <= 0) continue;

    // Pro-Group-Shift: beats wird als raw step-shift innerhalb der Group
    // interpretiert (1 beat → 1 step innerhalb der Group, weil "1 Beat
    // weitershift im Group-Rhythmus").
    const offset = ((beats % groupLen) + groupLen) % groupLen;
    for (let i = 0; i < groupLen; i++) {
      const src = (i - offset + groupLen) % groupLen;
      out[groupStart + i] = pattern[groupStart + src];
    }
  }
  return out;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export const ROTATE_PRESETS: readonly {
  id: string;
  name: string;
  stepsPerBeat: number;
  beats: number;
}[] = [
  { id: "one-beat-fwd", name: "+1 Beat", stepsPerBeat: 4, beats: 1 },
  { id: "one-beat-bwd", name: "-1 Beat", stepsPerBeat: 4, beats: -1 },
  { id: "half-bar", name: "+½ Bar", stepsPerBeat: 4, beats: 2 },
  { id: "within-beat", name: "Within-Beat Shift", stepsPerBeat: 4, beats: 1 },
] as const;
