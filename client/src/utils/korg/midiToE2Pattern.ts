/**
 * midiToE2Pattern.ts — MIDI-Datei → E2-Pattern(s), mit Takten.
 *
 * Der bisherige Weg (`src/utils/midiParser.js`, im DrumMachine-Import aktiv)
 * rechnet `step = round(absTick / ticksPerStep) % stepCount`. Das **faltet eine
 * ganze Datei in einen Takt**: Takt 1, 5 und 9 landen auf denselben Steps, und
 * nicht gemappte Noten fallen per `note % parts.length` auf einen beliebigen
 * Part. Beides passiert stillschweigend.
 *
 * Hier bleibt die Position absolut: aus Takt-Bereich und Steps-pro-Pattern
 * folgt, in welches Pattern und auf welchen Step eine Note gehört. Reicht der
 * gewählte Bereich über ein Pattern hinaus, entstehen mehrere Patterns.
 *
 * Zwei Zuordnungs-Arten, weil beides gebraucht wird:
 *  - `"pitch"` (Drums): jede Tonhöhe bekommt ihren eigenen Part. So arbeitet ein
 *    Drum-Set — Kick, Snare und Hat liegen auf verschiedenen Tonhöhen und
 *    müssen auf verschiedene Parts.
 *  - `"track"` (Melodie): jede gewählte Spur wird ein Part, die Tonhöhe wandert
 *    in den Step (`note`). So bleibt eine Basslinie eine Basslinie.
 *
 * **Nichts wird stillschweigend verworfen.** Kollisionen (zwei Noten auf
 * demselben Part und Step) und Überläufe (mehr Tonhöhen/Spuren als die 16 Parts
 * des Geräts) landen im `report`, damit die Oberfläche sie nennen kann.
 *
 * Rein & seiteneffektfrei. Ausgabe ist `E2PatternInput`, also die Form, die
 * `buildE2PatternBody` bereits schreibt — kein zweiter Writer.
 */

import type {
  DetailedMidiFile,
  DetailedMidiNote,
  MidiTimeSignature,
} from "../smfParser";
import type {
  E2PatternInput,
  E2PartInput,
  E2StepInput,
} from "../electribePatternBuilder";

/** Das Gerät rastert 16 Steps auf einen 4/4-Takt. */
export const E2_STEPS_PER_BAR = 16;
/** Genau 16 Parts, hardwareseitig fest. */
export const E2_PARTS = 16;
/** Erlaubte Pattern-Längen. */
export type E2StepLength = 16 | 32 | 64;

export type MidiPartMapping = "pitch" | "track";

export interface MidiToE2Options {
  /** Erster Takt, 1-basiert und inklusive. Vorgabe 1. */
  barFrom?: number;
  /** Letzter Takt, 1-basiert und inklusive. Vorgabe: letzter belegte Takt. */
  barTo?: number;
  /** Steps je Pattern. Vorgabe 16. */
  stepsPerPattern?: E2StepLength;
  /** Zuordnungs-Art. Vorgabe `"pitch"`. */
  mapping?: MidiPartMapping;
  /**
   * Track-Indizes, die berücksichtigt werden. `undefined` = alle.
   * Leeres Array = keine (ergibt leere Patterns, kein Fehler).
   */
  tracks?: number[];
  /** BPM-Vorgabe; sonst das Tempo aus der Datei, sonst 120. */
  bpm?: number;
  /** Namensstamm der erzeugten Patterns. Vorgabe „MIDI". */
  namePrefix?: string;
}

export interface MidiToE2Collision {
  /** 0-basierter Index innerhalb der erzeugten Pattern-Liste. */
  patternIndex: number;
  partIndex: number;
  stepIndex: number;
  /** Die Note, die stehen bleibt (die lautere). */
  keptNote: number;
  /** Die Note, die weichen musste. */
  droppedNote: number;
}

export interface MidiToE2Report {
  /** Tatsächlich ausgewerteter Takt-Bereich (1-basiert, inklusive). */
  barFrom: number;
  barTo: number;
  /** Zahl der erzeugten Patterns. */
  patternCount: number;
  /** Noten, die im Bereich lagen und untergebracht wurden. */
  placedNotes: number;
  /** Noten außerhalb des Takt-Bereichs (bewusst ignoriert, kein Fehler). */
  outOfRangeNotes: number;
  /**
   * Noten, die keinen Part bekamen, weil die 16 Parts belegt waren.
   * Bei `"pitch"`: mehr als 16 verschiedene Tonhöhen. Bei `"track"`: mehr als
   * 16 gewählte Spuren.
   */
  unmappedNotes: number;
  /** Tonhöhen bzw. Spuren, die deswegen ganz herausfielen. */
  unmappedSources: number[];
  /** Zwei Noten auf demselben Part und Step — die leisere wurde verdrängt. */
  collisions: MidiToE2Collision[];
  /** Belegung: Part-Index → Quelle (Tonhöhe bzw. Track-Index). */
  partSources: { partIndex: number; source: number; label: string }[];
  /** Taktart, die zur Rechnung benutzt wurde. */
  timeSignature: MidiTimeSignature;
  /** `false`, wenn 4/4 nur angenommen wurde. */
  timeSignatureFromFile: boolean;
}

