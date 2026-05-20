/**
 * client/src/utils/patternBranchVariations.ts (v3.182)
 *
 * Pure-Helper: Branch-Variations — generiert N deterministisch unterschiedliche
 * Variationen eines Source-Patterns (boolean[]).
 *
 * Jede Variation nutzt einen unterschiedlichen Seed (baseSeed + index * 7) und
 * wendet eine intensity-abhängige Auswahl von Operationen sequenziell an.
 *
 * Operations-Pool (intensity-gated):
 *   • shift       (immer aktiv, intensity > 0.0) — rotate by 1 step
 *   • decay       (intensity > 0.2) — drop active steps with prob 1-(1-i*0.3)
 *   • densify     (intensity > 0.4) — turn inactive → active with prob i*0.15
 *   • swap-pairs  (intensity > 0.6) — alternate even/odd swap
 *   • mirror      (intensity > 0.8) — reverse pattern
 *
 * Determinismus: mulberry32-PRNG; gleicher baseSeed + Input → identisch.
 * Alle Funktionen liefern NEUE Arrays; Input bleibt unverändert.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface BranchOptions {
  /** Anzahl Variationen. Default 4. Clamp 1..16. */
  count?: number;
  /** Base-Seed (variations nutzen baseSeed + index * 7). Default Date.now(). */
  baseSeed?: number;
  /** Variation-Intensity 0..1. 0 = minimal change, 1 = chaotic. Default 0.3. */
  intensity?: number;
}

export interface BranchVariation {
  /** Variation-Index 0..count-1. */
  index: number;
  /** Pattern (boolean[]). */
  pattern: boolean[];
  /** Operations die angewandt wurden (für Debug/Display). */
  operations: string[];
  /** Effective seed. */
  seed: number;
}

export const BRANCH_OPERATION_LABELS: Record<string, string> = {
  "shift":       "Shift",
  "decay":       "Decay",
  "densify":     "Densify",
  "swap-pairs":  "Swap Pairs",
  "mirror":      "Mirror",
};

// ─── Internal: mulberry32 PRNG ────────────────────────────────────────────────

function makeRng(seedInput: number): () => number {
  let s = seedInput | 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Internal: sanitize helpers ───────────────────────────────────────────────

function sanitizeIntensity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.3;
  if (value < 0) return 0.3;
  if (value > 1) return 0.3;
  return value;
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 4;
  const n = Math.floor(value);
  if (n <= 0) return 0;
  if (n > 16) return 16;
  return n;
}

function sanitizeSeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Date.now();
  return Math.floor(value);
}

// ─── Internal: Operations (pure) ──────────────────────────────────────────────

/** Rotate pattern by n steps (positive = right). */
function shift(p: readonly boolean[], n: number): boolean[] {
  const len = p.length;
  if (len === 0) return [];
  const k = ((n % len) + len) % len;
  const out: boolean[] = new Array(len);
  for (let i = 0; i < len; i++) {
    out[(i + k) % len] = p[i];
  }
  return out;
}

/** Decay: each true-step → false with probability (1 - keep). */
function decay(p: readonly boolean[], keep: number, rng: () => number): boolean[] {
  const out: boolean[] = p.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i] && rng() >= keep) {
      out[i] = false;
    }
  }
  return out;
}

/** Densify: each false-step → true with probability `add`. */
function densify(p: readonly boolean[], add: number, rng: () => number): boolean[] {
  const out: boolean[] = p.slice();
  for (let i = 0; i < out.length; i++) {
    if (!out[i] && rng() < add) {
      out[i] = true;
    }
  }
  return out;
}

/** Swap-pairs: alternate even/odd swap (indices 0↔1, 2↔3, …). */
function swapPairs(p: readonly boolean[]): boolean[] {
  const out: boolean[] = p.slice();
  for (let i = 0; i + 1 < out.length; i += 2) {
    const tmp = out[i];
    out[i] = out[i + 1];
    out[i + 1] = tmp;
  }
  return out;
}

/** Mirror: reverse pattern (preserves length). */
function mirror(p: readonly boolean[]): boolean[] {
  const out: boolean[] = new Array(p.length);
  for (let i = 0; i < p.length; i++) {
    out[i] = p[p.length - 1 - i];
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generiert N deterministisch unterschiedliche Variationen eines Source-Patterns.
 *
 * Jede Variation wendet eine intensity-abhängige Operations-Kette an:
 *   intensity > 0.0 → shift
 *   intensity > 0.2 → decay   (keep = 1 - intensity * 0.3)
 *   intensity > 0.4 → densify (add  = intensity * 0.15)
 *   intensity > 0.6 → swap-pairs
 *   intensity > 0.8 → mirror
 *
 * Seed pro Variation: baseSeed + index * 7.
 * Operations werden sequenziell in obiger Reihenfolge angewandt.
 */
export function generateBranchVariations(
  source: readonly boolean[],
  options: BranchOptions = {},
): BranchVariation[] {
  const safeSource: boolean[] = Array.isArray(source) ? source.slice() : [];
  const count = sanitizeCount(options.count);
  if (count === 0) return [];

  const baseSeed = sanitizeSeed(options.baseSeed);
  const intensity = sanitizeIntensity(options.intensity);

  const variations: BranchVariation[] = [];
  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i * 7;
    const rng = makeRng(seed);
    const ops: string[] = [];

    let pattern: boolean[] = safeSource.slice();

    // Operation: shift (immer aktiv — minimale Operation auch bei intensity=0)
    if (intensity >= 0.0) {
      pattern = shift(pattern, 1);
      ops.push("shift");
    }

    // Operation: decay
    if (intensity > 0.2) {
      const keep = 1 - intensity * 0.3;
      pattern = decay(pattern, keep, rng);
      ops.push("decay");
    }

    // Operation: densify
    if (intensity > 0.4) {
      const add = intensity * 0.15;
      pattern = densify(pattern, add, rng);
      ops.push("densify");
    }

    // Operation: swap-pairs
    if (intensity > 0.6) {
      pattern = swapPairs(pattern);
      ops.push("swap-pairs");
    }

    // Operation: mirror
    if (intensity > 0.8) {
      pattern = mirror(pattern);
      ops.push("mirror");
    }

    variations.push({
      index: i,
      pattern,
      operations: ops,
      seed,
    });
  }

  return variations;
}
