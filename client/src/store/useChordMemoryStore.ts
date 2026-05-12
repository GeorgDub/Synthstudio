/**
 * Synthstudio – useChordMemoryStore
 *
 * Chord Memory: Eine einzelne MIDI-Note löst einen ganzen Akkord aus.
 * Akkord-Typen: Dur, Moll, Vermindert, Übermäßig, Dominantseptakkord, etc.
 * Integration: useMidi-Hook, wenn enabled + noteOn → multiple noteOn senden.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-chord-memory:v1";

export type ChordType =
  | "major" | "minor" | "dim" | "aug"
  | "maj7" | "min7" | "dom7" | "dim7"
  | "sus2" | "sus4" | "add9"
  | "power" | "octave";

export interface ChordMemoryState {
  enabled: boolean;
  chordType: ChordType;
  /** Lage (0 = Grundstellung, 1 = 1. Umkehrung, 2 = 2. Umkehrung) */
  voicing: 0 | 1 | 2;
  /** Oktaven-Spread 0–2 */
  spread: number;
}

// Intervalle in Halbtönen ab Grundton
export const CHORD_INTERVALS: Record<ChordType, number[]> = {
  major:  [0, 4, 7],
  minor:  [0, 3, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
  dom7:   [0, 4, 7, 10],
  dim7:   [0, 3, 6, 9],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  add9:   [0, 4, 7, 14],
  power:  [0, 7],
  octave: [0, 12],
};

export const CHORD_LABELS: Record<ChordType, string> = {
  major: "Dur",  minor: "Moll", dim: "Verm", aug: "Überm",
  maj7: "Maj7",  min7: "Min7",  dom7: "Dom7", dim7: "Dim7",
  sus2: "Sus2",  sus4: "Sus4",  add9: "Add9",
  power: "Power", octave: "Okt",
};

/** Berechnet alle MIDI-Noten für einen Akkord. */
export function buildChordNotes(root: number, state: ChordMemoryState): number[] {
  const base = CHORD_INTERVALS[state.chordType];
  let notes = base.map(i => root + i + state.spread * 12);

  // Voicing (Umkehrung)
  for (let v = 0; v < state.voicing; v++) {
    const first = notes.shift();
    if (first !== undefined) notes.push(first + 12);
  }

  return notes.filter(n => n >= 0 && n <= 127);
}

// ─── Store ───────────────────────────────────────────────────────────────────

type Listener = () => void;

function load(): ChordMemoryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { enabled: false, chordType: "major", voicing: 0, spread: 0 };
}

function persist(s: ChordMemoryState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let _state: ChordMemoryState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function setChordMemoryEnabled(enabled: boolean): void {
  _state = { ..._state, enabled };
  persist(_state); notify();
}

export function setChordType(chordType: ChordType): void {
  _state = { ..._state, chordType };
  persist(_state); notify();
}

export function setChordVoicing(voicing: 0 | 1 | 2): void {
  _state = { ..._state, voicing };
  persist(_state); notify();
}

export function setChordSpread(spread: number): void {
  _state = { ..._state, spread: Math.max(0, Math.min(2, spread)) as 0 | 1 | 2 };
  persist(_state); notify();
}

export function getChordMemoryState(): ChordMemoryState { return _state; }

export function useChordMemoryStore(): ChordMemoryState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
