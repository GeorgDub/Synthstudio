/**
 * Synthstudio – useAudioTrackStore.ts
 *
 * State-Management für externe Audio-Track-Channels (Vocals, Songs zum Remixen).
 *
 * - Persistenz als Pfad-Referenz in der .synth-Datei (über projectSerializer)
 * - localStorage-Fallback solange kein Projekt geladen ist (Key: `synthstudio:audiotracks:v1`)
 * - Custom Observer Store (Module-Singleton + Listener-Set), KEIN Zustand-npm-Package
 * - Maximal `MAX_AUDIO_TRACKS` (= 8) Tracks gleichzeitig
 *
 * Runtime-only State (broken-Flag, durationSec, peaks) wird NICHT persistiert.
 * Er wird in einer separaten Map gehalten und bei reload/restore zurückgesetzt.
 *
 * ─── TYP-OWNERSHIP ────────────────────────────────────────────────────────────
 * `AudioTrackChannelData` lebt als Single-Source-of-Truth in AudioEngine.ts
 * (dort hängen die Engine-Methoden registerAudioTrack/setAudioTracksGetter
 * direkt an dem Shape). Dieses Modul re-exportiert den Typ nur, damit
 * bestehende Importpfade (`@/store/useAudioTrackStore`) unverändert bleiben.
 *
 * Bei Schema-Erweiterungen: NUR in AudioEngine.ts ändern, alle Consumer
 * folgen automatisch (TASK-109 / v1.18-Cleanup).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useReducer } from "react";
import { nanoid } from "nanoid";
import type { AudioTrackChannelData } from "@/audio/AudioEngine";

// ─── Typen ───────────────────────────────────────────────────────────────────

/**
 * Re-Export aus AudioEngine.ts. Die kanonische Definition lebt dort.
 * Bei Schema-Änderungen: AudioEngine.ts editieren – nicht hier.
 */
export type { AudioTrackChannelData };

/**
 * Runtime-only State pro Track. NICHT persistiert.
 * - broken: Datei konnte nicht geladen werden (z.B. Pfad ungültig nach Project-Reload)
 * - durationSec: ermittelt von AudioEngine nach Decode
 * - peaks: Wellenform-Peaks für Display (Float32Array)
 */
export interface AudioTrackRuntimeState {
  broken: boolean;
  durationSec?: number;
  peaks?: Float32Array;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const MAX_AUDIO_TRACKS = 8;
/**
 * Maximale Anzahl gleichzeitiger Tracks mit `syncMode === "timestretch"`.
 * Begründung: AudioWorklet-OLA ist deutlich teurer als `playbackRate` (CPU-Schutz).
 * UI sollte die Option ab diesem Limit deaktivieren (mit Tooltip).
 */
export const MAX_TIMESTRETCH_TRACKS = 4;
const STORAGE_KEY = "synthstudio:audiotracks:v1";
const ID_PREFIX = "audiotrack:";

// ─── Persistierter State ─────────────────────────────────────────────────────

let _tracks: AudioTrackChannelData[] = loadFromStorage();

// Runtime-only Map (NICHT in localStorage / .synth)
const _runtime: Map<string, AudioTrackRuntimeState> = new Map();

type Listener = () => void;
const _listeners = new Set<Listener>();
function notify(): void {
  _listeners.forEach((l) => l());
}

// ─── Persistence Helpers ─────────────────────────────────────────────────────

function loadFromStorage(): AudioTrackChannelData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTrack).slice(0, MAX_AUDIO_TRACKS);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_tracks));
  } catch {
    // Quota voll / nicht verfügbar – ignorieren
  }
}

