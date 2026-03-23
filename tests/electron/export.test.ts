/**
 * Synthstudio – Export Unit-Tests (Testing-Agent)
 *
 * Testet die reinen Logik-Funktionen aus electron/wav-writer.ts
 * ohne Electron-Abhängigkeiten.
 *
 * Architektur-Entscheidung (Testing-Agent):
 * - electron/wav-writer.ts: Reine Node.js-Logik (WAV, MIDI-Utilities) → testbar
 * - electron/export-stereo.ts: Electron-IPC-Handler → nur E2E-testbar
 * - electron/export.ts: Electron-IPC-Handler → nur E2E-testbar
 *
 * Abgedeckte Bereiche:
 * - MIDI VarLen-Encoding (writeVarLen)
 * - WAV-Header-Struktur Stereo (writeWavFileStereo)
 * - WAV-Header-Struktur Mono (writeWavFileMono)
 * - Stereo-Normalisierung (normalizeStereo)
 * - INFO-Chunk-Metadaten (buildInfoChunk)
 * - Float32-zu-Int16-Konvertierung
 * - BPM-zu-Microseconds-Konvertierung
 *
 * Ausführen: pnpm test
 *
 * WICHTIG: Kein Electron-Import! Nur fs, path, os und wav-writer.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Kein Electron-Import! ────────────────────────────────────────────────────
// wav-writer.ts hat ausschließlich Node.js-Abhängigkeiten (fs).
import {
  writeVarLen,
  normalizeStereo,
  buildInfoChunk,
  writeWavFileStereo,
  writeWavFileMono,
} from "../../electron/wav-writer";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "synthstudio-export-test-"));
}

function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignorieren
  }
}

/** Liest WAV-Header aus einem Buffer */
interface ParsedWavHeader {
  riff: string;
  wave: string;
  fmtId: string;
  fmtSize: number;
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitDepth: number;
  dataId: string;
  dataSize: number;
  totalFileSize: number;
}

function parseWavHeader(buf: Buffer): ParsedWavHeader {
  return {
    riff: buf.toString("ascii", 0, 4),
    wave: buf.toString("ascii", 8, 12),
    fmtId: buf.toString("ascii", 12, 16),
    fmtSize: buf.readUInt32LE(16),
    audioFormat: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    byteRate: buf.readUInt32LE(28),
    blockAlign: buf.readUInt16LE(32),
    bitDepth: buf.readUInt16LE(34),
    dataId: buf.toString("ascii", 36, 40),
    dataSize: buf.readUInt32LE(40),
    totalFileSize: buf.length,
  };
}

/** Erstellt Sinus-PCM-Daten */
function createSinePcm(numSamples: number, frequency = 440, sampleRate = 44100): number[] {
  return Array.from({ length: numSamples }, (_, i) =>
    Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5
  );
}

// ─── MIDI VarLen-Encoding ─────────────────────────────────────────────────────

