/**
 * Synthstudio – Electron Main Process (v2)
 *
 * Features:
 * - BrowserWindow mit nativen Menüs
 * - Keyboard-Shortcuts (Ctrl+S, Ctrl+O, Ctrl+Z, Ctrl+Y, F11, etc.)
 * - System-Tray-Integration
 * - Vollbild-Modus
 * - Native Dialoge (Open, Save, Confirm)
 * - Folder-Import mit Progress-Events und Cancel-Unterstützung
 * - Error-Handling für fehlende Berechtigungen
 * - Auto-Updater Grundstruktur (bereit für electron-updater)
 *
 * Die Web-App (client/, server/, shared/) bleibt vollständig unverändert.
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  dialog,
  ipcMain,
  globalShortcut,
  nativeImage,
  Notification,
} from "electron";
import * as path from "path";
import * as fs from "fs";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === "development";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:3000";
const APP_NAME = "KORG ESX-1 Studio";
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);

// ─── Zustand ─────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/** Aktive Import-Abbruch-Flags: importId → aborted */
const importCancelFlags = new Map<string, boolean>();

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/** Erstellt ein einfaches Tray-Icon (16×16 Pixel, schwarz) */
function createTrayIcon(): Electron.NativeImage {
  // Kleines Fallback-Icon – in Produktion durch echte Icon-Datei ersetzen
  const iconPath = path.join(__dirname, "..", "client", "public", "favicon.ico");
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  // Minimal-Icon als leeres Bild (wird durch OS-Default ersetzt)
  return nativeImage.createEmpty();
}

/** Zählt rekursiv Audio-Dateien in einem Verzeichnis */
async function countAudioFiles(dirPath: string): Promise<number> {
  let count = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += await countAudioFiles(fullPath);
      } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        count++;
      }
    }
  } catch {
    // Verzeichnis nicht lesbar – überspringen
  }
  return count;
}

/** Erkennt Kategorie anhand von Datei-/Ordnername */
function detectCategory(filePath: string): string {
  const name = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();
  const combined = `${dir} ${name}`;

  const patterns: Record<string, string[]> = {
    kicks: ["kick", "bd", "bass drum", "bassdrum", "kik", "808"],
    snares: ["snare", "sn", "snr", "rimshot", "rim"],
    hihats: ["hihat", "hi-hat", "hh", "hat", "cymbal", "open hat", "closed hat"],
    claps: ["clap", "clp", "handclap", "snap"],
    toms: ["tom", "floor tom", "rack tom"],
    percussion: ["perc", "conga", "bongo", "shaker", "tambourine", "cowbell", "clave"],
    fx: ["fx", "effect", "noise", "sweep", "riser", "impact", "crash", "zap"],
    loops: ["loop", "break", "groove", "beat", "phrase"],
    vocals: ["vocal", "vox", "voice", "choir", "spoken"],
  };

  for (const [category, keywords] of Object.entries(patterns)) {
    if (keywords.some((kw) => combined.includes(kw))) {
      return category;
    }
  }
  return "other";
}

// ─── Haupt-Fenster ───────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
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

  // ── Fenster-Events ──────────────────────────────────────────────────────────
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", true);
  });

  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", false);
  });

  // Tray-Icon aktualisieren wenn Fenster minimiert/wiederhergestellt
  mainWindow.on("minimize", () => {
    updateTrayMenu();
  });

  mainWindow.on("restore", () => {
    updateTrayMenu();
  });
}

// ─── System-Tray ─────────────────────────────────────────────────────────────

