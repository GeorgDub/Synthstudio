/**
 * client/src/utils/patternMutateRandom.ts (v3.197)
 *
 * Pure-Helper: Random-Mutation-Chain. Wendet eine zufaellige Sequenz aus
 * Mutation-Operationen auf ein boolean-Pattern an. Wahl-Anzahl und Wahl-Art
 * der Ops sind durch `intensity` + `seed` deterministisch gesteuert.
 *
 * Konzept:
 *   - Eine einzige mulberry32-PRNG steuert sowohl die Op-Wahl als auch die
 *     RNG-basierten Ops (decay, densify) — andere Ops sind deterministisch.
 *   - N (Anzahl Ops) = max(1, min(maxOps, ceil(intensity * maxOps))).
 *     intensity=0 -> 1 op, intensity=1 -> maxOps ops.
 *   - Ops werden sequenziell appliziert (Output von Op_n -> Input von Op_n+1).
 *   - Inputs werden NIE mutiert; alle Funktionen liefern neue Arrays.
 *
 * Op-Pool (deckt sich namentlich mit patternBranchVariations.ts):
 *   "shift"      — rotate by 1 step (rechts)
 *   "decay"      — drop active steps mit Rate (1 - keep). Inline, shared rng.
 *   "densify"    — turn inactive -> active mit Rate add.  Inline, shared rng.
 *   "reverse"    — kompletter Reverse.
 *   "invert"     — flip jeden Step.
 *   "swap-pairs" — Even/Odd-Swap (Index 0<->1, 2<->3, ...).
 *
 * Defensive Sanitizers (match patternEvolve.ts / patternBranchVariations.ts):
 *   - intensity: NaN/non-finite -> 0.5; clamp [0,1]
 *   - maxOps:    NaN/non-finite/<1 -> 3; Math.floor
 *   - seed:      NaN/non-finite -> 1;   Math.floor | 0
 *
 * Edge-Cases:
 *   - empty source -> { pattern: [], operationsApplied: [] }
 *   - intensity=0 -> mindestens 1 op (kleinste sinnvolle Mutation)
 *   - intensity>=1 -> maxOps ops (Cap)
 *
 * Pure & deterministisch: gleicher seed + gleiche source + gleiche options
 * -> deep-equal Output.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export type MutationOp =
  | "shift"
  | "decay"
  | "densify"
  | "reverse"
  | "invert"
  | "swap-pairs";

export interface RandomMutateOptions {
  /** 0..1, more intensity = more ops applied. Default 0.5. */
  intensity?: number;
  /** Max ops chained. Default 3. */
  maxOps?: number;
  /** PRNG-Seed fuer Reproduzierbarkeit. Default 1. */
  seed?: number;
}

