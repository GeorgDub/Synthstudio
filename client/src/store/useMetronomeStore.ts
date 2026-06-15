/**
 * Synthstudio – useMetronomeStore
 *
 * Metronom-Einstellungen inkl. persistenter Custom-Sounds.
 * Audio-Daten werden als Base64-Data-URL in localStorage gespeichert (max ~2 MB).
 */
import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";

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

/**
 * Abonniert Metronom-Änderungen für `useSyncExternalStore`. Gibt Unsubscribe
 * zurück. (TASK-263: Foundation für Selektor-Subscriptions.)
 */
export function subscribeMetronome(listener: Listener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

export function useMetronomeStore(): MetronomeState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

/**
 * TASK-263 — Selektor-Subscription (additiv, Vorlage: usePlayheadStore / TASK-253).
 *
 * Abonniert nur `selector(_state)` und re-rendert den Consumer NUR wenn sich
 * diese Scheibe laut `isEqual` ändert. Hintergrund: `updateMetronome` mergt+
 * notifyt bei JEDEM Feld-Change (Volume/Tone/Accent/BeatsPerBar-Slider in den
 * Settings). App.tsx abonniert via `useMetronomeStore()` aber das KOMPLETTE
 * State-Objekt, liest jedoch nur `customDownbeatUrl` + `customBeatUrl` (zwei
 * skalare Felder für die AudioEngine-Sync-Effects). Ohne Selektor re-rendert
 * der ~5000-Zeilen-App.tsx-Tree bei jedem Metronom-Slider-Drag.
 *
 * `useSyncExternalStore` vergleicht Snapshots mit `Object.is`. Für Objekt-Slices
 * cachen wir den letzten Wert und geben bei Gleichheit die stabile Referenz
 * zurück; skalare Selektoren (z.B. `string | null`) brauchen kein `isEqual`.
 */
export function useMetronomeSelector<T>(
  selector: (state: MetronomeState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cacheRef = useRef<{ value: T } | null>(null);
  const getSnapshot = (): T => {
    const next = selector(_state);
    const cache = cacheRef.current;
    if (cache !== null && isEqual(cache.value, next)) {
      return cache.value; // stabile Referenz → Object.is-Bail-out
    }
    cacheRef.current = { value: next };
    return next;
  };
  return useSyncExternalStore(subscribeMetronome, getSnapshot, getSnapshot);
}

/**
 * TASK-263 — Convenience-Selektor: nur die Custom-Sound-URLs (Data-URL bzw.
 * null). App.tsx nutzt diese, um die AudioEngine zu syncen — kein Rerender
 * mehr bei Volume-/Tone-/Accent-/BeatsPerBar-Änderungen.
 */
export function useMetronomeCustomDownbeatUrl(): string | null {
  return useMetronomeSelector((s) => s.customDownbeatUrl);
}

export function useMetronomeCustomBeatUrl(): string | null {
  return useMetronomeSelector((s) => s.customBeatUrl);
}
