/**
 * tests/export-bundle.test.ts
 *
 * Unit-Tests für buildWavBuffer und buildMidiBuffer aus electron/export.ts (Phase 6, v1.9).
 * Umgebung: Node – kein DOM, kein Electron-IPC.
 */
import { describe, it, expect } from "vitest";
import { buildWavBuffer, buildMidiBuffer } from "../electron/export";
import type { MidiTrack } from "../electron/export";

// ─── WAV-Buffer ───────────────────────────────────────────────────────────────

describe("buildWavBuffer – RIFF-Header", () => {
  it("beginnt mit RIFF-Kennung", () => {
    const buf = buildWavBuffer(new Float32Array(0), 44100, 1);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("enthält WAVE-Format-Kennung", () => {
    const buf = buildWavBuffer(new Float32Array(0), 44100, 1);
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("Header hat genau 44 Byte bei leerem PCM-Array", () => {
    const buf = buildWavBuffer(new Float32Array(0), 44100, 1);
    expect(buf.length).toBe(44);
  });

  it("Datenlänge = Header(44) + Samples × 2 (Int16)", () => {
    const samples = 100;
    const buf = buildWavBuffer(new Float32Array(samples), 44100, 1);
    expect(buf.length).toBe(44 + samples * 2);
  });

  it("SampleRate wird korrekt in den Header geschrieben", () => {
    const sampleRate = 48000;
    const buf = buildWavBuffer(new Float32Array(0), sampleRate, 1);
    expect(buf.readUInt32LE(24)).toBe(sampleRate);
  });

  it("Stereo: NumChannels = 2 im Header", () => {
    const buf = buildWavBuffer(new Float32Array(4), 44100, 2);
    expect(buf.readUInt16LE(22)).toBe(2);
  });
});

// ─── MIDI-Buffer ─────────────────────────────────────────────────────────────

describe("buildMidiBuffer – SMF-Header", () => {
  const emptyTracks: MidiTrack[] = [];

  it("beginnt mit MThd-Kennung", () => {
    const buf = buildMidiBuffer(emptyTracks);
    expect(buf.toString("ascii", 0, 4)).toBe("MThd");
  });

  it("Format 1 (Byte 8-9 = 0x0001)", () => {
    const buf = buildMidiBuffer(emptyTracks);
    expect(buf.readUInt16BE(8)).toBe(1);
  });

  it("ticksPerQuarter 480 als Standardwert (Byte 12-13)", () => {
    const buf = buildMidiBuffer(emptyTracks);
    expect(buf.readUInt16BE(12)).toBe(480);
  });

  it("Track-Anzahl = Eingabe-Tracks + 1 Tempo-Track", () => {
    const tracks: MidiTrack[] = [
      { name: "Kick", notes: [] },
      { name: "Snare", notes: [] },
    ];
    const buf = buildMidiBuffer(tracks);
    expect(buf.readUInt16BE(10)).toBe(3); // 2 Note-Tracks + 1 Tempo
  });

  it("Note-Events werden korrekt kodiert (Note On 0x90)", () => {
    const tracks: MidiTrack[] = [
      {
        name: "Kick",
        notes: [{ channel: 9, note: 36, velocity: 100, startTick: 0, durationTicks: 240 }],
      },
    ];
    const buf = buildMidiBuffer(tracks);
    // Suche 0x9n im Buffer (Note On auf Kanal 9 = 0x99)
    const bytes = Array.from(buf);
    expect(bytes).toContain(0x99);
    expect(bytes).toContain(36);   // MIDI-Note 36 = Bass Drum
    expect(bytes).toContain(100);  // Velocity
  });
});
