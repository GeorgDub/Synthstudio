/**
 * Synthstudio – useMidiFxStore.ts (v3.92.0)
 *
 * MIDI-FX Chain-State: Liste von Transform-Nodes die eingehende Note-On-Events
 * VOR der Engine durchlaufen.
 *
 * Pattern: Custom Observer (analog useSubMixStore, useMasterFxStore).
 * Persistenz: localStorage `synthstudio:midi-fx:v1`.
 *
 * Schema-Migration v1.33 → v1.34: `midiFxChain` ist additiv-optional auf
 * SynthProject — Pre-v1.34-Files haben das Feld nicht (parseProject lässt
 * das Feld undefined, was an restoreProject signalisiert "User-localStorage
 * nicht überschreiben").
 *
 * Caveats:
 *   - Keine Audio-Side-Effects. Engine wird durch useMidi-Hook genutzt
 *     (siehe handleMidiMessage in useMidi.ts).
 *   - max MAX_MIDI_FX_CHAIN (=6) Nodes — UI-Limit + Performance-Schutz
 *     (Chord-Expander × Note-Repeat × 6 Stages kann 6³+ Events erzeugen).
 *   - Re-Ordering via moveNode (Index-basiert).
 */

import { useEffect, useReducer } from "react";
import {
  MAX_MIDI_FX_CHAIN,
  type MidiFxNode,
  type MidiScaleName,
  type VelocityCurveShape,
  type NoteRepeatRate,
  type ChordExpanderType,
  type PitchSweepDirection,
  type PitchSweepCurve,
  type PitchSweepStepRate,
} from "@/utils/midiFxEngine";

export { MAX_MIDI_FX_CHAIN };
export type {
  MidiFxNode,
  MidiScaleName,
  VelocityCurveShape,
  NoteRepeatRate,
  ChordExpanderType,
  PitchSweepDirection,
  PitchSweepCurve,
  PitchSweepStepRate,
};

// ─── State-Typen ─────────────────────────────────────────────────────────────

export interface MidiFxState {
  chain: MidiFxNode[];
}

export type MidiFxKind = MidiFxNode["kind"];

// ─── Defaults ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "synthstudio:midi-fx:v1";

export function defaultMidiFxState(): MidiFxState {
  return { chain: [] };
}

// ─── Defaults pro Node-Kind ──────────────────────────────────────────────────

