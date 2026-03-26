/**
 * Synthstudio – ZIP-Import Unit-Tests (Testing-Agent)
 *
 * Testet die reinen Logik-Funktionen aus electron/zip-import.ts
 * ohne Electron-Abhängigkeiten.
 *
 * Architektur-Entscheidung (Testing-Agent):
 * - zip-import.ts importiert `ipcMain`, `BrowserWindow`, `app` aus Electron.
 *   Daher KEIN direkter Import möglich – Logik wird inline repliziert
 *   (identisches Muster zu dragdrop.test.ts).
 * - Die IPC-Handler selbst (registerZipImportHandlers) sind nur E2E-testbar.
 *
 * Abgedeckte Bereiche:
 * - detectCategory() – alle 9 Kategorien + Fallback "other"
 * - detectCategory() – kombinierte Pfad+Dateiname-Erkennung
 * - parseZip() – valides ZIP: EOF-Signatur + Central Directory
 * - parseZip() – Fehlerfall: kein ZIP-Marker
 * - parseZip() – Verzeichniseinträge werden als isDirectory=true markiert
 * - parseZip() – verschiedene Komprimierungsmethoden (stored/deflate)
 *
 * Ausführen: pnpm test
 *
 * WICHTIG: Kein Electron-Import! Reine Node.js Buffer-/String-Logik.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";

// ─── Inline-Replizierte Logik aus zip-import.ts ───────────────────────────────
// (Identisch mit electron/zip-import.ts – Imports verhindert durch ipcMain-Dep.)

const AUDIO_EXTENSIONS_ZIP = new Set([
  ".wav", ".wave",
  ".mp3",
  ".ogg", ".oga",
  ".flac",
  ".aiff", ".aif",
  ".m4a", ".mp4",
  ".wma",
  ".opus",
]);

// ─── ZIP-Format Konstanten ────────────────────────────────────────────────────

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

interface ZipEntry {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

function parseZip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIR_SIG) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Ungültige ZIP-Datei: End of Central Directory nicht gefunden");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIG) break;

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    const isDirectory = fileName.endsWith("/") || fileName.endsWith("\\");

    entries.push({
      fileName,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
      isDirectory,
    });

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

function detectCategory(filePath: string): string {
  const name = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();
  const combined = `${dir} ${name}`;

  const patterns: Record<string, string[]> = {
    kicks:      ["kick", "bd", "bass drum", "bassdrum", "kik", "808"],
    snares:     ["snare", "sn", "snr", "rimshot", "rim"],
    hihats:     ["hihat", "hi-hat", "hh", "hat", "cymbal", "open hat", "closed hat"],
    claps:      ["clap", "clp", "handclap", "snap"],
    toms:       ["tom", "floor tom", "rack tom"],
    percussion: ["perc", "conga", "bongo", "shaker", "tambourine", "cowbell", "clave"],
    fx:         ["fx", "effect", "noise", "sweep", "riser", "impact", "crash", "zap"],
    loops:      ["loop", "break", "groove", "beat", "phrase"],
    vocals:     ["vocal", "vox", "voice", "choir", "spoken"],
  };

  for (const [category, keywords] of Object.entries(patterns)) {
    if (keywords.some((kw) => combined.includes(kw))) {
      return category;
    }
  }
  return "other";
}

// ─── ZIP-Buffer-Builder für Tests ────────────────────────────────────────────

interface ZipFileEntry {
  name: string;
  data: Buffer;
  compressionMethod?: 0 | 8; // 0 = stored, 8 = deflate
}

/**
 * Erstellt einen minimalen, gültigen ZIP-Buffer (stored, keine Komprimierung).
 * Unterstützt mehrere Einträge und Verzeichniseinträge (name endet mit '/').
 */
