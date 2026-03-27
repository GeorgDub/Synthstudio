/**
 * Synthstudio – Auto-Updater
 *
 * Verwendet electron-updater (Teil von electron-builder).
 * Updates werden von GitHub Releases heruntergeladen.
 *
 * AKTIVIERUNG:
 * 1. `pnpm add -D electron-updater` ausführen
 * 2. In electron/main.ts importieren:
 *    import { setupAutoUpdater } from "./updater";
 *    // Nach createWindow() aufrufen:
 *    setupAutoUpdater(mainWindow);
 *
 * KONFIGURATION in package.json (build-Sektion):
 * ```json
 * "publish": {
 *   "provider": "github",
 *   "owner": "GeorgDub",
 *   "repo": "Synthstudio"
 * }
 * ```
 *
 * RELEASE-WORKFLOW:
 * 1. Version in package.json erhöhen
 * 2. `pnpm build:electron` ausführen
 * 3. GitHub Release erstellen mit den Dateien aus release/
 * 4. Beim nächsten App-Start wird das Update automatisch erkannt
 */

import { BrowserWindow, dialog, app, shell } from "electron";

// GitHub Releases Seite (Fallback wenn Auto-Update fehlschlägt)
const RELEASES_URL = "https://github.com/GeorgDub/Synthstudio-releases/releases";

// Dynamischer Import um Fehler zu vermeiden wenn electron-updater nicht installiert ist
let autoUpdater: any = null;

async function loadAutoUpdater(): Promise<boolean> {
  try {
    const updaterModule = await import("electron-updater");
    autoUpdater = updaterModule.autoUpdater;
    return true;
  } catch {
    console.log("[Updater] electron-updater nicht installiert – Auto-Updates deaktiviert");
    return false;
  }
}

/** Zeigt Fehler-Dialog mit Option zum manuellen Öffnen der Releases-Seite */
function showUpdateError(mainWindow: BrowserWindow, message: string): void {
  const isPrivateRepo = message.includes("404") || message.includes("HttpError: 404");
  const detail = isPrivateRepo
    ? "Das Repository ist privat oder es gibt noch keine veröffentlichten Releases.\n\nDu kannst Updates manuell von der GitHub-Releases-Seite herunterladen."
    : message;

  dialog
    .showMessageBox(mainWindow, {
      type: "error",
      title: "Update-Check fehlgeschlagen",
      message: "Update-Check fehlgeschlagen",
      detail,
      buttons: isPrivateRepo ? ["Releases öffnen", "OK"] : ["OK"],
      defaultId: isPrivateRepo ? 0 : 0,
      cancelId: isPrivateRepo ? 1 : 0,
    })
    .then(({ response }) => {
      if (isPrivateRepo && response === 0) {
        void shell.openExternal(RELEASES_URL);
      }
    });
}

export async function setupAutoUpdater(mainWindow: BrowserWindow): Promise<void> {
  // Nur in Produktion aktiv
  if (process.env.NODE_ENV === "development") {
    console.log("[Updater] Dev-Modus – Auto-Updater deaktiviert");
    return;
  }

  const available = await loadAutoUpdater();
  if (!available || !autoUpdater) return;

  // ── Konfiguration ──────────────────────────────────────────────────────────
  autoUpdater.autoDownload = false; // Manueller Download nach Bestätigung
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Event-Handler ──────────────────────────────────────────────────────────

  autoUpdater.on("checking-for-update", () => {
    mainWindow.webContents.send("updater:checking");
    console.log("[Updater] Suche nach Updates…");
  });

  autoUpdater.on("update-available", (info: any) => {
    mainWindow.webContents.send("updater:update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
    console.log(`[Updater] Update verfügbar: v${info.version}`);

    // Nutzer fragen ob Update heruntergeladen werden soll
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update verfügbar",
        message: `Version ${info.version} ist verfügbar.`,
        detail: "Soll das Update jetzt heruntergeladen werden?",
        buttons: ["Herunterladen", "Später"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("update-not-available", () => {
    mainWindow.webContents.send("updater:up-to-date");
    console.log("[Updater] App ist aktuell.");
  });

  autoUpdater.on("download-progress", (progress: any) => {
    mainWindow.webContents.send("updater:download-progress", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
    console.log(`[Updater] Download: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", (info: any) => {
    mainWindow.webContents.send("updater:update-downloaded", {
      version: info.version,
    });
    console.log(`[Updater] Update heruntergeladen: v${info.version}`);

    // Nutzer fragen ob App neu gestartet werden soll
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update bereit",
        message: `Version ${info.version} wurde heruntergeladen.`,
        detail: "App jetzt neu starten um das Update zu installieren?",
        buttons: ["Jetzt neu starten", "Später"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err: Error) => {
    mainWindow.webContents.send("updater:error", { message: err.message });
    console.error("[Updater] Fehler:", err.message);
    showUpdateError(mainWindow, err.message);
  });

  // ── Ersten Check nach 10 Sekunden ──────────────────────────────────────────
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error("[Updater] Check fehlgeschlagen:", err.message);
    });
  }, 10_000);
}

/** Manueller Update-Check (wird über IPC aus dem Renderer aufgerufen) */
export async function checkForUpdatesManually(mainWindow: BrowserWindow): Promise<void> {
  const available = await loadAutoUpdater();
  if (!available || !autoUpdater) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Auto-Updater",
      message: "Auto-Updater nicht verfügbar",
      detail:
        "electron-updater ist nicht installiert.\n\nInstallieren mit:\npnpm add -D electron-updater",
    });
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    showUpdateError(mainWindow, String(err));
  }
}
