/**
 * Pattern Merge (v3.172.0)
 * ============================================================
 * Pure helpers for combining two boolean[] patterns via different
 * strategies. Foundation for the upcoming "Combine Patterns" UI
 * action (A + B -> merged).
 *
 * Everything in here is SIDE-EFFECT-FREE and Node-testable.
 * ============================================================
 */

export type MergeStrategy =
  | "union"        // A OR B (alle Hits aus beiden)
  | "intersection" // A AND B (nur gemeinsame Hits)
  | "xor"          // A XOR B (Hits die in genau EINEM existieren)
  | "a-minus-b"    // A AND NOT B (A's Hits ohne B's Hits)
  | "alternate";   // gerade Steps von A, ungerade von B

export interface MergeOptions {
  strategy?: MergeStrategy;
  /** Output-Length. Default = max(a.length, b.length). */
  outputLength?: number;
  /**
   * Wie out-of-range Indices behandeln (eine Seite kuerzer als Output):
   *   - false (default): out-of-range -> false
   *   - true:            out-of-range -> letzter gueltiger Wert dieser Seite
   */
  padWithLast?: boolean;
}

const VALID_STRATEGIES: ReadonlySet<MergeStrategy> = new Set<MergeStrategy>([
  "union",
  "intersection",
  "xor",
  "a-minus-b",
  "alternate",
]);

const DEFAULT_STRATEGY: MergeStrategy = "union";

export const MERGE_STRATEGY_LABELS: Record<MergeStrategy, string> = {
  union: "Union (A oder B)",
  intersection: "Intersection (A und B)",
  xor: "XOR (entweder A oder B)",
  "a-minus-b": "A minus B (A ohne B)",
  alternate: "Alternate (A/B alternierend)",
};

/**
 * Reads pattern[index] respecting padWithLast semantics.
 *
 * - index in range: pattern[index]
 * - index >= length AND padWithLast=true AND length>0: pattern[length-1]
 * - sonst: false
 */
function readStep(
  pattern: readonly boolean[],
  index: number,
  padWithLast: boolean,
): boolean {
  if (index < 0) return false;
  if (index < pattern.length) return pattern[index] === true;
  if (padWithLast && pattern.length > 0) {
    return pattern[pattern.length - 1] === true;
  }
  return false;
}

/**
 * Resolves the output length:
 *   - explicit outputLength (clamped to >= 0, rounded down) wins
 *   - sonst max(a.length, b.length)
 */
function resolveOutputLength(
  a: readonly boolean[],
  b: readonly boolean[],
  outputLength: number | undefined,
): number {
  if (typeof outputLength === "number" && Number.isFinite(outputLength)) {
    const n = Math.floor(outputLength);
    return n < 0 ? 0 : n;
  }
  return Math.max(a.length, b.length);
}

/**
 * Applies the per-step merge logic for a given strategy.
 */
function mergeStep(
  strategy: MergeStrategy,
  aStep: boolean,
  bStep: boolean,
  stepIndex: number,
): boolean {
  switch (strategy) {
    case "union":
      return aStep || bStep;
    case "intersection":
      return aStep && bStep;
    case "xor":
      return aStep !== bStep;
    case "a-minus-b":
      return aStep && !bStep;
    case "alternate":
      return stepIndex % 2 === 0 ? aStep : bStep;
    default:
      return aStep || bStep;
  }
}

/**
 * Mergt zwei boolean[]-Patterns via Strategy. Liefert ein neues Array.
 *
 * - Wenn Patterns unterschiedlich lang sind und outputLength nicht gesetzt:
 *   max(a.length, b.length). Fehlende Steps der kuerzeren Seite werden als
 *   false behandelt (oder via padWithLast: last-value).
 *
 * Defensive: empty/empty -> [].
 */
export function mergePatterns(
  a: readonly boolean[],
  b: readonly boolean[],
  options?: MergeOptions,
): boolean[] {
  const strategy: MergeStrategy =
    options?.strategy && VALID_STRATEGIES.has(options.strategy)
      ? options.strategy
      : DEFAULT_STRATEGY;
  const padWithLast = options?.padWithLast === true;
  const length = resolveOutputLength(a, b, options?.outputLength);

  if (length === 0) return [];

  const out: boolean[] = new Array(length);
  for (let i = 0; i < length; i++) {
    const aStep = readStep(a, i, padWithLast);
    const bStep = readStep(b, i, padWithLast);
    out[i] = mergeStep(strategy, aStep, bStep, i);
  }
  return out;
}

/**
 * Convenience-Aliases fuer die 5 Strategies (alle nutzen mergePatterns intern).
 */
export function unionPatterns(
  a: readonly boolean[],
  b: readonly boolean[],
): boolean[] {
  return mergePatterns(a, b, { strategy: "union" });
}

export function intersectionPatterns(
  a: readonly boolean[],
  b: readonly boolean[],
): boolean[] {
  return mergePatterns(a, b, { strategy: "intersection" });
}

export function xorPatterns(
  a: readonly boolean[],
  b: readonly boolean[],
): boolean[] {
  return mergePatterns(a, b, { strategy: "xor" });
}

export function aMinusBPatterns(
  a: readonly boolean[],
  b: readonly boolean[],
): boolean[] {
  return mergePatterns(a, b, { strategy: "a-minus-b" });
}

export function alternatePatterns(
  a: readonly boolean[],
  b: readonly boolean[],
): boolean[] {
  return mergePatterns(a, b, { strategy: "alternate" });
}