function buildZipBuffer(files: ZipFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const data = file.compressionMethod === 0 || !file.compressionMethod ? file.data : file.data;
    const compressionMethod = file.compressionMethod ?? 0;

    // Local File Header (30 Bytes + name + data)
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    localHeader.writeUInt16LE(20, 4);           // Version needed
    localHeader.writeUInt16LE(0, 6);            // Flags
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(0, 10);           // Mod time
    localHeader.writeUInt16LE(0, 12);           // Mod date
    localHeader.writeUInt32LE(0, 14);           // CRC-32 (0 für Tests)
    localHeader.writeUInt32LE(data.length, 18); // Compressed size
    localHeader.writeUInt32LE(data.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);           // Extra field length
    nameBytes.copy(localHeader, 30);

    localHeaders.push(localHeader);
    localHeaders.push(data);

    // Central Directory Header (46 Bytes + name)
    const cdEntry = Buffer.alloc(46 + nameBytes.length);
    cdEntry.writeUInt32LE(CENTRAL_DIR_SIG, 0);
    cdEntry.writeUInt16LE(20, 4);              // Version made by
    cdEntry.writeUInt16LE(20, 6);              // Version needed
    cdEntry.writeUInt16LE(0, 8);               // Flags
    cdEntry.writeUInt16LE(compressionMethod, 10);
    cdEntry.writeUInt16LE(0, 12);              // Mod time
    cdEntry.writeUInt16LE(0, 14);              // Mod date
    cdEntry.writeUInt32LE(0, 16);              // CRC-32
    cdEntry.writeUInt32LE(data.length, 20);    // Compressed size
    cdEntry.writeUInt32LE(data.length, 24);    // Uncompressed size
    cdEntry.writeUInt16LE(nameBytes.length, 28);
    cdEntry.writeUInt16LE(0, 30);              // Extra field length
    cdEntry.writeUInt16LE(0, 32);              // Comment length
    cdEntry.writeUInt16LE(0, 34);              // Disk number start
    cdEntry.writeUInt16LE(0, 36);              // Internal attributes
    cdEntry.writeUInt32LE(0, 38);              // External attributes
    cdEntry.writeUInt32LE(localOffset, 42);    // Local header offset
    nameBytes.copy(cdEntry, 46);

    centralDirs.push(cdEntry);
    localOffset += localHeader.length + data.length;
  }

  const centralDirBuffer = Buffer.concat(centralDirs);
  const centralDirOffset = localOffset;
  const centralDirSize = centralDirBuffer.length;

  // End of Central Directory (22 Bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  eocd.writeUInt16LE(0, 4);                      // Disk number
  eocd.writeUInt16LE(0, 6);                      // Start disk
  eocd.writeUInt16LE(files.length, 8);           // Entries on disk
  eocd.writeUInt16LE(files.length, 10);          // Total entries
  eocd.writeUInt32LE(centralDirSize, 12);        // Central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);      // Central dir offset
  eocd.writeUInt16LE(0, 20);                     // Comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

// ─── detectCategory() – Kategorie-Erkennung ──────────────────────────────────

describe("detectCategory – Kicks", () => {
  it.each([
    ["kick.wav", "kicks"],
    ["kick_01.wav", "kicks"],
    ["BD_heavy.wav", "kicks"],
    ["bassdrum_deep.wav", "kicks"],
    ["KIK_tight.wav", "kicks"],
    ["808_sub.wav", "kicks"],
  ])("erkennt '%s' als kicks", (fileName) => {
    expect(detectCategory(fileName)).toBe("kicks");
  });

  it("erkennt 'kicks' im Verzeichnisnamen", () => {
    expect(detectCategory("/samples/kicks/hit01.wav")).toBe("kicks");
  });
});

describe("detectCategory – Snares", () => {
  it.each([
    ["snare.wav", "snares"],
    ["SN_tight.wav", "snares"],
    ["SNR_punchy.wav", "snares"],
    ["rimshot_dry.wav", "snares"],
    ["RIM_side.wav", "snares"],
  ])("erkennt '%s' als snares", (fileName) => {
    expect(detectCategory(fileName)).toBe("snares");
  });
});

describe("detectCategory – HiHats", () => {
  it.each([
    ["hihat_closed.wav", "hihats"],
    ["hi-hat_open.wav", "hihats"],
    ["HH_tight.wav", "hihats"],
    ["cymbal_crash.wav", "hihats"],
  ])("erkennt '%s' als hihats", (fileName) => {
    expect(detectCategory(fileName)).toBe("hihats");
  });

  it("erkennt 'hat' im Dateinamen", () => {
    expect(detectCategory("open_hat_01.wav")).toBe("hihats");
  });
});

describe("detectCategory – Claps", () => {
  it.each([
    ["clap_dry.wav", "claps"],
    ["CLP_wet.wav", "claps"],
    ["handclap_studio.wav", "claps"],
  ])("erkennt '%s' als claps", (fileName) => {
    expect(detectCategory(fileName)).toBe("claps");
  });

  // Hinweis: "snap_finger.wav" trifft das "sn"-Keyword (Snares) bevor "snap" (Claps)
  // geprüft wird, da Object.entries()-Reihenfolge snares vor claps listet.
  // Dies ist das dokumentierte Verhalten der Quelle (zip-import.ts).
  it("'snap_finger.wav' wird als 'snares' kategorisiert (sn-Keyword Vorrang)", () => {
    expect(detectCategory("snap_finger.wav")).toBe("snares");
  });
});

