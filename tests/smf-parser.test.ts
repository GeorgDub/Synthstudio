/**
 * tests/smf-parser.test.ts
 *
 * Unit-Tests für smfParser.ts und gmDrumMap.ts (Phase 3, v1.9).
 * Umgebung: Node – kein DOM, kein Browser-API.
 * Alle MIDI-Binärdaten werden synthetisch aufgebaut (keine externe .mid-Datei).
 */
import { describe, it, expect } from "vitest";
import { parseMidiFile } from "@/utils/smfParser";
import { getGmDrumInfo, midiNotesToParts } from "@/utils/gmDrumMap";
import type { ParsedMidiNote } from "@/utils/smfParser";

// ─── Binär-Werkzeug ───────────────────────────────────────────────────────────

/**
 * Baut eine vollständige SMF-Datei aus einem Header und beliebig vielen
 * Track-Daten-Arrays zusammen.
 *
 * @param ticksPerBeat  Ticks pro Viertelrnote (PPQN), in den Header geschrieben.
 * @param format        0 = Type 0, 1 = Type 1.
 * @param tracks        Jedes Array enthält die rohen Event-Bytes eines Tracks
 *                      (ohne MTrk-Header und Längenfeld – die werden ergänzt).
 */
function buildMidiFile(
  ticksPerBeat: number,
  format: 0 | 1,
  ...tracks: number[][]
): Uint8Array {
  const numTracks = tracks.length;

  // MThd-Header (14 Bytes)
  const header: number[] = [
    0x4d, 0x54, 0x68, 0x64,            // "MThd"
    0x00, 0x00, 0x00, 0x06,            // Chunk-Länge = 6
    0x00, format,                      // Format (2 Bytes, MSB = 0)
    (numTracks >> 8) & 0xff,           // Anzahl Tracks Hi
    numTracks & 0xff,                  // Anzahl Tracks Lo
    (ticksPerBeat >> 8) & 0xff,        // PPQN Hi
    ticksPerBeat & 0xff,               // PPQN Lo
  ];

  // MTrk-Chunks
  const trackChunks: number[] = [];
  for (const trackData of tracks) {
    const len = trackData.length;
    trackChunks.push(
      0x4d, 0x54, 0x72, 0x6b,          // "MTrk"
      (len >> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      ...trackData,
    );
  }

  return new Uint8Array([...header, ...trackChunks]);
}

/** End-of-Track Meta-Event (immer am Ende eines Tracks erforderlich) */
const EOT = [0x00, 0xff, 0x2f, 0x00] as const;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseMidiFile", () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("wirft Error bei ungültigem Magic-Byte", () => {
    const badData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x00, 0x00, 0x00, 0x06]);
    expect(() => parseMidiFile(badData)).toThrow(
      /MThd|Magic|Ungültige/i,
    );
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("parst leere aber gültige Type-0-Datei (0 Notes)", () => {
    // Track enthält nur das obligatorische End-of-Track-Event
    const file = buildMidiFile(96, 0, [...EOT]);
    const result = parseMidiFile(file);

    expect(result.notes).toHaveLength(0);
    expect(result.trackCount).toBe(1);
    expect(result.bpm).toBeNull();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("findet Note-On-Events auf Channel 9 (GM Drum Channel)", () => {
    // 00 99 24 64 = delta:0, NoteOn ch10(idx9), note:36(0x24), vel:100(0x64)
    const trackData = [0x00, 0x99, 0x24, 0x64, ...EOT];
    const file = buildMidiFile(96, 0, trackData);
    const result = parseMidiFile(file);

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].note).toBe(36);
    expect(result.notes[0].velocity).toBe(100);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("ignoriert Note-Off-Events (velocity = 0)", () => {
    // Note-On mit velocity 0 gilt per MIDI-Spec als Note-Off
    const trackData = [0x00, 0x99, 0x24, 0x00, ...EOT]; // vel = 0
    const file = buildMidiFile(96, 0, trackData);
    const result = parseMidiFile(file);

    expect(result.notes).toHaveLength(0);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("extrahiert BPM aus Tempo-Event (120 BPM = 500 000 µs/Beat)", () => {
    // 500 000 dez = 0x07A120
    // Meta Set Tempo: FF 51 03 <3 Bytes µs>
    const tempoEvent = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
    const trackData = [...tempoEvent, ...EOT];
    const file = buildMidiFile(96, 0, trackData);
    const result = parseMidiFile(file);

    expect(result.bpm).toBe(120);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("liest ticksPerQuarterNote korrekt aus dem Header", () => {
    // PPQN = 480 (0x01E0) – DAW-typischer Wert
    const file = buildMidiFile(480, 0, [...EOT]);
    const result = parseMidiFile(file);

    expect(result.ticksPerQuarterNote).toBe(480);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("Quantisierung: Tick 0 (Takt-Anfang) → stepIndex 0", () => {
    // delta = 0x00 → absoluter Tick = 0
    const trackData = [0x00, 0x99, 0x24, 0x64, ...EOT];
    const file = buildMidiFile(96, 0, trackData);
    const result = parseMidiFile(file);

    expect(result.notes[0].stepIndex).toBe(0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it("Quantisierung: Tick bei Beat 2 (96 Ticks bei PPQN=96) → stepIndex 4", () => {
    // delta = 0x60 (= 96 dez, single-byte VLQ da < 128)
    // tick = 96, PPQN = 96 → round((96/96) * 4) % 16 = 4
    const trackData = [0x60, 0x99, 0x24, 0x64, ...EOT];
    const file = buildMidiFile(96, 0, trackData);
    const result = parseMidiFile(file);

    expect(result.notes[0].stepIndex).toBe(4);
  });
});

// ─── GM Drum Map Tests ────────────────────────────────────────────────────────

describe("getGmDrumInfo", () => {
  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it("Note 36 (Bass Drum 1) liefert Kategorie 'kicks'", () => {
    const info = getGmDrumInfo(36);

    expect(info.category).toBe("kicks");
    expect(info.note).toBe(36);
    expect(info.name).toBeTruthy();
  });
});

// ─── midiNotesToParts Tests ───────────────────────────────────────────────────

describe("midiNotesToParts", () => {
  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it("Noten gleicher Kategorie werden zu einem Part zusammengefasst", () => {
    const notes: ParsedMidiNote[] = [
      { note: 36, stepIndex: 0, velocity: 100 },  // Kick (Bass Drum 1)
      { note: 35, stepIndex: 4, velocity: 80 },   // Kick (Acoustic Bass Drum) – gleiche Kategorie!
      { note: 38, stepIndex: 8, velocity: 90 },   // Snare
    ];

    const parts = midiNotesToParts(notes);

    // Zwei distinkte Kategorien erwartet: kicks und snares
    expect(parts.length).toBe(2);

    const kicks = parts.find((p) => p.category === "kicks");
    expect(kicks).toBeDefined();
    // Beide Kick-Noten (36 + 35) müssen im selben Part landen
    expect(kicks!.steps).toHaveLength(2);
    expect(kicks!.steps.map((s) => s.stepIndex).sort()).toEqual([0, 4]);

    const snares = parts.find((p) => p.category === "snares");
    expect(snares).toBeDefined();
    expect(snares!.steps).toHaveLength(1);
    expect(snares!.steps[0].stepIndex).toBe(8);
    expect(snares!.steps[0].velocity).toBe(90);
  });
});
