/**
 * Synthstudio – ZIP-Import Handler
 *
 * Verarbeitet den Import von ZIP-Archiven mit Audio-Samples.
 * Extrahiert Audio-Dateien aus dem ZIP, speichert sie temporär und
 * importiert sie wie normale Dateien mit Fortschrittsanzeige.
 *
 * Unterstützte Formate: .wav, .mp3, .ogg, .flac, .aiff, .aif, .m4a
 *
 * INTEGRATION in main.ts:
 * ```ts
 * import { registerZipImportHandlers } from "./zip-import";
 * registerZipImportHandlers(mainWindow);
 * ```
 */

import { ipcMain, BrowserWindow, app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import JSZip from "jszip";

// ─── Konstanten ───────────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);

// ─── Kategorie-Erkennung (identisch mit main.ts) ─────────────────────────────

function detectCategory(filePath: string): string {
  const name = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();
  const combined = `${dir} ${name}`;

  const patterns: Record<string, string[]> = {
    kicks:      ["kick", "bd", "bass drum", "bassdrum", "kik", "808"],
    snares:     ["snare", "sn", "snr", "rimshot", "rim"],
    hihats:     ["hihat", "hi-hat", "hh", "hat", "cymbal", "open hat", "closed hat"],
    claps:      ["clap", "clp", "handclap", "snap"],
    toms:       ["tom", "floor tom", "rack tom"],
    percussion: ["perc", "conga", "bongo", "shaker", "tambourine", "cowbell", "clave"],
    fx:         ["fx", "effect", "noise", "sweep", "riser", "impact", "crash", "zap"],
    loops:      ["loop", "break", "groove", "beat", "phrase"],
    vocals:     ["vocal", "vox", "voice", "choir", "spoken"],
  };

  for (const [category, keywords] of Object.entries(patterns)) {
    if (keywords.some((kw) => combined.includes(kw))) {
      return category;
    }
  }
  return "other";
}

// ─── Temporäres Verzeichnis für extrahierte Samples ──────────────────────────

function getTempDir(): string {
  const tempBase = path.join(app.getPath("temp"), "synthstudio-zip-import");
  if (!fs.existsSync(tempBase)) {
    fs.mkdirSync(tempBase, { recursive: true });
  }
  return tempBase;
}

function cleanTempDir(importId: string): void {
  const dir = path.join(getTempDir(), importId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── ZIP-Import Hauptfunktion ─────────────────────────────────────────────────

export async function importZipFile(
  zipPath: string,
  importId: string,
  win: BrowserWindow
): Promise<void> {
  const tempDir = path.join(getTempDir(), importId);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // ZIP-Datei lesen
    win.webContents.send("samples:import-progress", {
      importId,
      current: 0,
      total: 0,
      percentage: 0,
      phase: "reading",
      currentFile: path.basename(zipPath),
    });

    const zipBuffer = await fs.promises.readFile(zipPath);
    const zip = await JSZip.loadAsync(zipBuffer);

    // Audio-Dateien im ZIP zählen
    const audioFiles: JSZip.JSZipObject[] = [];
    zip.forEach((relativePath, file) => {
      if (file.dir) return;
      const ext = path.extname(relativePath).toLowerCase();
      if (AUDIO_EXTENSIONS.has(ext)) {
        audioFiles.push(file);
      }
    });

    if (audioFiles.length === 0) {
      win.webContents.send("samples:import-complete", {
        importId,
        imported: 0,
        errors: 0,
        message: "Keine Audio-Dateien im ZIP-Archiv gefunden.",
      });
      cleanTempDir(importId);
      return;
    }

    win.webContents.send("samples:import-progress", {
      importId,
      current: 0,
      total: audioFiles.length,
      percentage: 0,
      phase: "extracting",
    });

    // Audio-Dateien extrahieren und importieren
    const samples: Array<{
      id: string;
      name: string;
      path: string;
      category: string;
      size: number;
    }> = [];

    let imported = 0;
    let errors = 0;

    for (const file of audioFiles) {
      try {
        const fileName = path.basename(file.name);
        const extractPath = path.join(tempDir, fileName);

        // Datei aus ZIP extrahieren
        const content = await file.async("nodebuffer");
        await fs.promises.writeFile(extractPath, content);

        const stat = await fs.promises.stat(extractPath);
        const category = detectCategory(file.name);

        samples.push({
          id: `zip_sample_${Date.now()}_${imported}`,
          name: path.basename(fileName, path.extname(fileName)),
          path: extractPath,
          category,
          size: stat.size,
        });

        imported++;

        // Fortschritt senden
        if (imported % 5 === 0 || imported === audioFiles.length) {
          win.webContents.send("samples:import-progress", {
            importId,
            current: imported,
            total: audioFiles.length,
            percentage: Math.round((imported / audioFiles.length) * 100),
            phase: "extracting",
            currentFile: fileName,
          });
        }
      } catch (err) {
        errors++;
        win.webContents.send("samples:import-error", {
          importId,
          filePath: file.name,
          error: String(err),
        });
      }
    }

    win.webContents.send("samples:import-complete", {
      importId,
      imported,
      errors,
      samples,
      message: `${imported} Samples aus ZIP importiert${errors > 0 ? `, ${errors} Fehler` : ""}.`,
    });

  } catch (err) {
    win.webContents.send("samples:import-complete", {
      importId,
      imported: 0,
      errors: 1,
      message: `ZIP-Import fehlgeschlagen: ${String(err)}`,
    });
    cleanTempDir(importId);
  }
}

// ─── IPC-Handler registrieren ─────────────────────────────────────────────────

export function registerZipImportHandlers(win: BrowserWindow): void {
  /**
   * ZIP-Datei importieren: Extrahiert Audio-Samples aus einem ZIP-Archiv
   * und importiert sie wie normale Dateien.
   */
  ipcMain.handle("samples:import-zip", async (_event, zipPath: string) => {
    const importId = `zip_import_${Date.now()}`;
    // Asynchron starten – Fortschritt über IPC-Events
    importZipFile(zipPath, importId, win);
    return { importId };
  });

  /**
   * Temporäre ZIP-Extraktions-Dateien aufräumen (nach dem Import)
   */
  ipcMain.handle("samples:cleanup-zip", async (_event, importId: string) => {
    cleanTempDir(importId);
    return { success: true };
  });
}
