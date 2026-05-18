/**
 * Synthstudio – useOmniTribeMetersStore (v3.18.0)
 *
 * Globaler Store für Live-Streams vom OmniTribe-Geraet:
 *   - vuLevels   : 16 Channel × 0..127  (VU-Stream @ 60 Hz)
 *   - spectrumBins: 64 Bins × 0..127    (Spectrum-Stream @ 30 Hz)
 *
 * Pattern: Modul-Singleton + custom Observer-Pattern (analog zu useNoteRepeatStore).
 *
 * Wichtig (Performance):
 *   - VU-Updates kommen bis zu 60 Hz herein. Wir notifyen nur wenn sich
 *     mindestens 1 Wert tatsächlich geaendert hat (defensive Diff vor notify).
 *   - Komponenten sollten zusätzlich via React-Diff (Bar-Height per Index)
 *     nur die geaenderten Bars re-rendern oder direkt via canvas/style updaten.
 *
 * Disconnect: explizit via resetOmniTribeMeters() — alle Werte auf 0.
 */

import { useReducer, useEffect } from "react";

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const OMNITRIBE_VU_CHANNELS = 16;
export const OMNITRIBE_SPECTRUM_BINS = 64;

const _vu: number[] = new Array(OMNITRIBE_VU_CHANNELS).fill(0);
const _spectrum: number[] = new Array(OMNITRIBE_SPECTRUM_BINS).fill(0);

type Listener = () => void;
const _listeners = new Set<Listener>();

function _notify(): void {
  _listeners.forEach((l) => l());
}

/** Clamp 0..127 (Floor, NaN→0). */
function _clampMidi(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 127) return 127;
  return Math.floor(v);
}

// ─── Public Setters (idempotent + diff-vor-notify) ──────────────────────────

/** Setzt die 16 VU-Level. Längere Arrays werden gekürzt, kürzere mit 0 gepatcht. */
export function setOmniTribeVuLevels(levels: ArrayLike<number>): void {
  let changed = false;
  for (let i = 0; i < OMNITRIBE_VU_CHANNELS; i++) {
    const next = i < levels.length ? _clampMidi(levels[i]) : 0;
    if (_vu[i] !== next) {
      _vu[i] = next;
      changed = true;
    }
  }
  if (changed) _notify();
}

/** Setzt die 64 Spectrum-Bins. */
export function setOmniTribeSpectrumBins(bins: ArrayLike<number>): void {
  let changed = false;
  for (let i = 0; i < OMNITRIBE_SPECTRUM_BINS; i++) {
    const next = i < bins.length ? _clampMidi(bins[i]) : 0;
    if (_spectrum[i] !== next) {
      _spectrum[i] = next;
      changed = true;
    }
  }
  if (changed) _notify();
}

/** Reset bei Disconnect — alle Werte 0, notify nur wenn Aenderung. */
export function resetOmniTribeMeters(): void {
  let changed = false;
  for (let i = 0; i < OMNITRIBE_VU_CHANNELS; i++) {
    if (_vu[i] !== 0) { _vu[i] = 0; changed = true; }
  }
  for (let i = 0; i < OMNITRIBE_SPECTRUM_BINS; i++) {
    if (_spectrum[i] !== 0) { _spectrum[i] = 0; changed = true; }
  }
  if (changed) _notify();
}

// ─── Direct-Reads (für RAF-Loops in Canvas-Komponenten) ─────────────────────

/** Returns das interne Array — DO NOT MUTATE. RAF-friendly. */
export function getOmniTribeVuLevelsRef(): readonly number[] {
  return _vu;
}

export function getOmniTribeSpectrumBinsRef(): readonly number[] {
  return _spectrum;
}

/** Snapshot-Kopien für Tests. */
export function getOmniTribeVuLevelsSnapshot(): number[] {
  return _vu.slice();
}

export function getOmniTribeSpectrumBinsSnapshot(): number[] {
  return _spectrum.slice();
}

// ─── React Hook ─────────────────────────────────────────────────────────────

export interface UseOmniTribeMetersResult {
  vuLevels: readonly number[];
  spectrumBins: readonly number[];
}

/**
 * React-Hook: re-rendert auf jeden notify() (= jede tatsächliche Aenderung).
 * Liefert Live-Refs (frozen-ähnlich — DO NOT MUTATE).
 */
export function useOmniTribeMeters(): UseOmniTribeMetersResult {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return {
    vuLevels:     _vu,
    spectrumBins: _spectrum,
  };
}

// ─── Test-Hooks ─────────────────────────────────────────────────────────────

/** Nur für Tests: clear listeners + reset values. */
export function __resetOmniTribeMetersStoreForTests(): void {
  _listeners.clear();
  for (let i = 0; i < OMNITRIBE_VU_CHANNELS; i++) _vu[i] = 0;
  for (let i = 0; i < OMNITRIBE_SPECTRUM_BINS; i++) _spectrum[i] = 0;
}
