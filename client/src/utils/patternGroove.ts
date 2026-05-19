/**
 * client/src/utils/patternGroove.ts (v3.165)
 *
 * Pure-Helper: Pattern-Groove (Humanize Timing + Velocity).
 *
 * Verschiebt aktive Steps eines Patterns minimal in der Zeit (±ms) und
 * variiert ihre Velocity um eine Basis. Deterministisch über einen Seed
 * (mulberry32 PRNG + Box-Muller-Gauss).
 *
 * Inactive Steps (false) werden übersprungen — das Ergebnis enthält nur
 * Entries für aktive Steps. Mit timingJitterMs=0 + velocityJitter=0
 * verhält sich applyGroove wie ein No-Op (timingOffsetMs=0,
 * velocity=baseVelocity für alle aktiven Steps).
 */

export interface GrooveOptions {
  /** Timing-Jitter ±ms, 0..50. Default 0. */
  timingJitterMs?: number;
  /** Velocity-Jitter ±values, 0..40. Default 0. */
  velocityJitter?: number;
  /** Base-Velocity (mean center). Default 100. */
  baseVelocity?: number;
  /**
   * Seed für deterministische Pseudo-Random. Gleicher Seed → gleiches Output.
   * Default 1.
   */
  seed?: number;
}

export interface GrooveStep {
  stepIndex: number;
  /** Timing-Offset in ms (negative = vor Step, positive = nach Step). */
  timingOffsetMs: number;
  /** Velocity 0..127, gerundet. */
  velocity: number;
}

export interface GroovePreset {
  id: string;
  name: string;
  options: GrooveOptions;
}

/** Sanitisiert eine Zahl: NaN/Infinity → fallback, clamp auf [min,max]. */
function sanitizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/**
 * Wendet Groove auf ein boolean-Pattern an. Liefert nur Einträge für aktive
 * (true) Steps. Bei timingJitterMs=0 + velocityJitter=0 → kein Effekt
 * (timingOffsetMs=0, velocity=baseVelocity für alle aktiven Steps).
 *
 * Deterministisch: gleicher Seed + Input → gleicher Output.
 */
export function applyGroove(
  pattern: readonly boolean[],
  options: GrooveOptions = {},
): GrooveStep[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const timingJitterMs = sanitizeNumber(options.timingJitterMs, 0, 0, 50);
  const velocityJitter = sanitizeNumber(options.velocityJitter, 0, 0, 40);
  const baseVelocity = Math.round(sanitizeNumber(options.baseVelocity, 100, 0, 127));
  const seedInput = sanitizeNumber(options.seed, 1, -2147483648, 2147483647);

  let seedState = seedInput | 0;

  function nextRand(): number {
    // mulberry32 PRNG (deterministisch, fast)
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function gauss(): number {
    // Box-Muller (näherungsweise normal-distributed, mean 0, std ~1)
    const u1 = Math.max(1e-10, nextRand());
    const u2 = nextRand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const result: GrooveStep[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (!pattern[i]) continue;

    const timingOffsetMs =
      timingJitterMs > 0 ? Math.round(gauss() * timingJitterMs * 0.5) : 0;
    const velRaw =
      baseVelocity + (velocityJitter > 0 ? Math.round(gauss() * velocityJitter * 0.5) : 0);
    const velocity = Math.max(0, Math.min(127, velRaw));

    result.push({ stepIndex: i, timingOffsetMs, velocity });
  }
  return result;
}

/**
 * Standard-Groove-Presets.
 */
export const GROOVE_PRESETS: readonly GroovePreset[] = [
  {
    id: "straight",
    name: "Straight",
    options: { timingJitterMs: 0, velocityJitter: 0 },
  },
  {
    id: "subtle",
    name: "Subtle Human",
    options: { timingJitterMs: 4, velocityJitter: 8 },
  },
  {
    id: "loose",
    name: "Loose",
    options: { timingJitterMs: 12, velocityJitter: 15 },
  },
  {
    id: "drunken",
    name: "Drunken Drummer",
    options: { timingJitterMs: 25, velocityJitter: 25 },
  },
];
