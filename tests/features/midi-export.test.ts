/**
 * Synthstudio – midiExport Tests (v2.59)
 *
 * Pure-Coverage für utils/midiExport.ts:
 *   - writeVarLen: MIDI Variable-Length-Quantity-Encoding (1-4 Bytes)
 *   - guessNote: GM-Drum-Map-Lookup-Heuristik + Index-Fallback
 *   - GM_DRUM_NOTES: Schema-Invarianten
 *   - exportMidiBundle: Header-Format + Track-Count + binäre Struktur
 */
import { describe, it, expect } from "vitest";
import {
  writeVarLen,
  guessNote,
  GM_DRUM_NOTES,
  exportMidiBundle,
} from "../../client/src/utils/midiExport";
import type { PatternData, PartData } from "../../client/src/audio/AudioEngine";

// ─── writeVarLen ─────────────────────────────────────────────────────────────

describe("writeVarLen — Variable-Length-Quantity-Encoding", () => {
  it("Werte 0..127: ein Byte ohne Continuation-Bit", () => {
    const out: number[] = [];
    writeVarLen(out, 0);
    expect(out).toEqual([0]);

    out.length = 0;
    writeVarLen(out, 127);
    expect(out).toEqual([127]);
  });

  it("Wert 0x80 (128): zwei Bytes — 0x81 0x00", () => {
    const out: number[] = [];
    writeVarLen(out, 0x80);
    expect(out).toEqual([0x81, 0x00]);
  });

  it("Wert 0x3FFF (16383): zwei Bytes — 0xFF 0x7F (Grenze)", () => {
    const out: number[] = [];
    writeVarLen(out, 0x3FFF);
    expect(out).toEqual([0xFF, 0x7F]);
  });

  it("Wert 0x4000 (16384): drei Bytes (überschreitet 14-Bit-Grenze)", () => {
    const out: number[] = [];
    writeVarLen(out, 0x4000);
    expect(out).toEqual([0x81, 0x80, 0x00]);
  });

  it("Wert 0x1FFFFF: drei Bytes (Grenze 21-Bit)", () => {
    const out: number[] = [];
    writeVarLen(out, 0x1FFFFF);
    expect(out).toEqual([0xFF, 0xFF, 0x7F]);
  });

  it("Wert 0x200000: vier Bytes (überschreitet 21-Bit)", () => {
    const out: number[] = [];
    writeVarLen(out, 0x200000);
    expect(out).toEqual([0x81, 0x80, 0x80, 0x00]);
  });

  it("Beispiel aus MIDI-Spec: 0x40 → [0x40]", () => {
    const out: number[] = [];
    writeVarLen(out, 0x40);
    expect(out).toEqual([0x40]);
  });

  it("Beispiel aus MIDI-Spec: 0x2000 → [0xC0, 0x00]", () => {
    const out: number[] = [];
    writeVarLen(out, 0x2000);
    expect(out).toEqual([0xC0, 0x00]);
  });

  it("writeVarLen appended an bestehendes Array (kein clear)", () => {
    const out: number[] = [0x99, 0x88];
    writeVarLen(out, 0x40);
    expect(out).toEqual([0x99, 0x88, 0x40]);
  });

  it("Continuation-Bit-Pattern: alle non-letzten Bytes haben MSB=1", () => {
    const out: number[] = [];
    writeVarLen(out, 0x123456);
    // Alle bis auf den letzten Eintrag müssen 0x80-Bit gesetzt haben
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i] & 0x80).toBe(0x80);
    }
    expect(out[out.length - 1] & 0x80).toBe(0);
  });
});

// ─── guessNote ───────────────────────────────────────────────────────────────