function updateTrayMenu(): void {
  if (!tray) return;

  const isVisible = mainWindow?.isVisible() ?? false;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: APP_NAME,
      enabled: false,
    },
    { type: "separator" },
    {
      label: isVisible ? "Fenster ausblenden" : "Fenster anzeigen",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    },
    {
      label: "Vollbild",
      type: "checkbox",
      checked: mainWindow?.isFullScreen() ?? false,
      click: () => {
        if (mainWindow) {
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
      },
    },
    { type: "separator" },
    {
      label: "Beenden",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);

  // Klick auf Tray-Icon: Fenster anzeigen/verstecken
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  updateTrayMenu();
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

    // ── Datei ────────────────────────────────────────────────────────────────
    {
      label: "Datei",
      submenu: [
        {
          label: "Neues Projekt",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow?.webContents.send("menu:new-project"),
        },
        { type: "separator" },
        {
          label: "Projekt öffnen…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "Projekt öffnen",
              filters: [
                { name: "ESX-1 Studio Projekt", extensions: ["esx1", "json"] },
                { name: "Alle Dateien", extensions: ["*"] },
              ],
              properties: ["openFile"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send("menu:open-project", result.filePaths[0]);
            }
          },
        },
        {
          label: "Projekt speichern",
          accelerator: "CmdOrCtrl+S",
          click: () => mainWindow?.webContents.send("menu:save-project"),
        },
        {
          label: "Projekt speichern unter…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow!, {
              title: "Projekt speichern unter",
              defaultPath: "mein-projekt.esx1",
              filters: [
                { name: "ESX-1 Studio Projekt", extensions: ["esx1"] },
                { name: "JSON", extensions: ["json"] },
              ],
            });
            if (!result.canceled && result.filePath) {
              mainWindow?.webContents.send("menu:save-project-as", result.filePath);
            }
          },
        },
        { type: "separator" },
        {
          label: "Projekt exportieren…",
          accelerator: "CmdOrCtrl+E",
          click: () => mainWindow?.webContents.send("menu:export-project"),
        },
        {
          label: "Projekt importieren…",
          accelerator: "CmdOrCtrl+I",
          click: () => mainWindow?.webContents.send("menu:import-project"),
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },

    // ── Bearbeiten ───────────────────────────────────────────────────────────
    {
      label: "Bearbeiten",
      submenu: [
        {
          label: "Rückgängig",
          accelerator: "CmdOrCtrl+Z",
          click: () => mainWindow?.webContents.send("menu:undo"),
        },
        {
          label: "Wiederholen",
          accelerator: isMac ? "Cmd+Shift+Z" : "CmdOrCtrl+Y",
          click: () => mainWindow?.webContents.send("menu:redo"),
        },
        { type: "separator" },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },

    // ── Ansicht ──────────────────────────────────────────────────────────────
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
        {
          label: "Vollbild",
          accelerator: "F11",
          type: "checkbox" as const,
          checked: false,
          click: (menuItem) => {
            const isFullScreen = mainWindow?.isFullScreen() ?? false;
            mainWindow?.setFullScreen(!isFullScreen);
            menuItem.checked = !isFullScreen;
          },
        },
      ],
    },

    // ── Audio ────────────────────────────────────────────────────────────────
    {
      label: "Audio",
      submenu: [
        {
          label: "Sample-Bibliothek öffnen",
          accelerator: "CmdOrCtrl+B",
          click: () => mainWindow?.webContents.send("menu:open-sample-browser"),
        },
        { type: "separator" },
        {
          label: "Samples importieren…",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "Samples importieren",
              filters: [
                {
                  name: "Audio-Dateien",
                  extensions: ["wav", "mp3", "aif", "aiff", "ogg", "flac", "m4a"],
                },
              ],
              properties: ["openFile", "multiSelections"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send("menu:import-samples", result.filePaths);
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
              // Import über IPC-Handler starten (mit Progress)
              const importId = `import_${Date.now()}`;
              mainWindow?.webContents.send("samples:import-started", { importId });
              startFolderImport(importId, result.filePaths[0]);
            }
          },
        },
        { type: "separator" },
        {
          label: "Transport: Play/Stop",
          accelerator: "Space",
          click: () => mainWindow?.webContents.send("menu:transport-toggle"),
        },
        {
          label: "Transport: Record",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.send("menu:transport-record"),
        },
      ],
    },

    // ── Fenster ──────────────────────────────────────────────────────────────
    {
      label: "Fenster",
      submenu: [
        { role: "minimize" as const },
        {
          label: "Vollbild umschalten",
          accelerator: "F11",
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },

    // ── Hilfe ────────────────────────────────────────────────────────────────
    {
      role: "help" as const,
      submenu: [
        {
          label: "KORG ESX-1 Handbuch",
          click: () =>
            shell.openExternal(
              "https://www.korg.com/us/support/download/manual/0/126/1835/"
            ),
        },
        {
          label: "GitHub Repository",
          click: () =>
            shell.openExternal("https://github.com/GeorgDub/Synthstudio"),
        },
        { type: "separator" },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
        ...(isDev
          ? []
          : [
              {
                label: "Nach Updates suchen…",
                click: () => mainWindow?.webContents.send("updater:check"),
              },
            ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── Folder-Import mit Progress und Cancel ───────────────────────────────────

async function startFolderImport(importId: string, folderPath: string): Promise<void> {
  importCancelFlags.set(importId, false);

  try {
    // Gesamtzahl der Dateien zählen
    const totalFiles = await countAudioFiles(folderPath);
    mainWindow?.webContents.send("samples:import-progress", {
      importId,
      current: 0,
      total: totalFiles,
      percentage: 0,
      phase: "counting",
    });

    if (totalFiles === 0) {
      mainWindow?.webContents.send("samples:import-complete", {
        importId,
        imported: 0,
        errors: 0,
        message: "Keine Audio-Dateien gefunden.",
      });
      importCancelFlags.delete(importId);
      return;
    }

    // Rekursiver Import
    let imported = 0;
    let errors = 0;
    const samples: Array<{
      id: string;
      name: string;
      path: string;
      category: string;
      size: number;
    }> = [];

    await scanAndImport(folderPath, folderPath, importId, {
      onFile: async (filePath) => {
        if (importCancelFlags.get(importId)) return false; // abgebrochen

        try {
          const stat = fs.statSync(filePath);
          const relativePath = path.relative(folderPath, filePath);
          const category = detectCategory(filePath);

          samples.push({
            id: `sample_${Date.now()}_${imported}`,
            name: path.basename(filePath, path.extname(filePath)),
            path: filePath,
            category,
            size: stat.size,
          });

          imported++;

          // Progress alle 5 Dateien oder bei letzter Datei senden
          if (imported % 5 === 0 || imported === totalFiles) {
            mainWindow?.webContents.send("samples:import-progress", {
              importId,
              current: imported,
              total: totalFiles,
              percentage: Math.round((imported / totalFiles) * 100),
              phase: "importing",
              currentFile: path.basename(filePath),
              relativePath,
            });
          }
        } catch (err) {
          errors++;
          mainWindow?.webContents.send("samples:import-error", {
            importId,
            filePath,
            error: String(err),
          });
        }
        return true; // weitermachen
      },
    });

    if (importCancelFlags.get(importId)) {
      mainWindow?.webContents.send("samples:import-cancelled", {
        importId,
        imported,
        errors,
      });
    } else {
      mainWindow?.webContents.send("samples:import-complete", {
        importId,
        imported,
        errors,
        samples,
        message: `${imported} Samples importiert${errors > 0 ? `, ${errors} Fehler` : ""}.`,
      });

      // Desktop-Benachrichtigung (nur wenn App im Hintergrund)
      if (!mainWindow?.isFocused() && Notification.isSupported()) {
        new Notification({
          title: APP_NAME,
          body: `${imported} Samples erfolgreich importiert.`,
        }).show();
      }
    }
  } catch (err) {
    mainWindow?.webContents.send("samples:import-complete", {
      importId,
      imported: 0,
      errors: 1,
      message: `Import fehlgeschlagen: ${String(err)}`,
    });
  } finally {
    importCancelFlags.delete(importId);
  }
}

interface ScanCallbacks {
  onFile: (filePath: string) => Promise<boolean>;
}

async function scanAndImport(
  rootPath: string,
  currentPath: string,
  importId: string,
  callbacks: ScanCallbacks
): Promise<void> {
  if (importCancelFlags.get(importId)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch (err) {
    mainWindow?.webContents.send("samples:import-error", {
      importId,
      filePath: currentPath,
      error: `Verzeichnis nicht lesbar: ${String(err)}`,
    });
    return;
  }

  for (const entry of entries) {
    if (importCancelFlags.get(importId)) return;

    const fullPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      // Versteckte Ordner überspringen
      if (entry.name.startsWith(".")) continue;
      await scanAndImport(rootPath, fullPath, importId, callbacks);
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const shouldContinue = await callbacks.onFile(fullPath);
      if (!shouldContinue) return;
    }
  }
}

// ─── IPC-Handler ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // ── Dateisystem ─────────────────────────────────────────────────────────────

  ipcMain.handle("fs:read-file", async (_event, filePath: string) => {
    try {
      // Sicherheitscheck: Nur Audio-Dateien erlauben
      const ext = path.extname(filePath).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext) && ext !== ".json" && ext !== ".esx1") {
        return { success: false, error: "Dateityp nicht erlaubt" };
      }
      const buffer = fs.readFileSync(filePath);
      return { success: true, data: buffer.buffer };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("fs:list-directory", async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return {
        success: true,
        entries: entries
          .filter((e) => !e.name.startsWith(".")) // Versteckte Dateien ausblenden
          .map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            path: path.join(dirPath, e.name),
            isAudio: AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase()),
          })),
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("fs:write-file", async (_event, filePath: string, data: string) => {
    try {
      // Nur .esx1 und .json erlauben
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== ".esx1" && ext !== ".json") {
        return { success: false, error: "Nur .esx1 und .json Dateien erlaubt" };
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, data, "utf-8");
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── Folder-Import ────────────────────────────────────────────────────────────

  ipcMain.handle("samples:import-folder", async (_event, folderPath: string) => {
    const importId = `import_${Date.now()}`;
    // Import asynchron starten (nicht await – Progress-Events kommen über webContents.send)
    startFolderImport(importId, folderPath);
    return { importId };
  });

  ipcMain.handle("samples:cancel-import", async (_event, importId: string) => {
    if (importCancelFlags.has(importId)) {
      importCancelFlags.set(importId, true);
      return { success: true };
    }
    return { success: false, error: "Import-ID nicht gefunden" };
  });

  // ── Dialoge ──────────────────────────────────────────────────────────────────

  ipcMain.handle("dialog:open-file", async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, options);
    return result;
  });

  ipcMain.handle("dialog:save-file", async (_event, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result;
  });

  ipcMain.handle(
    "dialog:message",
    async (_event, options: Electron.MessageBoxOptions) => {
      const result = await dialog.showMessageBox(mainWindow!, options);
      return result;
    }
  );

  // ── Fenster-Steuerung ────────────────────────────────────────────────────────

  ipcMain.handle("window:set-fullscreen", (_event, fullscreen: boolean) => {
    mainWindow?.setFullScreen(fullscreen);
    return { success: true };
  });

  ipcMain.handle("window:is-fullscreen", () => {
    return mainWindow?.isFullScreen() ?? false;
  });

  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  // ── App-Info ─────────────────────────────────────────────────────────────────

  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:get-platform", () => process.platform);
  ipcMain.handle("app:get-path", (_event, name: string) => {
    const allowed = ["home", "documents", "downloads", "music", "desktop"];
    if (!allowed.includes(name)) return null;
    return app.getPath(name as Parameters<typeof app.getPath>[0]);
  });

  // ── Benachrichtigungen ───────────────────────────────────────────────────────

  ipcMain.handle(
    "notification:show",
    (_event, title: string, body: string) => {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    }
  );
}

// ─── Globale Keyboard-Shortcuts ──────────────────────────────────────────────

function registerGlobalShortcuts(): void {
  // Globale Shortcuts (funktionieren auch wenn App nicht fokussiert)
  // Nur Media-Keys als globale Shortcuts registrieren
  globalShortcut.register("MediaPlayPause", () => {
    mainWindow?.webContents.send("shortcut:transport-toggle");
  });

  globalShortcut.register("MediaStop", () => {
    mainWindow?.webContents.send("shortcut:transport-stop");
  });
}

// ─── App-Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  buildMenu();
  createWindow();
  createTray();
  registerGlobalShortcuts();

  // macOS: Fenster neu erstellen wenn Dock-Icon geklickt
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Sicherheit: Neue Fenster und Navigation verhindern
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (isDev && parsedUrl.origin === new URL(devServerUrl).origin) return;
    if (!isDev && navigationUrl.startsWith("file://")) return;
    event.preventDefault();
  });

  contents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });
});

// Single-Instance-Lock (verhindert mehrere App-Instanzen)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
