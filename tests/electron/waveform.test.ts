/**
 * Synthstudio – Waveform-Analyse Unit-Tests (Testing-Agent)
 *
 * Testet die WAV-Header-Parsing- und Peak-Extraktions-Logik
 * ohne Electron-Abhängigkeiten (reine Node.js-Logik).
 *
 * Ausführen: pnpm vitest tests/electron/waveform.test.ts
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── Test-Hilfsfunktionen ─────────────────────────────────────────────────────

interface WavOptions {
  sampleRate: number;
  channels: number;
  bitDepth: 8 | 16 | 24 | 32;
  numSamples: number;
  /** Optional: Füllt den Data-Chunk mit Sinus-Wellen */
  fillSine?: boolean;
}

/**
 * Erstellt einen gültigen WAV-Buffer für Tests.
 * Unterstützt 8, 16, 24 und 32-bit PCM.
 */
function createTestWavBuffer(opts: WavOptions): Buffer {
  const { sampleRate, channels, bitDepth, numSamples, fillSine = false } = opts;
  const bytesPerSample = Math.ceil(bitDepth / 8);
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * channels * bytesPerSample;
  const totalSize = 44 + dataSize;

  const buf = Buffer.alloc(totalSize, 0);
  let offset = 0;

  // RIFF-Header
  buf.write("RIFF", offset); offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset); offset += 4;
  buf.write("WAVE", offset); offset += 4;

  // fmt-Chunk
  buf.write("fmt ", offset); offset += 4;
  buf.writeUInt32LE(16, offset); offset += 4;
  buf.writeUInt16LE(1, offset); offset += 2;           // PCM
  buf.writeUInt16LE(channels, offset); offset += 2;
  buf.writeUInt32LE(sampleRate, offset); offset += 4;
  buf.writeUInt32LE(byteRate, offset); offset += 4;
  buf.writeUInt16LE(blockAlign, offset); offset += 2;
  buf.writeUInt16LE(bitDepth, offset); offset += 2;

  // data-Chunk
  buf.write("data", offset); offset += 4;
  buf.writeUInt32LE(dataSize, offset); offset += 4;

  // PCM-Daten füllen
  if (fillSine) {
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.sin((i / numSamples) * Math.PI * 2 * 10); // 10 Zyklen
      for (let ch = 0; ch < channels; ch++) {
        if (bitDepth === 8) {
          buf.writeUInt8(Math.round((sample + 1) * 127.5), offset);
          offset += 1;
        } else if (bitDepth === 16) {
          buf.writeInt16LE(Math.round(sample * 32767), offset);
          offset += 2;
        } else if (bitDepth === 24) {
          const val = Math.round(sample * 8388607);
          buf.writeUInt8(val & 0xff, offset);
          buf.writeUInt8((val >> 8) & 0xff, offset + 1);
          buf.writeUInt8((val >> 16) & 0xff, offset + 2);
          offset += 3;
        } else if (bitDepth === 32) {
          buf.writeFloatLE(sample, offset);
          offset += 4;
        }
      }
    }
  }

  return buf;
}

// ─── WAV-Header-Parser (aus waveform.ts extrahiert für Tests) ─────────────────

interface WavHeader {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  dataOffset: number;
  dataSize: number;
}

