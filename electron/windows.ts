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

import { BrowserWindow, ipcMain, app } from "electron";
import * as path from "path";

const isDev = process.env.NODE_ENV === "development";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:3000";
const APP_NAME = "Synthstudio";

// ─── Fenster-Zustand ──────────────────────────────────────────────────────────

interface WindowState {
  id: number;
  projectPath: string | null;
  projectName: string;
  isDirty: boolean;         // Ungespeicherte Änderungen
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
}

// ─── WindowManager ────────────────────────────────────────────────────────────

export class WindowManager {
  private windows = new Map<number, WindowState>();
  private preloadPath: string;
  private indexPath: string;

  constructor() {
    this.preloadPath = path.join(__dirname, "preload.cjs");
    this.indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
  }

  /** Erstellt ein neues Fenster (optional mit Projekt-Datei) */
  createWindow(projectPath?: string): BrowserWindow {
    const win = new BrowserWindow({
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
    const state: WindowState = {
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
    } else {
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
  updateTitle(win: BrowserWindow): void {
    const state = this.windows.get(win.id);
    if (!state) return;

    const dirty = state.isDirty ? "● " : "";
    win.setTitle(`${dirty}${state.projectName} – ${APP_NAME}`);
  }

  /** Aktualisiert den Zustand eines Fensters */
  updateState(winId: number, updates: Partial<WindowState>): void {
    const state = this.windows.get(winId);
    if (!state) return;

    Object.assign(state, updates);
    const win = BrowserWindow.fromId(winId);
    if (win) this.updateTitle(win);
  }

  /** Gibt alle offenen Fenster zurück */
  getAllWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows();
  }

  /** Gibt den Zustand eines Fensters zurück */
  getState(winId: number): WindowState | undefined {
    return this.windows.get(winId);
  }

  /** Fokussiert ein Fenster nach Projekt-Pfad (verhindert doppeltes Öffnen) */
  focusWindowByProject(projectPath: string): boolean {
    for (const [winId, state] of this.windows.entries()) {
      if (state.projectPath === projectPath) {
        const win = BrowserWindow.fromId(winId);
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
          return true;
        }
      }
    }
    return false;
  }
}

// ─── IPC-Handler ─────────────────────────────────────────────────────────────

export function registerWindowHandlers(manager: WindowManager): void {
  // Neues Fenster öffnen
  ipcMain.handle("window:new", async (_event, projectPath?: string) => {
    const win = manager.createWindow(projectPath);
    return { windowId: win.id };
  });

  // Fenster-Liste abrufen
  ipcMain.handle("window:list", () => {
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
  ipcMain.handle("window:focus", (_event, windowId: number) => {
    const win = BrowserWindow.fromId(windowId);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      return { success: true };
    }
    return { success: false, error: "Fenster nicht gefunden" };
  });

  // Projekt-Zustand aktualisieren (vom Renderer)
  ipcMain.handle(
    "window:update-state",
    (
      event,
      updates: {
        projectPath?: string;
        projectName?: string;
        isDirty?: boolean;
        canUndo?: boolean;
        canRedo?: boolean;
        undoLabel?: string;
        redoLabel?: string;
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { success: false };

      manager.updateState(win.id, updates);
      return { success: true };
    }
  );

  // Schließen bestätigen (nach "ungespeicherte Änderungen" Dialog)
  ipcMain.handle("window:force-close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      manager.updateState(win.id, { isDirty: false });
      win.close();
    }
  });

  // App-Pfade für Projekte
  ipcMain.handle("window:get-recent-projects", () => {
    // Zukünftig: Letzte Projekte aus electron-store laden
    return [];
  });
}
