/**
 * Synthstudio – patternHarmonicAnalysis.ts (v3.178.0)
 *
 * Pure Helpers für Harmonic Analysis: Chord-Root + Quality aus einer
 * Liste MIDI-Notes ableiten via Pitch-Class-Profile-Matching.
 *
 * Public Surface:
 *  - analyzeHarmony(midiNotes)         → HarmonicAnalysisResult
 *  - formatHarmonyResult(result)       → human-readable "Cmaj7 (87%)"
 *  - PITCH_CLASS_NAMES                 → ["C","C#",…,"B"]
 *
 * Algorithm: für jeden möglichen Root (0..11) und jede Chord-Quality
 * wird ein Match-Score gegen die erwarteten Pitch-Classes berechnet.
 * Bei Tie gewinnt die simplere Quality (major < minor < 7 < …).
 *
 * Nichts mutiert die Eingabe.
 */
import type { ChordQuality } from "@/utils/randomChordGenerator";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface HarmonicAnalysisResult {
  /** Pitch-Class des Root (0..11, C=0). */
  rootPitchClass: number;
  /** Wahrscheinlichste Chord-Quality. */
  quality: ChordQuality;
  /** Confidence 0..1. */
  confidence: number;
  /** Alle erkannten Pitch-Classes (sortiert). */
  pitchClasses: number[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PITCH_CLASS_NAMES: readonly string[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

/**
 * Chord-Templates (Intervalle relativ zum Root).
 * Subset von CHORD_INTERVALS aus randomChordGenerator — bewusst
 * lokal dupliziert, damit dieser Helper unabhängig bleibt.
 */
const CHORD_TEMPLATES: ReadonlyArray<{
  quality: ChordQuality;
  intervals: readonly number[];
  priority: number; // niedriger = simpler → tie-breaker
}> = [
  { quality: "major",      intervals: [0, 4, 7],     priority: 0 },
  { quality: "minor",      intervals: [0, 3, 7],     priority: 1 },
  { quality: "7",          intervals: [0, 4, 7, 10], priority: 2 },
  { quality: "maj7",       intervals: [0, 4, 7, 11], priority: 3 },
  { quality: "m7",         intervals: [0, 3, 7, 10], priority: 4 },
  { quality: "sus2",       intervals: [0, 2, 7],     priority: 5 },
  { quality: "sus4",       intervals: [0, 5, 7],     priority: 6 },
  { quality: "diminished", intervals: [0, 3, 6],     priority: 7 },
  { quality: "augmented",  intervals: [0, 4, 8],     priority: 8 },
];

/** Short-Suffix pro Quality für formatHarmonyResult. */
const QUALITY_SHORT: Record<ChordQuality, string> = {
  major:      "",
  minor:      "m",
  "7":        "7",
  maj7:       "maj7",
  m7:         "m7",
  sus2:       "sus2",
  sus4:       "sus4",
  diminished: "dim",
  augmented:  "aug",
  "9":        "9",
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analysiert ein Set MIDI-Notes (simultaneous oder Pattern-summary).
 * Liefert wahrscheinlichsten Root + Quality.
 */
export function analyzeHarmony(midiNotes: readonly number[]): HarmonicAnalysisResult {
  const defaults: HarmonicAnalysisResult = {
    rootPitchClass: 0,
    quality: "major",
    confidence: 0,
    pitchClasses: [],
  };

  if (!Array.isArray(midiNotes) || midiNotes.length === 0) {
    return defaults;
  }

  // Filter non-finite, normalize negative MIDI properly, unique + sort.
  const pcSet = new Set<number>();
  for (const n of midiNotes) {
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    const pc = ((Math.trunc(n) % 12) + 12) % 12;
    pcSet.add(pc);
  }
  if (pcSet.size === 0) return defaults;

  const pitchClasses = Array.from(pcSet).sort((a, b) => a - b);

  // Score every (root, template) pair.
  // Tie-break order:
  //   1. higher confidence wins
  //   2. more absolute matches wins (prefers richer chord — maj7 over major
  //      when all 4 maj7 notes are present)
  //   3. simpler quality priority wins (major over sus4 etc.)
  let best: {
    rootPitchClass: number;
    quality: ChordQuality;
    confidence: number;
    matched: number;
    priority: number;
  } = {
    rootPitchClass: 0,
    quality: "major",
    confidence: -1,
    matched: -1,
    priority: Number.POSITIVE_INFINITY,
  };

  for (let root = 0; root < 12; root++) {
    for (const tmpl of CHORD_TEMPLATES) {
      let matched = 0;
      for (const interval of tmpl.intervals) {
        const expected = (root + interval) % 12;
        if (pcSet.has(expected)) matched++;
      }
      const score = matched / tmpl.intervals.length;

      let better = false;
      if (score > best.confidence) {
        better = true;
      } else if (score === best.confidence) {
        if (matched > best.matched) {
          better = true;
        } else if (matched === best.matched && tmpl.priority < best.priority) {
          better = true;
        }
      }

      if (better) {
        best = {
          rootPitchClass: root,
          quality: tmpl.quality,
          confidence: score,
          matched,
          priority: tmpl.priority,
        };
      }
    }
  }

  return {
    rootPitchClass: best.rootPitchClass,
    quality: best.quality,
    confidence: best.confidence < 0 ? 0 : best.confidence,
    pitchClasses,
  };
}

/**
 * Convertit eine HarmonicAnalysisResult zu einem human-readable String.
 * z.B. "C (100%)", "Am (80%)", "G7 (45%)".
 */
export function formatHarmonyResult(result: HarmonicAnalysisResult): string {
  const pc = ((Math.trunc(result.rootPitchClass) % 12) + 12) % 12;
  const rootName = PITCH_CLASS_NAMES[pc] ?? "C";
  const suffix = QUALITY_SHORT[result.quality] ?? "";
  const pct = Math.round(Math.max(0, Math.min(1, result.confidence)) * 100);
  return `${rootName}${suffix} (${pct}%)`;
}
