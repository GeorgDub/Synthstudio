/**
 * Synthstudio – Preload-Erweiterungen (IPC-Bridge-Agent)
 *
 * Dieses Modul zeigt die neuen IPC-Kanäle für den persistenten Store.
 * Diese Methoden werden in preload.ts in das electronAPI-Objekt integriert.
 *
 * INTEGRATION in preload.ts:
 * Füge diese Methoden zum contextBridge.exposeInMainWorld("electronAPI", { ... }) hinzu.
 */
import { ipcRenderer, IpcRendererEvent } from "electron";
import type { RecentProject, AppStoreData } from "./store";

// ─── Hilfsfunktionen (identisch mit preload.ts) ───────────────────────────────

type Cleanup = () => void;

function createDataListener<T>(channel: string) {
  return (callback: (data: T) => void): Cleanup => {
    const handler = (_event: IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

// ─── Store-API (in preload.ts integrieren) ────────────────────────────────────

export const storeAPI = {
  /**
   * Liest einen Wert aus dem persistenten Store.
   * @example const theme = await electronAPI.store.get('theme')
   */
  get: <K extends keyof AppStoreData>(key: K) =>
    ipcRenderer.invoke("store:get", key) as Promise<{
      success: boolean;
      data?: AppStoreData[K];
      error?: string;
    }>,

  /**
   * Schreibt einen Wert in den persistenten Store.
   * @example await electronAPI.store.set('theme', 'dark')
   */
  set: <K extends keyof AppStoreData>(key: K, value: AppStoreData[K]) =>
    ipcRenderer.invoke("store:set", key, value) as Promise<{
      success: boolean;
      error?: string;
    }>,

  /**
   * Gibt alle zuletzt geöffneten Projekte zurück (neueste zuerst).
   */
  getRecentProjects: () =>
    ipcRenderer.invoke("store:get-recent") as Promise<{
      success: boolean;
      data?: RecentProject[];
      error?: string;
    }>,

  /**
   * Fügt ein Projekt zur Liste der zuletzt geöffneten Projekte hinzu.
   */
  addRecentProject: (filePath: string) =>
    ipcRenderer.invoke("store:add-recent", filePath) as Promise<{
      success: boolean;
      error?: string;
    }>,

  /**
   * Entfernt ein Projekt aus der Liste der zuletzt geöffneten Projekte.
   */
  removeRecentProject: (filePath: string) =>
    ipcRenderer.invoke("store:remove-recent", filePath) as Promise<{
      success: boolean;
      error?: string;
    }>,

  /**
   * Löscht alle zuletzt geöffneten Projekte.
   */
  clearRecentProjects: () =>
    ipcRenderer.invoke("store:clear-recent") as Promise<{
      success: boolean;
      error?: string;
    }>,

  /**
   * Listener: Wird aufgerufen wenn sich die Liste der zuletzt geöffneten Projekte ändert.
   * Gibt eine Cleanup-Funktion zurück (für useEffect).
   */
  onRecentProjectsChanged: createDataListener<RecentProject[]>("store:recent-changed"),
};

// ─── Typen für types.d.ts ─────────────────────────────────────────────────────

/**
 * Diese Typen müssen in electron/types.d.ts in das ElectronAPI-Interface eingefügt werden:
 *
 * store: {
 *   get: <K extends keyof AppStoreData>(key: K) => Promise<{ success: boolean; data?: AppStoreData[K]; error?: string }>;
 *   set: <K extends keyof AppStoreData>(key: K, value: AppStoreData[K]) => Promise<{ success: boolean; error?: string }>;
 *   getRecentProjects: () => Promise<{ success: boolean; data?: RecentProject[]; error?: string }>;
 *   addRecentProject: (filePath: string) => Promise<{ success: boolean; error?: string }>;
 *   removeRecentProject: (filePath: string) => Promise<{ success: boolean; error?: string }>;
 *   clearRecentProjects: () => Promise<{ success: boolean; error?: string }>;
 *   onRecentProjectsChanged: (callback: (projects: RecentProject[]) => void) => ElectronCleanup;
 * };
 */
export type StoreAPIType = typeof storeAPI;
