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
    showMessageDialog: (options) => electron_1.ipcRenderer.invoke("dialog:message", options),
    // ── Fenster-Steuerung ────────────────────────────────────────────────────────
    setFullscreen: (fullscreen) => electron_1.ipcRenderer.invoke("window:set-fullscreen", fullscreen),
    isFullscreen: () => electron_1.ipcRenderer.invoke("window:is-fullscreen"),
    minimizeWindow: () => electron_1.ipcRenderer.invoke("window:minimize"),
    maximizeWindow: () => electron_1.ipcRenderer.invoke("window:maximize"),
    // Fullscreen-Change-Event
    onFullscreenChanged: createEventListener("window:fullscreen-changed"),
    // ── Benachrichtigungen ───────────────────────────────────────────────────────
    showNotification: (title, body) => electron_1.ipcRenderer.invoke("notification:show", title, body),
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
    onMenuTransportToggle: createVoidListener("menu:transport-toggle"),
    onMenuTransportRecord: createVoidListener("menu:transport-record"),
    // ── Keyboard-Shortcuts (globale Media-Keys) ──────────────────────────────────
    onShortcutTransportToggle: createVoidListener("shortcut:transport-toggle"),
    onShortcutTransportStop: createVoidListener("shortcut:transport-stop"),
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
    getWaveformPeaks: (filePath, numPeaks) => electron_1.ipcRenderer.invoke("waveform:get-peaks", filePath, numPeaks ?? 200),
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
    /** Projekt-Export: JSON-Daten als .esx1-Datei speichern */
    exportProject: (options) => electron_1.ipcRenderer.invoke("export:project", options),
    /** Stereo WAV-Export: Separate L/R-Kanäle als Stereo-WAV-Datei speichern */
    exportWavStereo: (options) => electron_1.ipcRenderer.invoke("export:wav-stereo", options),
    /** Projekt-Import: .esx1/.json-Datei lesen */
    importProjectFile: (filePath) => electron_1.ipcRenderer.invoke("export:import-project", filePath),
};
electron_1.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
