/**
 * Synthstudio – useSlicePadStore.ts (TASK-238-FOLLOWUP-1 / v2.90)
 *
 * Sample-Slicing-Pad-Buffer-Owner.
 *
 * Architektur:
 *   - Custom-Observer-Pattern (analog useLooperStore / useLiveInputStore).
 *   - 16 Pad-Slots (entspricht MAX_PERFORMANCE_PADS), jeder traegt einen
 *     optionalen Float32-Slice + sampleRate + sampleName.
 *   - Audio-Buffer lebt NUR im RAM (Float32Array). Wird NICHT persistiert —
 *     ein einzelner 10-Sekunden-Slice @ 48kHz ist 1.8 MB, 16 Slots * mehrere
 *     Samples waere localStorage-Suizid. Slices sind transient pro Session.
 *   - AudioEngine.playSlicePad(index) ist der Audio-Consumer.
 *
 * NICHT-Persistenz-Begruendung im Detail:
 *   localStorage hat ~5MB Quota pro Origin. Float32Array.toJSON() encodet
 *   Sample-Werte als verbose Strings. Ein 1-Sekunden-Mono-Slice braeuchte
 *   ~120 KB als JSON. 16 Pad-Slots * mehrere Songs * Encode-Cost macht das
 *   unbrauchbar. User-Pattern: bei Restart neu slicen — kostet 2 Klicks.
 */

import { useEffect, useReducer } from "react";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Anzahl Pad-Slots. Stimmt mit MAX_PERFORMANCE_PADS aus sampleSlicing.ts ueberein. */
export const MAX_SLICE_PADS = 16;

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface SlicePadSlot {
  /** Index 0..MAX_SLICE_PADS-1. */
  index: number;
  /** Audio-Daten (Mono), oder null wenn der Slot leer ist. */
  buffer: Float32Array | null;
  /** Sample-Rate der Slice-Daten. */
  sampleRate: number;
  /** Originalsample-Name (Anzeige). */
  sampleName: string;
  /** Index des Slices innerhalb des ursprünglichen Originalsamples. */
  sliceIndex: number;
}

type Listener = () => void;

// ─── Module-Singleton-State ──────────────────────────────────────────────────

function makeEmptySlot(idx: number): SlicePadSlot {
  return {
    index: idx,
    buffer: null,
    sampleRate: 44100,
    sampleName: "",
    sliceIndex: 0,
  };
}

let _state: SlicePadSlot[] = Array.from({ length: MAX_SLICE_PADS }, (_, i) => makeEmptySlot(i));
const _listeners = new Set<Listener>();

function notify(): void {
  for (const l of _listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

// ─── Public-API ──────────────────────────────────────────────────────────────

export function getSlicePadSlot(index: number): SlicePadSlot | null {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SLICE_PADS) return null;
  return _state[index];
}

export function getAllSlicePadSlots(): ReadonlyArray<SlicePadSlot> {
  return _state;
}

/**
 * Belegt einen Pad-Slot mit einem Slice-Buffer.
 * @returns true wenn erfolgreich gesetzt, false bei out-of-range.
 */
export function setSlicePadSlot(
  index: number,
  buffer: Float32Array,
  opts: {
    sampleRate: number;
    sampleName: string;
    sliceIndex: number;
  },
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SLICE_PADS) return false;
  const sampleRate = Number.isFinite(opts.sampleRate) && opts.sampleRate > 0
    ? opts.sampleRate
    : 44100;
  _state = _state.map((slot, i) =>
    i === index
      ? {
          index,
          buffer,
          sampleRate,
          sampleName: opts.sampleName,
          sliceIndex: opts.sliceIndex,
        }
      : slot,
  );
  notify();
  return true;
}

export function clearSlicePadSlot(index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SLICE_PADS) return false;
  if (!_state[index].buffer) return true; // idempotent
  _state = _state.map((slot, i) => (i === index ? makeEmptySlot(i) : slot));
  notify();
  return true;
}

export function clearAllSlicePads(): void {
  if (_state.every(s => s.buffer === null)) return;
  _state = Array.from({ length: MAX_SLICE_PADS }, (_, i) => makeEmptySlot(i));
  notify();
}

/**
 * Bulk-Apply: weist Slices 0..N-1 auf Pads 0..N-1 ab.
 * Slices ueber MAX_SLICE_PADS werden abgeschnitten + zaehlen als skipped.
 *
 * @returns Anzahl der zugewiesenen Slices.
 */
export function assignSlicesToPads(
  slices: ReadonlyArray<Float32Array>,
  opts: {
    sampleRate: number;
    sampleName: string;
    /** Wenn true, werden vorher alle Slots geleert. Default: true. */
    replace?: boolean;
  },
): number {
  const replace = opts.replace ?? true;
  if (!Array.isArray(slices)) return 0;
  const padCount = Math.min(slices.length, MAX_SLICE_PADS);
  if (padCount === 0 && !replace) return 0;

  const next: SlicePadSlot[] = replace
    ? Array.from({ length: MAX_SLICE_PADS }, (_, i) => makeEmptySlot(i))
    : _state.map(s => ({ ...s }));

  for (let i = 0; i < padCount; i++) {
    next[i] = {
      index: i,
      buffer: slices[i],
      sampleRate: Number.isFinite(opts.sampleRate) && opts.sampleRate > 0 ? opts.sampleRate : 44100,
      sampleName: opts.sampleName,
      sliceIndex: i,
    };
  }
  _state = next;
  notify();
  return padCount;
}

/**
 * Reset fuer Unit-Tests. NICHT in der App aufrufen.
 */
export function __resetSlicePadStoreForTests(): void {
  _state = Array.from({ length: MAX_SLICE_PADS }, (_, i) => makeEmptySlot(i));
  _listeners.clear();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useSlicePadStore(): ReadonlyArray<SlicePadSlot> {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
