"use strict";
/**
 * Synthstudio – ZIP-Import Handler
 *
 * Verarbeitet den Import von ZIP-Archiven mit Audio-Samples.
 * Verwendet ausschließlich Node.js-interne Module (zlib, fs, path) –
 * keine externen Abhängigkeiten wie jszip.
 *
 * ZIP-Format Referenz: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.importZipFile = importZipFile;
exports.registerZipImportHandlers = registerZipImportHandlers;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
const util_1 = require("util");
const inflateRaw = (0, util_1.promisify)(zlib.inflateRaw);
// ─── Unterstützte Audio-Formate ───────────────────────────────────────────────
const AUDIO_EXTENSIONS = new Set([
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
// ─── ZIP-Datei parsen (Central Directory) ────────────────────────────────────
function parseZip(buffer) {
    const entries = [];
    // End of Central Directory von hinten suchen
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
        if (offset + 46 > buffer.length)
            break;
        if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIG)
            break;
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
// ─── Einzelne Datei aus ZIP extrahieren ──────────────────────────────────────
async function extractEntry(buffer, entry) {
    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER_SIG) {
        throw new Error(`Ungültiger Local File Header für: ${entry.fileName}`);
    }
    const fileNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraFieldLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + fileNameLength + extraFieldLength;
    const compressedData = buffer.slice(dataOffset, dataOffset + entry.compressedSize);
    if (entry.compressionMethod === 0) {
        // Stored – keine Komprimierung
        return compressedData;
    }
    else if (entry.compressionMethod === 8) {
        // Deflate
        return (await inflateRaw(compressedData));
    }
    else {
        throw new Error(`Nicht unterstützte Komprimierungsmethode: ${entry.compressionMethod}`);
    }
}
// ─── Kategorie-Erkennung ─────────────────────────────────────────────────────
function detectCategory(filePath) {
    const name = path.basename(filePath).toLowerCase();
    const dir = path.dirname(filePath).toLowerCase();
    const combined = `${dir} ${name}`;
    const patterns = {
        kicks: ["kick", "bd", "bass drum", "bassdrum", "kik", "808"],
        snares: ["snare", "sn", "snr", "rimshot", "rim"],
        hihats: ["hihat", "hi-hat", "hh", "hat", "cymbal", "open hat", "closed hat"],
        claps: ["clap", "clp", "handclap", "snap"],
        toms: ["tom", "floor tom", "rack tom"],
        percussion: ["perc", "conga", "bongo", "shaker", "tambourine", "cowbell", "clave"],
        fx: ["fx", "effect", "noise", "sweep", "riser", "impact", "crash", "zap"],
        loops: ["loop", "break", "groove", "beat", "phrase"],
        vocals: ["vocal", "vox", "voice", "choir", "spoken"],
    };
    for (const [category, keywords] of Object.entries(patterns)) {
        if (keywords.some((kw) => combined.includes(kw))) {
            return category;
        }
    }
    return "other";
}
// ─── Temp-Verzeichnis ─────────────────────────────────────────────────────────
function getTempDir() {
    const tempBase = path.join(electron_1.app.getPath("temp"), "synthstudio-zip-import");
    if (!fs.existsSync(tempBase)) {
        fs.mkdirSync(tempBase, { recursive: true });
    }
    return tempBase;
}
function cleanTempDir(importId) {
    const dir = path.join(getTempDir(), importId);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
// ─── ZIP-Import Hauptfunktion ─────────────────────────────────────────────────
async function importZipFile(zipPath, importId, win) {
    const tempDir = path.join(getTempDir(), importId);
    fs.mkdirSync(tempDir, { recursive: true });
    try {
        win.webContents.send("samples:import-progress", {
            importId,
            current: 0,
            total: 0,
            percentage: 0,
            phase: "reading",
            currentFile: path.basename(zipPath),
        });
        const zipBuffer = await fs.promises.readFile(zipPath);
        let entries;
        try {
            entries = parseZip(zipBuffer);
        }
        catch (err) {
            throw new Error(`ZIP-Datei konnte nicht gelesen werden: ${String(err)}`);
        }
        // Nur Audio-Dateien
        const audioEntries = entries.filter((e) => {
            if (e.isDirectory)
                return false;
            const ext = path.extname(e.fileName).toLowerCase();
            return AUDIO_EXTENSIONS.has(ext);
        });
        if (audioEntries.length === 0) {
            win.webContents.send("samples:import-complete", {
                importId,
                imported: 0,
                errors: 0,
                message: "Keine Audio-Dateien im ZIP-Archiv gefunden.",
            });
            cleanTempDir(importId);
            return;
        }
        win.webContents.send("samples:import-progress", {
            importId,
            current: 0,
            total: audioEntries.length,
            percentage: 0,
            phase: "extracting",
        });
        const samples = [];
        let imported = 0;
        let errors = 0;
        for (const entry of audioEntries) {
            try {
                const fileName = path.basename(entry.fileName);
                const extractPath = path.join(tempDir, `${imported}_${fileName}`);
                const content = await extractEntry(zipBuffer, entry);
                await fs.promises.writeFile(extractPath, content);
                const stat = await fs.promises.stat(extractPath);
                const category = detectCategory(entry.fileName);
                samples.push({
                    id: `zip_sample_${Date.now()}_${imported}`,
                    name: path.basename(fileName, path.extname(fileName)),
                    path: extractPath,
                    category,
                    size: stat.size,
                });
                imported++;
                if (imported % 5 === 0 || imported === audioEntries.length) {
                    win.webContents.send("samples:import-progress", {
                        importId,
                        current: imported,
                        total: audioEntries.length,
                        percentage: Math.round((imported / audioEntries.length) * 100),
                        phase: "extracting",
                        currentFile: fileName,
                    });
                }
            }
            catch (err) {
                errors++;
                win.webContents.send("samples:import-error", {
                    importId,
                    filePath: entry.fileName,
                    error: String(err),
                });
            }
        }
        win.webContents.send("samples:import-complete", {
            importId,
            imported,
            errors,
            samples,
            message: `${imported} Samples aus ZIP importiert${errors > 0 ? `, ${errors} Fehler` : ""}.`,
        });
    }
    catch (err) {
        win.webContents.send("samples:import-complete", {
            importId,
            imported: 0,
            errors: 1,
            message: `ZIP-Import fehlgeschlagen: ${String(err)}`,
        });
        cleanTempDir(importId);
    }
}
// ─── IPC-Handler registrieren ─────────────────────────────────────────────────
function registerZipImportHandlers(win) {
    electron_1.ipcMain.handle("samples:import-zip", async (_event, zipPath) => {
        const importId = `zip_import_${Date.now()}`;
        importZipFile(zipPath, importId, win);
        return { importId };
    });
    electron_1.ipcMain.handle("samples:cleanup-zip", async (_event, importId) => {
        cleanTempDir(importId);
        return { success: true };
    });
}
