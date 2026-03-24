"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAutoUpdater = setupAutoUpdater;
exports.checkForUpdatesManually = checkForUpdatesManually;
const electron_1 = require("electron");
// Dynamischer Import um Fehler zu vermeiden wenn electron-updater nicht installiert ist
let autoUpdater = null;
async function loadAutoUpdater() {
    try {
        const updaterModule = await Promise.resolve().then(() => __importStar(require("electron-updater")));
        autoUpdater = updaterModule.autoUpdater;
        return true;
    }
    catch {
        console.log("[Updater] electron-updater nicht installiert – Auto-Updates deaktiviert");
        console.log("[Updater] Installieren mit: pnpm add -D electron-updater");
        return false;
    }
}
async function setupAutoUpdater(mainWindow) {
    // Nur in Produktion aktiv
    if (process.env.NODE_ENV === "development") {
        console.log("[Updater] Dev-Modus – Auto-Updater deaktiviert");
        return;
    }
    const available = await loadAutoUpdater();
    if (!available || !autoUpdater)
        return;
    // ── Konfiguration ──────────────────────────────────────────────────────────
    autoUpdater.autoDownload = false; // Manueller Download nach Bestätigung
    autoUpdater.autoInstallOnAppQuit = true;
    // ── Event-Handler ──────────────────────────────────────────────────────────
    autoUpdater.on("checking-for-update", () => {
        mainWindow.webContents.send("updater:checking");
        console.log("[Updater] Suche nach Updates…");
    });
    autoUpdater.on("update-available", (info) => {
        mainWindow.webContents.send("updater:update-available", {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
        });
        console.log(`[Updater] Update verfügbar: v${info.version}`);
        // Nutzer fragen ob Update heruntergeladen werden soll
        electron_1.dialog
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
    autoUpdater.on("download-progress", (progress) => {
        mainWindow.webContents.send("updater:download-progress", {
            percent: Math.round(progress.percent),
            transferred: progress.transferred,
            total: progress.total,
            bytesPerSecond: progress.bytesPerSecond,
        });
        console.log(`[Updater] Download: ${Math.round(progress.percent)}%`);
    });
    autoUpdater.on("update-downloaded", (info) => {
        mainWindow.webContents.send("updater:update-downloaded", {
            version: info.version,
        });
        console.log(`[Updater] Update heruntergeladen: v${info.version}`);
        // Nutzer fragen ob App neu gestartet werden soll
        electron_1.dialog
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
    autoUpdater.on("error", (err) => {
        mainWindow.webContents.send("updater:error", { message: err.message });
        console.error("[Updater] Fehler:", err.message);
    });
    // ── Ersten Check nach 10 Sekunden ──────────────────────────────────────────
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
            console.error("[Updater] Check fehlgeschlagen:", err.message);
        });
    }, 10000);
}
/** Manueller Update-Check (wird über IPC aus dem Renderer aufgerufen) */
async function checkForUpdatesManually(mainWindow) {
    const available = await loadAutoUpdater();
    if (!available || !autoUpdater) {
        electron_1.dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Auto-Updater",
            message: "Auto-Updater nicht verfügbar",
            detail: "electron-updater ist nicht installiert.\n\nInstallieren mit:\npnpm add -D electron-updater",
        });
        return;
    }
    try {
        await autoUpdater.checkForUpdates();
    }
    catch (err) {
        electron_1.dialog.showMessageBox(mainWindow, {
            type: "error",
            title: "Update-Fehler",
            message: "Update-Check fehlgeschlagen",
            detail: String(err),
        });
    }
}
