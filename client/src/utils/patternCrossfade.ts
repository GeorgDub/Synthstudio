/**
 * Pattern Crossfade (v3.123.0)
 * ============================================================
 * Pure helpers for smooth transitions between patterns.
 * Provides three crossfade curves and step-window utilities.
 *
 * Everything in here is SIDE-EFFECT-FREE and Node-testable.
 * AudioEngine integration is handled in AudioEngine.ts.
 * ============================================================
 */

export type CrossfadeCurve = "linear" | "equalPower" | "sine";

export interface CrossfadeConfig {
  enabled: boolean;
  /** 0..16 — wenn 0, kein Crossfade (Hard-Switch). */
  lengthSteps: number;
  curve: CrossfadeCurve;
}

export interface CrossfadeGain {
  gainA: number;
  gainB: number;
}

export const VALID_CURVES: ReadonlySet<CrossfadeCurve> = new Set([
  "linear",
  "equalPower",
  "sine",
]);

export const MIN_LENGTH = 0;
export const MAX_LENGTH = 16;

export const DEFAULT_CONFIG: CrossfadeConfig = {
  enabled: false,
  lengthSteps: 4,
  curve: "equalPower",
};

/**
 * Clamps progress to [0, 1] and returns NaN-safe value.
 */
function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * Returns gainA / gainB at given crossfade progress t (0..1).
 * - linear:     gainA = 1-t, gainB = t              (sum = 1)
 * - equalPower: gainA = cos(t·π/2), gainB = sin(t·π/2)  (sum-of-squares = 1)
 * - sine:       gainA = (1-t)², gainB = t²          (softer, smooth shaping)
 *
 * Defensive: invalid curve falls back to "linear".
 */
export function crossfadeGain(t: number, curve: CrossfadeCurve): CrossfadeGain {
  const x = clamp01(t);
  const c: CrossfadeCurve = VALID_CURVES.has(curve) ? curve : "linear";
  switch (c) {
    case "equalPower": {
      const phase = (x * Math.PI) / 2;
      return { gainA: Math.cos(phase), gainB: Math.sin(phase) };
    }
    case "sine": {
      const inv = 1 - x;
      return { gainA: inv * inv, gainB: x * x };
    }
    case "linear":
    default:
      return { gainA: 1 - x, gainB: x };
  }
}

/**
 * Returns progress 0..1 wenn currentStep im Crossfade-Window liegt,
 * sonst null.
 *
 * Crossfade-Window = die letzten `fadeLength` Steps eines Patterns.
 * window-start = totalSteps - fadeLength.
 *
 * fadeLength=0 → kein Window → always null.
 *
 * Beispiel: totalSteps=16, fadeLength=4
 *   currentStep=11 → null  (vor Window)
 *   currentStep=12 → 0.0   (window-start, gainA=1)
 *   currentStep=13 → 0.25
 *   currentStep=14 → 0.5
 *   currentStep=15 → 0.75
 *   currentStep=16 → 1.0 (an Boundary — Switch erfolgt hier)
 */
export function getCrossfadeProgress(
  currentStep: number,
  totalSteps: number,
  fadeLength: number,
): number | null {
  if (!Number.isFinite(currentStep) || !Number.isFinite(totalSteps) || !Number.isFinite(fadeLength)) {
    return null;
  }
  if (totalSteps <= 0 || fadeLength <= 0) return null;
  const start = totalSteps - fadeLength;
  if (currentStep < start) return null;
  if (currentStep > totalSteps) return null;
  const progress = (currentStep - start) / fadeLength;
  return clamp01(progress);
}

/**
 * Returns true if the engine should begin crossfading at `currentStep`.
 * That's exactly at step (totalSteps - fadeLength).
 */
export function shouldStartCrossfade(
  currentStep: number,
  totalSteps: number,
  fadeLength: number,
): boolean {
  if (!Number.isFinite(currentStep) || !Number.isFinite(totalSteps) || !Number.isFinite(fadeLength)) {
    return false;
  }
  if (fadeLength <= 0 || totalSteps <= 0) return false;
  return currentStep === totalSteps - fadeLength;
}

/**
 * Clamps lengthSteps into [MIN_LENGTH, MAX_LENGTH] and rounds to int.
 * Non-finite → returns DEFAULT_CONFIG.lengthSteps.
 */
export function clampLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.lengthSteps;
  const i = Math.round(n);
  if (i < MIN_LENGTH) return MIN_LENGTH;
  if (i > MAX_LENGTH) return MAX_LENGTH;
  return i;
}

/**
 * Sanitizes a curve value — invalid → "linear".
 */
export function sanitizeCurve(c: unknown): CrossfadeCurve {
  if (typeof c === "string" && VALID_CURVES.has(c as CrossfadeCurve)) {
    return c as CrossfadeCurve;
  }
  return "linear";
}

/**
 * Sanitizes a full config object — defensive against partial / garbage input.
 *
 * Curve handling:
 *   - missing (undefined) → DEFAULT_CONFIG.curve
 *   - present but invalid → "linear" (explicit fallback)
 */
export function sanitizeConfig(input: unknown): CrossfadeConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONFIG };
  const obj = input as Record<string, unknown>;
  let curve: CrossfadeCurve;
  if (obj.curve === undefined) {
    curve = DEFAULT_CONFIG.curve;
  } else {
    curve = sanitizeCurve(obj.curve);
  }
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_CONFIG.enabled,
    lengthSteps: clampLength(typeof obj.lengthSteps === "number" ? obj.lengthSteps : DEFAULT_CONFIG.lengthSteps),
    curve,
  };
}
