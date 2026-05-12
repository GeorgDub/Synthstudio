/**
 * Synthstudio – useApiSettingsStore
 *
 * Speichert API-Keys und KI-Einstellungen (localStorage, niemals in Git).
 * Aktuell: Anthropic Claude API Key für den AI Beat Co-Pilot.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-api-settings:v1";

interface ApiSettings {
  anthropicApiKey: string;
  aiModel: string;
  aiEnabled: boolean;
  /** Auto-Save aktiv (Projekt alle 3 Min. cachen) */
  autoSaveEnabled: boolean;
  /** Version-Snapshots aktiv (alle 5 Min.) */
  snapshotsEnabled: boolean;
  /** Auto-Save-Intervall in Minuten */
  autoSaveIntervalMin: number;
}

type Listener = () => void;

function load(): ApiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaults();
}

function defaults(): ApiSettings {
  return {
    anthropicApiKey: "",
    aiModel: "claude-haiku-4-5-20251001",
    aiEnabled: false,
    autoSaveEnabled: true,
    snapshotsEnabled: true,
    autoSaveIntervalMin: 3,
  };
}

function persist(s: ApiSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let _state: ApiSettings = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function setApiKey(key: string): void {
  _state = { ..._state, anthropicApiKey: key.trim(), aiEnabled: key.trim().length > 0 };
  persist(_state);
  notify();
}

export function setAiModel(model: string): void {
  _state = { ..._state, aiModel: model };
  persist(_state);
  notify();
}

export function setAutoSaveEnabled(enabled: boolean): void {
  _state = { ..._state, autoSaveEnabled: enabled };
  persist(_state);
  notify();
}

export function setSnapshotsEnabled(enabled: boolean): void {
  _state = { ..._state, snapshotsEnabled: enabled };
  persist(_state);
  notify();
}

export function setAutoSaveInterval(minutes: number): void {
  _state = { ..._state, autoSaveIntervalMin: Math.max(1, Math.min(60, minutes)) };
  persist(_state);
  notify();
}

export function getApiSettings(): ApiSettings { return _state; }

export function useApiSettingsStore(): ApiSettings {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
