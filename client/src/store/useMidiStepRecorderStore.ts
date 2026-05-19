/**
 * Synthstudio – useMidiStepRecorderStore (v3.97.0)
 *
 * MIDI-Step-Recorder (Logic Pro "Step Input Recording" / Ableton-Style):
 * Live MIDI-Note-On → schreibt direkt in den aktuell ausgewaehlten Step des
 * record-armed Channels und rueckt auto-advance um 1 Step weiter (modulo
 * stepCount). Funktioniert OHNE Playback — wird auch genutzt um Patterns
 * von Hardware-Pads einzuspielen.
 *
 * Unterschied zu useLiveStepRecorder:
 *   - useLiveStepRecorder: ueberlagert/ersetzt Steps WAEHREND Playback laeuft
 *     (currentStep wird vom AudioEngine bestimmt, kein Auto-Advance des Cursors).
 *   - useMidiStepRecorderStore (dieser): ohne Playback, eigener currentStep-
 *     Cursor advanciert per Note-On, armedPartId wird vom User festgesetzt
 *     (= "Record-Arm" pro Channel), Mode-Toggle Overwrite/Overdub.
 *
 * Modi:
 *   - "overwrite": vor jedem Write den Step erst clearen (auch Velocity reset),
 *     dann Velocity neu setzen. Macht den Eingabeschritt definitiv ueberschreibend.
 *   - "overdub":   additiv — wenn der Step bereits aktiv ist, NUR Velocity-
 *     update; wenn inaktiv, aktivieren. Bestehende Velocities werden bei aktiven
 *     Steps NICHT ueberschrieben falls die neue Velocity 0 ist.
 *
 * Persistenz: Settings (enabled/armedPartId/mode) NICHT persistiert — Reload
 * disarmt den Recorder automatisch. State ist Modul-Singleton mit Listener-Set
 * (analog useNoteRepeatStore / useSceneStore).
 */
import { useState, useCallback, useEffect } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export type MidiStepRecorderMode = "overwrite" | "overdub";

export interface MidiStepRecorderSnapshot {
  enabled: boolean;
  currentStep: number;
  armedPartId: string | null;
  mode: MidiStepRecorderMode;
}

// ─── Internal Singleton State ─────────────────────────────────────────────────

let _enabled = false;
let _currentStep = 0;
let _armedPartId: string | null = null;
let _mode: MidiStepRecorderMode = "overwrite";

const _listeners = new Set<(snap: MidiStepRecorderSnapshot) => void>();

function _snapshot(): MidiStepRecorderSnapshot {
  return {
    enabled: _enabled,
    currentStep: _currentStep,
    armedPartId: _armedPartId,
    mode: _mode,
  };
}

function _notify(): void {
  const snap = _snapshot();
  _listeners.forEach((fn) => fn(snap));
}

// ─── Pure Getter ──────────────────────────────────────────────────────────────

export function isMidiStepRecorderEnabled(): boolean {
  return _enabled;
}

export function getMidiStepRecorderState(): MidiStepRecorderSnapshot {
  return _snapshot();
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export function setEnabled(enabled: boolean): void {
  if (_enabled === enabled) return;
  _enabled = enabled;
  // Beim Disable den Cursor auf 0 zuruecksetzen damit beim naechsten Enable
  // wieder von vorne gestartet wird.
  if (!_enabled) {
    _currentStep = 0;
  }
  _notify();
}

export function setArmedPart(partId: string | null): void {
  if (_armedPartId === partId) return;
  _armedPartId = partId;
  // Neuer Channel → Cursor zuruecksetzen damit Eingabe definitiv am Anfang
  // beginnt (vermeidet versehentliches Schreiben in der Mitte des Patterns).
  _currentStep = 0;
  _notify();
}

export function setMode(mode: MidiStepRecorderMode): void {
  if (_mode === mode) return;
  if (mode !== "overwrite" && mode !== "overdub") return;
  _mode = mode;
  _notify();
}

/**
 * Advanciert den Step-Cursor um 1 (modulo stepCount). Wird vom useMidi-
 * Note-On-Handler nach einem erfolgreichen Step-Write gerufen.
 */
export function advanceStep(stepCount: number): void {
  const safeCount = Math.max(1, Math.floor(stepCount));
  _currentStep = (_currentStep + 1) % safeCount;
  _notify();
}

/**
 * Setzt den Cursor explizit auf einen Step (z.B. wenn der User per Click
 * auf ein Step-Feld den Eingabepunkt waehlt).
 */
export function setCurrentStep(step: number): void {
  const next = Math.max(0, Math.floor(step));
  if (_currentStep === next) return;
  _currentStep = next;
  _notify();
}

/**
 * Full-Reset: disabled, Cursor=0, kein Channel, Default-Mode. Wird beim
 * Project-Load und "Neues Projekt" aufgerufen.
 */
export function reset(): void {
  _enabled = false;
  _currentStep = 0;
  _armedPartId = null;
  _mode = "overwrite";
  _notify();
}

export function __resetForTests(): void {
  reset();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export interface MidiStepRecorderApi {
  enabled: boolean;
  currentStep: number;
  armedPartId: string | null;
  mode: MidiStepRecorderMode;
  setEnabled: (enabled: boolean) => void;
  setArmedPart: (partId: string | null) => void;
  setMode: (mode: MidiStepRecorderMode) => void;
  advanceStep: (stepCount: number) => void;
  setCurrentStep: (step: number) => void;
  reset: () => void;
}

export function useMidiStepRecorderStore(): MidiStepRecorderApi {
  const [snap, setSnap] = useState<MidiStepRecorderSnapshot>(_snapshot());

  useEffect(() => {
    const handler = (s: MidiStepRecorderSnapshot) => setSnap(s);
    _listeners.add(handler);
    return () => { _listeners.delete(handler); };
  }, []);

  const apiSetEnabled = useCallback((e: boolean) => setEnabled(e), []);
  const apiSetArmedPart = useCallback((p: string | null) => setArmedPart(p), []);
  const apiSetMode = useCallback((m: MidiStepRecorderMode) => setMode(m), []);
  const apiAdvanceStep = useCallback((c: number) => advanceStep(c), []);
  const apiSetCurrentStep = useCallback((s: number) => setCurrentStep(s), []);
  const apiReset = useCallback(() => reset(), []);

  return {
    enabled: snap.enabled,
    currentStep: snap.currentStep,
    armedPartId: snap.armedPartId,
    mode: snap.mode,
    setEnabled: apiSetEnabled,
    setArmedPart: apiSetArmedPart,
    setMode: apiSetMode,
    advanceStep: apiAdvanceStep,
    setCurrentStep: apiSetCurrentStep,
    reset: apiReset,
  };
}