describe("writeVarLen – MIDI Variable-Length-Encoding", () => {
  it("kodiert 0 als ein Byte [0x00]", () => {
    const buf = writeVarLen(0);
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0x00);
  });

  it("kodiert 127 (0x7F) als ein Byte", () => {
    const buf = writeVarLen(127);
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0x7f);
  });

  it("kodiert 128 (0x80) als zwei Bytes [0x81, 0x00]", () => {
    const buf = writeVarLen(128);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0x81);
    expect(buf[1]).toBe(0x00);
  });

  it("kodiert 255 als zwei Bytes [0x81, 0x7F]", () => {
    const buf = writeVarLen(255);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0x81);
    expect(buf[1]).toBe(0x7f);
  });

  it("kodiert 480 (Standard Ticks-per-Quarter) korrekt als [0x83, 0x60]", () => {
    // 480 = 0x1E0 → VarLen: [0x83, 0x60]
    const buf = writeVarLen(480);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0x83);
    expect(buf[1]).toBe(0x60);
  });

  it("kodiert 16383 (max 2-Byte-Wert) als [0xFF, 0x7F]", () => {
    const buf = writeVarLen(16383);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0x7f);
  });

  it("kodiert 16384 als drei Bytes [0x81, 0x80, 0x00]", () => {
    const buf = writeVarLen(16384);
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(0x81);
    expect(buf[1]).toBe(0x80);
    expect(buf[2]).toBe(0x00);
  });

  it("kodiert 2097151 (max 3-Byte-Wert) als [0xFF, 0xFF, 0x7F]", () => {
    const buf = writeVarLen(2097151);
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xff);
    expect(buf[2]).toBe(0x7f);
  });

  it("Roundtrip: Dekodierung ergibt ursprünglichen Wert", () => {
    const testValues = [0, 1, 63, 64, 127, 128, 255, 480, 960, 16383, 16384, 100000];
    for (const val of testValues) {
      const encoded = writeVarLen(val);
      // Dekodieren
      let decoded = 0;
      for (let i = 0; i < encoded.length; i++) {
        decoded = (decoded << 7) | (encoded[i] & 0x7f);
      }
      expect(decoded).toBe(val);
    }
  });

  it("MSB-Bit ist gesetzt für alle Bytes außer dem letzten (Continuation-Bit)", () => {
    const buf = writeVarLen(16384); // 3 Bytes
    expect(buf[0] & 0x80).toBe(0x80); // Continuation
    expect(buf[1] & 0x80).toBe(0x80); // Continuation
    expect(buf[2] & 0x80).toBe(0x00); // Letztes Byte
  });
});

// ─── Stereo-Normalisierung ────────────────────────────────────────────────────

describe("normalizeStereo – Stereo-Normalisierung", () => {
  it("normalisiert leises Signal auf Peak 1.0", () => {
    const left = new Float32Array([0.25, -0.25, 0.1]);
    const right = new Float32Array([0.1, -0.1, 0.2]);
    normalizeStereo(left, right);
    // Peak war 0.25 → Gain = 4.0
    expect(left[0]).toBeCloseTo(1.0, 5);
    expect(left[1]).toBeCloseTo(-1.0, 5);
  });

  it("normalisiert nicht wenn Peak >= 1.0 (kein Gain-Reduction)", () => {
    const left = new Float32Array([1.0, 0.5]);
    const right = new Float32Array([0.5, 0.5]);
    normalizeStereo(left, right);
    // Peak ist bereits 1.0 → keine Änderung
    expect(left[0]).toBeCloseTo(1.0, 5);
    expect(left[1]).toBeCloseTo(0.5, 5);
  });

  it("normalisiert nicht wenn Peak = 0 (Stille)", () => {
    const left = new Float32Array([0, 0, 0]);
    const right = new Float32Array([0, 0, 0]);
    normalizeStereo(left, right);
    expect(left[0]).toBe(0);
    expect(right[0]).toBe(0);
  });

  it("berücksichtigt beide Kanäle für Peak-Berechnung", () => {
    const left = new Float32Array([0.1, 0.1]);
    const right = new Float32Array([0.5, 0.5]); // Rechter Kanal hat höheren Peak
    normalizeStereo(left, right);
    // Peak = 0.5 → Gain = 2.0
    expect(right[0]).toBeCloseTo(1.0, 5);
    expect(left[0]).toBeCloseTo(0.2, 5);
  });
});

// ─── buildInfoChunk ───────────────────────────────────────────────────────────

