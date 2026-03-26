"use strict";
/**
 * Synthstudio – useElectron React-Hook (v2)
 *
 * Erkennt automatisch ob die App in Electron oder im Browser läuft.
 * Im Browser werden sinnvolle Fallbacks bereitgestellt (z.B. File API).
 *
 * VERWENDUNG:
 * ```tsx
 * import { useElectron } from "../../electron/useElectron";
 *
 * function MyComponent() {
 *   const electron = useElectron();
 *
 *   if (electron.isElectron) {
 *     // Electron-Features: native Dialoge, Dateisystem, etc.
 *   } else {
 *     // Browser-Fallback: File API, Web File System Access API, etc.
 *   }
 * }
 * ```
 *
 * WICHTIG: Dieser Hook ändert NICHTS an der bestehenden Web-App.
 * Er ist ein optionaler Erweiterungspunkt für Electron-Features.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.useElectron = useElectron;
exports.useElectronEvent = useElectronEvent;
exports.useElectronImport = useElectronImport;
const react_1 = require("react");
const noopCleanup = () => { };
const noopVoidListener = () => noopCleanup;
const noopDataListener = () => () => noopCleanup;
// ─── Browser-Fallbacks ────────────────────────────────────────────────────────
const browserAPI = {
    isElectron: false,
    platform: "web",
    getVersion: async () => "web",
    getPlatform: async () => "web",
    getPath: async (_name) => null,
    readFile: async (_filePath) => ({
        success: false,
        error: "Nicht in Electron – nutze File API",
    }),
    listDirectory: async (_dirPath) => ({
        success: false,
        error: "Nicht in Electron – nutze File System Access API",
    }),
    writeFile: async (_filePath, _data) => ({
        success: false,
        error: "Nicht in Electron – nutze File System Access API",
    }),
    importFolder: async (_folderPath) => ({ importId: "" }),
    cancelImport: async (_importId) => ({ success: false, error: "Nicht in Electron" }),
    importZip: async (_zipPath) => ({ importId: "" }),
    cleanupZip: async (_importId) => ({ success: false }),
    onImportStarted: noopDataListener(),
    onImportProgress: noopDataListener(),
    onImportComplete: noopDataListener(),
    onImportCancelled: noopDataListener(),
    onImportError: noopDataListener(),
    openFileDialog: async (_options) => ({ canceled: true, filePaths: [] }),
    saveFileDialog: async (_options) => ({ canceled: true }),
    showMessageDialog: async (_options) => ({ response: 0 }),
    setFullscreen: async (_fullscreen) => ({ success: false }),
    isFullscreen: async () => ({ isFullscreen: false }),
    minimizeWindow: () => { },
    maximizeWindow: () => { },
    forceCloseWindow: () => { },
    setWindowTitle: (_title) => { },
    onFullscreenChanged: noopDataListener(),
    showNotification: (_title, _body) => { },
    showConfirmDialog: async (_options) => ({ response: 0 }),
    showErrorDialog: async (_title, _message) => { },
    showInfoDialog: async (_title, _message) => { },
    openFolderDialog: async (_options) => ({ canceled: true, filePaths: [] }),
    openExternal: async (_url) => ({ success: false }),
    showItemInFolder: (_filePath) => { },
    fileExists: async (_filePath) => ({ exists: false }),
    getFileStats: async (_filePath) => ({ success: false }),
    importSamples: async (_filePaths) => ({ success: false, importedCount: 0, errors: [] }),
    analyzeWaveform: async (_filePath, _numPeaks) => ({ success: false }),
    exportWav: async (_options) => ({ success: false, canceled: false }),
    exportWavStereo: async (_options) => ({ success: false, canceled: false }),
    exportMidi: async (_options) => ({ success: false, canceled: false }),
    exportProject: async (_data) => ({ success: false, canceled: false }),
    importProject: async () => ({ success: false, canceled: true }),
    onDragDropBulkImport: noopDataListener(),
    onDragDropLoadSample: noopDataListener(),
    onDragDropOpenProject: noopDataListener(),
    onMenuNewProject: noopVoidListener,
    onMenuOpenProject: noopDataListener(),
    onMenuSaveProject: noopVoidListener,
    onMenuSaveProjectAs: noopDataListener(),
    onMenuExportProject: noopVoidListener,
    onMenuImportProject: noopVoidListener,
    onMenuUndo: noopVoidListener,
    onMenuRedo: noopVoidListener,
    onMenuOpenSampleBrowser: noopVoidListener,
    onMenuImportSamples: noopDataListener(),
    onMenuImportSampleFolder: noopDataListener(),
    onMenuTransportToggle: noopVoidListener,
    onMenuTransportRecord: noopVoidListener,
    onShortcutTransportToggle: noopVoidListener,
    onShortcutTransportStop: noopVoidListener,
    checkForUpdates: () => { },
    onUpdaterChecking: noopVoidListener,
    onUpdaterUpdateAvailable: noopDataListener(),
    onUpdaterUpToDate: noopVoidListener,
    onUpdaterDownloadProgress: noopDataListener(),
    onUpdaterUpdateDownloaded: noopDataListener(),
    onUpdaterError: noopDataListener(),
    // Store
    storeGet: async (_key) => ({ success: false, error: "Nicht in Electron" }),
    storeSet: async (_key, _value) => ({ success: false, error: "Nicht in Electron" }),
    storeGetRecent: async () => ({ success: false, error: "Nicht in Electron" }),
    storeAddRecent: async (_filePath) => ({ success: false, error: "Nicht in Electron" }),
    storeRemoveRecent: async (_filePath) => ({ success: false, error: "Nicht in Electron" }),
    storeClearRecent: async () => ({ success: false, error: "Nicht in Electron" }),
    onRecentProjectsChanged: noopDataListener(),
};
// ─── Haupt-Hook ───────────────────────────────────────────────────────────────
function useElectron() {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api?.isElectron) {
        return browserAPI;
    }
    return {
        isElectron: true,
        platform: api.platform,
        getVersion: api.getVersion,
        getPlatform: api.getPlatform,
        getPath: api.getPath,
        readFile: api.readFile,
        listDirectory: api.listDirectory,
        writeFile: api.writeFile,
        importFolder: api.importFolder,
        cancelImport: api.cancelImport,
        importZip: api.importZip,
        cleanupZip: api.cleanupZip,
        onImportStarted: api.onImportStarted,
        onImportProgress: api.onImportProgress,
        onImportComplete: api.onImportComplete,
        onImportCancelled: api.onImportCancelled,
        onImportError: api.onImportError,
        openFileDialog: api.openFileDialog,
        saveFileDialog: api.saveFileDialog,
        showMessageDialog: api.showMessageDialog,
        setFullscreen: api.setFullscreen,
        isFullscreen: api.isFullscreen,
        minimizeWindow: api.minimizeWindow,
        maximizeWindow: api.maximizeWindow,
        forceCloseWindow: api.forceCloseWindow,
        setWindowTitle: api.setWindowTitle,
        onFullscreenChanged: api.onFullscreenChanged,
        showNotification: api.showNotification,
        showConfirmDialog: api.showConfirmDialog,
        showErrorDialog: api.showErrorDialog,
        showInfoDialog: api.showInfoDialog,
        openFolderDialog: api.openFolderDialog,
        openExternal: api.openExternal,
        showItemInFolder: api.showItemInFolder,
        fileExists: api.fileExists,
        getFileStats: api.getFileStats,
        importSamples: api.importSamples,
        analyzeWaveform: api.analyzeWaveform,
        exportWav: api.exportWav,
        exportWavStereo: api.exportWavStereo,
        exportMidi: api.exportMidi,
        exportProject: api.exportProject,
        importProject: api.importProject,
        onDragDropBulkImport: api.onDragDropBulkImport,
        onDragDropLoadSample: api.onDragDropLoadSample,
        onDragDropOpenProject: api.onDragDropOpenProject,
        onMenuNewProject: api.onMenuNewProject,
        onMenuOpenProject: api.onMenuOpenProject,
        onMenuSaveProject: api.onMenuSaveProject,
        onMenuSaveProjectAs: api.onMenuSaveProjectAs,
        onMenuExportProject: api.onMenuExportProject,
        onMenuImportProject: api.onMenuImportProject,
        onMenuUndo: api.onMenuUndo,
        onMenuRedo: api.onMenuRedo,
        onMenuOpenSampleBrowser: api.onMenuOpenSampleBrowser,
        onMenuImportSamples: api.onMenuImportSamples,
        onMenuImportSampleFolder: api.onMenuImportSampleFolder,
        onMenuTransportToggle: api.onMenuTransportToggle,
        onMenuTransportRecord: api.onMenuTransportRecord,
        onShortcutTransportToggle: api.onShortcutTransportToggle,
        onShortcutTransportStop: api.onShortcutTransportStop,
        checkForUpdates: api.checkForUpdates,
        onUpdaterChecking: api.onUpdaterChecking,
        onUpdaterUpdateAvailable: api.onUpdaterUpdateAvailable,
        onUpdaterUpToDate: api.onUpdaterUpToDate,
        onUpdaterDownloadProgress: api.onUpdaterDownloadProgress,
        onUpdaterUpdateDownloaded: api.onUpdaterUpdateDownloaded,
        onUpdaterError: api.onUpdaterError,
        storeGet: api.storeGet,
        storeSet: api.storeSet,
        storeGetRecent: api.storeGetRecent,
        storeAddRecent: api.storeAddRecent,
        storeRemoveRecent: api.storeRemoveRecent,
        storeClearRecent: api.storeClearRecent,
        onRecentProjectsChanged: api.onRecentProjectsChanged,
    };
}
// ─── Spezialisierte Hooks ─────────────────────────────────────────────────────
/**
 * useElectronEvent – Hook für einen einzelnen Electron-Event-Listener
 * mit automatischem Cleanup beim Unmount.
 *
 * ```tsx
 * useElectronEvent("onMenuSaveProject", () => {
 *   saveProject();
 * });
 * ```
 */
