"use strict";
/**
 * Synthstudio – Electron Drag & Drop Handler
 *
 * Verarbeitet Drag & Drop von Dateien und Ordnern direkt ins Electron-Fenster.
 * Unterstützt:
 * - Einzelne Audio-Dateien → direkt auf Drum-Pad laden
 * - Mehrere Audio-Dateien → Sample-Browser Import
 * - Ordner → Folder-Import mit Progress
 * - .esx1 / .json Projekt-Dateien → Projekt öffnen
 *
 * INTEGRATION in main.ts:
 * ```ts
 * import { setupDragDrop } from "./dragdrop";
 * // Nach createWindow():
 * setupDragDrop(mainWindow);
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
exports.setupDragDrop = setupDragDrop;
exports.readAudioFilesFromFolder = readAudioFilesFromFolder;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const AUDIO_EXTENSIONS = new Set([
    ".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a",
]);
const PROJECT_EXTENSIONS = new Set([".esx1", ".json"]);
/**
 * Analysiert eine Liste von gedropten Pfaden und kategorisiert sie.
 */
function analyzePaths(filePaths) {
    const audioFiles = [];
    const folders = [];
    const projectFiles = [];
    const unknown = [];
    for (const filePath of filePaths) {
        try {
            const stat = fs.statSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const name = path.basename(filePath);
            const entry = {
                path: filePath,
                name,
                ext,
                size: stat.size,
                isDirectory: stat.isDirectory(),
                isAudio: AUDIO_EXTENSIONS.has(ext),
                isProject: PROJECT_EXTENSIONS.has(ext),
            };
            if (stat.isDirectory()) {
                folders.push(entry);
            }
            else if (AUDIO_EXTENSIONS.has(ext)) {
                audioFiles.push(entry);
            }
            else if (PROJECT_EXTENSIONS.has(ext)) {
                projectFiles.push(entry);
            }
            else {
                unknown.push(entry);
            }
        }
        catch {
            // Datei nicht lesbar – überspringen
        }
    }
    return { audioFiles, folders, projectFiles, unknown };
}
/**
 * Richtet Drag & Drop für ein BrowserWindow ein.
 * Sendet Events an den Renderer basierend auf dem Typ der gedropten Dateien.
 */
function setupDragDrop(mainWindow) {
    mainWindow.webContents.on("will-navigate", (event) => {
        // Verhindert Navigation durch Drag & Drop von URLs
        event.preventDefault();
    });
    // Electron unterstützt Drag & Drop über den webContents drag-event
    // Die eigentliche Verarbeitung passiert über IPC vom Renderer
    // Der Renderer sendet die Dateipfade nach dem Drop-Event
    // IPC-Handler für Drag & Drop vom Renderer
    const { ipcMain } = require("electron");
    ipcMain.handle("dragdrop:process-files", async (_event, filePaths) => {
        const { audioFiles, folders, projectFiles } = analyzePaths(filePaths);
        const result = {
            audioFiles: audioFiles.map((f) => ({
                path: f.path,
                name: f.name,
                ext: f.ext,
                size: f.size,
            })),
            folders: folders.map((f) => ({
                path: f.path,
                name: f.name,
            })),
            projectFiles: projectFiles.map((f) => ({
                path: f.path,
                name: f.name,
            })),
        };
        // Automatische Aktionen basierend auf Inhalt
        if (projectFiles.length === 1 && audioFiles.length === 0 && folders.length === 0) {
            // Einzelne Projekt-Datei → direkt öffnen
            mainWindow.webContents.send("dragdrop:open-project", projectFiles[0].path);
        }
        else if (audioFiles.length === 1 && folders.length === 0 && projectFiles.length === 0) {
            // Einzelne Audio-Datei → auf aktiven Pad laden
            mainWindow.webContents.send("dragdrop:load-sample", {
                path: audioFiles[0].path,
                name: audioFiles[0].name,
            });
        }
        else if (audioFiles.length > 1 || folders.length > 0) {
            // Mehrere Dateien oder Ordner → Sample-Browser Import
            mainWindow.webContents.send("dragdrop:bulk-import", result);
        }
        return result;
    });
    // Drag-Over-Feedback: Cursor-Typ setzen
    mainWindow.webContents.on("cursor-changed", () => {
        // Wird automatisch durch Electron gehandhabt
    });
}
/**
 * Liest Audio-Dateien aus einem Ordner rekursiv (für Drag & Drop von Ordnern)
 */
async function readAudioFilesFromFolder(folderPath, maxDepth = 5) {
    const results = [];
    async function scan(dirPath, depth) {
        if (depth > maxDepth)
            return;
        let entries;
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith("."))
                continue;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                await scan(fullPath, depth + 1);
            }
            else {
                const ext = path.extname(entry.name).toLowerCase();
                if (AUDIO_EXTENSIONS.has(ext)) {
                    try {
                        const stat = fs.statSync(fullPath);
                        results.push({
                            path: fullPath,
                            name: entry.name,
                            ext,
                            size: stat.size,
                            isDirectory: false,
                            isAudio: true,
                            isProject: false,
                        });
                    }
                    catch {
                        // Datei nicht lesbar
                    }
                }
            }
        }
    }
    await scan(folderPath, 0);
    return results;
}