/** Validiert ein einzelnes Track-Objekt strukturell. */
function isValidTrack(t: unknown): t is AudioTrackChannelData {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  // syncMode (optional) muss – wenn gesetzt – einer der erlaubten Strings sein.
  // Alte v1.16-Files ohne Feld bleiben gültig (undefined). Migration: kein
  // Auto-Upgrade von "stretch" → "timestretch" (User-Entscheidung).
  if (o.syncMode !== undefined && o.syncMode !== null) {
    if (
      o.syncMode !== "free" &&
      o.syncMode !== "stretch" &&
      o.syncMode !== "timestretch"
    ) {
      return false;
    }
  }
  return (
    typeof o.id === "string" &&
    o.id.startsWith(ID_PREFIX) &&
    typeof o.name === "string" &&
    typeof o.filePath === "string" &&
    typeof o.fileName === "string" &&
    typeof o.volume === "number" &&
    typeof o.pan === "number" &&
    typeof o.muted === "boolean" &&
    typeof o.soloed === "boolean" &&
    o.sends !== null &&
    typeof o.sends === "object" &&
    typeof (o.sends as { reverb?: unknown }).reverb === "number" &&
    typeof (o.sends as { delay?: unknown }).delay === "number"
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fügt einen neuen Audio-Track hinzu.
 * @throws Error wenn bereits `MAX_AUDIO_TRACKS` Tracks existieren.
 * @returns Die generierte ID im Format `audiotrack:<nanoid>`.
 */
export function addAudioTrack(data: Omit<AudioTrackChannelData, "id">): string {
  if (_tracks.length >= MAX_AUDIO_TRACKS) {
    throw new Error(
      `Maximum number of audio tracks reached (${MAX_AUDIO_TRACKS}).`,
    );
  }
  const id = `${ID_PREFIX}${nanoid()}`;
  const track: AudioTrackChannelData = { id, ...data };
  _tracks = [..._tracks, track];
  persist();
  notify();
  return id;
}

/** Entfernt einen Audio-Track + runtime-state. No-op wenn ID unbekannt. */
export function removeAudioTrack(id: string): void {
  const next = _tracks.filter((t) => t.id !== id);
  if (next.length === _tracks.length) return;
  _tracks = next;
  _runtime.delete(id);
  persist();
  notify();
}

/** Patcht nur die angegebenen Felder. ID kann NICHT geändert werden. */
export function updateAudioTrack(
  id: string,
  patch: Partial<AudioTrackChannelData>,
): void {
  const idx = _tracks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  // ID darf nicht überschrieben werden
  const { id: _ignoredId, ...safePatch } = patch;
  void _ignoredId;
  const updated: AudioTrackChannelData = { ..._tracks[idx], ...safePatch };
  _tracks = [..._tracks.slice(0, idx), updated, ..._tracks.slice(idx + 1)];
  persist();
  notify();
}

/** Gibt einen Track per ID zurück oder null wenn unbekannt. */
export function getAudioTrack(id: string): AudioTrackChannelData | null {
  return _tracks.find((t) => t.id === id) ?? null;
}

/** Snapshot aller Tracks (defensive Kopie). */
export function getAllAudioTracks(): AudioTrackChannelData[] {
  return _tracks.slice();
}

/**
 * Anzahl der Tracks mit `syncMode === "timestretch"`.
 * UI nutzt das, um die Time-Stretch-Option in weiteren Tracks zu deaktivieren
 * wenn `MAX_TIMESTRETCH_TRACKS` erreicht ist (CPU-Schutz).
 */
export function countTimestretchTracks(): number {
  let n = 0;
  for (const t of _tracks) {
    if (t.syncMode === "timestretch") n++;
  }
  return n;
}

/**
 * Ersetzt den gesamten State (verwendet von projectSerializer beim Projekt-Load).
 * Filtert invalide Items + cappt auf MAX_AUDIO_TRACKS.
 * Setzt runtime-state komplett zurück.
 */
export function loadAudioTracks(tracks: AudioTrackChannelData[]): void {
  const valid = (tracks ?? []).filter(isValidTrack).slice(0, MAX_AUDIO_TRACKS);
  _tracks = valid;
  _runtime.clear();
  persist();
  notify();
}

/** Leert sämtliche Audio-Tracks (z.B. bei "Neues Projekt"). */
export function clear(): void {
  if (_tracks.length === 0 && _runtime.size === 0) return;
  _tracks = [];
  _runtime.clear();
  persist();
  notify();
}

/**
 * Setzt/Löscht das runtime-only `broken`-Flag eines Tracks.
 * NICHT persistiert.
 */
export function markBroken(id: string, broken: boolean): void {
  const existing = _runtime.get(id) ?? { broken: false };
  const next: AudioTrackRuntimeState = { ...existing, broken };
  _runtime.set(id, next);
  notify();
}

/** Setzt Duration + Peaks (von AudioEngine nach Decode). NICHT persistiert. */
export function setRuntimeWaveform(
  id: string,
  durationSec: number,
  peaks?: Float32Array,
): void {
  const existing = _runtime.get(id) ?? { broken: false };
  _runtime.set(id, { ...existing, durationSec, peaks });
  notify();
}

/** Liest runtime-state (broken/duration/peaks). Defaults zu broken:false wenn unbekannt. */
export function getRuntimeState(id: string): AudioTrackRuntimeState {
  return _runtime.get(id) ?? { broken: false };
}

/**
 * Reset für Tests. Nicht für Produktiv-Code gedacht.
 * @internal
 */
export function __resetForTests(): void {
  _tracks = [];
  _runtime.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export interface AudioTrackStoreApi {
  tracks: AudioTrackChannelData[];
  add: (data: Omit<AudioTrackChannelData, "id">) => string;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<AudioTrackChannelData>) => void;
  get: (id: string) => AudioTrackChannelData | null;
  getRuntime: (id: string) => AudioTrackRuntimeState;
  markBroken: (id: string, broken: boolean) => void;
}

/**
 * React-Hook: Observer-Pattern mit `useReducer` für rerender-Trigger.
 * Returnt einen Snapshot + die Public Mutation API.
 */
export function useAudioTrackStore(): AudioTrackStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    tracks: _tracks,
    add: addAudioTrack,
    remove: removeAudioTrack,
    update: updateAudioTrack,
    get: getAudioTrack,
    getRuntime: getRuntimeState,
    markBroken,
  };
}
