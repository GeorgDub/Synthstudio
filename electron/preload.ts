/**
 * Synthstudio – Electron Preload Script
 *
 * Dieses Script läuft in einem isolierten Kontext und stellt der
 * Web-App (Renderer) eine sichere API zur Verfügung, ohne Node.js
 * direkt zu exponieren (contextIsolation: true).
 *
 * Alle Funktionen sind über window.electronAPI zugänglich.
 */

import { contextBridge, ipcRenderer } from "electron";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ElectronAPI {
  /** Plattform: 'win32' | 'darwin' | 'linux' */
  platform: string;
  /** App-Version aus package.json */
  getVersion: () => Promise<string>;

  // ── Dateisystem ─────────────────────────────────────────────────────────────
  /** Datei als ArrayBuffer lesen (für lokale Samples) */
  readFile: (
    filePath: string
  ) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }>;
  /** Verzeichnis-Inhalt auflisten */
  listDirectory: (
    dirPath: string
  ) => Promise<{
    success: boolean;
    entries?: Array<{ name: string; isDirectory: boolean; path: string }>;
    error?: string;
  }>;

  // ── Menü-Events (Main → Renderer) ───────────────────────────────────────────
  onMenuExportProject: (callback: () => void) => () => void;
  onMenuImportProject: (callback: () => void) => () => void;
  onMenuOpenSampleBrowser: (callback: () => void) => () => void;
  onMenuImportSamples: (callback: (filePaths: string[]) => void) => () => void;
  onMenuImportSampleFolder: (callback: (folderPath: string) => void) => () => void;

  /** Gibt zurück ob die App in Electron läuft (immer true im Electron-Kontext) */
  isElectron: true;
}

// ─── API-Implementierung ─────────────────────────────────────────────────────

const electronAPI: ElectronAPI = {
  platform: process.platform,
  isElectron: true,

  getVersion: () => ipcRenderer.invoke("app:get-version"),

  // Dateisystem
  readFile: (filePath: string) =>
    ipcRenderer.invoke("fs:read-file", filePath),

  listDirectory: (dirPath: string) =>
    ipcRenderer.invoke("fs:list-directory", dirPath),

  // Menü-Events: Gibt eine Cleanup-Funktion zurück
  onMenuExportProject: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("menu:export-project", handler);
    return () => ipcRenderer.removeListener("menu:export-project", handler);
  },

  onMenuImportProject: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("menu:import-project", handler);
    return () => ipcRenderer.removeListener("menu:import-project", handler);
  },

  onMenuOpenSampleBrowser: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("menu:open-sample-browser", handler);
    return () =>
      ipcRenderer.removeListener("menu:open-sample-browser", handler);
  },

  onMenuImportSamples: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, filePaths: string[]) =>
      callback(filePaths);
    ipcRenderer.on("menu:import-samples", handler);
    return () => ipcRenderer.removeListener("menu:import-samples", handler);
  },

  onMenuImportSampleFolder: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      folderPath: string
    ) => callback(folderPath);
    ipcRenderer.on("menu:import-sample-folder", handler);
    return () =>
      ipcRenderer.removeListener("menu:import-sample-folder", handler);
  },
};

// ─── API exponieren ──────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// TypeScript-Deklaration für window.electronAPI
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
