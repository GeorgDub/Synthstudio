/**
 * Synthstudio patternEvolve.ts (v3.188.0)
 *
 * Pure-Helper fuer Pattern-Evolution via genetic-algorithm-aehnliche
 * Operationen (crossover + mutation). Foundation fuer kuenftige
 * "Evolve until interesting" Features.
 *
 * Konzept:
 *   - Initial population = [source, ...mutated-copies] (populationSize Eintraege)
 *   - Pro generation: build new population
 *       - Elite: prev[0] (deterministisch, kein Fitness-Score noetig)
 *       - Rest: rng-paare aus prev, optional crossover (rng < crossoverRate),
 *         dann mutate
 *   - Eine einzige PRNG durch alle Generationen (sonst kollabieren die Random-
 *     Choices auf identische Werte zwischen Generationen).
 *
 * Public API (siehe Types unten):
 *   - evolvePattern(source, options?) -> EvolveResult
 *   - crossover(a, b, rng) -> boolean[]   (per-index a oder b, rng < 0.5 -> a)
 *   - mutate(p, rate, rng) -> boolean[]   (per-step flip wenn rng < rate)
 *
 * Defensive Sanitizers (match patternFollowActionChain.ts / sampleNoiseGate.ts):
 *   - generations:    NaN/non-finite/<0 -> 4;    Math.floor
 *   - populationSize: NaN/non-finite/<1 -> 8;    Math.floor
 *   - mutationRate:   NaN/non-finite    -> 0.05; clamp [0,1]
 *   - crossoverRate:  NaN/non-finite    -> 0.7;  clamp [0,1]
 *   - seed:           NaN/non-finite    -> 1;    Math.floor | 0
 *
 * Edge-Cases:
 *   - source empty -> { generation: 0, population: [] } (kein Work geleistet)
 *   - populationSize=1 -> Pop bleibt 1-elementig; Crossover skipped wenn
 *     prev.length < 2 (statt fix einen 2-Parent-Pair zu fordern)
 *   - Crossover unterschiedliche Laengen -> Output-Length = max(a.length, b.length),
 *     fehlende Steps via readStep -> false (pad-with-false analog
 *     patternMorphInterpolate.ts)
 *
 * EvolveResult.generation = die effektiv durchlaufene generations-Zahl
 * (= sanitized options.generations).
 *
 * Pure & deterministisch. Gleicher seed + gleiche source + gleiche options
 * -> identisches Output (deep-equal). DOM-frei, Node-testbar.
 */

// Public Types

export interface EvolveOptions {
  /** Anzahl Generationen, default 4. NaN/<0 -> 4. */
  generations?: number;
  /** Population-Groesse pro Generation, default 8. NaN/<1 -> 8. */
  populationSize?: number;
  /** Mutation-Rate pro Step in [0,1], default 0.05. */
  mutationRate?: number;
  /** Crossover-Rate pro Parent-Pair in [0,1], default 0.7. */
  crossoverRate?: number;
  /** PRNG-Seed fuer Reproduzierbarkeit, default 1. */
  seed?: number;
}

export interface EvolveResult {
  /** Anzahl effektiv durchlaufener Generationen (sanitized). */
  generation: number;
  /** Finale Population. Erstes Element ist Elite (prev[0] der letzten Gen). */
  population: boolean[][];
}

// Defaults

const DEFAULT_GENERATIONS = 4;
const DEFAULT_POPULATION_SIZE = 8;
const DEFAULT_MUTATION_RATE = 0.05;
const DEFAULT_CROSSOVER_RATE = 0.7;
const DEFAULT_SEED = 1;

// Internals

/** mulberry32 PRNG — deterministisch, fast. Inline um externe Deps zu vermeiden. */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sanitizeGenerations(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return DEFAULT_GENERATIONS;
  return Math.floor(v);
}

function sanitizePopulationSize(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return DEFAULT_POPULATION_SIZE;
  return Math.floor(v);
}

