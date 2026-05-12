/**
 * Synthstudio – useMetronomeStore
 *
 * Metronom-Einstellungen inkl. persistenter Custom-Sounds.
 * Audio-Daten werden als Base64-Data-URL in localStorage gespeichert (max ~2 MB).
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-metronome:v2";

export interface MetronomeState {
  enabled: boolean;
  volume: number;       // 0–1
  accent: number;       // 0.5–2.0 (Betonung des 1. Schlags)
  tone: number;         // 0–1 (Tonhöhe)
  /** Data-URL des Custom-Click-Sounds für Downbeat (null = synthetisch) */
  customDownbeatUrl: string | null;
  /** Anzeigename der Downbeat-Datei (für UI) */
  customDownbeatName: string | null;
  /** Data-URL des Custom-Click-Sounds für normale Beats (null = synthetisch) */
  customBeatUrl: string | null;
  customBeatName: string | null;
  beatsPerBar: number;  // 2–7
  subdivision: "beat" | "eighth" | "sixteenth";
}

type Listener = () => void;

function defaults(): MetronomeState {
  return {
    enabled: false, volume: 0.5, accent: 1.0, tone: 0.5,
    customDownbeatUrl: null, customDownbeatName: null,
    customBeatUrl: null,     customBeatName: null,
    beatsPerBar: 4, subdivision: "beat",
  };
}

function load(): MetronomeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaults();
}

function persist(s: MetronomeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    // Quota-Fehler: Custom-Sounds sind vermutlich zu groß
    console.warn("[Metronome] Persistierung fehlgeschlagen (Quota?):", err);
  }
}

let _state: MetronomeState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function updateMetronome(changes: Partial<MetronomeState>): void {
  _state = { ..._state, ...changes };
  persist(_state);
  notify();
}

/** Konvertiert eine File zu einer Data-URL (Base64). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Lädt eine Audio-Datei hoch und speichert sie persistent als Data-URL.
 * Wirft einen Fehler wenn die Datei > 2 MB ist (localStorage-Quota).
 */
export async function uploadCustomMetronomeSound(
  type: "downbeat" | "beat",
  file: File,
): Promise<void> {
  if (!file.type.startsWith("audio/")) {
    throw new Error("Nur Audio-Dateien werden unterstützt.");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Datei zu groß (max. 2 MB für persistente Speicherung).");
  }
  const dataUrl = await fileToDataUrl(file);
  if (type === "downbeat") {
    updateMetronome({ customDownbeatUrl: dataUrl, customDownbeatName: file.name });
  } else {
    updateMetronome({ customBeatUrl: dataUrl, customBeatName: file.name });
  }
}

/** Entfernt den Custom-Sound (zurück auf synthetisch). */
export function clearCustomMetronomeSound(type: "downbeat" | "beat"): void {
  if (type === "downbeat") {
    updateMetronome({ customDownbeatUrl: null, customDownbeatName: null });
  } else {
    updateMetronome({ customBeatUrl: null, customBeatName: null });
  }
}

export function resetMetronome(): void {
  _state = defaults();
  persist(_state);
  notify();
}

export function getMetronomeState(): MetronomeState { return _state; }

export function useMetronomeStore(): MetronomeState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
