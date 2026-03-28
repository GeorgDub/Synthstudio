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
import type {
  ElectronImportProgress,
  ElectronImportComplete,
  ElectronImportCancelled,
  ElectronImportError,
  DragDropAudioFile,
  DragDropFolder,
  DragDropBulkData,
  DragDropSampleData,
  StereoExportOptions,
  MidiExportOptions,
  ElectronUpdaterInfo,
  ElectronDownloadProgress,
} from "./types";

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
  onImportProgress: noopDataListener<ElectronImportProgress>(),
  onImportComplete: noopDataListener<ElectronImportComplete>(),
  onImportCancelled: noopDataListener<ElectronImportCancelled>(),
  onImportError: noopDataListener<ElectronImportError>(),

  openFileDialog: async (_options: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; multiSelections?: boolean }) => ({ canceled: true, filePaths: [] as string[] }),
  saveFileDialog: async (_options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => ({ canceled: true }),
  showMessageDialog: async (_options: { type?: "none" | "info" | "error" | "question" | "warning"; title?: string; message: string; detail?: string; buttons?: string[]; defaultId?: number }) => ({ response: 0 }),

  setFullscreen: async (_fullscreen: boolean) => ({ success: false }),
  isFullscreen: async () => false as boolean,
  minimizeWindow: async () => {},
  maximizeWindow: async () => {},
  forceCloseWindow: async () => {},
  setWindowTitle: (_title: string) => {},
  onFullscreenChanged: noopDataListener<boolean>(),

  showNotification: (_title: string, _body: string) => {},
  showConfirmDialog: async (_options: { title?: string; message: string }) => ({ response: 0 }),
  showErrorDialog: async (_title: string, _message: string) => {},
  showInfoDialog: async (_title: string, _message: string) => {},
  openFolderDialog: async (_options?: { title?: string }) => ({ canceled: true, filePaths: [] as string[] }),
  openExternal: async (_url: string) => ({ success: false }),
  showItemInFolder: (_filePath: string) => {},
  fileExists: async (_filePath: string) => ({ exists: false }),
  getFileStats: async (_filePath: string) => ({ success: false as boolean }),
  importSamples: async (_filePaths: string[]) => ({ success: false, importedCount: 0, errors: [] as string[] }),
  analyzeWaveform: async (_filePath: string, _numPeaks?: number) => ({ success: false as boolean }),
  getAudioMetadata: async (_filePath: string) => ({ success: false as boolean }),
  processDragDropFiles: async (_filePaths: string[]) => ({
    audioFiles: [] as DragDropAudioFile[],
    folders: [] as DragDropFolder[],
    projectFiles: [] as DragDropFolder[],
  }),
  exportWav: async (_options: { pcmData: number[]; sampleRate: number; channels: number; suggestedName?: string }) => ({ success: false, canceled: false }),
  exportWavStereo: async (_options: StereoExportOptions) => ({ success: false, canceled: false }),
  exportMidi: async (_options: MidiExportOptions) => ({ success: false, canceled: false }),
  exportProject: async (_options: { projectData: string; suggestedName?: string; filePath?: string }) => ({ success: false, canceled: false }),
  importProject: async (_filePath?: string) => ({ success: false, canceled: true }),
  onDragDropBulkImport: noopDataListener<DragDropBulkData>(),
  onDragDropLoadSample: noopDataListener<DragDropSampleData>(),
  onDragDropOpenProject: noopDataListener<string>(),

  onMenuNewProject: noopVoidListener,
  onMenuOpenProject: noopDataListener<string>(),
  onMenuSaveProject: noopVoidListener,
  onMenuSaveProjectAs: noopDataListener<string>(),
  onMenuExportProject: noopVoidListener,
  onMenuImportProject: noopVoidListener,
  onMenuUndo: noopVoidListener,
  onMenuRedo: noopVoidListener,
  onMenuOpenSampleBrowser: noopVoidListener,
  onMenuOpenSampleLibrary: noopVoidListener,
  onMenuImportSamples: noopDataListener<string[]>(),
  onMenuImportSampleFolder: noopDataListener<string>(),
  onMenuTransportToggle: noopVoidListener,
  onMenuTransportRecord: noopVoidListener,
  onMenuRecord: noopVoidListener,
  onMenuToggleFullscreen: noopVoidListener,
  onMenuBounce: noopVoidListener,

  onShortcutTransportToggle: noopVoidListener,
  onShortcutTransportStop: noopVoidListener,
  onShortcutPlayStop: noopVoidListener,
  onShortcutUndo: noopVoidListener,
  onShortcutRedo: noopVoidListener,
  onShortcutSave: noopVoidListener,

  // Multi-Window
  openNewWindow: async (_projectPath?: string) => ({ windowId: -1 }),
  listWindows: async () => [] as Array<{ id: number; title: string; projectPath: string | null; projectName: string; isDirty: boolean; isFocused: boolean }>,
  focusWindow: async (_windowId: number) => ({ success: false }),
  updateWindowState: async (_updates: { projectPath?: string; projectName?: string; isDirty?: boolean; canUndo?: boolean; canRedo?: boolean; undoLabel?: string; redoLabel?: string }) => ({ success: false }),
  getRecentProjectsFromWindows: async () => [] as Array<{ windowId: number; projectPath: string; projectName: string }>,
  onWindowConfirmClose: noopVoidListener,

  checkForUpdates: () => {},
  onUpdaterChecking: noopVoidListener,
  onUpdaterUpdateAvailable: noopDataListener<ElectronUpdaterInfo>(),
  onUpdaterUpToDate: noopVoidListener,
  onUpdaterDownloadProgress: noopDataListener<ElectronDownloadProgress>(),
  onUpdaterUpdateDownloaded: noopDataListener<{ version: string }>(),
  onUpdaterError: noopDataListener<{ message: string }>(),

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
    onMenuRecord: api.onMenuRecord,
    onMenuToggleFullscreen: api.onMenuToggleFullscreen,
    onMenuBounce: api.onMenuBounce,
    onMenuOpenSampleLibrary: api.onMenuOpenSampleLibrary,
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
    | "onMenuRecord"
    | "onMenuToggleFullscreen"
    | "onMenuBounce"
    | "onShortcutTransportToggle"
    | "onShortcutTransportStop"
    | "onShortcutPlayStop"
    | "onShortcutUndo"
    | "onShortcutRedo"
    | "onShortcutSave"
    | "onWindowConfirmClose"
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
