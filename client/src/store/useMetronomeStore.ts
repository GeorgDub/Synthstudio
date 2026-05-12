/**
 * Synthstudio – useMetronomeStore
 *
 * Metronom-Einstellungen inkl. Custom Sounds.
 * Erlaubt das Laden eigener WAV-Dateien als Metronom-Click.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-metronome:v1";

export interface MetronomeState {
  enabled: boolean;
  volume: number;       // 0–1
  accent: number;       // 0.5–2.0 (Betonung des 1. Schlags)
  tone: number;         // 0–1 (Tonhöhe)
  /** URL des Custom-Click-Sounds für Downbeat (null = synthetisch) */
  customDownbeatUrl: string | null;
  /** URL des Custom-Click-Sounds für normale Beats (null = synthetisch) */
  customBeatUrl: string | null;
  beatsPerBar: number;  // 2–7
  subdivision: "beat" | "eighth" | "sixteenth";
}

type Listener = () => void;

function load(): MetronomeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaults();
}

function defaults(): MetronomeState {
  return {
    enabled: false, volume: 0.5, accent: 1.0, tone: 0.5,
    customDownbeatUrl: null, customBeatUrl: null,
    beatsPerBar: 4, subdivision: "beat",
  };
}

function persist(s: MetronomeState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let _state: MetronomeState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function updateMetronome(changes: Partial<MetronomeState>): void {
  _state = { ..._state, ...changes };
  persist(_state);
  notify();
}

export function setCustomMetronomeSound(type: "downbeat" | "beat", url: string | null): void {
  if (type === "downbeat") updateMetronome({ customDownbeatUrl: url });
  else updateMetronome({ customBeatUrl: url });
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
