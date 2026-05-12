/**
 * Synthstudio – useSessionRecordingStore
 *
 * Aufzeichnung aller Kollaborations-Ereignisse einer Session.
 * Events werden mit relativem Zeitstempel (ms seit Aufnahmestart) gespeichert.
 * Wiedergabe: Events werden nach Delay wiederholt (setTimeout-basiert).
 *
 * Verwendung:
 *   const rec = useSessionRecordingStore();
 *   rec.startRecording();                 // bei Session-Start
 *   recordEvent({ type: "step:toggle", ... }); // bei jedem Collab-Event
 *   rec.stopRecording();
 *   rec.startPlayback(broadcast);         // wiederholt alle Events
 */
import { useEffect, useReducer } from "react";

export interface RecordedEvent {
  /** Millisekunden seit Aufnahmestart */
  offset: number;
  /** Event-Payload (gleicher Typ wie CollabEvent) */
  payload: Record<string, unknown>;
}

interface RecordingState {
  isRecording: boolean;
  isPlaying: boolean;
  events: RecordedEvent[];
  /** Startzeitpunkt der aktuellen Aufnahme (Date.now()) */
  startTime: number | null;
  /** Dauer der aufgezeichneten Session in ms */
  duration: number;
}

type Listener = () => void;

let _state: RecordingState = {
  isRecording: false,
  isPlaying: false,
  events: [],
  startTime: null,
  duration: 0,
};

const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

const _playbackTimers: ReturnType<typeof setTimeout>[] = [];

export function startRecording(): void {
  if (_state.isRecording) return;
  _state = { ..._state, isRecording: true, events: [], startTime: Date.now(), duration: 0 };
  notify();
}

export function stopRecording(): void {
  if (!_state.isRecording) return;
  const duration = _state.startTime ? Date.now() - _state.startTime : 0;
  _state = { ..._state, isRecording: false, startTime: null, duration };
  notify();
}

export function recordEvent(payload: Record<string, unknown>): void {
  if (!_state.isRecording || !_state.startTime) return;
  const offset = Date.now() - _state.startTime;
  _state = { ..._state, events: [..._state.events, { offset, payload }] };
  // Kein notify() hier für Performance (nur UI-unabhängige Daten)
}

export function clearRecording(): void {
  _playbackTimers.forEach(clearTimeout);
  _playbackTimers.length = 0;
  _state = { isRecording: false, isPlaying: false, events: [], startTime: null, duration: 0 };
  notify();
}

export function startPlayback(broadcast: (event: Record<string, unknown>) => void): void {
  if (_state.isPlaying || _state.events.length === 0) return;
  _state = { ..._state, isPlaying: true };
  notify();

  _state.events.forEach(ev => {
    const t = setTimeout(() => broadcast(ev.payload), ev.offset);
    _playbackTimers.push(t);
  });

  // Automatisch stoppen nach Duration
  const endTimer = setTimeout(() => {
    _state = { ..._state, isPlaying: false };
    notify();
  }, _state.duration);
  _playbackTimers.push(endTimer);
}

export function stopPlayback(): void {
  _playbackTimers.forEach(clearTimeout);
  _playbackTimers.length = 0;
  _state = { ..._state, isPlaying: false };
  notify();
}

export function getRecordingState(): RecordingState { return _state; }

export function useSessionRecordingStore(): RecordingState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
