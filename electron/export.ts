/**
 * Synthstudio – Electron Export-Handler
 *
 * Verwaltet den Export von Projekten in verschiedene Formate:
 * - WAV (Mono): Renderer rendert Audio und sendet PCM-Daten → Main schreibt WAV-Datei
 * - WAV (Stereo): Renderer sendet L/R-Kanäle → Main schreibt interleaved Stereo-WAV
 * - MIDI: Renderer serialisiert Pattern → Main schreibt MIDI-Datei
 * - Projekt (.esx1): JSON-Serialisierung des gesamten Projektzustands
 *
 * INTEGRATION in main.ts:
 * ```ts
 * import { registerExportHandlers } from "./export";
 * registerExportHandlers();
 * ```
 */

import { ipcMain, dialog, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import { writeWavFileStereo, registerStereoExportHandlers } from "./export-stereo";

// ─── WAV-Datei schreiben ──────────────────────────────────────────────────────

/**
 * Schreibt einen WAV-Header + PCM-Daten in eine Datei.
 * Der Renderer liefert die PCM-Daten als Float32Array (normalisiert -1..1).
 *
 * Unterstützt Mono (1 Kanal) und Stereo (2 Kanäle, interleaved).
 * Bei Stereo wird writeWavFileStereo aus export-stereo.ts verwendet,
 * um korrekte RIFF-Konformität und optionale Normalisierung sicherzustellen.
 */
function writeWavFile(
  filePath: string,
  pcmData: Float32Array,
  sampleRate: number,
  numChannels: number
): void {
  if (numChannels === 2) {
    // Stereo: PCM-Daten sind interleaved (L0, R0, L1, R1, ...)
    // De-interleaving für writeWavFileStereo
    const frameCount = Math.floor(pcmData.length / 2);
    const leftData: number[] = new Array(frameCount);
    const rightData: number[] = new Array(frameCount);

    for (let i = 0; i < frameCount; i++) {
      leftData[i] = pcmData[i * 2];
      rightData[i] = pcmData[i * 2 + 1];
    }

    writeWavFileStereo(filePath, leftData, rightData, sampleRate, {
      metadata: { software: "Synthstudio" },
    });
    return;
  }

  // Mono-Pfad (1 Kanal)
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length * bytesPerSample;
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
  buffer.writeUInt32LE(16, offset); offset += 4;        // Chunk-Größe
  buffer.writeUInt16LE(1, offset); offset += 2;         // PCM = 1
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitDepth, offset); offset += 2;

  // data-Chunk
  buffer.write("data", offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // PCM-Daten: Float32 → Int16
  for (let i = 0; i < pcmData.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcmData[i]));
    const int16 = Math.round(clamped * 32767);
    buffer.writeInt16LE(int16, offset);
    offset += 2;
  }

  fs.writeFileSync(filePath, buffer);
}

// ─── MIDI-Datei schreiben ─────────────────────────────────────────────────────

interface MidiNote {
  channel: number;    // 0-15
  note: number;       // 0-127 (MIDI-Note)
  velocity: number;   // 0-127
  startTick: number;
  durationTicks: number;
}

interface MidiTrack {
  name: string;
  notes: MidiNote[];
}

/**
 * Schreibt eine einfache MIDI-Datei (Format 1, mehrere Tracks).
 * Tempo: 120 BPM Standard, 480 Ticks pro Viertel.
 */
