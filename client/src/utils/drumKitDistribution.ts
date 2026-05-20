/**
 * drumKitDistribution.ts (v3.173)
 *
 * Intelligente Drum-Kit-Verteilung: nimmt eine Liste von Samples
 * (mit Name + optional Tags + Category) und schlägt eine sinnvolle
 * Zuordnung auf die 16 Parts der Drum-Machine vor (Kick → Part 0,
 * Snare → Part 1, Hi-Hat → Part 2, …).
 *
 * Reine Logik (Pure-Helper). Greedy:
 *   - Für jeden Slot in `slotPreferences` (in Reihenfolge)
 *     wird das erste noch-nicht-verbrauchte Sample gesucht, dessen
 *     category / tags / name irgendeinen `matcher` enthält.
 *   - Sample wird "consumed" und kann nicht für weitere Slots
 *     verwendet werden.
 *   - Übrig gebliebene Samples landen in `unassignedSamples`.
 *
 * Match-Logik pro `matcher` (case-insensitive):
 *   1. `sample.category?.toLowerCase() === matcher`
 *   2. `sample.tags?.some(t => t.toLowerCase() === matcher)`
 *   3. `sample.name.toLowerCase().includes(matcher)`
 */

export interface SampleCandidate {
  id: string;
  name: string;
  tags?: string[];
  /** Optional category — bevorzugt vor Tags wenn vorhanden. */
  category?: string;
}

export interface DistributionResult {
  /** Mapping partIndex (0..partCount-1) → sampleId. */
  partAssignments: Array<{ partIndex: number; sampleId: string | null }>;
  /** Samples die keinem Part zugeordnet werden konnten (unmapped). */
  unassignedSamples: string[];
}

export interface DistributionOptions {
  /** Anzahl Parts. Default 16. */
  partCount?: number;
  /**
   * Custom Slot-Preferences (Override). Default: 16-slot GM-Drum-Layout.
   * Each entry: { partIndex, matchers: ["kick", "bd", …] }.
   */
  slotPreferences?: Array<{ partIndex: number; matchers: readonly string[] }>;
}

/**
 * Default-Slot-Preferences für GM-Drum-Layout (16 Slots).
 *
 * partIndex 0=Kick, 1=Snare, 2=HHat-Closed, 3=HHat-Open, 4=Clap,
 * 5-7=Toms, 8=Crash, 9=Ride, 10-15=Perc/Misc.
 */
export const DEFAULT_SLOT_PREFERENCES: ReadonlyArray<{
  partIndex: number;
  matchers: readonly string[];
}> = [
  { partIndex: 0, matchers: ["kick", "bd", "bass drum", "bassdrum"] },
  { partIndex: 1, matchers: ["snare", "sn", "snr"] },
  { partIndex: 2, matchers: ["hat", "hihat", "hh", "hi-hat closed", "closed"] },
  { partIndex: 3, matchers: ["open", "ohh", "hi-hat open", "open hat"] },
  { partIndex: 4, matchers: ["clap", "cp", "handclap"] },
  { partIndex: 5, matchers: ["tom low", "low tom", "tom1", "lowtom"] },
  { partIndex: 6, matchers: ["tom mid", "mid tom", "tom2", "midtom"] },
  { partIndex: 7, matchers: ["tom high", "high tom", "tom3", "hightom"] },
  { partIndex: 8, matchers: ["crash", "cymbal", "cy"] },
  { partIndex: 9, matchers: ["ride"] },
  { partIndex: 10, matchers: ["cowbell", "cb"] },
  { partIndex: 11, matchers: ["conga low", "conga", "low conga"] },
  { partIndex: 12, matchers: ["conga high", "high conga"] },
  { partIndex: 13, matchers: ["maracas", "shaker"] },
  { partIndex: 14, matchers: ["claves"] },
  { partIndex: 15, matchers: ["cabasa", "perc", "percussion"] },
];

/**
 * Prüft, ob ein Sample einen Matcher matched (case-insensitive):
 *   - exakter category-Match
 *   - exakter tag-Match
 *   - name.includes(matcher)
 */
function sampleMatchesMatcher(sample: SampleCandidate, matcher: string): boolean {
  const m = matcher.toLowerCase();
  if (sample.category && sample.category.toLowerCase() === m) {
    return true;
  }
  if (sample.tags) {
    for (const t of sample.tags) {
      if (typeof t === "string" && t.toLowerCase() === m) {
        return true;
      }
    }
  }
  if (typeof sample.name === "string" && sample.name.toLowerCase().includes(m)) {
    return true;
  }
  return false;
}

/**
 * Verteilt Samples auf Drum-Parts via Pattern-Matching auf
 * Category + Tags + Name. Greedy + Slot-Reihenfolge.
 */
export function distributeDrumKit(
  samples: readonly SampleCandidate[],
  options: DistributionOptions = {},
): DistributionResult {
  const rawPartCount = options.partCount ?? 16;
  const partCount = rawPartCount < 1 ? 1 : rawPartCount;
  const slotPreferences = options.slotPreferences ?? DEFAULT_SLOT_PREFERENCES;

  // Init alle Slots mit null
  const partAssignments: Array<{ partIndex: number; sampleId: string | null }> = [];
  for (let i = 0; i < partCount; i++) {
    partAssignments.push({ partIndex: i, sampleId: null });
  }

  // Tracker für verbrauchte Samples
  const consumed = new Set<string>();

  // Iteriere Slot-Preferences in Reihenfolge
  for (const pref of slotPreferences) {
    if (pref.partIndex < 0 || pref.partIndex >= partCount) {
      continue; // ausserhalb des partCount-Bereichs überspringen
    }
    // Slot bereits gesetzt? → skip (sollte bei einzigartigem partIndex nicht passieren,
    // aber defensiv falls custom prefs duplicate partIndices haben)
    if (partAssignments[pref.partIndex].sampleId !== null) {
      continue;
    }

    let matchedSampleId: string | null = null;
    for (const matcher of pref.matchers) {
      // suche das erste noch-nicht-verbrauchte Sample das matched
      for (const sample of samples) {
        if (consumed.has(sample.id)) continue;
        if (sampleMatchesMatcher(sample, matcher)) {
          matchedSampleId = sample.id;
          break;
        }
      }
      if (matchedSampleId !== null) break;
    }

    if (matchedSampleId !== null) {
      partAssignments[pref.partIndex].sampleId = matchedSampleId;
      consumed.add(matchedSampleId);
    }
  }

  // Restliche unverbrauchte Samples → unassignedSamples
  const unassignedSamples: string[] = [];
  for (const sample of samples) {
    if (!consumed.has(sample.id)) {
      unassignedSamples.push(sample.id);
    }
  }

  return { partAssignments, unassignedSamples };
}
