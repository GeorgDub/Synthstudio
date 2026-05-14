/**
 * tests/features/project-imports.test.ts
 *
 * Unit-Tests für FL Studio / Ableton / KORG Electribe Import.
 * Verwendet konstruierte Mock-Buffer (echte FLP/ALS/ESX-Dateien wären zu groß für Test-Fixtures).
 */
import { describe, it, expect } from "vitest";
import { importFlp, detectChannelPitches, buildMelodicParts } from "../../client/src/utils/imports/flpImport";
import { importElectribe } from "../../client/src/utils/imports/electribeImport";
import {
  importProjectFile,
  importResultToPatterns,
  ImportError,
  routeMelodicPartsToPatterns,
} from "../../client/src/utils/imports/index";
import type { ImportResult, ImportedMelodicPart } from "../../client/src/utils/imports/types";

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

// ─── FLP Melodic-Detection (post-v1.63.0) ─────────────────────────────────────

describe("detectChannelPitches", () => {
  it("liefert leeren Map bei leerem Notes-Array", () => {
    expect(detectChannelPitches([]).size).toBe(0);
  });

  it("Channel mit nur einer Pitch → Set-Größe 1 (drum-like)", () => {
    const map = detectChannelPitches([
      { position: 0,  channel: 0, duration: 24, key: 36, velocity: 100 },
      { position: 24, channel: 0, duration: 24, key: 36, velocity: 100 },
      { position: 48, channel: 0, duration: 24, key: 36, velocity: 100 },
    ]);
    expect(map.get(0)?.size).toBe(1);
  });

  it("Channel mit mehreren Pitches → Set-Größe ≥2 (melodisch)", () => {
    const map = detectChannelPitches([
      { position: 0,  channel: 1, duration: 24, key: 60, velocity: 100 },
      { position: 24, channel: 1, duration: 24, key: 62, velocity: 100 },
      { position: 48, channel: 1, duration: 24, key: 64, velocity: 100 },
      { position: 72, channel: 1, duration: 24, key: 60, velocity: 100 }, // duplicate
    ]);
    expect(map.get(1)?.size).toBe(3);
    expect([...map.get(1)!]).toEqual(expect.arrayContaining([60, 62, 64]));
  });

  it("trennt verschiedene Channels", () => {
    const map = detectChannelPitches([
      { position: 0,  channel: 0, duration: 24, key: 36, velocity: 100 }, // kick
      { position: 24, channel: 1, duration: 24, key: 60, velocity: 100 }, // synth
      { position: 48, channel: 1, duration: 24, key: 64, velocity: 100 }, // synth
    ]);
    expect(map.size).toBe(2);
    expect(map.get(0)?.size).toBe(1); // drum
    expect(map.get(1)?.size).toBe(2); // melodic
  });
});

