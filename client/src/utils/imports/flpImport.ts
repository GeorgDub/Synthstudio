/**
 * Synthstudio – flpImport.ts
 *
 * Vereinfachter FL Studio (.flp) Projekt-Parser.
 *
 * Format-Übersicht:
 *   Datei beginnt mit "FLhd" Header-Chunk (6 Bytes nach Chunk-Header):
 *     - format (uint16): 0 = Pattern, 1 = Score
 *     - nChannels (uint16)
 *     - ppq (uint16): Pulses per Quarter Note
 *
 *   Danach "FLdt" Data-Chunk mit Events:
 *     Events haben einen Event-ID (uint8) + variable Datengröße:
 *       0x00-0x3F: 1 Byte Daten   (z.B. Tempo: 0x9C)
 *       0x40-0x7F: 2 Bytes Daten
 *       0x80-0xBF: 4 Bytes Daten  (z.B. Tempo Float)
 *       0xC0-0xFF: variable Länge (TEXT events – Pattern-Namen etc.)
 *
 * Diese Implementierung extrahiert nur:
 *   - PPQ + Tempo
 *   - Pattern-Namen
 *   - Pattern-Nummer
 *
 * Vollständige Step-Daten würden komplexes XXSubChannel-Parsing brauchen
 * (Channel-Settings, Pattern-Events, Piano-Roll-Notes). Das ist als
 * zukünftige Erweiterung markiert.
 */

import type { ImportResult, ImportedPattern } from "./types";
import { ImportError } from "./types";

// ─── Event-IDs (Auszug aus der inoffiziellen FLP-Doku) ───────────────────────

const FLP_EVENT = {
  // 1-Byte
  CHANNEL_TYPE:       0x15, // Instrument type
  // 2-Byte
  TEMPO:              0x9C, // BPM × 1000
  PATTERN_NEW:        0x40, // New pattern (pattern-id)
  // 4-Byte
  TEMPO_FINE:         0xA9,
  PPQ:                0x86,
  // Variable
  TEXT_CHANNEL_NAME:  0xC3,
  TEXT_PATTERN_NAME:  0xC1,
  TEXT_TITLE:         0xC2,
  TEXT_VERSION:       0xC7,
};

// ─── Reader ──────────────────────────────────────────────────────────────────

class FlpReader {
  private view: DataView;
  private offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  get remaining() {
    return this.view.byteLength - this.offset;
  }

  readString(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
      s += String.fromCharCode(this.view.getUint8(this.offset + i));
    }
    this.offset += n;
    return s;
  }

  readU8(): number {
    return this.view.getUint8(this.offset++);
  }

  readU16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Liest eine variable-length-Quantity (LEB128) für TEXT-Events. */
  readVarLen(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readU8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new ImportError("VarLen overflow", "flp");
    }
    return result;
  }

  /** Liest n Bytes als Latin-1 String (FLP nutzt teilweise UTF-16LE für TEXT). */
  readUtf16Le(n: number): string {
    let s = "";
    for (let i = 0; i < n; i += 2) {
      const code = this.view.getUint16(this.offset + i, true);
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    this.offset += n;
    return s;
  }

  skip(n: number): void {
    this.offset += n;
  }
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

export async function importFlp(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const reader = new FlpReader(arrayBuffer);

  // Header validieren
  const magic = reader.readString(4);
  if (magic !== "FLhd") {
    throw new ImportError(`Kein gültiges FLP-Format. Magic: ${magic}`, "flp");
  }

  const headerSize = reader.readU32();
  if (headerSize < 6) {
    throw new ImportError("FLP-Header zu klein", "flp");
  }

  const format     = reader.readU16(); // 0 = Pattern, 1 = Score
  const nChannels  = reader.readU16();
  const ppq        = reader.readU16();
  if (headerSize > 6) reader.skip(headerSize - 6);

  // Daten-Chunk
  const dataMagic = reader.readString(4);
  if (dataMagic !== "FLdt") {
    throw new ImportError(`Erwarteter "FLdt" Chunk, gefunden: ${dataMagic}`, "flp");
  }
  reader.readU32(); // dataSize

  const warnings: string[] = [];
  if (format !== 0 && format !== 1) {
    warnings.push(`FLP-Format ${format} unbekannt – versuche dennoch zu lesen.`);
  }

  let bpm: number | undefined;
  let title = "";
  const patternNames: string[] = [];
  let currentPatternIdx = -1;

  // Event-Loop
  while (reader.remaining > 0) {
    const eventId = reader.readU8();

    if (eventId < 0x40) {
      // 1-Byte Daten
      const data = reader.readU8();
      // PPQ-relevante Felder werden hier ignoriert (komplexes Mapping)
      void data;
    } else if (eventId < 0x80) {
      // 2-Byte Daten
      const data = reader.readU16();
      if (eventId === FLP_EVENT.TEMPO) {
        bpm = data; // BPM × 1000 in älteren FLPs, sonst direkt
        if (bpm > 1000) bpm = bpm / 1000;
      }
      if (eventId === FLP_EVENT.PATTERN_NEW) {
        currentPatternIdx = data;
      }
    } else if (eventId < 0xC0) {
      // 4-Byte Daten
      const data = reader.readU32();
      if (eventId === FLP_EVENT.TEMPO_FINE) {
        // Float in 16.16 fixed-point oder direkt BPM
        bpm = data > 1_000_000 ? data / 1000 : data;
        if (bpm > 999) bpm = bpm / 1000;
      }
      void data;
    } else {
      // Variable Länge (Text/Daten)
      const len = reader.readVarLen();
      if (len > reader.remaining) {
        warnings.push(`Datenchunk zu groß bei Event 0x${eventId.toString(16)} – Abbruch.`);
        break;
      }

      if (eventId === FLP_EVENT.TEXT_PATTERN_NAME) {
        const name = reader.readUtf16Le(len);
        if (currentPatternIdx >= 0) {
          patternNames[currentPatternIdx] = name;
        }
      } else if (eventId === FLP_EVENT.TEXT_TITLE) {
        title = reader.readUtf16Le(len);
      } else {
        reader.skip(len);
      }
    }
  }

  // Mindestens ein Pattern erzeugen, auch wenn keine Patterns expliziert benannt wurden
  const patternsList: ImportedPattern[] = patternNames.length > 0
    ? patternNames.filter(Boolean).map((name, i) => ({
        name: name || `Pattern ${i + 1}`,
        stepCount: 16,
        bpm,
        parts: [],
      }))
    : [{ name: title || file.name.replace(/\.flp$/i, ""), stepCount: 16, bpm, parts: [] }];

  warnings.push(
    "Nur Pattern-Metadata + BPM werden aus FL Studio extrahiert. " +
    "Step-Daten, Channel-Settings und Mixer werden in einer späteren Version unterstützt.",
  );

  return {
    sourceFormat: "flp",
    fileName: file.name,
    bpm,
    patterns: patternsList,
    warnings,
  };
}
