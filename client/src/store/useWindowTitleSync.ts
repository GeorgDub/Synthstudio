/**
 * Synthstudio – useWindowTitleSync
 *
 * Synchronisiert den React-Zustand (isDirty, projectName) mit dem Fenstertitel.
 * Browser: setzt document.title.
 * Electron: ruft electron.setWindowTitle() auf – ausschließlich über useElectron()-Hook.
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Kein direktes window.electronAPI. Alle Electron-Aufrufe über useElectron().
 * Electron-Logik hinter if (electron.isElectron).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect } from "react";

// Relativer Import da electron/ außerhalb von client/src liegt
import { useElectron } from "../../../electron/useElectron";

interface WindowTitleSyncOptions {
  projectName: string;
  isDirty: boolean;
}

export function useWindowTitleSync({ projectName, isDirty }: WindowTitleSyncOptions): void {
  // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
  const electron = useElectron();

  useEffect(() => {
    const appName = "KORG ESX-1 Studio";
    // isDirty-Indikator: ● als Präfix (Desktop-Konvention) und Suffix (Browser-Konvention)
    const dirtyPrefix = isDirty ? "● " : "";
    const title = projectName
      ? `${dirtyPrefix}${appName} – ${projectName}`
      : `${dirtyPrefix}${appName}`;

    // Browser: document.title setzen (immer)
    document.title = title;

    // Electron: nativen Fenstertitel setzen
    // Goldenes Gesetz: nur wenn electron.isElectron true ist
    if (electron.isElectron) {
      electron.setWindowTitle(title);
    }
  }, [projectName, isDirty, electron]);
}
