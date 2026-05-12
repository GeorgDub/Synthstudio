/**
 * Synthstudio – useKeyboardSamplerStore
 *
 * Multi-Sample Keyboard Mapping (Phase D).
 * Erlaubt das Mappen von Samples auf MIDI-Noten (Velocity-Zonen).
 *
 * Konzept:
 *  - KeyMap: MIDI-Note (0–127) → Sample + Transponierungsbereich
 *  - Velocity-Split: Verschiedene Samples bei verschiedenen Anschlagsstärken
 *  - Root-Note: Die MIDI-Note bei der das Sample in Originaltonhöhe spielt
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-keyboard-sampler:v1";

export interface SampleZone {
  id: string;
  sampleUrl: string;
  sampleName: string;
  /** Unterste MIDI-Note dieser Zone */
  loNote: number;
  /** Oberste MIDI-Note dieser Zone */
  hiNote: number;
  /** Root-Note (Originaltonhöhe) */
  rootNote: number;
  /** Minimale Velocity (0–127) */
  loVelocity: number;
  /** Maximale Velocity (0–127) */
  hiVelocity: number;
  /** Lautstärke 0–1 */
  volume: number;
  /** Panorama -1..+1 */
  pan: number;
}

export interface KeyboardSamplerState {
  zones: SampleZone[];
  enabled: boolean;
  name: string;
}

type Listener = () => void;

function makeId() { return `ksz-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`; }

function load(): KeyboardSamplerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { zones: [], enabled: false, name: "Keyboard Sampler" };
}

function persist(s: KeyboardSamplerState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let _state: KeyboardSamplerState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function addSampleZone(zone: Omit<SampleZone, "id">): string {
  const id = makeId();
  _state = { ..._state, zones: [..._state.zones, { ...zone, id }] };
  persist(_state); notify();
  return id;
}

export function removeSampleZone(id: string): void {
  _state = { ..._state, zones: _state.zones.filter(z => z.id !== id) };
  persist(_state); notify();
}

export function updateSampleZone(id: string, changes: Partial<Omit<SampleZone, "id">>): void {
  _state = { ..._state, zones: _state.zones.map(z => z.id === id ? { ...z, ...changes } : z) };
  persist(_state); notify();
}

export function setKeyboardSamplerEnabled(enabled: boolean): void {
  _state = { ..._state, enabled };
  persist(_state); notify();
}

/** Findet alle Zonen die für eine Note + Velocity passen. */
export function findZones(note: number, velocity: number): SampleZone[] {
  return _state.zones.filter(z =>
    note >= z.loNote && note <= z.hiNote &&
    velocity >= z.loVelocity && velocity <= z.hiVelocity
  );
}

/** Berechnet playbackRate für eine Zone basierend auf gespielter Note vs Root-Note. */
export function zonePlaybackRate(zone: SampleZone, note: number): number {
  return Math.pow(2, (note - zone.rootNote) / 12);
}

export function getKeyboardSamplerState(): KeyboardSamplerState {
  return _state;
}

export function useKeyboardSamplerStore(): KeyboardSamplerState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
