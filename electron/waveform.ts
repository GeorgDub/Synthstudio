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

// ─── Waveform-Extraktion ──────────────────────────────────────────────────────

/**
 * Extrahiert Waveform-Peaks aus einer WAV-Datei.
 * Liest nur so viele Bytes wie nötig (max 10 MB für Preview).
 */
function extractWavPeaks(
  buffer: Buffer,
  numPeaks: number
): { peaks: number[]; sampleRate: number; channels: number; bitDepth: number; duration: number } | null {
  const header = parseWavHeader(buffer);
  if (!header) return null;

  const dataChunk = findWavDataChunk(buffer);
  if (!dataChunk) return null;

  const { sampleRate, channels, bitDepth } = header;
  const bytesPerSample = bitDepth / 8;
  const bytesPerFrame = bytesPerSample * channels;

  const dataStart = dataChunk.offset;
  const dataEnd = Math.min(dataStart + dataChunk.size, buffer.length);
  const dataLength = dataEnd - dataStart;

  const totalFrames = Math.floor(dataLength / bytesPerFrame);
  const duration = totalFrames / sampleRate;

  // Frames in numPeaks Blöcke aufteilen
  const framesPerBlock = Math.max(1, Math.floor(totalFrames / numPeaks));
  const peaks: number[] = [];

  for (let i = 0; i < numPeaks; i++) {
    const blockStart = dataStart + i * framesPerBlock * bytesPerFrame;
    if (blockStart >= dataEnd) {
      peaks.push(0);
      continue;
    }

    let maxAbs = 0;

    // Nur ersten Kanal lesen für Performance
    for (let f = 0; f < framesPerBlock; f++) {
      const sampleOffset = blockStart + f * bytesPerFrame;
      if (sampleOffset + bytesPerSample > dataEnd) break;

      let sample = 0;
      if (bitDepth === 16) {
        sample = buffer.readInt16LE(sampleOffset) / 32768;
      } else if (bitDepth === 8) {
        sample = (buffer.readUInt8(sampleOffset) - 128) / 128;
      } else if (bitDepth === 24) {
        // 24-bit: 3 Bytes lesen
        const b0 = buffer.readUInt8(sampleOffset);
        const b1 = buffer.readUInt8(sampleOffset + 1);
        const b2 = buffer.readUInt8(sampleOffset + 2);
        let val = (b2 << 16) | (b1 << 8) | b0;
        if (val >= 0x800000) val -= 0x1000000;
        sample = val / 8388608;
      } else if (bitDepth === 32) {
        sample = buffer.readFloatLE(sampleOffset);
      }

      const abs = Math.abs(sample);
      if (abs > maxAbs) maxAbs = abs;
    }

    peaks.push(Math.min(1, maxAbs));
  }

  return { peaks, sampleRate, channels, bitDepth, duration };
}

/**
 * Schätzt Waveform-Peaks für MP3/OGG/FLAC (ohne vollständige Dekodierung).
 * Gibt gleichmäßige Zufalls-Peaks zurück als Platzhalter.
 * Für echte MP3-Dekodierung wäre node-lame oder ffmpeg nötig.
 */
function estimatePeaksForCompressedAudio(
  fileSize: number,
  numPeaks: number
): { peaks: number[]; duration: number } {
  // Grobe Schätzung: MP3 bei 128kbps ≈ 16 KB/s
  const estimatedDuration = fileSize / (128 * 1024 / 8);

  // Pseudo-zufällige aber konsistente Peaks basierend auf Dateigröße
  const peaks: number[] = [];
  let seed = fileSize;
  for (let i = 0; i < numPeaks; i++) {
    // Einfacher LCG für konsistente Werte
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    const normalized = (seed >>> 0) / 0xffffffff;
    // Wellenform-ähnliche Verteilung
    peaks.push(0.3 + normalized * 0.6);
  }

  return { peaks, duration: estimatedDuration };
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

        if (ext === ".wav" || ext === ".aiff" || ext === ".aif") {
          // WAV: Direkte Analyse (max 50 MB lesen)
          const maxBytes = Math.min(fileSize, 50 * 1024 * 1024);
          const buffer = Buffer.alloc(maxBytes);
          const fd = fs.openSync(filePath, "r");
          fs.readSync(fd, buffer, 0, maxBytes, 0);
          fs.closeSync(fd);

          const result = extractWavPeaks(buffer, numPeaks);
          if (result) {
            return {
              success: true,
              peaks: result.peaks,
              duration: result.duration,
              sampleRate: result.sampleRate,
              channels: result.channels,
              bitDepth: result.bitDepth,
              fileSize,
            };
          }
        }

        // MP3/OGG/FLAC: Schätzung
        const { peaks, duration } = estimatePeaksForCompressedAudio(fileSize, numPeaks);
        return {
          success: true,
          peaks,
          duration,
          fileSize,
        };
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
