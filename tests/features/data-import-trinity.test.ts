/**
 * data-import-trinity.test.ts — Sprint-98: Sample + Song Importer Tests.
 *
 * Pattern-Importer (electribeImport.ts) ist bereits separat getestet.
 * Hier neu:
 *   - sampleImport.ts (WAV-Metadata)
 *   - e2songImport.ts (OmniTribe-Song-Format)
 */

import { describe, it, expect } from "vitest";

import {
  importWavSample,
  isWavSample,
} from "../../client/src/utils/imports/sampleImport";
import {
  importE2Song,
  isE2Song,
  TransitionMode,
  SongFlags,
} from "../../client/src/utils/imports/e2songImport";
import { ImportError } from "../../client/src/utils/imports/types";

// ─── Helpers: synth wav + e2song builder ──────────────────

function buildMinimalWav({
  sampleRate = 44100,
  channels = 1,
  bitDepth = 16,
  formatTag = 1,         // PCM
  frameCount = 1000,
}: {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  formatTag?: number;
  frameCount?: number;
} = {}): Uint8Array {
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = frameCount * blockAlign;
  const fmtSize = 16;
  const totalSize = 4 + 8 + fmtSize + 8 + dataSize;

  const buf = new Uint8Array(8 + totalSize);
  const view = new DataView(buf.buffer);
  let pos = 0;
  // RIFF header
  buf.set([0x52, 0x49, 0x46, 0x46], pos); pos += 4;
  view.setUint32(pos, totalSize, true); pos += 4;
  buf.set([0x57, 0x41, 0x56, 0x45], pos); pos += 4;
  // fmt chunk
  buf.set([0x66, 0x6D, 0x74, 0x20], pos); pos += 4;
  view.setUint32(pos, fmtSize, true); pos += 4;
  view.setUint16(pos, formatTag, true); pos += 2;
  view.setUint16(pos, channels, true); pos += 2;
  view.setUint32(pos, sampleRate, true); pos += 4;
  view.setUint32(pos, sampleRate * blockAlign, true); pos += 4;  // byterate
  view.setUint16(pos, blockAlign, true); pos += 2;
  view.setUint16(pos, bitDepth, true); pos += 2;
  // data chunk
  buf.set([0x64, 0x61, 0x74, 0x61], pos); pos += 4;
  view.setUint32(pos, dataSize, true); pos += 4;
  // (audio frames left as zero — irrelevant fuer Metadata-Tests)
  return buf;
}

function buildMinimalE2Song({
  name = "TEST",
  globalTempo = 12000,    // 120.00 BPM
  flags = 0,
  sections = [] as Array<{
    patternSlot: number;
    repeatCount: number;
    transitionMode: number;
    transitionBeats: number;
    flags: number;
    label: string;
  }>,
}: Parameters<typeof importE2Song>[0] extends infer _ ? {
  name?: string;
  globalTempo?: number;
  flags?: number;
  sections?: Array<{
    patternSlot: number;
    repeatCount: number;
    transitionMode: number;
    transitionBeats: number;
    flags: number;
    label: string;
  }>;
} : never = {}): Uint8Array {
  const fullSize = 0x40 + 64 * 16;
  const buf = new Uint8Array(fullSize);
  const view = new DataView(buf.buffer);
  // Magic
  for (let i = 0; i < 8; i++) buf[i] = "OMNTSONG".charCodeAt(i);
  view.setUint16(8, 1, true);                   // version
  view.setUint16(10, sections.length, true);   // section_count
  // name (32 B, zero-padded)
  const nameBytes = new TextEncoder().encode(name).slice(0, 32);
  buf.set(nameBytes, 12);
  view.setUint16(0x2C, globalTempo, true);
  view.setUint16(0x2E, flags, true);
  // Sections
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const base = 0x40 + i * 16;
    view.setUint16(base + 0, s.patternSlot, true);
    view.setUint16(base + 2, s.repeatCount, true);
    view.setUint8(base + 4, s.transitionMode);
    view.setUint8(base + 5, s.transitionBeats);
    view.setUint16(base + 6, s.flags, true);
    const labelBytes = new TextEncoder().encode(s.label).slice(0, 8);
    buf.set(labelBytes, base + 8);
  }
  return buf;
}

// ─── WAV Sample Importer ───────────────────────────────