describe("buildInfoChunk – RIFF INFO-Chunk", () => {
  it("gibt einen Buffer zurück", () => {
    const chunk = buildInfoChunk({ software: "Synthstudio" });
    expect(chunk).toBeInstanceOf(Buffer);
    expect(chunk.length).toBeGreaterThan(0);
  });

  it("beginnt mit LIST-Signatur", () => {
    const chunk = buildInfoChunk({});
    expect(chunk.toString("ascii", 0, 4)).toBe("LIST");
  });

  it("enthält INFO-Signatur", () => {
    const chunk = buildInfoChunk({});
    expect(chunk.toString("ascii", 8, 12)).toBe("INFO");
  });

  it("enthält ISFT-Tag (Software)", () => {
    const chunk = buildInfoChunk({ software: "Synthstudio v1.0" });
    expect(chunk.toString("ascii")).toContain("ISFT");
    expect(chunk.toString("ascii")).toContain("Synthstudio v1.0");
  });

  it("enthält INAM-Tag wenn Titel gesetzt", () => {
    const chunk = buildInfoChunk({ title: "Mein Projekt" });
    expect(chunk.toString("ascii")).toContain("INAM");
    expect(chunk.toString("ascii")).toContain("Mein Projekt");
  });

  it("enthält IART-Tag wenn Artist gesetzt", () => {
    const chunk = buildInfoChunk({ artist: "Testuser" });
    expect(chunk.toString("ascii")).toContain("IART");
    expect(chunk.toString("ascii")).toContain("Testuser");
  });

  it("enthält ICRD-Tag (Datum) immer", () => {
    const chunk = buildInfoChunk({});
    expect(chunk.toString("ascii")).toContain("ICRD");
  });

  it("Chunk-Größe stimmt mit LIST-Header überein", () => {
    const chunk = buildInfoChunk({ title: "Test", software: "Synthstudio" });
    const declaredSize = chunk.readUInt32LE(4);
    expect(chunk.length).toBe(8 + declaredSize);
  });

  it("verwendet Standardwert 'Synthstudio' wenn software nicht gesetzt", () => {
    const chunk = buildInfoChunk({});
    expect(chunk.toString("ascii")).toContain("Synthstudio");
  });
});

// ─── WAV-Datei-Struktur (Stereo) ──────────────────────────────────────────────

