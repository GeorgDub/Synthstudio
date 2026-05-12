/**
 * Synthstudio – useKeyboardBindingsStore
 *
 * Persistiert benutzerdefinierte Tastenbelegungen (ActionId → KeyCombo).
 * Nicht gesetzte Actions verwenden den Default aus ACTIONS.
 */
import { useEffect, useReducer } from "react";
import type { KeyCombo } from "@/hooks/keyboardActionDefs";

const STORAGE_KEY = "ss-keyboard-bindings:v1";

type Bindings = Record<string, KeyCombo>; // actionId → override combo

interface State { bindings: Bindings }

type Listener = () => void;

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { bindings: JSON.parse(raw) };
  } catch { /* ignore */ }
  return { bindings: {} };
}

function persist(state: State) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.bindings)); } catch { /* ignore */ }
}

let _state: State = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function setBinding(actionId: string, combo: KeyCombo): void {
  _state = { bindings: { ..._state.bindings, [actionId]: combo } };
  persist(_state);
  notify();
}

export function clearBinding(actionId: string): void {
  const { [actionId]: _, ...rest } = _state.bindings;
  _state = { bindings: rest };
  persist(_state);
  notify();
}

export function getBinding(actionId: string): KeyCombo | undefined {
  return _state.bindings[actionId];
}

export function getAllBindings(): Bindings {
  return _state.bindings;
}

export function useKeyboardBindingsStore(): { bindings: Bindings } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { bindings: _state.bindings };
}
