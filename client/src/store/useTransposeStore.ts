/**
 * Synthstudio – useTransposeStore
 *
 * Globaler Halbton-Offset (±24), wird auf alle melodischen Trigger angewendet.
 * Muster: Modul-Singleton (analog useMelodicPartStore), localStorage-Persistenz.
 */
import { useState, useCallback, useEffect } from "react";
import { clampSemitones } from "../utils/transpose";

const STORAGE_KEY = "ss-global-transpose";

let _semitones = 0;
const _listeners = new Set<(s: number) => void>();

function _readFromStorage(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 0;
    const n = Number(raw);
    return clampSemitones(n);
  } catch {
    return 0;
  }
}

function _writeToStorage(n: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    // ignore
  }
}

function _notify(): void {
  _listeners.forEach((fn) => fn(_semitones));
}

_semitones = _readFromStorage();

// ─── Exportierte Logik-Funktionen ─────────────────────────────────────────────

export function getSemitones(): number {
  return _semitones;
}

export function setSemitones(n: number): void {
  const clamped = clampSemitones(n);
  if (clamped === _semitones) return;
  _semitones = clamped;
  _writeToStorage(clamped);
  _notify();
}

export function incSemitones(delta: number): void {
  setSemitones(_semitones + delta);
}

export function resetTranspose(): void {
  setSemitones(0);
}

/** Test-Hook: setzt den Modul-State zurück. */
export function __resetForTests(): void {
  _semitones = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  _notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export interface TransposeStoreApi {
  semitones: number;
  setSemitones: (n: number) => void;
  incSemitones: (delta: number) => void;
  reset: () => void;
}

export function useTransposeStore(): TransposeStoreApi {
  const [semitones, setLocal] = useState(_semitones);

  useEffect(() => {
    const handler = (s: number) => setLocal(s);
    _listeners.add(handler);
    return () => {
      _listeners.delete(handler);
    };
  }, []);

  const set = useCallback((n: number) => setSemitones(n), []);
  const inc = useCallback((delta: number) => incSemitones(delta), []);
  const reset = useCallback(() => resetTranspose(), []);

  return { semitones, setSemitones: set, incSemitones: inc, reset };
}
