"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useElectronStore = useElectronStore;
exports.useRecentProjects = useRecentProjects;
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
const react_1 = require("react");
// ─── Browser-Fallback Hilfsfunktionen ─────────────────────────────────────────
const LS_PREFIX = "synthstudio:";
function lsGet(key, defaultValue) {
    try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        if (raw === null)
            return defaultValue;
        return JSON.parse(raw);
    }
    catch {
        return defaultValue;
    }
}
function lsSet(key, value) {
    try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    }
    catch {
        // localStorage nicht verfügbar (z.B. private mode)
    }
}
// ─── Electron-Erkennung ───────────────────────────────────────────────────────
function isElectron() {
    return typeof window !== "undefined" && typeof window.electronAPI !== "undefined";
}
// ─── useElectronStore ─────────────────────────────────────────────────────────
/**
 * Hook für allgemeine App-Einstellungen (Theme, letzter Import-Pfad).
 */
function useElectronStore() {
    const [state, setState] = (0, react_1.useState)({
        theme: "dark",
        lastImportPath: "",
        isLoading: true,
    });
    // Initialen Zustand laden
    (0, react_1.useEffect)(() => {
        async function load() {
            if (isElectron() && window.electronAPI) {
                const [themeRes, pathRes] = await Promise.all([
                    window.electronAPI.storeGet?.("theme"),
                    window.electronAPI.storeGet?.("lastImportPath"),
                ]);
                setState({
                    theme: themeRes?.data ?? "dark",
                    lastImportPath: pathRes?.data ?? "",
                    isLoading: false,
                });
            }
            else {
                // Browser-Fallback: localStorage
                setState({
                    theme: lsGet("theme", "dark"),
                    lastImportPath: lsGet("lastImportPath", ""),
                    isLoading: false,
                });
            }
        }
        load();
    }, []);
    const setTheme = (0, react_1.useCallback)(async (theme) => {
        setState((prev) => ({ ...prev, theme }));
        if (isElectron() && window.electronAPI) {
            await window.electronAPI.storeSet?.("theme", theme);
        }
        else {
            lsSet("theme", theme);
        }
    }, []);
    const setLastImportPath = (0, react_1.useCallback)(async (importPath) => {
        setState((prev) => ({ ...prev, lastImportPath: importPath }));
        if (isElectron() && window.electronAPI) {
            await window.electronAPI.storeSet?.("lastImportPath", importPath);
        }
        else {
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
function useRecentProjects() {
    const [recentProjects, setRecentProjects] = (0, react_1.useState)([]);
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    // Initialen Zustand laden
    (0, react_1.useEffect)(() => {
        async function load() {
            if (isElectron() && window.electronAPI) {
                const res = await window.electronAPI.storeGetRecent?.();
                setRecentProjects(res?.data ?? []);
            }
            else {
                setRecentProjects(lsGet("recentProjects", []));
            }
            setIsLoading(false);
        }
        load();
    }, []);
    // Auf Änderungen aus anderen Fenstern reagieren (nur Electron)
    (0, react_1.useEffect)(() => {
        if (!isElectron() || !window.electronAPI)
            return;
        const cleanup = window.electronAPI.onRecentProjectsChanged?.((projects) => {
            setRecentProjects(projects);
        });
        return cleanup;
    }, []);
    const addRecentProject = (0, react_1.useCallback)(async (filePath) => {
        if (isElectron() && window.electronAPI) {
            await window.electronAPI.storeAddRecent?.(filePath);
            // Liste wird via onRecentProjectsChanged aktualisiert
        }
        else {
            // Browser-Fallback
            const existing = lsGet("recentProjects", []);
            const name = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? filePath;
            const updated = [
                { filePath, name, lastOpened: new Date().toISOString() },
                ...existing.filter((p) => p.filePath !== filePath),
            ].slice(0, 10);
            lsSet("recentProjects", updated);
            setRecentProjects(updated);
        }
    }, []);
    const removeRecentProject = (0, react_1.useCallback)(async (filePath) => {
        if (isElectron() && window.electronAPI) {
            await window.electronAPI.storeRemoveRecent?.(filePath);
        }
        else {
            const updated = lsGet("recentProjects", []).filter((p) => p.filePath !== filePath);
            lsSet("recentProjects", updated);
            setRecentProjects(updated);
        }
    }, []);
    const clearRecentProjects = (0, react_1.useCallback)(async () => {
        if (isElectron() && window.electronAPI) {
            await window.electronAPI.storeClearRecent?.();
        }
        else {
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
