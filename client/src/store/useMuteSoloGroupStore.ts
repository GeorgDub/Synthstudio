/**
 * Synthstudio – useMuteSoloGroupStore (v3.125.0)
 *
 * Bus-Groups für one-click group-mute/solo (Performance Live-UX).
 * Beispiel: "Drums" (Kick+Snare+Hat+Clap), "Bass" (Bass+Sub), "Lead" (Synth1+Synth2).
 * Group-Mute = mute alle Channels in der Group. Group-Solo = nur diese
 * Channels hörbar (alle nicht-Group-Channels werden muted, dabei merken
 * wir uns die alten Mute-Werte um sie via clearSoloGroup restaurieren).
 *
 * Pattern: Custom-Observer-Store (siehe useAudioSidechainStore /
 * useSceneStore). KEIN Zustand-NPM-Package.
 * Persistenz: localStorage `ss-mute-solo-groups:v1`.
 *
 * Public API:
 *  - useMuteSoloGroupStore() → State + Actions (Hook für UI)
 *  - getMuteSoloGroupState() → State (Sync, für Event-Handler)
 *  - addGroup / removeGroup / renameGroup / setGroupColor
 *  - addChannelToGroup / removeChannelFromGroup
 *  - muteGroup / soloGroup / clearSoloGroup
 *  - removeChannelFromAllGroups (Cleanup wenn Channel weg)
 *
 * Mute/Solo selber wird NICHT im Store gehalten — der Store dispatcht
 * CustomEvents `mute-solo-group:muteChannels` / `:soloChannels` /
 * `:clearSolo` mit channelId[]-Arrays. Der Konsument (DrumMachine bzw.
 * App.tsx) ruft dann dm.setPartMuted(id, …) für jeden Channel.
 *
 * Damit bleibt der Store DOM-frei und Node-testbar — und vermeidet
 * eine zirkuläre Abhängigkeit zum useDrumMachineStore.
 */

import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-mute-solo-groups:v1";

/** Default-Group-Color wenn nichts angegeben (Pad-Green aus v3.73-Palette). */
export const DEFAULT_GROUP_COLOR = "#22c55e";

/** Hex-RegExp wie in channelColors.ts. */
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface MuteSoloGroup {
  /** Stable Group-ID (gen'd by Store). */
  id: string;
  /** User-supplied label. */
  name: string;
  /** Hex-Color (#RGB oder #RRGGBB). */
  color: string;
  /** Channel-IDs (Part-IDs). Keine Duplikate, Reihenfolge per Insertion. */
  channelIds: string[];
}

export interface MuteSoloGroupStoreState {
  groups: MuteSoloGroup[];
  /**
   * Per-Group Snapshot der Mute-Zustände VOR soloGroup, damit clearSoloGroup
   * die alten Werte restaurieren kann. Map: groupId → channelId → wasMuted.
   * Wird nicht persistiert (Live-UX-only).
   */
  soloSnapshots: Record<string, Record<string, boolean>>;
}

type Listener = () => void;
const _listeners = new Set<Listener>();
function _notify(): void {
  _listeners.forEach((l) => l());
}

function _isValidHex(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

function _sanitizeColor(value: unknown): string {
  if (_isValidHex(value)) return value.toLowerCase();
  return DEFAULT_GROUP_COLOR;
}

function _dedupeChannelIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function _loadFromStorage(): MuteSoloGroupStoreState {
  if (typeof localStorage === "undefined") {
    return { groups: [], soloSnapshots: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { groups: [], soloSnapshots: {} };
    const parsed = JSON.parse(raw) as Partial<MuteSoloGroupStoreState>;
    if (!parsed || !Array.isArray(parsed.groups)) {
      return { groups: [], soloSnapshots: {} };
    }
    const seenIds = new Set<string>();
    const groups: MuteSoloGroup[] = [];
    for (const g of parsed.groups) {
      if (!g || typeof g !== "object") continue;
      const id = typeof g.id === "string" && g.id ? g.id : _generateGroupId();
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const name = typeof g.name === "string" ? g.name : "Group";
      groups.push({
        id,
        name,
        color: _sanitizeColor(g.color),
        channelIds: _dedupeChannelIds(g.channelIds),
      });
    }
    return { groups, soloSnapshots: {} };
  } catch {
    return { groups: [], soloSnapshots: {} };
  }
}

function _persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    // soloSnapshots werden NICHT persistiert (Live-Only).
    const toSave = { groups: _state.groups };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    /* quota / disabled — silent */
  }
}

