/**
 * Synthstudio – usePatternVariationsStore
 *
 * Pattern Variations: Jedes Pattern kann 4 Variationen (A/B/C/D) haben.
 * Variationen teilen denselben BPM und Part-Namen, haben aber unterschiedliche
 * Step-Zustände. Nützlich für Fills, Breakdowns, Outtros.
 *
 * Konzept:
 *  - Variation A = Standard (aktuelles Pattern)
 *  - Variation B/C/D = alternative Versionen (als separate PatternData gespeichert)
 *  - Keyboard-Shortcuts: Shift+A/B/C/D für schnellen Wechsel
 *  - MIDI-Trigger: CC oder Note auf konfiguriertem Kanal
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-pattern-variations:v1";

export type VariationSlot = "A" | "B" | "C" | "D";

export interface PatternVariationSet {
  /** Pattern-ID für die übergeordnete Variation-Gruppe */
  basePatternId: string;
  /** Name der Gruppe */
  name: string;
  /** Welche Variation ist aktiv */
  activeSlot: VariationSlot;
  /** Pattern-IDs für jede Variation (null = noch nicht erstellt) */
  slots: Record<VariationSlot, string | null>;
}

type Listener = () => void;

function load(): PatternVariationSet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persist(sets: PatternVariationSet[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sets)); } catch { /* ignore */ }
}

let _sets: PatternVariationSet[] = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function createVariationSet(basePatternId: string, name: string, activePatternId: string): PatternVariationSet {
  const set: PatternVariationSet = {
    basePatternId,
    name,
    activeSlot: "A",
    slots: { A: activePatternId, B: null, C: null, D: null },
  };
  _sets = [..._sets, set];
  persist(_sets);
  notify();
  return set;
}

export function updateVariationSlot(baseId: string, slot: VariationSlot, patternId: string | null): void {
  _sets = _sets.map(s => s.basePatternId === baseId
    ? { ...s, slots: { ...s.slots, [slot]: patternId } }
    : s
  );
  persist(_sets);
  notify();
}

export function setActiveVariation(baseId: string, slot: VariationSlot): void {
  _sets = _sets.map(s => s.basePatternId === baseId ? { ...s, activeSlot: slot } : s);
  persist(_sets);
  notify();
}

export function removeVariationSet(baseId: string): void {
  _sets = _sets.filter(s => s.basePatternId !== baseId);
  persist(_sets);
  notify();
}

export function getVariationSet(baseId: string): PatternVariationSet | undefined {
  return _sets.find(s => s.basePatternId === baseId);
}

export function usePatternVariationsStore(): { sets: PatternVariationSet[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { sets: _sets };
}
