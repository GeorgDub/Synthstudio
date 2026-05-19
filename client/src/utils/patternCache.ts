/**
 * patternCache.ts — Sprint-104 Step-Sequencer Pattern-Persistence.
 *
 * Speichert Pattern-State (steps + velocities + bpm + root) in
 * localStorage damit der User nach Browser-Reload nicht alles
 * neu eingeben muss.
 *
 * Schema: v1, key "synthstudio:omnitribe.pattern.v1".
 */

const CACHE_KEY = "synthstudio:omnitribe.pattern.v1";

export interface PatternState {
  steps: boolean[];          // 16 entries
  velocities: number[];      // 16 entries, 0..127
  /** Sprint-105: Per-Step Pitch-Offset in Halbtoenen, signed (-24..+24 ueblich). */
  pitchOffsets: number[];    // 16 entries
  bpm: number;               // 40..240
  root: number;              // 0..127
}

export function getDefaultPattern(): PatternState {
  return {
    steps: Array(16).fill(false),
    velocities: Array(16).fill(100),
    pitchOffsets: Array(16).fill(0),
    bpm: 120,
    root: 60,
  };
}

export function loadPatternCache(): PatternState {
  if (typeof window === "undefined" || !window.localStorage) {
    return getDefaultPattern();
  }
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return getDefaultPattern();
    const parsed = JSON.parse(raw) as Partial<PatternState>;
    const def = getDefaultPattern();
    return {
      steps: Array.isArray(parsed.steps) && parsed.steps.length === 16
        ? parsed.steps.map((s) => Boolean(s))
        : def.steps,
      velocities: Array.isArray(parsed.velocities) && parsed.velocities.length === 16
        ? parsed.velocities.map((v) =>
            Math.max(0, Math.min(127, Number(v) || 0)))
        : def.velocities,
      pitchOffsets: Array.isArray(parsed.pitchOffsets) && parsed.pitchOffsets.length === 16
        ? parsed.pitchOffsets.map((p) =>
            Math.max(-64, Math.min(63, Number(p) || 0)))
        : def.pitchOffsets,
      bpm: typeof parsed.bpm === "number"
        ? Math.max(40, Math.min(240, parsed.bpm))
        : def.bpm,
      root: typeof parsed.root === "number"
        ? Math.max(0, Math.min(127, parsed.root))
        : def.root,
    };
  } catch {
    return getDefaultPattern();
  }
}

export function savePatternCache(state: PatternState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch { /* swallow quota errors */ }
}

export function clearPatternCache(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch { /* */ }
}
