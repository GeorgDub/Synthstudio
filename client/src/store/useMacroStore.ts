/**
 * Synthstudio – useMacroStore
 *
 * 8 Makro-Knöpfe die beliebig viele Parameter gleichzeitig steuern.
 * Jede Binding mappt einen Makro-Wert (0–1) auf einen Parameter-Bereich.
 *
 * Target-Typen:
 *  "channel-vol"   → Kanal-Volume (partId)
 *  "channel-pan"   → Kanal-Pan (partId)
 *  "channel-send"  → Send-Level (partId + bus)
 *  "master-vol"    → Master-Volume
 *  "bpm"           → BPM (mapped auf min-max Bereich)
 *  "lfo-rate"      → LFO-Rate eines Synth-Parts (partId)
 *  "lfo-depth"     → LFO-Tiefe eines Synth-Parts (partId)
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-macros:v1";
export const MACRO_COUNT = 8;

export type MacroTargetType =
  | "channel-vol"
  | "channel-pan"
  | "channel-send-rev"
  | "channel-send-dly"
  | "master-vol"
  | "bpm"
  | "lfo-rate"
  | "lfo-depth";

export interface MacroBinding {
  id: string;
  target: MacroTargetType;
  /** Für channel-* Targets: die Part-ID */
  partId?: string;
  partName?: string;
  /** Wertebereich der Binding */
  minValue: number;
  maxValue: number;
}

export interface Macro {
  index: number;   // 0–7
  label: string;
  value: number;   // 0–1 (aktueller Makro-Wert)
  bindings: MacroBinding[];
  color: string;
}

export const MACRO_COLORS = [
  "#f59e0b", "#06b6d4", "#10b981", "#f43f5e",
  "#a855f7", "#ff6b35", "#0ea5e9", "#84cc16",
];

type Listener = () => void;

function makeBindingId() { return `mb-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`; }

function defaultMacros(): Macro[] {
  return Array.from({ length: MACRO_COUNT }, (_, i) => ({
    index: i,
    label: `Macro ${i + 1}`,
    value: 0,
    bindings: [],
    color: MACRO_COLORS[i % MACRO_COLORS.length],
  }));
}

function load(): Macro[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Macro[];
      // Ensure correct length
      while (parsed.length < MACRO_COUNT) parsed.push(defaultMacros()[parsed.length]);
      return parsed.slice(0, MACRO_COUNT);
    }
  } catch { /* ignore */ }
  return defaultMacros();
}

function persist(macros: Macro[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(macros)); } catch { /* ignore */ }
}

let _macros: Macro[] = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function setMacroValue(index: number, value: number): void {
  _macros = _macros.map((m, i) => i === index ? { ...m, value: Math.max(0, Math.min(1, value)) } : m);
  notify();
  // CustomEvent dispatchen damit App.tsx auf Bindings reagieren kann
  window.dispatchEvent(new CustomEvent("macro:change", { detail: { index, value: _macros[index].value } }));
}

export function setMacroLabel(index: number, label: string): void {
  _macros = _macros.map((m, i) => i === index ? { ...m, label } : m);
  persist(_macros);
  notify();
}

export function addMacroBinding(index: number, binding: Omit<MacroBinding, "id">): void {
  const b = { ...binding, id: makeBindingId() };
  _macros = _macros.map((m, i) => i === index ? { ...m, bindings: [...m.bindings, b] } : m);
  persist(_macros);
  notify();
}

export function removeMacroBinding(macroIndex: number, bindingId: string): void {
  _macros = _macros.map((m, i) =>
    i === macroIndex ? { ...m, bindings: m.bindings.filter(b => b.id !== bindingId) } : m
  );
  persist(_macros);
  notify();
}

export function resetMacros(): void {
  _macros = defaultMacros();
  persist(_macros);
  notify();
}

export function getMacros(): Macro[] { return _macros; }

export function useMacroStore(): { macros: Macro[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { macros: _macros };
}
