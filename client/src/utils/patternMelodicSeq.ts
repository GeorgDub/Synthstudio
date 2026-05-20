/**
 * Synthstudio – patternMelodicSeq.ts (v3.183.0)
 *
 * Melodic Sequence Generator: pure Helpers, die aus einem
 * Rhythmus-Pattern + Scale + Strategie eine melodische
 * MIDI-Note-Sequenz produzieren.
 *
 * Public Surface:
 *  - generateMelodicSequence: Hauptfunktion, liefert MelodicNote[]
 *  - MELODIC_STRATEGY_LABELS: human-readable Strategie-Labels
 *
 * Determinismus via mulberry32 (inline, kein Cross-Util-Import).
 * Eingaben werden nicht mutiert.
 */

import { SCALE_INTERVALS, type ScaleType } from "@/utils/randomChordGenerator";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type MelodicStrategy =
  | "ascending"      // Notes steigen schrittweise
  | "descending"     // Notes fallen
  | "alternating"    // Up-Down-Up-Down
  | "random"         // PRNG-based
  | "stepwise"       // Bevorzugt step-wise motion (±2 semitones)
  | "arpeggio";      // Folgt Chord-Arpeggio

export interface MelodicSeqOptions {
  rhythmPattern?: readonly boolean[];
  scale?: ScaleType;
  rootMidi?: number;
  strategy?: MelodicStrategy;
  /** Octave-Range. Default 1 (1 octave). */
  octaveRange?: number;
  /** PRNG-Seed. Default 1. */
  seed?: number;
}

export interface MelodicNote {
  /** Step-Index im Pattern. */
  stepIndex: number;
  /** MIDI-Note-Number. */
  midi: number;
  /** Velocity 1..127. Default 100. */
  velocity: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MELODIC_STRATEGY_LABELS: Record<MelodicStrategy, string> = {
  ascending:   "Ascending",
  descending:  "Descending",
  alternating: "Alternating (UpDown)",
  random:      "Random",
  stepwise:    "Stepwise",
  arpeggio:    "Arpeggio (Root-3rd-5th)",
};

const VALID_STRATEGIES: ReadonlySet<MelodicStrategy> = new Set<MelodicStrategy>([
  "ascending",
  "descending",
  "alternating",
  "random",
  "stepwise",
  "arpeggio",
]);

const DEFAULT_RHYTHM: readonly boolean[] = (() => {
  // [true,false,false,false] repeated 4x = 16 steps
  const out: boolean[] = [];
  for (let i = 0; i < 16; i++) out.push(i % 4 === 0);
  return out;
})();

// Chord-Tone-Indices (relative scale-degrees) für Arpeggio: root, third, fifth.
const ARPEGGIO_DEGREES: readonly number[] = [0, 2, 4];

// ─── PRNG: mulberry32 (inline) ────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = Number.isFinite(seed) ? Math.floor(seed) | 0 : 1;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Sanitizers ───────────────────────────────────────────────────────────────

function sanitizeRoot(midi: number | undefined): number {
  if (midi === undefined) return 60;
  if (!Number.isFinite(midi)) return 60;
  if (midi < 0 || midi > 127) return 60;
  return Math.floor(midi);
}

function sanitizeScale(scale: ScaleType | undefined): ScaleType {
  if (scale && scale in SCALE_INTERVALS) return scale;
  return "major";
}

function sanitizeOctaveRange(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value)) return 1;
  const n = Math.floor(value);
  if (n < 1) return 1;
  if (n > 3) return 3;
  return n;
}

function sanitizeStrategy(strategy: MelodicStrategy | undefined): MelodicStrategy {
  if (strategy && VALID_STRATEGIES.has(strategy)) return strategy;
  return "ascending";
}

function clampMidi(n: number): number {
  if (n < 0) return 0;
  if (n > 127) return 127;
  return Math.floor(n);
}

function clampVelocity(n: number): number {
  if (!Number.isFinite(n)) return 100;
  const v = Math.floor(n);
  if (v < 1) return 1;
  if (v > 127) return 127;
  return v;
}

/**
 * Wandelt eine "scale-degree" (kann auch >= scaleLen sein) in MIDI um.
 * Beruecksichtigt Octave-Wrap, sodass z.B. degree=7 in einer 7-noten-Scale
 * eine Oktave hoeher ist als degree=0.
 */
