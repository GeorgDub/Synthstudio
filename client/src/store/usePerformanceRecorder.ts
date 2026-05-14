/**
 * Synthstudio – usePerformanceRecorder (v2.15)
 *
 * Aufzeichnung & Wiedergabe von Performance-Aktionen mit relativer
 * Zeitachse. Im Unterschied zu useSessionRecordingStore (collab-events)
 * fokussiert dieser Store auf alles was der User **live** während des
 * Spielens auslöst:
 *
 *   - Pattern-Switch       (`type: "pattern"`,  data: { id })
 *   - Scene-Launch         (`type: "scene"`,    data: { id })
 *   - Macro-Set            (`type: "macro"`,    data: { index, value })
 *   - Mute/Solo            (`type: "mute"`/"solo", data: { partId, value })
 *   - Volume               (`type: "volume"`,   data: { partId, value })
 *   - Fx-Param             (`type: "fx"`,       data: { partId, key, value })
 *   - Transport            (`type: "play"`/"stop", data: {})
 *
 * Pure API getrennt von React-Hook (Modul-Singleton + Observer).
 * Persistenz: optional über localStorage (letzte Aufnahme).
 */
import { useEffect, useReducer } from "react";

export type PerfEventType =
  | "pattern" | "scene" | "macro" | "mute" | "solo"
  | "volume" | "fx" | "play" | "stop" | "param-lock" | "custom";

export interface PerfEvent {
  /** Millisekunden seit Aufnahmestart. */
  t: number;
  /** Event-Typ (siehe PerfEventType). */
  type: PerfEventType;
  /** Beliebige typabhängige Payload. */
  data?: Record<string, unknown>;
}

export interface PerformanceRecording {
  /** Eindeutige ID. */
  id: string;
  /** Anzeigename (default "Performance HH:MM:SS"). */
  name: string;
  /** Date.now() beim Aufzeichnungsstart. */
  startedAt: number;
  /** Gesamtdauer in ms. */
  durationMs: number;
  /** Geordnete Event-Liste. */
  events: PerfEvent[];
}

interface RecorderState {
  isRecording: boolean;
  isPlaying: boolean;
  /** Aktueller Recording-Buffer (während isRecording=true). */
  current: PerformanceRecording | null;
  /** Letzte abgeschlossene Aufnahme (für Playback / Export). */
  last: PerformanceRecording | null;
}

const STORAGE_KEY = "ss-performance-recorder:v1";

let _state: RecorderState = loadInitial();
const _listeners = new Set<() => void>();
const _playbackTimers: ReturnType<typeof setTimeout>[] = [];

function notify() { _listeners.forEach(l => l()); }

function loadInitial(): RecorderState {
  try {
    if (typeof localStorage === "undefined") return defaultState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as { last?: PerformanceRecording };
    if (parsed && typeof parsed === "object" && parsed.last && Array.isArray(parsed.last.events)) {
      return { ...defaultState(), last: sanitizeRecording(parsed.last) };
    }
  } catch { /* ignore */ }
  return defaultState();
}

function defaultState(): RecorderState {
  return { isRecording: false, isPlaying: false, current: null, last: null };
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (!_state.last) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ last: _state.last }));
  } catch { /* ignore */ }
}

function sanitizeRecording(rec: PerformanceRecording): PerformanceRecording {
  const events: PerfEvent[] = [];
  for (const ev of rec.events) {
    if (typeof ev?.t === "number" && typeof ev?.type === "string") {
      events.push({
        t: Math.max(0, ev.t),
        type: ev.type as PerfEventType,
        data: ev.data && typeof ev.data === "object" ? ev.data : undefined,
      });
    }
  }
  return {
    id: typeof rec.id === "string" ? rec.id : nextId(),
    name: typeof rec.name === "string" ? rec.name : "Performance",
    startedAt: typeof rec.startedAt === "number" ? rec.startedAt : Date.now(),
    durationMs: typeof rec.durationMs === "number" ? Math.max(0, rec.durationMs) : 0,
    events,
  };
}