export interface MidiToE2Result {
  patterns: E2PatternInput[];
  report: MidiToE2Report;
}

/**
 * Ticks eines Takts.
 *
 * `numerator/denominator` × Viertel je Takt: 4/4 → 4 Viertel, 6/8 → 3 Viertel,
 * 3/4 → 3 Viertel. Ohne diese Rechnung wäre „Takt 3 bis 8" bei allem außer 4/4
 * falsch.
 */
export function ticksPerBar(
  ticksPerQuarterNote: number,
  ts: MidiTimeSignature,
): number {
  const quartersPerBar = (ts.numerator * 4) / ts.denominator;
  return Math.max(1, Math.round(ticksPerQuarterNote * quartersPerBar));
}

/** Zahl der Takte, die die Datei belegt (mindestens 1). */
export function barCount(parsed: DetailedMidiFile): number {
  const tpb = ticksPerBar(parsed.ticksPerQuarterNote, parsed.timeSignature);
  const lastTick = parsed.notes.reduce((m, n) => Math.max(m, n.tick), 0);
  return Math.max(1, Math.floor(lastTick / tpb) + 1);
}

function emptyStep(): E2StepInput {
  return { active: false };
}

function emptyPart(): E2PartInput {
  return { volume: 100, pan: 64, steps: [] };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Rechnet MIDI-Noten in Pattern-Steps um.
 *
 * Kein Modulo auf den Takt: die Position innerhalb des gewählten Bereichs
 * bestimmt Pattern **und** Step. Quantisiert wird auf das Step-Raster
 * (16 Steps je Takt), und zwar durch Runden — eine Note kurz vor dem Schlag
 * gehört auf den Schlag, nicht auf den vorigen Step.
 */
export function midiToE2Patterns(
  parsed: DetailedMidiFile,
  options: MidiToE2Options = {},
): MidiToE2Result {
  const stepsPerPattern = options.stepsPerPattern ?? 16;
  const mapping = options.mapping ?? "pitch";
  const namePrefix = options.namePrefix ?? "MIDI";
  const tpqn = parsed.ticksPerQuarterNote;
  const ts = parsed.timeSignature;
  const tpb = ticksPerBar(tpqn, ts);
  const ticksPerStep = tpb / E2_STEPS_PER_BAR;
  const barsPerPattern = stepsPerPattern / E2_STEPS_PER_BAR;

  const available = barCount(parsed);
  const barFrom = Math.max(1, Math.floor(options.barFrom ?? 1));
  const barTo = Math.max(barFrom, Math.floor(options.barTo ?? available));

  // Track-Filter. `undefined` = alle; ein leeres Array ist eine gültige
  // Auswahl („nichts") und darf nicht als „alles" gedeutet werden.
  const trackFilter = options.tracks;
  const inSelectedTrack = (n: DetailedMidiNote) =>
    trackFilter === undefined || trackFilter.includes(n.trackIndex);

  const rangeStartTick = (barFrom - 1) * tpb;
  const rangeEndTick = barTo * tpb; // exklusiv

  let outOfRangeNotes = 0;
  const relevant: DetailedMidiNote[] = [];
  for (const n of parsed.notes) {
    if (!inSelectedTrack(n)) continue;
    if (n.tick < rangeStartTick || n.tick >= rangeEndTick) {
      outOfRangeNotes++;
      continue;
    }
    relevant.push(n);
  }

  // ── Part-Zuordnung aufbauen ────────────────────────────────────────────────
  // Reihenfolge: nach erstem Auftreten. Das ist die einzige Ordnung, die ein
  // Nutzer nachvollziehen kann — nach Tonhöhe sortiert wäre die Kick nicht
  // zwingend Part 1.
  const sourceOf = (n: DetailedMidiNote) =>
    mapping === "pitch" ? n.note : n.trackIndex;
  const partOfSource = new Map<number, number>();
  const unmappedSources = new Set<number>();
  for (const n of relevant) {
    const src = sourceOf(n);
    if (partOfSource.has(src)) continue;
    if (partOfSource.size < E2_PARTS) partOfSource.set(src, partOfSource.size);
    else unmappedSources.add(src);
  }

  const patternCount = Math.max(
    1,
    Math.ceil((barTo - barFrom + 1) / barsPerPattern),
  );

  // Leeres Raster: patternCount × 16 Parts × stepsPerPattern.
  const grid: (DetailedMidiNote | null)[][][] = [];
  for (let p = 0; p < patternCount; p++) {
    const parts: (DetailedMidiNote | null)[][] = [];
    for (let a = 0; a < E2_PARTS; a++) {
      parts.push(new Array<DetailedMidiNote | null>(stepsPerPattern).fill(null));
    }
    grid.push(parts);
  }

  let placedNotes = 0;
  let unmappedNotes = 0;
  const collisions: MidiToE2Collision[] = [];

  for (const n of relevant) {
    const partIndex = partOfSource.get(sourceOf(n));
    if (partIndex === undefined) {
      unmappedNotes++;
      continue;
    }
    // Absolute Step-Position im gewählten Bereich — hier passiert der
    // eigentliche Unterschied zum alten Weg: kein `% stepCount`.
    const stepAbs = Math.round((n.tick - rangeStartTick) / ticksPerStep);
    const patternIndex = Math.floor(stepAbs / stepsPerPattern);
    const stepIndex = stepAbs % stepsPerPattern;
    if (patternIndex < 0 || patternIndex >= patternCount) {
      // Kann durch Runden am oberen Rand entstehen (Note exakt auf der Grenze).
      outOfRangeNotes++;
      continue;
    }

    const cell = grid[patternIndex][partIndex][stepIndex];
    if (cell === null) {
      grid[patternIndex][partIndex][stepIndex] = n;
      placedNotes++;
    } else {
      // Ein Step trägt genau eine Note. Die lautere gewinnt — bei gleicher
      // Velocity die frühere, damit das Ergebnis reproduzierbar ist.
      const keep = n.velocity > cell.velocity ? n : cell;
      const drop = keep === n ? cell : n;
      grid[patternIndex][partIndex][stepIndex] = keep;
      collisions.push({
        patternIndex, partIndex, stepIndex,
        keptNote: keep.note, droppedNote: drop.note,
      });
    }
  }

  // ── Raster → E2PatternInput ────────────────────────────────────────────────
  const bpm = options.bpm ?? parsed.bpm ?? 120;
  const patterns: E2PatternInput[] = grid.map((parts, p) => {
    const firstBar = barFrom + p * barsPerPattern;
    return {
      name: patternCount > 1 ? `${namePrefix} T${firstBar}` : namePrefix,
      bpm: clampInt(bpm, 20, 300),
      stepLength: stepsPerPattern,
      parts: parts.map(steps => {
        const part = emptyPart();
        part.steps = steps.map(n =>
          n === null
            ? emptyStep()
            : {
                active: true,
                velocity: clampInt(n.velocity, 1, 127),
                // Bei "track"-Zuordnung trägt der Step die Tonhöhe; bei
                // "pitch" ist sie bereits im Part kodiert, deshalb bleibt
                // dort die Gerätevorgabe stehen.
                ...(mapping === "track" ? { note: clampInt(n.note, 0, 127) } : {}),
              },
        );
        return part;
      }),
    };
  });

  const partSources = [...partOfSource.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([source, partIndex]) => ({
      partIndex,
      source,
      label:
        mapping === "pitch"
          ? `Note ${source}`
          : `Spur ${source + 1}${parsed.tracks[source]?.name ? ` (${parsed.tracks[source].name})` : ""}`,
    }));

  return {
    patterns,
    report: {
      barFrom, barTo, patternCount,
      placedNotes, outOfRangeNotes, unmappedNotes,
      unmappedSources: [...unmappedSources].sort((a, b) => a - b),
      collisions, partSources,
      timeSignature: ts,
      timeSignatureFromFile: parsed.timeSignatureFromFile,
    },
  };
}

/**
 * Ein Satz zum Ergebnis — für die Oberfläche, damit sie nicht selbst formuliert.
 * Nennt ausdrücklich, was NICHT übernommen wurde; ein „fertig" ohne diese
 * Angabe war der Kern des alten Problems.
 */
export function describeMidiToE2(report: MidiToE2Report): string {
  const parts: string[] = [];
  parts.push(
    `Takt ${report.barFrom}–${report.barTo} → ${report.patternCount} Pattern, ` +
      `${report.placedNotes} Note(n) übernommen`,
  );
  if (!report.timeSignatureFromFile) {
    parts.push("Taktart 4/4 angenommen (Datei nennt keine)");
  } else if (report.timeSignature.numerator !== 4 || report.timeSignature.denominator !== 4) {
    parts.push(`Taktart ${report.timeSignature.numerator}/${report.timeSignature.denominator}`);
  }
  if (report.outOfRangeNotes > 0) {
    parts.push(`${report.outOfRangeNotes} außerhalb des Bereichs`);
  }
  if (report.unmappedNotes > 0) {
    parts.push(
      `${report.unmappedNotes} ohne Part (mehr als ${E2_PARTS} Quellen: ` +
        `${report.unmappedSources.join(", ")})`,
    );
  }
  if (report.collisions.length > 0) {
    parts.push(`${report.collisions.length} Kollision(en) — leisere Note verdrängt`);
  }
  return parts.join(" · ");
}
