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
import type { RecentProject, AppStoreData } from "./store";

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

  /** Startet einen ZIP-Import und gibt die importId zurück */
  importZip: (zipPath: string): Promise<{ importId: string }> =>
    ipcRenderer.invoke("samples:import-zip", zipPath),

  /** Räumt temporäre ZIP-Extraktions-Dateien auf */
  cleanupZip: (importId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("samples:cleanup-zip", importId),

  // ── MIDI-Import ────────────────────────────────────────────────────────────

  /** Öffnet den nativen MIDI-Datei-Dialog und gibt den gewählten Pfad zurück */
  openMidiDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke("midi:open-dialog"),

  /**
   * Liest eine MIDI-Datei und gibt die Bytes als Array zurück.
   * Verwendet Uint8Array-serialisierung (Array<number>), da ArrayBuffer nicht
   * direkt über den IPC-Kanal übertragen werden kann.
   */
  importMidiFile: (
    filePath: string
  ): Promise<{ success: boolean; data?: number[]; fileName?: string; error?: string }> =>
    ipcRenderer.invoke("midi:import-file", filePath),

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

  openFolderDialog: (options?: { title?: string }): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke("dialog:open-file", {
      title: options?.title,
      properties: ["openDirectory"],
    }),

  showMessageDialog: (options: {
    type?: "none" | "info" | "error" | "question" | "warning";
    title?: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
  }): Promise<{ response: number }> =>
    ipcRenderer.invoke("dialog:message", options),

  showConfirmDialog: (options: { title?: string; message: string }): Promise<{ response: number }> =>
    ipcRenderer.invoke("dialog:message", {
      type: "question",
      title: options.title,
      message: options.message,
      buttons: ["OK", "Abbrechen"],
      defaultId: 0,
    }),

  showErrorDialog: async (title: string, message: string): Promise<void> => {
    await ipcRenderer.invoke("dialog:message", {
      type: "error",
      title,
      message,
      buttons: ["OK"],
      defaultId: 0,
    });
  },

  showInfoDialog: async (title: string, message: string): Promise<void> => {
    await ipcRenderer.invoke("dialog:message", {
      type: "info",
      title,
      message,
      buttons: ["OK"],
      defaultId: 0,
    });
  },

  // ── Fenster-Steuerung ────────────────────────────────────────────────────────

  setFullscreen: (fullscreen: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:set-fullscreen", fullscreen),

  isFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke("window:is-fullscreen"),

  minimizeWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:minimize"),

  maximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:maximize"),

  setWindowTitle: (title: string): void => {
    document.title = title;
  },

  // Fullscreen-Change-Event
  onFullscreenChanged: createEventListener<boolean>("window:fullscreen-changed"),

  // ── Performance-Mode Popup-Window (ROADMAP feature) ──────────────────────────
  // Bidirektionaler State-Sync zwischen Haupt-Fenster und Performance-Popup.
  // Alle Payloads sind narrow-data-only (plain JSON, keine File-Paths).

  openPerformanceWindow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:open-performance"),

  closePerformanceWindow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:close-performance"),

  isPerformanceWindowOpen: (): Promise<boolean> =>
    ipcRenderer.invoke("window:is-performance-open"),

  // State-Broadcast (Main-Renderer → Popup-Renderer via Main-Process-Routing).
  // Main-Renderer ruft das wenn sich pads/activePattern/quantize/bpm/currentStep
  // ändert. Popup-Renderer empfängt es als perf-sync:state Event.
  sendPerfPopupState: (state: unknown): void => {
    ipcRenderer.send("perf-sync:state", state);
  },

  // Action (Popup-Renderer → Main-Renderer via Main-Process-Routing).
  // Popup-Renderer ruft das wenn der User einen Pad klickt / Quantize-Mode
  // ändert. Main-Renderer empfängt es als perf-sync:action Event und dispatcht
  // in seine Stores.
  sendPerfPopupAction: (action: unknown): void => {
    ipcRenderer.send("perf-sync:action", action);
  },

  onPerfPopupState: createEventListener<unknown>("perf-sync:state"),
  onPerfPopupAction: createEventListener<unknown>("perf-sync:action"),
  onPerfPopupClosed: createVoidListener("perf-window:closed"),

  // Phase 2: Always-on-top für das Performance-Popup
  setPerfPopupAlwaysOnTop: (alwaysOnTop: boolean): Promise<{ success: boolean; alwaysOnTop: boolean }> =>
    ipcRenderer.invoke("window:perf-set-always-on-top", alwaysOnTop),
  isPerfPopupAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke("window:perf-is-always-on-top"),

  // ── FX-Window Popup (Multi-Window-Workspace Phase 1, post-v1.25.0) ───────────
  // Pro Kanal ein eigenes pinnable FX-Window. Identisches Pattern wie das
  // Performance-Popup: schmale Channels, narrow-data-only Payloads.
  openFxWindow: (channelId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("window:open-fx", channelId),

  closeFxWindow: (channelId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("window:close-fx", channelId),

  isFxWindowOpen: (channelId: string): Promise<boolean> =>
    ipcRenderer.invoke("window:is-fx-open", channelId),

  setFxWindowAlwaysOnTop: (
    channelId: string,
    alwaysOnTop: boolean,
  ): Promise<{ success: boolean; alwaysOnTop: boolean }> =>
    ipcRenderer.invoke("window:fx-set-always-on-top", { channelId, alwaysOnTop }),

  isFxWindowAlwaysOnTop: (channelId: string): Promise<boolean> =>
    ipcRenderer.invoke("window:fx-is-always-on-top", channelId),

  // State-Broadcast: Main-Renderer → FX-Popup-Renderer (via Main-Process-Routing).
  // Wird im Main-Renderer bei Änderungen des Kanal-FX-State gefeuert.
  sendFxPopupState: (channelId: string, state: unknown): void => {
    ipcRenderer.send("fx-sync:state", { channelId, state });
  },

  // Action: FX-Popup-Renderer → Main-Renderer. Popup ruft das wenn der User
  // einen FX-Parameter ändert. Main-Renderer empfängt es und dispatcht in den
  // useDrumMachineStore.
  sendFxPopupAction: (channelId: string, action: unknown): void => {
    ipcRenderer.send("fx-sync:action", { channelId, action });
  },

  onFxPopupState: createEventListener<{ channelId: string; state: unknown }>("fx-sync:state"),
  onFxPopupAction: createEventListener<{ channelId: string; action: unknown }>("fx-sync:action"),
  onFxPopupClosed: createEventListener<string>("fx-window:closed"),

  // ── Mixer-Window Popup (Multi-Window-Workspace, post-v1.26.0) ────────────────
  // Singleton-Popup wie Performance-Mode. Channels narrow-data-only.
  openMixerWindow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:open-mixer"),

  closeMixerWindow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:close-mixer"),

  isMixerWindowOpen: (): Promise<boolean> =>
    ipcRenderer.invoke("window:is-mixer-open"),

  setMixerWindowAlwaysOnTop: (alwaysOnTop: boolean): Promise<{ success: boolean; alwaysOnTop: boolean }> =>
    ipcRenderer.invoke("window:mixer-set-always-on-top", alwaysOnTop),

  isMixerWindowAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke("window:mixer-is-always-on-top"),

  sendMixerPopupState: (state: unknown): void => {
    ipcRenderer.send("mixer-sync:state", state);
  },

  sendMixerPopupAction: (action: unknown): void => {
    ipcRenderer.send("mixer-sync:action", action);
  },

  onMixerPopupState: createEventListener<unknown>("mixer-sync:state"),
  onMixerPopupAction: createEventListener<unknown>("mixer-sync:action"),
  onMixerPopupClosed: createVoidListener("mixer-window:closed"),

  // ── Benachrichtigungen ───────────────────────────────────────────────────────

  showNotification: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke("notification:show", title, body),

  openExternal: async (url: string): Promise<{ success: boolean }> => {
    window.open(url, "_blank", "noopener,noreferrer");
    return { success: true };
  },

  showItemInFolder: (_filePath: string): void => {},
  fileExists: async (_filePath: string): Promise<{ exists: boolean }> => ({ exists: false }),
  getFileStats: async (_filePath: string): Promise<{ success: boolean; stats?: { size: number; mtime: number }; error?: string }> => ({ success: false }),
  importSamples: async (_filePaths: string[]): Promise<{ success: boolean; importedCount: number; errors: string[] }> => ({ success: false, importedCount: 0, errors: [] }),

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
  onMenuImportMidi: createEventListener<string>("menu:import-midi"),
  onMenuTransportToggle: createVoidListener("menu:transport-toggle"),
  onMenuTransportRecord: createVoidListener("menu:transport-record"),
  onMenuRecord: createVoidListener("menu:record"),
  onMenuToggleFullscreen: createVoidListener("menu:toggle-fullscreen"),
  onMenuBounce: createVoidListener("menu:bounce"),
  onMenuOpenSampleLibrary: createVoidListener("menu:open-sample-library"),
  // post-v1.25.0 — neue Menü-Items für Music-Production-fokussierte Menübar
  onMenuPatternClear: createVoidListener("menu:pattern-clear"),
  onMenuPatternRandomize: createVoidListener("menu:pattern-randomize"),
  onMenuPatternFill: createVoidListener("menu:pattern-fill"),
  onMenuPatternDuplicate: createVoidListener("menu:pattern-duplicate"),
  onMenuPatternNext: createVoidListener("menu:pattern-next"),
  onMenuPatternPrev: createVoidListener("menu:pattern-prev"),
  onMenuBpmUp: createVoidListener("menu:bpm-up"),
  onMenuBpmDown: createVoidListener("menu:bpm-down"),
  onMenuTapTempo: createVoidListener("menu:tap-tempo"),
  onMenuOpenPerformance: createVoidListener("menu:open-performance"),
  onMenuOpenAudioWorkbench: createVoidListener("menu:open-audio-workbench"),
  onMenuTab: createEventListener<string>("menu:tab"),

  // ── Keyboard-Shortcuts (globale Media-Keys) ──────────────────────────────────

  onShortcutTransportToggle: createVoidListener("shortcut:transport-toggle"),
  onShortcutTransportStop: createVoidListener("shortcut:transport-stop"),
  onShortcutPlayStop: createVoidListener("shortcut:play-stop"),
  onShortcutUndo: createVoidListener("shortcut:undo"),
  onShortcutRedo: createVoidListener("shortcut:redo"),
  onShortcutSave: createVoidListener("shortcut:save"),

  // ── Auto-Updater ──────────────────────────────────────────────────────────

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

  // ── App-Store ─────────────────────────────────────────────────────────────

  /** Einen Store-Wert lesen */
  storeGet: (key: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke("store:get", key),

  /** Einen Store-Wert setzen */
  storeSet: (key: string, value: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("store:set", key, value),

  /** Zuletzt geöffnete Projekte abrufen */
  storeGetRecent: (): Promise<{
    success: boolean;
    data?: Array<{ filePath: string; name: string; lastOpened: string }>;
    error?: string;
  }> => ipcRenderer.invoke("store:get-recent"),

  /** Projekt zu zuletzt geöffneten hinzufügen */
  storeAddRecent: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("store:add-recent", filePath),

  /** Projekt aus zuletzt geöffneten entfernen */
  storeRemoveRecent: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("store:remove-recent", filePath),

  /** Alle zuletzt geöffneten Projekte löschen */
  storeClearRecent: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("store:clear-recent"),

  /** Listener für Änderungen an zuletzt geöffneten Projekten */
  onRecentProjectsChanged: createEventListener<
    Array<{ filePath: string; name: string; lastOpened: string }>
  >("store:recent-changed"),

  // ── Waveform-Preview ──────────────────────────────────────────────────────

  /** Waveform-Peaks für eine lokale Audio-Datei abrufen */
  analyzeWaveform: (
    filePath: string,
    numPeaks?: number
  ): Promise<{
    success: boolean;
    peaks?: number[];
    duration?: number;
    sampleRate?: number;
    channels?: number;
    bitDepth?: number;
    fileSize?: number;
    estimatedBpm?: number;
    bpmConfidence?: number;
    error?: string;
  }> => ipcRenderer.invoke("waveform:get-peaks", filePath, numPeaks ?? 200),

  /** Audio-Datei-Metadaten abrufen */
  getAudioMetadata: (
    filePath: string
  ): Promise<{
    success: boolean;
    sampleRate?: number;
    channels?: number;
    bitDepth?: number;
    duration?: number;
    fileSize?: number;
    format?: string;
    error?: string;
  }> => ipcRenderer.invoke("waveform:get-metadata", filePath),

  // ── Drag & Drop ──────────────────────────────────────────────────────────

  /** Gedropte Dateipfade verarbeiten und kategorisieren */
  processDragDropFiles: (
    filePaths: string[]
  ): Promise<{
    audioFiles: Array<{ path: string; name: string; ext: string; size: number }>;
    folders: Array<{ path: string; name: string }>;
    projectFiles: Array<{ path: string; name: string }>;
  }> => ipcRenderer.invoke("dragdrop:process-files", filePaths),

  onDragDropOpenProject: createEventListener<string>("dragdrop:open-project"),
  onDragDropLoadSample: createEventListener<{ path: string; name: string }>("dragdrop:load-sample"),
  onDragDropBulkImport: createEventListener<{
    audioFiles: Array<{ path: string; name: string; ext: string; size: number }>;
    folders: Array<{ path: string; name: string }>;
    projectFiles: Array<{ path: string; name: string }>;
  }>("dragdrop:bulk-import"),

  // ── Multi-Window ──────────────────────────────────────────────────────────

  /** Neues Fenster öffnen (optional mit Projekt-Pfad) */
  openNewWindow: (projectPath?: string): Promise<{ windowId: number }> =>
    ipcRenderer.invoke("window:new", projectPath),

  /** Alle offenen Fenster auflisten */
  listWindows: (): Promise<Array<{
    id: number;
    title: string;
    projectPath: string | null;
    projectName: string;
    isDirty: boolean;
    isFocused: boolean;
  }>> => ipcRenderer.invoke("window:list"),

  /** Fenster fokussieren */
  focusWindow: (windowId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:focus", windowId),

  /** Fenster-Zustand aktualisieren (Titel, isDirty, canUndo, canRedo) */
  updateWindowState: (updates: {
    projectPath?: string;
    projectName?: string;
    isDirty?: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
    undoLabel?: string;
    redoLabel?: string;
  }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("window:update-state", updates),

  /** Fenster schließen (auch wenn ungespeicherte Änderungen) */
  forceCloseWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:force-close"),

  /** Zuletzt geöffnete Projekte aus dem Fenster-Manager abrufen */
  getRecentProjectsFromWindows: (): Promise<Array<{
    windowId: number;
    projectPath: string;
    projectName: string;
  }>> => ipcRenderer.invoke("window:get-recent-projects"),

  onWindowConfirmClose: createVoidListener("window:confirm-close"),

  // ── Export ──────────────────────────────────────────────────────────────

  /** WAV-Export: PCM-Daten als WAV-Datei speichern */
  exportWav: (options: {
    pcmData: number[];
    sampleRate: number;
    channels: number;
    suggestedName?: string;
  }): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("export:wav", options),

  /** MIDI-Export: Pattern als MIDI-Datei speichern */
  exportMidi: (options: {
    tracks: Array<{
      name: string;
      notes: Array<{
        channel: number;
        note: number;
        velocity: number;
        startTick: number;
        durationTicks: number;
      }>;
    }>;
    bpm: number;
    suggestedName?: string;
  }): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("export:midi", options),

  /** Projekt-Export: JSON-Daten als .synth-Datei speichern */
  exportProject: (options: {
    projectData: string;
    suggestedName?: string;
    filePath?: string;
  }): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("export:project", options),

  /** Stereo WAV-Export: Separate L/R-Kanäle als Stereo-WAV-Datei speichern */
  exportWavStereo: (options: {
    leftChannel: number[];
    rightChannel: number[];
    sampleRate: number;
    normalize?: boolean;
    metadata?: { title?: string; artist?: string; software?: string };
    suggestedName?: string;
  }): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("export:wav-stereo", options),

  /** Projekt-Import: .synth/.json-Datei lesen */
  importProject: (filePath?: string): Promise<{
    success: boolean;
    data?: string;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("export:import-project", filePath),

  /** Bundle-Export: WAV-Stems + MIDI + Metadaten als ZIP */
  exportBundle: (options: {
    stems: Array<{ name: string; pcmData: number[]; sampleRate: number; channels: number }>;
    midiTracks?: Array<{
      name: string;
      notes: Array<{
        channel: number;
        note: number;
        velocity: number;
        startTick: number;
        durationTicks: number;
      }>;
    }>;
    bpm?: number;
    projectData?: string;
    suggestedName?: string;
  }): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("export:bundle", options),

  // ── Kollaborations-Session ────────────────────────────────────────────────────

  /** Startet den lokalen Kollaborations-WebSocket-Server. */
  startCollabServer: (): Promise<{ success: boolean; port?: number; error?: string }> =>
    ipcRenderer.invoke("collab:start"),

  /** Stoppt den Kollaborations-Server. */
  stopCollabServer: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("collab:stop"),

  /** Gibt lokale IP-Adresse und Server-Port zurück. */
  getCollabAddress: (): Promise<{ ip: string; port: number; running: boolean }> =>
    ipcRenderer.invoke("collab:get-address"),

  /** Startet UDP-Broadcast damit andere die Session finden. */
  startCollabAnnounce: (roomCode: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("collab:announce-start", roomCode),

  /** Stoppt den UDP-Broadcast. */
  stopCollabAnnounce: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("collab:announce-stop"),

  /** Startet den UDP-Listener für entdeckte Sessions. */
  startCollabDiscovery: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("collab:discovery-start"),

  /** Stoppt den UDP-Listener. */
  stopCollabDiscovery: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("collab:discovery-stop"),

  /** Gibt alle aktuell sichtbaren Sessions im Netzwerk zurück. */
  getDiscoveredSessions: (): Promise<Array<{
    roomCode: string;
    hostIp: string;
    hostName: string;
    port: number;
    lastSeen: number;
  }>> =>
    ipcRenderer.invoke("collab:get-discovered"),

};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPIType = typeof electronAPI;
