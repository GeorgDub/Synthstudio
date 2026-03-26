/**
 * Synthstudio – Globale TypeScript-Deklarationen für window.electronAPI
 *
 * Vollständige Typen für alle 6 Agenten-Bereiche:
 * - Backend: Store, Dateisystem, App-Info
 * - IPC-Bridge: Alle Kanäle typsicher
 * - Frontend: Fenster, Menü, Drag & Drop
 * - Audio-Engine: Waveform, Export
 * - Build: Auto-Updater
 * - Testing: Vollständige Typen für Mocks
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

export interface ElectronImportProgress {
  importId: string;
  current: number;
  total: number;
  percentage: number;
  phase: "counting" | "importing";
  currentFile?: string;
  relativePath?: string;
}

export interface ElectronImportComplete {
  importId: string;
  imported: number;
  errors: number;
  samples?: ElectronImportSample[];
  message: string;
}

export interface ElectronImportCancelled {
  importId: string;
  imported: number;
  errors: number;
}

export interface ElectronImportError {
  importId: string;
  filePath: string;
  error: string;
}

export interface ElectronUpdaterInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export interface ElectronDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/** Cleanup-Funktion die von Event-Listenern zurückgegeben wird */
type ElectronCleanup = () => void;

// ─── Store-Typen (Backend-Agent) ──────────────────────────────────────────────

interface RecentProject {
  filePath: string;
  name: string;
  lastOpened: string; // ISO 8601
}

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

type AppTheme = "dark" | "light";

interface AppStoreData {
  recentProjects: RecentProject[];
  windowBounds: WindowBounds;
  theme: AppTheme;
  lastImportPath: string;
  version: number;
}

interface StoreResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Waveform-Typen (Audio-Engine-Agent) ──────────────────────────────────────

interface WaveformResult {
  success: boolean;
  peaks?: number[];
  duration?: number;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  fileSize?: number;
  error?: string;
}

interface AudioMetadataResult {
  success: boolean;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  duration?: number;
  fileSize?: number;
  format?: string;
  error?: string;
}

// ─── Export-Typen (Audio-Engine-Agent) ───────────────────────────────────────

interface ExportResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

export interface StereoExportOptions {
  leftChannel: number[];
  rightChannel: number[];
  sampleRate: number;
  normalize?: boolean;
  metadata?: {
    title?: string;
    artist?: string;
    software?: string;
  };
  suggestedName?: string;
}

export interface MidiNote {
  channel: number;    // 0-15
  note: number;       // 0-127
  velocity: number;   // 0-127
  startTick: number;
  durationTicks: number;
}

export interface MidiTrack {
  name: string;
  notes: MidiNote[];
}

export interface MidiExportOptions {
  tracks: MidiTrack[];
  bpm: number;
  suggestedName?: string;
}

// ─── Drag & Drop Typen (Frontend-Agent) ──────────────────────────────────────

export interface DragDropAudioFile {
  path: string;
  name: string;
  ext: string;
  size: number;
}

export interface DragDropFolder {
  path: string;
  name: string;
}

export interface DragDropBulkData {
  audioFiles: DragDropAudioFile[];
  folders: DragDropFolder[];
  projectFiles: DragDropFolder[];
}

export interface DragDropSampleData {
  path: string;
  name: string;
}

// ─── Haupt-API ───────────────────────────────────────────────────────────────

interface ElectronAPI {
  readonly isElectron: true;
  readonly platform: "win32" | "darwin" | "linux";

  // ── App-Info ──────────────────────────────────────────────────────────────
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  getPath(name: "home" | "documents" | "downloads" | "music" | "desktop"): Promise<string | null>;

  // ── Dateisystem ───────────────────────────────────────────────────────────
  readFile(filePath: string): Promise<ElectronFileResult>;
  listDirectory(dirPath: string): Promise<ElectronDirectoryResult>;
  writeFile(filePath: string, data: string): Promise<ElectronWriteResult>;
  fileExists(filePath: string): Promise<{ exists: boolean }>;
  getFileStats(filePath: string): Promise<{ success: boolean; stats?: { size: number; mtime: number }; error?: string }>;

  // ── Folder-Import ─────────────────────────────────────────────────────────────────────────────
  importFolder(folderPath: string): Promise<{ importId: string }>;
  importSamples(filePaths: string[]): Promise<{ success: boolean; importedCount: number; errors: string[] }>;
  cancelImport(importId: string): Promise<{ success: boolean; error?: string }>;

  // ── ZIP-Import ───────────────────────────────────────────────────────────────────────────────────
  importZip(zipPath: string): Promise<{ importId: string }>;
  cleanupZip(importId: string): Promise<{ success: boolean }>;
  onImportStarted(callback: (data: { importId: string }) => void): ElectronCleanup;
  onImportProgress(callback: (data: ElectronImportProgress) => void): ElectronCleanup;
  onImportComplete(callback: (data: ElectronImportComplete) => void): ElectronCleanup;
  onImportCancelled(callback: (data: ElectronImportCancelled) => void): ElectronCleanup;
  onImportError(callback: (data: ElectronImportError) => void): ElectronCleanup;

  // ── Dialoge ───────────────────────────────────────────────────────────────
  openFileDialog(options: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    multiSelections?: boolean;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  openFolderDialog(options?: { title?: string }): Promise<{ canceled: boolean; filePaths: string[] }>;
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
  showConfirmDialog(options: { title?: string; message: string }): Promise<{ response: number }>;
  showErrorDialog(title: string, message: string): Promise<void>;
  showInfoDialog(title: string, message: string): Promise<void>;

  // ── Fenster ───────────────────────────────────────────────────────────────
  setFullscreen(fullscreen: boolean): Promise<{ success: boolean }>;
  isFullscreen(): Promise<boolean>;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  setWindowTitle(title: string): void;
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): ElectronCleanup;

