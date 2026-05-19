/**
 * Synthstudio – patternProbability.ts (v3.166.0)
 *
 * Probabilistic Pattern Generation — pure, testbare Helpers, die Patterns
 * (boolean[]) mit deterministischen, gesetzten PRNG-Operationen erzeugen
 * oder modifizieren. Nichts mutiert die Eingabe, alle Funktionen liefern
 * neue Arrays.
 *
 * Operationen:
 *  - generateRandomPattern: erzeugt frisches Pattern mit p-Wahrscheinlichkeit
 *  - decayPattern: entfernt mit (1-keep)-Wahrscheinlichkeit existierende Hits
 *  - densifyPattern: fügt mit add-Wahrscheinlichkeit neue Hits in Lücken ein
 *  - variatePattern: decay → densify in einem Aufruf (geteilter Seed-State)
 *  - createSeededRng: mulberry32 PRNG-Factory (Closure-State)
 *
 * Determinismus: gleicher Seed + gleiche Inputs → identisches Output.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ProbabilityOptions {
  /** PRNG-seed für Determinismus. Default 1. */
  seed?: number;
}

// ─── PRNG: mulberry32 ─────────────────────────────────────────────────────────

/**
 * Liefert ein deterministisches PRNG (mulberry32) für externe Verwendung.
 * Nützlich wenn man mehrere Operationen mit demselben Seed-State chainen will.
 *
 * @param seed - Integer-Seed; nicht-finite Werte → Default 1.
 * @returns Funktion () → number in [0, 1).
 */
export function createSeededRng(seed: number): () => number {
  let s = Number.isFinite(seed) ? Math.floor(seed) | 0 : 1;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeProbability(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p;
}

function resolveSeed(options?: ProbabilityOptions): number {
  const raw = options?.seed;
  if (raw === undefined || !Number.isFinite(raw)) return 1;
  return raw;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generiert ein Pattern mit `length` steps, jeder mit `probability`
 * Chance auf true.
 *
 * Beispiel: generateRandomPattern(16, 0.25) → ~4 true-Steps im Mittel.
 */
export function generateRandomPattern(
  length: number,
  probability: number,
  options?: ProbabilityOptions,
): boolean[] {
  if (!Number.isFinite(length) || length <= 0) return [];
  const len = Math.floor(length);
  const p = sanitizeProbability(probability);
  if (p === 0) return new Array<boolean>(len).fill(false);
  if (p === 1) return new Array<boolean>(len).fill(true);

  const rng = createSeededRng(resolveSeed(options));
  const out = new Array<boolean>(len);
  for (let i = 0; i < len; i++) {
    out[i] = rng() < p;
  }
  return out;
}

/**
 * Modifiziert ein existing Pattern: für jeden true-Step gibt es `keepProbability`
 * Chance, dass er aktiv bleibt (sonst → false).
 *
 * false-Steps bleiben unverändert false.
 */
export function decayPattern(
  pattern: readonly boolean[],
  keepProbability: number,
  options?: ProbabilityOptions,
): boolean[] {
  const keep = sanitizeProbability(keepProbability);
  if (keep === 1) return pattern.slice();
  if (keep === 0) return new Array<boolean>(pattern.length).fill(false);

  const rng = createSeededRng(resolveSeed(options));
  const out = new Array<boolean>(pattern.length);
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i]) {
      out[i] = rng() < keep;
    } else {
      out[i] = false;
    }
  }
  return out;
}

/**
 * Modifiziert ein existing Pattern: für jeden false-Step gibt es `addProbability`
 * Chance, dass ein neuer Step hinzukommt.
 *
 * true-Steps bleiben unverändert true.
 */
export function densifyPattern(
  pattern: readonly boolean[],
  addProbability: number,
  options?: ProbabilityOptions,
): boolean[] {
  const add = sanitizeProbability(addProbability);
  if (add === 0) return pattern.slice();
  if (add === 1) return new Array<boolean>(pattern.length).fill(true);

  const rng = createSeededRng(resolveSeed(options));
  const out = new Array<boolean>(pattern.length);
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i]) {
      out[i] = true;
    } else {
      out[i] = rng() < add;
    }
  }
  return out;
}

/**
 * Kombinierte Operation: zuerst decay, dann densify mit demselben Seed-State.
 *
 * Nutzt intern createSeededRng so dass beide Operationen am gleichen
 * RNG-Stream weiterarbeiten — andernfalls würde derselbe Seed in beiden
 * Sub-Operationen denselben ersten Würfelwert liefern und das Ergebnis
 * verzerren.
 */
export function variatePattern(
  pattern: readonly boolean[],
  keepProbability: number,
  addProbability: number,
  options?: ProbabilityOptions,
): boolean[] {
  const keep = sanitizeProbability(keepProbability);
  const add = sanitizeProbability(addProbability);
  const rng = createSeededRng(resolveSeed(options));

  // Phase 1: decay
  const decayed = new Array<boolean>(pattern.length);
  if (keep === 1) {
    for (let i = 0; i < pattern.length; i++) decayed[i] = pattern[i] === true;
  } else if (keep === 0) {
    for (let i = 0; i < pattern.length; i++) decayed[i] = false;
  } else {
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i]) {
        decayed[i] = rng() < keep;
      } else {
        decayed[i] = false;
      }
    }
  }

  // Phase 2: densify (gleicher RNG-Stream → ungenutzte Würfel für true→true-Pfad bleiben unverbraucht)
  const out = new Array<boolean>(decayed.length);
  if (add === 0) {
    for (let i = 0; i < decayed.length; i++) out[i] = decayed[i];
  } else if (add === 1) {
    for (let i = 0; i < decayed.length; i++) out[i] = true;
  } else {
    for (let i = 0; i < decayed.length; i++) {
      if (decayed[i]) {
        out[i] = true;
      } else {
        out[i] = rng() < add;
      }
    }
  }
  return out;
}
