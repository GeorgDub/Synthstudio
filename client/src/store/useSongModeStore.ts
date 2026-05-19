/**
 * Synthstudio – useSongModeStore (v3.109.0)
 *
 * Song-Mode / Pattern-Chain-Sequencer.
 *
 * A Song is an ordered list of pattern-references with repeat-counts. The
 * sequencer is driven by AudioEngine.onPosition() — at the end of every
 * pattern loop, advance() returns the next patternId (or null when the song
 * finishes in "once" mode).
 *
 * Persistence: localStorage "ss-song-mode:v1" — songs[] only. The transport
 * state (currentStepIdx / currentRepeat / direction) is in-memory only so a
 * page-reload always restarts at step 0.
 *
 * Pattern: Custom-Observer-Store analog to useSceneStore.
 */
import { useEffect, useReducer } from "react";
import {
  type Song,
  type SongStep,
  type SongLoopMode,
  clampRepeatCount,
  getNextStep,
} from "@/utils/songSequencer";

const STORAGE_KEY = "ss-song-mode:v1";

interface SongModeState {
  songs: Song[];
  activeSongId: string | null;
  /** Step-Index des aktuell laufenden Pattern (0-based). */
  currentStepIdx: number;
  /** Wie oft die aktuelle Step-Sequenz bereits gespielt wurde (0-based). */
  currentRepeat: number;
  /** Pingpong-Richtung (+1 vorwärts, -1 rückwärts). */
  direction: 1 | -1;
}

type Listener = () => void;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultState(): SongModeState {
  return {
    songs: [],
    activeSongId: null,
    currentStepIdx: 0,
    currentRepeat: 0,
    direction: 1,
  };
}

function sanitizeSongs(raw: unknown): Song[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s): Song | null => {
      if (!s || typeof s !== "object") return null;
      const r = s as Partial<Song>;
      if (typeof r.id !== "string" || !r.id) return null;
      if (typeof r.name !== "string") return null;
      if (!Array.isArray(r.steps)) return null;
      const steps: SongStep[] = r.steps
        .map((st): SongStep | null => {
          if (!st || typeof st !== "object") return null;
          const x = st as Partial<SongStep>;
          if (typeof x.id !== "string" || !x.id) return null;
          if (typeof x.patternId !== "string" || !x.patternId) return null;
          const rep = clampRepeatCount(typeof x.repeatCount === "number" ? x.repeatCount : 1);
          return {
            id: x.id,
            patternId: x.patternId,
            repeatCount: rep,
            ...(typeof x.label === "string" ? { label: x.label } : {}),
          };
        })
        .filter((x): x is SongStep => x !== null);
      const loopMode: SongLoopMode =
        r.loopMode === "loop" || r.loopMode === "pingpong" || r.loopMode === "once"
          ? r.loopMode
          : "once";
      return { id: r.id, name: r.name, steps, loopMode };
    })
    .filter((x): x is Song => x !== null);
}

function load(): SongModeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { songs?: unknown; activeSongId?: unknown };
      const songs = sanitizeSongs(parsed.songs);
      const activeSongId =
        typeof parsed.activeSongId === "string" && songs.some(s => s.id === parsed.activeSongId)
          ? parsed.activeSongId
          : null;
      return { ...defaultState(), songs, activeSongId };
    }
  } catch {
    /* ignore */
  }
  return defaultState();
}

function persist(s: SongModeState): void {
  try {
    // Only persist songs + activeSongId — transport state is ephemeral
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ songs: s.songs, activeSongId: s.activeSongId })
    );
  } catch {
    /* ignore */
  }
}

let _state: SongModeState = load();
const _listeners = new Set<Listener>();
function notify(): void {
  _listeners.forEach(l => l());
}

// ─── Pure Getters (Test-friendly) ────────────────────────────────────────────

export function getSongModeState(): SongModeState {
  return _state;
}

export function getActiveSong(): Song | null {
  if (!_state.activeSongId) return null;
  return _state.songs.find(s => s.id === _state.activeSongId) ?? null;
}

// ─── Song CRUD ───────────────────────────────────────────────────────────────

export function addSong(name: string): string {
  const id = makeId("song");
  const trimmed = name.trim() || "Untitled Song";
  const song: Song = { id, name: trimmed, steps: [], loopMode: "once" };
  _state = { ..._state, songs: [..._state.songs, song] };
  persist(_state);
  notify();
  return id;
}

export function removeSong(songId: string): void {
  _state = {
    ..._state,
    songs: _state.songs.filter(s => s.id !== songId),
    activeSongId: _state.activeSongId === songId ? null : _state.activeSongId,
    currentStepIdx: _state.activeSongId === songId ? 0 : _state.currentStepIdx,
    currentRepeat: _state.activeSongId === songId ? 0 : _state.currentRepeat,
    direction: _state.activeSongId === songId ? 1 : _state.direction,
  };
  persist(_state);
  notify();
}

export function renameSong(songId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  _state = {
    ..._state,
    songs: _state.songs.map(s => (s.id === songId ? { ...s, name: trimmed } : s)),
  };
  persist(_state);
  notify();
}

export function setSongLoopMode(songId: string, loopMode: SongLoopMode): void {
  _state = {
    ..._state,
    songs: _state.songs.map(s => (s.id === songId ? { ...s, loopMode } : s)),
  };
  persist(_state);
  notify();
}

