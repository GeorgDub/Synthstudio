/**
 * Synthstudio – patternBankDensity.ts (v3.162.0)
 *
 * Pure-Helper: Multi-Pattern Density-Aggregation.
 *
 * Iteriert über mehrere Patterns und aggregiert Density-Stats. Baut auf
 * categorizeDensity aus patternDensityAnalyzer.ts (v3.159) auf.
 *
 * Public API:
 *  - analyzePatternBank(patterns) → PatternBankDensityReport
 *
 * Pure & Node-testbar. Tests: tests/features/pattern-bank-density.test.ts
 */

import type { PatternData } from "@/audio/AudioEngine";
import {
  categorizeDensity,
  type DensityCategory,
} from "@/utils/patternDensityAnalyzer";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface PatternDensityEntry {
  patternId: string;
  patternName: string;
  hits: number;
  total: number;
  density: number;
  category: DensityCategory;
}

export interface PatternBankDensityReport {
  /** Pro Pattern. */
  perPattern: PatternDensityEntry[];
  /** Aggregat über alle Patterns. */
  totalHits: number;
  totalSteps: number;
  averageDensity: number;
  /** Gehäufte Kategorie unter allen Patterns. */
  dominantCategory: DensityCategory;
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Rangfolge für Tie-Break bei dominantCategory:  "fülliger" gewinnt.
 * full > dense > medium > sparse > empty
 */
const CATEGORY_RANK: Record<DensityCategory, number> = {
  empty: 0,
  sparse: 1,
  medium: 2,
  dense: 3,
  full: 4,
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Aggregiert Density-Stats über eine Pattern-Bank.
 *
 * Verhalten:
 *  - iteriert alle parts.steps[].active = true / total
 *  - averageDensity = totalHits / totalSteps (gewichtet nach Pattern-Größe,
 *    NICHT mean of densities)
 *  - dominantCategory: häufigste Category in perPattern; bei Tie → die
 *    "fülligere" (full > dense > medium > sparse > empty)
 *  - Empty array → empty-Default-Report
 */
export function analyzePatternBank(
  patterns: readonly PatternData[],
): PatternBankDensityReport {
  if (patterns.length === 0) {
    return {
      perPattern: [],
      totalHits: 0,
      totalSteps: 0,
      averageDensity: 0,
      dominantCategory: "empty",
    };
  }

  const perPattern: PatternDensityEntry[] = [];
  let totalHits = 0;
  let totalSteps = 0;

  for (const pattern of patterns) {
    let hits = 0;
    let total = 0;
    for (const part of pattern.parts) {
      for (const step of part.steps) {
        total++;
        if (step.active) hits++;
      }
    }
    const density = total > 0 ? hits / total : 0;
    perPattern.push({
      patternId: pattern.id,
      patternName: pattern.name,
      hits,
      total,
      density,
      category: categorizeDensity(density),
    });
    totalHits += hits;
    totalSteps += total;
  }

  const averageDensity = totalSteps > 0 ? totalHits / totalSteps : 0;

  // Häufigste Category bestimmen, bei Tie gewinnt die "fülligere".
  const counts: Record<DensityCategory, number> = {
    empty: 0,
    sparse: 0,
    medium: 0,
    dense: 0,
    full: 0,
  };
  for (const entry of perPattern) counts[entry.category]++;

  let dominantCategory: DensityCategory = "empty";
  let bestCount = -1;
  let bestRank = -1;
  for (const cat of Object.keys(counts) as DensityCategory[]) {
    const count = counts[cat];
    if (count === 0) continue;
    const rank = CATEGORY_RANK[cat];
    if (count > bestCount || (count === bestCount && rank > bestRank)) {
      bestCount = count;
      bestRank = rank;
      dominantCategory = cat;
    }
  }

  return {
    perPattern,
    totalHits,
    totalSteps,
    averageDensity,
    dominantCategory,
  };
}
