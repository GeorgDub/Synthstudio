/**
 * Synthstudio – useSongJumpStore (v3.117.0)
 *
 * Per-Song conditional jumps that extend the linear Song-Mode (v3.109).
 *
 * A Jump defines an alternate transition between two song-steps; when the
 * Song-Sequencer is about to advance from `fromStepId` and the jump's
 * condition evaluates to true, the sequencer jumps to `toStepId` instead.
 *
 * Persistence: localStorage "ss-song-jumps:v1" — full map (songId → jumps[]).
 * MIDI events (lastMidiNote / lastMidiCc) are NOT persisted — they live in
 * the AudioEngine/MIDI-Hook layer.
 *
 * Pattern: Custom-Observer-Store analog to useSongModeStore.
 */
import { useEffect, useReducer } from "react";
import type { Jump, JumpCondition } from "@/utils/songJumpLogic";

const STORAGE_KEY = "ss-song-jumps:v1";

interface SongJumpState {
  /** Map songId → Jump[] */
  jumpsBySong: Record<string, Jump[]>;
}

type Listener = () => void;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultState(): SongJumpState {
  return { jumpsBySong: {} };
}

function sanitizeCondition(raw: unknown): JumpCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<JumpCondition> & { kind?: string };
  switch (r.kind) {
    case "always":
      return { kind: "always" };
    case "macro-above":
    case "macro-below": {
      const cAny = r as { macroIdx?: unknown; threshold?: unknown };
      const idx = typeof cAny.macroIdx === "number" ? Math.floor(cAny.macroIdx) : -1;
      const thr = typeof cAny.threshold === "number" ? cAny.threshold : -1;
      if (idx < 0 || idx > 7) return null;
      if (!Number.isFinite(thr) || thr < 0 || thr > 1) return null;
      return { kind: r.kind, macroIdx: idx, threshold: thr };
    }
    case "midi-note": {
      const cAny = r as { note?: unknown; channel?: unknown };
      const note = typeof cAny.note === "number" ? Math.floor(cAny.note) : -1;
      if (note < 0 || note > 127) return null;
      const out: JumpCondition = { kind: "midi-note", note };
      if (typeof cAny.channel === "number") {
        const ch = Math.floor(cAny.channel);
        if (ch >= 0 && ch <= 15) out.channel = ch;
      }
      return out;
    }
    case "midi-cc": {
      const cAny = r as { cc?: unknown; valueAbove?: unknown };
      const cc = typeof cAny.cc === "number" ? Math.floor(cAny.cc) : -1;
      const va = typeof cAny.valueAbove === "number" ? Math.floor(cAny.valueAbove) : -1;
      if (cc < 0 || cc > 127) return null;
      if (va < 0 || va > 127) return null;
      return { kind: "midi-cc", cc, valueAbove: va };
    }
    default:
      return null;
  }
}

function sanitizeJumps(raw: unknown): Jump[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((j): Jump | null => {
      if (!j || typeof j !== "object") return null;
      const r = j as Partial<Jump>;
      if (typeof r.id !== "string" || !r.id) return null;
      if (typeof r.fromStepId !== "string" || !r.fromStepId) return null;
      if (typeof r.toStepId !== "string" || !r.toStepId) return null;
      const cond = sanitizeCondition(r.condition);
      if (!cond) return null;
      return {
        id: r.id,
        fromStepId: r.fromStepId,
        toStepId: r.toStepId,
        condition: cond,
        ...(typeof r.label === "string" && r.label ? { label: r.label } : {}),
      };
    })
    .filter((x): x is Jump => x !== null);
}

function sanitizeMap(raw: unknown): Record<string, Jump[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Jump[]> = {};
  for (const [songId, value] of Object.entries(raw)) {
    if (typeof songId !== "string" || !songId) continue;
    const jumps = sanitizeJumps(value);
    if (jumps.length > 0) out[songId] = jumps;
  }
  return out;
}

