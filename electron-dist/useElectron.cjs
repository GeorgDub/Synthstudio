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
    // Crash-Log Bridge: no-op im Web-Fallback (Renderer-Errors gehen nur in die Konsole).
    logRendererCrash: (_source, _message, _stack) => { },
    logRendererEvent: (_label, _payload) => { },
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
    isFullscreen: async () => false,
    minimizeWindow: async () => { },
    maximizeWindow: async () => { },
    forceCloseWindow: async () => { },
    setWindowTitle: (_title) => { },
    onFullscreenChanged: noopDataListener(),
    // Performance-Mode Popup-Window (Web-Fallback: no-op stubs).
    // Phase 2 könnte hier window.open() + BroadcastChannel implementieren —
    // aktuell ist das Feature Electron-only.
    openPerformanceWindow: async () => ({ success: false }),
    closePerformanceWindow: async () => ({ success: false }),
    isPerformanceWindowOpen: async () => false,
    sendPerfPopupState: (_state) => { },
    sendPerfPopupAction: (_action) => { },
    onPerfPopupState: noopDataListener(),
    onPerfPopupAction: noopDataListener(),
    onPerfPopupClosed: noopVoidListener,
    setPerfPopupAlwaysOnTop: async (_alwaysOnTop) => ({ success: false, alwaysOnTop: false }),
    isPerfPopupAlwaysOnTop: async () => false,
    // FX-Window Popups (Web-Fallback: no-op stubs).
    openFxWindow: async (_channelId) => ({ success: false }),
    closeFxWindow: async (_channelId) => ({ success: false }),
    isFxWindowOpen: async (_channelId) => false,
    setFxWindowAlwaysOnTop: async (_channelId, _alwaysOnTop) => ({
        success: false,
        alwaysOnTop: false,
    }),
    isFxWindowAlwaysOnTop: async (_channelId) => false,
    sendFxPopupState: (_channelId, _state) => { },
    sendFxPopupAction: (_channelId, _action) => { },
    onFxPopupState: noopDataListener(),
    onFxPopupAction: noopDataListener(),
    onFxPopupClosed: noopDataListener(),
    // Mixer-Window Popup (Web-Fallback: no-op stubs).
    openMixerWindow: async () => ({ success: false }),
    closeMixerWindow: async () => ({ success: false }),
    isMixerWindowOpen: async () => false,
    setMixerWindowAlwaysOnTop: async (_alwaysOnTop) => ({ success: false, alwaysOnTop: false }),
    isMixerWindowAlwaysOnTop: async () => false,
    sendMixerPopupState: (_state) => { },
    sendMixerPopupAction: (_action) => { },
    onMixerPopupState: noopDataListener(),
    onMixerPopupAction: noopDataListener(),
    onMixerPopupClosed: noopVoidListener,
    // Sample-Browser-Window Popup (Web-Fallback: no-op stubs).
    openSampleBrowserWindow: async () => ({ success: false }),
    closeSampleBrowserWindow: async () => ({ success: false }),
    isSampleBrowserWindowOpen: async () => false,
    setSampleBrowserWindowAlwaysOnTop: async (_alwaysOnTop) => ({ success: false, alwaysOnTop: false }),
    isSampleBrowserWindowAlwaysOnTop: async () => false,
    sendSampleBrowserPopupState: (_state) => { },
    sendSampleBrowserPopupAction: (_action) => { },
    onSampleBrowserPopupState: noopDataListener(),
    onSampleBrowserPopupAction: noopDataListener(),
    onSampleBrowserPopupClosed: noopVoidListener,
    // Pattern-Generator-Window Popup (Web-Fallback: no-op stubs).
    openPatternGenWindow: async () => ({ success: false }),
    closePatternGenWindow: async () => ({ success: false }),
    isPatternGenWindowOpen: async () => false,
    setPatternGenWindowAlwaysOnTop: async (_alwaysOnTop) => ({ success: false, alwaysOnTop: false }),
    isPatternGenWindowAlwaysOnTop: async () => false,
    sendPatternGenPopupAction: (_action) => { },
    onPatternGenPopupAction: noopDataListener(),
    onPatternGenPopupClosed: noopVoidListener,
    // Tools-Popup-Windows (post-v1.28.0).
    openKeyboardSamplerWindow: async () => ({ success: false }),
    closeKeyboardSamplerWindow: async () => ({ success: false }),
    isKeyboardSamplerWindowOpen: async () => false,
    setKeyboardSamplerWindowAlwaysOnTop: async (_aot) => ({ success: false, alwaysOnTop: false }),
    isKeyboardSamplerWindowAlwaysOnTop: async () => false,
    sendKeyboardSamplerPopupState: (_state) => { },
    sendKeyboardSamplerPopupAction: (_action) => { },
    onKeyboardSamplerPopupState: noopDataListener(),
    onKeyboardSamplerPopupAction: noopDataListener(),
    onKeyboardSamplerPopupClosed: noopVoidListener,
    openChordProgressionWindow: async () => ({ success: false }),
    closeChordProgressionWindow: async () => ({ success: false }),
    isChordProgressionWindowOpen: async () => false,
    setChordProgressionWindowAlwaysOnTop: async (_aot) => ({ success: false, alwaysOnTop: false }),
    isChordProgressionWindowAlwaysOnTop: async () => false,
    sendChordProgressionPopupState: (_state) => { },
    sendChordProgressionPopupAction: (_action) => { },
    onChordProgressionPopupState: noopDataListener(),
    onChordProgressionPopupAction: noopDataListener(),
    onChordProgressionPopupClosed: noopVoidListener,
    openPatternLibraryWindow: async () => ({ success: false }),
    closePatternLibraryWindow: async () => ({ success: false }),
    isPatternLibraryWindowOpen: async () => false,
    setPatternLibraryWindowAlwaysOnTop: async (_aot) => ({ success: false, alwaysOnTop: false }),
    isPatternLibraryWindowAlwaysOnTop: async () => false,
    sendPatternLibraryPopupState: (_state) => { },
    sendPatternLibraryPopupAction: (_action) => { },
    onPatternLibraryPopupState: noopDataListener(),
    onPatternLibraryPopupAction: noopDataListener(),
    onPatternLibraryPopupClosed: noopVoidListener,
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
    getAudioMetadata: async (_filePath) => ({ success: false }),
    processDragDropFiles: async (_filePaths) => ({
        audioFiles: [],
        folders: [],
        projectFiles: [],
    }),
    exportWav: async (_options) => ({ success: false, canceled: false }),
    exportWavStereo: async (_options) => ({ success: false, canceled: false }),
    exportMidi: async (_options) => ({ success: false, canceled: false }),
    exportProject: async (_options) => ({ success: false, canceled: false }),
    importProject: async (_filePath) => ({ success: false, canceled: true }),
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
    onMenuOpenSampleLibrary: noopVoidListener,
    onMenuImportSamples: noopDataListener(),
    onMenuImportSampleFolder: noopDataListener(),
    onMenuTransportToggle: noopVoidListener,
    onMenuTransportRecord: noopVoidListener,
    onMenuRecord: noopVoidListener,
    onMenuToggleFullscreen: noopVoidListener,
    onMenuBounce: noopVoidListener,
    // post-v1.25.0 — Music-Production-fokussierte Menü-Items (Browser-Stubs)
    onMenuPatternClear: noopVoidListener,
    onMenuPatternRandomize: noopVoidListener,
    onMenuPatternFill: noopVoidListener,
    onMenuPatternDuplicate: noopVoidListener,
    onMenuPatternNext: noopVoidListener,
    onMenuPatternPrev: noopVoidListener,
    onMenuBpmUp: noopVoidListener,
    onMenuBpmDown: noopVoidListener,
    onMenuTapTempo: noopVoidListener,
    onMenuOpenPerformance: noopVoidListener,
    onMenuOpenAudioWorkbench: noopVoidListener,
    onMenuTab: noopDataListener(),
    onShortcutTransportToggle: noopVoidListener,
    onShortcutTransportStop: noopVoidListener,
    onShortcutPlayStop: noopVoidListener,
    onShortcutUndo: noopVoidListener,
    onShortcutRedo: noopVoidListener,
    onShortcutSave: noopVoidListener,
    // Multi-Window
    openNewWindow: async (_projectPath) => ({ windowId: -1 }),
    listWindows: async () => [],
    focusWindow: async (_windowId) => ({ success: false }),
    updateWindowState: async (_updates) => ({ success: false }),
    getRecentProjectsFromWindows: async () => [],
    onWindowConfirmClose: noopVoidListener,
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
        logRendererCrash: api.logRendererCrash,
        logRendererEvent: api.logRendererEvent,
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
        onMenuRecord: api.onMenuRecord,
        onMenuToggleFullscreen: api.onMenuToggleFullscreen,
        onMenuBounce: api.onMenuBounce,
        onMenuOpenSampleLibrary: api.onMenuOpenSampleLibrary,
        // post-v1.25.0 — Music-Production-fokussierte Menü-Items
        onMenuPatternClear: api.onMenuPatternClear,
        onMenuPatternRandomize: api.onMenuPatternRandomize,
        onMenuPatternFill: api.onMenuPatternFill,
        onMenuPatternDuplicate: api.onMenuPatternDuplicate,
        onMenuPatternNext: api.onMenuPatternNext,
        onMenuPatternPrev: api.onMenuPatternPrev,
        onMenuBpmUp: api.onMenuBpmUp,
        onMenuBpmDown: api.onMenuBpmDown,
        onMenuTapTempo: api.onMenuTapTempo,
        onMenuOpenPerformance: api.onMenuOpenPerformance,
        onMenuOpenAudioWorkbench: api.onMenuOpenAudioWorkbench,
        onMenuTab: api.onMenuTab,
        onShortcutTransportToggle: api.onShortcutTransportToggle,
        onShortcutTransportStop: api.onShortcutTransportStop,
        onShortcutPlayStop: api.onShortcutPlayStop,
        onShortcutUndo: api.onShortcutUndo,
        onShortcutRedo: api.onShortcutRedo,
        onShortcutSave: api.onShortcutSave,
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
        getAudioMetadata: api.getAudioMetadata,
        processDragDropFiles: api.processDragDropFiles,
        openNewWindow: api.openNewWindow,
        listWindows: api.listWindows,
        focusWindow: api.focusWindow,
        updateWindowState: api.updateWindowState,
        getRecentProjectsFromWindows: api.getRecentProjectsFromWindows,
        onWindowConfirmClose: api.onWindowConfirmClose,
        // Performance-Mode Popup-Window
        openPerformanceWindow: api.openPerformanceWindow,
        closePerformanceWindow: api.closePerformanceWindow,
        isPerformanceWindowOpen: api.isPerformanceWindowOpen,
        sendPerfPopupState: api.sendPerfPopupState,
        sendPerfPopupAction: api.sendPerfPopupAction,
        onPerfPopupState: api.onPerfPopupState,
        onPerfPopupAction: api.onPerfPopupAction,
        onPerfPopupClosed: api.onPerfPopupClosed,
        setPerfPopupAlwaysOnTop: api.setPerfPopupAlwaysOnTop,
        isPerfPopupAlwaysOnTop: api.isPerfPopupAlwaysOnTop,
        // FX-Window Popups (Multi-Window-Workspace Phase 1)
        openFxWindow: api.openFxWindow,
        closeFxWindow: api.closeFxWindow,
        isFxWindowOpen: api.isFxWindowOpen,
        setFxWindowAlwaysOnTop: api.setFxWindowAlwaysOnTop,
        isFxWindowAlwaysOnTop: api.isFxWindowAlwaysOnTop,
        sendFxPopupState: api.sendFxPopupState,
        sendFxPopupAction: api.sendFxPopupAction,
        onFxPopupState: api.onFxPopupState,
        onFxPopupAction: api.onFxPopupAction,
        onFxPopupClosed: api.onFxPopupClosed,
        // Mixer-Window Popup
        openMixerWindow: api.openMixerWindow,
        closeMixerWindow: api.closeMixerWindow,
        isMixerWindowOpen: api.isMixerWindowOpen,
        setMixerWindowAlwaysOnTop: api.setMixerWindowAlwaysOnTop,
        isMixerWindowAlwaysOnTop: api.isMixerWindowAlwaysOnTop,
        sendMixerPopupState: api.sendMixerPopupState,
        sendMixerPopupAction: api.sendMixerPopupAction,
        onMixerPopupState: api.onMixerPopupState,
        onMixerPopupAction: api.onMixerPopupAction,
        onMixerPopupClosed: api.onMixerPopupClosed,
        // Sample-Browser-Window Popup
        openSampleBrowserWindow: api.openSampleBrowserWindow,
        closeSampleBrowserWindow: api.closeSampleBrowserWindow,
        isSampleBrowserWindowOpen: api.isSampleBrowserWindowOpen,
        setSampleBrowserWindowAlwaysOnTop: api.setSampleBrowserWindowAlwaysOnTop,
        isSampleBrowserWindowAlwaysOnTop: api.isSampleBrowserWindowAlwaysOnTop,
        sendSampleBrowserPopupState: api.sendSampleBrowserPopupState,
        sendSampleBrowserPopupAction: api.sendSampleBrowserPopupAction,
        onSampleBrowserPopupState: api.onSampleBrowserPopupState,
        onSampleBrowserPopupAction: api.onSampleBrowserPopupAction,
        onSampleBrowserPopupClosed: api.onSampleBrowserPopupClosed,
        // Pattern-Generator-Window Popup
        openPatternGenWindow: api.openPatternGenWindow,
        closePatternGenWindow: api.closePatternGenWindow,
        isPatternGenWindowOpen: api.isPatternGenWindowOpen,
        setPatternGenWindowAlwaysOnTop: api.setPatternGenWindowAlwaysOnTop,
        isPatternGenWindowAlwaysOnTop: api.isPatternGenWindowAlwaysOnTop,
        sendPatternGenPopupAction: api.sendPatternGenPopupAction,
        onPatternGenPopupAction: api.onPatternGenPopupAction,
        onPatternGenPopupClosed: api.onPatternGenPopupClosed,
        // Tools-Popup-Windows (post-v1.28.0)
        openKeyboardSamplerWindow: api.openKeyboardSamplerWindow,
        closeKeyboardSamplerWindow: api.closeKeyboardSamplerWindow,
        isKeyboardSamplerWindowOpen: api.isKeyboardSamplerWindowOpen,
        setKeyboardSamplerWindowAlwaysOnTop: api.setKeyboardSamplerWindowAlwaysOnTop,
        isKeyboardSamplerWindowAlwaysOnTop: api.isKeyboardSamplerWindowAlwaysOnTop,
        sendKeyboardSamplerPopupState: api.sendKeyboardSamplerPopupState,
        sendKeyboardSamplerPopupAction: api.sendKeyboardSamplerPopupAction,
        onKeyboardSamplerPopupState: api.onKeyboardSamplerPopupState,
        onKeyboardSamplerPopupAction: api.onKeyboardSamplerPopupAction,
        onKeyboardSamplerPopupClosed: api.onKeyboardSamplerPopupClosed,
        openChordProgressionWindow: api.openChordProgressionWindow,
        closeChordProgressionWindow: api.closeChordProgressionWindow,
        isChordProgressionWindowOpen: api.isChordProgressionWindowOpen,
        setChordProgressionWindowAlwaysOnTop: api.setChordProgressionWindowAlwaysOnTop,
        isChordProgressionWindowAlwaysOnTop: api.isChordProgressionWindowAlwaysOnTop,
        sendChordProgressionPopupState: api.sendChordProgressionPopupState,
        sendChordProgressionPopupAction: api.sendChordProgressionPopupAction,
        onChordProgressionPopupState: api.onChordProgressionPopupState,
        onChordProgressionPopupAction: api.onChordProgressionPopupAction,
        onChordProgressionPopupClosed: api.onChordProgressionPopupClosed,
        openPatternLibraryWindow: api.openPatternLibraryWindow,
        closePatternLibraryWindow: api.closePatternLibraryWindow,
        isPatternLibraryWindowOpen: api.isPatternLibraryWindowOpen,
        setPatternLibraryWindowAlwaysOnTop: api.setPatternLibraryWindowAlwaysOnTop,
        isPatternLibraryWindowAlwaysOnTop: api.isPatternLibraryWindowAlwaysOnTop,
        sendPatternLibraryPopupState: api.sendPatternLibraryPopupState,
        sendPatternLibraryPopupAction: api.sendPatternLibraryPopupAction,
        onPatternLibraryPopupState: api.onPatternLibraryPopupState,
        onPatternLibraryPopupAction: api.onPatternLibraryPopupAction,
        onPatternLibraryPopupClosed: api.onPatternLibraryPopupClosed,
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