function makeNodeId(): string {
  try {
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID
    ) {
      return (globalThis as { crypto: { randomUUID: () => string } }).crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `mfx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function makeDefaultNode(kind: MidiFxKind): MidiFxNode {
  const id = makeNodeId();
  switch (kind) {
    case "scale-snap":
      return { id, kind: "scale-snap", scale: "major", root: 0 };
    case "velocity-curve":
      return { id, kind: "velocity-curve", curve: "linear", amount: 0.5 };
    case "octave-shift":
      return { id, kind: "octave-shift", semitones: 0 };
    case "chord-expander":
      return { id, kind: "chord-expander", chordType: "major" };
    case "note-repeat":
      return { id, kind: "note-repeat", rate: "1/16", count: 4 };
    case "pitch-sweep":
      return {
        id,
        kind: "pitch-sweep",
        semitones: 12,
        steps: 8,
        direction: "up",
        curve: "linear",
        stepRate: "1/32",
      };
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return { id, kind: "octave-shift", semitones: 0 };
    }
  }
}

// ─── Clamping / Sanitization ─────────────────────────────────────────────────

function clampNum(v: unknown, min: number, max: number, fb: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fb;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clampBool(v: unknown, fb: boolean): boolean {
  return typeof v === "boolean" ? v : fb;
}

function clampStringId(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

const VALID_SCALES: readonly MidiScaleName[] = ["major", "minor", "penta"];
const VALID_VELOCITY_CURVES: readonly VelocityCurveShape[] = ["linear", "exp", "log"];
const VALID_REPEAT_RATES: readonly NoteRepeatRate[] = ["1/8", "1/16", "1/32"];
const VALID_CHORD_TYPES: readonly ChordExpanderType[] = ["major", "minor", "7th"];
const VALID_SWEEP_DIRECTIONS: readonly PitchSweepDirection[] = ["up", "down", "updown"];
const VALID_SWEEP_CURVES: readonly PitchSweepCurve[] = ["linear", "exp", "log"];
const VALID_SWEEP_RATES: readonly PitchSweepStepRate[] = ["1/8", "1/16", "1/32"];

function sanitizeNode(raw: unknown): MidiFxNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<MidiFxNode> & { id?: unknown; kind?: unknown };
  const id = clampStringId(r.id) ?? makeNodeId();
  const bypass = clampBool(r.bypass, false);
  switch (r.kind) {
    case "scale-snap": {
      const rr = raw as { scale?: unknown; root?: unknown };
      const scale = VALID_SCALES.includes(rr.scale as MidiScaleName)
        ? (rr.scale as MidiScaleName)
        : "major";
      const root = Math.round(clampNum(rr.root, 0, 11, 0));
      return { id, kind: "scale-snap", bypass, scale, root };
    }
    case "velocity-curve": {
      const rr = raw as { curve?: unknown; amount?: unknown };
      const curve = VALID_VELOCITY_CURVES.includes(rr.curve as VelocityCurveShape)
        ? (rr.curve as VelocityCurveShape)
        : "linear";
      const amount = clampNum(rr.amount, 0, 1, 0.5);
      return { id, kind: "velocity-curve", bypass, curve, amount };
    }
    case "octave-shift": {
      const rr = raw as { semitones?: unknown };
      const semitones = Math.round(clampNum(rr.semitones, -24, 24, 0));
      return { id, kind: "octave-shift", bypass, semitones };
    }
    case "chord-expander": {
      const rr = raw as { chordType?: unknown };
      const chordType = VALID_CHORD_TYPES.includes(rr.chordType as ChordExpanderType)
        ? (rr.chordType as ChordExpanderType)
        : "major";
      return { id, kind: "chord-expander", bypass, chordType };
    }
    case "note-repeat": {
      const rr = raw as { rate?: unknown; count?: unknown };
      const rate = VALID_REPEAT_RATES.includes(rr.rate as NoteRepeatRate)
        ? (rr.rate as NoteRepeatRate)
        : "1/16";
      const count = Math.round(clampNum(rr.count, 2, 8, 4));
      return { id, kind: "note-repeat", bypass, rate, count };
    }
    case "pitch-sweep": {
      const rr = raw as {
        semitones?: unknown;
        steps?: unknown;
        direction?: unknown;
        curve?: unknown;
        stepRate?: unknown;
      };
      const semitones = Math.round(clampNum(rr.semitones, -24, 24, 12));
      const steps = Math.round(clampNum(rr.steps, 4, 32, 8));
      const direction = VALID_SWEEP_DIRECTIONS.includes(rr.direction as PitchSweepDirection)
        ? (rr.direction as PitchSweepDirection)
        : "up";
      const curve = VALID_SWEEP_CURVES.includes(rr.curve as PitchSweepCurve)
        ? (rr.curve as PitchSweepCurve)
        : "linear";
      const stepRate = VALID_SWEEP_RATES.includes(rr.stepRate as PitchSweepStepRate)
        ? (rr.stepRate as PitchSweepStepRate)
        : "1/32";
      return {
        id,
        kind: "pitch-sweep",
        bypass,
        semitones,
        steps,
        direction,
        curve,
        stepRate,
      };
    }
    default:
      return null;
  }
}

export function sanitizeMidiFxState(raw: unknown): MidiFxState {
  if (!raw || typeof raw !== "object") return defaultMidiFxState();
  const r = raw as Partial<MidiFxState>;
  if (!Array.isArray(r.chain)) return defaultMidiFxState();
  const chain: MidiFxNode[] = [];
  const seenIds = new Set<string>();
  for (const item of r.chain) {
    const node = sanitizeNode(item);
    if (!node) continue;
    if (seenIds.has(node.id)) continue;
    seenIds.add(node.id);
    chain.push(node);
    if (chain.length >= MAX_MIDI_FX_CHAIN) break;
  }
  return { chain };
}

// ─── Persist ─────────────────────────────────────────────────────────────────

function loadState(): MidiFxState {
  if (typeof window === "undefined") return defaultMidiFxState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMidiFxState();
    return sanitizeMidiFxState(JSON.parse(raw));
  } catch {
    return defaultMidiFxState();
  }
}

function persist(state: MidiFxState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* swallow */
  }
}

// ─── Singleton-State + Listener ──────────────────────────────────────────────

type Listener = () => void;
let _state: MidiFxState = loadState();
const _listeners = new Set<Listener>();

function notify(): void {
  for (const l of _listeners) {
    try {
      l();
    } catch {
      /* swallow */
    }
  }
}

function commit(next: MidiFxState): void {
  _state = next;
  persist(_state);
  notify();
}

// ─── Public Getters ──────────────────────────────────────────────────────────

export function getMidiFxState(): MidiFxState {
  return _state;
}

export function getMidiFxChain(): MidiFxNode[] {
  return _state.chain;
}

// ─── Public Setters ──────────────────────────────────────────────────────────

/**
 * Fügt einen neuen Node mit Defaults am Chain-Ende ein.
 * Returnt die Node-ID, oder null wenn MAX_MIDI_FX_CHAIN erreicht.
 */
export function addNode(kind: MidiFxKind): string | null {
  if (_state.chain.length >= MAX_MIDI_FX_CHAIN) return null;
  const node = makeDefaultNode(kind);
  commit({ chain: [..._state.chain, node] });
  return node.id;
}

export function removeNode(id: string): void {
  const next = _state.chain.filter((n) => n.id !== id);
  if (next.length === _state.chain.length) return;
  commit({ chain: next });
}

/** Re-Order via Indizes. NOOP wenn out-of-range. */
export function moveNode(fromIndex: number, toIndex: number): void {
  const from = Math.round(fromIndex);
  const to = Math.round(toIndex);
  if (from < 0 || from >= _state.chain.length) return;
  if (to < 0 || to >= _state.chain.length) return;
  if (from === to) return;
  const next = _state.chain.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  commit({ chain: next });
}

/**
 * Merge-Update eines Nodes. Validierung passiert via sanitizeNode, sodass
 * invalide Felder die alten Defaults nicht überschreiben (Whitelist-Semantik).
 */
export function updateNode(id: string, update: Partial<MidiFxNode>): void {
  const next = _state.chain.map((n) => {
    if (n.id !== id) return n;
    const merged = sanitizeNode({ ...n, ...update });
    if (!merged) return n;
    // sanitizeNode generiert eine neue ID wenn keine vorhanden — wir wollen
    // hier die alte behalten, falls update.id versehentlich verändert wurde.
    merged.id = n.id;
    return merged;
  });
  commit({ chain: next });
}

export function setNodeBypass(id: string, bypass: boolean): void {
  const next = _state.chain.map((n) =>
    n.id === id ? ({ ...n, bypass: !!bypass } as MidiFxNode) : n,
  );
  commit({ chain: next });
}

export function clearChain(): void {
  if (_state.chain.length === 0) return;
  commit({ chain: [] });
}

/**
 * Bulk-Restore-Pfad für Project-Loader. `undefined` = "User-localStorage
 * nicht überschreiben" (Pre-v1.34-File). Explizit leeres Array = User
 * hat die Chain geleert und gespeichert.
 */
export function setAllNodes(input: readonly MidiFxNode[] | undefined): void {
  if (input === undefined) return;
  const sanitized = sanitizeMidiFxState({ chain: input.slice() });
  commit(sanitized);
}

export function resetMidiFx(): void {
  commit(defaultMidiFxState());
}

/** Nur für Tests. */
export function __resetMidiFxStoreForTests(): void {
  _state = defaultMidiFxState();
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* swallow */
  }
  _listeners.clear();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useMidiFxStore(): MidiFxState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}