function degreeToMidi(
  degree: number,
  rootMidi: number,
  scaleIntervals: readonly number[],
): number {
  const scaleLen = scaleIntervals.length;
  const safeDegree = degree < 0 ? 0 : degree;
  const wrapped = safeDegree % scaleLen;
  const octaveShift = Math.floor(safeDegree / scaleLen);
  const midi = rootMidi + scaleIntervals[wrapped] + octaveShift * 12;
  return clampMidi(midi);
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

/**
 * Generiert eine melodische Sequenz auf Basis eines Rhythmus-Patterns,
 * einer Scale und einer Strategie. Deterministisch via seed.
 */
export function generateMelodicSequence(
  options: MelodicSeqOptions = {},
): MelodicNote[] {
  const rhythmPattern = options.rhythmPattern ?? DEFAULT_RHYTHM;
  if (rhythmPattern.length === 0) return [];

  const scale = sanitizeScale(options.scale);
  const rootMidi = sanitizeRoot(options.rootMidi);
  const strategy = sanitizeStrategy(options.strategy);
  const octaveRange = sanitizeOctaveRange(options.octaveRange);
  const seed = Number.isFinite(options.seed) ? (options.seed as number) : 1;

  const scaleIntervals = SCALE_INTERVALS[scale];
  const scaleLen = scaleIntervals.length;
  // Insgesamte Scale-Degrees ueber alle Octaves.
  const totalDegrees = scaleLen * octaveRange;

  // Sammle aktive Step-Indices
  const activeSteps: number[] = [];
  for (let i = 0; i < rhythmPattern.length; i++) {
    if (rhythmPattern[i]) activeSteps.push(i);
  }
  if (activeSteps.length === 0) return [];

  const rng = makeRng(seed);
  const out: MelodicNote[] = [];

  let prevDegree = 0; // fuer "stepwise"

  for (let i = 0; i < activeSteps.length; i++) {
    const stepIndex = activeSteps[i];
    let degree = 0;

    switch (strategy) {
      case "ascending": {
        // jeder aktive Step inkrementiert die Scale-Degree
        degree = i % totalDegrees;
        break;
      }
      case "descending": {
        // vom hoechsten Punkt absteigend
        degree = (totalDegrees - 1) - (i % totalDegrees);
        if (degree < 0) degree = 0;
        break;
      }
      case "alternating": {
        // up-down-up-down: 0, totalDegrees-1, 1, totalDegrees-2, ...
        const half = Math.floor(i / 2);
        if (i % 2 === 0) {
          degree = half % totalDegrees;
        } else {
          let d = (totalDegrees - 1) - half;
          if (d < 0) d = ((d % totalDegrees) + totalDegrees) % totalDegrees;
          degree = d;
        }
        break;
      }
      case "random": {
        degree = Math.floor(rng() * totalDegrees) % totalDegrees;
        break;
      }
      case "stepwise": {
        if (i === 0) {
          degree = 0;
        } else {
          // ±1 oder ±2 vom vorherigen, kleiner random factor
          const r = rng();
          let stepSize: number;
          if (r < 0.4) stepSize = 1;
          else if (r < 0.7) stepSize = -1;
          else if (r < 0.85) stepSize = 2;
          else stepSize = -2;
          let next = prevDegree + stepSize;
          // Reflect-in-Bounds [0, totalDegrees-1]
          if (next < 0) next = -next;
          if (next > totalDegrees - 1) {
            next = (totalDegrees - 1) - (next - (totalDegrees - 1));
          }
          if (next < 0) next = 0;
          if (next > totalDegrees - 1) next = totalDegrees - 1;
          degree = next;
        }
        prevDegree = degree;
        break;
      }
      case "arpeggio": {
        // Iteriere durch ARPEGGIO_DEGREES, mit Octave-Cycling
        const arpIndex = i % ARPEGGIO_DEGREES.length;
        const octCycle = Math.floor(i / ARPEGGIO_DEGREES.length) % octaveRange;
        degree = ARPEGGIO_DEGREES[arpIndex] + octCycle * scaleLen;
        if (degree >= totalDegrees) degree = degree % totalDegrees;
        break;
      }
    }

    const midi = degreeToMidi(degree, rootMidi, scaleIntervals);

    // Velocity: 100 +/- kleines Humanize (deterministisch via rng)
    const humanize = Math.floor((rng() - 0.5) * 20); // -10..+9
    const velocity = clampVelocity(100 + humanize);

    out.push({ stepIndex, midi, velocity });
  }

  return out;
}