export interface MutationResult {
  pattern: boolean[];
  operationsApplied: MutationOp[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_INTENSITY = 0.5;
const DEFAULT_MAX_OPS = 3;
const DEFAULT_SEED = 1;

/** Fixed Decay/Densify-Raten — predictable, nicht intensity-skaliert. */
const DECAY_KEEP = 0.7;
const DENSIFY_ADD = 0.2;

const OP_POOL: readonly MutationOp[] = [
  "shift",
  "decay",
  "densify",
  "reverse",
  "invert",
  "swap-pairs",
];

// ─── Internals: mulberry32 PRNG ───────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Internals: Sanitize ──────────────────────────────────────────────────────

function sanitizeIntensity(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_INTENSITY;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sanitizeMaxOps(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return DEFAULT_MAX_OPS;
  return Math.floor(v);
}

function sanitizeSeed(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_SEED;
  return Math.floor(v) | 0;
}

// ─── Internals: Op-Implementations (inline, shared rng) ───────────────────────

/** Rotate pattern by 1 step (right). Fixed shift fuer Determinismus. */
function opShift(p: readonly boolean[]): boolean[] {
  const n = p.length;
  if (n === 0) return [];
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[(i + 1) % n] = p[i];
  }
  return out;
}

/** Decay: jeder true-Step -> false mit Wahrscheinlichkeit (1 - DECAY_KEEP). */
function opDecay(p: readonly boolean[], rng: () => number): boolean[] {
  const out: boolean[] = new Array(p.length);
  for (let i = 0; i < p.length; i++) {
    if (p[i]) {
      out[i] = rng() < DECAY_KEEP;
    } else {
      out[i] = false;
    }
  }
  return out;
}

/** Densify: jeder false-Step -> true mit Wahrscheinlichkeit DENSIFY_ADD. */
function opDensify(p: readonly boolean[], rng: () => number): boolean[] {
  const out: boolean[] = new Array(p.length);
  for (let i = 0; i < p.length; i++) {
    if (p[i]) {
      out[i] = true;
    } else {
      out[i] = rng() < DENSIFY_ADD;
    }
  }
  return out;
}

/** Reverse: kompletter Pattern-Reverse. */
function opReverse(p: readonly boolean[]): boolean[] {
  const n = p.length;
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = p[n - 1 - i];
  }
  return out;
}

/** Invert: jeder Step true <-> false. */
function opInvert(p: readonly boolean[]): boolean[] {
  const out: boolean[] = new Array(p.length);
  for (let i = 0; i < p.length; i++) {
    out[i] = !p[i];
  }
  return out;
}

/** Swap-pairs: 0<->1, 2<->3, ... letzter odd-Step bleibt unveraendert. */
function opSwapPairs(p: readonly boolean[]): boolean[] {
  const out: boolean[] = p.slice();
  for (let i = 0; i + 1 < out.length; i += 2) {
    const tmp = out[i];
    out[i] = out[i + 1];
    out[i + 1] = tmp;
  }
  return out;
}

/** Dispatch: wendet eine einzelne Op auf p an. */
function applyOp(op: MutationOp, p: readonly boolean[], rng: () => number): boolean[] {
  switch (op) {
    case "shift":      return opShift(p);
    case "decay":      return opDecay(p, rng);
    case "densify":    return opDensify(p, rng);
    case "reverse":    return opReverse(p);
    case "invert":     return opInvert(p);
    case "swap-pairs": return opSwapPairs(p);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wendet eine zufaellige Sequenz aus N Mutation-Operationen auf `source` an.
 *
 *   N = max(1, min(maxOps, ceil(intensity * maxOps)))
 *
 * intensity=0 -> 1 op, intensity=1 -> maxOps ops.
 *
 * Op-Wahl + RNG-basierte Op-Internas teilen dieselbe mulberry32-PRNG (seed).
 * Source wird niemals mutiert. Empty source -> empty result.
 */
export function randomMutate(
  source: readonly boolean[],
  options?: RandomMutateOptions,
): MutationResult {
  // Empty source -> no-op (vor Sanitizer-Kosten).
  if (source.length === 0) {
    return { pattern: [], operationsApplied: [] };
  }

  const intensity = sanitizeIntensity(options?.intensity);
  const maxOps = sanitizeMaxOps(options?.maxOps);
  const seed = sanitizeSeed(options?.seed);

  // N-from-intensity: floor of intensity*maxOps, mind. 1, hoechstens maxOps.
  // intensity=0 -> max(1, ceil(0)) = 1
  // intensity=1 -> ceil(maxOps) = maxOps
  const opsCount = Math.max(1, Math.min(maxOps, Math.ceil(intensity * maxOps)));

  const rng = makeRng(seed);

  let pattern: boolean[] = source.map((s) => Boolean(s));
  const operationsApplied: MutationOp[] = [];

  for (let i = 0; i < opsCount; i++) {
    const opIdx = Math.floor(rng() * OP_POOL.length);
    // Defensive (sollte nie ausserhalb sein, aber rng() < 1.0 garantieren wir nicht
    // mathematisch absolut — clamp gegen rng() == 1.0).
    const safeIdx = Math.min(OP_POOL.length - 1, Math.max(0, opIdx));
    const op = OP_POOL[safeIdx];
    pattern = applyOp(op, pattern, rng);
    operationsApplied.push(op);
  }

  return { pattern, operationsApplied };
}
