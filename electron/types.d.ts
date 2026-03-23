/**
 * Synthstudio – Globale TypeScript-Deklarationen für window.electronAPI
 *
 * Diese Datei erweitert das globale Window-Interface damit TypeScript
 * window.electronAPI in der gesamten Web-App kennt.
 *
 * Wird automatisch erkannt wenn in tsconfig.json unter "include" aufgeführt.
 */

// ─── Basis-Typen ─────────────────────────────────────────────────────────────

interface ElectronFileResult {
  success: boolean;
  data?: ArrayBuffer;
  error?: string;
}

interface ElectronWriteResult {
  success: boolean;
  error?: string;
}

interface ElectronDirectoryEntry {
  name: string;
  isDirectory: boolean;
  path: string;
  isAudio: boolean;
}

interface ElectronDirectoryResult {
  success: boolean;
  entries?: ElectronDirectoryEntry[];
  error?: string;
}

interface ElectronImportSample {
  id: string;
  name: string;
  path: string;
  category: string;
  size: number;
}

interface ElectronImportProgress {
  importId: string;
  current: number;
  total: number;
  percentage: number;
  phase: "counting" | "importing";
  currentFile?: string;
  relativePath?: string;
}

interface ElectronImportComplete {
  importId: string;
  imported: number;
  errors: number;
  samples?: ElectronImportSample[];
  message: string;
}

interface ElectronImportCancelled {
  importId: string;
  imported: number;
  errors: number;
}

interface ElectronImportError {
  importId: string;
  filePath: string;
  error: string;
}

interface ElectronUpdaterInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

interface ElectronDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/** Cleanup-Funktion die von Event-Listenern zurückgegeben wird */
type ElectronCleanup = () => void;

// ─── Haupt-API ───────────────────────────────────────────────────────────────

interface ElectronAPI {
  readonly isElectron: true;
  readonly platform: "win32" | "darwin" | "linux";

  // App-Info
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  getPath(name: "home" | "documents" | "downloads" | "music" | "desktop"): Promise<string | null>;

  // Dateisystem
  readFile(filePath: string): Promise<ElectronFileResult>;
  listDirectory(dirPath: string): Promise<ElectronDirectoryResult>;
  writeFile(filePath: string, data: string): Promise<ElectronWriteResult>;

  // Folder-Import
  importFolder(folderPath: string): Promise<{ importId: string }>;
  cancelImport(importId: string): Promise<{ success: boolean; error?: string }>;
  onImportStarted(callback: (data: { importId: string }) => void): ElectronCleanup;
  onImportProgress(callback: (data: ElectronImportProgress) => void): ElectronCleanup;
  onImportComplete(callback: (data: ElectronImportComplete) => void): ElectronCleanup;
  onImportCancelled(callback: (data: ElectronImportCancelled) => void): ElectronCleanup;
  onImportError(callback: (data: ElectronImportError) => void): ElectronCleanup;

  // Dialoge
  openFileDialog(options: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    multiSelections?: boolean;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  saveFileDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
  showMessageDialog(options: {
    type?: "none" | "info" | "error" | "question" | "warning";
    title?: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
  }): Promise<{ response: number }>;

  // Fenster
  setFullscreen(fullscreen: boolean): Promise<{ success: boolean }>;
  isFullscreen(): Promise<boolean>;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): ElectronCleanup;

  // Benachrichtigungen
  showNotification(title: string, body: string): Promise<void>;

  // Menü-Events
  onMenuNewProject(callback: () => void): ElectronCleanup;
  onMenuOpenProject(callback: (filePath: string) => void): ElectronCleanup;
  onMenuSaveProject(callback: () => void): ElectronCleanup;
  onMenuSaveProjectAs(callback: (filePath: string) => void): ElectronCleanup;
  onMenuExportProject(callback: () => void): ElectronCleanup;
  onMenuImportProject(callback: () => void): ElectronCleanup;
  onMenuUndo(callback: () => void): ElectronCleanup;
  onMenuRedo(callback: () => void): ElectronCleanup;
  onMenuOpenSampleBrowser(callback: () => void): ElectronCleanup;
  onMenuImportSamples(callback: (filePaths: string[]) => void): ElectronCleanup;
  onMenuImportSampleFolder(callback: (folderPath: string) => void): ElectronCleanup;
  onMenuTransportToggle(callback: () => void): ElectronCleanup;
  onMenuTransportRecord(callback: () => void): ElectronCleanup;

  // Keyboard-Shortcuts (globale Media-Keys)
  onShortcutTransportToggle(callback: () => void): ElectronCleanup;
  onShortcutTransportStop(callback: () => void): ElectronCleanup;

  // Auto-Updater
  checkForUpdates(): void;
  onUpdaterChecking(callback: () => void): ElectronCleanup;
  onUpdaterUpdateAvailable(callback: (info: ElectronUpdaterInfo) => void): ElectronCleanup;
  onUpdaterUpToDate(callback: () => void): ElectronCleanup;
  onUpdaterDownloadProgress(callback: (progress: ElectronDownloadProgress) => void): ElectronCleanup;
  onUpdaterUpdateDownloaded(callback: (data: { version: string }) => void): ElectronCleanup;
  onUpdaterError(callback: (data: { message: string }) => void): ElectronCleanup;
}

// ─── Window-Erweiterung ──────────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
