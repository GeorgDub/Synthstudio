/**
 * client/src/utils/patternEmphasis.ts (v3.196)
 *
 * Pure-Helper: Pattern-Emphasis (Velocity-Akzentuierung per Step).
 *
 * Generiert Velocity-Werte fuer ACTIVE Steps basierend auf der metrischen
 * Hierarchie eines Patterns. Downbeats sind am lautesten, Sub-Divisions am
 * leisesten — ausser bei den Speziell-Presets "robotic" (alles maximal),
 * "ghost-heavy" (sub = ghost-Notes ~25) und "loose" (zufaellig ±20 um base).
 *
 * Pure: keine Store-Zugriffe, keine Mutation. Eingaben werden nur gelesen.
 *
 * Metric-Hierarchie (per Step i, barLength = stepsPerBeat * beatsPerBar):
 *   - i % barLength === 0            → downbeat (strongest)
 *   - i % stepsPerBeat === 0         → beat
 *   - halfBeat > 0 && i % halfBeat === 0 → off-beat ("&")
 *   - sonst                          → sub-division ("e"/"a")
 *
 * Preset-Verhalten (per Position [down, beat, off, sub]):
 *   - "natural": [base, base-15, base-30, base-50]   skaliert mit base
 *   - "linear":  [base, base, base, base]             skaliert mit base
 *   - "ghost-heavy": [base, base-10, base-50, 25]    sub ist ABSOLUT (Ghost-Note)
 *   - "robotic": [127, 127, 127, 127]                ABSOLUT, ignoriert base
 *   - "loose":   base + uniform(-20, +20)            per Step zufaellig
 *
 * Alle berechneten Velocities werden auf [1, 127] geklammert — active steps
 * sind nie stumm.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export type EmphasisPreset =
  | "natural"
  | "linear"
  | "ghost-heavy"
  | "robotic"
  | "loose";

export interface EmphasisOptions {
  /** Akzent-Preset. Default "natural". Ungueltige Werte → "natural". */
  preset?: EmphasisPreset;
  /** Steps pro Beat. Default 4 (1/16-Pattern). Ungueltige Werte → 4. */
  stepsPerBeat?: number;
  /** Beats pro Bar. Default 4 (4/4-Time). Ungueltige Werte → 4. */
  beatsPerBar?: number;
  /** Base-Velocity (downbeat-Ankerpunkt). Default 110. */
  baseVelocity?: number;
}

export interface EmphasizedStep {
  stepIndex: number;
  velocity: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_STEPS_PER_BEAT = 4;
const DEFAULT_BEATS_PER_BAR = 4;
const DEFAULT_BASE_VELOCITY = 110;
const LOOSE_RANGE = 20;
const MIN_VELOCITY = 1;
const MAX_VELOCITY = 127;
const GHOST_VELOCITY = 25;

const VALID_PRESETS: ReadonlySet<EmphasisPreset> = new Set<EmphasisPreset>([
  "natural",
  "linear",
  "ghost-heavy",
  "robotic",
  "loose",
]);

// ─── Public Labels (fuer UI) ─────────────────────────────────────────────────

export const EMPHASIS_PRESET_LABELS: Record<EmphasisPreset, string> = {
  natural: "Natural",
  linear: "Linear",
  "ghost-heavy": "Ghost-Heavy",
  robotic: "Robotic",
  loose: "Loose",
};

// ─── Defensive Defaults ──────────────────────────────────────────────────────

function resolvePreset(raw: EmphasisPreset | undefined): EmphasisPreset {
  if (raw && VALID_PRESETS.has(raw)) return raw;
  return "natural";
}

function resolveStepsPerBeat(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_STEPS_PER_BEAT;
  }
  return Math.floor(raw);
}

function resolveBeatsPerBar(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_BEATS_PER_BAR;
  }
  return Math.floor(raw);
}

function resolveBaseVelocity(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_BASE_VELOCITY;
  }
  return raw;
}

function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return MIN_VELOCITY;
  if (v < MIN_VELOCITY) return MIN_VELOCITY;
  if (v > MAX_VELOCITY) return MAX_VELOCITY;
  return Math.round(v);
}

// ─── Position-Klassifikation ─────────────────────────────────────────────────

