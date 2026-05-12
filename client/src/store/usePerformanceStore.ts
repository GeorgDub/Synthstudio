/**
 * usePerformanceStore.ts – Performance Mode State (v1.20.0+)
 *
 * Custom Observer Pattern (analog useMacroStore / useAudioTrackStore).
 * Persistiert in localStorage:
 *   - pads (PerformancePad[16])  → User-Pad-Konfiguration (welches Pattern, Farbe, Label)
 *   - quantizeMode               → letzte Quantize-Wahl
 *
 * NICHT persistiert:
 *   - active            (Runtime-Toggle, lebt als local useState in App.tsx)
 *   - queuedPatternId   (Runtime-Queue für quantisierte Pattern-Wechsel)
 *
 * Schema-Migration:
 *   Alte (pre-v1.20) Hook-State-Daten wurden NICHT persistiert → kein Migrationspfad nötig.
 *   Falls in localStorage[STORAGE_KEY] alte Items ohne `color`/`label` existieren, werden
 *   sie tolerant geladen (fehlende Felder bleiben undefined).
 */
import { useEffect, useReducer } from "react";

export const PAD_COUNT = 16;
const STORAGE_KEY = "ss-performance:v1";

export interface PerformancePad {
  patternId: string;
  /** CSS-Farbe (z.B. "#22d3ee"). User-defined oder Default-Palette-Fallback im UI. */
  color?: string;
  /** Vom User vergebener Anzeigename. Fällt sonst auf Pattern-Name aus DrumMachine zurück. */
  label?: string;
}

export type QuantizeMode = "bar" | "beat" | "step";

interface PersistedState {
  pads: Array<PerformancePad | null>;
  quantizeMode: QuantizeMode;
}

interface RuntimeState {
  queuedPatternId: string | null;
}

type Listener = () => void;

// ─── Defaults & Validation ───────────────────────────────────────────────────

function defaultPads(): Array<PerformancePad | null> {
  return Array.from({ length: PAD_COUNT }, () => null);
}

function isValidQuantizeMode(v: unknown): v is QuantizeMode {
  return v === "bar" || v === "beat" || v === "step";
}

function migratePad(raw: unknown): PerformancePad | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<PerformancePad> & Record<string, unknown>;
  if (typeof p.patternId !== "string" || p.patternId.length === 0) return null;
  const pad: PerformancePad = { patternId: p.patternId };
  if (typeof p.color === "string") pad.color = p.color;
  if (typeof p.label === "string") pad.label = p.label;
  return pad;
}