let _idCounter = 0;
function _generateGroupId(): string {
  _idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `msg-${time}-${rand}-${_idCounter}`;
}

let _state: MuteSoloGroupStoreState = _loadFromStorage();

// ─── Event-Helpers (DOM-frei wenn window nicht existiert) ────────────────────

function _dispatchEvent(name: string, detail: unknown): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* ignore */
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getMuteSoloGroupState(): MuteSoloGroupStoreState {
  return _state;
}

export function getGroupById(id: string): MuteSoloGroup | undefined {
  return _state.groups.find((g) => g.id === id);
}

export function addGroup(
  name: string,
  color: string,
  channelIds: string[] = [],
): MuteSoloGroup {
  const group: MuteSoloGroup = {
    id: _generateGroupId(),
    name: typeof name === "string" && name ? name : "Group",
    color: _sanitizeColor(color),
    channelIds: _dedupeChannelIds(channelIds),
  };
  _state = { ..._state, groups: [..._state.groups, group] };
  _persist();
  _notify();
  return group;
}

export function removeGroup(id: string): void {
  const next = _state.groups.filter((g) => g.id !== id);
  if (next.length === _state.groups.length) return;
  // Cleanup snapshot (group is gone).
  const nextSnap = { ..._state.soloSnapshots };
  delete nextSnap[id];
  _state = { ..._state, groups: next, soloSnapshots: nextSnap };
  _persist();
  _notify();
}

export function renameGroup(id: string, name: string): void {
  if (typeof name !== "string" || !name) return;
  let changed = false;
  const next = _state.groups.map((g) => {
    if (g.id !== id) return g;
    if (g.name === name) return g;
    changed = true;
    return { ...g, name };
  });
  if (!changed) return;
  _state = { ..._state, groups: next };
  _persist();
  _notify();
}

export function setGroupColor(id: string, color: string): void {
  const norm = _sanitizeColor(color);
  let changed = false;
  const next = _state.groups.map((g) => {
    if (g.id !== id) return g;
    if (g.color === norm) return g;
    changed = true;
    return { ...g, color: norm };
  });
  if (!changed) return;
  _state = { ..._state, groups: next };
  _persist();
  _notify();
}

export function addChannelToGroup(groupId: string, channelId: string): void {
  if (typeof channelId !== "string" || !channelId) return;
  let changed = false;
  const next = _state.groups.map((g) => {
    if (g.id !== groupId) return g;
    if (g.channelIds.includes(channelId)) return g; // idempotent
    changed = true;
    return { ...g, channelIds: [...g.channelIds, channelId] };
  });
  if (!changed) return;
  _state = { ..._state, groups: next };
  _persist();
  _notify();
}

export function removeChannelFromGroup(groupId: string, channelId: string): void {
  let changed = false;
  const next = _state.groups.map((g) => {
    if (g.id !== groupId) return g;
    if (!g.channelIds.includes(channelId)) return g;
    changed = true;
    return { ...g, channelIds: g.channelIds.filter((id) => id !== channelId) };
  });
  if (!changed) return;
  _state = { ..._state, groups: next };
  _persist();
  _notify();
}

/**
 * Aufruf wenn ein Channel komplett gelöscht wird — entfernt ihn aus ALLEN
 * Groups (plus aus den Snapshots).
 */
export function removeChannelFromAllGroups(channelId: string): void {
  if (typeof channelId !== "string" || !channelId) return;
  let changed = false;
  const nextGroups = _state.groups.map((g) => {
    if (!g.channelIds.includes(channelId)) return g;
    changed = true;
    return { ...g, channelIds: g.channelIds.filter((id) => id !== channelId) };
  });
  const nextSnap: Record<string, Record<string, boolean>> = {};
  for (const [gId, map] of Object.entries(_state.soloSnapshots)) {
    if (!(channelId in map)) {
      nextSnap[gId] = map;
      continue;
    }
    const copy = { ...map };
    delete copy[channelId];
    nextSnap[gId] = copy;
    changed = true;
  }
  if (!changed) return;
  _state = { ..._state, groups: nextGroups, soloSnapshots: nextSnap };
  _persist();
  _notify();
}

