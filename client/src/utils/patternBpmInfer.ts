/**
 * patternBpmInfer.ts v3.179.0
 *
 * Pure-Helper: Schlaegt einen passenden BPM fuer ein Pattern basierend auf
 * Density (Anteil aktiver Steps), Syncopation (Stddev der Hit-Distanzen) und
 * optionalen Genre-Hints vor.
 *
 * Keine Side-Effects. Keine DOM/Audio-API-Zugriffe. Reine Heuristik —
 * confidence-Wert macht das transparent.
 *
 * Public API:
 *   - inferPatternBpm(pattern, options?) -> BpmInferenceResult
 *   - GENRE_BPM_DEFAULTS (readonly Record<string, {bpm, range}>)
 */

import type { PatternData } from "@/audio/AudioEngine";

// ─── Types ────────────────────────────────────────────────────────────────

export interface BpmInferenceResult {
  /** Vorgeschlagene BPM (40..220). */
  suggestedBpm: number;
  /** Confidence 0..1. */
  confidence: number;
  /** Genre-Hint (z.B. "house", "trap", "dnb"). */
  genreHint: string;
  /** Reasoning als String. */
  reasoning: string;
}

export interface BpmInferOptions {
  /** User-Hint: vom User vorgegebenes Genre (overrides auto-detect). */
  preferredGenre?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Genre-zu-BPM-Map fuer UI + interne Heuristik. */
export const GENRE_BPM_DEFAULTS: Record<string, { bpm: number; range: [number, number] }> = {
  ambient:    { bpm: 70,  range: [60, 90] },
  "hip-hop":  { bpm: 90,  range: [80, 100] },
  reggaeton:  { bpm: 100, range: [95, 110] },
  pop:        { bpm: 120, range: [100, 130] },
  house:      { bpm: 124, range: [120, 128] },
  techno:     { bpm: 130, range: [125, 135] },
  trap:       { bpm: 140, range: [130, 150] },
  dnb:        { bpm: 174, range: [160, 180] },
  footwork:   { bpm: 160, range: [150, 170] },
};

const FALLBACK_GENRE = "pop";
const FALLBACK_BPM = 120;
const HEURISTIC_CONFIDENCE = 0.7;
const MIN_BPM = 40;
const MAX_BPM = 220;

// ─── Helpers ──────────────────────────────────────────────────────────────

function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return FALLBACK_BPM;
  if (bpm < MIN_BPM) return MIN_BPM;
  if (bpm > MAX_BPM) return MAX_BPM;
  return Math.round(bpm);
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Liefert true, falls Pattern keine aktiven Steps hat. */
function isEmptyPattern(pattern: PatternData | null | undefined): boolean {
  if (!pattern || !Array.isArray(pattern.parts) || pattern.parts.length === 0) {
    return true;
  }
  for (const part of pattern.parts) {
    if (!part || !Array.isArray(part.steps)) continue;
    for (const step of part.steps) {
      if (step && step.active) return false;
    }
  }
  return true;
}

/**
 * Berechnet die Pattern-Density (0..1) als Anteil der Steps, in denen
 * MINDESTENS EIN Part aktiv ist (Union ueber Parts pro Step-Index).
 *
 * Begruendung: Eine summierte cell-density (active_cells / total_cells)
 * verzerrt bei vielen Parts — z.B. ein simples 4-on-floor mit 16 Parts
 * waere 4/(16*16)=1.5%. Die Union-Density ist musikalisch aussagekraeftiger
 * fuer die Genre-Klassifikation ("an wie vielen Steps passiert ueberhaupt
 * etwas").
 */
function computeDensity(pattern: PatternData): number {
  const stepCount = pattern.stepCount ?? 16;
  if (stepCount <= 0) return 0;
  const hitMask: boolean[] = new Array(stepCount).fill(false);
  for (const part of pattern.parts) {
    if (!part || !Array.isArray(part.steps)) continue;
    for (let i = 0; i < part.steps.length && i < stepCount; i++) {
      const step = part.steps[i];
      if (step && step.active) hitMask[i] = true;
    }
  }
  let active = 0;
  for (const h of hitMask) if (h) active++;
  return active / stepCount;
}

/**
 * Berechnet einen Syncopation-Score 0..1 als normalisierte Stddev der
 * Hit-Distanzen, gemessen ueber die kombinierte Hit-Maske aller Parts.
 *
 * Idee: 4-on-the-floor → Distanzen alle gleich → stddev 0 → score 0.
 * Zerklueftete Off-Beat-Patterns → stddev hoch → score nahe 1.
 */
function computeSyncopation(pattern: PatternData): number {
  const stepCount = pattern.stepCount ?? 16;
  // Kombinierte Hit-Maske: union aller aktiven Step-Indizes.
  const hitMask: boolean[] = new Array(stepCount).fill(false);
  for (const part of pattern.parts) {
    if (!part || !Array.isArray(part.steps)) continue;
    for (let i = 0; i < part.steps.length && i < stepCount; i++) {
      const step = part.steps[i];
      if (step && step.active) hitMask[i] = true;
    }
  }
  const hitIdx: number[] = [];
  for (let i = 0; i < hitMask.length; i++) if (hitMask[i]) hitIdx.push(i);
  if (hitIdx.length < 2) return 0;

  // Distanzen zwischen aufeinanderfolgenden Hits (zyklisch).
  const distances: number[] = [];
  for (let i = 1; i < hitIdx.length; i++) distances.push(hitIdx[i] - hitIdx[i - 1]);
  // Wrap-around (vom letzten Hit zum ersten + stepCount).
  distances.push(hitIdx[0] + stepCount - hitIdx[hitIdx.length - 1]);

  const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
  if (mean <= 0) return 0;
  let sq = 0;
  for (const d of distances) sq += (d - mean) * (d - mean);
  const stddev = Math.sqrt(sq / distances.length);
  // Normalisierung: stddev/mean → 0..~1 fuer typische Patterns.
  return clampUnit(stddev / mean);
}

function buildFromGenre(genreKey: string, reason: string): BpmInferenceResult {
  const entry = GENRE_BPM_DEFAULTS[genreKey];
  if (entry) {
    return {
      suggestedBpm: clampBpm(entry.bpm),
      confidence: HEURISTIC_CONFIDENCE,
      genreHint: genreKey,
      reasoning: reason,
    };
  }
  // Defensive Fallback bei unbekanntem Genre.
  return {
    suggestedBpm: FALLBACK_BPM,
    confidence: HEURISTIC_CONFIDENCE,
    genreHint: FALLBACK_GENRE,
    reasoning: `Unknown genre "${genreKey}" → fallback ${FALLBACK_GENRE}`,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Schlaegt einen BPM fuer ein gegebenes Pattern vor.
 *
 * Behavior:
 *   - Leeres Pattern → Default (pop, 120 BPM, confidence 0).
 *   - options.preferredGenre gesetzt → nutze GENRE_BPM_DEFAULTS[g].bpm
 *     (unbekanntes Genre → fallback pop/120).
 *   - Sonst Heuristik via Density + Syncopation.
 */
export function inferPatternBpm(
  pattern: PatternData,
  options?: BpmInferOptions,
): BpmInferenceResult {
  if (isEmptyPattern(pattern)) {
    return {
      suggestedBpm: FALLBACK_BPM,
      confidence: 0,
      genreHint: FALLBACK_GENRE,
      reasoning: "Empty pattern",
    };
  }

  // User-Override: explizites Genre.
  if (options?.preferredGenre) {
    const key = options.preferredGenre;
    const entry = GENRE_BPM_DEFAULTS[key];
    if (entry) {
      return {
        suggestedBpm: clampBpm(entry.bpm),
        confidence: HEURISTIC_CONFIDENCE,
        genreHint: key,
        reasoning: `User-preferred genre "${key}" → ${entry.bpm} BPM`,
      };
    }
    // Unbekanntes Genre: Fallback.
    return {
      suggestedBpm: FALLBACK_BPM,
      confidence: HEURISTIC_CONFIDENCE,
      genreHint: FALLBACK_GENRE,
      reasoning: `Unknown preferredGenre "${key}" → fallback ${FALLBACK_GENRE}`,
    };
  }

  // Heuristik.
  const density = computeDensity(pattern);
  const syncopation = computeSyncopation(pattern);
  const densityPct = Math.round(density * 100);
  const syncPct = Math.round(syncopation * 100);

  // Sehr syncopated, mittel-hohe Density → dnb (Breakbeat-Charakter).
  if (syncopation > 0.5 && density >= 0.3) {
    return buildFromGenre(
      "dnb",
      `Hohe Syncopation (${syncPct}%) + Density ${densityPct}% → DnB/Breakbeat`,
    );
  }

  if (density > 0.5) {
    // High density: trap (eher syncopated) oder dnb (sehr syncopated).
    const genre = syncopation > 0.35 ? "dnb" : "trap";
    return buildFromGenre(
      genre,
      `Hohe Density (${densityPct}%) + Syncopation ${syncPct}% → ${genre === "dnb" ? "DnB" : "Trap"}`,
    );
  }

  if (density >= 0.3) {
    // Medium density: house (regelmaessig) oder techno (etwas syncopated).
    const genre = syncopation > 0.25 ? "techno" : "house";
    return buildFromGenre(
      genre,
      `Mittlere Density (${densityPct}%) + Syncopation ${syncPct}% → ${genre === "techno" ? "Techno" : "House"} (4-on-floor)`,
    );
  }

  // Sparse: hip-hop (etwas Bewegung) oder ambient (sehr ruhig).
  const genre = density >= 0.15 ? "hip-hop" : "ambient";
  return buildFromGenre(
    genre,
    `Niedrige Density (${densityPct}%) → ${genre === "hip-hop" ? "Hip-Hop" : "Ambient"} (sparse)`,
  );
}