describe("FLP Import — Melodic-Channel-Warnung (post-v1.63.0)", () => {
  // FLP mit Notes auf ch0 (alle key=36, drum-like) und ch1 (key=60/62/64, melodic)
  function buildFlpWithMixedChannels(): ArrayBuffer {
    // Header (14 bytes)
    const header = new Uint8Array(14);
    const hv = new DataView(header.buffer);
    header.set([0x46, 0x4c, 0x68, 0x64], 0); // FLhd
    hv.setUint32(4, 6, true);
    hv.setUint16(8, 0, true);    // format
    hv.setUint16(10, 2, true);   // nChannels
    hv.setUint16(12, 96, true);  // ppq

    // Build 4 notes
    const noteBuf = (pos: number, ch: number, key: number) => {
      const buf = new Uint8Array(24);
      const v = new DataView(buf.buffer);
      v.setUint32(0, pos, true);
      v.setUint16(6, ch, true);
      v.setUint32(8, 24, true);
      v.setUint8(12, key);
      v.setUint8(18, 100);
      return buf;
    };
    const drumNote1 = noteBuf(0, 0, 36);
    const drumNote2 = noteBuf(96, 0, 36); // same pitch → drum-like
    const melNote1 = noteBuf(24, 1, 60);
    const melNote2 = noteBuf(48, 1, 64); // different pitch → melodic

    // Notes payload (4 × 24 = 96 bytes)
    const payload = new Uint8Array(96);
    payload.set(drumNote1, 0);
    payload.set(drumNote2, 24);
    payload.set(melNote1, 48);
    payload.set(melNote2, 72);

    // NewPattern + NotesEvent
    const newPattern = new Uint8Array([0x4f, 0x01, 0x00]); // WORD: pattern 1
    // DATA event 0xe7 with varlen size 96 (= 0x60, single byte)
    const eventHeader = new Uint8Array([0xe7, 96]);
    const dataChunk = new Uint8Array(newPattern.length + eventHeader.length + payload.length);
    dataChunk.set(newPattern, 0);
    dataChunk.set(eventHeader, newPattern.length);
    dataChunk.set(payload, newPattern.length + eventHeader.length);

    // FLdt + dataSize
    const dataHdr = new Uint8Array(8);
    dataHdr.set([0x46, 0x4c, 0x64, 0x74], 0); // FLdt
    new DataView(dataHdr.buffer).setUint32(4, dataChunk.length, true);

    const total = new Uint8Array(header.length + dataHdr.length + dataChunk.length);
    total.set(header, 0);
    total.set(dataHdr, header.length);
    total.set(dataChunk, header.length + dataHdr.length);
    return total.buffer;
  }

  it("emittet Warning für melodischen Channel, KEINE Warning für drum-Channel", async () => {
    const result = await importFlp(makeFile("mixed.flp", buildFlpWithMixedChannels()));
    const melodicWarnings = result.warnings.filter(w => w.includes("melodisch"));
    expect(melodicWarnings).toHaveLength(1);
    expect(melodicWarnings[0]).toContain("Channel 1");
    expect(melodicWarnings[0]).toContain("2 Tonhöhen"); // 60 + 64
    expect(melodicWarnings[0]).toContain("C4"); // 60
    expect(melodicWarnings[0]).toContain("E4"); // 64
    // Channel 0 ist drum-like (alle key=36) → keine Warning
    expect(melodicWarnings.some(w => w.includes("Channel 0"))).toBe(false);
  });

  it("Pitch wird auf ImportedStep mitgeführt", async () => {
    const result = await importFlp(makeFile("mixed.flp", buildFlpWithMixedChannels()));
    const allSteps = result.patterns.flatMap(p => p.parts.flatMap(part => part.steps));
    const activeStepsWithPitch = allSteps.filter(s => s.active && s.pitch !== undefined);
    expect(activeStepsWithPitch.length).toBeGreaterThan(0);
    // Mindestens eine Note hat pitch=60 (C4 vom melodischen Channel)
    expect(activeStepsWithPitch.some(s => s.pitch === 60)).toBe(true);
    expect(activeStepsWithPitch.some(s => s.pitch === 36)).toBe(true);
  });

  it("ImportResult enthält melodicParts mit voller Note-Info (v1.65)", async () => {
    const result = await importFlp(makeFile("mixed.flp", buildFlpWithMixedChannels()));
    expect(result.melodicParts).toBeDefined();
    expect(result.melodicParts).toHaveLength(1); // nur Channel 1 ist melodisch
    const part = result.melodicParts![0];
    expect(part.sourceChannel).toBe(1);
    expect(part.notes).toHaveLength(2);
    // Notes sind nach startStep sortiert
    expect(part.notes[0].startStep).toBeLessThan(part.notes[1].startStep);
    // Erste Note: C4 (60) bei position=24 (1 step bei PPQ=96)
    expect(part.notes[0].pitch).toBe(60);
    expect(part.notes[0].startStep).toBe(1);
    expect(part.notes[0].velocity).toBe(100);
    // Zweite Note: E4 (64) bei position=48 (2 steps)
    expect(part.notes[1].pitch).toBe(64);
    expect(part.notes[1].startStep).toBe(2);
  });

  it("ImportResult.melodicParts ist undefined wenn keine melodischen Channels", async () => {
    // FLP mit NUR drum-Channel
    const drumHeader = new Uint8Array(14);
    const hv = new DataView(drumHeader.buffer);
    drumHeader.set([0x46, 0x4c, 0x68, 0x64], 0);
    hv.setUint32(4, 6, true);
    hv.setUint16(8, 0, true);
    hv.setUint16(10, 1, true);
    hv.setUint16(12, 96, true);
    const noteBuf = (pos: number) => {
      const buf = new Uint8Array(24);
      const v = new DataView(buf.buffer);
      v.setUint32(0, pos, true);
      v.setUint16(6, 0, true);
      v.setUint32(8, 24, true);
      v.setUint8(12, 36); // alle gleiche Pitch
      v.setUint8(18, 100);
      return buf;
    };
    const payload = new Uint8Array(48);
    payload.set(noteBuf(0), 0);
    payload.set(noteBuf(96), 24);
    const newPattern = new Uint8Array([0x4f, 0x01, 0x00]);
    const eventHdr = new Uint8Array([0xe7, 48]);
    const chunk = new Uint8Array(newPattern.length + eventHdr.length + payload.length);
    chunk.set(newPattern, 0);
    chunk.set(eventHdr, newPattern.length);
    chunk.set(payload, newPattern.length + eventHdr.length);
    const dataHdr = new Uint8Array(8);
    dataHdr.set([0x46, 0x4c, 0x64, 0x74], 0);
    new DataView(dataHdr.buffer).setUint32(4, chunk.length, true);
    const total = new Uint8Array(drumHeader.length + dataHdr.length + chunk.length);
    total.set(drumHeader, 0);
    total.set(dataHdr, drumHeader.length);
    total.set(chunk, drumHeader.length + dataHdr.length);

    const result = await importFlp(makeFile("drumonly.flp", total.buffer));
    expect(result.melodicParts).toBeUndefined();
  });
});

