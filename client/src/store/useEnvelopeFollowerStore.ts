/**
 * Synthstudio – useEnvelopeFollowerStore
 *
 * Envelope Follower: Audio-Level eines Kanals als Modulations-Quelle.
 * Konfigurierbar: Quell-Part → Ziel-Part + Parameter + Menge.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-envelope-follower:v1";

export type EnvelopeTarget = "volume" | "pan" | "filterFreq" | "reverbMix" | "delayMix";

export interface EnvelopeFollowerConfig {
  id: string;
  enabled: boolean;
  /** Part-ID des Audio-Signals das verfolgt wird */
  sourcePartId: string;
  sourcePartName: string;
  /** Part-ID das moduliert wird */
  targetPartId: string;
  targetPartName: string;
  /** Zu modulierender Parameter */
  target: EnvelopeTarget;
  /** Modulationsstärke 0–1 */
  amount: number;
  /** Attack-Zeit in ms (wie schnell der Follower anspricht) */
  attackMs: number;
  /** Release-Zeit in ms (wie schnell der Follower abfällt) */
  releaseMs: number;
}

export interface EnvelopeFollowerState {
  configs: EnvelopeFollowerConfig[];
}

type Listener = () => void;

function makeId() {
  return `ef-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

function load(): EnvelopeFollowerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { configs: [] };
}

function persist(s: EnvelopeFollowerState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let _state: EnvelopeFollowerState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function addEnvelopeFollower(config: Omit<EnvelopeFollowerConfig, "id">): string {
  const id = makeId();
  _state = { ..._state, configs: [..._state.configs, { ...config, id }] };
  persist(_state); notify();
  return id;
}

export function removeEnvelopeFollower(id: string): void {
  _state = { ..._state, configs: _state.configs.filter(c => c.id !== id) };
  persist(_state); notify();
}

export function updateEnvelopeFollower(id: string, changes: Partial<Omit<EnvelopeFollowerConfig, "id">>): void {
  _state = { ..._state, configs: _state.configs.map(c => c.id === id ? { ...c, ...changes } : c) };
  persist(_state); notify();
}

export function getEnvelopeFollowerConfigs(): EnvelopeFollowerConfig[] {
  return _state.configs;
}

export function useEnvelopeFollowerStore(): EnvelopeFollowerState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