describe("detectCategory – Toms", () => {
  it.each([
    ["tom_floor.wav", "toms"],
    ["floor_tom_01.wav", "toms"],
    ["rack_tom_high.wav", "toms"],
  ])("erkennt '%s' als toms", (fileName) => {
    expect(detectCategory(fileName)).toBe("toms");
  });
});

describe("detectCategory – Percussion", () => {
  it.each([
    ["perc_clave.wav", "percussion"],
    ["conga_open.wav", "percussion"],
    ["bongo_low.wav", "percussion"],
    ["shaker_loop.wav", "percussion"],
    ["tambourine_shake.wav", "percussion"],
    ["cowbell_hit.wav", "percussion"],
    ["clave_8th.wav", "percussion"],
  ])("erkennt '%s' als percussion", (fileName) => {
    expect(detectCategory(fileName)).toBe("percussion");
  });
});

describe("detectCategory – FX", () => {
  it.each([
    ["fx_riser.wav", "fx"],
    ["effect_sweep.wav", "fx"],
    ["noise_white.wav", "fx"],
    ["sweep_down.wav", "fx"],
    ["riser_long.wav", "fx"],
    ["impact_hit.wav", "fx"],
    ["crash_boom.wav", "fx"],
    ["zap_laser.wav", "fx"],
  ])("erkennt '%s' als fx", (fileName) => {
    expect(detectCategory(fileName)).toBe("fx");
  });
});

describe("detectCategory – Loops", () => {
  it.each([
    ["drum_loop_120bpm.wav", "loops"],
    ["break_amen.wav", "loops"],
    ["groove_funk.wav", "loops"],
    ["beat_hip.wav", "loops"],
    ["phrase_melodic.wav", "loops"],
  ])("erkennt '%s' als loops", (fileName) => {
    expect(detectCategory(fileName)).toBe("loops");
  });
});

describe("detectCategory – Vocals", () => {
  it.each([
    ["vocal_dry.wav", "vocals"],
    ["vox_wet.wav", "vocals"],
    ["voice_chop.wav", "vocals"],
    ["choir_alto.wav", "vocals"],
    ["spoken_word.wav", "vocals"],
  ])("erkennt '%s' als vocals", (fileName) => {
    expect(detectCategory(fileName)).toBe("vocals");
  });
});

describe("detectCategory – Fallback 'other'", () => {
  it.each([
    ["sample_001.wav"],
    ["untitled.wav"],
    ["recording.wav"],
    ["hit.wav"],
    [""],
  ])("gibt 'other' zurück für nicht kategorisierbare Datei '%s'", (fileName) => {
    expect(detectCategory(fileName)).toBe("other");
  });
});

describe("detectCategory – Verzeichnispfad-Erkennung", () => {
  it("erkennt Kategorie aus Verzeichnisname wenn Dateiname nicht passt", () => {
    expect(detectCategory("/samples/kicks/hit_01.wav")).toBe("kicks");
    expect(detectCategory("/samples/snares/sample.wav")).toBe("snares");
    expect(detectCategory("/pack/loops/beat_01.wav")).toBe("loops");
  });

  it("Dateiname hat Vorrang vor Verzeichnisname (erster Treffer gewinnt)", () => {
    // Verzeichnis: "loops", Dateiname: "kick" → kicks gewinnt (kicks kommt vor loops)
    expect(detectCategory("/loops/kick_hard.wav")).toBe("kicks");
  });

  it("Groß-/Kleinschreibung spielt keine Rolle", () => {
    expect(detectCategory("KICK_01.WAV")).toBe("kicks");
    expect(detectCategory("SNARE_DRY.WAV")).toBe("snares");
    expect(detectCategory("/DRUMS/HIHAT/SAMPLE.WAV")).toBe("hihats");
  });
});

// ─── parseZip() – ZIP-Parsing ─────────────────────────────────────────────────