describe("buildMelodicParts (v1.65)", () => {
  it("leerer Notes-Array → leeres Result", () => {
    expect(buildMelodicParts([], 96)).toEqual([]);
  });

  it("drum-only-Channel (1 Pitch) wird nicht in melodicParts aufgenommen", () => {
    const notes = [
      { position: 0,  channel: 0, duration: 24, key: 36, velocity: 100 },
      { position: 24, channel: 0, duration: 24, key: 36, velocity: 100 },
    ];
    expect(buildMelodicParts(notes, 96)).toEqual([]);
  });

  it("melodischer Channel wird mit Note-Daten extrahiert", () => {
    const notes = [
      { position: 0,  channel: 2, duration: 48, key: 60, velocity: 100 },
      { position: 48, channel: 2, duration: 48, key: 64, velocity: 80 },
    ];
    const parts = buildMelodicParts(notes, 96);
    expect(parts).toHaveLength(1);
    expect(parts[0].sourceChannel).toBe(2);
    expect(parts[0].notes).toHaveLength(2);
    expect(parts[0].notes[0]).toEqual({ startStep: 0, durationSteps: 2, pitch: 60, velocity: 100 });
    expect(parts[0].notes[1]).toEqual({ startStep: 2, durationSteps: 2, pitch: 64, velocity: 80 });
  });

  it("Notes sind nach startStep sortiert auch wenn Quell-Reihenfolge anders", () => {
    const notes = [
      { position: 96, channel: 0, duration: 24, key: 64, velocity: 100 },
      { position: 0,  channel: 0, duration: 24, key: 60, velocity: 100 },
      { position: 48, channel: 0, duration: 24, key: 62, velocity: 100 },
    ];
    const parts = buildMelodicParts(notes, 96);
    expect(parts[0].notes.map(n => n.startStep)).toEqual([0, 2, 4]);
    expect(parts[0].notes.map(n => n.pitch)).toEqual([60, 62, 64]);
  });

  it("trennt mehrere melodische Channels in eigene Parts", () => {
    const notes = [
      { position: 0, channel: 0, duration: 24, key: 36, velocity: 100 }, // drum
      { position: 0, channel: 1, duration: 24, key: 60, velocity: 100 }, // mel 1
      { position: 0, channel: 1, duration: 24, key: 62, velocity: 100 },
      { position: 0, channel: 2, duration: 24, key: 80, velocity: 100 }, // mel 2
      { position: 0, channel: 2, duration: 24, key: 84, velocity: 100 },
    ];
    const parts = buildMelodicParts(notes, 96);
    expect(parts).toHaveLength(2);
    expect(parts.map(p => p.sourceChannel).sort()).toEqual([1, 2]);
  });
});

// ─── routeMelodicPartsToPatterns (v1.66, FLP-MELODIC-ROUTE Phase 2) ───────────