type Position = "down" | "beat" | "off" | "sub";

function classifyPosition(
  stepIdx: number,
  stepsPerBeat: number,
  barLength: number,
): Position {
  if (stepIdx % barLength === 0) return "down";
  if (stepIdx % stepsPerBeat === 0) return "beat";
  const halfBeat = Math.floor(stepsPerBeat / 2);
  if (halfBeat > 0 && stepIdx % halfBeat === 0) return "off";
  return "sub";
}

// ─── Velocity-Berechnung pro Preset ──────────────────────────────────────────

function velocityForPosition(
  preset: EmphasisPreset,
  position: Position,
  base: number,
): number {
  switch (preset) {
    case "natural":
      if (position === "down") return base;
      if (position === "beat") return base - 15;
      if (position === "off") return base - 30;
      return base - 50;

    case "linear":
      return base;

    case "ghost-heavy":
      if (position === "down") return base;
      if (position === "beat") return base - 10;
      if (position === "off") return base - 50;
      return GHOST_VELOCITY;

    case "robotic":
      return MAX_VELOCITY;

    case "loose": {
      // Uniform random in [base - LOOSE_RANGE, base + LOOSE_RANGE].
      const jitter = (Math.random() * 2 - 1) * LOOSE_RANGE;
      return base + jitter;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Berechne Velocity-Akzent pro ACTIVE Step.
 *
 * Empty oder all-false Pattern → [].
 * Result enthaelt einen Eintrag pro active step in Pattern-Reihenfolge.
 *
 * Verhalten kompakt:
 *   - "natural":     [base, base-15, base-30, base-50] (clamped 1..127)
 *   - "linear":      base (clamped) auf allen Positionen
 *   - "ghost-heavy": [base, base-10, base-50, 25]
 *   - "robotic":     127 ueberall
 *   - "loose":       base + Math.random()*40-20 pro Step
 *
 * Ungueltige Optionen werden defensiv auf Defaults gemappt (preset →
 * "natural", stepsPerBeat/beatsPerBar → 4, baseVelocity → 110).
 */
export function generateEmphasis(
  pattern: readonly boolean[],
  options?: EmphasisOptions,
): EmphasizedStep[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const preset = resolvePreset(options?.preset);
  const stepsPerBeat = resolveStepsPerBeat(options?.stepsPerBeat);
  const beatsPerBar = resolveBeatsPerBar(options?.beatsPerBar);
  const baseVelocity = resolveBaseVelocity(options?.baseVelocity);
  const barLength = stepsPerBeat * beatsPerBar;

  const result: EmphasizedStep[] = [];

  for (let i = 0; i < pattern.length; i++) {
    if (!pattern[i]) continue;

    const position = classifyPosition(i, stepsPerBeat, barLength);
    const raw = velocityForPosition(preset, position, baseVelocity);
    result.push({ stepIndex: i, velocity: clampVelocity(raw) });
  }

  return result;
}

/**
 * Wendet ein Emphasis-Ergebnis auf eine Velocity-Spur an (v3.241).
 *
 * Liefert ein vollständiges Velocity-Array der Länge `stepCount`:
 *  - Steps, die in `emphasized` vorkommen (= aktive Steps), erhalten die
 *    akzentuierte Velocity (geclamped 1..127).
 *  - Alle anderen Steps behalten ihre aktuelle Velocity (Fallback 100).
 *
 * Pure & Node-testbar — die UI reicht das Ergebnis an setPartSteps weiter,
 * sodass Pitch/Probability/etc. der Steps unberührt bleiben.
 */
export function applyEmphasisVelocities(
  stepCount: number,
  emphasized: readonly EmphasizedStep[],
  currentVelocities: readonly number[],
): number[] {
  const count = Number.isFinite(stepCount) && stepCount > 0 ? Math.floor(stepCount) : 0;
  const byStep = new Map<number, number>();
  for (const e of emphasized) byStep.set(e.stepIndex, clampVelocity(e.velocity));

  const out: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const emph = byStep.get(i);
    if (emph !== undefined) {
      out[i] = emph;
    } else {
      const cur = currentVelocities[i];
      out[i] = Number.isFinite(cur) ? clampVelocity(cur) : 100;
    }
  }
  return out;
}