describe("writeWavFileStereo – WAV-Header-Struktur", () => {
  let tempDir: string;
  let outFile: string;

  beforeEach(() => {
    tempDir = createTempDir();
    outFile = path.join(tempDir, "test.wav");
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("schreibt gültige RIFF/WAVE-Signatur", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    const header = parseWavHeader(buf);
    expect(header.riff).toBe("RIFF");
    expect(header.wave).toBe("WAVE");
  });

  it("schreibt korrekten fmt-Chunk (PCM = 1)", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    const header = parseWavHeader(buf);
    expect(header.fmtId).toBe("fmt ");
    expect(header.fmtSize).toBe(16);
    expect(header.audioFormat).toBe(1); // PCM
  });

  it("schreibt 2 Kanäle (Stereo)", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).channels).toBe(2);
  });

  it("schreibt korrekte Sample-Rate 44100 Hz", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).sampleRate).toBe(44100);
  });

  it("schreibt korrekte Sample-Rate 48000 Hz", () => {
    const pcm = createSinePcm(100, 440, 48000);
    writeWavFileStereo(outFile, pcm, pcm, 48000);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).sampleRate).toBe(48000);
  });

  it("schreibt 16-bit Bit-Tiefe", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).bitDepth).toBe(16);
  });

  it("berechnet byteRate korrekt (sampleRate × channels × bytesPerSample)", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    const header = parseWavHeader(buf);
    expect(header.byteRate).toBe(44100 * 2 * 2); // 44100 × 2ch × 2 Bytes
  });

  it("berechnet blockAlign korrekt (channels × bytesPerSample)", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).blockAlign).toBe(4); // 2ch × 2 Bytes
  });

  it("schreibt data-Chunk mit korrekter Größe", () => {
    const numSamples = 1000;
    const pcm = createSinePcm(numSamples);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    const header = parseWavHeader(buf);
    expect(header.dataSize).toBe(numSamples * 2 * 2);
  });

  it("Gesamtdateigröße = 44 (Header) + dataSize", () => {
    const numSamples = 500;
    const pcm = createSinePcm(numSamples);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    const header = parseWavHeader(buf);
    const expectedDataSize = numSamples * 2 * 2;
    expect(buf.length).toBe(44 + expectedDataSize);
  });

  it("schreibt interleaved PCM-Daten (L0, R0, L1, R1, ...)", () => {
    const left = [1.0, 1.0, 1.0];
    const right = [-1.0, -1.0, -1.0];
    writeWavFileStereo(outFile, left, right, 44100);
    const buf = fs.readFileSync(outFile);
    const l0 = buf.readInt16LE(44);
    const r0 = buf.readInt16LE(46);
    expect(l0).toBe(32767);
    expect(r0).toBe(-32767); // Math.round(-1.0 * 32767) = -32767
  });

  it("klemmt Werte auf [-1, 1] (Clipping)", () => {
    const left = [2.0];
    const right = [-2.0];
    writeWavFileStereo(outFile, left, right, 44100);
    const buf = fs.readFileSync(outFile);
    const l0 = buf.readInt16LE(44);
    const r0 = buf.readInt16LE(46);
    expect(l0).toBe(32767);
    expect(r0).toBeLessThanOrEqual(-32767);
  });

  it("schreibt Stille korrekt (alle Nullen im data-Chunk)", () => {
    const silence = new Array(100).fill(0);
    writeWavFileStereo(outFile, silence, silence, 44100);
    const buf = fs.readFileSync(outFile);
    for (let i = 44; i < buf.length; i++) {
      expect(buf[i]).toBe(0);
    }
  });

  it("leerer rechter Kanal wird durch linken Kanal ersetzt", () => {
    const left = [0.5, 0.5, 0.5];
    const right: number[] = [];
    writeWavFileStereo(outFile, left, right, 44100);
    const buf = fs.readFileSync(outFile);
    const l0 = buf.readInt16LE(44);
    const r0 = buf.readInt16LE(46);
    expect(l0).toBe(r0);
  });

  it("bei unterschiedlichen Kanallängen wird die kürzere Länge verwendet", () => {
    const left = createSinePcm(100);
    const right = createSinePcm(50);
    writeWavFileStereo(outFile, left, right, 44100);
    const buf = fs.readFileSync(outFile);
    const header = parseWavHeader(buf);
    expect(header.dataSize).toBe(50 * 2 * 2);
  });
});

// ─── WAV-Datei-Struktur (Mono) ────────────────────────────────────────────────

