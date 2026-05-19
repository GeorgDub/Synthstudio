/**
 * Synthstudio – useMidiClickStore (v3.98.0)
 *
 * Custom Observer Store fuer MIDI-Click-Track-Output-Config. Sendet pro Beat
 * eine MIDI-Note an externe Hardware (KORG Volca, Drum-Machine) — paralleler
 * Sync-Punkt zum lokalen Metronom.
 *
 * Persistenz: localStorage, NICHT im .synth-Schema (analog clockOut). Ist
 * eine User-Preference / Hardware-Setup-Sache, gehoert nicht ins Projekt.
 * localStorage-Key: `synthstudio:midi:clickout:v1` (interne Schema-v1).
 *
 * Pattern: Modul-Singleton + Hook (analog useMidiNoteOutStore).
 */
import { useEffect, useReducer } from "react";
import {
  clampClickChannel,
  clampClickNote,
  clampClickVelocity,
  clampNoteDurationMs,
  clampCountInBars,
  DEFAULT_ACCENT_NOTE,
  DEFAULT_ACCENT_VELOCITY,
  DEFAULT_BEAT_NOTE,
  DEFAULT_BEAT_VELOCITY,
  DEFAULT_CLICK_CHANNEL,
  DEFAULT_CLICK_NOTE_DURATION_MS,
  DEFAULT_COUNT_IN_BARS,
} from "../audio/MidiClickOut";

const STORAGE_KEY = "synthstudio:midi:clickout:v1";

export interface MidiClickStoreState {
  enabled: boolean;
  outputDeviceId: string | null;
  channel: number;          // 0..15 (default 9 = MIDI-Ch 10)
  accentNote: number;       // 0..127 (default 76 = High Wood Block)
  beatNote: number;         // 0..127 (default 77 = Low Wood Block)
  velocityAccent: number;   // 0..127
  velocityBeat: number;     // 0..127
  // v3.99.0:
  noteDurationMs: number;   // 10..500 (default 50)
  countInEnabled: boolean;  // pre-roll Click-Bars vor Play
  countInBars: number;      // 1..4 (default 1)
}

function defaultState(): MidiClickStoreState {
  return {
    enabled: false,
    outputDeviceId: null,
    channel: DEFAULT_CLICK_CHANNEL,
    accentNote: DEFAULT_ACCENT_NOTE,
    beatNote: DEFAULT_BEAT_NOTE,
    velocityAccent: DEFAULT_ACCENT_VELOCITY,
    velocityBeat: DEFAULT_BEAT_VELOCITY,
    noteDurationMs: DEFAULT_CLICK_NOTE_DURATION_MS,
    countInEnabled: false,
    countInBars: DEFAULT_COUNT_IN_BARS,
  };
}

