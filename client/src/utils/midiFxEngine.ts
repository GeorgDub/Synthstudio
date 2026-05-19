/**
 * Synthstudio – midiFxEngine.ts (v3.93.0)
 *
 * MIDI-FX Transform-Layer (DAW-Standard). Eingehende Note-On-Events
 * werden durch eine Chain von MidiFxNodes geleitet, bevor sie an die
 * Audio-Engine dispatcht werden.
 *
 * Beispiele für MIDI-FX:
 *   - Scale-Snap        — quantisiert Noten auf die nächste Stufe einer Tonleiter.
 *   - Velocity-Curve    — biegt die Anschlagstärke nicht-linear.
 *   - Octave-Shift      — transponiert das Pitch in Halbtonschritten.
 *   - Chord-Expander    — erzeugt aus 1 Note einen 3-Note-Akkord (Root + 3rd + 5th).
 *   - Note-Repeat       — vervielfältigt 1 Event in N Events mit Timing-Offset.
 *
 * Pure-TS, DOM-frei, Node-testbar. KEIN Audio-Side-Effect.
 *
 * v3.93.0 NEU: Note-Off-Tracking.
 *   Eine MidiFxNoteTracker-Instanz mapped jede Original-Note auf die Liste
 *   der ausgegebenen Notes (Chord-Expander expanded 60 → [60,64,67]; bei
 *   Note-Off auf 60 sollten alle 3 wieder releast werden). API:
 *     - tracker.trackNoteOn(originalNote, channel, fxEvents)
 *     - tracker.consumeNoteOff(originalNote, channel) → expanded NoteOffs
 *   Wird vom useMidi-Hook (Note-On + Note-Off-Handler) verwendet.
 *
 * Caveats:
 *   - Timing-Offsets in Note-Repeat sind in Millisekunden relativ zum
 *     Original-Event. Konsumenten müssen den Offset selbst scheduling-mäßig
 *     anwenden (setTimeout / Tone.Transport / AudioEngine.scheduleNote).
 *   - Nodes mit `bypass: true` werden unverändert durchgereicht.
 *   - Note-Repeat-NoteOffs werden NICHT dupliziert (jede Repeat-Voice
 *     ist eine eigenständige Anschlag-Note mit ADSR-Release am Ende).
 *     Nur Chord-Expander-Voices brauchen explicit Note-Off-Routing.
 */

// ─── Typen ───────────────────────────────────────────────────────────────────

export type MidiScaleName = "major" | "minor" | "penta";

export type VelocityCurveShape = "linear" | "exp" | "log";

export type NoteRepeatRate = "1/8" | "1/16" | "1/32";

export type ChordExpanderType = "major" | "minor" | "7th";

/**
 * Discriminated Union — jeder MidiFx-Node-Typ.
 *
 * `bypass: true` schaltet den Node aus, ohne ihn aus der Chain zu entfernen.
 * `id` ist eine stable UUID/Slug für UI-Rendering.
 */
export type MidiFxNode =
  | {
      id: string;
      kind: "scale-snap";
      bypass?: boolean;
      /** Tonart-Typ (Tonleiter-Konstruktor). */
      scale: MidiScaleName;
      /** Root-Note 0..11 (0 = C, 1 = C#, …). */
      root: number;
    }
  | {
      id: string;
      kind: "velocity-curve";
      bypass?: boolean;
      curve: VelocityCurveShape;
      /** Stärke der Kurve 0..1; 0 = linear (no-op). */
      amount: number;
    }
  | {
      id: string;
      kind: "octave-shift";
      bypass?: boolean;
      /** Halbtöne -24..+24. */
      semitones: number;
    }
  | {
      id: string;
      kind: "chord-expander";
      bypass?: boolean;
      chordType: ChordExpanderType;
    }
  | {
      id: string;
      kind: "note-repeat";
      bypass?: boolean;
      rate: NoteRepeatRate;
      /** Anzahl Repeats 2..8. */
      count: number;
    };

/**
 * Eingangs-Event-Shape für die FX-Chain.
 * `timeOffsetMs` ist 0 für Original-Notes; Note-Repeat addiert hier
 * Offset-Werte. Caller muss das Scheduling übernehmen.
 */
