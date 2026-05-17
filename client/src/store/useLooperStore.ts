/**
 * Synthstudio – useLooperStore.ts (TASK-235 / v2.87)
 *
 * Live-Looper State (RC-505 / Ableton Live Looper).
 *
 * Architektur:
 *  - Custom-Observer-Pattern (analog useLiveInputStore / useNoteRepeatStore).
 *  - 4 Loop-Slots, jeder mit eigener State-Machine (siehe looperUtils.ts).
 *  - Audio-Buffer (Float32Array) lebt NUR im RAM, nicht im localStorage:
 *    Eine 8-Bar-Aufnahme @ 120 BPM/48kHz ≈ 1.5 MB pro Loop * 4 = 6 MB. Das in
 *    localStorage zu spiegeln ist Quota-Suizid. Wir persistieren nur die
 *    Metadaten (Name, sourceChannelId, volume/pan/mute/solo).
 *  - AudioEngine.LooperEngine ist der Owner der Buffer + Web-Audio-Nodes. Der
 *    Store hält nur leichtgewichtige State-Flags.
 */

import { useEffect, useReducer } from "react";
import {
  MAX_LOOPS,
  type LoopState,
  isValidLoopIndex,
} from "../audio/looperUtils";

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface LooperSlot {
  /** Stabile ID — verändert sich nicht über Recordings hinweg. */
  id: string;
  /** Display-Name (Default "Loop N"). */
  name: string;
  /** Aktueller State-Machine-Zustand. */
  state: LoopState;
  /**
   * Channel, dessen Signal aufgenommen wird. Konvention: ein Live-Input
   * (TASK-233). Leer-String solange noch nichts zugewiesen.
   */
  sourceChannelId: string;
  /** Loop-Länge in Beats (nach Quantisierung). Null wenn noch leer. */
  lengthBeats: number | null;
  /** Loop-Länge in Sekunden (post-quantize). Null wenn noch leer. */
  lengthSec: number | null;
  volume: number; // 0..1.5
  pan: number;    // -1..1
  muted: boolean;
  solo: boolean;
  /** Anzahl aufgenommener / overdubbed Frames (für Progress-Ring). */
  frameCount: number;
}

// ─── Persistenz ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "synthstudio:looper:v1";

/** Was im localStorage gespiegelt wird — KEIN audioBuffer/frameCount/state. */
interface PersistedSlot {
  id: string;
  name: string;
  sourceChannelId: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}

// ─── Defaults & Init ─────────────────────────────────────────────────────────

