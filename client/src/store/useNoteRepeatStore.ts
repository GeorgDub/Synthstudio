/**
 * Synthstudio – useNoteRepeatStore
 *
 * Globaler Zustand für Note-Repeat: aktiv/inaktiv + ausgewählte Rate.
 * Modul-Singleton-Pattern, localStorage-Persistenz.
 */
import { useState, useCallback, useEffect } from "react";
import type { NoteRepeatRate } from "../utils/noteRepeat";
import { NOTE_REPEAT_RATES } from "../utils/noteRepeat";

const STORAGE_KEY_ENABLED = "ss-note-repeat-enabled";
const STORAGE_KEY_RATE    = "ss-note-repeat-rate";
const DEFAULT_RATE: NoteRepeatRate = "1/16";

const VALID_RATES = new Set(NOTE_REPEAT_RATES.map((r) => r.rate));

let _enabled = false;
let _rate: NoteRepeatRate = DEFAULT_RATE;

type Snapshot = { enabled: boolean; rate: NoteRepeatRate };
const _listeners = new Set<(snap: Snapshot) => void>();

function _readFromStorage(): Snapshot {
  let enabled = false;
  let rate: NoteRepeatRate = DEFAULT_RATE;
  try {
    enabled = localStorage.getItem(STORAGE_KEY_ENABLED) === "1";
    const r = localStorage.getItem(STORAGE_KEY_RATE);
    if (r && VALID_RATES.has(r as NoteRepeatRate)) {
      rate = r as NoteRepeatRate;
    }
  } catch {
    // localStorage nicht verfügbar
  }
  return { enabled, rate };
}

function _writeToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY_ENABLED, _enabled ? "1" : "0");
    localStorage.setItem(STORAGE_KEY_RATE, _rate);
  } catch {
    // ignore
  }
}

function _notify(): void {
  const snap: Snapshot = { enabled: _enabled, rate: _rate };
  _listeners.forEach((fn) => fn(snap));
}

const initial = _readFromStorage();
_enabled = initial.enabled;
_rate = initial.rate;

// ─── Exportierte Logik-Funktionen ─────────────────────────────────────────────

export function isNoteRepeatEnabled(): boolean {
  return _enabled;
}

export function getNoteRepeatRate(): NoteRepeatRate {
  return _rate;
}

export function setNoteRepeatEnabled(enabled: boolean): void {
  if (_enabled === enabled) return;
  _enabled = enabled;
  _writeToStorage();
  _notify();
}

export function toggleNoteRepeat(): void {
  setNoteRepeatEnabled(!_enabled);
}

export function setNoteRepeatRate(rate: NoteRepeatRate): void {
  if (!VALID_RATES.has(rate)) return;
  if (_rate === rate) return;
  _rate = rate;
  _writeToStorage();
  _notify();
}

export function __resetForTests(): void {
  _enabled = false;
  _rate = DEFAULT_RATE;
  try {
    localStorage.removeItem(STORAGE_KEY_ENABLED);
    localStorage.removeItem(STORAGE_KEY_RATE);
  } catch {
    // ignore
  }
  _notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export interface NoteRepeatStoreApi {
  enabled: boolean;
  rate: NoteRepeatRate;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  setRate: (rate: NoteRepeatRate) => void;
}

export function useNoteRepeatStore(): NoteRepeatStoreApi {
  const [snap, setSnap] = useState<Snapshot>({ enabled: _enabled, rate: _rate });

  useEffect(() => {
    const handler = (s: Snapshot) => setSnap({ ...s });
    _listeners.add(handler);
    return () => { _listeners.delete(handler); };
  }, []);

  const setEnabled = useCallback((e: boolean) => setNoteRepeatEnabled(e), []);
  const toggle = useCallback(() => toggleNoteRepeat(), []);
  const setRate = useCallback((r: NoteRepeatRate) => setNoteRepeatRate(r), []);

  return { enabled: snap.enabled, rate: snap.rate, setEnabled, toggle, setRate };
}
