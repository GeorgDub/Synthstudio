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

import { contextBridge, ipcRenderer } from "electron";

// ─── Hilfsfunktion: Event-Listener mit Cleanup ────────────────────────────────

function createEventListener<T = void>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

function createVoidListener(channel: string) {
  return (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

// ─── API-Implementierung ─────────────────────────────────────────────────────

const electronAPI = {
  /** true wenn in Electron */
  isElectron: true as const,
  /** Plattform */
  platform: process.platform as "win32" | "darwin" | "linux",

  // ── App-Info ─────────────────────────────────────────────────────────────────
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke("app:get-version"),

  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke("app:get-platform"),

  /** Gibt einen bekannten App-Pfad zurück: home, documents, downloads, music, desktop */
  getPath: (name: string): Promise<string | null> =>
    ipcRenderer.invoke("app:get-path", name),

  // ── Dateisystem ──────────────────────────────────────────────────────────────

  readFile: (filePath: string): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> =>
    ipcRenderer.invoke("fs:read-file", filePath),

  listDirectory: (
    dirPath: string
  ): Promise<{
    success: boolean;
    entries?: Array<{ name: string; isDirectory: boolean; path: string; isAudio: boolean }>;
    error?: string;
  }> => ipcRenderer.invoke("fs:list-directory", dirPath),

  writeFile: (
    filePath: string,
    data: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("fs:write-file", filePath, data),

  // ── Folder-Import ────────────────────────────────────────────────────────────

  /** Startet einen Folder-Import und gibt die importId zurück */
  importFolder: (folderPath: string): Promise<{ importId: string }> =>
    ipcRenderer.invoke("samples:import-folder", folderPath),

  /** Bricht einen laufenden Import ab */
  cancelImport: (importId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("samples:cancel-import", importId),

  // Import-Events
  onImportStarted: createEventListener<{ importId: string }>("samples:import-started"),
  onImportProgress: createEventListener<{
    importId: string;
    current: number;
    total: number;
    percentage: number;
    phase: string;
    currentFile?: string;
    relativePath?: string;
  }>("samples:import-progress"),
  onImportComplete: createEventListener<{
    importId: string;
    imported: number;
    errors: number;
    samples?: Array<{ id: string; name: string; path: string; category: string; size: number }>;
    message: string;
  }>("samples:import-complete"),
  onImportCancelled: createEventListener<{
    importId: string;
    imported: number;
    errors: number;
  }>("samples:import-cancelled"),
  onImportError: createEventListener<{
    importId: string;
    filePath: string;
    error: string;
  }>("samples:import-error"),

  // ── Dialoge ──────────────────────────────────────────────────────────────────

  openFileDialog: (options: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    multiSelections?: boolean;
  }): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke("dialog:open-file", {
      title: options.title,
      filters: options.filters,
      properties: options.multiSelections
        ? ["openFile", "multiSelections"]
        : ["openFile"],
    }),

  saveFileDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }> =>
    ipcRenderer.invoke("dialog:save-file", options),

  showMessageDialog: (options: {
    type?: "none" | "info" | "error" | "question" | "warning";
    title?: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
  }): Promise<{ response: number }> =>
    ipcRenderer.invoke("dialog:message", options),

  // ── Fenster-Steuerung ────────────────────────────────────────────────────────

  setFullscreen: (fullscreen: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:set-fullscreen", fullscreen),

  isFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke("window:is-fullscreen"),

  minimizeWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:minimize"),

  maximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:maximize"),

  // Fullscreen-Change-Event
  onFullscreenChanged: createEventListener<boolean>("window:fullscreen-changed"),

  // ── Benachrichtigungen ───────────────────────────────────────────────────────

  showNotification: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke("notification:show", title, body),

  // ── Menü-Events (Main → Renderer) ────────────────────────────────────────────

  onMenuNewProject: createVoidListener("menu:new-project"),
  onMenuOpenProject: createEventListener<string>("menu:open-project"),
  onMenuSaveProject: createVoidListener("menu:save-project"),
  onMenuSaveProjectAs: createEventListener<string>("menu:save-project-as"),
  onMenuExportProject: createVoidListener("menu:export-project"),
  onMenuImportProject: createVoidListener("menu:import-project"),
  onMenuUndo: createVoidListener("menu:undo"),
  onMenuRedo: createVoidListener("menu:redo"),
  onMenuOpenSampleBrowser: createVoidListener("menu:open-sample-browser"),
  onMenuImportSamples: createEventListener<string[]>("menu:import-samples"),
  onMenuImportSampleFolder: createEventListener<string>("menu:import-sample-folder"),
  onMenuTransportToggle: createVoidListener("menu:transport-toggle"),
  onMenuTransportRecord: createVoidListener("menu:transport-record"),

  // ── Keyboard-Shortcuts (globale Media-Keys) ──────────────────────────────────

  onShortcutTransportToggle: createVoidListener("shortcut:transport-toggle"),
  onShortcutTransportStop: createVoidListener("shortcut:transport-stop"),

  // ── Auto-Updater ─────────────────────────────────────────────────────────────

  checkForUpdates: (): void => {
    ipcRenderer.send("updater:check");
  },

  onUpdaterChecking: createVoidListener("updater:checking"),
  onUpdaterUpdateAvailable: createEventListener<{
    version: string;
    releaseDate: string;
    releaseNotes?: string;
  }>("updater:update-available"),
  onUpdaterUpToDate: createVoidListener("updater:up-to-date"),
  onUpdaterDownloadProgress: createEventListener<{
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  }>("updater:download-progress"),
  onUpdaterUpdateDownloaded: createEventListener<{ version: string }>(
    "updater:update-downloaded"
  ),
  onUpdaterError: createEventListener<{ message: string }>("updater:error"),
};

// ─── API exponieren ──────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPIType = typeof electronAPI;
