"use strict";
/**
 * Synthstudio – Electron Preload Script (v2)
 *
 * Stellt der Web-App (Renderer) eine sichere API bereit über window.electronAPI.
 * contextIsolation: true – kein direkter Node.js-Zugriff aus dem Renderer.
 *
 * Neue Kanäle in v2:
 * - Dateisystem: readFile, listDirectory, writeFile
 * - Folder-Import: importFolder, cancelImport + Progress/Cancel/Complete-Events
 * - Dialoge: openFile, saveFile, showMessage
 * - Fenster: setFullscreen, isFullscreen, minimize, maximize
 * - App: getVersion, getPlatform, getPath
 * - Benachrichtigungen: showNotification
 * - Menü-Events: alle Menü-Aktionen
 * - Shortcuts: Media-Keys
 * - Updater: check, Events
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// ─── Hilfsfunktion: Event-Listener mit Cleanup ────────────────────────────────
function createEventListener(channel) {
    return (callback) => {
        const handler = (_event, data) => callback(data);
        electron_1.ipcRenderer.on(channel, handler);
        return () => electron_1.ipcRenderer.removeListener(channel, handler);
    };
}
function createVoidListener(channel) {
    return (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on(channel, handler);
        return () => electron_1.ipcRenderer.removeListener(channel, handler);
    };
}
// ─── API-Implementierung ─────────────────────────────────────────────────────
const electronAPI = {
    /** true wenn in Electron */
    isElectron: true,
    /** Plattform */
    platform: process.platform,
    // ── App-Info ─────────────────────────────────────────────────────────────────
    getVersion: () => electron_1.ipcRenderer.invoke("app:get-version"),
    getPlatform: () => electron_1.ipcRenderer.invoke("app:get-platform"),
    /** Gibt einen bekannten App-Pfad zurück: home, documents, downloads, music, desktop */
    getPath: (name) => electron_1.ipcRenderer.invoke("app:get-path", name),
    // ── Dateisystem ──────────────────────────────────────────────────────────────
    readFile: (filePath) => electron_1.ipcRenderer.invoke("fs:read-file", filePath),
    listDirectory: (dirPath) => electron_1.ipcRenderer.invoke("fs:list-directory", dirPath),
    writeFile: (filePath, data) => electron_1.ipcRenderer.invoke("fs:write-file", filePath, data),
    // ── Folder-Import ────────────────────────────────────────────────────────────
    /** Startet einen Folder-Import und gibt die importId zurück */
    importFolder: (folderPath) => electron_1.ipcRenderer.invoke("samples:import-folder", folderPath),
    /** Bricht einen laufenden Import ab */
    cancelImport: (importId) => electron_1.ipcRenderer.invoke("samples:cancel-import", importId),
    /** Startet einen ZIP-Import und gibt die importId zurück */
    importZip: (zipPath) => electron_1.ipcRenderer.invoke("samples:import-zip", zipPath),
    /** Räumt temporäre ZIP-Extraktions-Dateien auf */
    cleanupZip: (importId) => electron_1.ipcRenderer.invoke("samples:cleanup-zip", importId),
    // ── MIDI-Import ────────────────────────────────────────────────────────────
    /** Öffnet den nativen MIDI-Datei-Dialog und gibt den gewählten Pfad zurück */
    openMidiDialog: () => electron_1.ipcRenderer.invoke("midi:open-dialog"),
    /**
     * Liest eine MIDI-Datei und gibt die Bytes als Array zurück.
     * Verwendet Uint8Array-serialisierung (Array<number>), da ArrayBuffer nicht
     * direkt über den IPC-Kanal übertragen werden kann.
     */
    importMidiFile: (filePath) => electron_1.ipcRenderer.invoke("midi:import-file", filePath),
    // Import-Events
    onImportStarted: createEventListener("samples:import-started"),
    onImportProgress: createEventListener("samples:import-progress"),
    onImportComplete: createEventListener("samples:import-complete"),
    onImportCancelled: createEventListener("samples:import-cancelled"),
    onImportError: createEventListener("samples:import-error"),
    // ── Dialoge ──────────────────────────────────────────────────────────────────
    openFileDialog: (options) => electron_1.ipcRenderer.invoke("dialog:open-file", {
        title: options.title,
        filters: options.filters,
        properties: options.multiSelections
            ? ["openFile", "multiSelections"]
            : ["openFile"],
    }),
    saveFileDialog: (options) => electron_1.ipcRenderer.invoke("dialog:save-file", options),
    openFolderDialog: (options) => electron_1.ipcRenderer.invoke("dialog:open-file", {
        title: options?.title,
        properties: ["openDirectory"],
    }),
    showMessageDialog: (options) => electron_1.ipcRenderer.invoke("dialog:message", options),
    showConfirmDialog: (options) => electron_1.ipcRenderer.invoke("dialog:message", {
        type: "question",
        title: options.title,
        message: options.message,
        buttons: ["OK", "Abbrechen"],
        defaultId: 0,
    }),
    showErrorDialog: async (title, message) => {
        await electron_1.ipcRenderer.invoke("dialog:message", {
            type: "error",
            title,
            message,
            buttons: ["OK"],
            defaultId: 0,
        });
    },
    showInfoDialog: async (title, message) => {
        await electron_1.ipcRenderer.invoke("dialog:message", {
            type: "info",
            title,
            message,
            buttons: ["OK"],
            defaultId: 0,
        });
    },
    // ── Fenster-Steuerung ────────────────────────────────────────────────────────
    setFullscreen: (fullscreen) => electron_1.ipcRenderer.invoke("window:set-fullscreen", fullscreen),
    isFullscreen: () => electron_1.ipcRenderer.invoke("window:is-fullscreen"),
    minimizeWindow: () => electron_1.ipcRenderer.invoke("window:minimize"),
    maximizeWindow: () => electron_1.ipcRenderer.invoke("window:maximize"),
    setWindowTitle: (title) => {
        document.title = title;
    },
    // Fullscreen-Change-Event
    onFullscreenChanged: createEventListener("window:fullscreen-changed"),
    // ── Benachrichtigungen ───────────────────────────────────────────────────────
    showNotification: (title, body) => electron_1.ipcRenderer.invoke("notification:show", title, body),
    openExternal: async (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
        return { success: true };
    },
    showItemInFolder: (_filePath) => { },
    fileExists: async (_filePath) => ({ exists: false }),
    getFileStats: async (_filePath) => ({ success: false }),
    importSamples: async (_filePaths) => ({ success: false, importedCount: 0, errors: [] }),
    // ── Menü-Events (Main → Renderer) ────────────────────────────────────────────
    onMenuNewProject: createVoidListener("menu:new-project"),
    onMenuOpenProject: createEventListener("menu:open-project"),
    onMenuSaveProject: createVoidListener("menu:save-project"),
    onMenuSaveProjectAs: createEventListener("menu:save-project-as"),
    onMenuExportProject: createVoidListener("menu:export-project"),
    onMenuImportProject: createVoidListener("menu:import-project"),
    onMenuUndo: createVoidListener("menu:undo"),
    onMenuRedo: createVoidListener("menu:redo"),
    onMenuOpenSampleBrowser: createVoidListener("menu:open-sample-browser"),
    onMenuImportSamples: createEventListener("menu:import-samples"),
    onMenuImportSampleFolder: createEventListener("menu:import-sample-folder"),
    onMenuImportMidi: createEventListener("menu:import-midi"),
    onMenuTransportToggle: createVoidListener("menu:transport-toggle"),
    onMenuTransportRecord: createVoidListener("menu:transport-record"),
    onMenuRecord: createVoidListener("menu:record"),
    onMenuToggleFullscreen: createVoidListener("menu:toggle-fullscreen"),
    onMenuBounce: createVoidListener("menu:bounce"),
    onMenuOpenSampleLibrary: createVoidListener("menu:open-sample-library"),
    // ── Keyboard-Shortcuts (globale Media-Keys) ──────────────────────────────────
    onShortcutTransportToggle: createVoidListener("shortcut:transport-toggle"),
    onShortcutTransportStop: createVoidListener("shortcut:transport-stop"),
    onShortcutPlayStop: createVoidListener("shortcut:play-stop"),
    onShortcutUndo: createVoidListener("shortcut:undo"),
    onShortcutRedo: createVoidListener("shortcut:redo"),
    onShortcutSave: createVoidListener("shortcut:save"),
    // ── Auto-Updater ──────────────────────────────────────────────────────────
    checkForUpdates: () => {
        electron_1.ipcRenderer.send("updater:check");
    },
    onUpdaterChecking: createVoidListener("updater:checking"),
    onUpdaterUpdateAvailable: createEventListener("updater:update-available"),
    onUpdaterUpToDate: createVoidListener("updater:up-to-date"),
    onUpdaterDownloadProgress: createEventListener("updater:download-progress"),
    onUpdaterUpdateDownloaded: createEventListener("updater:update-downloaded"),
    onUpdaterError: createEventListener("updater:error"),
    // ── App-Store ─────────────────────────────────────────────────────────────
    /** Einen Store-Wert lesen */
    storeGet: (key) => electron_1.ipcRenderer.invoke("store:get", key),
    /** Einen Store-Wert setzen */
    storeSet: (key, value) => electron_1.ipcRenderer.invoke("store:set", key, value),
    /** Zuletzt geöffnete Projekte abrufen */
    storeGetRecent: () => electron_1.ipcRenderer.invoke("store:get-recent"),
    /** Projekt zu zuletzt geöffneten hinzufügen */
    storeAddRecent: (filePath) => electron_1.ipcRenderer.invoke("store:add-recent", filePath),
    /** Projekt aus zuletzt geöffneten entfernen */
    storeRemoveRecent: (filePath) => electron_1.ipcRenderer.invoke("store:remove-recent", filePath),
    /** Alle zuletzt geöffneten Projekte löschen */
    storeClearRecent: () => electron_1.ipcRenderer.invoke("store:clear-recent"),
    /** Listener für Änderungen an zuletzt geöffneten Projekten */
    onRecentProjectsChanged: createEventListener("store:recent-changed"),
    // ── Waveform-Preview ──────────────────────────────────────────────────────
    /** Waveform-Peaks für eine lokale Audio-Datei abrufen */
    analyzeWaveform: (filePath, numPeaks) => electron_1.ipcRenderer.invoke("waveform:get-peaks", filePath, numPeaks ?? 200),
    /** Audio-Datei-Metadaten abrufen */
    getAudioMetadata: (filePath) => electron_1.ipcRenderer.invoke("waveform:get-metadata", filePath),
    // ── Drag & Drop ──────────────────────────────────────────────────────────
    /** Gedropte Dateipfade verarbeiten und kategorisieren */
    processDragDropFiles: (filePaths) => electron_1.ipcRenderer.invoke("dragdrop:process-files", filePaths),
    onDragDropOpenProject: createEventListener("dragdrop:open-project"),
    onDragDropLoadSample: createEventListener("dragdrop:load-sample"),
    onDragDropBulkImport: createEventListener("dragdrop:bulk-import"),
    // ── Multi-Window ──────────────────────────────────────────────────────────
    /** Neues Fenster öffnen (optional mit Projekt-Pfad) */
    openNewWindow: (projectPath) => electron_1.ipcRenderer.invoke("window:new", projectPath),
    /** Alle offenen Fenster auflisten */
    listWindows: () => electron_1.ipcRenderer.invoke("window:list"),
    /** Fenster fokussieren */
    focusWindow: (windowId) => electron_1.ipcRenderer.invoke("window:focus", windowId),
    /** Fenster-Zustand aktualisieren (Titel, isDirty, canUndo, canRedo) */
    updateWindowState: (updates) => electron_1.ipcRenderer.invoke("window:update-state", updates),
    /** Fenster schließen (auch wenn ungespeicherte Änderungen) */
    forceCloseWindow: () => electron_1.ipcRenderer.invoke("window:force-close"),
    /** Zuletzt geöffnete Projekte aus dem Fenster-Manager abrufen */
    getRecentProjectsFromWindows: () => electron_1.ipcRenderer.invoke("window:get-recent-projects"),
    onWindowConfirmClose: createVoidListener("window:confirm-close"),
    // ── Export ──────────────────────────────────────────────────────────────
    /** WAV-Export: PCM-Daten als WAV-Datei speichern */
    exportWav: (options) => electron_1.ipcRenderer.invoke("export:wav", options),
    /** MIDI-Export: Pattern als MIDI-Datei speichern */
    exportMidi: (options) => electron_1.ipcRenderer.invoke("export:midi", options),
    /** Projekt-Export: JSON-Daten als .synth-Datei speichern */
    exportProject: (options) => electron_1.ipcRenderer.invoke("export:project", options),
    /** Stereo WAV-Export: Separate L/R-Kanäle als Stereo-WAV-Datei speichern */
    exportWavStereo: (options) => electron_1.ipcRenderer.invoke("export:wav-stereo", options),
    /** Projekt-Import: .synth/.json-Datei lesen */
    importProject: (filePath) => electron_1.ipcRenderer.invoke("export:import-project", filePath),
    /** Bundle-Export: WAV-Stems + MIDI + Metadaten als ZIP */
    exportBundle: (options) => electron_1.ipcRenderer.invoke("export:bundle", options),
    // ── Kollaborations-Session ────────────────────────────────────────────────────
    /** Startet den lokalen Kollaborations-WebSocket-Server. */
    startCollabServer: () => electron_1.ipcRenderer.invoke("collab:start"),
    /** Stoppt den Kollaborations-Server. */
    stopCollabServer: () => electron_1.ipcRenderer.invoke("collab:stop"),
    /** Gibt lokale IP-Adresse und Server-Port zurück. */
    getCollabAddress: () => electron_1.ipcRenderer.invoke("collab:get-address"),
    /** Startet UDP-Broadcast damit andere die Session finden. */
    startCollabAnnounce: (roomCode) => electron_1.ipcRenderer.invoke("collab:announce-start", roomCode),
    /** Stoppt den UDP-Broadcast. */
    stopCollabAnnounce: () => electron_1.ipcRenderer.invoke("collab:announce-stop"),
    /** Startet den UDP-Listener für entdeckte Sessions. */
    startCollabDiscovery: () => electron_1.ipcRenderer.invoke("collab:discovery-start"),
    /** Stoppt den UDP-Listener. */
    stopCollabDiscovery: () => electron_1.ipcRenderer.invoke("collab:discovery-stop"),
    /** Gibt alle aktuell sichtbaren Sessions im Netzwerk zurück. */
    getDiscoveredSessions: () => electron_1.ipcRenderer.invoke("collab:get-discovered"),
};
electron_1.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