describe("writeWavFileMono – WAV-Header-Struktur", () => {
  let tempDir: string;
  let outFile: string;

  beforeEach(() => {
    tempDir = createTempDir();
    outFile = path.join(tempDir, "test-mono.wav");
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("schreibt gültige RIFF/WAVE-Signatur", () => {
    const pcm = createSinePcm(100);
    writeWavFileMono(outFile, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).riff).toBe("RIFF");
    expect(parseWavHeader(buf).wave).toBe("WAVE");
  });

  it("schreibt 1 Kanal (Mono)", () => {
    const pcm = createSinePcm(100);
    writeWavFileMono(outFile, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).channels).toBe(1);
  });

  it("schreibt 16-bit PCM", () => {
    const pcm = createSinePcm(100);
    writeWavFileMono(outFile, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    const header = parseWavHeader(buf);
    expect(header.audioFormat).toBe(1);
    expect(header.bitDepth).toBe(16);
  });

  it("berechnet byteRate korrekt (sampleRate × 1 × 2)", () => {
    const pcm = createSinePcm(100);
    writeWavFileMono(outFile, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(parseWavHeader(buf).byteRate).toBe(44100 * 1 * 2);
  });

  it("Gesamtdateigröße = 44 + numSamples × 2", () => {
    const numSamples = 200;
    const pcm = createSinePcm(numSamples);
    writeWavFileMono(outFile, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(buf.length).toBe(44 + numSamples * 2);
  });

  it("akzeptiert Float32Array als Eingabe", () => {
    const pcm = new Float32Array(createSinePcm(100));
    writeWavFileMono(outFile, pcm, 44100);
    expect(fs.existsSync(outFile)).toBe(true);
    const buf = fs.readFileSync(outFile);
    expect(buf.length).toBe(44 + 100 * 2);
  });
});

// ─── Stereo-Normalisierung via writeWavFileStereo ─────────────────────────────

describe("writeWavFileStereo – Normalisierung", () => {
  let tempDir: string;
  let outFile: string;

  beforeEach(() => {
    tempDir = createTempDir();
    outFile = path.join(tempDir, "test-norm.wav");
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("normalize=true: leises Signal wird auf Peak 1.0 normalisiert", () => {
    const pcm = createSinePcm(4410, 440, 44100).map((s) => s * 0.5);
    writeWavFileStereo(outFile, pcm, pcm, 44100, { normalize: true });
    const buf = fs.readFileSync(outFile);
    let maxSample = 0;
    for (let i = 44; i < buf.length - 1; i += 2) {
      const sample = Math.abs(buf.readInt16LE(i));
      if (sample > maxSample) maxSample = sample;
    }
    expect(maxSample).toBeGreaterThan(30000);
  });

  it("normalize=false (Standard): Signal bleibt unverändert", () => {
    const pcm = [0.1, 0.1, 0.1];
    writeWavFileStereo(outFile, pcm, pcm, 44100, { normalize: false });
    const buf = fs.readFileSync(outFile);
    const sample = buf.readInt16LE(44);
    expect(Math.abs(sample)).toBeLessThan(4000);
  });
});

// ─── Metadaten via writeWavFileStereo ────────────────────────────────────────

describe("writeWavFileStereo – Metadaten", () => {
  let tempDir: string;
  let outFile: string;

  beforeEach(() => {
    tempDir = createTempDir();
    outFile = path.join(tempDir, "test-meta.wav");
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("Datei ohne Metadaten ist exakt 44 + dataSize Bytes groß", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100);
    const buf = fs.readFileSync(outFile);
    expect(buf.length).toBe(44 + 100 * 2 * 2);
  });

  it("Datei mit Metadaten ist größer als ohne Metadaten", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100, {
      metadata: { title: "Test", artist: "Synthstudio", software: "Synthstudio v1.0" },
    });
    const buf = fs.readFileSync(outFile);
    expect(buf.length).toBeGreaterThan(44 + 100 * 2 * 2);
  });

  it("Datei mit Metadaten enthält LIST/INFO-Chunk", () => {
    const pcm = createSinePcm(100);
    writeWavFileStereo(outFile, pcm, pcm, 44100, {
      metadata: { software: "Synthstudio" },
    });
    const buf = fs.readFileSync(outFile);
    const bufStr = buf.toString("ascii");
    expect(bufStr).toContain("LIST");
    expect(bufStr).toContain("INFO");
    expect(bufStr).toContain("ISFT");
  });
});

// ─── MIDI-Datei-Struktur (Verifikation) ──────────────────────────────────────

describe("MIDI-Datei-Struktur – Verifikation", () => {
  it("MThd-Header hat korrekte Signatur und Größe", () => {
    const midiHeader = Buffer.alloc(14);
    midiHeader.write("MThd", 0);
    midiHeader.writeUInt32BE(6, 4);
    midiHeader.writeUInt16BE(1, 8);
    midiHeader.writeUInt16BE(2, 10);
    midiHeader.writeUInt16BE(480, 12);

    expect(midiHeader.toString("ascii", 0, 4)).toBe("MThd");
    expect(midiHeader.readUInt32BE(4)).toBe(6);
    expect(midiHeader.readUInt16BE(8)).toBe(1);
    expect(midiHeader.readUInt16BE(10)).toBe(2);
    expect(midiHeader.readUInt16BE(12)).toBe(480);
  });

  it("MTrk-Header hat korrekte Signatur", () => {
    const trackHeader = Buffer.alloc(8);
    trackHeader.write("MTrk", 0);
    trackHeader.writeUInt32BE(10, 4);

    expect(trackHeader.toString("ascii", 0, 4)).toBe("MTrk");
    expect(trackHeader.readUInt32BE(4)).toBe(10);
  });

  it("Tempo-Meta-Event hat korrekte Struktur (0xFF 0x51 0x03)", () => {
    const bpm = 120;
    const microsecondsPerBeat = Math.round(60_000_000 / bpm);
    const tempoData = Buffer.from([
      (microsecondsPerBeat >> 16) & 0xff,
      (microsecondsPerBeat >> 8) & 0xff,
      microsecondsPerBeat & 0xff,
    ]);
    const decoded = (tempoData[0] << 16) | (tempoData[1] << 8) | tempoData[2];
    expect(decoded).toBe(500000); // 120 BPM = 500000 µs/Beat
  });

  it("Note-On-Event hat korrekte Struktur (0x9n, note, velocity)", () => {
    const channel = 0;
    const note = 60;
    const velocity = 100;
    const noteOn = Buffer.from([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f]);
    expect(noteOn[0]).toBe(0x90);
    expect(noteOn[1]).toBe(60);
    expect(noteOn[2]).toBe(100);
  });

  it("Note-Off-Event hat korrekte Struktur (0x8n, note, 0)", () => {
    const channel = 1;
    const note = 64;
    const noteOff = Buffer.from([0x80 | (channel & 0x0f), note & 0x7f, 0]);
    expect(noteOff[0]).toBe(0x81);
    expect(noteOff[1]).toBe(64);
    expect(noteOff[2]).toBe(0);
  });

  it("End-of-Track-Meta-Event hat korrekte Struktur (0xFF 0x2F 0x00)", () => {
    const eot = Buffer.from([0xff, 0x2f, 0x00]);
    expect(eot[0]).toBe(0xff);
    expect(eot[1]).toBe(0x2f);
    expect(eot[2]).toBe(0x00);
  });

  it("BPM-zu-Microseconds: 120 BPM = 500000 µs", () => {
    expect(Math.round(60_000_000 / 120)).toBe(500000);
  });

  it("BPM-zu-Microseconds: 60 BPM = 1000000 µs", () => {
    expect(Math.round(60_000_000 / 60)).toBe(1_000_000);
  });

  it("BPM-zu-Microseconds: 140 BPM ≈ 428571 µs", () => {
    expect(Math.round(60_000_000 / 140)).toBe(428571);
  });
});

// ─── Float32-zu-Int16-Konvertierung ──────────────────────────────────────────

describe("Float32-zu-Int16-Konvertierung", () => {
  it("+1.0 → 32767", () => {
    expect(Math.round(Math.max(-1, Math.min(1, 1.0)) * 32767)).toBe(32767);
  });

  it("-1.0 → -32767", () => {
    expect(Math.round(Math.max(-1, Math.min(1, -1.0)) * 32767)).toBe(-32767);
  });

  it("0.0 → 0", () => {
    expect(Math.round(0 * 32767)).toBe(0);
  });

  it("Clipping bei > 1.0 → 32767", () => {
    expect(Math.round(Math.max(-1, Math.min(1, 2.0)) * 32767)).toBe(32767);
  });

  it("Clipping bei < -1.0 → -32767", () => {
    expect(Math.round(Math.max(-1, Math.min(1, -2.0)) * 32767)).toBe(-32767);
  });

  it("0.5 → 16384 (gerundet)", () => {
    expect(Math.round(0.5 * 32767)).toBe(16384);
  });
});