// ─── Step CRUD ───────────────────────────────────────────────────────────────

export function addStep(songId: string, patternId: string, repeatCount = 1): string | null {
  if (!patternId) return null;
  const newStep: SongStep = {
    id: makeId("step"),
    patternId,
    repeatCount: clampRepeatCount(repeatCount),
  };
  let added = false;
  _state = {
    ..._state,
    songs: _state.songs.map(s => {
      if (s.id !== songId) return s;
      added = true;
      return { ...s, steps: [...s.steps, newStep] };
    }),
  };
  if (!added) return null;
  persist(_state);
  notify();
  return newStep.id;
}

export function removeStep(songId: string, stepId: string): void {
  _state = {
    ..._state,
    songs: _state.songs.map(s =>
      s.id === songId ? { ...s, steps: s.steps.filter(st => st.id !== stepId) } : s
    ),
  };
  persist(_state);
  notify();
}

export function setStepRepeat(songId: string, stepId: string, repeatCount: number): void {
  const clamped = clampRepeatCount(repeatCount);
  _state = {
    ..._state,
    songs: _state.songs.map(s =>
      s.id === songId
        ? {
            ...s,
            steps: s.steps.map(st => (st.id === stepId ? { ...st, repeatCount: clamped } : st)),
          }
        : s
    ),
  };
  persist(_state);
  notify();
}

export function setStepPattern(songId: string, stepId: string, patternId: string): void {
  if (!patternId) return;
  _state = {
    ..._state,
    songs: _state.songs.map(s =>
      s.id === songId
        ? {
            ...s,
            steps: s.steps.map(st => (st.id === stepId ? { ...st, patternId } : st)),
          }
        : s
    ),
  };
  persist(_state);
  notify();
}

export function setStepLabel(songId: string, stepId: string, label: string): void {
  _state = {
    ..._state,
    songs: _state.songs.map(s =>
      s.id === songId
        ? {
            ...s,
            steps: s.steps.map(st =>
              st.id === stepId
                ? { ...st, ...(label ? { label } : { label: undefined }) }
                : st
            ),
          }
        : s
    ),
  };
  persist(_state);
  notify();
}

export function reorderStep(songId: string, fromIdx: number, toIdx: number): void {
  _state = {
    ..._state,
    songs: _state.songs.map(s => {
      if (s.id !== songId) return s;
      if (fromIdx < 0 || fromIdx >= s.steps.length) return s;
      if (toIdx < 0 || toIdx >= s.steps.length) return s;
      const arr = [...s.steps];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...s, steps: arr };
    }),
  };
  persist(_state);
  notify();
}

// ─── Transport ───────────────────────────────────────────────────────────────

export function setActiveSong(songId: string | null): void {
  if (songId !== null && !_state.songs.some(s => s.id === songId)) return;
  _state = {
    ..._state,
    activeSongId: songId,
    currentStepIdx: 0,
    currentRepeat: 0,
    direction: 1,
  };
  persist(_state);
  notify();
}

/** Setzt den Transport-Cursor zurück auf Step 0 / Repeat 0. */
export function resetTransport(): void {
  _state = { ..._state, currentStepIdx: 0, currentRepeat: 0, direction: 1 };
  notify();
}

/**
 * v3.117.0: Springt den Transport-Cursor direkt auf einen Step (per stepId).
 * Liefert die patternId des Ziels oder null wenn der Step im aktiven Song
 * nicht existiert. Reset des Repeat-Counters auf 0.
 */
export function jumpToStep(stepId: string): { patternId: string | null; ok: boolean } {
  const song = getActiveSong();
  if (!song) return { patternId: null, ok: false };
  const idx = song.steps.findIndex(s => s.id === stepId);
  if (idx === -1) return { patternId: null, ok: false };
  _state = { ..._state, currentStepIdx: idx, currentRepeat: 0, direction: 1 };
  notify();
  return { patternId: song.steps[idx].patternId, ok: true };
}

/**
 * v3.117.0: Liefert die stepId des aktuellen Cursor-Steps (oder null).
 */
export function getCurrentStepId(): string | null {
  const song = getActiveSong();
  if (!song) return null;
  return song.steps[_state.currentStepIdx]?.id ?? null;
}

/**
 * Advances the song by one pattern-loop. Returns the patternId that should
 * play next (and updates the cursor); returns null when the song has
 * finished in "once" mode.
 */
export function advance(): { patternId: string | null; isFinished: boolean } {
  const song = getActiveSong();
  if (!song || song.steps.length === 0) {
    return { patternId: null, isFinished: true };
  }
  const r = getNextStep(song, _state.currentStepIdx, _state.currentRepeat, _state.direction);
  if (r.isFinished) {
    _state = { ..._state, currentStepIdx: 0, currentRepeat: 0, direction: 1 };
    notify();
    return { patternId: null, isFinished: true };
  }
  _state = {
    ..._state,
    currentStepIdx: r.nextStepIdx,
    currentRepeat: r.nextRepeat,
    direction: r.direction,
  };
  notify();
  return { patternId: r.patternId, isFinished: false };
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useSongModeStore(): SongModeState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}

// ─── Test Helper ─────────────────────────────────────────────────────────────

export function __resetSongModeStoreForTests(): void {
  _state = defaultState();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

// Re-export shared types so consumers can avoid the deep import
export type { Song, SongStep, SongLoopMode } from "@/utils/songSequencer";
