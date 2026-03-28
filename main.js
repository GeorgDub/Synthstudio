"use strict";
/**
 * Synthstudio – Electron Main Process (v3)
 *
 * Features:
 * - BrowserWindow mit nativen Menüs
 * - Keyboard-Shortcuts (Ctrl+S, Ctrl+O, Ctrl+Z, Ctrl+Y, F11, etc.)
 * - System-Tray-Integration
 * - Vollbild-Modus
 * - Native Dialoge (Open, Save, Confirm)
 * - Folder-Import mit Progress-Events und Cancel-Unterstützung
 * - Error-Handling für fehlende Berechtigungen
 * - AppStore-Integration (zuletzt geöffnete Projekte, WindowBounds, Theme)
 * - Dynamisches Menü "Zuletzt geöffnete Projekte"
 * - IPC-Handler für den Store
 * - Auto-Updater (electron-updater, aktiviert in Produktion)
 *
 * Die Web-App (client/, server/, shared/) bleibt vollständig unverändert.
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
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// ─── Electron-Module ─────────────────────────────────────────────────────────
const dragdrop_1 = require("./dragdrop");
const waveform_1 = require("./waveform");
const windows_1 = require("./windows");
const export_1 = require("./export");
const updater_1 = require("./updater");
const store_1 = require("./store");
const windowManager = new windows_1.WindowManager();
// ─── Konstanten ──────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === "development";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:3000";
const APP_NAME = "Synthstudio";
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);
// ─── Zustand ─────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let appStore = null;
/** Aktive Import-Abbruch-Flags: importId → aborted */
const importCancelFlags = new Map();
// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
/** Erstellt ein einfaches Tray-Icon (16×16 Pixel) */
function createTrayIcon() {
    const iconPath = path.join(__dirname, "..", "client", "public", "favicon.ico");
    if (fs.existsSync(iconPath)) {
        return electron_1.nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    }
    // Minimal-Icon als leeres Bild (wird durch OS-Default ersetzt)
    return electron_1.nativeImage.createEmpty();
}
/** Zählt rekursiv Audio-Dateien in einem Verzeichnis */
async function countAudioFiles(dirPath) {
    let count = 0;
    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                count += await countAudioFiles(fullPath);
            }
            else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                count++;
            }
        }
    }
    catch {
        // Verzeichnis nicht lesbar – überspringen
    }
    return count;
}
/** Erkennt Kategorie anhand von Datei-/Ordnername */
function detectCategory(filePath) {
    const name = path.basename(filePath).toLowerCase();
    const dir = path.dirname(filePath).toLowerCase();
    const combined = `${dir} ${name}`;
    const patterns = {
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
function createWindow() {
    // Gespeicherte Fenstergröße/-position aus dem Store laden
    const savedBounds = appStore?.get("windowBounds");
    const windowWidth = savedBounds?.width ?? 1440;
    const windowHeight = savedBounds?.height ?? 900;
    const windowX = savedBounds?.x;
    const windowY = savedBounds?.y;
    mainWindow = new electron_1.BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        ...(windowX !== undefined && windowY !== undefined ? { x: windowX, y: windowY } : {}),
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
    // Maximiert-Zustand wiederherstellen
    if (savedBounds?.isMaximized) {
        mainWindow.maximize();
    }
    // ── Inhalt laden ────────────────────────────────────────────────────────────
    if (isDev) {
        mainWindow.loadURL(devServerUrl);
        mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    else {
        const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
        mainWindow.loadFile(indexPath);
    }
    // ── Externe Links im Standard-Browser öffnen ────────────────────────────────
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    // ── Fenster-Events ──────────────────────────────────────────────────────────
    mainWindow.on("close", () => {
        // Fenstergröße und -position vor dem Schließen speichern
        if (mainWindow && appStore) {
            const bounds = mainWindow.getBounds();
            appStore.saveWindowBounds({
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                isMaximized: mainWindow.isMaximized(),
            });
        }
    });
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
function updateTrayMenu() {
    if (!tray)
        return;
    const isVisible = mainWindow?.isVisible() ?? false;
    const contextMenu = electron_1.Menu.buildFromTemplate([
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
                    }
                    else {
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
                electron_1.app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);
}
function createTray() {
    const icon = createTrayIcon();
    tray = new electron_1.Tray(icon);
    tray.setToolTip(APP_NAME);
    // Klick auf Tray-Icon: Fenster anzeigen/verstecken
    tray.on("click", () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            }
            else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    updateTrayMenu();
}
// ─── Dynamisches Menü "Zuletzt geöffnete Projekte" ───────────────────────────
/**
 * Erstellt die Menüeinträge für "Zuletzt geöffnete Projekte".
 * Wird bei jedem buildMenu()-Aufruf neu generiert.
 */
function buildRecentProjectsSubmenu() {
    if (!appStore)
        return [{ label: "Keine zuletzt geöffneten Projekte", enabled: false }];
    const recentProjects = appStore.getRecentProjects();
    if (recentProjects.length === 0) {
        return [{ label: "Keine zuletzt geöffneten Projekte", enabled: false }];
    }
    const items = recentProjects.map((project) => ({
        label: project.name,
        sublabel: project.filePath,
        click: () => {
            // Prüfen ob Datei noch existiert (asynchron, kein Blockieren)
            fs.promises
                .access(project.filePath, fs.constants.R_OK)
                .then(() => {
                mainWindow?.webContents.send("menu:open-project", project.filePath);
                // Zugriffszeitpunkt aktualisieren
                appStore?.addRecentProject(project.filePath);
                // Menü neu aufbauen damit Reihenfolge aktualisiert wird
                buildMenu();
            })
                .catch(() => {
                // Datei nicht mehr vorhanden – aus Liste entfernen
                appStore?.removeRecentProject(project.filePath);
                buildMenu();
                electron_1.dialog.showMessageBox(mainWindow, {
                    type: "warning",
                    title: "Datei nicht gefunden",
                    message: `Die Datei "${project.name}" wurde nicht gefunden.`,
                    detail: project.filePath,
                    buttons: ["OK"],
                });
            });
        },
    }));
    items.push({ type: "separator" }, {
        label: "Zuletzt geöffnete Projekte löschen",
        click: () => {
            appStore?.clearRecentProjects();
            mainWindow?.webContents.send("store:recent-changed", []);
            buildMenu();
        },
    });
    return items;
}
// ─── Anwendungsmenü ──────────────────────────────────────────────────────────
function buildMenu() {
    const isMac = process.platform === "darwin";
    const template = [
        // macOS App-Menü
        ...(isMac
            ? [
                {
                    label: electron_1.app.name,
                    submenu: [
                        { role: "about" },
                        { type: "separator" },
                        { role: "services" },
                        { type: "separator" },
                        { role: "hide" },
                        { role: "hideOthers" },
                        { role: "unhide" },
                        { type: "separator" },
                        { role: "quit" },
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
                        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
                            title: "Projekt öffnen",
                            filters: [
                                { name: "Synthstudio Projekt", extensions: ["synth", "json"] },
                                { name: "Alle Dateien", extensions: ["*"] },
                            ],
                            properties: ["openFile"],
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            const filePath = result.filePaths[0];
                            mainWindow?.webContents.send("menu:open-project", filePath);
                            // Zu zuletzt geöffneten Projekten hinzufügen
                            appStore?.addRecentProject(filePath);
                            mainWindow?.webContents.send("store:recent-changed", appStore?.getRecentProjects() ?? []);
                            buildMenu();
                        }
                    },
                },
                // ── Zuletzt geöffnete Projekte ────────────────────────────────────
                {
                    label: "Zuletzt geöffnete Projekte",
                    submenu: buildRecentProjectsSubmenu(),
                },
                { type: "separator" },
                {
                    label: "Projekt speichern",
                    accelerator: "CmdOrCtrl+S",
                    click: () => mainWindow?.webContents.send("menu:save-project"),
                },
                {
                    label: "Projekt speichern unter…",
                    accelerator: "CmdOrCtrl+Shift+S",
                    click: async () => {
                        const result = await electron_1.dialog.showSaveDialog(mainWindow, {
                            title: "Projekt speichern unter",
                            defaultPath: "mein-projekt.synth",
                            filters: [
                                { name: "Synthstudio Projekt", extensions: ["synth"] },
                                { name: "JSON", extensions: ["json"] },
                            ],
                        });
                        if (!result.canceled && result.filePath) {
                            mainWindow?.webContents.send("menu:save-project-as", result.filePath);
                            // Gespeichertes Projekt zu zuletzt geöffneten hinzufügen
                            appStore?.addRecentProject(result.filePath);
                            mainWindow?.webContents.send("store:recent-changed", appStore?.getRecentProjects() ?? []);
                            buildMenu();
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
                isMac ? { role: "close" } : { role: "quit" },
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
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "selectAll" },
            ],
        },
        // ── Ansicht ──────────────────────────────────────────────────────────────
        {
            label: "Ansicht",
            submenu: [
                { role: "reload" },
                { role: "forceReload" },
                ...(isDev ? [{ role: "toggleDevTools" }] : []),
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                {
                    label: "Vollbild",
                    accelerator: "F11",
                    type: "checkbox",
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
                        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
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
                        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
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
                { role: "minimize" },
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
                        { type: "separator" },
                        { role: "front" },
                    ]
                    : [{ role: "close" }]),
            ],
        },
        // ── Hilfe ────────────────────────────────────────────────────────────────
        {
            role: "help",
            submenu: [
                {
                    label: "Synthstudio Dokumentation",
                    click: () => electron_1.shell.openExternal("https://github.com/GeorgDub/Synthstudio"),
                },
                {
                    label: "GitHub Repository",
                    click: () => electron_1.shell.openExternal("https://github.com/GeorgDub/Synthstudio"),
                },
                { type: "separator" },
                {
                    label: `Version ${electron_1.app.getVersion()}`,
                    enabled: false,
                },
                ...(isDev
                    ? []
                    : [
                        {
                            label: "Nach Updates suchen…",
                            click: () => {
                                if (mainWindow) {
                                    (0, updater_1.checkForUpdatesManually)(mainWindow);
                                }
                            },
                        },
                    ]),
            ],
        },
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
// ─── Folder-Import mit Progress und Cancel ───────────────────────────────────
async function startFolderImport(importId, folderPath) {
    importCancelFlags.set(importId, false);
    try {
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
        const samples = [];
        await scanAndImport(folderPath, folderPath, importId, {
            onFile: async (filePath) => {
                if (importCancelFlags.get(importId))
                    return false; // abgebrochen
                try {
                    const stat = await fs.promises.stat(filePath);
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
                }
                catch (err) {
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
        }
        else {
            mainWindow?.webContents.send("samples:import-complete", {
                importId,
                imported,
                errors,
                samples,
                message: `${imported} Samples importiert${errors > 0 ? `, ${errors} Fehler` : ""}.`,
            });
            // Desktop-Benachrichtigung (nur wenn App im Hintergrund)
            if (!mainWindow?.isFocused() && electron_1.Notification.isSupported()) {
                new electron_1.Notification({
                    title: APP_NAME,
                    body: `${imported} Samples erfolgreich importiert.`,
                }).show();
            }
        }
    }
    catch (err) {
        mainWindow?.webContents.send("samples:import-complete", {
            importId,
            imported: 0,
            errors: 1,
            message: `Import fehlgeschlagen: ${String(err)}`,
        });
    }
    finally {
        importCancelFlags.delete(importId);
    }
}
async function scanAndImport(rootPath, currentPath, importId, callbacks) {
    if (importCancelFlags.get(importId))
        return;
    let entries;
    try {
        entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    }
    catch (err) {
        mainWindow?.webContents.send("samples:import-error", {
            importId,
            filePath: currentPath,
            error: `Verzeichnis nicht lesbar: ${String(err)}`,
        });
        return;
    }
    for (const entry of entries) {
        if (importCancelFlags.get(importId))
            return;
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            // Versteckte Ordner überspringen
            if (entry.name.startsWith("."))
                continue;
            await scanAndImport(rootPath, fullPath, importId, callbacks);
        }
        else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            const shouldContinue = await callbacks.onFile(fullPath);
            if (!shouldContinue)
                return;
        }
    }
}
// ─── IPC-Handler ─────────────────────────────────────────────────────────────
function registerIpcHandlers() {
    // ── Dateisystem ─────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle("fs:read-file", async (_event, filePath) => {
        try {
            // Sicherheitscheck: Nur Audio-Dateien erlauben
            const ext = path.extname(filePath).toLowerCase();
            if (!AUDIO_EXTENSIONS.has(ext) && ext !== ".json" && ext !== ".synth") {
                return { success: false, error: "Dateityp nicht erlaubt" };
            }
            const buffer = await fs.promises.readFile(filePath);
            return { success: true, data: buffer.buffer };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    electron_1.ipcMain.handle("fs:list-directory", async (_event, dirPath) => {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
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
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    electron_1.ipcMain.handle("fs:write-file", async (_event, filePath, data) => {
        try {
            // Nur .synth und .json erlauben
            const ext = path.extname(filePath).toLowerCase();
            if (ext !== ".synth" && ext !== ".json") {
                return { success: false, error: "Nur .synth und .json Dateien erlaubt" };
            }
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, data, "utf-8");
            return { success: true };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    // ── Folder-Import ────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle("samples:import-folder", async (_event, folderPath) => {
        const importId = `import_${Date.now()}`;
        // Import asynchron starten (nicht await – Progress-Events kommen über webContents.send)
        startFolderImport(importId, folderPath);
        return { importId };
    });
    electron_1.ipcMain.handle("samples:cancel-import", async (_event, importId) => {
        if (importCancelFlags.has(importId)) {
            importCancelFlags.set(importId, true);
            return { success: true };
        }
        return { success: false, error: "Import-ID nicht gefunden" };
    });
    // ── Dialoge ──────────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle("dialog:open-file", async (_event, options) => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, options);
        return result;
    });
    electron_1.ipcMain.handle("dialog:save-file", async (_event, options) => {
        const result = await electron_1.dialog.showSaveDialog(mainWindow, options);
        return result;
    });
    electron_1.ipcMain.handle("dialog:message", async (_event, options) => {
        const result = await electron_1.dialog.showMessageBox(mainWindow, options);
        return result;
    });
    // ── Fenster-Steuerung ────────────────────────────────────────────────────────
    electron_1.ipcMain.handle("window:set-fullscreen", (_event, fullscreen) => {
        mainWindow?.setFullScreen(fullscreen);
        return { success: true };
    });
    electron_1.ipcMain.handle("window:is-fullscreen", () => {
        return mainWindow?.isFullScreen() ?? false;
    });
    electron_1.ipcMain.handle("window:minimize", () => {
        mainWindow?.minimize();
    });
    electron_1.ipcMain.handle("window:maximize", () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        }
        else {
            mainWindow?.maximize();
        }
    });
    // ── App-Info ─────────────────────────────────────────────────────────────────
    electron_1.ipcMain.handle("app:get-version", () => electron_1.app.getVersion());
    electron_1.ipcMain.handle("app:get-platform", () => process.platform);
    electron_1.ipcMain.handle("app:get-path", (_event, name) => {
        const allowed = ["home", "documents", "downloads", "music", "desktop"];
        if (!allowed.includes(name))
            return null;
        return electron_1.app.getPath(name);
    });
    // ── Benachrichtigungen ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle("notification:show", (_event, title, body) => {
        if (electron_1.Notification.isSupported()) {
            new electron_1.Notification({ title, body }).show();
        }
    });
    // ── Auto-Updater (manueller Check aus dem Renderer) ──────────────────────────
    electron_1.ipcMain.on("updater:check", () => {
        if (mainWindow) {
            (0, updater_1.checkForUpdatesManually)(mainWindow);
        }
    });
}
// ─── Globale Keyboard-Shortcuts ──────────────────────────────────────────────
function registerGlobalShortcuts() {
    // Globale Shortcuts (funktionieren auch wenn App nicht fokussiert)
    // Nur Media-Keys als globale Shortcuts registrieren
    electron_1.globalShortcut.register("MediaPlayPause", () => {
        mainWindow?.webContents.send("shortcut:transport-toggle");
    });
    electron_1.globalShortcut.register("MediaStop", () => {
        mainWindow?.webContents.send("shortcut:transport-stop");
    });
}
// ─── App-Lifecycle ───────────────────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    // AppStore initialisieren (muss vor buildMenu() erfolgen)
    appStore = (0, store_1.initStore)(electron_1.app.getPath("userData"));
    // Basis-IPC-Handler registrieren (kein mainWindow erforderlich)
    registerIpcHandlers();
    (0, waveform_1.registerWaveformHandlers)();
    (0, export_1.registerExportHandlers)();
    (0, windows_1.registerWindowHandlers)(windowManager);
    // Menü aufbauen (nutzt appStore für zuletzt geöffnete Projekte)
    buildMenu();
    // Fenster erstellen – danach ist mainWindow gesetzt
    createWindow();
    // Store-IPC-Handler registrieren (nach createWindow, damit mainWindow gesetzt ist)
    (0, store_1.registerStoreHandlers)(electron_1.ipcMain, mainWindow);
    createTray();
    registerGlobalShortcuts();
    // Drag & Drop für das Hauptfenster einrichten
    if (mainWindow) {
        (0, dragdrop_1.setupDragDrop)(mainWindow);
        // Auto-Updater (nur in Produktion aktiv)
        (0, updater_1.setupAutoUpdater)(mainWindow);
    }
    // macOS: Fenster neu erstellen wenn Dock-Icon geklickt
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
        else {
            mainWindow?.show();
            mainWindow?.focus();
        }
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("will-quit", () => {
    electron_1.globalShortcut.unregisterAll();
});
// Sicherheit: Neue Fenster und Navigation verhindern
electron_1.app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        if (isDev && parsedUrl.origin === new URL(devServerUrl).origin)
            return;
        if (!isDev && navigationUrl.startsWith("file://"))
            return;
        event.preventDefault();
    });
    contents.setWindowOpenHandler(() => {
        return { action: "deny" };
    });
});
// Single-Instance-Lock (verhindert mehrere App-Instanzen)
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
}