function makeDefaultSlot(idx: number): LooperSlot {
  return {
    id: `loop:${idx + 1}`,
    name: `Loop ${idx + 1}`,
    state: "empty",
    sourceChannelId: "",
    lengthBeats: null,
    lengthSec: null,
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    frameCount: 0,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function loadFromStorage(): LooperSlot[] {
  const fresh = Array.from({ length: MAX_LOOPS }, (_, i) => makeDefaultSlot(i));
  try {
    if (typeof localStorage === "undefined") return fresh;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fresh;
    return fresh.map((def, i) => {
      const p = parsed[i] as Partial<PersistedSlot> | undefined;
      if (!p || typeof p !== "object") return def;
      return {
        ...def,
        name:            typeof p.name === "string"            ? p.name            : def.name,
        sourceChannelId: typeof p.sourceChannelId === "string" ? p.sourceChannelId : def.sourceChannelId,
        volume:          typeof p.volume === "number"          ? clamp(p.volume, 0, 1.5) : def.volume,
        pan:             typeof p.pan === "number"             ? clamp(p.pan, -1, 1)     : def.pan,
        muted:           typeof p.muted === "boolean"          ? p.muted           : def.muted,
        solo:            typeof p.solo === "boolean"           ? p.solo            : def.solo,
      };
    });
  } catch {
    return fresh;
  }
}

function persist(slots: LooperSlot[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const data: PersistedSlot[] = slots.map((s) => ({
      id: s.id,
      name: s.name,
      sourceChannelId: s.sourceChannelId,
      volume: s.volume,
      pan: s.pan,
      muted: s.muted,
      solo: s.solo,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* Quota voll – ignore */
  }
}

// ─── Module-Singleton ────────────────────────────────────────────────────────

let _slots: LooperSlot[] = loadFromStorage();
type Listener = () => void;
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach((l) => {
    try { l(); } catch { /* swallow */ }
  });
}

// ─── Public API (pure-data) ─────────────────────────────────────────────────

export function getAllLoopSlots(): LooperSlot[] {
  return _slots.slice();
}

export function getLoopSlot(index: number): LooperSlot | null {
  if (!isValidLoopIndex(index)) return null;
  return _slots[index];
}

/** Patcht einen Slot (kein ID-Override). Nur Metadata-relevante Felder. */
export function updateLoopSlot(
  index: number,
  patch: Partial<Omit<LooperSlot, "id">>,
): void {
  if (!isValidLoopIndex(index)) return;
  const existing = _slots[index];
  const merged: LooperSlot = {
    ...existing,
    ...patch,
    volume: patch.volume !== undefined ? clamp(patch.volume, 0, 1.5) : existing.volume,
    pan:    patch.pan    !== undefined ? clamp(patch.pan, -1, 1)     : existing.pan,
    // ID NIE überschreiben
    id: existing.id,
  };
  _slots = [
    ..._slots.slice(0, index),
    merged,
    ..._slots.slice(index + 1),
  ];
  persist(_slots);
  notify();
}

/** Setzt den State (intern von der LooperEngine aufgerufen). */
export function setLoopState(index: number, state: LoopState): void {
  if (!isValidLoopIndex(index)) return;
  if (_slots[index].state === state) return;
  updateLoopSlot(index, { state });
}

/** Setzt die quantisierte Loop-Länge nach Recording-End. */
export function setLoopLength(
  index: number,
  lengthBeats: number,
  lengthSec: number,
  frameCount: number,
): void {
  if (!isValidLoopIndex(index)) return;
  updateLoopSlot(index, { lengthBeats, lengthSec, frameCount });
}

/** Setzt die Source-Channel-ID (aus dem UI-Picker). */
export function setLoopSourceChannel(index: number, channelId: string): void {
  if (!isValidLoopIndex(index)) return;
  updateLoopSlot(index, { sourceChannelId: channelId });
}

/** Aktualisiert frameCount während des Overdub-Mergens (für Progress-Ring). */
export function setLoopFrameCount(index: number, frameCount: number): void {
  if (!isValidLoopIndex(index)) return;
  updateLoopSlot(index, { frameCount });
}

/** Reset eines Slots (Erase). Behält ID + Metadata. */
export function resetLoopSlot(index: number): void {
  if (!isValidLoopIndex(index)) return;
  const existing = _slots[index];
  const reset: LooperSlot = {
    ...existing,
    state: "empty",
    lengthBeats: null,
    lengthSec: null,
    frameCount: 0,
  };
  _slots = [
    ..._slots.slice(0, index),
    reset,
    ..._slots.slice(index + 1),
  ];
  persist(_slots);
  notify();
}

/** Liefert wieviele Slots aktuell NICHT empty sind. */
export function getActiveLoopCount(): number {
  return _slots.filter((s) => s.state !== "empty").length;
}

/** Reset für Tests + "Neues Projekt". */
export function __resetForTests(): void {
  _slots = Array.from({ length: MAX_LOOPS }, (_, i) => makeDefaultSlot(i));
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* ignore */ }
  notify();
}

export function resetLooper(): void {
  __resetForTests();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export interface LooperStoreApi {
  slots: LooperSlot[];
  update: (index: number, patch: Partial<Omit<LooperSlot, "id">>) => void;
  setSourceChannel: (index: number, channelId: string) => void;
  reset: (index: number) => void;
  activeCount: number;
}

export function useLooperStore(): LooperStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    slots: _slots,
    update: updateLoopSlot,
    setSourceChannel: setLoopSourceChannel,
    reset: resetLoopSlot,
    activeCount: getActiveLoopCount(),
  };
}
