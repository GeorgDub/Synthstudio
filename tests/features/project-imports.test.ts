/**
 * tests/features/project-imports.test.ts
 *
 * Unit-Tests für FL Studio / Ableton / KORG Electribe Import.
 * Verwendet konstruierte Mock-Buffer (echte FLP/ALS/ESX-Dateien wären zu groß für Test-Fixtures).
 */
import { describe, it, expect } from "vitest";
import { importFlp } from "../../client/src/utils/imports/flpImport";
import { importElectribe } from "../../client/src/utils/imports/electribeImport";
import { importProjectFile, importResultToPatterns, ImportError } from "../../client/src/utils/imports/index";
import type { ImportResult } from "../../client/src/utils/imports/types";

// ─── Helper: Mock-File mit ArrayBuffer ───────────────────────────────────────

function makeFile(name: string, buffer: ArrayBuffer): File {
  // Polyfill für Node-Umgebung (kein echtes File-Objekt nötig wenn .arrayBuffer() existiert)
  const blob = new Blob([buffer]);
  return Object.assign(blob, {
    name,
    lastModified: Date.now(),
    webkitRelativePath: "",
  }) as File;
}

// ─── FLP-Tests ────────────────────────────────────────────────────────────────

describe("FL Studio (.flp) Import", () => {
  it("wirft ImportError bei ungültiger Magic-Zahl", async () => {
    const buffer = new ArrayBuffer(20);
    new Uint8Array(buffer).set([0x42, 0x42, 0x42, 0x42]); // "BBBB"
    const file = makeFile("test.flp", buffer);
    await expect(importFlp(file)).rejects.toThrow(ImportError);
  });

  it("liest minimalen FLP-Header korrekt", async () => {
    // Konstruiere minimal valides FLP:
    // "FLhd" + headerSize(6) + format(0) + nChannels(2) + ppq(96) + "FLdt" + dataSize(0)
    const buffer = new ArrayBuffer(22);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    // FLhd
    u8.set([0x46, 0x4C, 0x68, 0x64], 0);
    view.setUint32(4, 6, true); // headerSize
    view.setUint16(8, 0, true); // format = Pattern
    view.setUint16(10, 2, true); // nChannels
    view.setUint16(12, 96, true); // ppq

    // FLdt
    u8.set([0x46, 0x4C, 0x64, 0x74], 14);
    view.setUint32(18, 0, true); // dataSize

    const result = await importFlp(makeFile("min.flp", buffer));
    expect(result.sourceFormat).toBe("flp");
    expect(result.fileName).toBe("min.flp");
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── Electribe-Tests ──────────────────────────────────────────────────────────

describe("KORG Electribe Import", () => {
  it("wirft ImportError bei zu kleiner Datei", async () => {
    const buffer = new ArrayBuffer(8);
    const file = makeFile("test.esx", buffer);
    await expect(importElectribe(file)).rejects.toThrow(ImportError);
  });

  it("wirft ImportError bei unbekannter Magic-Zahl", async () => {
    const buffer = new ArrayBuffer(64);
    new Uint8Array(buffer).set([0xff, 0xff, 0xff, 0xff]);
    const file = makeFile("test.esx", buffer);
    await expect(importElectribe(file)).rejects.toThrow(ImportError);
  });

  it("akzeptiert KORG-Magic-Header + extrahiert BPM heuristisch", async () => {
    const buffer = new ArrayBuffer(256);
    const u8 = new Uint8Array(buffer);
    const view = new DataView(buffer);
    // KORG-Header
    u8.set([0x4B, 0x4F, 0x52, 0x47], 0); // "KORG"
    // BPM-Wert: 1400 = 140.0 BPM bei /10
    view.setUint16(8, 1400, true);
    // Pattern-Name als ASCII
    const name = "TestPat1";
    for (let i = 0; i < name.length; i++) u8[20 + i] = name.charCodeAt(i);

    const result = await importElectribe(makeFile("test.elst", buffer));
    expect(result.sourceFormat).toBe("elst");
    expect(result.bpm).toBeCloseTo(140);
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it("erkennt ZIP-Container (PK-Magic)", async () => {
    const buffer = new ArrayBuffer(64);
    new Uint8Array(buffer).set([0x50, 0x4B, 0x03, 0x04]); // ZIP
    const result = await importElectribe(makeFile("test.esx", buffer));
    expect(result.warnings.some(w => w.includes("ZIP"))).toBe(true);
  });
});

// ─── Dispatcher ──────────────────────────────────────────────────────────────

describe("importProjectFile (Dispatcher)", () => {
  it("wählt FLP-Parser für .flp", async () => {
    const buffer = new ArrayBuffer(8);
    const file = makeFile("test.flp", buffer);
    await expect(importProjectFile(file)).rejects.toThrow(ImportError); // ungültiger Header
  });

  it("wählt Electribe-Parser für .esx", async () => {
    const buffer = new ArrayBuffer(8);
    const file = makeFile("test.esx", buffer);
    await expect(importProjectFile(file)).rejects.toThrow(ImportError);
  });

  it("wirft ImportError für nicht unterstützte Endung", async () => {
    const buffer = new ArrayBuffer(8);
    const file = makeFile("test.xyz", buffer);
    await expect(importProjectFile(file)).rejects.toThrow(/Nicht unterstützt/);
  });
});

// ─── Result-Konvertierung ────────────────────────────────────────────────────

describe("importResultToPatterns", () => {
  it("konvertiert leeres ImportResult zu leerem Pattern-Array", () => {
    const result: ImportResult = {
      sourceFormat: "flp",
      fileName: "test.flp",
      bpm: 140,
      patterns: [],
      warnings: [],
    };
    expect(importResultToPatterns(result)).toEqual([]);
  });

  it("erstellt Pattern mit allen Pflicht-Feldern", () => {
    const result: ImportResult = {
      sourceFormat: "als",
      fileName: "test.als",
      bpm: 128,
      patterns: [{
        name: "Test Pattern",
        stepCount: 16,
        bpm: 128,
        parts: [{
          name: "Kick",
          steps: [{ active: true, velocity: 100 }],
        }],
      }],
      warnings: [],
    };
    const converted = importResultToPatterns(result);
    expect(converted).toHaveLength(1);
    expect(converted[0].name).toBe("Test Pattern");
    expect(converted[0].bpm).toBe(128);
    expect(converted[0].stepCount).toBe(16);
    expect(converted[0].parts).toHaveLength(1);
    expect(converted[0].parts[0].name).toBe("Kick");
    expect(converted[0].parts[0].steps[0].active).toBe(true);
    expect(converted[0].parts[0].fx).toBeDefined();
  });

  it("clampt stepCount auf 16 oder 32", () => {
    const result: ImportResult = {
      sourceFormat: "flp", fileName: "x", bpm: 120, warnings: [],
      patterns: [{ name: "X", stepCount: 64 as 16, bpm: 120, parts: [] }],
    };
    const converted = importResultToPatterns(result);
    expect([16, 32]).toContain(converted[0].stepCount);
  });
});
