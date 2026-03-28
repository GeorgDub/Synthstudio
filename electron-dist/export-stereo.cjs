"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeWavFileStereo = void 0;
exports.registerStereoExportHandlers = registerStereoExportHandlers;
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
const electron_1 = require("electron");
const wav_writer_1 = require("./wav-writer.cjs");
Object.defineProperty(exports, "writeWavFileStereo", { enumerable: true, get: function () { return wav_writer_1.writeWavFileStereo; } });
// ─── IPC-Handler ─────────────────────────────────────────────────────────────
function registerStereoExportHandlers() {
    electron_1.ipcMain.handle("export:wav-stereo", async (_event, options) => {
        try {
            const win = electron_1.BrowserWindow.getFocusedWindow();
            const result = await electron_1.dialog.showSaveDialog(win, {
                title: "Stereo WAV exportieren",
                defaultPath: options.suggestedName ?? "export-stereo.wav",
                filters: [{ name: "WAV Audio", extensions: ["wav"] }],
            });
            if (result.canceled || !result.filePath) {
                return { success: false, canceled: true };
            }
            (0, wav_writer_1.writeWavFileStereo)(result.filePath, options.leftChannel, options.rightChannel, options.sampleRate, {
                normalize: options.normalize,
                metadata: options.metadata,
            });
            return { success: true, filePath: result.filePath };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
}