function loadState(): MidiClickStoreState {
  if (typeof localStorage === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<MidiClickStoreState> | null;
    if (!parsed || typeof parsed !== "object") return defaultState();
    const d = defaultState();
    return {
      enabled: parsed.enabled === true,
      outputDeviceId: typeof parsed.outputDeviceId === "string" && parsed.outputDeviceId.length > 0
        ? parsed.outputDeviceId
        : null,
      channel: typeof parsed.channel === "number" ? clampClickChannel(parsed.channel) : d.channel,
      accentNote: typeof parsed.accentNote === "number" ? clampClickNote(parsed.accentNote) : d.accentNote,
      beatNote: typeof parsed.beatNote === "number" ? clampClickNote(parsed.beatNote) : d.beatNote,
      velocityAccent: typeof parsed.velocityAccent === "number" ? clampClickVelocity(parsed.velocityAccent) : d.velocityAccent,
      velocityBeat: typeof parsed.velocityBeat === "number" ? clampClickVelocity(parsed.velocityBeat) : d.velocityBeat,
      noteDurationMs: typeof parsed.noteDurationMs === "number" ? clampNoteDurationMs(parsed.noteDurationMs) : d.noteDurationMs,
      countInEnabled: parsed.countInEnabled === true,
      countInBars: typeof parsed.countInBars === "number" ? clampCountInBars(parsed.countInBars) : d.countInBars,
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: MidiClickStoreState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

let _state: MidiClickStoreState = loadState();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach(l => l());
}

// ─── Public Actions ───────────────────────────────────────────────────────────

export function getMidiClickState(): MidiClickStoreState {
  return _state;
}

export function setMidiClickEnabled(enabled: boolean): void {
  if (_state.enabled === enabled) return;
  _state = { ..._state, enabled };
  saveState(_state);
  notify();
}

export function setMidiClickOutputDevice(outputDeviceId: string | null): void {
  const normalized = outputDeviceId && outputDeviceId.length > 0 ? outputDeviceId : null;
  if (_state.outputDeviceId === normalized) return;
  _state = { ..._state, outputDeviceId: normalized };
  saveState(_state);
  notify();
}

export function setMidiClickChannel(channel: number): void {
  const next = clampClickChannel(channel);
  if (_state.channel === next) return;
  _state = { ..._state, channel: next };
  saveState(_state);
  notify();
}

export function setMidiClickAccentNote(note: number): void {
  const next = clampClickNote(note);
  if (_state.accentNote === next) return;
  _state = { ..._state, accentNote: next };
  saveState(_state);
  notify();
}

export function setMidiClickBeatNote(note: number): void {
  const next = clampClickNote(note);
  if (_state.beatNote === next) return;
  _state = { ..._state, beatNote: next };
  saveState(_state);
  notify();
}

export function setMidiClickVelocityAccent(velocity: number): void {
  const next = clampClickVelocity(velocity);
  if (_state.velocityAccent === next) return;
  _state = { ..._state, velocityAccent: next };
  saveState(_state);
  notify();
}

export function setMidiClickVelocityBeat(velocity: number): void {
  const next = clampClickVelocity(velocity);
  if (_state.velocityBeat === next) return;
  _state = { ..._state, velocityBeat: next };
  saveState(_state);
  notify();
}

/** v3.99.0: Note-Duration (ms) — 10..500 (default 50). */
export function setMidiClickNoteDurationMs(ms: number): void {
  const next = clampNoteDurationMs(ms);
  if (_state.noteDurationMs === next) return;
  _state = { ..._state, noteDurationMs: next };
  saveState(_state);
  notify();
}

/** v3.99.0: Count-In aktivieren / deaktivieren. */
export function setMidiClickCountInEnabled(enabled: boolean): void {
  if (_state.countInEnabled === enabled) return;
  _state = { ..._state, countInEnabled: enabled };
  saveState(_state);
  notify();
}

/** v3.99.0: Anzahl Pre-Roll-Bars (1..4). */
export function setMidiClickCountInBars(bars: number): void {
  const next = clampCountInBars(bars);
  if (_state.countInBars === next) return;
  _state = { ..._state, countInBars: next };
  saveState(_state);
  notify();
}

/**
 * Bulk-Setter — z.B. fuer Schema-Round-Trip-Restore. Validiert/clampt jedes
 * Feld, fehlende Felder bleiben beim aktuellen Wert.
 */
export function setMidiClickState(partial: Partial<MidiClickStoreState>): void {
  const d = _state;
  _state = {
    enabled: typeof partial.enabled === "boolean" ? partial.enabled : d.enabled,
    outputDeviceId: partial.outputDeviceId !== undefined
      ? (typeof partial.outputDeviceId === "string" && partial.outputDeviceId.length > 0
          ? partial.outputDeviceId
          : null)
      : d.outputDeviceId,
    channel: typeof partial.channel === "number" ? clampClickChannel(partial.channel) : d.channel,
    accentNote: typeof partial.accentNote === "number" ? clampClickNote(partial.accentNote) : d.accentNote,
    beatNote: typeof partial.beatNote === "number" ? clampClickNote(partial.beatNote) : d.beatNote,
    velocityAccent: typeof partial.velocityAccent === "number" ? clampClickVelocity(partial.velocityAccent) : d.velocityAccent,
    velocityBeat: typeof partial.velocityBeat === "number" ? clampClickVelocity(partial.velocityBeat) : d.velocityBeat,
    noteDurationMs: typeof partial.noteDurationMs === "number" ? clampNoteDurationMs(partial.noteDurationMs) : d.noteDurationMs,
    countInEnabled: typeof partial.countInEnabled === "boolean" ? partial.countInEnabled : d.countInEnabled,
    countInBars: typeof partial.countInBars === "number" ? clampCountInBars(partial.countInBars) : d.countInBars,
  };
  saveState(_state);
  notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export function useMidiClickStore(): MidiClickStoreState {
  const [, rerender] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

// ─── Test Helper ──────────────────────────────────────────────────────────────

export function __resetMidiClickStoreForTests(): void {
  _state = defaultState();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }
}