describe("routeMelodicPartsToPatterns (v1.66)", () => {
  function makePatterns(barCount: number, partCount = 8) {
    return Array.from({ length: barCount }, (_, b) => ({
      parts: Array.from({ length: partCount }, (_, p) => ({ id: `pat${b}-part${p}` })),
    }));
  }

  it("leeres / undefined melodicParts → keine Mappings, keine Warnungen", () => {
    const patterns = makePatterns(1);
    expect(routeMelodicPartsToPatterns(undefined, patterns)).toEqual({
      mappings: [],
      warnings: [],
    });
    expect(routeMelodicPartsToPatterns([], patterns)).toEqual({
      mappings: [],
      warnings: [],
    });
  });

  it("warnt wenn melodicParts vorhanden aber keine Drum-Patterns als Ziel", () => {
    const melodic: ImportedMelodicPart[] = [
      { sourceChannel: 0, name: "ch0", notes: [{ startStep: 0, durationSteps: 1, pitch: 60, velocity: 100 }] },
    ];
    const result = routeMelodicPartsToPatterns(melodic, []);
    expect(result.mappings).toEqual([]);
    expect(result.warnings.some(w => w.includes("Routing-Ziel"))).toBe(true);
  });

  it("mappt Note auf korrekten partId via sourceChannel % partCount", () => {
    const melodic: ImportedMelodicPart[] = [
      // channel 9 → mit partCount=8 → partIdx = 1
      { sourceChannel: 9, name: "ch9", notes: [{ startStep: 3, durationSteps: 1, pitch: 64, velocity: 90 }] },
    ];
    const patterns = makePatterns(1);
    const { mappings, warnings } = routeMelodicPartsToPatterns(melodic, patterns);
    expect(warnings).toEqual([]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toEqual({ partId: "pat0-part1", stepIdx: 3, pitch: 64, velocity: 90 });
  });

  it("Multi-Bar: Note bei startStep=18 → bar=1, stepIdx=2 (mit 16-Step-Bars)", () => {
    const melodic: ImportedMelodicPart[] = [
      { sourceChannel: 0, name: "x", notes: [
        { startStep: 0,  durationSteps: 1, pitch: 60, velocity: 100 },
        { startStep: 18, durationSteps: 1, pitch: 62, velocity: 100 },
      ] },
    ];
    const patterns = makePatterns(2);
    const { mappings, warnings } = routeMelodicPartsToPatterns(melodic, patterns);
    expect(warnings).toEqual([]);
    expect(mappings).toHaveLength(2);
    const sorted = [...mappings].sort((a, b) => a.partId.localeCompare(b.partId));
    expect(sorted[0]).toEqual({ partId: "pat0-part0", stepIdx: 0,  pitch: 60, velocity: 100 });
    expect(sorted[1]).toEqual({ partId: "pat1-part0", stepIdx: 2,  pitch: 62, velocity: 100 });
  });

  it("rundet float startStep auf 16-Step-Grid", () => {
    const melodic: ImportedMelodicPart[] = [
      { sourceChannel: 0, name: "x", notes: [
        { startStep: 3.4, durationSteps: 1, pitch: 60, velocity: 100 }, // → 3
        { startStep: 3.6, durationSteps: 1, pitch: 62, velocity: 100 }, // → 4
      ] },
    ];
    const patterns = makePatterns(1);
    const { mappings } = routeMelodicPartsToPatterns(melodic, patterns);
    expect(mappings.map(m => m.stepIdx).sort()).toEqual([3, 4]);
  });

  it("Konflikt zwei Notes auf gleichem (partId,stepIdx) → letzte gewinnt + Warning", () => {
    const melodic: ImportedMelodicPart[] = [
      { sourceChannel: 0, name: "x", notes: [
        { startStep: 5, durationSteps: 1, pitch: 60, velocity: 100 },
        { startStep: 5, durationSteps: 1, pitch: 72, velocity: 80 }, // overwrites
      ] },
    ];
    const patterns = makePatterns(1);
    const { mappings, warnings } = routeMelodicPartsToPatterns(melodic, patterns);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].pitch).toBe(72);
    expect(mappings[0].velocity).toBe(80);
    expect(warnings.some(w => w.includes("bereits belegt") && w.includes("16-Step-Grid"))).toBe(true);
  });

  it("Notes jenseits der importierten Bars werden verworfen + Warning", () => {
    const melodic: ImportedMelodicPart[] = [
      { sourceChannel: 0, name: "x", notes: [
        { startStep: 0,  durationSteps: 1, pitch: 60, velocity: 100 },
        { startStep: 99, durationSteps: 1, pitch: 70, velocity: 100 }, // out of range
      ] },
    ];
    const patterns = makePatterns(1); // nur 1 Bar = 16 Steps
    const { mappings, warnings } = routeMelodicPartsToPatterns(melodic, patterns);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].pitch).toBe(60);
    expect(warnings.some(w => w.includes("außerhalb"))).toBe(true);
  });

  it("Mehrere Channels routen unabhängig — partIdx via modulo", () => {
    const melodic: ImportedMelodicPart[] = [
      { sourceChannel: 1, name: "ch1", notes: [{ startStep: 0, durationSteps: 1, pitch: 60, velocity: 100 }] },
      { sourceChannel: 3, name: "ch3", notes: [{ startStep: 4, durationSteps: 1, pitch: 64, velocity: 100 }] },
    ];
    const patterns = makePatterns(1);
    const { mappings } = routeMelodicPartsToPatterns(melodic, patterns);
    expect(mappings).toHaveLength(2);
    const byPart = Object.fromEntries(mappings.map(m => [m.partId, m]));
    expect(byPart["pat0-part1"].pitch).toBe(60);
    expect(byPart["pat0-part3"].pitch).toBe(64);
  });

  it("velocity wird 1:1 weitergereicht (kein Clamp bei route, nur beim Store)", () => {
    const melodic: ImportedMelodicPart[] = [
      { sourceChannel: 0, name: "x", notes: [{ startStep: 0, durationSteps: 1, pitch: 60, velocity: 200 }] },
    ];
    const patterns = makePatterns(1);
    const { mappings } = routeMelodicPartsToPatterns(melodic, patterns);
    expect(mappings[0].velocity).toBe(200);
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