export interface NoteOn {
  note: number;     // 0..127
  velocity: number; // 0..127
  channel: number;  // 1..16
  /** ms-Offset relativ zum Original-Event (Note-Repeat). Default 0. */
  timeOffsetMs?: number;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Maximale Anzahl Nodes in der Chain (UI-Limit + Performance-Schutz). */
export const MAX_MIDI_FX_CHAIN = 6;

/**
 * Scale-Intervalle (Halbtöne vom Root). Pure-Konstanten.
 */
export const SCALE_INTERVALS: Record<MidiScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  penta: [0, 2, 4, 7, 9],
};

/**
 * Chord-Intervalle (Halbtöne vom Root).
 */
export const CHORD_INTERVALS: Record<ChordExpanderType, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  "7th":  [0, 4, 7, 10],
};

/**
 * Rate-zu-Millisekunden bei 120 BPM (Standard-Tempo). Annahme:
 * 1/4 = 500 ms bei 120 BPM. 1/8 = 250 ms, 1/16 = 125 ms, 1/32 = 62.5 ms.
 * Caller, die ein anderes Tempo verwenden, müssen das Resultat skalieren
 * oder den Helper `noteRepeatStepMs(rate, bpm)` nutzen.
 */
export const NOTE_REPEAT_BASE_BPM = 120;

const NOTE_REPEAT_BASE_MS: Record<NoteRepeatRate, number> = {
  "1/8":  250,
  "1/16": 125,
  "1/32": 62.5,
};

// ─── Pure Helpers ────────────────────────────────────────────────────────────

