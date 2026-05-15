/**
 * Synthstudio – useInspectorFloatStore (v2.46)
 *
 * Steuert ob der ChannelInspector als freies Floating-Panel angezeigt wird
 * (zusätzlich zur Dockview-Slot-Position). Modul-Singleton-Pattern wie die
 * anderen Stores.
 *
 * Persistenz: localStorage Key "ss-inspector-float:v1".
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-inspector-float:v1";

interface State {
  /** Ist das Floating-Inspector-Panel aktuell sichtbar? */
  open: boolean;
}

let _state: State = loadInitial();
const _listeners = new Set<() => void>();
function notify() { _listeners.forEach(l => l()); }

function loadInitial(): State {
  try {
    if (typeof localStorage === "undefined") return { open: false };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: false };
    const parsed = JSON.parse(raw) as { open?: boolean };
    return { open: typeof parsed?.open === "boolean" ? parsed.open : false };
  } catch {
    return { open: false };
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch { /* ignore */ }
}

export function openInspectorFloat(): void {
  if (_state.open) return;
  _state = { open: true };
  persist();
  notify();
}

export function closeInspectorFloat(): void {
  if (!_state.open) return;
  _state = { open: false };
  persist();
  notify();
}

export function toggleInspectorFloat(): void {
  _state = { open: !_state.open };
  persist();
  notify();
}

export function getInspectorFloatOpen(): boolean {
  return _state.open;
}

export function __resetInspectorFloatStoreForTests(): void {
  _state = { open: false };
  try { localStorage?.removeItem?.(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

export function useInspectorFloatStore(): State {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