describe("guessNote — Drum-Name → GM-Note-Heuristik", () => {
  it("'Kick' → 36 (GM Bass Drum 1)", () => {
    expect(guessNote("Kick", 0)).toBe(36);
  });

  it("Case-insensitive: 'KICK', 'kick', 'Kick Drum' alle → 36", () => {
    expect(guessNote("KICK", 0)).toBe(36);
    expect(guessNote("Kick Drum", 0)).toBe(36);
  });

  it("'Snare' → 38, 'Clap' → 39", () => {
    expect(guessNote("Snare", 0)).toBe(38);
    expect(guessNote("Clap", 0)).toBe(39);
  });

  it("'Hi-Hat' und 'HiHat' → 42 (gleicher Bucket)", () => {
    expect(guessNote("Hi-Hat", 0)).toBe(42);
    expect(guessNote("HiHat", 0)).toBe(42);
    expect(guessNote("Closed Hat", 0)).toBe(42);
  });

  it("'Open Hat' / 'OH' → 46", () => {
    expect(guessNote("Open Hat", 0)).toBe(46);
    expect(guessNote("Openhat", 0)).toBe(46);
  });

  it("'Perc' → 75, 'FX' → 56", () => {
    expect(guessNote("Perc", 0)).toBe(75);
    expect(guessNote("FX", 0)).toBe(56);
  });

  it("Unbekannter Name → Fallback 36 + (idx % 32)", () => {
    expect(guessNote("Unknown", 0)).toBe(36);
    expect(guessNote("Unknown", 1)).toBe(37);
    expect(guessNote("Unknown", 32)).toBe(36); // wraparound
  });

  it("Substring-Match: 'Vocal Kicker' enthält 'kick' → 36", () => {
    expect(guessNote("Vocal Kicker", 5)).toBe(36);
  });
});

describe("GM_DRUM_NOTES — Schema", () => {
  it("Alle Werte sind valide GM-Drum-Noten (35..81)", () => {
    for (const note of Object.values(GM_DRUM_NOTES)) {
      expect(note).toBeGreaterThanOrEqual(35);
      expect(note).toBeLessThanOrEqual(81);
    }
  });

  it("Bass-Aliase mappen auf gleiche Note", () => {
    expect(GM_DRUM_NOTES.kick).toBe(GM_DRUM_NOTES.bass);
    expect(GM_DRUM_NOTES.kick).toBe(GM_DRUM_NOTES.bd);
  });

  it("HiHat-Aliase sind konsistent", () => {
    const hh = GM_DRUM_NOTES["hi-hat"];
    expect(GM_DRUM_NOTES.hihat).toBe(hh);
    expect(GM_DRUM_NOTES.hat).toBe(hh);
    expect(GM_DRUM_NOTES.hh).toBe(hh);
  });
});

// ─── exportMidiBundle — Binary-Format ─────────────────────────────────────────

function makePart(id: string, name: string, activeSteps: number[]): PartData {
  const steps = Array.from({ length: 16 }, (_, i) => ({
    active: activeSteps.includes(i),
    velocity: 100,
    pitch: 0,
  }));
  return {
    id, name, sampleUrl: undefined,
    muted: false, soloed: false, volume: 1, pan: 0,
    stepResolution: undefined, steps,
    fx: {} as PartData["fx"],
  };
}

