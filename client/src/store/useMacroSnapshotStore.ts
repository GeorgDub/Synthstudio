/**
 * Synthstudio – useMacroSnapshotStore (v3.115.0)
 *
 * Macro-Snapshot Morphing: gespeicherte "Looks" (8-Macro-Konfigurationen)
 * pro Track-Setup, die live zwischen A und B mit einem Slider (0..1)
 * interpoliert werden.
 *
 * Custom-Observer-Pattern (KEIN Zustand-npm). Persistiert in localStorage
 * unter `ss-macro-snapshots:v1`. Morph-A/B/Amount ist Teil des persistierten
 * Zustands — der User soll seine Live-Setups beim Reload nicht verlieren.
 *
 * Public API:
 *   addSnapshot, updateSnapshot, removeSnapshot
 *   setMorphA, setMorphB, setMorphAmount
 *   getCurrentMorphedValues, getMacroSnapshotState
 *   useMacroSnapshotStore (Hook)
 */
import { useEffect, useReducer } from "react";
import { MACRO_VALUES_LENGTH, morphValues, normalizeMacroValues } from "@/utils/macroMorph";

const STORAGE_KEY = "ss-macro-snapshots:v1";

/** Pastellige Default-Farben analog zu SCENE_COLORS. */
export const MACRO_SNAPSHOT_COLORS = [
  "#f59e0b", "#06b6d4", "#10b981", "#f43f5e",
  "#a855f7", "#ff6b35", "#0ea5e9", "#84cc16",
];

export interface MacroSnapshot {
  id: string;
  name: string;
  color: string;
  /** Genau MACRO_VALUES_LENGTH Werte 0..1 (normalisiert beim Speichern). */
  values: number[];
  createdAt: number;
}

export interface MacroSnapshotState {
  snapshots: MacroSnapshot[];
  morphA: string | null;
  morphB: string | null;
  /** 0..1 — Anteil B im Mix. 0 = pure A, 1 = pure B. */
  morphAmount: number;
}

type Listener = () => void;

// ─── Persistence ─────────────────────────────────────────────────────────────

function makeId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function defaultState(): MacroSnapshotState {
  return { snapshots: [], morphA: null, morphB: null, morphAmount: 0 };
}

function sanitizeSnapshot(raw: unknown): MacroSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<MacroSnapshot> & Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.length === 0) return null;
  if (typeof s.name !== "string") return null;
  const values = normalizeMacroValues(Array.isArray(s.values) ? (s.values as number[]) : []);
  const color =
    typeof s.color === "string" && s.color.length > 0
      ? s.color
      : MACRO_SNAPSHOT_COLORS[0];
  const createdAt =
    typeof s.createdAt === "number" && Number.isFinite(s.createdAt) ? s.createdAt : Date.now();
  return { id: s.id, name: s.name, color, values, createdAt };
}

function load(): MacroSnapshotState {
  try {
    if (typeof localStorage === "undefined") return defaultState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return defaultState();
    const p = parsed as Partial<MacroSnapshotState>;
    const snapshots: MacroSnapshot[] = [];
    if (Array.isArray(p.snapshots)) {
      for (const s of p.snapshots) {
        const ok = sanitizeSnapshot(s);
        if (ok) snapshots.push(ok);
      }
    }
    const ids = new Set(snapshots.map((s) => s.id));
    const morphA = typeof p.morphA === "string" && ids.has(p.morphA) ? p.morphA : null;
    const morphB = typeof p.morphB === "string" && ids.has(p.morphB) ? p.morphB : null;
    const morphAmount =
      typeof p.morphAmount === "number" ? clamp01(p.morphAmount) : 0;
    return { snapshots, morphA, morphB, morphAmount };
  } catch {
    return defaultState();
  }
}

function persist(state: MacroSnapshotState): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// ─── State + Observer ────────────────────────────────────────────────────────

let _state: MacroSnapshotState = load();
const _listeners = new Set<Listener>();
function notify(): void {
  _listeners.forEach((l) => l());
}

