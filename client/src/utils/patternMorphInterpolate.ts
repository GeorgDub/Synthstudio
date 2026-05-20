/**
 * Synthstudio patternMorphInterpolate.ts (v3.181.0)
 *
 * Pure-Helper fuer Pattern-Morph-Interpolation: smooth Blend zwischen
 * zwei boolean-Patterns A und B via Morph-Faktor t in [0, 1].
 *
 * - t = 0   -> A (komplett)
 * - t = 1   -> B (komplett)
 * - t = 0.5 -> ~50% Mix gemaess gewaehlter Strategy
 *
 * Strategies:
 *   "threshold"   : Hard-Switch bei t = 0.5 (t < 0.5 -> A; t >= 0.5 -> B)
 *   "probability" : pro Step: rng() < t -> b[i]; sonst a[i]
 *   "alternate"   : gerade Index -> a[i], ungerade -> b[i]; swap bei t > 0.5
 *   "additive"    : a[i] || (rng() < t && b[i]) — Union, modulated by t
 *
 * Patterns mit unterschiedlicher Laenge: Output-Length = max(a.length, b.length).
 * Fehlende Steps werden als false behandelt.
 *
 * Pure & deterministisch — gleicher seed -> gleiches Output.
 * Inline-PRNG (mulberry32) -> keine externen Dependencies, keine
 * Side-Effects auf Math.random.
 *
 * DOM-frei (Node-testbar).
 */

// Public Types

export type MorphStrategy =
  | "threshold"
  | "probability"
  | "alternate"
  | "additive";

export interface MorphOptions {
  /** Default "probability". */
  strategy?: MorphStrategy;
  /** PRNG-Seed fuer probability/additive mode. Default 1. */
  seed?: number;
}

/** UI-Labels fuer die vier Strategies. */
export const MORPH_STRATEGY_LABELS: Record<MorphStrategy, string> = {
  threshold: "Threshold (hard switch bei t=0.5)",
  probability: "Probability (per-step random)",
  alternate: "Alternate (gerade/ungerade)",
  additive: "Additive (A + B*t)",
};

// Internals

const VALID_STRATEGIES: ReadonlySet<MorphStrategy> = new Set<MorphStrategy>([
  "threshold",
  "probability",
  "alternate",
  "additive",
]);

/** Clamp t auf [0,1]; NaN/non-finite -> 0. */
function clampT(t: number): number {
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** Strategy mit Fallback "probability" bei invalid input. */
function resolveStrategy(strategy: MorphStrategy | undefined): MorphStrategy {
  if (strategy && VALID_STRATEGIES.has(strategy)) return strategy;
  return "probability";
}

/** Seed-sanitize: nicht-finit -> 1. */
function resolveSeed(seed: number | undefined): number {
  if (typeof seed !== "number" || !Number.isFinite(seed)) return 1;
  // Integer-Cast (Bit-OR mit 0).
  return Math.floor(seed) | 0;
}

/** mulberry32 PRNG — deterministisch, fast, gut genug fuer Pattern-Morph. */
function makeRng(seed: number): () => number {
  let s = resolveSeed(seed);
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Safe-read aus einem Pattern; out-of-range -> false. */
function readStep(pattern: readonly boolean[], i: number): boolean {
  return i < pattern.length ? Boolean(pattern[i]) : false;
}

// Public API

/**
 * Morph zwischen zwei boolean-Patterns. t = 0 -> A komplett, t = 1 -> B komplett.
 *
 * Output-Laenge = max(a.length, b.length); fehlende Steps gelten als false.
 * Beide leer -> [].
 *
 * Pure & deterministisch (gleicher seed -> gleiches Output).
 */
export function morphPatterns(
  a: readonly boolean[],
  b: readonly boolean[],
  t: number,
  options?: MorphOptions,
): boolean[] {
  const len = Math.max(a.length, b.length);
  if (len === 0) return [];

  const clamped = clampT(t);
  const strategy = resolveStrategy(options?.strategy);
  const seed = resolveSeed(options?.seed);

  // Edge cases: bei t=0 immer reines A (paddend), bei t=1 immer reines B.
  // (Auch fuer probability/additive — sonst wuerde alternate bei t=0 trotzdem
  // mischen, was unerwartet ist.)
  if (clamped === 0) {
    const out: boolean[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = readStep(a, i);
    return out;
  }
  if (clamped === 1) {
    const out: boolean[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = readStep(b, i);
    return out;
  }

  const out: boolean[] = new Array(len);

  if (strategy === "threshold") {
    const src = clamped < 0.5 ? a : b;
    for (let i = 0; i < len; i++) out[i] = readStep(src, i);
    return out;
  }

  if (strategy === "alternate") {
    const swap = clamped > 0.5;
    for (let i = 0; i < len; i++) {
      const evenSrc = swap ? b : a;
      const oddSrc = swap ? a : b;
      out[i] = (i % 2 === 0) ? readStep(evenSrc, i) : readStep(oddSrc, i);
    }
    return out;
  }

  // probability + additive — beide nutzen die Inline-PRNG.
  const rng = makeRng(seed);

  if (strategy === "additive") {
    for (let i = 0; i < len; i++) {
      const ai = readStep(a, i);
      const bi = readStep(b, i);
      const r = rng();
      out[i] = ai || (r < clamped && bi);
    }
    return out;
  }

  // Default-Pfad: "probability".
  for (let i = 0; i < len; i++) {
    const r = rng();
    out[i] = r < clamped ? readStep(b, i) : readStep(a, i);
  }
  return out;
}

/**
 * Multi-step Morph: liefert N Patterns auf dem Pfad von A nach B.
 *
 * steps=4 -> [morph(0), morph(1/3), morph(2/3), morph(1)] = [A, 33%, 66%, B]
 * steps=1 -> [morph(0)] = [A]
 * steps<=0 -> []
 */
export function morphPatternSequence(
  a: readonly boolean[],
  b: readonly boolean[],
  steps: number,
  options?: MorphOptions,
): boolean[][] {
  if (!Number.isFinite(steps) || steps <= 0) return [];
  const n = Math.floor(steps);
  if (n === 1) return [morphPatterns(a, b, 0, options)];

  const out: boolean[][] = new Array(n);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    out[k] = morphPatterns(a, b, t, options);
  }
  return out;
}
