/**
 * Synthstudio – Electron Drag & Drop Handler
 *
 * Verarbeitet Drag & Drop von Dateien und Ordnern direkt ins Electron-Fenster.
 * Unterstützt:
 * - Einzelne Audio-Dateien → direkt auf Drum-Pad laden
 * - Mehrere Audio-Dateien → Sample-Browser Import
 * - Ordner → Folder-Import mit Progress
 * - .synth / .json Projekt-Dateien → Projekt öffnen
 *
 * INTEGRATION in main.ts:
 * ```ts
 * import { setupDragDrop } from "./dragdrop";
 * // Nach createWindow():
 * setupDragDrop(mainWindow);
 * ```
 */

import { BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";

const AUDIO_EXTENSIONS = new Set([
  ".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a",
]);

const PROJECT_EXTENSIONS = new Set([".synth", ".json"]);

export interface DragDropFile {
  path: string;
  name: string;
  ext: string;
  size: number;
  isDirectory: boolean;
  isAudio: boolean;
  isProject: boolean;
}

/**
 * Analysiert eine Liste von gedropten Pfaden und kategorisiert sie.
 */
function analyzePaths(filePaths: string[]): {
  audioFiles: DragDropFile[];
  folders: DragDropFile[];
  projectFiles: DragDropFile[];
  unknown: DragDropFile[];
} {
  const audioFiles: DragDropFile[] = [];
  const folders: DragDropFile[] = [];
  const projectFiles: DragDropFile[] = [];
  const unknown: DragDropFile[] = [];

  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const name = path.basename(filePath);

      const entry: DragDropFile = {
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
      } else if (AUDIO_EXTENSIONS.has(ext)) {
        audioFiles.push(entry);
      } else if (PROJECT_EXTENSIONS.has(ext)) {
        projectFiles.push(entry);
      } else {
        unknown.push(entry);
      }
    } catch {
      // Datei nicht lesbar – überspringen
    }
  }

  return { audioFiles, folders, projectFiles, unknown };
}

/**
 * Richtet Drag & Drop für ein BrowserWindow ein.
 * Sendet Events an den Renderer basierend auf dem Typ der gedropten Dateien.
 */
export function setupDragDrop(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on("will-navigate", (event) => {
    // Verhindert Navigation durch Drag & Drop von URLs
    event.preventDefault();
  });

  // Electron unterstützt Drag & Drop über den webContents drag-event
  // Die eigentliche Verarbeitung passiert über IPC vom Renderer
  // Der Renderer sendet die Dateipfade nach dem Drop-Event

  // IPC-Handler für Drag & Drop vom Renderer
  const { ipcMain } = require("electron");

  ipcMain.handle("dragdrop:process-files", async (_event: any, filePaths: string[]) => {
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
    } else if (audioFiles.length === 1 && folders.length === 0 && projectFiles.length === 0) {
      // Einzelne Audio-Datei → auf aktiven Pad laden
      mainWindow.webContents.send("dragdrop:load-sample", {
        path: audioFiles[0].path,
        name: audioFiles[0].name,
      });
    } else if (audioFiles.length > 1 || folders.length > 0) {
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
export async function readAudioFilesFromFolder(
  folderPath: string,
  maxDepth = 5
): Promise<DragDropFile[]> {
  const results: DragDropFile[] = [];

  async function scan(dirPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      } else {
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
          } catch {
            // Datei nicht lesbar
          }
        }
      }
    }
  }

  await scan(folderPath, 0);
  return results;
}