function loadPersisted(): PersistedState {
  try {
    if (typeof localStorage === "undefined") {
      return { pads: defaultPads(), quantizeMode: "bar" };
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const padsRaw = Array.isArray(obj.pads) ? obj.pads : [];
        const pads: Array<PerformancePad | null> = defaultPads();
        for (let i = 0; i < PAD_COUNT; i++) {
          pads[i] = migratePad(padsRaw[i]);
        }
        const quantizeMode: QuantizeMode = isValidQuantizeMode(obj.quantizeMode)
          ? obj.quantizeMode
          : "bar";
        return { pads, quantizeMode };
      }
    }
  } catch { /* ignore */ }
  return { pads: defaultPads(), quantizeMode: "bar" };
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const payload: PersistedState = {
      pads: _pads,
      quantizeMode: _quantizeMode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

// ─── Module-State ────────────────────────────────────────────────────────────

const _initial = loadPersisted();
let _pads: Array<PerformancePad | null> = _initial.pads;
let _quantizeMode: QuantizeMode = _initial.quantizeMode;
let _queuedPatternId: RuntimeState["queuedPatternId"] = null;

const _listeners = new Set<Listener>();
function notify(): void { _listeners.forEach(l => l()); }

// ─── Pure-API (testable, ohne React) ─────────────────────────────────────────

export function getPads(): Array<PerformancePad | null> {
  return _pads;
}

export function getQuantizeMode(): QuantizeMode {
  return _quantizeMode;
}

export function getQueuedPatternId(): string | null {
  return _queuedPatternId;
}

/**
 * Bulk-Replace aller 16 Pads. Akzeptiert sowohl ein vollständiges Array (≥16)
 * als auch ein kürzeres; Rest wird mit null aufgefüllt, Überlauf abgeschnitten.
 */
export function setPads(pads: Array<PerformancePad | null>): void {
  const next: Array<PerformancePad | null> = defaultPads();
  const len = Math.min(pads.length, PAD_COUNT);
  for (let i = 0; i < len; i++) {
    const p = pads[i];
    next[i] = p && typeof p.patternId === "string" && p.patternId.length > 0
      ? { ...p }
      : null;
  }
  _pads = next;
  persist();
  notify();
}

/**
 * Setzt einen einzelnen Pad-Slot. `null` entfernt den Slot.
 * No-op bei out-of-range index.
 */
export function setPadAt(index: number, pad: PerformancePad | null): void {
  if (index < 0 || index >= PAD_COUNT) return;
  if (pad !== null && (typeof pad.patternId !== "string" || pad.patternId.length === 0)) return;
  _pads = _pads.map((p, i) => i === index ? (pad ? { ...pad } : null) : p);
  persist();
  notify();
}

/**
 * Patcht nur die Farbe eines Pads. No-op wenn Slot leer oder index out-of-range.
 */
export function setPadColor(index: number, color: string): void {
  if (index < 0 || index >= PAD_COUNT) return;
  const current = _pads[index];
  if (!current) return;
  _pads = _pads.map((p, i) => i === index && p ? { ...p, color } : p);
  persist();
  notify();
}

/**
 * Patcht nur das Label eines Pads. No-op wenn Slot leer oder index out-of-range.
 */
export function setPadLabel(index: number, label: string): void {
  if (index < 0 || index >= PAD_COUNT) return;
  const current = _pads[index];
  if (!current) return;
  _pads = _pads.map((p, i) => i === index && p ? { ...p, label } : p);
  persist();
  notify();
}

/**
 * Vertauscht zwei Slots (Drag-Reorder).
 * No-op wenn from===to oder einer der Indizes out-of-range.
 */
export function movePad(from: number, to: number): void {
  if (from === to) return;
  if (from < 0 || from >= PAD_COUNT) return;
  if (to < 0 || to >= PAD_COUNT) return;
  const next = _pads.slice();
  const tmp = next[from];
  next[from] = next[to];
  next[to] = tmp;
  _pads = next;
  persist();
  notify();
}

/**
 * Convenience: setPadAt(index, null).
 */
export function clearPad(index: number): void {
  setPadAt(index, null);
}

/**
 * Queued ein Pattern für quantisierten Wechsel.
 * Toggle-Verhalten: zweimal dasselbe Pattern queuen → Queue leeren.
 * Runtime-only, NICHT persistiert.
 */
export function queuePattern(patternId: string): void {
  _queuedPatternId = _queuedPatternId === patternId ? null : patternId;
  notify();
}

export function clearQueue(): void {
  if (_queuedPatternId === null) return;
  _queuedPatternId = null;
  notify();
}

export function setQuantizeMode(mode: QuantizeMode): void {
  if (!isValidQuantizeMode(mode)) return;
  if (_quantizeMode === mode) return;
  _quantizeMode = mode;
  persist();
  notify();
}

/**
 * Test-Helper: Reset auf Default + leere localStorage. Nur in Tests benutzen.
 */
export function __resetPerformanceStoreForTests(): void {
  _pads = defaultPads();
  _quantizeMode = "bar";
  _queuedPatternId = null;
  try { localStorage?.removeItem?.(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export interface PerformanceStoreView {
  pads: Array<PerformancePad | null>;
  queuedPatternId: string | null;
  quantizeMode: QuantizeMode;
}

export function usePerformanceStore(): PerformanceStoreView {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return {
    pads: _pads,
    queuedPatternId: _queuedPatternId,
    quantizeMode: _quantizeMode,
  };
}
