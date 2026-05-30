/**
 * usePatternGroupStore — Pattern-Gruppen / Playlists (Pattern-Manager Phase 2).
 *
 * Eine Gruppe bündelt Pattern-IDs (aus useDrumMachineStore.patterns) in einer
 * geordneten Liste — wie eine Playlist. Eigenständiges System (NICHT Song-Modus).
 * Singleton-Store + localStorage, gespiegelt nach useSceneStore.
 *
 * Listen-Transformationen sind als reine, exportierte Helfer implementiert
 * (unit-testbar); die Store-Funktionen sind dünne Wrapper darüber.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-pattern-groups:v1";

export const GROUP_COLORS = [
  "#06b6d4", "#f59e0b", "#a855f7", "#10b981",
  "#f43f5e", "#0ea5e9", "#84cc16", "#ff6b35",
];

export interface PatternGroup {
  id: string;
  name: string;
  color: string;
  /** Geordnete Pattern-IDs. */
  patternIds: string[];
  /** Wie oft jedes Pattern loopt, bevor zum nächsten gewechselt wird (≥1). */
  repeats: number;
}

interface GroupState {
  groups: PatternGroup[];
  /** Aktuell als Sequenz abgespielte Gruppe (null = keine). */
  playingGroupId: string | null;
}

type Listener = () => void;

function makeId() { return `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

function load(): GroupState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const groups: PatternGroup[] = (parsed.groups ?? []).map((g: Partial<PatternGroup>) => ({
        id: g.id!, name: g.name ?? "Gruppe", color: g.color ?? GROUP_COLORS[0],
        patternIds: g.patternIds ?? [], repeats: Math.max(1, g.repeats ?? 1),
      }));
      return { groups, playingGroupId: null };
    }
  } catch { /* ignore */ }
  return { groups: [], playingGroupId: null };
}

function persist(s: GroupState) {
  // playingGroupId ist transient — nicht persistieren.
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ groups: s.groups })); } catch { /* ignore */ }
}

let _state: GroupState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function getPatternGroupState(): GroupState { return _state; }

// ─── Reine Listen-Helfer (testbar) ────────────────────────────────────────────

export function addPatternPure(groups: PatternGroup[], groupId: string, patternId: string): PatternGroup[] {
  return groups.map(g =>
    g.id === groupId && !g.patternIds.includes(patternId)
      ? { ...g, patternIds: [...g.patternIds, patternId] }
      : g,
  );
}

export function removePatternPure(groups: PatternGroup[], groupId: string, patternId: string): PatternGroup[] {
  return groups.map(g =>
    g.id === groupId ? { ...g, patternIds: g.patternIds.filter(id => id !== patternId) } : g,
  );
}

export function moveInGroupPure(groups: PatternGroup[], groupId: string, from: number, to: number): PatternGroup[] {
  return groups.map(g => {
    if (g.id !== groupId) return g;
    const ids = [...g.patternIds];
    if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return g;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    return { ...g, patternIds: ids };
  });
}

/** Entfernt eine Pattern-ID aus ALLEN Gruppen (z.B. wenn ein Pattern gelöscht wird). */
export function purgePatternPure(groups: PatternGroup[], patternId: string): PatternGroup[] {
  return groups.map(g =>
    g.patternIds.includes(patternId)
      ? { ...g, patternIds: g.patternIds.filter(id => id !== patternId) }
      : g,
  );
}

// ─── Store-Mutationen ─────────────────────────────────────────────────────────

export function addGroup(name: string): string {
  const id = makeId();
  const color = GROUP_COLORS[_state.groups.length % GROUP_COLORS.length];
  _state = { ..._state, groups: [..._state.groups, { id, name, color, patternIds: [], repeats: 1 }] };
  persist(_state); notify();
  return id;
}

export function renameGroup(id: string, name: string): void {
  _state = { ..._state, groups: _state.groups.map(g => g.id === id ? { ...g, name } : g) };
  persist(_state); notify();
}

/** Wiederholungen pro Pattern (1..64) für die Sequenz-Wiedergabe der Gruppe. */
export function setGroupRepeats(id: string, repeats: number): void {
  const r = Math.max(1, Math.min(64, Math.round(repeats) || 1));
  _state = { ..._state, groups: _state.groups.map(g => g.id === id ? { ...g, repeats: r } : g) };
  persist(_state); notify();
}

export function removeGroup(id: string): void {
  _state = {
    ..._state,
    groups: _state.groups.filter(g => g.id !== id),
    playingGroupId: _state.playingGroupId === id ? null : _state.playingGroupId,
  };
  persist(_state); notify();
}

export function addPatternToGroup(groupId: string, patternId: string): void {
  _state = { ..._state, groups: addPatternPure(_state.groups, groupId, patternId) };
  persist(_state); notify();
}

export function removePatternFromGroup(groupId: string, patternId: string): void {
  _state = { ..._state, groups: removePatternPure(_state.groups, groupId, patternId) };
  persist(_state); notify();
}

export function moveInGroup(groupId: string, from: number, to: number): void {
  _state = { ..._state, groups: moveInGroupPure(_state.groups, groupId, from, to) };
  persist(_state); notify();
}

export function purgePattern(patternId: string): void {
  _state = { ..._state, groups: purgePatternPure(_state.groups, patternId) };
  persist(_state); notify();
}

export function setPlayingGroup(id: string | null): void {
  _state = { ..._state, playingGroupId: id };
  notify(); // transient → nicht persistieren
}

export function usePatternGroupStore(): GroupState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

/** Test-Helper: Store zurücksetzen (verhindert Leaks zwischen Specs). */
export function __resetPatternGroupStoreForTests(): void {
  _state = { groups: [], playingGroupId: null };
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
