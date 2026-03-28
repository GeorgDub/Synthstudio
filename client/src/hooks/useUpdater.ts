/**
 * useUpdater – React Hook für den Electron Auto-Updater.
 *
 * Lauscht auf alle Updater-Events aus dem Preload und verwaltet
 * einen kompakten State, den UpdateBadge zur Anzeige nutzt.
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../electron/useElectron";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdaterState {
  phase: UpdaterPhase;
  version?: string;
  percent?: number;
  errorMessage?: string;
}

export function useUpdater() {
  const electron = useElectron();
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });

  useEffect(() => {
    if (!electron.isElectron) return;

    const unsubChecking = electron.onUpdaterChecking(() =>
      setState({ phase: "checking" })
    );

    const unsubAvailable = electron.onUpdaterUpdateAvailable((info) =>
      setState({ phase: "available", version: info.version })
    );

    const unsubUpToDate = electron.onUpdaterUpToDate(() =>
      setState({ phase: "up-to-date" })
    );

    const unsubProgress = electron.onUpdaterDownloadProgress((p) =>
      setState((prev) => ({ ...prev, phase: "downloading", percent: p.percent }))
    );

    const unsubDownloaded = electron.onUpdaterUpdateDownloaded((info) =>
      setState({ phase: "ready", version: info.version })
    );

    const unsubError = electron.onUpdaterError((err) =>
      setState({ phase: "error", errorMessage: err.message })
    );

    return () => {
      unsubChecking();
      unsubAvailable();
      unsubUpToDate();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    };
  }, [electron]);

  const checkForUpdates = () => {
    if (electron.isElectron) electron.checkForUpdates();
  };

  return { state, checkForUpdates };
}
