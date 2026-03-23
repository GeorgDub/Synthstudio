/**
 * Synthstudio – Electron Main Process
 *
 * Dieser Prozess läuft parallel zur Web-Version und ist vollständig
 * unabhängig von ihr. Die Web-App (Vite/React) bleibt unverändert.
 *
 * Entwicklungs-Modus:  VITE_DEV_SERVER_URL=http://localhost:3000
 * Produktions-Modus:   lädt dist/public/index.html
 */

import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === "development";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:3000";

// ─── Haupt-Fenster ───────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "KORG ESX-1 Studio",
    backgroundColor: "#0a0a0a",
    // Rahmenlos mit eigenem Titelbereich (optional, kann entfernt werden)
    // frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Web Audio API benötigt autoplay
      autoplayPolicy: "no-user-gesture-required",
      // Datei-Zugriff für lokale Sample-Bibliothek
      webSecurity: !isDev, // Im Dev-Modus lockerer für CORS
    },
  });

  // ── Inhalt laden ────────────────────────────────────────────────────────────
  if (isDev) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    mainWindow.loadFile(indexPath);
  }

  // ── Externe Links im Standard-Browser öffnen ────────────────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Anwendungsmenü ──────────────────────────────────────────────────────────

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS App-Menü
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),

    // Datei
    {
      label: "Datei",
      submenu: [
        {
          label: "Projekt exportieren…",
          accelerator: "CmdOrCtrl+E",
          click: () => {
            mainWindow?.webContents.send("menu:export-project");
          },
        },
        {
          label: "Projekt importieren…",
          accelerator: "CmdOrCtrl+I",
          click: () => {
            mainWindow?.webContents.send("menu:import-project");
          },
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },

    // Bearbeiten
    {
      label: "Bearbeiten",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },

    // Ansicht
    {
      label: "Ansicht",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        ...(isDev ? [{ role: "toggleDevTools" as const }] : []),
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },

    // Audio
    {
      label: "Audio",
      submenu: [
        {
          label: "Sample-Bibliothek öffnen…",
          accelerator: "CmdOrCtrl+B",
          click: () => {
            mainWindow?.webContents.send("menu:open-sample-browser");
          },
        },
        {
          label: "Samples importieren…",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "Samples importieren",
              filters: [
                {
                  name: "Audio-Dateien",
                  extensions: ["wav", "mp3", "aif", "aiff", "ogg", "flac"],
                },
              ],
              properties: ["openFile", "multiSelections"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send(
                "menu:import-samples",
                result.filePaths
              );
            }
          },
        },
        {
          label: "Sample-Ordner importieren…",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "Sample-Ordner importieren",
              properties: ["openDirectory"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send(
                "menu:import-sample-folder",
                result.filePaths[0]
              );
            }
          },
        },
      ],
    },

    // Fenster
    {
      label: "Fenster",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },

    // Hilfe
    {
      role: "help" as const,
      submenu: [
        {
          label: "KORG ESX-1 Handbuch",
          click: () => {
            shell.openExternal(
              "https://www.korg.com/us/support/download/manual/0/126/1835/"
            );
          },
        },
        {
          label: "GitHub Repository",
          click: () => {
            shell.openExternal("https://github.com/GeorgDub/Synthstudio");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── IPC-Handler (Renderer → Main) ───────────────────────────────────────────

function registerIpcHandlers(): void {
  // Datei-Pfad für Sample-Zugriff zurückgeben (natives Datei-Lesen)
  ipcMain.handle("fs:read-file", async (_event, filePath: string) => {
    try {
      const buffer = fs.readFileSync(filePath);
      return { success: true, data: buffer.buffer };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Verzeichnis-Inhalt auflisten
  ipcMain.handle("fs:list-directory", async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return {
        success: true,
        entries: entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          path: path.join(dirPath, e.name),
        })),
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // App-Version
  ipcMain.handle("app:get-version", () => app.getVersion());

  // Plattform
  ipcMain.handle("app:get-platform", () => process.platform);
}

// ─── App-Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  buildMenu();
  createWindow();

  // macOS: Fenster neu erstellen wenn Dock-Icon geklickt
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Sicherheit: Neue Fenster verhindern
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (isDev && parsedUrl.origin === devServerUrl) return;
    if (!isDev && navigationUrl.startsWith("file://")) return;
    event.preventDefault();
  });
});