function nextId(): string {
  return `perf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function timeNow(): number {
  // performance.now() in Browsern, Date.now() Fallback (Node-Tests).
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

// ─── Pure-API ────────────────────────────────────────────────────────────────

export function startRecording(name?: string): void {
  if (_state.isRecording) return;
  const startedAt = Date.now();
  _state = {
    ..._state,
    isRecording: true,
    isPlaying: false,
    current: {
      id: nextId(),
      name: name ?? `Performance ${new Date(startedAt).toLocaleTimeString()}`,
      startedAt,
      durationMs: 0,
      events: [],
    },
  };
  notify();
}

export function stopRecording(): PerformanceRecording | null {
  if (!_state.isRecording || !_state.current) return null;
  const finished: PerformanceRecording = {
    ..._state.current,
    durationMs: Math.max(_state.current.durationMs, lastEventTime(_state.current.events)),
  };
  _state = { ..._state, isRecording: false, current: null, last: finished };
  persist();
  notify();
  return finished;
}

export function recordEvent(type: PerfEventType, data?: Record<string, unknown>): void {
  if (!_state.isRecording || !_state.current) return;
  const t = Date.now() - _state.current.startedAt;
  const ev: PerfEvent = { t, type, data };
  _state.current.events.push(ev);
  _state.current.durationMs = t;
  // Kein notify() für jeden Event – das würde React-Renders fluten.
}

function lastEventTime(events: PerfEvent[]): number {
  return events.length === 0 ? 0 : events[events.length - 1].t;
}

export function clearRecording(): void {
  cancelPlaybackTimers();
  _state = { isRecording: false, isPlaying: false, current: null, last: null };
  persist();
  notify();
}

/**
 * Spielt die `last`-Aufnahme ab. `dispatch` wird pro Event aufgerufen –
 * typischerweise dispatcht der Aufrufer ein passendes window-event oder
 * ruft Store-Funktionen direkt.
 */
export function startPlayback(dispatch: (event: PerfEvent) => void): void {
  if (_state.isPlaying || !_state.last || _state.last.events.length === 0) return;
  const recording = _state.last;
  cancelPlaybackTimers();
  _state = { ..._state, isPlaying: true };
  notify();

  for (const ev of recording.events) {
    const tid = setTimeout(() => dispatch(ev), Math.max(0, ev.t));
    _playbackTimers.push(tid);
  }
  const endTid = setTimeout(() => {
    _state = { ..._state, isPlaying: false };
    notify();
  }, Math.max(0, recording.durationMs) + 10);
  _playbackTimers.push(endTid);
}

export function stopPlayback(): void {
  cancelPlaybackTimers();
  if (!_state.isPlaying) return;
  _state = { ..._state, isPlaying: false };
  notify();
}

function cancelPlaybackTimers(): void {
  while (_playbackTimers.length > 0) {
    const t = _playbackTimers.pop();
    if (t !== undefined) clearTimeout(t);
  }
}

export function exportRecording(): string | null {
  if (!_state.last) return null;
  return JSON.stringify(_state.last);
}

export function importRecording(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as PerformanceRecording;
    if (!parsed || !Array.isArray(parsed.events)) return false;
    _state = { ..._state, last: sanitizeRecording(parsed) };
    persist();
    notify();
    return true;
  } catch {
    return false;
  }
}

export function getRecorderState(): RecorderState {
  return _state;
}

export function __resetPerformanceRecorderForTests(): void {
  cancelPlaybackTimers();
  _state = defaultState();
  try { localStorage?.removeItem?.(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function usePerformanceRecorder(): RecorderState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

// `timeNow` wird aktuell nur intern genutzt — Export entfällt absichtlich,
// damit Tests die Zeit-Logik ausschließlich über Date.now() steuern.
void timeNow;
