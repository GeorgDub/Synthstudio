/**
 * Synthstudio – Stereo WAV-Export (Audio-Engine-Agent)
 *
 * Erweitert den bestehenden WAV-Export um Stereo-Support.
 * Schreibt korrekt interleaved Stereo-WAV-Dateien mit optionaler Normalisierung
 * und INFO-Metadaten-Chunk.
 *
 * INTEGRATION in export.ts:
 * import { registerStereoExportHandlers } from "./export-stereo";
 * registerStereoExportHandlers();
 */
import { ipcMain, dialog, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";

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

// ─── Normalisierung ───────────────────────────────────────────────────────────

function normalizeStereo(left: Float32Array, right: Float32Array): void {
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const absL = Math.abs(left[i]);
    const absR = Math.abs(right[i]);
    if (absL > peak) peak = absL;
    if (absR > peak) peak = absR;
  }
  if (peak > 0 && peak < 1) {
    const gain = 1 / peak;
    for (let i = 0; i < left.length; i++) {
      left[i] *= gain;
      right[i] *= gain;
    }
  }
}

// ─── INFO-Chunk ───────────────────────────────────────────────────────────────

function buildInfoChunk(metadata: { title?: string; artist?: string; software?: string }): Buffer {
  const fields: Array<{ id: string; value: string }> = [];

  if (metadata.title) fields.push({ id: "INAM", value: metadata.title });
  if (metadata.artist) fields.push({ id: "IART", value: metadata.artist });
  fields.push({ id: "ISFT", value: metadata.software ?? "Synthstudio" });
  fields.push({ id: "ICRD", value: new Date().toISOString().slice(0, 10) });

  // Gesamtgröße berechnen
  let totalSize = 4; // 'INFO'
  for (const f of fields) {
    const valueLen = f.value.length + 1; // +1 für Null-Terminator
    const paddedLen = valueLen % 2 !== 0 ? valueLen + 1 : valueLen;
    totalSize += 8 + paddedLen; // 4 (ID) + 4 (Größe) + Wert
  }

  const buf = Buffer.alloc(8 + totalSize);
  let offset = 0;

  buf.write("LIST", offset); offset += 4;
  buf.writeUInt32LE(totalSize, offset); offset += 4;
  buf.write("INFO", offset); offset += 4;

  for (const f of fields) {
    const valueLen = f.value.length + 1;
    const paddedLen = valueLen % 2 !== 0 ? valueLen + 1 : valueLen;
    buf.write(f.id, offset); offset += 4;
    buf.writeUInt32LE(valueLen, offset); offset += 4;
    buf.write(f.value + "\0", offset, "ascii"); offset += paddedLen;
  }

  return buf;
}

// ─── Stereo WAV schreiben ─────────────────────────────────────────────────────

export function writeWavFileStereo(
  filePath: string,
  leftData: number[],
  rightData: number[],
  sampleRate: number,
  options: { normalize?: boolean; metadata?: { title?: string; artist?: string; software?: string } } = {}
): void {
  const left = new Float32Array(leftData);
  const right = new Float32Array(rightData.length > 0 ? rightData : leftData);

  // Längen angleichen
  const length = Math.min(left.length, right.length);

  // Optional normalisieren
  if (options.normalize) {
    normalizeStereo(left, right);
  }

  const numChannels = 2;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * numChannels * bytesPerSample;

  // INFO-Chunk optional
  const infoChunk = options.metadata ? buildInfoChunk(options.metadata) : null;
  const infoSize = infoChunk ? infoChunk.length : 0;

  const headerSize = 44;
  const totalSize = headerSize + dataSize + infoSize;

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // ── RIFF-Header ───────────────────────────────────────────────────────────
  buffer.write("RIFF", offset); offset += 4;
  buffer.writeUInt32LE(totalSize - 8, offset); offset += 4;
  buffer.write("WAVE", offset); offset += 4;

  // ── fmt-Chunk ─────────────────────────────────────────────────────────────
  buffer.write("fmt ", offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;          // Chunk-Größe
  buffer.writeUInt16LE(1, offset); offset += 2;           // PCM = 1
  buffer.writeUInt16LE(numChannels, offset); offset += 2; // 2 Kanäle
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitDepth, offset); offset += 2;

  // ── data-Chunk ────────────────────────────────────────────────────────────
  buffer.write("data", offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // ── PCM-Daten (interleaved L/R) ───────────────────────────────────────────
  for (let i = 0; i < length; i++) {
    // Links
    const sampleL = Math.max(-1, Math.min(1, left[i]));
    buffer.writeInt16LE(Math.round(sampleL * 32767), offset); offset += 2;
    // Rechts
    const sampleR = Math.max(-1, Math.min(1, right[i]));
    buffer.writeInt16LE(Math.round(sampleR * 32767), offset); offset += 2;
  }

  // ── INFO-Chunk anhängen ───────────────────────────────────────────────────
  if (infoChunk) {
    infoChunk.copy(buffer, offset);
  }

  fs.writeFileSync(filePath, buffer);
}

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
