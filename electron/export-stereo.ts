/**
 * Synthstudio – Stereo WAV-Export IPC-Handler (Audio-Engine-Agent)
 *
 * Registriert den IPC-Kanal "export:wav-stereo" für den Electron-Main-Prozess.
 * Die reine WAV-Schreib-Logik ist in wav-writer.ts ausgelagert (testbar ohne Electron).
 *
 * INTEGRATION in export.ts:
 * ```ts
 * import { registerStereoExportHandlers } from "./export-stereo";
 * registerStereoExportHandlers();
 * ```
 */
import { ipcMain, dialog, BrowserWindow } from "electron";
import * as path from "path";
import { writeWavFileStereo } from "./wav-writer";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface StereoExportOptions {
  leftChannel: number[];
  rightChannel: number[];
  sampleRate: number;
  normalize?: boolean;
  metadata?: {
    title?: string;
    artist?: string;
    software?: string;
  };
  suggestedName?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

// Re-export für Kompatibilität mit export.ts
export { writeWavFileStereo };

// ─── IPC-Handler ─────────────────────────────────────────────────────────────

export function registerStereoExportHandlers(): void {
  ipcMain.handle("export:wav-stereo", async (_event, options: StereoExportOptions) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        title: "Stereo WAV exportieren",
        defaultPath: options.suggestedName ?? "export-stereo.wav",
        filters: [{ name: "WAV Audio", extensions: ["wav"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      writeWavFileStereo(
        result.filePath,
        options.leftChannel,
        options.rightChannel,
        options.sampleRate,
        {
          normalize: options.normalize,
          metadata: options.metadata,
        }
      );

      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