  // ── Benachrichtigungen ────────────────────────────────────────────────────
  showNotification(title: string, body: string): void;

  // ── Menü-Events ───────────────────────────────────────────────────────────
  onMenuNewProject(callback: () => void): ElectronCleanup;
  onMenuOpenProject(callback: (filePath?: string) => void): ElectronCleanup;
  onMenuSaveProject(callback: () => void): ElectronCleanup;
  onMenuSaveProjectAs(callback: (filePath?: string) => void): ElectronCleanup;
  onMenuExportProject(callback: () => void): ElectronCleanup;
  onMenuImportProject(callback: () => void): ElectronCleanup;
  onMenuImportSamples(callback: (filePaths?: string[]) => void): ElectronCleanup;
  onMenuImportSampleFolder(callback: (folderPath?: string) => void): ElectronCleanup;
  onMenuOpenSampleLibrary(callback: () => void): ElectronCleanup;
  onMenuOpenSampleBrowser(callback: () => void): ElectronCleanup;
  onMenuUndo(callback: () => void): ElectronCleanup;
  onMenuRedo(callback: () => void): ElectronCleanup;
  onMenuRecord(callback: () => void): ElectronCleanup;
  onMenuToggleFullscreen(callback: () => void): ElectronCleanup;
  onMenuBounce(callback: () => void): ElectronCleanup;
  onMenuTransportToggle(callback: () => void): ElectronCleanup;
  onMenuTransportRecord(callback: () => void): ElectronCleanup;

  // ── Keyboard-Shortcuts ────────────────────────────────────────────────────
  onShortcutPlayStop(callback: () => void): ElectronCleanup;
  onShortcutUndo(callback: () => void): ElectronCleanup;
  onShortcutRedo(callback: () => void): ElectronCleanup;
  onShortcutSave(callback: () => void): ElectronCleanup;
  onShortcutTransportToggle(callback: () => void): ElectronCleanup;
  onShortcutTransportStop(callback: () => void): ElectronCleanup;

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  onDragDropBulkImport(callback: (data: DragDropBulkData) => void): ElectronCleanup;
  onDragDropLoadSample(callback: (data: DragDropSampleData) => void): ElectronCleanup;
  onDragDropOpenProject(callback: (filePath: string) => void): ElectronCleanup;

  // ── Waveform & Audio-Metadaten (Audio-Engine-Agent) ────────────────────
  analyzeWaveform(filePath: string, numPeaks?: number): Promise<WaveformResult>;
  getAudioMetadata(filePath: string): Promise<AudioMetadataResult>;

  // ── processDragDropFiles (IPC-Bridge) ───────────────────────────────────
  processDragDropFiles(filePaths: string[]): Promise<DragDropBulkData>;

  // ── Export (Audio-Engine-Agent) ───────────────────────────────────────────
  exportWav(options: {
    pcmData: number[];
    sampleRate: number;
    channels: number;
    suggestedName?: string;
  }): Promise<ExportResult>;
  exportWavStereo(options: StereoExportOptions): Promise<ExportResult>;
  exportMidi(options: MidiExportOptions): Promise<ExportResult>;
  exportProject(options: {
    projectData: string;
    suggestedName?: string;
    filePath?: string;
  }): Promise<ExportResult>;
  importProject(filePath?: string): Promise<{ success: boolean; data?: string; filePath?: string; canceled?: boolean; error?: string }>;

  // ── Store (Backend-Agent) ─────────────────────────────────────────────────
  storeGet<K extends keyof AppStoreData>(key: K): Promise<StoreResult<AppStoreData[K]>>;
  storeSet<K extends keyof AppStoreData>(key: K, value: AppStoreData[K]): Promise<StoreResult>;
  storeGetRecent(): Promise<StoreResult<RecentProject[]>>;
  storeAddRecent(filePath: string): Promise<StoreResult>;
  storeRemoveRecent(filePath: string): Promise<StoreResult>;
  storeClearRecent(): Promise<StoreResult>;
  onRecentProjectsChanged(callback: (projects: RecentProject[]) => void): ElectronCleanup;

  // ── Multi-Window (IPC-Bridge-Agent) ──────────────────────────────────────
  openNewWindow(projectPath?: string): Promise<{ windowId: number }>;
  listWindows(): Promise<Array<{
    id: number;
    title: string;
    projectPath: string | null;
    projectName: string;
    isDirty: boolean;
    isFocused: boolean;
  }>>;
  focusWindow(windowId: number): Promise<{ success: boolean }>;
  updateWindowState(updates: {
    projectPath?: string;
    projectName?: string;
    isDirty?: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
    undoLabel?: string;
    redoLabel?: string;
  }): Promise<{ success: boolean }>;
  forceCloseWindow(): Promise<void>;
  getRecentProjectsFromWindows(): Promise<Array<{ windowId: number; projectPath: string; projectName: string }>>;
  onWindowConfirmClose(callback: () => void): ElectronCleanup;

  // ── System ────────────────────────────────────────────────────────────────────────────
  openExternal(url: string): Promise<{ success: boolean }>;
  showItemInFolder(filePath: string): void;

  // ── Auto-Updater (Build-Agent) ────────────────────────────────────────────────
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
