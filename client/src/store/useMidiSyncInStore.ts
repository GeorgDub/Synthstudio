/**
 * Synthstudio — useMidiSyncInStore (v3.111.0)
 *
 * Custom-Observer-Store fuer MIDI-Sync-In-Config (Hardware-Master-Sync).
 * Pendant zu useMidiClickStore / useMidiNoteOutStore.
 *
 * localStorage-Key: `ss-midi-sync-in:v1` (Schema-v1, plain JSON).
 * Persistiert NUR Konfig-Werte — `detectedBpm` ist read-only state, wird
 * vom Engine-Bridge live ge-pushed (kein Persist, da volatil).
 *
 * Pattern: Modul-Singleton + Hook (analog useMidiClickStore).
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-midi-sync-in:v1";

export interface MidiSyncInState {
  /** Master-Schalter — wenn false, Engine ignoriert externe Clock. */
  enabled: boolean;
  /** Input-Device-ID fuer die Master-Source. null = "alle aktiven Inputs". */
  inputDeviceId: string | null;
  /** Auto-react auf 0xFA / 0xFC (sonst nur Tempo-only). */
  autoStartStop: boolean;
  /** Wenn true: detectedBpm wird in den internen `_bpm` der Engine geschrieben. */
  syncTempo: boolean;
  /**
   * Read-only state — vom Engine/Hook live aktualisiert via `setDetectedBpm()`.
   * Wird NICHT persistiert.
   */
  detectedBpm: number | null;
}

function defaultState(): MidiSyncInState {
  return {
    enabled: false,
    inputDeviceId: null,
    autoStartStop: true,
    syncTempo: true,
    detectedBpm: null,
  };
}

function loadState(): MidiSyncInState {
  if (typeof localStorage === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<MidiSyncInState> | null;
    if (!parsed || typeof parsed !== "object") return defaultState();
    const d = defaultState();
    return {
      enabled: parsed.enabled === true,
      inputDeviceId:
        typeof parsed.inputDeviceId === "string" && parsed.inputDeviceId.length > 0
          ? parsed.inputDeviceId
          : null,
      autoStartStop: parsed.autoStartStop !== false, // default true
      syncTempo: parsed.syncTempo !== false,         // default true
      // detectedBpm NIE aus Storage lesen — immer initial null.
      detectedBpm: null,
    };
  } catch {
    return defaultState();
  }
}

function persistableState(state: MidiSyncInState): Omit<MidiSyncInState, "detectedBpm"> {
  return {
    enabled: state.enabled,
    inputDeviceId: state.inputDeviceId,
    autoStartStop: state.autoStartStop,
    syncTempo: state.syncTempo,
  };
}

function saveState(state: MidiSyncInState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState(state)));
  } catch {
    /* ignore */
  }
}

let _state: MidiSyncInState = loadState();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((l) => l());
}

// ─── Public Getters / Actions ────────────────────────────────────────────────

export function getMidiSyncInState(): MidiSyncInState {
  return _state;
}

export function setMidiSyncInEnabled(enabled: boolean): void {
  if (_state.enabled === enabled) return;
  _state = { ..._state, enabled };
  if (!enabled) {
    // Auf disable: detectedBpm clearen, damit UI nicht stale-data zeigt.
    _state = { ..._state, detectedBpm: null };
  }
  saveState(_state);
  notify();
}

export function setMidiSyncInInputDevice(inputDeviceId: string | null): void {
  const normalized = inputDeviceId && inputDeviceId.length > 0 ? inputDeviceId : null;
  if (_state.inputDeviceId === normalized) return;
  _state = { ..._state, inputDeviceId: normalized };
  saveState(_state);
  notify();
}

export function setMidiSyncInAutoStartStop(autoStartStop: boolean): void {
  if (_state.autoStartStop === autoStartStop) return;
  _state = { ..._state, autoStartStop };
  saveState(_state);
  notify();
}

export function setMidiSyncInSyncTempo(syncTempo: boolean): void {
  if (_state.syncTempo === syncTempo) return;
  _state = { ..._state, syncTempo };
  saveState(_state);
  notify();
}

/**
 * Live-State-Push vom Engine-Bridge: setzt das aktuell detected BPM. Nicht
 * persistiert. Throttled auf Aenderung — Aufrufe mit identischem Wert sind
 * no-op (kein Re-Render-Spam pro Tick).
 */
export function setMidiSyncInDetectedBpm(bpm: number | null): void {
  // Nur signifikante Aenderungen propagieren (0.05 BPM Threshold).
  if (bpm === _state.detectedBpm) return;
  if (
    typeof bpm === "number" &&
    typeof _state.detectedBpm === "number" &&
    Math.abs(bpm - _state.detectedBpm) < 0.05
  ) {
    return;
  }
  _state = { ..._state, detectedBpm: bpm };
  notify();
}

/** Bulk-Set fuer Schema-Round-Trip-Restore. Garantiert clamp+sanitize. */
export function setMidiSyncInPartial(partial: Partial<MidiSyncInState>): void {
  const d = _state;
  _state = {
    enabled: typeof partial.enabled === "boolean" ? partial.enabled : d.enabled,
    inputDeviceId:
      partial.inputDeviceId !== undefined
        ? typeof partial.inputDeviceId === "string" && partial.inputDeviceId.length > 0
          ? partial.inputDeviceId
          : null
        : d.inputDeviceId,
    autoStartStop:
      typeof partial.autoStartStop === "boolean" ? partial.autoStartStop : d.autoStartStop,
    syncTempo: typeof partial.syncTempo === "boolean" ? partial.syncTempo : d.syncTempo,
    detectedBpm: d.detectedBpm,
  };
  saveState(_state);
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useMidiSyncInStore(): MidiSyncInState {
  const [, rerender] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}

// ─── Test Helper ─────────────────────────────────────────────────────────────

export function __resetMidiSyncInStoreForTests(): void {
  _state = defaultState();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
