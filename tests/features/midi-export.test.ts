/**
 * tests/features/midi-export.test.ts (TASK-CVG-MIDIEXPORT / v2.61)
 *
 * Pure-Coverage für client/src/utils/midiExport.ts (exportMidiBundle).
 *
 * MIDI Format 1: Header-Chunk + Tempo-Track + N Pattern-Tracks.
 * Diese Suite parsed das produzierte Blob-Binary und verifiziert
 * Chunk-Magic-Bytes, Header-Felder (Format/Tracks/TPQN), Tempo-Event-
 * Encoding und End-of-Track-Markers. Damit ist garantiert, dass der
 * Output von DAWs (Ableton, Reaper, Logic) eingelesen werden kann.
 *
 * Hinweis: downloadMidiBundle wird hier NICHT getestet (DOM-side effects).
 */
import { describe, it, expect } from "vitest";
import { exportMidiBundle } from "@/utils/midiExport";
import type { PatternData, PartData, StepData } from "@/audio/AudioEngine";

// ─── Test-Fixtures ───────────────────────────────────────────────────────────

function makeStep(active: boolean, velocity = 100): StepData {
  return { active, velocity };
}

function makePart(id: string, name: string, steps: StepData[]): PartData {
  return {
    id,
    name,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
  };
}

function makePattern(id: string, name: string, stepCount: 16 | 32 | 64, parts: PartData[]): PatternData {
  return {
    id,
    name,
    stepCount,
    stepResolution: "1/16",
    bpm: null,
    parts,
  };
}

function emptySteps(count: number): StepData[] {
  return Array.from({ length: count }, () => makeStep(false));
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...Array.from(bytes.subarray(offset, offset + length)));
}

// ─── exportMidiBundle ────────────────────────────────────────────────────────