/**
 * Mute-Group: dispatcht `mute-solo-group:muteChannels` mit der Group-ID +
 * dem Channel-IDs-Array. Der UI-Konsument muted dann alle gelisteten
 * Channels via dm.setPartMuted(id, true).
 *
 * Empty-Group: no-op (kein Event, kein Throw).
 */
export function muteGroup(id: string): void {
  const group = getGroupById(id);
  if (!group || group.channelIds.length === 0) return;
  _dispatchEvent("mute-solo-group:muteChannels", {
    groupId: id,
    channelIds: group.channelIds.slice(),
  });
}

/**
 * Solo-Group: snapshottet aktuelle Mute-Zustände (alle Channels die NICHT
 * in der Group sind sollen gemuted werden, alle in der Group unmuted).
 * Der Konsument muss den aktuellen `currentMutes` Snapshot mitliefern.
 *
 * Damit das im Store DOM-frei bleibt, ist die Action zweistufig:
 *  1. soloGroup(id, allChannelIds, currentMutes) → schreibt Snapshot, dispatcht Event.
 *  2. UI hört "mute-solo-group:soloChannels" und applied es.
 *
 * Empty-Group: no-op.
 */
export function soloGroup(
  id: string,
  allChannelIds: string[],
  currentMutes: Record<string, boolean>,
): void {
  const group = getGroupById(id);
  if (!group || group.channelIds.length === 0) return;
  // Snapshot: alle Channels die wir gleich modifizieren.
  const snap: Record<string, boolean> = {};
  for (const cid of allChannelIds) {
    snap[cid] = currentMutes[cid] === true;
  }
  const nextSnap = { ..._state.soloSnapshots, [id]: snap };
  _state = { ..._state, soloSnapshots: nextSnap };
  _notify();

  // Ziel-State: Channel ∈ Group → muted=false, sonst → muted=true.
  const groupSet = new Set(group.channelIds);
  const target: Array<{ channelId: string; muted: boolean }> = [];
  for (const cid of allChannelIds) {
    target.push({ channelId: cid, muted: !groupSet.has(cid) });
  }
  _dispatchEvent("mute-solo-group:soloChannels", { groupId: id, target });
}

/**
 * clearSoloGroup: restored die Mute-States aus dem Snapshot.
 * Wenn kein Snapshot vorhanden → no-op.
 */
export function clearSoloGroup(id: string): void {
  const snap = _state.soloSnapshots[id];
  if (!snap) return;
  const target: Array<{ channelId: string; muted: boolean }> = Object.entries(
    snap,
  ).map(([channelId, muted]) => ({ channelId, muted }));
  // Snapshot cleanup
  const nextSnap = { ..._state.soloSnapshots };
  delete nextSnap[id];
  _state = { ..._state, soloSnapshots: nextSnap };
  _notify();

  _dispatchEvent("mute-solo-group:clearSolo", { groupId: id, target });
}

/** True wenn aktuell ein soloSnapshot für die Group existiert. */
export function isGroupSoloed(id: string): boolean {
  return _state.soloSnapshots[id] !== undefined;
}

/** Test-Helper. */
export function __resetMuteSoloGroupStoreForTests(): void {
  _state = { groups: [], soloSnapshots: {} };
  _idCounter = 0;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  _notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useMuteSoloGroupStore(): MuteSoloGroupStoreState & {
  addGroup: typeof addGroup;
  removeGroup: typeof removeGroup;
  renameGroup: typeof renameGroup;
  setGroupColor: typeof setGroupColor;
  addChannelToGroup: typeof addChannelToGroup;
  removeChannelFromGroup: typeof removeChannelFromGroup;
  removeChannelFromAllGroups: typeof removeChannelFromAllGroups;
  muteGroup: typeof muteGroup;
  soloGroup: typeof soloGroup;
  clearSoloGroup: typeof clearSoloGroup;
  isGroupSoloed: typeof isGroupSoloed;
  getGroupById: typeof getGroupById;
} {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    ..._state,
    addGroup,
    removeGroup,
    renameGroup,
    setGroupColor,
    addChannelToGroup,
    removeChannelFromGroup,
    removeChannelFromAllGroups,
    muteGroup,
    soloGroup,
    clearSoloGroup,
    isGroupSoloed,
    getGroupById,
  };
}
