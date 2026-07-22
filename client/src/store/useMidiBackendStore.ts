/**
 * Synthstudio – useMidiBackendStore (Synth.md #11)
 *
 * Schalter für den MIDI-Backend-Pfad:
 *   - "web"    → Web-MIDI (navigator.requestMIDIAccess). Browser-DEFAULT.
 *                Funktioniert im Browser und im Electron-Renderer ohne Setup.
 *   - "native" → nativer RtMidi-Layer (@julusian/midi) via Electron-IPC. Nur
 *                im Electron-Desktop; echtes MIDI (mehrere Geräte parallel, kein
 *                Browser-SysEx-Prompt, niedrigere Latenz). **Electron-DEFAULT**
 *                (siehe resolveBackend). Bei Fehlschlag fällt useMidi.enable()
 *                automatisch auf Web-MIDI zurück; der Toggle erlaubt jederzeit
 *                den manuellen Wechsel.
 *
 * WICHTIG: Der Schalter ändert NUR welchen Backend-Pfad neue connect()/enable()-
 * Aufrufe wählen. Ein Backend-Wechsel zur Laufzeit muss vom Consumer
 * (useMidi/useOmniTribe) sauber teardown→reconnect behandeln, weil Windows-
 * MIDI-Inputs exklusiv sind (geleakte Handles blockieren den nächsten Open).
 *
 * Modul-Singleton-Pattern + localStorage-Persistenz (analog useNoteRepeatStore).
 */
import { useState, useCallback, useEffect } from "react";

export type MidiBackend = "web" | "native";

const STORAGE_KEY = "ss-midi-backend";
const DEFAULT_BACKEND: MidiBackend = "web";

const VALID = new Set<MidiBackend>(["web", "native"]);

let _backend: MidiBackend = DEFAULT_BACKEND;

const _listeners = new Set<(b: MidiBackend) => void>();

/** true, wenn wir im Electron-Desktop laufen (preload legt window.electronAPI an). */
function _isElectron(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as { electronAPI?: unknown }).electronAPI
  );
}

/**
 * Reine Auflösung des Backends: expliziter (gültiger) gespeicherter Wunsch hat
 * Vorrang; sonst im Electron-Desktop **nativ** (richtiges MIDI: mehrere Geräte,
 * kein Browser-SysEx-Prompt, niedrigere Latenz), im Browser **web**. Bei
 * Fehlschlag fällt `useMidi.enable()` ohnehin auf Web-MIDI zurück.
 */
export function resolveBackend(
  stored: string | null,
  isElectron: boolean
): MidiBackend {
  if (stored && VALID.has(stored as MidiBackend)) return stored as MidiBackend;
  return isElectron ? "native" : "web";
}

function _readFromStorage(): MidiBackend {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage nicht verfügbar
  }
  return resolveBackend(stored, _isElectron());
}

function _writeToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, _backend);
  } catch {
    // ignore
  }
}

function _notify(): void {
  _listeners.forEach(fn => fn(_backend));
}

_backend = _readFromStorage();

// ─── Exportierte Logik-Funktionen ─────────────────────────────────────────────

export function getMidiBackend(): MidiBackend {
  return _backend;
}

export function isNativeMidiBackend(): boolean {
  return _backend === "native";
}

export function setMidiBackend(backend: MidiBackend): void {
  if (!VALID.has(backend)) return;
  if (_backend === backend) return;
  _backend = backend;
  _writeToStorage();
  _notify();
}

export function __resetMidiBackendForTests(): void {
  _backend = DEFAULT_BACKEND;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  _notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export interface MidiBackendStoreApi {
  backend: MidiBackend;
  isNative: boolean;
  setBackend: (b: MidiBackend) => void;
}

export function useMidiBackendStore(): MidiBackendStoreApi {
  const [backend, setBackendState] = useState<MidiBackend>(_backend);

  useEffect(() => {
    const handler = (b: MidiBackend) => setBackendState(b);
    _listeners.add(handler);
    // Sync, falls sich der Wert zwischen initialem useState und Effekt änderte.
    setBackendState(_backend);
    return () => {
      _listeners.delete(handler);
    };
  }, []);

  const setBackend = useCallback((b: MidiBackend) => setMidiBackend(b), []);

  return { backend, isNative: backend === "native", setBackend };
}
