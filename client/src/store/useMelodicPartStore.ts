/**
 * Synthstudio – useMelodicPartStore.ts
 *
 * State-Management für den Piano Roll / Melodic Step Sequencer (Phase 2, v1.9).
 * Muster: Modul-Singleton + React useState/useCallback (analog zu useThemeStore).
 * Persistenz: sessionStorage (Piano Roll ist flüchtig – nur pro Session).
 * Kein externer State-Manager.
 */
import { useState, useCallback, useEffect } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface PitchStep {
  active: boolean;
  note: number;      // MIDI-Noten-Nummer (48–71 = C3–B4)
  velocity: number;  // 0–127 (MIDI-Standard)
}

export interface MelodicPattern {
  partId: string;
  steps: PitchStep[];  // immer 16 Einträge
  baseNote: number;    // Grundton des Parts (Standard: 60 = C4)
}

export interface MelodicPartState {
  patterns: Record<string, MelodicPattern>;
}

export interface MelodicPartActions {
  setNote: (partId: string, stepIdx: number, note: number) => void;
  toggleStep: (partId: string, stepIdx: number) => void;
  setVelocity: (partId: string, stepIdx: number, velocity: number) => void;
  setBaseNote: (partId: string, note: number) => void;
  clearPart: (partId: string) => void;
  getPattern: (partId: string) => MelodicPattern | undefined;
  initPart: (partId: string) => void;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-melodic-patterns";
const DEFAULT_BASE_NOTE = 60; // C4
const STEP_COUNT = 16;

// ─── Modul-Singleton ──────────────────────────────────────────────────────────

let _patterns: Record<string, MelodicPattern> = {};
const _listeners = new Set<(patterns: Record<string, MelodicPattern>) => void>();

// ─── Interne Hilfsfunktionen ─────────────────────────────────────────────────

function _defaultStep(baseNote: number): PitchStep {
  return { active: false, note: baseNote, velocity: 100 };
}

function _makePattern(partId: string, baseNote: number = DEFAULT_BASE_NOTE): MelodicPattern {
  return {
    partId,
    steps: Array.from({ length: STEP_COUNT }, () => _defaultStep(baseNote)),
    baseNote,
  };
}

function _readFromStorage(): Record<string, MelodicPattern> {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as Record<string, MelodicPattern>;
    }
  } catch {
    // sessionStorage nicht verfügbar (Node.js / Test-Umgebung)
  }
  return {};
}

function _writeToStorage(patterns: Record<string, MelodicPattern>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(patterns));
  } catch {
    // sessionStorage nicht verfügbar
  }
}

function _notify(): void {
  const snapshot = { ..._patterns };
  _listeners.forEach((fn) => fn(snapshot));
}

// Beim Modul-Load aus sessionStorage wiederherstellen
_patterns = _readFromStorage();

// ─── Exportierte Logik-Funktionen (testbar ohne React) ────────────────────────

/** Initialisiert einen Part mit 16 leeren Steps. Kein-Op, wenn Part schon existiert. */
export function initPart(partId: string, baseNote: number = DEFAULT_BASE_NOTE): void {
  if (_patterns[partId]) return;
  _patterns = { ..._patterns, [partId]: _makePattern(partId, baseNote) };
  _writeToStorage(_patterns);
  _notify();
}

/** Schaltet den active-Zustand eines Steps um. Initialisiert den Part implizit. */
export function toggleStep(partId: string, stepIdx: number): void {
  if (!_patterns[partId]) initPart(partId);
  const pattern = _patterns[partId];
  const steps = pattern.steps.map((s, i) =>
    i === stepIdx ? { ...s, active: !s.active } : s,
  );
  _patterns = { ..._patterns, [partId]: { ...pattern, steps } };
  _writeToStorage(_patterns);
  _notify();
}

/** Setzt die MIDI-Note eines Steps und aktiviert ihn. Initialisiert den Part implizit. */
export function setNote(partId: string, stepIdx: number, note: number): void {
  if (!_patterns[partId]) initPart(partId);
  const pattern = _patterns[partId];
  const steps = pattern.steps.map((s, i) =>
    i === stepIdx ? { ...s, note, active: true } : s,
  );
  _patterns = { ..._patterns, [partId]: { ...pattern, steps } };
  _writeToStorage(_patterns);
  _notify();
}

/** Setzt die Velocity eines Steps (geclampt auf 0–127). Initialisiert den Part implizit. */
export function setVelocity(partId: string, stepIdx: number, velocity: number): void {
  if (!_patterns[partId]) initPart(partId);
  const pattern = _patterns[partId];
  const clamped = Math.max(0, Math.min(127, velocity));
  const steps = pattern.steps.map((s, i) =>
    i === stepIdx ? { ...s, velocity: clamped } : s,
  );
  _patterns = { ..._patterns, [partId]: { ...pattern, steps } };
  _writeToStorage(_patterns);
  _notify();
}

/** Setzt den Grundton des Parts. Initialisiert den Part implizit. */
export function setBaseNote(partId: string, note: number): void {
  if (!_patterns[partId]) initPart(partId);
  const pattern = _patterns[partId];
  _patterns = { ..._patterns, [partId]: { ...pattern, baseNote: note } };
  _writeToStorage(_patterns);
  _notify();
}

/** Setzt alle Steps des Parts auf active = false. Kein-Op, wenn Part nicht existiert. */
export function clearPart(partId: string): void {
  if (!_patterns[partId]) return;
  const pattern = _patterns[partId];
  const steps = pattern.steps.map((s) => ({ ...s, active: false }));
  _patterns = { ..._patterns, [partId]: { ...pattern, steps } };
  _writeToStorage(_patterns);
  _notify();
}

/** Gibt das Pattern des Parts zurück, oder undefined wenn nicht vorhanden. */
export function getPattern(partId: string): MelodicPattern | undefined {
  return _patterns[partId];
}

/** Setzt den globalen State zurück – ausschließlich für Tests. */
export function __resetForTests(): void {
  _patterns = {};
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  _notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export function useMelodicPartStore(): MelodicPartState & MelodicPartActions {
  const [patterns, setPatterns] = useState<Record<string, MelodicPattern>>(_patterns);

  useEffect(() => {
    const handler = (updated: Record<string, MelodicPattern>) => {
      setPatterns({ ...updated });
    };
    _listeners.add(handler);
    return () => {
      _listeners.delete(handler);
    };
  }, []);

  const handleInitPart = useCallback((partId: string) => {
    initPart(partId);
  }, []);

  const handleSetNote = useCallback(
    (partId: string, stepIdx: number, note: number) => {
      setNote(partId, stepIdx, note);
    },
    [],
  );

  const handleToggleStep = useCallback((partId: string, stepIdx: number) => {
    toggleStep(partId, stepIdx);
  }, []);

  const handleSetVelocity = useCallback(
    (partId: string, stepIdx: number, velocity: number) => {
      setVelocity(partId, stepIdx, velocity);
    },
    [],
  );

  const handleSetBaseNote = useCallback((partId: string, note: number) => {
    setBaseNote(partId, note);
  }, []);

  const handleClearPart = useCallback((partId: string) => {
    clearPart(partId);
  }, []);

  const handleGetPattern = useCallback(
    (partId: string): MelodicPattern | undefined => getPattern(partId),
    [],
  );

  return {
    patterns,
    initPart: handleInitPart,
    setNote: handleSetNote,
    toggleStep: handleToggleStep,
    setVelocity: handleSetVelocity,
    setBaseNote: handleSetBaseNote,
    clearPart: handleClearPart,
    getPattern: handleGetPattern,
  };
}
