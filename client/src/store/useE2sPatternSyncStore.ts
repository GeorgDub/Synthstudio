/**
 * Synthstudio — useE2sPatternSyncStore (v3.232)
 *
 * Custom Observer Store fuer E2S Pattern Sync (Out).
 *
 * Wenn aktiv schickt Synthstudio bei jedem Pattern-Wechsel CC 32 (Bank LSB) +
 * Program Change an den ausgewaehlten MIDI-Output. Ziel: KORG Electribe 2 / 2S
 * mit Stock-Firmware (250 Patterns 0..249).
 *
 * Pattern-Index wird vom Caller bestimmt (i.d.R. patterns.findIndex(p => p.id ===
 * activePatternId) aus useDrumMachineStore).
 *
 * Persistenz: localStorage, NICHT im .synth-Schema (User-Preference, kein
 * Projekt-Setup). localStorage-Key: synthstudio:e2s-pattern-sync:v1.
 *
 * Pattern: Modul-Singleton + Hook (analog useMidiClickStore v3.98).
 */
import { useEffect, useReducer } from "react";
import { clampChannel } from "../utils/korg/e2sPatternOut";

const STORAGE_KEY = "synthstudio:e2s-pattern-sync:v1";

export interface E2sPatternSyncState {
  enabled: boolean;
  outputPortId: string | null;
  channel: number; // 0..15
}

function defaultState(): E2sPatternSyncState {
  return {
    enabled: false,
    outputPortId: null,
    channel: 0,
  };
}

function loadState(): E2sPatternSyncState {
  if (typeof localStorage === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<E2sPatternSyncState> | null;
    if (!parsed || typeof parsed !== "object") return defaultState();
    return {
      enabled: parsed.enabled === true,
      outputPortId:
        typeof parsed.outputPortId === "string" && parsed.outputPortId.length > 0
          ? parsed.outputPortId
          : null,
      channel:
        typeof parsed.channel === "number" ? clampChannel(parsed.channel) : 0,
    };
  } catch {
    return defaultState();
  }
}

function persist(state: E2sPatternSyncState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / Privacy-Mode — silent ignore.
  }
}

// Modul-Singleton.
let _state: E2sPatternSyncState = loadState();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((fn) => fn());
}

// ─── Public Getter / Setter (Hook-frei, fuer App.tsx-Wiring) ──────────────

export function getE2sPatternSyncState(): E2sPatternSyncState {
  return _state;
}

export function setE2sPatternSyncEnabled(enabled: boolean): void {
  if (_state.enabled === enabled) return;
  _state = { ..._state, enabled };
  persist(_state);
  notify();
}

export function setE2sPatternSyncOutputPort(outputPortId: string | null): void {
  const next = outputPortId && outputPortId.length > 0 ? outputPortId : null;
  if (_state.outputPortId === next) return;
  _state = { ..._state, outputPortId: next };
  persist(_state);
  notify();
}

export function setE2sPatternSyncChannel(channel: number): void {
  const clamped = clampChannel(channel);
  if (_state.channel === clamped) return;
  _state = { ..._state, channel: clamped };
  persist(_state);
  notify();
}

/** Test-only Reset. */
export function __resetE2sPatternSyncForTests(): void {
  _state = defaultState();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

// ─── React Hook ────────────────────────────────────────────────────────────

export interface E2sPatternSyncStoreApi extends E2sPatternSyncState {
  setEnabled: (enabled: boolean) => void;
  setOutputPort: (id: string | null) => void;
  setChannel: (channel: number) => void;
}

export function useE2sPatternSyncStore(): E2sPatternSyncStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return {
    ..._state,
    setEnabled: setE2sPatternSyncEnabled,
    setOutputPort: setE2sPatternSyncOutputPort,
    setChannel: setE2sPatternSyncChannel,
  };
}
