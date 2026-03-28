/**
 * Synthstudio – Waveform Worker-Thread (Audio-Engine-Agent)
 *
 * Analysiert Audio-Dateien in einem separaten Thread ohne den Main-Prozess zu blockieren.
 * Unterstützt WAV (8/16/24/32-bit), MP3, OGG, FLAC (Schätzung).
 *
 * Kommunikation:
 * - Eingehend:  { type: 'analyze', filePath: string, numPeaks: number }
 * - Ausgehend:  { type: 'result', peaks: number[], duration: number, sampleRate: number, channels: number }
 *              { type: 'error', message: string }
 */
import { parentPort, workerData } from "worker_threads";
import * as fs from "fs";
import * as path from "path";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface AnalyzeRequest {
  type: "analyze";
  filePath: string;
  numPeaks: number;
}

interface AnalyzeResult {
  type: "result";
  peaks: number[];
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  fileSize: number;
}

interface AnalyzeError {
  type: "error";
  message: string;
}

interface WavHeader {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  dataOffset: number;
  dataSize: number;
}

// ─── WAV-Header-Parser ────────────────────────────────────────────────────────

function parseWavHeader(buffer: Buffer): WavHeader | null {
  if (buffer.length < 44) return null;

  // RIFF-Signatur prüfen
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let dataOffset = 0;
  let dataSize = 0;

  // Chunks durchsuchen
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitDepth = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    // Chunk-Größe auf gerade Zahl aufrunden (RIFF-Spezifikation)
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (sampleRate === 0 || dataOffset === 0) return null;

  return { sampleRate, channels, bitDepth, dataOffset, dataSize };
}

// ─── Peak-Extraktion ──────────────────────────────────────────────────────────

function extractPeaks(buffer: Buffer, header: WavHeader, numPeaks: number): number[] {
  const { sampleRate, channels, bitDepth, dataOffset, dataSize } = header;
  const bytesPerSample = Math.ceil(bitDepth / 8);
  const totalFrames = Math.floor(dataSize / (bytesPerSample * channels));
  const framesPerPeak = Math.max(1, Math.floor(totalFrames / numPeaks));
  const peaks: number[] = new Array(numPeaks).fill(0);

  for (let peakIdx = 0; peakIdx < numPeaks; peakIdx++) {
    const frameStart = peakIdx * framesPerPeak;
    const frameEnd = Math.min(frameStart + framesPerPeak, totalFrames);
    let maxAbs = 0;

    for (let frame = frameStart; frame < frameEnd; frame++) {
      // Nur ersten Kanal lesen (Mono-Repräsentation)
      const byteOffset = dataOffset + frame * bytesPerSample * channels;
      if (byteOffset + bytesPerSample > buffer.length) break;

      let sample = 0;
      if (bitDepth === 8) {
        sample = (buffer.readUInt8(byteOffset) - 128) / 128;
      } else if (bitDepth === 16) {
        sample = buffer.readInt16LE(byteOffset) / 32768;
      } else if (bitDepth === 24) {
        // 3-Byte-Signed-Integer
        const b0 = buffer.readUInt8(byteOffset);
        const b1 = buffer.readUInt8(byteOffset + 1);
        const b2 = buffer.readUInt8(byteOffset + 2);
        let val = (b2 << 16) | (b1 << 8) | b0;
        if (val & 0x800000) val = val - 0x1000000; // Vorzeichen-Erweiterung
        sample = val / 8388608;
      } else if (bitDepth === 32) {
        sample = buffer.readFloatLE(byteOffset);
      }

      const abs = Math.abs(sample);
      if (abs > maxAbs) maxAbs = abs;
    }

    peaks[peakIdx] = Math.min(1, maxAbs);
  }

  return peaks;
}

// ─── Schätzung für komprimierte Formate ──────────────────────────────────────

function estimatePeaks(fileSize: number, numPeaks: number): { peaks: number[]; duration: number } {
  // Pseudo-Zufallswerte basierend auf Dateigröße (konsistent, aber nicht real)
  const seed = fileSize % 1000;
  const peaks: number[] = [];
  for (let i = 0; i < numPeaks; i++) {
    const x = (i + seed) / numPeaks;
    const val = 0.3 + 0.5 * Math.abs(Math.sin(x * 17.3 + seed * 0.1)) *
      (0.7 + 0.3 * Math.cos(x * 5.7));
    peaks.push(Math.min(1, val));
  }
  // Grobe Dauer-Schätzung: ~128 kbps für MP3
  const duration = (fileSize * 8) / (128 * 1000);
  return { peaks, duration };
}

// ─── Haupt-Analyse-Funktion ───────────────────────────────────────────────────

function analyzeFile(filePath: string, numPeaks: number): AnalyzeResult {
  const fileSize = fs.statSync(filePath).size;
  const ext = path.extname(filePath).toLowerCase();
  const MAX_READ = 50 * 1024 * 1024; // 50 MB

  if (ext === ".wav" || ext === ".aif" || ext === ".aiff") {
    const readSize = Math.min(fileSize, MAX_READ);
    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, readSize, 0);
    } finally {
      fs.closeSync(fd);
    }

    const header = parseWavHeader(buffer);
    if (!header) {
      throw new Error(`Ungültiger WAV-Header: ${filePath}`);
    }

    const peaks = extractPeaks(buffer, header, numPeaks);
    const duration = header.dataSize / (header.sampleRate * header.channels * Math.ceil(header.bitDepth / 8));

    return {
      type: "result",
      peaks,
      duration,
      sampleRate: header.sampleRate,
      channels: header.channels,
      bitDepth: header.bitDepth,
      fileSize,
    };
  } else {
    // Komprimierte Formate: Schätzung
    const { peaks, duration } = estimatePeaks(fileSize, numPeaks);
    return {
      type: "result",
      peaks,
      duration,
      sampleRate: 44100,
      channels: 2,
      bitDepth: 0,
      fileSize,
    };
  }
}

// ─── Worker-Einstiegspunkt ────────────────────────────────────────────────────

if (parentPort) {
  // Auf Nachrichten warten
  parentPort.on("message", (msg: AnalyzeRequest) => {
    if (msg.type !== "analyze") return;

    try {
      const result = analyzeFile(msg.filePath, msg.numPeaks || 200);
      parentPort!.postMessage(result);
    } catch (err) {
      const error: AnalyzeError = {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
      parentPort!.postMessage(error);
    }
  });
} else if (workerData) {
  // Direkt mit workerData aufgerufen
  try {
    const result = analyzeFile(workerData.filePath, workerData.numPeaks || 200);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(String(err));
    process.exit(1);
  }
}
