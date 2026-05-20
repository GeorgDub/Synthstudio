/**
 * client/src/utils/patternMidiExport.ts (v3.173.0)
 *
 * Pure-Helper: konvertiert ein {@link PatternData}-Objekt in eine sortierte
 * Liste von absoluten MIDI-Note-Events. Dient als Foundation für:
 *   - künftige MIDI-File-Export-Pipeline (.mid / SMF)
 *   - MIDI-Out via WebMIDI / Electron-Bridge
 *   - Pattern → DAW-Drag&Drop (MIDI-Clip)
 *
 * Keine Side-Effects, kein AudioEngine-Call, kein DOM. Vollständig deterministisch
 * und damit env:node-testbar.
 *
 * Tick-Mathematik:
 *   ticksPerStep   = ppqn / stepsPerQuarter            (default: 480 / 4 = 120)
 *   totalTicks     = pattern.stepCount * ticksPerStep
 *   ticksPerBar    = totalTicks                         (single-bar patterns)
 *
 * Default-PPQN 480 ist DAW-Standard (Ableton, Logic, Cubase, Pro Tools).
 * Default stepsPerQuarter 4 ergibt 16 Steps pro Bar (klassisches 16th-Note-Grid).
 */
import type { PatternData } from "@/audio/AudioEngine";

// ─── Default GM Drum-Map ─────────────────────────────────────────────────────

/**
 * Default GM-Drum-Map für Part-Indices 0..15.
 *
 *  0 = Kick (C1, 36)
 *  1 = Snare (D1, 38)
 *  2 = Closed Hi-Hat (F#1, 42)
 *  3 = Open Hi-Hat (A#1, 46)
 *  4 = Hand Clap (D#1, 39)
 *  5 = Low Floor Tom (F1, 41)
 *  6 = Low Tom (A1, 45)
 *  7 = High Tom (D2, 50)
 *  8 = Crash Cymbal 1 (C#2, 49)
 *  9 = Ride Cymbal 1 (D#2, 51)
 * 10 = Cowbell (G#2, 56)
 * 11 = Low Conga (E3, 64)
 * 12 = Open Hi Conga (D#3, 63)
 * 13 = Maracas (A#3, 70)
 * 14 = Claves (D#4, 75)
 * 15 = Cabasa (A3, 69)
 */
export const GM_DRUM_MAP: readonly number[] = [
  36, 38, 42, 46, 39, 41, 45, 50, 49, 51, 56, 64, 63, 70, 75, 69,
] as const;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface MidiNoteEvent {
  /** Tick-Position relativ zum Pattern-Start (0..ticksPerBar). */
  tickPos: number;
  /** Tick-Dauer der Note. */
  tickDuration: number;
  /** MIDI-Note-Number (0..127). */
  note: number;
  /** Velocity 1..127. */
  velocity: number;
  /** 0-based Part-Index für Tracking. */
  partIndex: number;
}

export interface MidiExportOptions {
  /** Ticks per quarter note. Default 480 (DAW-Standard). */
  ppqn?: number;
  /** Steps per quarter note. Default 4 (für 16-step Pattern auf 4 Beats). */
  stepsPerQuarter?: number;
  /**
   * Note-Mapping pro Part-Index. Bei undefined oder kürzerem Array
   * fällt der Lookup auf {@link GM_DRUM_MAP} zurück, danach auf 60 (C3).
   */
  partToNoteMap?: number[];
  /** Note-Dauer in Ticks. Default = ticksPerStep (1 Step). */
  noteDurationTicks?: number;
  /** Default-Velocity wenn nicht im Step gesetzt. Default 100. */
  defaultVelocity?: number;
}

export interface MidiExportResult {
  events: MidiNoteEvent[];
  ticksPerBar: number;
  totalTicks: number;
  ppqn: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp auf gültige MIDI-Velocity 1..127 (0 = note-off und damit ungültig). */
function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  const rounded = Math.round(v);
  if (rounded < 1) return 1;
  if (rounded > 127) return 127;
  return rounded;
}

/** Defensive Sanitisierung der numerischen Options. */
function sanitizePpqn(ppqn: number | undefined): number {
  if (typeof ppqn !== "number" || !Number.isFinite(ppqn) || ppqn <= 0) return 480;
  return Math.floor(ppqn);
}

function sanitizeStepsPerQuarter(spq: number | undefined): number {
  if (typeof spq !== "number" || !Number.isFinite(spq) || spq <= 0) return 4;
  return spq;
}

/**
 * Resolve note-number für Part-Index. Reihenfolge:
 *   1. opts.partToNoteMap[partIdx] wenn gültig
 *   2. GM_DRUM_MAP[partIdx] wenn gültig
 *   3. 60 (Middle-C) als Fallback
 */
function resolveNoteForPart(partIdx: number, customMap: number[] | undefined): number {
  if (customMap && partIdx < customMap.length) {
    const n = customMap[partIdx];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 127) {
      return Math.floor(n);
    }
  }
  if (partIdx < GM_DRUM_MAP.length) {
    return GM_DRUM_MAP[partIdx];
  }
  return 60;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Konvertiert PatternData zu einer sortierten Liste von MidiNoteEvents.
 *
 * Sortierung:
 *   1. tickPos ascending
 *   2. partIndex ascending (deterministisches Tie-Breaking)
 *
 * Empty Pattern (keine Parts oder alle Parts ohne aktive Steps) liefert
 * `events: []`, behält aber konsistentes `totalTicks` / `ticksPerBar` /
 * `ppqn` für das verwendete Grid.
 */
export function patternToMidiEvents(
  pattern: PatternData,
  options: MidiExportOptions = {},
): MidiExportResult {
  const ppqn = sanitizePpqn(options.ppqn);
  const stepsPerQuarter = sanitizeStepsPerQuarter(options.stepsPerQuarter);
  const ticksPerStep = ppqn / stepsPerQuarter;
  const noteDurationTicks =
    typeof options.noteDurationTicks === "number" &&
    Number.isFinite(options.noteDurationTicks) &&
    options.noteDurationTicks > 0
      ? options.noteDurationTicks
      : ticksPerStep;
  const defaultVelocity =
    typeof options.defaultVelocity === "number" && Number.isFinite(options.defaultVelocity)
      ? options.defaultVelocity
      : 100;

  const stepCount = pattern.stepCount ?? 16;
  const totalTicks = stepCount * ticksPerStep;

  const events: MidiNoteEvent[] = [];
  const parts = pattern.parts ?? [];

  for (let partIdx = 0; partIdx < parts.length; partIdx++) {
    const part = parts[partIdx];
    if (!part || !Array.isArray(part.steps)) continue;
    const note = resolveNoteForPart(partIdx, options.partToNoteMap);

    for (let stepIdx = 0; stepIdx < part.steps.length; stepIdx++) {
      const step = part.steps[stepIdx];
      if (!step || !step.active) continue;
      const tickPos = stepIdx * ticksPerStep;
      const rawVelocity =
        typeof step.velocity === "number" ? step.velocity : defaultVelocity;
      const velocity = clampVelocity(rawVelocity);
      events.push({
        tickPos,
        tickDuration: noteDurationTicks,
        note,
        velocity,
        partIndex: partIdx,
      });
    }
  }

  events.sort((a, b) => {
    if (a.tickPos !== b.tickPos) return a.tickPos - b.tickPos;
    return a.partIndex - b.partIndex;
  });

  return {
    events,
    ticksPerBar: totalTicks,
    totalTicks,
    ppqn,
  };
}