describe("sampleImport (WAV)", () => {
  it("isWavSample detects RIFF/WAVE magic", () => {
    const wav = buildMinimalWav();
    expect(isWavSample(wav)).toBe(true);
    expect(isWavSample(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("imports basic 16-bit mono 44100Hz WAV", () => {
    const wav = buildMinimalWav({ sampleRate: 44100, channels: 1, bitDepth: 16,
      frameCount: 22050 });
    const result = importWavSample(wav, "kick.wav");
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(1);
    expect(result.bitDepth).toBe(16);
    expect(result.frameCount).toBe(22050);
    expect(result.durationSec).toBeCloseTo(0.5);
    expect(result.isPcm8).toBe(false);
    expect(result.isFloat).toBe(false);
  });

  it("imports 8-bit PCM (isPcm8 flag set)", () => {
    const wav = buildMinimalWav({ bitDepth: 8 });
    const result = importWavSample(wav);
    expect(result.isPcm8).toBe(true);
    expect(result.bitDepth).toBe(8);
  });

  it("imports 32-bit float (isFloat flag set)", () => {
    const wav = buildMinimalWav({ bitDepth: 32, formatTag: 3 });
    const result = importWavSample(wav);
    expect(result.isFloat).toBe(true);
    expect(result.bitDepth).toBe(32);
  });

  it("imports stereo WAV (channels=2)", () => {
    const wav = buildMinimalWav({ channels: 2 });
    const result = importWavSample(wav);
    expect(result.channels).toBe(2);
  });

  it("uses fileName as fallback name when INAM missing", () => {
    const result = importWavSample(buildMinimalWav(), "drum-loop.wav");
    expect(result.name).toBe("drum-loop");
  });

  it("rejects buffer too short", () => {
    expect(() => importWavSample(new Uint8Array(10))).toThrow(ImportError);
  });

  it("rejects RIFX (big-endian) variant", () => {
    const buf = buildMinimalWav();
    buf.set([0x52, 0x49, 0x46, 0x58], 0);   // "RIFX"
    expect(() => importWavSample(buf)).toThrow(/RIFX/);
  });

  it("rejects non-WAVE magic", () => {
    const buf = buildMinimalWav();
    buf.set([0x42, 0x42, 0x42, 0x42], 8);   // wrong WAVE magic
    expect(() => importWavSample(buf)).toThrow(/WAVE-Magic/);
  });
});

// ─── E2 Song Importer ──────────────────────────────────

describe("e2songImport", () => {
  it("isE2Song detects OMNTSONG magic", () => {
    const song = buildMinimalE2Song();
    expect(isE2Song(song)).toBe(true);
    expect(isE2Song(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false);
  });

  it("imports empty song (0 sections)", () => {
    const song = buildMinimalE2Song({ name: "EMPTY" });
    const result = importE2Song(song);
    expect(result.name).toBe("EMPTY");
    expect(result.sections).toHaveLength(0);
    expect(result.globalTempo).toBe(12000);
  });

  it("imports song with sections", () => {
    const song = buildMinimalE2Song({
      name: "TestSong",
      sections: [
        { patternSlot: 0, repeatCount: 4, transitionMode: TransitionMode.PATTERN_END,
          transitionBeats: 0, flags: 0, label: "Intro" },
        { patternSlot: 5, repeatCount: 2, transitionMode: TransitionMode.CROSSFADE,
          transitionBeats: 8, flags: SongFlags.RETRIG, label: "Verse" },
      ],
    });
    const result = importE2Song(song);
    expect(result.name).toBe("TestSong");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].label).toBe("Intro");
    expect(result.sections[0].repeatCount).toBe(4);
    expect(result.sections[0].transitionMode).toBe(TransitionMode.PATTERN_END);
    expect(result.sections[1].patternSlot).toBe(5);
    expect(result.sections[1].transitionMode).toBe(TransitionMode.CROSSFADE);
    expect(result.sections[1].label).toBe("Verse");
  });

  it("rejects wrong magic", () => {
    const buf = buildMinimalE2Song();
    for (let i = 0; i < 8; i++) buf[i] = 0x41;   // "AAAAAAAA"
    expect(() => importE2Song(buf)).toThrow(/Magic/);
  });

  it("rejects buffer too short for header", () => {
    expect(() => importE2Song(new Uint8Array(30))).toThrow(ImportError);
  });

  it("rejects section_count > 64", () => {
    const buf = buildMinimalE2Song();
    const view = new DataView(buf.buffer);
    view.setUint16(10, 99, true);   // 99 > 64 max
    expect(() => importE2Song(buf)).toThrow(/zu viele/);
  });

  it("global_tempo = 0 means 'use pattern tempo'", () => {
    const song = buildMinimalE2Song({ globalTempo: 0 });
    const result = importE2Song(song);
    expect(result.globalTempo).toBe(0);
  });
});
