"use strict";
/**
 * Synthstudio – Multi-Window-Support & Projekt-History
 *
 * Multi-Window:
 * - Mehrere Projekte gleichzeitig in separaten Fenstern öffnen
 * - Jedes Fenster hat seinen eigenen Zustand
 * - Fenster-Verwaltung (erstellen, schließen, fokussieren)
 *
 * Projekt-History / Undo-Redo:
 * - Undo/Redo-Stack pro Fenster (im Main-Prozess als Metadaten)
 * - Eigentlicher Zustand bleibt im Renderer (React-State)
 * - Main-Prozess verwaltet nur: kann Undo? kann Redo? Titel
 *
 * INTEGRATION in main.ts:
 * ```ts
 * import { WindowManager, registerWindowHandlers } from "./windows";
 * const windowManager = new WindowManager(isDev, devServerUrl);
 * registerWindowHandlers(windowManager);
 * ```
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
exports.WindowManager = void 0;
exports.registerWindowHandlers = registerWindowHandlers;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const isDev = process.env.NODE_ENV === "development";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:3000";
const APP_NAME = "Synthstudio";
// ─── WindowManager ────────────────────────────────────────────────────────────
class WindowManager {
    constructor() {
        this.windows = new Map();
        this.preloadPath = path.join(__dirname, "preload.js");
        this.indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    }
    /** Erstellt ein neues Fenster (optional mit Projekt-Datei) */
    createWindow(projectPath) {
        const win = new electron_1.BrowserWindow({
            width: 1440,
            height: 900,
            minWidth: 1024,
            minHeight: 700,
            title: APP_NAME,
            backgroundColor: "#0a0a0a",
            webPreferences: {
                preload: this.preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                autoplayPolicy: "no-user-gesture-required",
                webSecurity: !isDev,
            },
        });
        // Zustand initialisieren
        const state = {
            id: win.id,
            projectPath: projectPath ?? null,
            projectName: projectPath
                ? path.basename(projectPath, path.extname(projectPath))
                : "Neues Projekt",
            isDirty: false,
            canUndo: false,
            canRedo: false,
            undoLabel: "Rückgängig",
            redoLabel: "Wiederholen",
        };
        this.windows.set(win.id, state);
        this.updateTitle(win);
        // Inhalt laden
        if (isDev) {
            win.loadURL(devServerUrl);
        }
        else {
            win.loadFile(this.indexPath);
        }
        // Wenn Projekt-Datei angegeben, nach dem Laden öffnen
        if (projectPath) {
            win.webContents.once("did-finish-load", () => {
                win.webContents.send("menu:open-project", projectPath);
            });
        }
        // Fenster-Events
        win.on("close", (event) => {
            const winState = this.windows.get(win.id);
            if (winState?.isDirty) {
                event.preventDefault();
                win.webContents.send("window:confirm-close");
            }
        });
        win.on("closed", () => {
            this.windows.delete(win.id);
        });
        return win;
    }
    /** Aktualisiert den Fenstertitel basierend auf Zustand */
    updateTitle(win) {
        const state = this.windows.get(win.id);
        if (!state)
            return;
        const dirty = state.isDirty ? "● " : "";
        win.setTitle(`${dirty}${state.projectName} – ${APP_NAME}`);
    }
    /** Aktualisiert den Zustand eines Fensters */
    updateState(winId, updates) {
        const state = this.windows.get(winId);
        if (!state)
            return;
        Object.assign(state, updates);
        const win = electron_1.BrowserWindow.fromId(winId);
        if (win)
            this.updateTitle(win);
    }
    /** Gibt alle offenen Fenster zurück */
    getAllWindows() {
        return electron_1.BrowserWindow.getAllWindows();
    }
    /** Gibt den Zustand eines Fensters zurück */
    getState(winId) {
        return this.windows.get(winId);
    }
    /** Fokussiert ein Fenster nach Projekt-Pfad (verhindert doppeltes Öffnen) */
    focusWindowByProject(projectPath) {
        for (const [winId, state] of this.windows.entries()) {
            if (state.projectPath === projectPath) {
                const win = electron_1.BrowserWindow.fromId(winId);
                if (win) {
                    if (win.isMinimized())
                        win.restore();
                    win.focus();
                    return true;
                }
            }
        }
        return false;
    }
}
exports.WindowManager = WindowManager;
// ─── IPC-Handler ─────────────────────────────────────────────────────────────
function registerWindowHandlers(manager) {
    // Neues Fenster öffnen
    electron_1.ipcMain.handle("window:new", async (_event, projectPath) => {
        const win = manager.createWindow(projectPath);
        return { windowId: win.id };
    });
    // Fenster-Liste abrufen
    electron_1.ipcMain.handle("window:list", () => {
        return manager.getAllWindows().map((win) => {
            const state = manager.getState(win.id);
            return {
                id: win.id,
                title: win.getTitle(),
                projectPath: state?.projectPath ?? null,
                projectName: state?.projectName ?? "Unbekannt",
                isDirty: state?.isDirty ?? false,
                isFocused: win.isFocused(),
            };
        });
    });
    // Fenster fokussieren
    electron_1.ipcMain.handle("window:focus", (_event, windowId) => {
        const win = electron_1.BrowserWindow.fromId(windowId);
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
            return { success: true };
        }
        return { success: false, error: "Fenster nicht gefunden" };
    });
    // Projekt-Zustand aktualisieren (vom Renderer)
    electron_1.ipcMain.handle("window:update-state", (event, updates) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win)
            return { success: false };
        manager.updateState(win.id, updates);
        return { success: true };
    });
    // Schließen bestätigen (nach "ungespeicherte Änderungen" Dialog)
    electron_1.ipcMain.handle("window:force-close", (event) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (win) {
            manager.updateState(win.id, { isDirty: false });
            win.close();
        }
    });
    // App-Pfade für Projekte
    electron_1.ipcMain.handle("window:get-recent-projects", () => {
        // Zukünftig: Letzte Projekte aus electron-store laden
        return [];
    });
}