function load(): SongJumpState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { jumpsBySong?: unknown };
      return { jumpsBySong: sanitizeMap(parsed.jumpsBySong) };
    }
  } catch {
    /* ignore */
  }
  return defaultState();
}

function persist(s: SongJumpState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ jumpsBySong: s.jumpsBySong }));
  } catch {
    /* ignore */
  }
}

let _state: SongJumpState = load();
const _listeners = new Set<Listener>();
function notify(): void {
  _listeners.forEach(l => l());
}

// ─── Getters ─────────────────────────────────────────────────────────────────

export function getSongJumpState(): SongJumpState {
  return _state;
}

export function getJumpsForSong(songId: string): Jump[] {
  if (!songId) return [];
  return _state.jumpsBySong[songId] ?? [];
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function addJump(
  songId: string,
  jump: Omit<Jump, "id">
): string | null {
  if (!songId) return null;
  if (!jump || typeof jump !== "object") return null;
  if (!jump.fromStepId || !jump.toStepId) return null;
  const cond = sanitizeCondition(jump.condition);
  if (!cond) return null;
  const id = makeId("jump");
  const newJump: Jump = {
    id,
    fromStepId: jump.fromStepId,
    toStepId: jump.toStepId,
    condition: cond,
    ...(typeof jump.label === "string" && jump.label ? { label: jump.label } : {}),
  };
  const prev = _state.jumpsBySong[songId] ?? [];
  _state = {
    ..._state,
    jumpsBySong: { ..._state.jumpsBySong, [songId]: [...prev, newJump] },
  };
  persist(_state);
  notify();
  return id;
}

export function removeJump(songId: string, jumpId: string): void {
  if (!songId || !jumpId) return;
  const prev = _state.jumpsBySong[songId];
  if (!prev) return;
  const next = prev.filter(j => j.id !== jumpId);
  const map = { ..._state.jumpsBySong };
  if (next.length === 0) {
    delete map[songId];
  } else {
    map[songId] = next;
  }
  _state = { ..._state, jumpsBySong: map };
  persist(_state);
  notify();
}

export function updateJump(
  songId: string,
  jumpId: string,
  partial: Partial<Omit<Jump, "id">>
): void {
  if (!songId || !jumpId) return;
  const prev = _state.jumpsBySong[songId];
  if (!prev) return;
  let changed = false;
  const next = prev.map(j => {
    if (j.id !== jumpId) return j;
    changed = true;
    const updated: Jump = { ...j };
    if (typeof partial.fromStepId === "string" && partial.fromStepId)
      updated.fromStepId = partial.fromStepId;
    if (typeof partial.toStepId === "string" && partial.toStepId)
      updated.toStepId = partial.toStepId;
    if (partial.condition !== undefined) {
      const cond = sanitizeCondition(partial.condition);
      if (cond) updated.condition = cond;
    }
    if (partial.label !== undefined) {
      if (typeof partial.label === "string" && partial.label) {
        updated.label = partial.label;
      } else {
        delete updated.label;
      }
    }
    return updated;
  });
  if (!changed) return;
  _state = {
    ..._state,
    jumpsBySong: { ..._state.jumpsBySong, [songId]: next },
  };
  persist(_state);
  notify();
}

/** Removes all jumps that reference a given step (either as from or to). */
export function removeJumpsReferencingStep(songId: string, stepId: string): void {
  if (!songId || !stepId) return;
  const prev = _state.jumpsBySong[songId];
  if (!prev) return;
  const next = prev.filter(j => j.fromStepId !== stepId && j.toStepId !== stepId);
  if (next.length === prev.length) return;
  const map = { ..._state.jumpsBySong };
  if (next.length === 0) {
    delete map[songId];
  } else {
    map[songId] = next;
  }
  _state = { ..._state, jumpsBySong: map };
  persist(_state);
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useSongJumpStore(): SongJumpState {
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

export function __resetSongJumpStoreForTests(): void {
  _state = defaultState();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

// Re-export the type so consumers can import from a single place
export type { Jump, JumpCondition } from "@/utils/songJumpLogic";
