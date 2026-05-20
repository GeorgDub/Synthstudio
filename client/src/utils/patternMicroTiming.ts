/**
 * client/src/utils/patternMicroTiming.ts (v3.191)
 *
 * Pure-Helper: Pattern Micro-Timing (Humanize-Style Timing-Offsets).
 *
 * Erzeugt deterministische Micro-Timing-Offsets in Millisekunden fuer jeden
 * AKTIVEN Step eines boolean-Patterns. Inactive Steps werden ueberlesen.
 *
 * Konzept:
 *   - Pro Preset: jitterMs (max Gauss-Streuung) + biasMs (konstantes Shift)
 *   - "behind-the-beat" -> alle Steps positiv verschoben (spaeter)
 *   - "rushed"          -> alle Steps negativ verschoben (frueher)
 *
 * Foundation fuer eine kuenftige Humanize-Engine-Integration in AudioEngine.
 * Bewusst unabhaengig vom patternHumanize-Helper, damit dies auch fuer
 * MIDI-Export / Per-Step-Latenz-Korrektur isoliert nutzbar bleibt.
 *
 * Deterministisch via inline mulberry32 PRNG + Box-Muller-Gauss. Wir
 * importieren keine externen RNG-Utilities, um zirkulaere Imports zu
 * vermeiden.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export type MicroTimingPreset =
  | "tight"
  | "subtle"
  | "loose"
  | "behind-the-beat"
  | "rushed";

export interface MicroTimingOptions {
  /** Preset fuer jitter+bias. Default "subtle". */
  preset?: MicroTimingPreset;
  /** Custom max-jitter-ms (ueberschreibt preset.jitterMs). */
  jitterMs?: number;
  /** Bias-ms (alle steps werden um diesen Wert verschoben). Negativ = vorm Beat. Default 0 / preset.biasMs. */
  biasMs?: number;
  /** PRNG seed fuer Determinismus. Default 1. */
  seed?: number;
}

export interface MicroTimedStep {
  stepIndex: number;
  /** Timing-Offset in ms (negativ = vor Beat, positiv = nach Beat). */
  timingOffsetMs: number;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export const MICRO_TIMING_PRESETS: Record<
  MicroTimingPreset,
  { jitterMs: number; biasMs: number }
> = {
  tight: { jitterMs: 1, biasMs: 0 },
  subtle: { jitterMs: 4, biasMs: 0 },
  loose: { jitterMs: 12, biasMs: 0 },
  "behind-the-beat": { jitterMs: 6, biasMs: 8 },
  rushed: { jitterMs: 6, biasMs: -8 },
};

// ─── Internal: PRNG + Gauss ───────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = Number.isFinite(seed) ? Math.floor(seed) | 0 : 1;
  return function (): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u1 = Math.max(1e-10, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Internal: sanitizers ─────────────────────────────────────────────────────

function sanitizePreset(p: MicroTimingPreset | undefined): MicroTimingPreset {
  if (
    p === "tight" ||
    p === "subtle" ||
    p === "loose" ||
    p === "behind-the-beat" ||
    p === "rushed"
  ) {
    return p;
  }
  return "subtle";
}

function sanitizeNumber(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return n;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Erzeugt Micro-Timing-Offsets fuer jeden AKTIVEN Step eines Patterns.
 *
 * Result-Array enthaelt nur Eintraege fuer aktive Steps — inactive Steps
 * werden weggelassen. stepIndex bleibt der Original-Pattern-Index.
 *
 * Deterministisch: gleicher Seed + gleicher Input → identisches Output.
 *
 * @param pattern   boolean[] (true = aktiver Step)
 * @param options   preset/jitterMs/biasMs/seed
 * @returns         MicroTimedStep[] (nur active Steps, in Original-Reihenfolge)
 */
export function generateMicroTiming(
  pattern: readonly boolean[],
  options?: MicroTimingOptions,
): MicroTimedStep[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const preset = sanitizePreset(options?.preset);
  const presetCfg = MICRO_TIMING_PRESETS[preset];

  const jitterMs = sanitizeNumber(options?.jitterMs, presetCfg.jitterMs);
  const biasMs = sanitizeNumber(options?.biasMs, presetCfg.biasMs);
  const seed = sanitizeNumber(options?.seed, 1);

  const rng = makeRng(seed);
  const result: MicroTimedStep[] = [];

  for (let i = 0; i < pattern.length; i++) {
    if (!pattern[i]) continue;

    // Gauss-Noise skaliert mit jitterMs/2 (Standard 1-sigma ~= jitter/2).
    const noise = jitterMs > 0 ? gauss(rng) * jitterMs * 0.5 : 0;
    let offset = noise + biasMs;
    if (!Number.isFinite(offset)) offset = 0;

    result.push({ stepIndex: i, timingOffsetMs: offset });
  }

  return result;
}
