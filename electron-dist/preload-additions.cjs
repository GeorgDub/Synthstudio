"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeAPI = void 0;
/**
 * Synthstudio – Preload-Erweiterungen (IPC-Bridge-Agent)
 *
 * Dieses Modul zeigt die neuen IPC-Kanäle für den persistenten Store.
 * Diese Methoden werden in preload.ts in das electronAPI-Objekt integriert.
 *
 * INTEGRATION in preload.ts:
 * Füge diese Methoden zum contextBridge.exposeInMainWorld("electronAPI", { ... }) hinzu.
 */
const electron_1 = require("electron");
function createDataListener(channel) {
    return (callback) => {
        const handler = (_event, data) => callback(data);
        electron_1.ipcRenderer.on(channel, handler);
        return () => electron_1.ipcRenderer.removeListener(channel, handler);
    };
}
// ─── Store-API (in preload.ts integrieren) ────────────────────────────────────
exports.storeAPI = {
    /**
     * Liest einen Wert aus dem persistenten Store.
     * @example const theme = await electronAPI.store.get('theme')
     */
    get: (key) => electron_1.ipcRenderer.invoke("store:get", key),
    /**
     * Schreibt einen Wert in den persistenten Store.
     * @example await electronAPI.store.set('theme', 'dark')
     */
    set: (key, value) => electron_1.ipcRenderer.invoke("store:set", key, value),
    /**
     * Gibt alle zuletzt geöffneten Projekte zurück (neueste zuerst).
     */
    getRecentProjects: () => electron_1.ipcRenderer.invoke("store:get-recent"),
    /**
     * Fügt ein Projekt zur Liste der zuletzt geöffneten Projekte hinzu.
     */
    addRecentProject: (filePath) => electron_1.ipcRenderer.invoke("store:add-recent", filePath),
    /**
     * Entfernt ein Projekt aus der Liste der zuletzt geöffneten Projekte.
     */
    removeRecentProject: (filePath) => electron_1.ipcRenderer.invoke("store:remove-recent", filePath),
    /**
     * Löscht alle zuletzt geöffneten Projekte.
     */
    clearRecentProjects: () => electron_1.ipcRenderer.invoke("store:clear-recent"),
    /**
     * Listener: Wird aufgerufen wenn sich die Liste der zuletzt geöffneten Projekte ändert.
     * Gibt eine Cleanup-Funktion zurück (für useEffect).
     */
    onRecentProjectsChanged: createDataListener("store:recent-changed"),
};
