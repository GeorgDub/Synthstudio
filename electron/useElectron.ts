/**
 * useElectron – React-Hook für Electron-API-Integration
 *
 * Dieser Hook erkennt automatisch ob die App in Electron oder im Browser läuft
 * und stellt entsprechende Funktionen bereit.
 *
 * VERWENDUNG in React-Komponenten:
 *
 * ```tsx
 * import { useElectron } from "../../electron/useElectron";
 *
 * function MyComponent() {
 *   const { isElectron, platform, readFile } = useElectron();
 *
 *   if (isElectron) {
 *     // Electron-spezifische Features nutzen
 *   }
 * }
 * ```
 *
 * WICHTIG: Dieser Hook ändert NICHTS an der bestehenden Web-App.
 * Er ist ein optionaler Erweiterungspunkt für Electron-Features.
 */

import { useEffect, useCallback } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface UseElectronReturn {
  /** true wenn die App in Electron läuft, false im Browser */
  isElectron: boolean;
  /** Plattform: 'win32' | 'darwin' | 'linux' | 'web' */
  platform: string;

  // ── Dateisystem ─────────────────────────────────────────────────────────────
  /** Lokale Datei als ArrayBuffer lesen (nur Electron) */
  readFile: (
    filePath: string
  ) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }>;
  /** Verzeichnis-Inhalt auflisten (nur Electron) */
  listDirectory: (
    dirPath: string
  ) => Promise<{
    success: boolean;
    entries?: Array<{ name: string; isDirectory: boolean; path: string }>;
    error?: string;
  }>;

  // ── Menü-Event-Listener ─────────────────────────────────────────────────────
  /** Listener für "Projekt exportieren" Menü-Eintrag */
  onMenuExportProject: (callback: () => void) => () => void;
  /** Listener für "Projekt importieren" Menü-Eintrag */
  onMenuImportProject: (callback: () => void) => () => void;
  /** Listener für "Sample-Browser öffnen" Menü-Eintrag */
  onMenuOpenSampleBrowser: (callback: () => void) => () => void;
  /** Listener für "Samples importieren" Menü-Eintrag */
  onMenuImportSamples: (callback: (filePaths: string[]) => void) => () => void;
  /** Listener für "Sample-Ordner importieren" Menü-Eintrag */
  onMenuImportSampleFolder: (
    callback: (folderPath: string) => void
  ) => () => void;
}

// ─── Fallback-Implementierungen für Browser ──────────────────────────────────

const noopCleanup = () => {};

const browserFallback: UseElectronReturn = {
  isElectron: false,
  platform: "web",
  readFile: async () => ({
    success: false,
    error: "Nicht in Electron – nutze File API",
  }),
  listDirectory: async () => ({
    success: false,
    error: "Nicht in Electron – nutze File System Access API",
  }),
  onMenuExportProject: () => noopCleanup,
  onMenuImportProject: () => noopCleanup,
  onMenuOpenSampleBrowser: () => noopCleanup,
  onMenuImportSamples: () => noopCleanup,
  onMenuImportSampleFolder: () => noopCleanup,
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useElectron(): UseElectronReturn {
  const api =
    typeof window !== "undefined" ? window.electronAPI : undefined;

  if (!api?.isElectron) {
    return browserFallback;
  }

  return {
    isElectron: true,
    platform: api.platform,
    readFile: api.readFile,
    listDirectory: api.listDirectory,
    onMenuExportProject: api.onMenuExportProject,
    onMenuImportProject: api.onMenuImportProject,
    onMenuOpenSampleBrowser: api.onMenuOpenSampleBrowser,
    onMenuImportSamples: api.onMenuImportSamples,
    onMenuImportSampleFolder: api.onMenuImportSampleFolder,
  };
}

/**
 * useElectronMenu – Hook für Menü-Event-Listener mit automatischem Cleanup
 *
 * ```tsx
 * useElectronMenu("onMenuExportProject", () => {
 *   // Projekt exportieren
 * });
 * ```
 */
export function useElectronMenu(
  event:
    | "onMenuExportProject"
    | "onMenuImportProject"
    | "onMenuOpenSampleBrowser",
  callback: () => void
): void {
  const electron = useElectron();

  useEffect(() => {
    const cleanup = electron[event](callback as () => void);
    return cleanup;
  }, [electron, event, callback]);
}

export default useElectron;
