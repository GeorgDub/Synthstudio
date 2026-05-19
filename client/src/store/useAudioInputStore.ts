/**
 * Synthstudio – useAudioInputStore.ts (v3.113.0)
 *
 * State-Management für External-Audio-Input-Recording (Mic / Synth / Line-In).
 *
 * Differs from useLiveInputStore.ts:
 *  - useLiveInputStore = Outboard-FX-Box-Modus (mehrere Channels mit FX-Chain,
 *    auf den Master mixed). KORG → Synthstudio FX → out.
 *  - useAudioInputStore = SINGLE-Stream-Capture-Modus (Mic → Synthstudio-Aufnahme,
 *    optionaler Monitor, optional in LiveRecorder gemixt). Mic → WAV-File.
 *
 * Architektur: Custom Observer Store (analog useMidiSyncInStore /
 * useLiveInputStore). KEIN Zustand-npm-Package.
 *
 * localStorage: `ss-audio-input:v1`
 *  Persistiert: selectedDeviceId, monitorEnabled, monitorGain,
 *               recordSyncWithTransport, inputGain, route.
 *  NICHT persistiert: recording-State (always false on load).
 */

import { useEffect, useReducer } from "react";

// ─── Typen ───────────────────────────────────────────────────────────────────

export type AudioInputRoute = "master" | "live-recorder" | "both";

export interface AudioInputState {
  selectedDeviceId: string | null;
  monitorEnabled: boolean;
  /** 0..2 — Monitor-Gain (Hör-Through). */
  monitorGain: number;
  /** Start input recording auto when playback starts. */
  recordSyncWithTransport: boolean;
  /** 0..2 — Input-Gain pre-capture. */
  inputGain: number;
  /** Routing-Ziel des Streams. */
  route: AudioInputRoute;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-audio-input:v1";

const DEFAULT_STATE: AudioInputState = {
  selectedDeviceId: null,
  monitorEnabled: false,
  monitorGain: 0.5,
  recordSyncWithTransport: false,
  inputGain: 1.0,
  route: "master",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeDeviceId(id: unknown): string | null {
  if (id === null || id === undefined) return null;
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRoute(r: unknown): AudioInputRoute {
  if (r === "master" || r === "live-recorder" || r === "both") return r;
  return "master";
}

function sanitize(raw: unknown): AudioInputState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  const o = raw as Record<string, unknown>;
  return {
    selectedDeviceId: normalizeDeviceId(o.selectedDeviceId),
    monitorEnabled: typeof o.monitorEnabled === "boolean" ? o.monitorEnabled : DEFAULT_STATE.monitorEnabled,
    monitorGain: clamp(typeof o.monitorGain === "number" ? o.monitorGain : DEFAULT_STATE.monitorGain, 0, 2),
    recordSyncWithTransport: typeof o.recordSyncWithTransport === "boolean"
      ? o.recordSyncWithTransport
      : DEFAULT_STATE.recordSyncWithTransport,
    inputGain: clamp(typeof o.inputGain === "number" ? o.inputGain : DEFAULT_STATE.inputGain, 0, 2),
    route: normalizeRoute(o.route),
  };
}

function loadState(): AudioInputState {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_STATE };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch { /* quota — ignore */ }
}

// ─── Singleton-State + Listener-Set ──────────────────────────────────────────

let _state: AudioInputState = loadState();
type Listener = () => void;
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach(l => {
    try { l(); } catch { /* ignore */ }
  });
}

// ─── Public-Setters ──────────────────────────────────────────────────────────

export function getAudioInputState(): AudioInputState {
  return _state;
}

export function setAudioInputDevice(deviceId: string | null): void {
  const normalized = normalizeDeviceId(deviceId);
  if (_state.selectedDeviceId === normalized) return;
  _state = { ..._state, selectedDeviceId: normalized };
  persist();
  notify();
}

export function setAudioInputMonitorEnabled(enabled: boolean): void {
  if (_state.monitorEnabled === enabled) return;
  _state = { ..._state, monitorEnabled: enabled };
  persist();
  notify();
}

export function setAudioInputMonitorGain(gain: number): void {
  const clamped = clamp(gain, 0, 2);
  if (Math.abs(_state.monitorGain - clamped) < 0.001) return;
  _state = { ..._state, monitorGain: clamped };
  persist();
  notify();
}

export function setAudioInputRecordSyncWithTransport(sync: boolean): void {
  if (_state.recordSyncWithTransport === sync) return;
  _state = { ..._state, recordSyncWithTransport: sync };
  persist();
  notify();
}

export function setAudioInputInputGain(gain: number): void {
  const clamped = clamp(gain, 0, 2);
  if (Math.abs(_state.inputGain - clamped) < 0.001) return;
  _state = { ..._state, inputGain: clamped };
  persist();
  notify();
}

export function setAudioInputRoute(route: AudioInputRoute): void {
  const normalized = normalizeRoute(route);
  if (_state.route === normalized) return;
  _state = { ..._state, route: normalized };
  persist();
  notify();
}

/** Bulk-Setter für Project-Load / Migrations. */
export function setAudioInputPartial(patch: Partial<AudioInputState>): void {
  const merged: AudioInputState = {
    selectedDeviceId: patch.selectedDeviceId !== undefined
      ? normalizeDeviceId(patch.selectedDeviceId)
      : _state.selectedDeviceId,
    monitorEnabled: typeof patch.monitorEnabled === "boolean"
      ? patch.monitorEnabled
      : _state.monitorEnabled,
    monitorGain: typeof patch.monitorGain === "number"
      ? clamp(patch.monitorGain, 0, 2)
      : _state.monitorGain,
    recordSyncWithTransport: typeof patch.recordSyncWithTransport === "boolean"
      ? patch.recordSyncWithTransport
      : _state.recordSyncWithTransport,
    inputGain: typeof patch.inputGain === "number"
      ? clamp(patch.inputGain, 0, 2)
      : _state.inputGain,
    route: patch.route !== undefined ? normalizeRoute(patch.route) : _state.route,
  };
  _state = merged;
  persist();
  notify();
}

/** Test-Helper — vollständiger Reset inkl. localStorage. */
export function __resetAudioInputStoreForTests(): void {
  _state = { ...DEFAULT_STATE };
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export interface AudioInputStoreApi extends AudioInputState {
  setDevice: (id: string | null) => void;
  setMonitorEnabled: (e: boolean) => void;
  setMonitorGain: (g: number) => void;
  setRecordSyncWithTransport: (s: boolean) => void;
  setInputGain: (g: number) => void;
  setRoute: (r: AudioInputRoute) => void;
}

export function useAudioInputStore(): AudioInputStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return {
    ..._state,
    setDevice: setAudioInputDevice,
    setMonitorEnabled: setAudioInputMonitorEnabled,
    setMonitorGain: setAudioInputMonitorGain,
    setRecordSyncWithTransport: setAudioInputRecordSyncWithTransport,
    setInputGain: setAudioInputInputGain,
    setRoute: setAudioInputRoute,
  };
}
