/**
 * Synthstudio – useMidiBackendStore (Synth.md #11)
 *
 * Opt-in-Schalter für den MIDI-Backend-Pfad:
 *   - "web"    → Web-MIDI (navigator.requestMIDIAccess). DEFAULT. Funktioniert
 *                im Browser und im Electron-Renderer (Chromium-Backend) ohne
 *                Zusatz-Setup. Der bisherige, verifizierte Pfad.
 *   - "native" → nativer RtMidi-Layer (@julusian/midi) via Electron-IPC. Nur
 *                im Electron-Desktop verfügbar; robusteres SysEx-I/O für
 *                OmniTribe/KORG. **Opt-in**, weil ohne echte Hardware-E2E noch
 *                nicht als Default verifiziert (Risiko: lädt, liefert aber
 *                still keine Messages).
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

function _readFromStorage(): MidiBackend {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VALID.has(v as MidiBackend)) return v as MidiBackend;
  } catch {
    // localStorage nicht verfügbar
  }
  return DEFAULT_BACKEND;
}

function _writeToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, _backend);
  } catch {
    // ignore
  }
}

function _notify(): void {
  _listeners.forEach((fn) => fn(_backend));
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
    return () => { _listeners.delete(handler); };
  }, []);

  const setBackend = useCallback((b: MidiBackend) => setMidiBackend(b), []);

  return { backend, isNative: backend === "native", setBackend };
}
