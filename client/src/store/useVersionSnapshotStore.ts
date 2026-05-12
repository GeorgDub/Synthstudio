/**
 * Synthstudio – useVersionSnapshotStore
 *
 * Automatische Projekt-Checkpoints (Version Snapshots).
 * Speichert periodisch einen komprimierten Snapshot des gesamten
 * DrumMachine-State in localStorage. Max 10 Snapshots, älteste rotieren.
 *
 * Verwendung:
 *   const snap = useVersionSnapshotStore();
 *   snap.saveNow(dmState, projectName);     // manueller Snapshot
 *   snap.restore(id, onRestore);            // Snapshot wiederherstellen
 */
import { useEffect, useReducer } from "react";

export interface VersionSnapshot {
  id: string;
  label: string;          // z.B. "Auto-Save 14:32"
  projectName: string;
  timestamp: number;
  /** JSON-serialisierter DrumMachine-Pattern-State (komprimiert) */
  patternsJson: string;
}

const STORAGE_KEY = "ss-version-snapshots:v1";
const MAX_SNAPSHOTS = 10;

type Listener = () => void;

function makeId() { return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`; }

function load(): VersionSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persist(snaps: VersionSnapshot[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snaps)); } catch { /* ignore */ }
}

let _snapshots: VersionSnapshot[] = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function saveSnapshot(patterns: unknown, projectName: string, label?: string): string {
  const id = makeId();
  const timestamp = Date.now();
  const time = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const snap: VersionSnapshot = {
    id,
    label: label ?? `Auto-Save ${time}`,
    projectName,
    timestamp,
    patternsJson: JSON.stringify(patterns),
  };
  _snapshots = [snap, ..._snapshots].slice(0, MAX_SNAPSHOTS);
  persist(_snapshots);
  notify();
  return id;
}

export function deleteSnapshot(id: string): void {
  _snapshots = _snapshots.filter(s => s.id !== id);
  persist(_snapshots);
  notify();
}

export function getSnapshot(id: string): VersionSnapshot | undefined {
  return _snapshots.find(s => s.id === id);
}

export function useVersionSnapshotStore(): { snapshots: VersionSnapshot[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { snapshots: _snapshots };
}
