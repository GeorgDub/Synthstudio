/**
 * Synthstudio – WAV-Writer (Audio-Engine-Agent / Testing-Agent)
 *
 * Reine Node.js-Funktionen zum Schreiben von WAV-Dateien.
 * KEIN Electron-Import – vollständig testbar mit Vitest/Node.js.
 *
 * Extrahiert aus export-stereo.ts für strikte Trennung von:
 * - Reiner Logik (diese Datei, testbar)
 * - Electron-IPC-Handling (export-stereo.ts, nur in E2E testbar)
 *
 * Exportierte Funktionen:
 * - writeVarLen(value): MIDI Variable-Length-Encoding
 * - normalizeStereo(left, right): In-Place-Normalisierung
 * - buildInfoChunk(metadata): RIFF LIST/INFO-Chunk
 * - writeWavFileStereo(filePath, left, right, sampleRate, options): WAV schreiben
 * - writeWavFileMono(filePath, pcmData, sampleRate): Mono-WAV schreiben
 */
import * as fs from "fs";

// ─── MIDI VarLen-Encoding ─────────────────────────────────────────────────────

/**
 * Kodiert einen Wert als MIDI Variable-Length-Quantity (VarLen).
 * Werte 0–127: 1 Byte, 128–16383: 2 Bytes, usw.
 */
export function writeVarLen(value: number): Buffer {
  const bytes: number[] = [];
  bytes.push(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return Buffer.from(bytes);
}

// ─── Stereo-Normalisierung ────────────────────────────────────────────────────

/**
 * Normalisiert zwei Stereo-Kanäle auf Peak 1.0 (In-Place).
 * Wird nur angewendet wenn Peak < 1.0 (kein Gain-Reduction).
 */
export function normalizeStereo(left: Float32Array, right: Float32Array): void {
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

export interface WavMetadata {
  title?: string;
  artist?: string;
  software?: string;
}

/**
 * Erstellt einen RIFF LIST/INFO-Chunk mit optionalen Metadaten.
 * Enthält immer ISFT (Software) und ICRD (Datum).
 */
export function buildInfoChunk(metadata: WavMetadata): Buffer {
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

export interface StereoWavOptions {
  normalize?: boolean;
  metadata?: WavMetadata;
}

/**
 * Schreibt eine Stereo-WAV-Datei (16-bit PCM, interleaved L/R).
 * Kein Electron-Import – reine Node.js-Funktion.
 */
export function writeWavFileStereo(
  filePath: string,
  leftData: number[],
  rightData: number[],
  sampleRate: number,
  options: StereoWavOptions = {}
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
    const sampleL = Math.max(-1, Math.min(1, left[i]));
    buffer.writeInt16LE(Math.round(sampleL * 32767), offset); offset += 2;
    const sampleR = Math.max(-1, Math.min(1, right[i]));
    buffer.writeInt16LE(Math.round(sampleR * 32767), offset); offset += 2;
  }

  // ── INFO-Chunk anhängen ───────────────────────────────────────────────────
  if (infoChunk) {
    infoChunk.copy(buffer, offset);
  }

  fs.writeFileSync(filePath, buffer);
}

// ─── Mono WAV schreiben ───────────────────────────────────────────────────────

/**
 * Schreibt eine Mono-WAV-Datei (16-bit PCM).
 * Kein Electron-Import – reine Node.js-Funktion.
 */
export function writeWavFileMono(
  filePath: string,
  pcmData: Float32Array | number[],
  sampleRate: number
): void {
  const data = pcmData instanceof Float32Array ? pcmData : new Float32Array(pcmData);
  const numChannels = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = data.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // RIFF-Header
  buffer.write("RIFF", offset); offset += 4;
  buffer.writeUInt32LE(totalSize - 8, offset); offset += 4;
  buffer.write("WAVE", offset); offset += 4;

  // fmt-Chunk
  buffer.write("fmt ", offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;           // PCM
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitDepth, offset); offset += 2;

  // data-Chunk
  buffer.write("data", offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // PCM-Daten: Float32 → Int16
  for (let i = 0; i < data.length; i++) {
    const clamped = Math.max(-1, Math.min(1, data[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }

  fs.writeFileSync(filePath, buffer);
}
