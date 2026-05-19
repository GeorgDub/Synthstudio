/**
 * client/src/utils/patternFillGenerator.ts (v3.167)
 *
 * Pure-Helper: Drum-Fill-Generator (Pattern-Ending-Fill).
 *
 * Generiert "Fills" am Pattern-Ende — klassische DAW-Auto-Fill-Funktion
 * für Bar-Übergänge. Standardmäßig additiv (existierende Hits bleiben);
 * mit replaceExisting=true wird der Fill-Bereich vorher geleert.
 *
 * Drei Fill-Stile:
 *   • generateFill     — gleichverteilte Density im Fill-Bereich
 *   • generateBuildUp  — linear ansteigende Density (Build-Up zum Ende)
 *   • generateRoll     — alle letzten N Steps aktiv (klassischer Snare-Roll)
 *
 * Plus clearFillRegion als Undo-Helper für den Fill-Bereich.
 *
 * Determinismus: mulberry32-PRNG; gleicher Seed + Input → gleicher Output.
 * Alle Funktionen liefern NEUE Arrays; Input bleibt unverändert.
 */

export interface FillOptions {
  /** Fill-Density: wie viele Steps im Fill-Bereich aktiv sein sollen (0..1). Default 0.5. */
  density?: number;
  /** Welche letzten N Steps der Fill-Bereich umfassen soll. Default Math.floor(length / 3). */
  fillLength?: number;
  /** PRNG seed für determinismus. Default 1. */
  seed?: number;
  /** Wenn true: bestehende Hits im Fill-Bereich werden entfernt. Default false (additiv). */
  replaceExisting?: boolean;
}

export interface FillPreset {
  id: string;
  name: string;
  description: string;
}

/** Sanitisiert eine Zahl: NaN/Infinity → fallback, clamp auf [min,max]. */
function sanitizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** Sanitisiert eine Integer-Längen-Angabe: NaN/negativ → fallback, clamp auf [0,max]. */
function sanitizeFillLength(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), max);
}

/** Baut einen deterministischen mulberry32-PRNG aus seed. */
function makeRng(seedInput: number): () => number {
  let seedState = seedInput | 0;
  return function nextRand(): number {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generiert ein Fill am Pattern-Ende. Standardmäßig additiv: existierende
 * Hits bleiben, neue Hits werden im Fill-Bereich hinzugefügt.
 *
 * Fill-Bereich = letzte `fillLength` Steps (default 1/3 der Länge).
 * Fill-Density bestimmt wie viele zusätzliche Hits im Bereich aktiv sind.
 */
export function generateFill(
  pattern: readonly boolean[],
  options: FillOptions = {},
): boolean[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const length = pattern.length;
  const density = sanitizeNumber(options.density, 0.5, 0, 1);
  const defaultFillLength = Math.floor(length / 3);
  const fillLength = sanitizeFillLength(options.fillLength, defaultFillLength, length);
  const seedInput = sanitizeNumber(options.seed, 1, -2147483648, 2147483647);
  const replaceExisting = options.replaceExisting === true;

  const rand = makeRng(seedInput);
  const out: boolean[] = pattern.slice();

  const fillStart = length - fillLength;
  for (let i = fillStart; i < length; i++) {
    if (replaceExisting) {
      out[i] = rand() < density;
    } else {
      if (out[i]) continue;
      out[i] = rand() < density;
    }
  }
  return out;
}

/**
 * Generiert einen "Build-Up" am Pattern-Ende: dichter werdende Hits zur
 * Mitte/Ende hin. Klassischer DAW-Build-Up wo die letzten N Steps zunehmend
 * mehr Hits haben.
 *
 * Erster Fill-Step: Probability density × 0.5.
 * Letzter Fill-Step: Probability density × 1.5 (clamped auf 1.0).
 *
 * Liefert immer ein neues Array mit gleicher Länge wie Input.
 */
export function generateBuildUp(
  pattern: readonly boolean[],
  options: FillOptions = {},
): boolean[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const length = pattern.length;
  const density = sanitizeNumber(options.density, 0.5, 0, 1);
  const defaultFillLength = Math.floor(length / 3);
  const fillLength = sanitizeFillLength(options.fillLength, defaultFillLength, length);
  const seedInput = sanitizeNumber(options.seed, 1, -2147483648, 2147483647);
  const replaceExisting = options.replaceExisting === true;

  const rand = makeRng(seedInput);
  const out: boolean[] = pattern.slice();

  const fillStart = length - fillLength;
  for (let i = fillStart; i < length; i++) {
    // Linear ramp: erster Step (relIdx=0) → 0.5×density, letzter Step → 1.5×density.
    // relIdx geht von 0 bis 1 über die fill-region.
    const relIdx = fillLength > 1 ? (i - fillStart) / (fillLength - 1) : 1;
    const ramp = 0.5 + relIdx; // 0.5..1.5
    const stepProb = Math.max(0, Math.min(1, density * ramp));

    if (replaceExisting) {
      out[i] = rand() < stepProb;
    } else {
      if (out[i]) continue;
      out[i] = rand() < stepProb;
    }
  }
  return out;
}

/**
 * Generiert einen "Roll": dichte aufeinanderfolgende Hits im Fill-Bereich
 * (z.B. Snare-Roll). Deterministisch all-true im Fill-Bereich.
 */
export function generateRoll(
  pattern: readonly boolean[],
  options: Pick<FillOptions, "fillLength"> = {},
): boolean[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const length = pattern.length;
  const defaultFillLength = Math.floor(length / 3);
  const fillLength = sanitizeFillLength(options.fillLength, defaultFillLength, length);

  const out: boolean[] = pattern.slice();
  const fillStart = length - fillLength;
  for (let i = fillStart; i < length; i++) {
    out[i] = true;
  }
  return out;
}

/**
 * Helper: liefert ein neues Pattern wo die letzten `fillLength` Steps alle
 * false sind. Nützlich als Undo-Operation für einen vorher generierten Fill.
 *
 * fillLength=0 → identische Kopie (keine Änderung).
 * Leere Patterns → [].
 */
export function clearFillRegion(
  pattern: readonly boolean[],
  fillLength: number,
): boolean[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];

  const length = pattern.length;
  const clearN = sanitizeFillLength(fillLength, 0, length);

  const out: boolean[] = pattern.slice();
  const clearStart = length - clearN;
  for (let i = clearStart; i < length; i++) {
    out[i] = false;
  }
  return out;
}

/**
 * Standard-Fill-Presets.
 */
export const FILL_PRESETS: readonly FillPreset[] = [
  {
    id: "subtle",
    name: "Subtle Fill",
    description: "Sparse density 0.3 im letzten Drittel",
  },
  {
    id: "busy",
    name: "Busy Fill",
    description: "Hohe density 0.7 in den letzten 4 Steps",
  },
  {
    id: "buildup",
    name: "Build-Up",
    description: "Dichter werdend zum Pattern-Ende",
  },
  {
    id: "roll",
    name: "Drum-Roll",
    description: "Alle letzten 4 Steps aktiv",
  },
];
