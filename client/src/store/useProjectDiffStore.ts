/**
 * Synthstudio – useProjectDiffStore (v3.118.0)
 *
 * Ephemeraler Store für das Project-Diff-Compare-Tool. Hält die beiden
 * geladenen .synth-Snapshots (linkes/rechtes Projekt) und das berechnete
 * Diff-Result. Bewusst KEINE localStorage-Persistenz — Diffs sind ein
 * Performance-Setup-Workflow, kein Save-Target.
 *
 * Pattern: Custom-Observer-Store (analog useSceneStore, useMorphStore).
 */
import { useEffect, useReducer } from "react";
import type { SynthProject } from "@/utils/projectSerializer";
import { diffProjects, type ProjectDiff } from "@/utils/projectDiff";

interface ProjectDiffStoreState {
  leftProject: SynthProject | null;
  rightProject: SynthProject | null;
  currentDiff: ProjectDiff | null;
}

type Listener = () => void;

let _state: ProjectDiffStoreState = {
  leftProject: null,
  rightProject: null,
  currentDiff: null,
};

const _listeners = new Set<Listener>();
function notify() {
  _listeners.forEach((l) => l());
}

/** Synchroner Getter für Event-Handler außerhalb der React-Render-Schleife. */
export function getProjectDiffState(): ProjectDiffStoreState {
  return _state;
}

function recomputeDiff(left: SynthProject | null, right: SynthProject | null): ProjectDiff | null {
  if (!left || !right) return null;
  return diffProjects(left, right);
}

export function setLeftProject(project: SynthProject | null): void {
  const currentDiff = recomputeDiff(project, _state.rightProject);
  _state = { ..._state, leftProject: project, currentDiff };
  notify();
}

export function setRightProject(project: SynthProject | null): void {
  const currentDiff = recomputeDiff(_state.leftProject, project);
  _state = { ..._state, rightProject: project, currentDiff };
  notify();
}

export function clearAll(): void {
  _state = { leftProject: null, rightProject: null, currentDiff: null };
  notify();
}

/**
 * Recompute helper — nützlich falls externe Code-Pfade die Snapshots
 * mutiert haben (sollten sie nicht, aber defensive). Kein-op wenn eines
 * der Projekte fehlt.
 */
export function recomputeCurrentDiff(): void {
  const currentDiff = recomputeDiff(_state.leftProject, _state.rightProject);
  if (currentDiff !== _state.currentDiff) {
    _state = { ..._state, currentDiff };
    notify();
  }
}

/** Test-Helper: setzt den Store auf den Initial-State zurück. */
export function __resetProjectDiffStoreForTests(): void {
  _state = { leftProject: null, rightProject: null, currentDiff: null };
  notify();
}

/**
 * React-Hook nach dem Synthstudio Custom-Observer-Pattern.
 * Returnt den State + Actions als ein Objekt.
 */
export function useProjectDiffStore(): ProjectDiffStoreState & {
  setLeftProject: (p: SynthProject | null) => void;
  setRightProject: (p: SynthProject | null) => void;
  clearAll: () => void;
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
    setLeftProject,
    setRightProject,
    clearAll,
  };
}