function parseWavHeader(buffer: Buffer): WavHeader | null {
  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let sampleRate = 0, channels = 0, bitDepth = 0, dataOffset = 0, dataSize = 0;

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
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (sampleRate === 0 || dataOffset === 0) return null;
  return { sampleRate, channels, bitDepth, dataOffset, dataSize };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WAV-Header-Parser", () => {
  describe("44100 Hz Mono 16-bit", () => {
    let buffer: Buffer;
    beforeEach(() => {
      buffer = createTestWavBuffer({ sampleRate: 44100, channels: 1, bitDepth: 16, numSamples: 1000 });
    });

    it("erkennt RIFF-Signatur", () => {
      expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
    });

    it("erkennt WAVE-Format", () => {
      expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");
    });

    it("parst Sample-Rate korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.sampleRate).toBe(44100);
    });

    it("parst Kanal-Anzahl korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.channels).toBe(1);
    });

    it("parst Bit-Tiefe korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.bitDepth).toBe(16);
    });

    it("berechnet data-Offset korrekt (44 Bytes)", () => {
      const header = parseWavHeader(buffer);
      expect(header?.dataOffset).toBe(44);
    });

    it("berechnet data-Größe korrekt (1000 Samples × 1 Kanal × 2 Bytes)", () => {
      const header = parseWavHeader(buffer);
      expect(header?.dataSize).toBe(1000 * 1 * 2);
    });
  });

  describe("48000 Hz Stereo 24-bit", () => {
    let buffer: Buffer;
    beforeEach(() => {
      buffer = createTestWavBuffer({ sampleRate: 48000, channels: 2, bitDepth: 24, numSamples: 500 });
    });

    it("parst Sample-Rate 48000 korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.sampleRate).toBe(48000);
    });

    it("parst 2 Kanäle korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.channels).toBe(2);
    });

    it("parst 24-bit korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.bitDepth).toBe(24);
    });

    it("berechnet data-Größe korrekt (500 × 2 × 3)", () => {
      const header = parseWavHeader(buffer);
      expect(header?.dataSize).toBe(500 * 2 * 3);
    });
  });

  describe("96000 Hz Stereo 32-bit Float", () => {
    let buffer: Buffer;
    beforeEach(() => {
      buffer = createTestWavBuffer({ sampleRate: 96000, channels: 2, bitDepth: 32, numSamples: 200 });
    });

    it("parst Sample-Rate 96000 korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.sampleRate).toBe(96000);
    });

    it("parst 32-bit korrekt", () => {
      const header = parseWavHeader(buffer);
      expect(header?.bitDepth).toBe(32);
    });
  });

  describe("Fehlerbehandlung", () => {
    it("gibt null zurück für leeren Buffer", () => {
      expect(parseWavHeader(Buffer.alloc(0))).toBeNull();
    });

    it("gibt null zurück für zu kleinen Buffer (< 44 Bytes)", () => {
      expect(parseWavHeader(Buffer.alloc(20))).toBeNull();
    });

    it("gibt null zurück wenn RIFF-Signatur fehlt", () => {
      const buf = createTestWavBuffer({ sampleRate: 44100, channels: 1, bitDepth: 16, numSamples: 100 });
      buf.write("XXXX", 0); // RIFF überschreiben
      expect(parseWavHeader(buf)).toBeNull();
    });

    it("gibt null zurück wenn WAVE-Signatur fehlt", () => {
      const buf = createTestWavBuffer({ sampleRate: 44100, channels: 1, bitDepth: 16, numSamples: 100 });
      buf.write("XXXX", 8); // WAVE überschreiben
      expect(parseWavHeader(buf)).toBeNull();
    });

    it("gibt null zurück für Buffer mit nur Nullen (44 Bytes)", () => {
      expect(parseWavHeader(Buffer.alloc(44, 0))).toBeNull();
    });
  });

  describe("Peak-Extraktion – Sinus-Welle", () => {
    it("Sinus-Welle 16-bit: maximaler Peak ≈ 1.0", () => {
      const buffer = createTestWavBuffer({
        sampleRate: 44100, channels: 1, bitDepth: 16,
        numSamples: 4410, fillSine: true,
      });
      const header = parseWavHeader(buffer)!;
      expect(header).not.toBeNull();

      // Manuell Peaks berechnen
      let maxPeak = 0;
      for (let i = 0; i < 4410; i++) {
        const byteOffset = header.dataOffset + i * 2;
        const sample = Math.abs(buffer.readInt16LE(byteOffset) / 32768);
        if (sample > maxPeak) maxPeak = sample;
      }
      // Sinus-Welle sollte Peak nahe 1.0 haben
      expect(maxPeak).toBeGreaterThan(0.99);
    });

    it("Stille (Nullen): Peak = 0", () => {
      const buffer = createTestWavBuffer({
        sampleRate: 44100, channels: 1, bitDepth: 16,
        numSamples: 1000, fillSine: false, // Keine Füllung = Stille
      });
      const header = parseWavHeader(buffer)!;
      let maxPeak = 0;
      for (let i = 0; i < 1000; i++) {
        const byteOffset = header.dataOffset + i * 2;
        const sample = Math.abs(buffer.readInt16LE(byteOffset) / 32768);
        if (sample > maxPeak) maxPeak = sample;
      }
      expect(maxPeak).toBe(0);
    });
  });
});

describe("createTestWavBuffer Hilfsfunktion", () => {
  it("erstellt Buffer mit korrekter Gesamtgröße (44 + dataSize)", () => {
    const buf = createTestWavBuffer({ sampleRate: 44100, channels: 1, bitDepth: 16, numSamples: 100 });
    expect(buf.length).toBe(44 + 100 * 1 * 2);
  });

  it("Stereo 16-bit: Größe = 44 + numSamples × 2 × 2", () => {
    const buf = createTestWavBuffer({ sampleRate: 44100, channels: 2, bitDepth: 16, numSamples: 100 });
    expect(buf.length).toBe(44 + 100 * 2 * 2);
  });

  it("24-bit: Größe = 44 + numSamples × 3", () => {
    const buf = createTestWavBuffer({ sampleRate: 44100, channels: 1, bitDepth: 24, numSamples: 100 });
    expect(buf.length).toBe(44 + 100 * 1 * 3);
  });
});