describe("parseZip – valide ZIP-Dateien", () => {
  it("parst leeres ZIP (keine Einträge)", () => {
    const zip = buildZipBuffer([]);
    const entries = parseZip(zip);
    expect(entries).toHaveLength(0);
  });

  it("parst ZIP mit einer Datei", () => {
    const zip = buildZipBuffer([
      { name: "kick.wav", data: Buffer.from("RIFF") },
    ]);
    const entries = parseZip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].fileName).toBe("kick.wav");
    expect(entries[0].isDirectory).toBe(false);
    expect(entries[0].compressionMethod).toBe(0);
  });

  it("parst ZIP mit mehreren Dateien", () => {
    const zip = buildZipBuffer([
      { name: "kick.wav",  data: Buffer.from("audio1") },
      { name: "snare.wav", data: Buffer.from("audio2") },
      { name: "hihat.wav", data: Buffer.from("audio3") },
    ]);
    const entries = parseZip(zip);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.fileName)).toEqual(["kick.wav", "snare.wav", "hihat.wav"]);
  });

  it("parst Verzeichniseinträge als isDirectory=true", () => {
    const zip = buildZipBuffer([
      { name: "drums/",     data: Buffer.alloc(0) },
      { name: "drums/kick.wav", data: Buffer.from("audio") },
    ]);
    const entries = parseZip(zip);
    expect(entries).toHaveLength(2);
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[1].isDirectory).toBe(false);
  });

  it("erkennt Kompressionsmethode 8 (Deflate)", () => {
    const zip = buildZipBuffer([
      { name: "compressed.wav", data: Buffer.from("data"), compressionMethod: 8 },
    ]);
    const entries = parseZip(zip);
    expect(entries[0].compressionMethod).toBe(8);
  });

  it("speichert localHeaderOffset korrekt", () => {
    const zip = buildZipBuffer([
      { name: "file.wav", data: Buffer.alloc(16) },
    ]);
    const entries = parseZip(zip);
    // Der Local-File-Header beginnt immer bei Offset 0 für den ersten Eintrag
    expect(entries[0].localHeaderOffset).toBe(0);
  });

  it("parst kompressedSize und unkompressedSize", () => {
    const data = Buffer.alloc(64, 0xab);
    const zip = buildZipBuffer([{ name: "sample.wav", data }]);
    const entries = parseZip(zip);
    expect(entries[0].compressedSize).toBe(64);
    expect(entries[0].uncompressedSize).toBe(64);
  });

  it("parst UTF-8 Dateinamen mit Umlauten korrekt", () => {
    const zip = buildZipBuffer([
      { name: "Schlagzeug/Höhle_kick.wav", data: Buffer.from("data") },
    ]);
    const entries = parseZip(zip);
    expect(entries[0].fileName).toBe("Schlagzeug/Höhle_kick.wav");
  });

  it("parst ZIP mit gemischten Audio- und Nicht-Audio-Dateien", () => {
    const zip = buildZipBuffer([
      { name: "readme.txt",  data: Buffer.from("text") },
      { name: "kick.wav",    data: Buffer.from("audio") },
      { name: "license.md",  data: Buffer.from("text") },
      { name: "snare.wav",   data: Buffer.from("audio") },
    ]);
    const entries = parseZip(zip);
    expect(entries).toHaveLength(4);
    const audioEntries = entries.filter((e) => {
      const ext = path.extname(e.fileName).toLowerCase();
      return AUDIO_EXTENSIONS_ZIP.has(ext);
    });
    expect(audioEntries).toHaveLength(2);
    expect(audioEntries.map((e) => e.fileName)).toEqual(["kick.wav", "snare.wav"]);
  });
});

describe("parseZip – Fehlerfälle", () => {
  it("wirft Fehler für ungültige ZIP-Datei (kein EOCD)", () => {
    const buf = Buffer.from("Dies ist kein ZIP-Archiv, nur zufälliger Inhalt!!!");
    expect(() => parseZip(buf)).toThrow("Ungültige ZIP-Datei");
  });

  it("wirft Fehler für leeren Buffer", () => {
    expect(() => parseZip(Buffer.alloc(0))).toThrow();
  });

  it("wirft Fehler für zu kurzen Buffer", () => {
    expect(() => parseZip(Buffer.alloc(10))).toThrow();
  });

  it("wirft Fehler für Buffer mit falscher Signatur", () => {
    const buf = Buffer.alloc(100, 0xff);
    expect(() => parseZip(buf)).toThrow("Ungültige ZIP-Datei");
  });
});

// ─── Audio-Extension-Erkennung ────────────────────────────────────────────────

describe("ZIP Audio-Extension-Erkennung", () => {
  it.each([
    [".wav"],
    [".wave"],
    [".mp3"],
    [".ogg"],
    [".oga"],
    [".flac"],
    [".aiff"],
    [".aif"],
    [".m4a"],
    [".mp4"],
    [".wma"],
    [".opus"],
  ])("extension '%s' wird als Audio erkannt", (ext) => {
    expect(AUDIO_EXTENSIONS_ZIP.has(ext)).toBe(true);
  });

  it.each([
    [".txt"],
    [".pdf"],
    [".zip"],
    [".jpg"],
    [".png"],
    [".esx1"],
    [".json"],
    [".mid"],
  ])("extension '%s' wird NICHT als Audio erkannt", (ext) => {
    expect(AUDIO_EXTENSIONS_ZIP.has(ext)).toBe(false);
  });
});