function writeMidiFile(
  filePath: string,
  tracks: MidiTrack[],
  bpm = 120,
  ticksPerQuarter = 480
): void {
  const microsecondsPerBeat = Math.round(60_000_000 / bpm);

  function writeVarLen(value: number): Buffer {
    const bytes: number[] = [];
    bytes.push(value & 0x7f);
    value >>= 7;
    while (value > 0) {
      bytes.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    return Buffer.from(bytes);
  }

  function buildTempoTrack(): Buffer {
    const events: Buffer[] = [];

    // Tempo-Event
    events.push(writeVarLen(0)); // Delta-Time 0
    events.push(Buffer.from([0xff, 0x51, 0x03])); // Meta: Tempo
    events.push(Buffer.from([
      (microsecondsPerBeat >> 16) & 0xff,
      (microsecondsPerBeat >> 8) & 0xff,
      microsecondsPerBeat & 0xff,
    ]));

    // End-of-Track
    events.push(writeVarLen(0));
    events.push(Buffer.from([0xff, 0x2f, 0x00]));

    const data = Buffer.concat(events);
    const header = Buffer.alloc(8);
    header.write("MTrk", 0);
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
  }

  function buildTrack(track: MidiTrack): Buffer {
    const events: Array<{ tick: number; data: Buffer }> = [];

    // Track-Name
    const nameBytes = Buffer.from(track.name, "utf8");
    const nameMeta = Buffer.concat([
      Buffer.from([0xff, 0x03]),
      writeVarLen(nameBytes.length),
      nameBytes,
    ]);
    events.push({ tick: 0, data: nameMeta });

    // Note-Events
    for (const note of track.notes) {
      // Note On
      events.push({
        tick: note.startTick,
        data: Buffer.from([
          0x90 | (note.channel & 0x0f),
          note.note & 0x7f,
          note.velocity & 0x7f,
        ]),
      });
      // Note Off
      events.push({
        tick: note.startTick + note.durationTicks,
        data: Buffer.from([
          0x80 | (note.channel & 0x0f),
          note.note & 0x7f,
          0,
        ]),
      });
    }

    // Nach Tick sortieren
    events.sort((a, b) => a.tick - b.tick);

    // Delta-Times berechnen
    const trackData: Buffer[] = [];
    let lastTick = 0;
    for (const event of events) {
      const delta = event.tick - lastTick;
      lastTick = event.tick;
      trackData.push(writeVarLen(delta));
      trackData.push(event.data);
    }

    // End-of-Track
    trackData.push(writeVarLen(0));
    trackData.push(Buffer.from([0xff, 0x2f, 0x00]));

    const data = Buffer.concat(trackData);
    const header = Buffer.alloc(8);
    header.write("MTrk", 0);
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
  }

  // MIDI-Header
  const numTracks = tracks.length + 1; // +1 für Tempo-Track
  const midiHeader = Buffer.alloc(14);
  midiHeader.write("MThd", 0);
  midiHeader.writeUInt32BE(6, 4);
  midiHeader.writeUInt16BE(1, 8);  // Format 1
  midiHeader.writeUInt16BE(numTracks, 10);
  midiHeader.writeUInt16BE(ticksPerQuarter, 12);

  const trackBuffers = [
    buildTempoTrack(),
    ...tracks.map(buildTrack),
  ];

  const midiData = Buffer.concat([midiHeader, ...trackBuffers]);
  fs.writeFileSync(filePath, midiData);
}

// ─── IPC-Handler ─────────────────────────────────────────────────────────────

export function registerExportHandlers(): void {
  /**
   * WAV-Export: Renderer sendet PCM-Daten, Main schreibt WAV-Datei.
   * Unterstützt Mono (channels=1) und Stereo (channels=2).
   * Bei Stereo werden die interleaved PCM-Daten an writeWavFileStereo delegiert.
   */
  ipcMain.handle(
    "export:wav",
    async (
      event,
      options: {
        pcmData: number[];  // Float32Array als number[] (IPC serialisierbar)
        sampleRate: number;
        channels: number;
        suggestedName?: string;
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);

      const result = await dialog.showSaveDialog(win!, {
        title: "Als WAV exportieren",
        defaultPath: options.suggestedName ?? "synthstudio-export.wav",
        filters: [{ name: "WAV Audio", extensions: ["wav"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      try {
        const pcmFloat32 = new Float32Array(options.pcmData);
        writeWavFile(result.filePath, pcmFloat32, options.sampleRate, options.channels);
        return { success: true, filePath: result.filePath };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  );

  // Stereo-Export-Handler aus export-stereo.ts registrieren
  // Stellt den IPC-Kanal "export:wav-stereo" bereit
  registerStereoExportHandlers();

  /**
   * MIDI-Export: Renderer sendet Pattern-Daten, Main schreibt MIDI-Datei
   */
  ipcMain.handle(
    "export:midi",
    async (
      event,
      options: {
        tracks: MidiTrack[];
        bpm: number;
        suggestedName?: string;
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);

      const result = await dialog.showSaveDialog(win!, {
        title: "Als MIDI exportieren",
        defaultPath: options.suggestedName ?? "synthstudio-pattern.mid",
        filters: [{ name: "MIDI", extensions: ["mid", "midi"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      try {
        writeMidiFile(result.filePath, options.tracks, options.bpm);
        return { success: true, filePath: result.filePath };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  );

  /**
   * Projekt-Export (.esx1): JSON-Daten vom Renderer als Datei speichern
   */
  ipcMain.handle(
    "export:project",
    async (
      event,
      options: {
        projectData: string;  // JSON-String
        suggestedName?: string;
        filePath?: string;    // Wenn gesetzt: direkt speichern ohne Dialog
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      let targetPath = options.filePath;

      if (!targetPath) {
        const result = await dialog.showSaveDialog(win!, {
          title: "Projekt speichern",
          defaultPath: options.suggestedName ?? "mein-projekt.esx1",
          filters: [
            { name: "ESX-1 Studio Projekt", extensions: ["esx1"] },
            { name: "JSON", extensions: ["json"] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }
        targetPath = result.filePath;
      }

      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, options.projectData, "utf-8");
        return { success: true, filePath: targetPath };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  );

  /**
   * Projekt-Import: Datei lesen und JSON-String zurückgeben
   */
  ipcMain.handle("export:import-project", async (event, filePath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    let targetPath = filePath;

    if (!targetPath) {
      const result = await dialog.showOpenDialog(win!, {
        title: "Projekt öffnen",
        filters: [
          { name: "ESX-1 Studio Projekt", extensions: ["esx1", "json"] },
        ],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      targetPath = result.filePaths[0];
    }

    try {
      const data = fs.readFileSync(targetPath, "utf-8");
      return { success: true, data, filePath: targetPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
