/**
 * Synthstudio – useTempoMapStore (v3.95.0 / Schema v1.35)
 *
 * Tempo-Map / BPM-Automation. DAW-Standard: BPM kann sich ueber die Song-Position
 * aendern (Bar 16: 120 BPM, Bar 32: ramp 130 -> 100, etc.).
 *
 * Pattern: Modul-Singleton + React-Hook (analog useMorphStore / useSceneStore).
 * Persistenz: localStorage (langlebige Tempo-Map pro User-Session).
 *
 * Backward-Compat: Bei leerer events-Liste liefert getCurrentBpm() das
 * Fallback-BPM (statisches Verhalten wie pre-v3.95.0).
 *
 * Schema v1.35: persistiert via projectSerializer als optional-Feld `tempoMap`.
 * Pre-v1.35-Files haben das Feld nicht -> parseProject laesst tempoMap undefined.
 */
import { useEffect, useReducer } from "react";

// ─── Konstanten ───────────────────────────────────────────────────────────────

export const MAX_TEMPO_EVENTS = 32;
export const MIN_BPM = 20;
export const MAX_BPM = 300;

const STORAGE_KEY = "ss-tempo-map:v1";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface TempoEvent {
  /** Bar-Position (0-basiert). Float erlaubt fuer Sub-Bar-Aufloesung. */
  atBar: number;
  /** Ziel-BPM bei diesem Event. */
  bpm: number;
  /**
   * Wenn true: linear vom vorigen Event zum naechsten interpolieren.
   * Wenn false oder undefined: harter Sprung am Event-Punkt.
   */
  ramp?: boolean;
}

export interface TempoMapState {
  events: TempoEvent[];
}

export interface TempoMapActions {
  addEvent: (atBar: number, bpm: number, ramp?: boolean) => void;
  removeEvent: (atBar: number) => void;
  setEventBpm: (atBar: number, bpm: number) => void;
  setEventRamp: (atBar: number, ramp: boolean) => void;
  clear: () => void;
}

// ─── Sanitizer ────────────────────────────────────────────────────────────────

function _clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

function _clampBar(bar: number): number {
  if (!Number.isFinite(bar)) return 0;
  return Math.max(0, bar);
}

function _sortEvents(events: TempoEvent[]): TempoEvent[] {
  return [...events].sort((a, b) => a.atBar - b.atBar);
}

// ─── Modul-Singleton ──────────────────────────────────────────────────────────

const DEFAULT_STATE: TempoMapState = { events: [] };

let _state: TempoMapState = _load();

type Listener = () => void;
const _listeners = new Set<Listener>();

function _notify(): void {
  _listeners.forEach((fn) => fn());
}

function _load(): TempoMapState {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_STATE };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.events)) return { ...DEFAULT_STATE };
    const events = parsed.events
      .filter(
        (e: unknown): e is TempoEvent =>
          !!e &&
          typeof e === "object" &&
          typeof (e as TempoEvent).atBar === "number" &&
          typeof (e as TempoEvent).bpm === "number"
      )
      .map((e: TempoEvent) => ({
        atBar: _clampBar(e.atBar),
        bpm: _clampBpm(e.bpm),
        ramp: e.ramp === true,
      }))
      .slice(0, MAX_TEMPO_EVENTS);
    return { events: _sortEvents(events) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function _persist(state: TempoMapState): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage nicht verfuegbar / quota voll – silent fallback
  }
}

// ─── Public Getters ──────────────────────────────────────────────────────────

export function getTempoMapState(): TempoMapState {
  return { events: [..._state.events] };
}

/** Nur fuer Unit-Tests – nicht in Produktion aufrufen. */
export function __resetTempoMapForTests(): void {
  _state = { ...DEFAULT_STATE };
  _persist(_state);
  _listeners.clear();
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Fuegt ein Event hinzu. Wenn bei atBar bereits ein Event existiert,
 * wird es ueberschrieben (idempotent pro Bar-Position).
 * Max MAX_TEMPO_EVENTS – darueber hinaus: no-op (silent ignore).
 */
export function addEvent(atBar: number, bpm: number, ramp?: boolean): void {
  const clampedBar = _clampBar(atBar);
  const clampedBpm = _clampBpm(bpm);
  const existing = _state.events.findIndex((e) => e.atBar === clampedBar);
  let nextEvents: TempoEvent[];
  if (existing >= 0) {
    nextEvents = _state.events.map((e, i) =>
      i === existing ? { atBar: clampedBar, bpm: clampedBpm, ramp: ramp === true } : e
    );
  } else {
    if (_state.events.length >= MAX_TEMPO_EVENTS) return;
    nextEvents = [..._state.events, { atBar: clampedBar, bpm: clampedBpm, ramp: ramp === true }];
  }
  _state = { events: _sortEvents(nextEvents) };
  _persist(_state);
  _notify();
}

export function removeEvent(atBar: number): void {
  const next = _state.events.filter((e) => e.atBar !== atBar);
  if (next.length === _state.events.length) return;
  _state = { events: next };
  _persist(_state);
  _notify();
}

export function setEventBpm(atBar: number, bpm: number): void {
  const clampedBpm = _clampBpm(bpm);
  let changed = false;
  const next = _state.events.map((e) => {
    if (e.atBar === atBar && e.bpm !== clampedBpm) {
      changed = true;
      return { ...e, bpm: clampedBpm };
    }
    return e;
  });
  if (!changed) return;
  _state = { events: next };
  _persist(_state);
  _notify();
}

export function setEventRamp(atBar: number, ramp: boolean): void {
  let changed = false;
  const next = _state.events.map((e) => {
    if (e.atBar === atBar && e.ramp !== ramp) {
      changed = true;
      return { ...e, ramp };
    }
    return e;
  });
  if (!changed) return;
  _state = { events: next };
  _persist(_state);
  _notify();
}

export function clear(): void {
  if (_state.events.length === 0) return;
  _state = { events: [] };
  _persist(_state);
  _notify();
}

/**
 * Replace komplette Event-Liste (z.B. beim Project-Load). Sortiert + clamped.
 * Backward-Compat fuer .synth-Restore.
 */
export function replaceEvents(events: TempoEvent[]): void {
  const sanitized = (events || [])
    .filter((e) => e && typeof e.atBar === "number" && typeof e.bpm === "number")
    .map((e) => ({
      atBar: _clampBar(e.atBar),
      bpm: _clampBpm(e.bpm),
      ramp: e.ramp === true,
    }))
    .slice(0, MAX_TEMPO_EVENTS);
  _state = { events: _sortEvents(sanitized) };
  _persist(_state);
  _notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useTempoMapStore(): TempoMapState & TempoMapActions {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    events: _state.events,
    addEvent,
    removeEvent,
    setEventBpm,
    setEventRamp,
    clear,
  };
}
