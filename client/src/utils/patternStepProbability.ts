/**
 * Synthstudio – patternStepProbability.ts (v3.174.0)
 *
 * Per-Step-Probability-Locks: pure Helpers, die ein Step-Array
 * (jeder Step hat active + optionale probability) deterministisch
 * zu boolean[]-Triggern auflösen. Inspiriert von Elektron Digitakt
 * "Trig Probability" / Ableton "Chance".
 *
 * Public Surface:
 *  - resolveStepProbabilities: roll-per-step → boolean[]
 *  - expectedDensity: expected-value für hits/total
 *  - generateRandomLocks: weist active Steps zufällig 1.0/0.75/0.5 zu
 *  - applyLockMode: Preset-basierte Probability-Verteilung
 *  - LOCK_PRESETS: read-only Liste verfügbarer Modes
 *
 * Determinismus via mulberry32 (inline, kein Cross-Util-Import um
 * zirkuläre Imports zu vermeiden). Nichts mutiert die Eingabe.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface StepWithProbability {
  /** Ist der Step im Pattern aktiv (true)? */
  active: boolean;
  /** Probability 0..1 (default 1 = always trigger when active). */
  probability?: number;
}

export interface ResolveOptions {
  /** PRNG-seed für determinismus. Default 1. */
  seed?: number;
}

export type LockMode = "all" | "downbeats" | "offbeats" | "fills";

export interface LockPreset {
  mode: LockMode;
  description: string;
}

// ─── PRNG: mulberry32 (inline) ────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = Number.isFinite(seed) ? Math.floor(seed) | 0 : 1;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Clamps probability into [0, 1]. NaN / non-finite → 0.
 * undefined → 1 (default behavior: always trigger when active).
 */
function sanitizeProbability(p: number | undefined): number {
  if (p === undefined) return 1;
  if (!Number.isFinite(p)) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p;
}

// ─── resolveStepProbabilities ─────────────────────────────────────────────────

/**
 * Resolved ein Step-Array mit Probability-Locks zu boolean[] (active OR not).
 *
 * Für jeden Step:
 *  - active=false → resolves to false (kein Trigger)
 *  - active=true + probability undefined / >= 1 → always true
 *  - active=true + probability <= 0 → false
 *  - active=true + 0 < probability < 1 → roll random; true wenn random < probability
 *
 * Deterministisch via Seed (mulberry32). Gleicher Seed + Inputs → gleicher Output.
 */
export function resolveStepProbabilities(
  steps: readonly StepWithProbability[],
  options?: ResolveOptions,
): boolean[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const seed = options?.seed ?? 1;
  const rng = makeRng(seed);
  const out: boolean[] = new Array(steps.length);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || !step.active) {
      // Roll trotzdem nicht — wir wollen, dass das RNG nur für aktive Steps
      // konsumiert wird? Nein: für Determinismus über Pattern-Edits hinweg
      // ist ein per-Index-Roll robuster. Aber für Spec ist aktive-Roll genauer.
      out[i] = false;
      continue;
    }
    const p = sanitizeProbability(step.probability);
    if (p >= 1) {
      out[i] = true;
    } else if (p <= 0) {
      out[i] = false;
    } else {
      const r = rng();
      out[i] = r < p;
    }
  }
  return out;
}

// ─── expectedDensity ──────────────────────────────────────────────────────────

/**
 * Berechnet die "expected hits" eines Step-Arrays über N Iterationen.
 * Returns expected-value für density (hits/total) basierend auf probabilities.
 *
 * - empty → 0
 * - inactive steps tragen 0 bei
 * - active steps tragen ihre clamped probability bei (default 1)
 * - Result = Σ(p_i) / length
 */
export function expectedDensity(
  steps: readonly StepWithProbability[],
): number {
  if (!Array.isArray(steps) || steps.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || !step.active) continue;
    sum += sanitizeProbability(step.probability);
  }
  return sum / steps.length;
}

// ─── generateRandomLocks ──────────────────────────────────────────────────────

/**
 * Liefert eine zufällige Probability-Verteilung für ein Pattern.
 * Pro active Step: 50% chance auf 1.0 (lock), 30% chance auf 0.75, 20% chance auf 0.5.
 * Inactive Steps bleiben unverändert (ohne probability).
 *
 * Deterministisch via Seed.
 */
export function generateRandomLocks(
  steps: readonly StepWithProbability[],
  options?: ResolveOptions,
): StepWithProbability[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const seed = options?.seed ?? 1;
  const rng = makeRng(seed);
  const out: StepWithProbability[] = new Array(steps.length);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || !step.active) {
      // Inactive Steps werden 1:1 kopiert, ohne probability zu setzen.
      out[i] = { active: false };
      continue;
    }
    const r = rng();
    let p: number;
    if (r < 0.5) p = 1.0;
    else if (r < 0.8) p = 0.75;
    else p = 0.5;
    out[i] = { active: true, probability: p };
  }
  return out;
}

// ─── LOCK_PRESETS ─────────────────────────────────────────────────────────────

export const LOCK_PRESETS: readonly LockPreset[] = Object.freeze([
  { mode: "all",       description: "Globale Probability 75% auf alle Hits" },
  { mode: "downbeats", description: "Downbeats locked, Off-Hits chance" },
  { mode: "offbeats",  description: "Off-Hits mit 70% chance" },
  { mode: "fills",     description: "Last quarter sparse fill" },
]);

// ─── applyLockMode ────────────────────────────────────────────────────────────

/**
 * Apply Lock-Mode auf ein Pattern: setzt probability je nach Mode.
 *  - "all":       alle active Steps bekommen 0.75
 *  - "downbeats": Steps an Indizes 0, 4, 8, 12 bekommen 1.0; rest 0.5
 *  - "offbeats":  ungerade Indizes (1, 3, 5, ...) bekommen 0.7; gerade 1.0
 *  - "fills":     last quarter (Index >= 12) bekommt 0.6; rest 1.0
 *
 * Inactive Steps bleiben unverändert (ohne probability).
 */
export function applyLockMode(
  steps: readonly StepWithProbability[],
  mode: LockMode,
): StepWithProbability[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const out: StepWithProbability[] = new Array(steps.length);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || !step.active) {
      out[i] = { active: false };
      continue;
    }
    let p = 1.0;
    switch (mode) {
      case "all": {
        p = 0.75;
        break;
      }
      case "downbeats": {
        const isDown = i === 0 || i === 4 || i === 8 || i === 12;
        p = isDown ? 1.0 : 0.5;
        break;
      }
      case "offbeats": {
        const isOdd = (i & 1) === 1;
        p = isOdd ? 0.7 : 1.0;
        break;
      }
      case "fills": {
        p = i >= 12 ? 0.6 : 1.0;
        break;
      }
      default: {
        p = 1.0;
      }
    }
    out[i] = { active: true, probability: p };
  }
  return out;
}