/** Clamping auf [min, max]. NaN/Infinity → fallback. */
function clamp(v: number, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Liefert den Step-ms-Wert für ein gegebenes BPM. */
export function noteRepeatStepMs(rate: NoteRepeatRate, bpm: number): number {
  const safeBpm = clamp(bpm, 20, 300, NOTE_REPEAT_BASE_BPM);
  return (NOTE_REPEAT_BASE_MS[rate] * NOTE_REPEAT_BASE_BPM) / safeBpm;
}

/**
 * Snappt eine Note (0..127) auf die nächstgelegene Stufe der gegebenen
 * Skala in der angegebenen Oktave. Bei Gleichstand wird abgerundet (== nach
 * unten gemappt).
 */
export function snapNoteToScale(
  note: number,
  scale: MidiScaleName,
  root: number,
): number {
  if (!Number.isFinite(note)) return note;
  const intervals = SCALE_INTERVALS[scale];
  if (!intervals || intervals.length === 0) return note;
  const safeRoot = ((Math.round(root) % 12) + 12) % 12;
  const safeNote = Math.round(note);
  // pitch class relative to root
  const pc = ((safeNote - safeRoot) % 12 + 12) % 12;
  // find closest interval
  let bestDelta = Infinity;
  let bestInterval = intervals[0];
  for (const i of intervals) {
    const d = Math.abs(i - pc);
    if (d < bestDelta) {
      bestDelta = d;
      bestInterval = i;
    }
    // also check wrap-around (z.B. pc=11, intervals max=11 in major)
    const wrap = Math.abs((12 - pc) + i);
    if (wrap < bestDelta) {
      bestDelta = wrap;
      // wrap-around heißt: nächste Oktave gleicher Pitch-Class
      bestInterval = i + 12;
    }
  }
  const snapped = safeNote - pc + bestInterval;
  return clamp(snapped, 0, 127, safeNote);
}

/**
 * Wendet eine Velocity-Curve auf den Wert (0..127) an.
 * - linear:  unverändert (amount irrelevant)
 * - exp:     v' = v^(1 + amount*2)   — drückt leise Werte stärker runter
 *            (= "schwerere" Anschlagsdynamik)
 * - log:     v' = v^(1 / (1 + amount*2)) — hebt leise Werte an
 *            (= "leichtere" Anschlagsdynamik)
 *
 * `amount` 0..1 — 0 = no-op. Werte außerhalb werden geclamped.
 */
export function applyVelocityCurve(
  velocity: number,
  curve: VelocityCurveShape,
  amount: number,
): number {
  if (!Number.isFinite(velocity)) return velocity;
  const v = clamp(velocity, 0, 127, 0);
  if (curve === "linear" || amount <= 0) return Math.round(v);
  const a = clamp(amount, 0, 1, 0);
  const norm = v / 127;
  let out: number;
  if (curve === "exp") {
    out = Math.pow(norm, 1 + a * 2);
  } else {
    // log
    out = Math.pow(norm, 1 / (1 + a * 2));
  }
  return clamp(Math.round(out * 127), 0, 127, 0);
}

/**
 * Wendet einen einzelnen MidiFxNode auf eine Liste von NoteOn-Events an.
 * Liefert die transformierte Event-Liste. Pure-Funktion — modifiziert keine
 * Eingabe-Objekte.
 */
export function applyMidiFxNode(
  node: MidiFxNode,
  events: readonly NoteOn[],
): NoteOn[] {
  if (node.bypass) return events.map((e) => ({ ...e }));

  switch (node.kind) {
    case "scale-snap": {
      return events.map((e) => ({
        ...e,
        note: snapNoteToScale(e.note, node.scale, node.root),
      }));
    }

    case "velocity-curve": {
      return events.map((e) => ({
        ...e,
        velocity: applyVelocityCurve(e.velocity, node.curve, node.amount),
      }));
    }

    case "octave-shift": {
      const shift = clamp(node.semitones, -24, 24, 0);
      return events.map((e) => ({
        ...e,
        note: clamp(e.note + shift, 0, 127, e.note),
      }));
    }

    case "chord-expander": {
      const intervals = CHORD_INTERVALS[node.chordType] ?? CHORD_INTERVALS.major;
      const out: NoteOn[] = [];
      for (const e of events) {
        for (const interval of intervals) {
          const targetNote = clamp(e.note + interval, 0, 127, e.note);
          out.push({ ...e, note: targetNote });
        }
      }
      return out;
    }

    case "note-repeat": {
      const count = clamp(node.count, 2, 8, 2);
      const stepMs = noteRepeatStepMs(node.rate, NOTE_REPEAT_BASE_BPM);
      const out: NoteOn[] = [];
      for (const e of events) {
        const baseOffset = e.timeOffsetMs ?? 0;
        for (let i = 0; i < count; i++) {
          out.push({ ...e, timeOffsetMs: baseOffset + i * stepMs });
        }
      }
      return out;
    }

    default: {
      // exhaustiveness — sollte nie hier landen
      const _exhaustive: never = node;
      void _exhaustive;
      return events.map((e) => ({ ...e }));
    }
  }
}

/**
 * Wendet eine ganze MIDI-FX-Chain sequenziell auf ein Note-On-Event an.
 * Liefert die finale Event-Liste (1..N Events).
 *
 * Order matters — z.B. `octave-shift → scale-snap` snappt nach dem Pitch-Shift,
 * während `scale-snap → octave-shift` zuerst snappt und dann shifted.
 *
 * Hartes Limit: maximal `MAX_MIDI_FX_CHAIN` Nodes werden ausgewertet
 * (defensive — UI-Layer enforced das gleiche Limit beim Add).
 */
export function applyMidiFx(
  noteOn: NoteOn,
  chain: readonly MidiFxNode[],
): NoteOn[] {
  if (!chain || chain.length === 0) return [{ ...noteOn }];
  let events: NoteOn[] = [{ ...noteOn }];
  const cap = Math.min(chain.length, MAX_MIDI_FX_CHAIN);
  for (let i = 0; i < cap; i++) {
    events = applyMidiFxNode(chain[i], events);
    // defensive: explodiert die Chain z.B. durch Repeat × Chord, capped wir
    // bei einer Obergrenze um runaway-Output zu verhindern.
    if (events.length > 256) {
      events = events.slice(0, 256);
      break;
    }
  }
  return events;
}

// ─── Note-Off Tracking (v3.93.0) ─────────────────────────────────────────────

/**
 * Repräsentiert einen aktiven Output (eine vom FX-Chain ausgegebene Note,
 * die noch nicht released wurde).
 */
export interface ExpandedNoteOff {
  note: number;
  channel: number;
}

/**
 * Hält für jede aktive Original-Note (key = "channel:note") die Liste der
 * vom FX-Chain ausgegebenen Notes. Bei Note-Off wird die ganze Liste in
 * einem Schritt released.
 *
 * Note-Repeat-Voices werden NICHT getracked (jeder Repeat hat seinen eigenen
 * Anschlag + ADSR-Release am Ende der Sample-Length — wir würden sonst
 * verfrüht abschneiden). Nur Chord-Expander + Pitch-shifted-Voices brauchen
 * Note-Off-Routing.
 *
 * API ist defensiv: doppeltes trackNoteOn überschreibt, consumeNoteOff
 * ohne vorheriges trackNoteOn liefert leeres Array (kein Crash).
 */
export class MidiFxNoteTracker {
  private _map: Map<string, ExpandedNoteOff[]> = new Map();

  private static keyFor(channel: number, note: number): string {
    return `${channel | 0}:${note | 0}`;
  }

  /**
   * Speichert die Output-Notes für eine Original-Note. Wenn `fxEvents` keine
   * Expansion enthält (1 Event mit gleicher Note + 0 timeOffsetMs), wird KEIN
   * Eintrag gemacht — der Note-Off-Handler im Caller routet dann den Original-
   * Note-Off direkt durch.
   *
   * Note-Repeat-Voices (timeOffsetMs > 0) werden ausgeschlossen — sie haben
   * ihren eigenen Release-Trigger im Sample-Tail.
   *
   * Returnt die Anzahl tracked outputs.
   */
  public trackNoteOn(
    originalNote: number,
    channel: number,
    fxEvents: readonly NoteOn[],
  ): number {
    if (!fxEvents || fxEvents.length === 0) return 0;
    // Filter: nur t=0 Events (kein Note-Repeat-Tail) tracken.
    // Doppelte Noten (z.B. Chord-Expander + Octave-Shift Überschneidung)
    // werden dedupliziert per (channel, note).
    const seen = new Set<string>();
    const tracked: ExpandedNoteOff[] = [];
    for (const ev of fxEvents) {
      const offset = ev.timeOffsetMs ?? 0;
      if (offset > 0) continue;
      const k = `${ev.channel | 0}:${ev.note | 0}`;
      if (seen.has(k)) continue;
      seen.add(k);
      tracked.push({ note: ev.note | 0, channel: ev.channel | 0 });
    }
    // Wenn das Ergebnis === Original-Event (kein Expand, keine Pitch-Änderung),
    // brauchen wir keinen Track — der Caller hat eh den Original-Note-Off.
    if (
      tracked.length === 1 &&
      tracked[0].note === (originalNote | 0) &&
      tracked[0].channel === (channel | 0)
    ) {
      // Egal — keine Expansion, also auch keine Note-Off-Map-Last.
      // Trotzdem speichern? Nein — sonst wächst die Map unbegrenzt.
      return 0;
    }
    if (tracked.length === 0) return 0;
    this._map.set(MidiFxNoteTracker.keyFor(channel, originalNote), tracked);
    return tracked.length;
  }

  /**
   * Liefert die Liste der ausgegebenen Output-Notes für eine Original-Note
   * und entfernt den Eintrag. Bei nicht-getrackter Note liefert ein leeres
   * Array.
   */
  public consumeNoteOff(
    originalNote: number,
    channel: number,
  ): ExpandedNoteOff[] {
    const key = MidiFxNoteTracker.keyFor(channel, originalNote);
    const list = this._map.get(key);
    if (!list) return [];
    this._map.delete(key);
    return list;
  }

  /** Anzahl aktive (gehaltene) Notes — primär für Tests. */
  public get size(): number {
    return this._map.size;
  }

  /** Leert den Tracker — z.B. bei Panic-Stop oder MIDI-Device-Wechsel. */
  public clear(): void {
    this._map.clear();
  }
}