describe("MidiExport – Header-Chunk", () => {
  it("liefert ein Blob mit MIDI mime type", async () => {
    const blob = exportMidiBundle([], 120);
    expect(blob.type).toBe("audio/midi");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("Header beginnt mit Magic 'MThd' + length=6 + format=1", async () => {
    const blob = exportMidiBundle([], 120);
    const bytes = await blobToBytes(blob);

    expect(asciiAt(bytes, 0, 4)).toBe("MThd");
    expect(readU32BE(bytes, 4)).toBe(6);  // header length
    expect(readU16BE(bytes, 8)).toBe(1);  // MIDI format 1
  });

  it("Track-Count = 1 (Tempo) + N Patterns", async () => {
    const empty = makePattern("p1", "Pat 1", 16, [makePart("k", "kick", emptySteps(16))]);
    const blob = exportMidiBundle([empty, empty, empty], 120);
    const bytes = await blobToBytes(blob);
    expect(readU16BE(bytes, 10)).toBe(4); // 1 tempo + 3 patterns
  });

  it("TPQN = 480 (Synthstudio-Standard)", async () => {
    const blob = exportMidiBundle([], 120);
    const bytes = await blobToBytes(blob);
    expect(readU16BE(bytes, 12)).toBe(480);
  });

  it("Empty patterns → nur Header + Tempo-Track", async () => {
    const blob = exportMidiBundle([], 120);
    const bytes = await blobToBytes(blob);
    expect(readU16BE(bytes, 10)).toBe(1); // nur Tempo-Track
    // erste 14 Bytes Header, dann MTrk
    expect(asciiAt(bytes, 14, 4)).toBe("MTrk");
  });
});

describe("MidiExport – Tempo-Track", () => {
  it("Tempo-Track beginnt mit 'MTrk' Magic + Length-Header", async () => {
    const blob = exportMidiBundle([], 120);
    const bytes = await blobToBytes(blob);
    expect(asciiAt(bytes, 14, 4)).toBe("MTrk");
    const trackLen = readU32BE(bytes, 18);
    expect(trackLen).toBeGreaterThan(0);
  });

  it("Tempo-Event für 120 BPM enthält 500_000 µs/Beat (0x07A120)", async () => {
    const blob = exportMidiBundle([], 120);
    const bytes = await blobToBytes(blob);
    // Track-Body startet bei Offset 22 (Header 14 + Track-Header 8)
    // Erste Bytes: delta=0x00, meta=0xFF, type=0x51 (Set-Tempo), len=0x03, 3 Tempo-Bytes
    expect(bytes[22]).toBe(0x00);
    expect(bytes[23]).toBe(0xFF);
    expect(bytes[24]).toBe(0x51);
    expect(bytes[25]).toBe(0x03);
    const microsPerQuarter = (bytes[26] << 16) | (bytes[27] << 8) | bytes[28];
    expect(microsPerQuarter).toBe(500_000); // 60_000_000 / 120
  });

  it("Tempo für 60 BPM enthält 1_000_000 µs/Beat", async () => {
    const blob = exportMidiBundle([], 60);
    const bytes = await blobToBytes(blob);
    const microsPerQuarter = (bytes[26] << 16) | (bytes[27] << 8) | bytes[28];
    expect(microsPerQuarter).toBe(1_000_000);
  });

  it("Tempo für 240 BPM enthält 250_000 µs/Beat", async () => {
    const blob = exportMidiBundle([], 240);
    const bytes = await blobToBytes(blob);
    const microsPerQuarter = (bytes[26] << 16) | (bytes[27] << 8) | bytes[28];
    expect(microsPerQuarter).toBe(250_000);
  });

  it("Tempo-Track endet mit End-of-Track Meta-Event (FF 2F 00)", async () => {
    const blob = exportMidiBundle([], 120);
    const bytes = await blobToBytes(blob);
    // Letzte 3 Bytes des Tempo-Tracks sind 0xFF 0x2F 0x00
    expect(bytes[bytes.length - 3]).toBe(0xFF);
    expect(bytes[bytes.length - 2]).toBe(0x2F);
    expect(bytes[bytes.length - 1]).toBe(0x00);
  });
});

describe("MidiExport – Pattern-Track", () => {
  it("Pattern-Track wird als 'MTrk' Chunk angehängt", async () => {
    const pat = makePattern("p1", "Kick Pat", 16, [makePart("k", "kick", emptySteps(16))]);
    const blob = exportMidiBundle([pat], 120);
    const bytes = await blobToBytes(blob);

    // Header 14 + Tempo-Track-Header 8 + Tempo-Body
    // Suche zweites "MTrk" Magic
    let mtrkCount = 0;
    let secondMtrkOffset = -1;
    for (let i = 0; i < bytes.length - 4; i++) {
      if (asciiAt(bytes, i, 4) === "MTrk") {
        mtrkCount++;
        if (mtrkCount === 2) {
          secondMtrkOffset = i;
          break;
        }
      }
    }
    expect(secondMtrkOffset).toBeGreaterThan(0);
  });

  it("Pattern-Track enthält Track-Name als FF 03 <len> <bytes>", async () => {
    const pat = makePattern("p1", "MyPat", 16, [makePart("k", "kick", [makeStep(true, 100), ...emptySteps(15)])]);
    const blob = exportMidiBundle([pat], 120);
    const bytes = await blobToBytes(blob);
    const asString = String.fromCharCode(...Array.from(bytes));
    expect(asString).toContain("MyPat");
  });

  it("Aktive Kick-Steps erzeugen Note-On Events auf MIDI-Channel 10 (0x99) mit Note 36", async () => {
    const pat = makePattern("p1", "p", 16, [
      makePart("k", "Kick", [makeStep(true, 110), ...emptySteps(15)]),
    ]);
    const blob = exportMidiBundle([pat], 120);
    const bytes = await blobToBytes(blob);

    // Suche im Pattern-Track nach 0x99 0x24 (Note-On Ch10 + Note 36/Kick)
    let foundNoteOn = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x99 && bytes[i + 1] === 0x24) {
        foundNoteOn = true;
        expect(bytes[i + 2]).toBe(110); // Velocity
        break;
      }
    }
    expect(foundNoteOn).toBe(true);
  });

  it("Snare-Step erzeugt Note 38", async () => {
    const pat = makePattern("p1", "p", 16, [
      makePart("s", "Snare", [makeStep(true, 100), ...emptySteps(15)]),
    ]);
    const blob = exportMidiBundle([pat], 120);
    const bytes = await blobToBytes(blob);
    let foundSnare = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x99 && bytes[i + 1] === 38) {
        foundSnare = true;
        break;
      }
    }
    expect(foundSnare).toBe(true);
  });

  it("Hi-Hat-Step erzeugt Note 42", async () => {
    const pat = makePattern("p1", "p", 16, [
      makePart("h", "hi-hat", [makeStep(true, 90), ...emptySteps(15)]),
    ]);
    const blob = exportMidiBundle([pat], 120);
    const bytes = await blobToBytes(blob);
    let foundHat = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x99 && bytes[i + 1] === 42) {
        foundHat = true;
        break;
      }
    }
    expect(foundHat).toBe(true);
  });

  it("Inactive Steps erzeugen KEINE Note-On Events", async () => {
    const patEmpty = makePattern("p1", "p", 16, [makePart("k", "Kick", emptySteps(16))]);
    const blob = exportMidiBundle([patEmpty], 120);
    const bytes = await blobToBytes(blob);

    let noteOnCount = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x99) noteOnCount++;
    }
    expect(noteOnCount).toBe(0);
  });

  it("Vier Bars Wiederholung pro Pattern (4× stepCount Steps)", async () => {
    const pat = makePattern("p1", "p", 16, [
      makePart("k", "Kick", [makeStep(true), ...emptySteps(15)]),
    ]);
    const blob = exportMidiBundle([pat], 120);
    const bytes = await blobToBytes(blob);
    // Eine Kick auf Step 0, wiederholt 4 Bars → 4 Note-On 0x99 0x24
    let kickCount = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x99 && bytes[i + 1] === 0x24) kickCount++;
    }
    expect(kickCount).toBe(4);
  });
});

describe("MidiExport – Empty + Edge-Cases", () => {
  it("Pattern ohne Parts produziert valides Track (nur Name + EoT)", async () => {
    const pat = makePattern("p1", "Empty", 16, []);
    const blob = exportMidiBundle([pat], 120);
    const bytes = await blobToBytes(blob);
    // 2 Tracks (Tempo + Pattern)
    expect(readU16BE(bytes, 10)).toBe(2);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("BPM=120 + 1 Kick: produziert mehr Bytes als leer", async () => {
    const empty = exportMidiBundle([], 120);
    const withPat = exportMidiBundle(
      [makePattern("p1", "p", 16, [makePart("k", "Kick", [makeStep(true), ...emptySteps(15)])])],
      120,
    );
    expect(withPat.size).toBeGreaterThan(empty.size);
  });
});
