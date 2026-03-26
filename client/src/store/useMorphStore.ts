/**
 * Synthstudio – useMorphStore.ts  (Phase 5, v1.9)
 *
 * Globaler Store für Pattern Morphing.
 * Pattern: Modul-Singleton + React useState/useCallback (analog zu useThemeStore).
 * Persistenz: sessionStorage (flüchtig – kein localStorage).
 */
import { useState, useCallback, useEffect } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface MorphState {
  /** Morph-Menge: 0 = vollständig A, 1 = vollständig B */
  amount: number;
  /** ID des Pattern-A (null = kein Morph aktiv) */
  patternAId: string | null;
  /** ID des Pattern-B (null = kein Morph aktiv) */
  patternBId: string | null;
  /** Ob Morph aktiv ist */
  isActive: boolean;
  /** Ob Auto-Morph (automatische Animation) läuft */
  autoMorphActive: boolean;
  /** Auto-Morph-Geschwindigkeit in Bars (wie viele Bars für 0→1) */
  autoMorphBars: number;
}

export interface MorphActions {
  setAmount: (amount: number) => void;
  setPatternA: (id: string | null) => void;
  setPatternB: (id: string | null) => void;
  setActive: (active: boolean) => void;
  toggleAutoMorph: () => void;
  setAutoMorphBars: (bars: number) => void;
  resetMorph: () => void;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-morph";

const DEFAULT_STATE: MorphState = {
  amount: 0,
  patternAId: null,
  patternBId: null,
  isActive: false,
  autoMorphActive: false,
  autoMorphBars: 4,
};

// ─── Modul-Singleton ──────────────────────────────────────────────────────────

let _state: MorphState = { ...DEFAULT_STATE };
const _listeners = new Set<(state: MorphState) => void>();

function _notify(): void {
  _listeners.forEach((fn) => fn({ ..._state }));
}

function _clampAmount(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ─── sessionStorage-Hilfsfunktionen ──────────────────────────────────────────

function _readFromSession(): Partial<MorphState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as Partial<MorphState>;
    }
  } catch {
    // sessionStorage nicht verfügbar (Node.js / SSR)
  }
  return {};
}

function _persistToSession(state: MorphState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage nicht verfügbar
  }
}

// ─── Exportierte Logik-Funktionen (testbar ohne React) ───────────────────────

export function initMorphFromStorage(): MorphState {
  const stored = _readFromSession();
  _state = {
    ...DEFAULT_STATE,
    ...stored,
    amount: _clampAmount(
      typeof stored.amount === "number" ? stored.amount : DEFAULT_STATE.amount
    ),
  };
  return { ..._state };
}

export function getMorphState(): MorphState {
  return { ..._state };
}

/** Nur für Unit-Tests – nicht in Produktion aufrufen! */
export function __resetMorphForTests(): void {
  _state = { ...DEFAULT_STATE };
  _listeners.clear();
}

// ─── Aktions-Implementierungen (direkt exportiert – testbar ohne React) ──────

export function setAmount(amount: number): void {
  _state = { ..._state, amount: _clampAmount(amount) };
  _persistToSession(_state);
  _notify();
}

export function setPatternA(id: string | null): void {
  _state = { ..._state, patternAId: id };
  _persistToSession(_state);
  _notify();
}

export function setPatternB(id: string | null): void {
  _state = { ..._state, patternBId: id };
  _persistToSession(_state);
  _notify();
}

export function setActive(active: boolean): void {
  _state = { ..._state, isActive: active };
  _persistToSession(_state);
  _notify();
}

export function toggleAutoMorph(): void {
  _state = { ..._state, autoMorphActive: !_state.autoMorphActive };
  _persistToSession(_state);
  _notify();
}

export function setAutoMorphBars(bars: number): void {
  _state = { ..._state, autoMorphBars: bars };
  _persistToSession(_state);
  _notify();
}

export function resetMorph(): void {
  _state = { ...DEFAULT_STATE };
  _persistToSession(_state);
  _notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export function useMorphStore(): MorphState & MorphActions {
  const [state, setLocalState] = useState<MorphState>(() => ({ ..._state }));

  useEffect(() => {
    // Beim ersten Mount aus sessionStorage initialisieren
    const restored = initMorphFromStorage();
    setLocalState(restored);

    _listeners.add(setLocalState);
    return () => {
      _listeners.delete(setLocalState);
    };
  }, []);

  const setAmountCb = useCallback((amount: number) => setAmount(amount), []);
  const setPatternACb = useCallback((id: string | null) => setPatternA(id), []);
  const setPatternBCb = useCallback((id: string | null) => setPatternB(id), []);
  const setActiveCb = useCallback((active: boolean) => setActive(active), []);
  const toggleAutoMorphCb = useCallback(() => toggleAutoMorph(), []);
  const setAutoMorphBarsCb = useCallback((bars: number) => setAutoMorphBars(bars), []);
  const resetMorphCb = useCallback(() => resetMorph(), []);

  return {
    ...state,
    setAmount: setAmountCb,
    setPatternA: setPatternACb,
    setPatternB: setPatternBCb,
    setActive: setActiveCb,
    toggleAutoMorph: toggleAutoMorphCb,
    setAutoMorphBars: setAutoMorphBarsCb,
    resetMorph: resetMorphCb,
  };
}
