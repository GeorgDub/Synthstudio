/**
 * Synthstudio – useSceneStore
 *
 * Scene Launch: Snapshots von Pattern-Zuständen für Live-Performance.
 * Eine Scene speichert die aktive Pattern-ID und kann per Klick oder
 * Keyboard-Shortcut live gestartet werden.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-scenes:v1";

export const SCENE_COLORS = [
  "#f59e0b", "#06b6d4", "#10b981", "#f43f5e",
  "#a855f7", "#ff6b35", "#0ea5e9", "#84cc16",
];

export interface Scene {
  id: string;
  name: string;
  /** Pattern-ID aus useDrumMachineStore.patterns */
  patternId: string;
  color: string;
}

interface SceneState {
  scenes: Scene[];
  activeSceneId: string | null;
}

type Listener = () => void;

function makeId() { return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

function load(): SceneState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { scenes: [], activeSceneId: null };
}

function persist(s: SceneState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let _state: SceneState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

/** v2.10: synchroner Getter für Event-Handler die nicht im React-Render-Cycle laufen. */
export function getSceneState(): SceneState {
  return _state;
}

export function addScene(name: string, patternId: string): string {
  const id = makeId();
  const color = SCENE_COLORS[_state.scenes.length % SCENE_COLORS.length];
  _state = { ..._state, scenes: [..._state.scenes, { id, name, patternId, color }] };
  persist(_state); notify();
  return id;
}

export function updateScene(id: string, changes: Partial<Pick<Scene, "name" | "patternId" | "color">>): void {
  _state = { ..._state, scenes: _state.scenes.map(s => s.id === id ? { ...s, ...changes } : s) };
  persist(_state); notify();
}

export function removeScene(id: string): void {
  _state = {
    ..._state,
    scenes: _state.scenes.filter(s => s.id !== id),
    activeSceneId: _state.activeSceneId === id ? null : _state.activeSceneId,
  };
  persist(_state); notify();
}

export function setActiveScene(id: string | null): void {
  _state = { ..._state, activeSceneId: id };
  persist(_state); notify();
}

/**
 * TASK-231: Wechselt zur nächsten/vorigen Scene mit Wrap-Around. Hilfsfunktion
 * für Hardware-Buttons (nanoKONTROL2 Marker-PREV/NEXT).
 * No-op wenn keine Scenes existieren. Liefert die neue active Scene-ID
 * zurück (oder null).
 *
 * @param direction +1 = vorwärts, -1 = rückwärts
 */
export function cycleScene(direction: 1 | -1): string | null {
  const scenes = _state.scenes;
  if (scenes.length === 0) return null;
  const currentIdx = scenes.findIndex(s => s.id === _state.activeSceneId);
  let nextIdx: number;
  if (currentIdx < 0) {
    // Keine aktive Scene → starte bei 0 (vor) oder letzter (zurück)
    nextIdx = direction > 0 ? 0 : scenes.length - 1;
  } else {
    nextIdx = (currentIdx + direction + scenes.length) % scenes.length;
  }
  const nextId = scenes[nextIdx].id;
  _state = { ..._state, activeSceneId: nextId };
  persist(_state); notify();
  return nextId;
}

export function reorderScene(fromIdx: number, toIdx: number): void {
  const scenes = [..._state.scenes];
  const [moved] = scenes.splice(fromIdx, 1);
  scenes.splice(toIdx, 0, moved);
  _state = { ..._state, scenes };
  persist(_state); notify();
}

export function useSceneStore(): SceneState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

// ─── Test Helper (v3.50.0) ───────────────────────────────────────────────────
/**
 * Setzt den Scene-Store auf Default zurück (leeres scenes-Array, kein active).
 * Wird in Tests verwendet damit zwischen den Specs keine Scenes leaken.
 * Wirkt sowohl auf den In-Memory-State als auch auf localStorage.
 */
export function __resetSceneStoreForTests(): void {
  _state = { scenes: [], activeSceneId: null };
  persist(_state);
  notify();
}
