/**
 * Synthstudio – useWorkspaceMode (post-v1.35.0 MIG-2B)
 *
 * Feature-Flag für den neuen Dockview-Workspace. Während der MIG-2-Migration
 * läuft Legacy-Tabs + Workspace parallel; User schaltet via Settings um.
 *
 * Default: false (Legacy-Tabs). Wenn dockview stabil ist + alle Tabs migriert,
 * wird das Flag entfernt und Workspace zum einzigen Modus.
 *
 * Persistence: localStorage key "ss-workspace-mode:v1".
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-workspace-mode:v1";

type Listener = () => void;
let _enabled = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach((l) => l()); }

export function getWorkspaceMode(): boolean { return _enabled; }

export function setWorkspaceMode(enabled: boolean): void {
  if (_enabled === enabled) return;
  _enabled = enabled;
  try { localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0"); } catch { /* ignore */ }
  notify();
}

export function useWorkspaceMode(): boolean {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _enabled;
}
