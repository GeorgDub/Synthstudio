"use strict";
/**
 * Synthstudio – Electron Waveform-Preview
 *
 * Liest Audio-Dateien vom lokalen Dateisystem und gibt Waveform-Daten
 * zurück die der Renderer für die Visualisierung nutzen kann.
 *
 * Vorteile gegenüber Browser-Implementierung:
 * - Kein Base64-Encoding nötig (direkter Dateizugriff)
 * - Kein CORS-Problem
 * - Schneller für große Dateien
 * - Funktioniert auch ohne AudioContext (reines Byte-Lesen)
 *
 * INTEGRATION in main.ts:
 * ```ts
 * import { registerWaveformHandlers } from "./waveform";
 * registerWaveformHandlers();
 * ```
 *
 * VERWENDUNG im Renderer:
 * ```ts
 * const waveform = await window.electronAPI.getWaveformData(filePath, 200);
 * // waveform.peaks: Float32Array mit 200 Werten zwischen -1 und 1
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
exports.registerWaveformHandlers = registerWaveformHandlers;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const worker_threads_1 = require("worker_threads");
const waveform_cache_1 = require("./waveform-cache.cjs");
function parseWavHeader(buffer) {
    try {
        // RIFF-Header prüfen
        if (buffer.toString("ascii", 0, 4) !== "RIFF")
            return null;
        if (buffer.toString("ascii", 8, 12) !== "WAVE")
            return null;
        let offset = 12;
        // Chunks durchsuchen
        while (offset < buffer.length - 8) {
            const chunkId = buffer.toString("ascii", offset, offset + 4);
            const chunkSize = buffer.readUInt32LE(offset + 4);
            if (chunkId === "fmt ") {
                const channels = buffer.readUInt16LE(offset + 10);
                const sampleRate = buffer.readUInt32LE(offset + 12);
                const bitDepth = buffer.readUInt16LE(offset + 22);
                return {
                    sampleRate,
                    channels,
                    bitDepth,
                    dataOffset: 0, // wird beim "data" Chunk gesetzt
                    dataSize: 0,
                };
            }
            offset += 8 + chunkSize;
        }
        return null;
    }
    catch {
        return null;
    }
}
function findWavDataChunk(buffer) {
    let offset = 12;
    while (offset < buffer.length - 8) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (chunkId === "data") {
            return { offset: offset + 8, size: chunkSize };
        }
        offset += 8 + chunkSize;
    }
    return null;
}
// ─── Worker-Integration ───────────────────────────────────────────────────────
function analyzeWithWorker(filePath, numPeaks) {
    return new Promise((resolve) => {
        const workerPath = path.join(__dirname, "workers", "waveform.worker.js");
        // Fallback falls die kompilierte JS-Datei nicht existiert (z.B. in Dev-Umgebung mit ts-node)
        const actualWorkerPath = fs.existsSync(workerPath)
            ? workerPath
            : path.join(__dirname, "workers", "waveform.worker.ts");
        const worker = new worker_threads_1.Worker(actualWorkerPath, {
            // Wenn es eine TS-Datei ist, ts-node/register verwenden
            execArgv: actualWorkerPath.endsWith('.ts') ? ['-r', 'ts-node/register'] : undefined
        });
        worker.on("message", (msg) => {
            if (msg.type === "result") {
                resolve({
                    success: true,
                    peaks: msg.peaks,
                    duration: msg.duration,
                    sampleRate: msg.sampleRate,
                    channels: msg.channels,
                    bitDepth: msg.bitDepth,
                    fileSize: msg.fileSize,
                });
            }
            else if (msg.type === "error") {
                resolve({ success: false, error: msg.message });
            }
            worker.terminate();
        });
        worker.on("error", (err) => {
            resolve({ success: false, error: String(err) });
            worker.terminate();
        });
        worker.on("exit", (code) => {
            if (code !== 0) {
                resolve({ success: false, error: `Worker stopped with exit code ${code}` });
            }
        });
        worker.postMessage({ type: "analyze", filePath, numPeaks });
    });
}
// ─── IPC-Handler ─────────────────────────────────────────────────────────────
function registerWaveformHandlers() {
    /**
     * Waveform-Daten für eine Audio-Datei abrufen.
     * numPeaks: Anzahl der Datenpunkte (Standard: 200)
     */
    electron_1.ipcMain.handle("waveform:get-peaks", async (_event, filePath, numPeaks = 200) => {
        try {
            const stat = fs.statSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const fileSize = stat.size;
            // Sicherheitscheck
            const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);
            if (!AUDIO_EXTENSIONS.has(ext)) {
                return { success: false, error: "Kein Audio-Dateiformat" };
            }
            // Cache prüfen
            const cacheKey = `${filePath}_${numPeaks}`;
            const cached = waveform_cache_1.waveformCache.get(cacheKey);
            // Wenn Datei sich geändert hat, Cache invalidieren
            if (cached && cached.fileSize === fileSize) {
                return {
                    success: true,
                    peaks: cached.peaks,
                    duration: cached.duration,
                    sampleRate: cached.sampleRate,
                    channels: cached.channels,
                    bitDepth: cached.bitDepth,
                    fileSize: cached.fileSize,
                };
            }
            // Analyse im Worker-Thread durchführen
            const result = await analyzeWithWorker(filePath, numPeaks);
            // Bei Erfolg im Cache speichern
            if (result.success && result.peaks) {
                waveform_cache_1.waveformCache.set(cacheKey, {
                    peaks: result.peaks,
                    duration: result.duration || 0,
                    sampleRate: result.sampleRate || 0,
                    channels: result.channels || 0,
                    bitDepth: result.bitDepth || 0,
                    fileSize: fileSize,
                });
            }
            return result;
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    /**
     * Audio-Datei-Metadaten (ohne Waveform-Daten)
     */
    electron_1.ipcMain.handle("waveform:get-metadata", async (_event, filePath) => {
        try {
            const stat = fs.statSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            if (ext === ".wav") {
                const headerBuffer = Buffer.alloc(Math.min(1024, stat.size));
                const fd = fs.openSync(filePath, "r");
                fs.readSync(fd, headerBuffer, 0, headerBuffer.length, 0);
                fs.closeSync(fd);
                const header = parseWavHeader(headerBuffer);
                const dataChunk = findWavDataChunk(headerBuffer);
                if (header && dataChunk) {
                    const bytesPerFrame = (header.bitDepth / 8) * header.channels;
                    const totalFrames = dataChunk.size / bytesPerFrame;
                    const duration = totalFrames / header.sampleRate;
                    return {
                        success: true,
                        sampleRate: header.sampleRate,
                        channels: header.channels,
                        bitDepth: header.bitDepth,
                        duration,
                        fileSize: stat.size,
                        format: "WAV",
                    };
                }
            }
            return {
                success: true,
                fileSize: stat.size,
                format: ext.toUpperCase().replace(".", ""),
                duration: null,
            };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
}
