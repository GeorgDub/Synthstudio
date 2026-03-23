/**
 * Synthstudio – useWindowTitleSync
 *
 * Synchronisiert den React-Zustand (isDirty, projectName) mit dem Electron-Fenstertitel.
 * Im Browser: setzt document.title.
 * In Electron: ruft window.electronAPI.setWindowTitle() auf.
 *
 * Goldenes Gesetz: Alle Electron-Aufrufe sind hinter isElectron-Check.
 */
import { useEffect } from "react";

interface WindowTitleSyncOptions {
  projectName: string;
  isDirty: boolean;
}

export function useWindowTitleSync({ projectName, isDirty }: WindowTitleSyncOptions): void {
  useEffect(() => {
    const appName = "KORG ESX-1 Studio";
    const dirtyMarker = isDirty ? " ●" : "";
    const title = projectName
      ? `${appName} – ${projectName}${dirtyMarker}`
      : `${appName}${dirtyMarker}`;

    // Browser: document.title setzen
    document.title = title;

    // Electron: nativen Fenstertitel setzen
    if (typeof window !== "undefined" && window.electronAPI?.isElectron) {
      window.electronAPI.setWindowTitle(title);
    }
  }, [projectName, isDirty]);
}