function useElectronEvent(eventName, callback) {
    const electron = useElectron();
    const callbackRef = (0, react_1.useRef)(callback);
    callbackRef.current = callback;
    (0, react_1.useEffect)(() => {
        const stableCallback = () => callbackRef.current();
        const listener = electron[eventName];
        const cleanup = listener(stableCallback);
        return cleanup;
    }, [electron, eventName]);
}
/**
 * useElectronImport – Hook für den kompletten Import-Workflow
 *
 * ```tsx
 * const { startImport, cancelImport, progress, isImporting } = useElectronImport({
 *   onComplete: (samples) => addSamplesToLibrary(samples),
 * });
 * ```
 */
function useElectronImport(options) {
    const electron = useElectron();
    const currentImportId = (0, react_1.useRef)(null);
    const startImport = (0, react_1.useCallback)(async (folderPath) => {
        if (!electron.isElectron)
            return;
        const { importId } = await electron.importFolder(folderPath);
        currentImportId.current = importId;
        return importId;
    }, [electron]);
    const cancelImport = (0, react_1.useCallback)(async () => {
        if (!electron.isElectron || !currentImportId.current)
            return;
        await electron.cancelImport(currentImportId.current);
    }, [electron]);
    (0, react_1.useEffect)(() => {
        if (!electron.isElectron)
            return;
        const cleanupComplete = electron.onImportComplete((data) => {
            if (data.importId === currentImportId.current) {
                currentImportId.current = null;
                options.onComplete?.(data);
            }
        });
        const cleanupError = electron.onImportError((data) => {
            if (data.importId === currentImportId.current) {
                options.onError?.(data);
            }
        });
        return () => {
            cleanupComplete();
            cleanupError();
        };
    }, [electron, options.onComplete, options.onError]);
    return { startImport, cancelImport };
}
exports.default = useElectron;
