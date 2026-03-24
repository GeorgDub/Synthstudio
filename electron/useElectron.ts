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

import { useEffect, useCallback, useRef } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

type Cleanup = () => void;
type VoidListener = (callback: () => void) => Cleanup;
type DataListener<T> = (callback: (data: T) => void) => Cleanup;

const noopCleanup: Cleanup = () => {};
const noopVoidListener: VoidListener = () => noopCleanup;
const noopDataListener = <T>(): DataListener<T> =>
  () => noopCleanup;

// ─── Browser-Fallbacks ────────────────────────────────────────────────────────

const browserAPI = {
  isElectron: false as const,
  platform: "web" as const,

  getVersion: async () => "web",
  getPlatform: async () => "web",
  getPath: async (_name: string) => null,

  readFile: async (_filePath: string) => ({
    success: false,
    error: "Nicht in Electron – nutze File API",
  }),
  listDirectory: async (_dirPath: string) => ({
    success: false,
    error: "Nicht in Electron – nutze File System Access API",
  }),
  writeFile: async (_filePath: string, _data: string) => ({
    success: false,
    error: "Nicht in Electron – nutze File System Access API",
  }),

  importFolder: async (_folderPath: string) => ({ importId: "" }),
  cancelImport: async (_importId: string) => ({ success: false, error: "Nicht in Electron" }),
  importZip: async (_zipPath: string) => ({ importId: "" }),
  cleanupZip: async (_importId: string) => ({ success: false }),
  onImportStarted: noopDataListener<{ importId: string }>(),
  onImportProgress: noopDataListener<any>(),
  onImportComplete: noopDataListener<any>(),
  onImportCancelled: noopDataListener<any>(),
  onImportError: noopDataListener<any>(),

  openFileDialog: async (_options: any) => ({ canceled: true, filePaths: [] as string[] }),
  saveFileDialog: async (_options: any) => ({ canceled: true }),
  showMessageDialog: async (_options: any) => ({ response: 0 }),

  setFullscreen: async (_fullscreen: boolean) => ({ success: false }),
  isFullscreen: async () => ({ isFullscreen: false }),
  minimizeWindow: () => {},
  maximizeWindow: () => {},
  forceCloseWindow: () => {},
  setWindowTitle: (_title: string) => {},
  onFullscreenChanged: noopDataListener<boolean>(),

  showNotification: (_title: string, _body: string) => {},
  showConfirmDialog: async (_options: any) => ({ response: 0 }),
  showErrorDialog: async (_title: string, _message: string) => {},
  showInfoDialog: async (_title: string, _message: string) => {},
  openFolderDialog: async (_options?: any) => ({ canceled: true, filePaths: [] as string[] }),
  openExternal: async (_url: string) => ({ success: false }),
  showItemInFolder: (_filePath: string) => {},
  fileExists: async (_filePath: string) => ({ exists: false }),
  getFileStats: async (_filePath: string) => ({ success: false }),
  importSamples: async (_filePaths: string[]) => ({ success: false, importedCount: 0, errors: [] as string[] }),
  analyzeWaveform: async (_filePath: string, _numPeaks?: number) => ({ success: false }),
  exportWav: async (_options: any) => ({ success: false, canceled: false }),
  exportWavStereo: async (_options: any) => ({ success: false, canceled: false }),
  exportMidi: async (_options: any) => ({ success: false, canceled: false }),
  exportProject: async (_data: unknown) => ({ success: false, canceled: false }),
  importProject: async () => ({ success: false, canceled: true }),
  onDragDropBulkImport: noopDataListener<any>(),
  onDragDropLoadSample: noopDataListener<any>(),
  onDragDropOpenProject: noopDataListener<any>(),

  onMenuNewProject: noopVoidListener,
  onMenuOpenProject: noopDataListener<string>(),
  onMenuSaveProject: noopVoidListener,
  onMenuSaveProjectAs: noopDataListener<string>(),
  onMenuExportProject: noopVoidListener,
  onMenuImportProject: noopVoidListener,
  onMenuUndo: noopVoidListener,
  onMenuRedo: noopVoidListener,
  onMenuOpenSampleBrowser: noopVoidListener,
  onMenuImportSamples: noopDataListener<string[]>(),
  onMenuImportSampleFolder: noopDataListener<string>(),
  onMenuTransportToggle: noopVoidListener,
  onMenuTransportRecord: noopVoidListener,

  onShortcutTransportToggle: noopVoidListener,
  onShortcutTransportStop: noopVoidListener,

  checkForUpdates: () => {},
  onUpdaterChecking: noopVoidListener,
  onUpdaterUpdateAvailable: noopDataListener<any>(),
  onUpdaterUpToDate: noopVoidListener,
  onUpdaterDownloadProgress: noopDataListener<any>(),
  onUpdaterUpdateDownloaded: noopDataListener<any>(),
  onUpdaterError: noopDataListener<any>(),

  // Store
  storeGet: async <K extends keyof import("./store").AppStoreData>(_key: K) => ({ success: false, error: "Nicht in Electron" }),
  storeSet: async <K extends keyof import("./store").AppStoreData>(_key: K, _value: import("./store").AppStoreData[K]) => ({ success: false, error: "Nicht in Electron" }),
  storeGetRecent: async () => ({ success: false, error: "Nicht in Electron" }),
  storeAddRecent: async (_filePath: string) => ({ success: false, error: "Nicht in Electron" }),
  storeRemoveRecent: async (_filePath: string) => ({ success: false, error: "Nicht in Electron" }),
  storeClearRecent: async () => ({ success: false, error: "Nicht in Electron" }),
  onRecentProjectsChanged: noopDataListener<import("./store").RecentProject[]>(),
};

// ─── Haupt-Hook ───────────────────────────────────────────────────────────────

export function useElectron() {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;

  if (!api?.isElectron) {
    return browserAPI;
  }

  return {
    isElectron: true as const,
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
export function useElectronEvent(
  eventName: keyof Pick<
    ReturnType<typeof useElectron>,
    | "onMenuNewProject"
    | "onMenuSaveProject"
    | "onMenuExportProject"
    | "onMenuImportProject"
    | "onMenuUndo"
    | "onMenuRedo"
    | "onMenuOpenSampleBrowser"
    | "onMenuTransportToggle"
    | "onMenuTransportRecord"
    | "onShortcutTransportToggle"
    | "onShortcutTransportStop"
    | "onUpdaterChecking"
    | "onUpdaterUpToDate"
  >,
  callback: () => void
): void {
  const electron = useElectron();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const stableCallback = () => callbackRef.current();
    const listener = electron[eventName] as VoidListener;
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
export function useElectronImport(options: {
  onComplete?: (data: {
    imported: number;
    errors: number;
    samples?: Array<{ id: string; name: string; path: string; category: string; size: number }>;
    message: string;
  }) => void;
  onError?: (data: { filePath: string; error: string }) => void;
}) {
  const electron = useElectron();
  const currentImportId = useRef<string | null>(null);

  const startImport = useCallback(
    async (folderPath: string) => {
      if (!electron.isElectron) return;
      const { importId } = await electron.importFolder(folderPath);
      currentImportId.current = importId;
      return importId;
    },
    [electron]
  );

  const cancelImport = useCallback(async () => {
    if (!electron.isElectron || !currentImportId.current) return;
    await electron.cancelImport(currentImportId.current);
  }, [electron]);

  useEffect(() => {
    if (!electron.isElectron) return;

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

export default useElectron;