function makePattern(id: string, name: string, parts: PartData[]): PatternData {
  return {
    id, name, parts,
    stepCount: 16, bpm: null, stepResolution: "1/16",
  } as PatternData;
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("exportMidiBundle — Binary-Format", () => {
  it("MIDI-Header: 'MThd' + Format 1 + TPQN 480", async () => {
    const bytes = await blobToBytes(exportMidiBundle([], 120));
    // 'MThd' Magic Bytes
    expect(bytes[0]).toBe(0x4D); // M
    expect(bytes[1]).toBe(0x54); // T
    expect(bytes[2]).toBe(0x68); // h
    expect(bytes[3]).toBe(0x64); // d
    // Header-Length = 6 (Big-Endian U32 at offset 4)
    expect(bytes[4]).toBe(0); expect(bytes[5]).toBe(0);
    expect(bytes[6]).toBe(0); expect(bytes[7]).toBe(6);
    // Format = 1 (Big-Endian U16 at offset 8)
    expect(bytes[8]).toBe(0); expect(bytes[9]).toBe(1);
    // TPQN = 480 (= 0x01E0 at offset 12)
    expect(bytes[12]).toBe(0x01); expect(bytes[13]).toBe(0xE0);
  });

  it("numTracks = 1 (Tempo) + N (Pattern-Tracks)", async () => {
    const empty = await blobToBytes(exportMidiBundle([], 120));
    // Bei 0 Patterns: numTracks = 1 (nur Tempo)
    expect(empty[10]).toBe(0); expect(empty[11]).toBe(1);

    const onePat = makePattern("p1", "Pattern A", []);
    const twoPats = await blobToBytes(exportMidiBundle([onePat, onePat], 120));
    // Bei 2 Patterns: numTracks = 3
    expect(twoPats[10]).toBe(0); expect(twoPats[11]).toBe(3);
  });

  it("Tempo-Track encodet BPM korrekt: 120 BPM = 500000 μs/Quarter-Note", async () => {
    const bytes = await blobToBytes(exportMidiBundle([], 120));
    // Suche „MTrk" — der Tempo-Track ist direkt nach dem 14-Byte-Header
    expect(bytes[14]).toBe(0x4D); // M
    expect(bytes[15]).toBe(0x54); // T
    expect(bytes[16]).toBe(0x72); // r
    expect(bytes[17]).toBe(0x6B); // k
    // Track-Body beginnt bei Offset 22 (14 + 8)
    // Erstes Event: delta=0 (varlen 1 Byte), Status 0xFF Meta, 0x51 Tempo, 0x03 Length
    expect(bytes[22]).toBe(0x00); // delta
    expect(bytes[23]).toBe(0xFF); // meta
    expect(bytes[24]).toBe(0x51); // tempo
    expect(bytes[25]).toBe(0x03); // length
    // Tempo-Bytes: 500000 μs = 0x07A120
    expect(bytes[26]).toBe(0x07);
    expect(bytes[27]).toBe(0xA1);
    expect(bytes[28]).toBe(0x20);
  });

  it("Tempo-Track encodet 60 BPM = 1000000 μs/Quarter-Note", async () => {
    const bytes = await blobToBytes(exportMidiBundle([], 60));
    // Tempo-Bytes bei Offset 26: 1000000 = 0x0F4240
    expect(bytes[26]).toBe(0x0F);
    expect(bytes[27]).toBe(0x42);
    expect(bytes[28]).toBe(0x40);
  });

  it("Pattern-Track-Body enthält Track-Name als FF 03 Meta-Event", async () => {
    const pattern = makePattern("p1", "Hello", []);
    const bytes = await blobToBytes(exportMidiBundle([pattern], 120));
    // Suche „Hello" als ASCII-Bytes im Output
    const text = Array.from(bytes).map(b => String.fromCharCode(b)).join("");
    expect(text).toContain("Hello");
  });

  it("Note-On für active Step: 0x99 (NoteOn Ch10) + Note + Velocity", async () => {
    // Pattern mit einem aktiven Step auf Position 0 ("Kick" → GM Note 36)
    const part = makePart("p1", "Kick", [0]);
    const pattern = makePattern("pat1", "K1", [part]);
    const bytes = await blobToBytes(exportMidiBundle([pattern], 120));

    // 0x99 = NoteOn auf Channel 10 (drum channel)
    let hasNoteOn = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x99 && bytes[i + 1] === 36 && bytes[i + 2] === 100) {
        hasNoteOn = true;
        break;
      }
    }
    expect(hasNoteOn).toBe(true);
  });

  it("Blob hat MIME-Type 'audio/midi'", async () => {
    const blob = exportMidiBundle([], 120);
    expect(blob.type).toBe("audio/midi");
  });

  it("Leeres Pattern-Array: nur Tempo-Track, kein Crash", async () => {
    const bytes = await blobToBytes(exportMidiBundle([], 120));
    // Mindestens Header (14) + Track-Header (8) + min. EOT-Event
    expect(bytes.length).toBeGreaterThanOrEqual(22);
  });

  it("Roundtrip: gleiches Pattern + BPM produziert gleiches Bundle", async () => {
    const pattern = makePattern("p1", "Test", [makePart("kp", "Kick", [0, 4, 8, 12])]);
    const a = await blobToBytes(exportMidiBundle([pattern], 130));
    const b = await blobToBytes(exportMidiBundle([pattern], 130));
    expect(a).toEqual(b);
  });
});
