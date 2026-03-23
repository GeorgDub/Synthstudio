/**
 * Synthstudio – useElectronStore Hook (IPC-Bridge-Agent)
 *
 * React-Hook für den persistenten App-Store.
 * Funktioniert in Electron (via IPC) und im Browser (via localStorage).
 *
 * Verwendung:
 * ```tsx
 * const { theme, setTheme } = useElectronStore();
 * const { recentProjects, addRecentProject } = useRecentProjects();
 * ```
 */
import { useState, useEffect, useCallback } from "react";
import type { RecentProject } from "./store";

// ─── Typen ────────────────────────────────────────────────────────────────────

export type Theme = "dark" | "light";

export interface ElectronStoreState {
  theme: Theme;
  lastImportPath: string;
  isLoading: boolean;
}

export interface UseElectronStoreReturn extends ElectronStoreState {
  setTheme: (theme: Theme) => Promise<void>;
  setLastImportPath: (path: string) => Promise<void>;
}

export interface UseRecentProjectsReturn {
  recentProjects: RecentProject[];
  isLoading: boolean;
  addRecentProject: (filePath: string) => Promise<void>;
  removeRecentProject: (filePath: string) => Promise<void>;
  clearRecentProjects: () => Promise<void>;
}

// ─── Browser-Fallback Hilfsfunktionen ─────────────────────────────────────────

const LS_PREFIX = "synthstudio:";

function lsGet<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function lsSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // localStorage nicht verfügbar (z.B. private mode)
  }
}

// ─── Electron-Erkennung ───────────────────────────────────────────────────────

function isElectron(): boolean {
  return typeof window !== "undefined" && typeof window.electronAPI !== "undefined";
}

// ─── useElectronStore ─────────────────────────────────────────────────────────

/**
 * Hook für allgemeine App-Einstellungen (Theme, letzter Import-Pfad).
 */
export function useElectronStore(): UseElectronStoreReturn {
  const [state, setState] = useState<ElectronStoreState>({
    theme: "dark",
    lastImportPath: "",
    isLoading: true,
  });

  // Initialen Zustand laden
  useEffect(() => {
    async function load() {
      if (isElectron() && window.electronAPI) {
        const [themeRes, pathRes] = await Promise.all([
          window.electronAPI.storeGet?.("theme"),
          window.electronAPI.storeGet?.("lastImportPath"),
        ]);
        setState({
          theme: (themeRes?.data as Theme) ?? "dark",
          lastImportPath: (pathRes?.data as string) ?? "",
          isLoading: false,
        });
      } else {
        // Browser-Fallback: localStorage
        setState({
          theme: lsGet<Theme>("theme", "dark"),
          lastImportPath: lsGet<string>("lastImportPath", ""),
          isLoading: false,
        });
      }
    }
    load();
  }, []);

  const setTheme = useCallback(async (theme: Theme) => {
    setState((prev) => ({ ...prev, theme }));
    if (isElectron() && window.electronAPI) {
      await window.electronAPI.storeSet?.("theme", theme);
    } else {
      lsSet("theme", theme);
    }
  }, []);

  const setLastImportPath = useCallback(async (importPath: string) => {
    setState((prev) => ({ ...prev, lastImportPath: importPath }));
    if (isElectron() && window.electronAPI) {
      await window.electronAPI.storeSet?.("lastImportPath", importPath);
    } else {
      lsSet("lastImportPath", importPath);
    }
  }, []);

  return { ...state, setTheme, setLastImportPath };
}

// ─── useRecentProjects ────────────────────────────────────────────────────────

/**
 * Hook für die Liste der zuletzt geöffneten Projekte.
 * Reagiert automatisch auf Änderungen aus anderen Fenstern.
 */
export function useRecentProjects(): UseRecentProjectsReturn {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Initialen Zustand laden
  useEffect(() => {
    async function load() {
      if (isElectron() && window.electronAPI) {
        const res = await window.electronAPI.storeGetRecent?.();
        setRecentProjects(res?.data ?? []);
      } else {
        setRecentProjects(lsGet<RecentProject[]>("recentProjects", []));
      }
      setIsLoading(false);
    }
    load();
  }, []);

  // Auf Änderungen aus anderen Fenstern reagieren (nur Electron)
  useEffect(() => {
    if (!isElectron() || !window.electronAPI) return;
    const cleanup = window.electronAPI.onRecentProjectsChanged?.((projects) => {
      setRecentProjects(projects);
    });
    return cleanup;
  }, []);

  const addRecentProject = useCallback(async (filePath: string) => {
    if (isElectron() && window.electronAPI) {
      await window.electronAPI.storeAddRecent?.(filePath);
      // Liste wird via onRecentProjectsChanged aktualisiert
    } else {
      // Browser-Fallback
      const existing = lsGet<RecentProject[]>("recentProjects", []);
      const name = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? filePath;
      const updated = [
        { filePath, name, lastOpened: new Date().toISOString() },
        ...existing.filter((p) => p.filePath !== filePath),
      ].slice(0, 10);
      lsSet("recentProjects", updated);
      setRecentProjects(updated);
    }
  }, []);

  const removeRecentProject = useCallback(async (filePath: string) => {
    if (isElectron() && window.electronAPI) {
      await window.electronAPI.storeRemoveRecent?.(filePath);
    } else {
      const updated = lsGet<RecentProject[]>("recentProjects", []).filter(
        (p) => p.filePath !== filePath
      );
      lsSet("recentProjects", updated);
      setRecentProjects(updated);
    }
  }, []);

  const clearRecentProjects = useCallback(async () => {
    if (isElectron() && window.electronAPI) {
      await window.electronAPI.storeClearRecent?.();
    } else {
      lsSet("recentProjects", []);
      setRecentProjects([]);
    }
  }, []);

  return {
    recentProjects,
    isLoading,
    addRecentProject,
    removeRecentProject,
    clearRecentProjects,
  };
}