/** Synchroner Getter für Event-Handler außerhalb des React-Cycles. */
export function getMacroSnapshotState(): MacroSnapshotState {
  return _state;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Legt einen neuen Snapshot an. `values` wird auf MACRO_VALUES_LENGTH
 * normalisiert (Pad mit 0, Truncate, Clamp 0..1).
 * Leerer Name wird durch "Snapshot N" ersetzt.
 *
 * @returns die neue Snapshot-ID
 */
export function addSnapshot(name: string, values: readonly number[]): string {
  const id = makeId();
  const trimmed = (name ?? "").trim();
  const label = trimmed.length > 0 ? trimmed : `Snapshot ${_state.snapshots.length + 1}`;
  const color = MACRO_SNAPSHOT_COLORS[_state.snapshots.length % MACRO_SNAPSHOT_COLORS.length];
  const snap: MacroSnapshot = {
    id,
    name: label,
    color,
    values: normalizeMacroValues(values),
    createdAt: Date.now(),
  };
  _state = { ..._state, snapshots: [..._state.snapshots, snap] };
  persist(_state);
  notify();
  return id;
}

/**
 * Patcht Felder eines Snapshots (name/color/values). Andere Felder bleiben.
 * No-op bei unbekannter ID.
 */
export function updateSnapshot(
  id: string,
  partial: Partial<Pick<MacroSnapshot, "name" | "color" | "values">>,
): void {
  let changed = false;
  const snapshots = _state.snapshots.map((s) => {
    if (s.id !== id) return s;
    changed = true;
    const next: MacroSnapshot = { ...s };
    if (typeof partial.name === "string") {
      const trimmed = partial.name.trim();
      if (trimmed.length > 0) next.name = trimmed;
    }
    if (typeof partial.color === "string" && partial.color.length > 0) {
      next.color = partial.color;
    }
    if (Array.isArray(partial.values)) {
      next.values = normalizeMacroValues(partial.values);
    }
    return next;
  });
  if (!changed) return;
  _state = { ..._state, snapshots };
  persist(_state);
  notify();
}

/**
 * Entfernt einen Snapshot. Cleared morphA/morphB falls referenziert,
 * damit keine ghost-Pointer übrig bleiben.
 */
export function removeSnapshot(id: string): void {
  const exists = _state.snapshots.some((s) => s.id === id);
  if (!exists) return;
  _state = {
    ..._state,
    snapshots: _state.snapshots.filter((s) => s.id !== id),
    morphA: _state.morphA === id ? null : _state.morphA,
    morphB: _state.morphB === id ? null : _state.morphB,
  };
  persist(_state);
  notify();
}

/** Setzt morphA. `null` löscht die Slot-Zuweisung. Ghost-IDs werden ignoriert. */
export function setMorphA(id: string | null): void {
  if (id !== null && !_state.snapshots.some((s) => s.id === id)) return;
  if (_state.morphA === id) return;
  _state = { ..._state, morphA: id };
  persist(_state);
  notify();
}

/** Setzt morphB. `null` löscht die Slot-Zuweisung. Ghost-IDs werden ignoriert. */
export function setMorphB(id: string | null): void {
  if (id !== null && !_state.snapshots.some((s) => s.id === id)) return;
  if (_state.morphB === id) return;
  _state = { ..._state, morphB: id };
  persist(_state);
  notify();
}

/**
 * Setzt den Morph-Amount 0..1. Werte außerhalb werden geclampt; NaN → 0.
 * Threshold-Filter (0.001) gegen Re-Render-Spam vom Slider.
 */
export function setMorphAmount(amount: number): void {
  const clamped = clamp01(amount);
  if (Math.abs(_state.morphAmount - clamped) < 0.001 && clamped !== 0 && clamped !== 1) return;
  if (_state.morphAmount === clamped) return;
  _state = { ..._state, morphAmount: clamped };
  persist(_state);
  notify();
}

/**
 * Liefert die aktuellen morphed-Values (8 Werte 0..1) basierend auf
 * morphA/morphB/morphAmount.
 *
 * Fallback-Verhalten:
 *  - beide A+B gesetzt → linear interp
 *  - nur A gesetzt → A
 *  - nur B gesetzt → B
 *  - keiner gesetzt → null (Caller soll dann nichts applien — current macros bleiben)
 */
export function getCurrentMorphedValues(): number[] | null {
  const a = _state.morphA
    ? _state.snapshots.find((s) => s.id === _state.morphA)
    : undefined;
  const b = _state.morphB
    ? _state.snapshots.find((s) => s.id === _state.morphB)
    : undefined;
  if (!a && !b) return null;
  if (a && !b) return normalizeMacroValues(a.values);
  if (b && !a) return normalizeMacroValues(b.values);
  return morphValues(a!.values, b!.values, _state.morphAmount);
}

/**
 * Convenience: instant-recall — A=id, B=id, amount=0 → outputValues=Snapshot-Values.
 * MIDI-Note-Learn dispatcht das via "midi:recallSnapshot" CustomEvent in App.tsx.
 * No-op bei unbekannter ID.
 */
export function recallSnapshot(id: string): boolean {
  if (!_state.snapshots.some((s) => s.id === id)) return false;
  if (_state.morphA === id && _state.morphB === id && _state.morphAmount === 0) {
    notify();
    return true;
  }
  _state = { ..._state, morphA: id, morphB: id, morphAmount: 0 };
  persist(_state);
  notify();
  return true;
}

/** Test-Helper: setzt den Store auf Defaults zurück. */
export function __resetMacroSnapshotStoreForTests(): void {
  _state = defaultState();
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useMacroSnapshotStore(): MacroSnapshotState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}

// Re-export für Component-Bequemlichkeit
export { MACRO_VALUES_LENGTH };