function sanitizeRate01(v: number | undefined, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sanitizeSeed(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_SEED;
  return Math.floor(v) | 0;
}

/** Safe-read; out-of-range -> false. */
function readStep(pattern: readonly boolean[], i: number): boolean {
  return i < pattern.length ? Boolean(pattern[i]) : false;
}

// Public API — Genetic Operations

/**
 * Crossover zwischen zwei Patterns: pro index rng() < 0.5 -> a[i], sonst b[i].
 *
 * Output-Length = max(a.length, b.length); fehlende Steps via readStep -> false.
 * Inputs werden NIE mutiert (pure).
 */
export function crossover(
  a: readonly boolean[],
  b: readonly boolean[],
  rng: () => number,
): boolean[] {
  const len = Math.max(a.length, b.length);
  const out: boolean[] = new Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = rng() < 0.5 ? readStep(a, i) : readStep(b, i);
  }
  return out;
}

/**
 * Mutate: pro step rng() < rate -> flip. Rate wird intern NICHT sanitized
 * (Caller verantwortlich) — evolvePattern sanitized vor Aufruf.
 * Input wird NIE mutiert (pure).
 */
export function mutate(
  p: readonly boolean[],
  rate: number,
  rng: () => number,
): boolean[] {
  const out: boolean[] = new Array(p.length);
  for (let i = 0; i < p.length; i++) {
    out[i] = rng() < rate ? !p[i] : Boolean(p[i]);
  }
  return out;
}

// Public API — Main

/**
 * Fuehrt N Generationen Pattern-Evolution durch. Liefert finale Population.
 *
 * Initial-Population: [source, ...(populationSize-1) mutated copies].
 * Pro Generation:
 *   - Elite (prev[0]) wird ungeaendert uebernommen
 *   - Rest: pop[populationSize-1] Eintraege via rng-Parent-Paare + optional
 *     crossover (rng < crossoverRate; sonst Parent A direkt) + mutate
 *   - Wenn prev.length < 2: Crossover skipped, nur mutate(prev[0]) als parent
 *
 * Pure: source wird niemals mutiert. Gleicher seed -> deep-equal Output.
 */
export function evolvePattern(
  source: readonly boolean[],
  options?: EvolveOptions,
): EvolveResult {
  const generations = sanitizeGenerations(options?.generations);
  const populationSize = sanitizePopulationSize(options?.populationSize);
  const mutationRate = sanitizeRate01(options?.mutationRate, DEFAULT_MUTATION_RATE);
  const crossoverRate = sanitizeRate01(options?.crossoverRate, DEFAULT_CROSSOVER_RATE);
  const seed = sanitizeSeed(options?.seed);

  // Empty source -> kein Work, kein Population.
  if (source.length === 0) {
    return { generation: 0, population: [] };
  }

  // Single PRNG durch alle Generationen (sonst kollabieren Random-Choices
  // zwischen Generationen auf identische Werte).
  const rng = makeRng(seed);

  // Build initial population.
  const initialCopy: boolean[] = source.map((s) => Boolean(s));
  let pop: boolean[][] = [initialCopy];
  for (let i = 1; i < populationSize; i++) {
    pop.push(mutate(initialCopy, mutationRate, rng));
  }

  // Run generations.
  for (let g = 0; g < generations; g++) {
    const next: boolean[][] = [];
    // Elite: prev[0] unveraendert (deterministisch, keine Fitness-Funktion noetig).
    next.push(pop[0].slice());

    while (next.length < populationSize) {
      let child: boolean[];
      if (pop.length < 2) {
        // Fallback: nur ein Parent verfuegbar -> mutate ohne Crossover.
        child = mutate(pop[0], mutationRate, rng);
      } else {
        const aIdx = Math.floor(rng() * pop.length);
        const bIdx = Math.floor(rng() * pop.length);
        const parentA = pop[aIdx] ?? pop[0];
        const parentB = pop[bIdx] ?? pop[0];
        // Crossover wird per rng < crossoverRate getoggelt.
        // Bei "kein crossover" wird parentA direkt durchgereicht (kopiert).
        const crossed = rng() < crossoverRate
          ? crossover(parentA, parentB, rng)
          : parentA.slice();
        child = mutate(crossed, mutationRate, rng);
      }
      next.push(child);
    }

    pop = next;
  }

  return { generation: generations, population: pop };
}
