/**
 * client/src/utils/patternHumanize.ts (v3.168)
 *
 * Pure-Helper: Pattern-Humanize (One-Shot).
 *
 * Kombiniert die existing v3.162-v3.166 Helpers (Probability + Groove +
 * Swing) in eine ergonomische one-shot Humanize-Operation für ein Pattern:
 *  - Velocity-Variation (Gauss-Streuung um 100)
 *  - Timing-Offsets (Gauss-Streuung in ms)
 *  - Swing für ungerade Steps
 *  - Optional sparse Probability-Decay (keepProbability < 1 droppt Steps)
 *
 * Liefert ein angereichertes HumanizedStep[] mit einem Eintrag pro
 * Pattern-Step (auch gedroppte oder inaktive Steps werden als active=false
 * mit velocity=0 zurückgegeben — der Consumer kann sich auf einen
 * positions-stabilen Array verlassen).
 *
 * Deterministisch über Seed (inline mulberry32 + Box-Muller-Gauss). Wir
 * importieren absichtlich KEIN createSeededRng aus patternProbability, um
 * zirkuläre Imports zu vermeiden.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export type HumanizeIntensity = "none" | "subtle" | "moderate" | "heavy";

export interface HumanizeOptions {
  /** Intensity-Preset. Default "subtle". */
  intensity?: HumanizeIntensity;
  /** PRNG seed für Determinismus. Default 1. */
  seed?: number;
  /** Step-Dauer in Sekunden für Swing-Offset-Berechnung. Default 0.125. */
  stepDurationSec?: number;
  /**
   * Wahrscheinlichkeit, dass ein aktiver Step beibehalten wird. Default 1
   * (keine Drops). 0 → alle aktiven Steps werden gedropped.
   */
  keepProbability?: number;
}

export interface HumanizedStep {
  stepIndex: number;
  /** Wenn false: Step wurde gedropped oder war inaktiv. Sonst true. */
  active: boolean;
  /** Timing-Offset in ms (negativ = vor Beat, positiv = nach Beat). */
  timingOffsetMs: number;
  /** Velocity 0..127. Inaktive Steps → 0. */
  velocity: number;
}

export interface HumanizePreset {
  intensity: HumanizeIntensity;
  /** Timing-Jitter ±ms. */
  timingJitterMs: number;
  /** Velocity-Jitter ±values um 100. */
  velocityJitter: number;
  /** Swing-Amount 0..1 für odd-Steps. */
  swingAmount: number;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export const HUMANIZE_PRESETS: Record<HumanizeIntensity, HumanizePreset> = {
  none: { intensity: "none", timingJitterMs: 0, velocityJitter: 0, swingAmount: 0 },
  subtle: { intensity: "subtle", timingJitterMs: 4, velocityJitter: 8, swingAmount: 0.05 },
  moderate: { intensity: "moderate", timingJitterMs: 8, velocityJitter: 15, swingAmount: 0.15 },
  heavy: { intensity: "heavy", timingJitterMs: 18, velocityJitter: 28, swingAmount: 0.33 },
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

function sanitizeProbability(p: unknown): number {
  if (typeof p !== "number" || !Number.isFinite(p)) return 1;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p;
}

function sanitizeStepDuration(s: unknown): number {
  if (typeof s !== "number" || !Number.isFinite(s) || s <= 0) return 0.125;
  return s;
}

function sanitizeIntensity(i: HumanizeIntensity | undefined): HumanizeIntensity {
  if (i === "none" || i === "subtle" || i === "moderate" || i === "heavy") return i;
  return "subtle";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wendet eine kombinierte Humanize-Operation auf ein boolean-Pattern an.
 *
 * Result-Array hat IMMER pattern.length Einträge — auch für inaktive oder
 * gedroppte Steps. Inaktive/gedroppte Steps haben active=false, velocity=0,
 * timingOffsetMs=0.
 *
 * Deterministisch: gleicher Seed + gleicher Input → identisches Output.
 */
export function humanizePattern(
  pattern: readonly boolean[],
  options?: HumanizeOptions,
): HumanizedStep[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const intensity = sanitizeIntensity(options?.intensity);
  const preset = HUMANIZE_PRESETS[intensity];
  const seed = typeof options?.seed === "number" && Number.isFinite(options.seed) ? options.seed : 1;
  const stepDurationSec = sanitizeStepDuration(options?.stepDurationSec);
  const keepProbability =
    options?.keepProbability === undefined ? 1 : sanitizeProbability(options.keepProbability);

  const rng = makeRng(seed);

  const timingJitterMs = preset.timingJitterMs;
  const velocityJitter = preset.velocityJitter;
  const swingAmount = preset.swingAmount;

  // Swing-Offset (ms) für odd-Steps, einheitlich pro Pattern.
  const swingOffsetMs = swingAmount > 0 ? swingAmount * stepDurationSec * 1000 * 0.5 : 0;

  const result: HumanizedStep[] = new Array(pattern.length);

  for (let i = 0; i < pattern.length; i++) {
    if (!pattern[i]) {
      result[i] = { stepIndex: i, active: false, timingOffsetMs: 0, velocity: 0 };
      continue;
    }

    // Probability-Decay (keep-roll). Würfeln nur wenn < 1.
    if (keepProbability < 1) {
      const keepRoll = rng();
      if (keepRoll >= keepProbability) {
        result[i] = { stepIndex: i, active: false, timingOffsetMs: 0, velocity: 0 };
        continue;
      }
    }

    // Velocity-Streuung (gauss um 100, Skala = velocityJitter * 0.5).
    const velRaw =
      velocityJitter > 0
        ? 100 + Math.round(gauss(rng) * velocityJitter * 0.5)
        : 100;
    const velocity = Math.max(0, Math.min(127, velRaw));

    // Timing-Streuung (gauss, Skala = timingJitterMs * 0.5).
    let timingOffsetMs =
      timingJitterMs > 0 ? gauss(rng) * timingJitterMs * 0.5 : 0;

    // Swing für odd-Steps (1, 3, 5, ...).
    if (swingOffsetMs > 0 && i % 2 === 1) {
      timingOffsetMs += swingOffsetMs;
    }

    // Defensive Sanitize.
    if (!Number.isFinite(timingOffsetMs)) timingOffsetMs = 0;

    result[i] = { stepIndex: i, active: true, timingOffsetMs, velocity };
  }

  return result;
}
