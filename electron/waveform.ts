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

import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import { Worker } from "worker_threads";
import { waveformCache } from "./waveform-cache";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface WaveformResult {
  success: boolean;
  peaks?: number[];       // Normalisierte Peaks zwischen -1 und 1
  duration?: number;      // Geschätzte Dauer in Sekunden (aus Dateigröße)
  sampleRate?: number;    // Sample-Rate aus WAV-Header
  channels?: number;      // Anzahl Kanäle
  bitDepth?: number;      // Bit-Tiefe (8, 16, 24, 32)
  fileSize?: number;      // Dateigröße in Bytes
  error?: string;
}

// ─── WAV-Header Parser ────────────────────────────────────────────────────────

interface WavHeader {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  dataOffset: number;
  dataSize: number;
}

function parseWavHeader(buffer: Buffer): WavHeader | null {
  try {
    // RIFF-Header prüfen
    if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
    if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;

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
  } catch {
    return null;
  }
}

function findWavDataChunk(buffer: Buffer): { offset: number; size: number } | null {
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

function analyzeWithWorker(filePath: string, numPeaks: number): Promise<WaveformResult> {
  return new Promise((resolve) => {
    const workerPath = path.join(__dirname, "workers", "waveform.worker.js");
    
    // Fallback falls die kompilierte JS-Datei nicht existiert (z.B. in Dev-Umgebung mit ts-node)
    const actualWorkerPath = fs.existsSync(workerPath) 
      ? workerPath 
      : path.join(__dirname, "workers", "waveform.worker.ts");

    const worker = new Worker(actualWorkerPath, {
      // Wenn es eine TS-Datei ist, ts-node/register verwenden
      execArgv: actualWorkerPath.endsWith('.ts') ? ['-r', 'ts-node/register'] : undefined
    });

    worker.on("message", (msg: any) => {
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
      } else if (msg.type === "error") {
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

export function registerWaveformHandlers(): void {
  /**
   * Waveform-Daten für eine Audio-Datei abrufen.
   * numPeaks: Anzahl der Datenpunkte (Standard: 200)
   */
  ipcMain.handle(
    "waveform:get-peaks",
    async (_event, filePath: string, numPeaks = 200): Promise<WaveformResult> => {
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
        const cached = waveformCache.get(cacheKey);
        
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
          waveformCache.set(cacheKey, {
            peaks: result.peaks,
            duration: result.duration || 0,
            sampleRate: result.sampleRate || 0,
            channels: result.channels || 0,
            bitDepth: result.bitDepth || 0,
            fileSize: fileSize,
          });
        }

        return result;
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  );

  /**
   * Audio-Datei-Metadaten (ohne Waveform-Daten)
   */
  ipcMain.handle("waveform:get-metadata", async (_event, filePath: string) => {
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
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
