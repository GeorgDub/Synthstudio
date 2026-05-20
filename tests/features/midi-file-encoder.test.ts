/**
 * tests/features/midi-file-encoder.test.ts (v3.175)
 *
 * Pure-Coverage fuer client/src/utils/midiFileEncoder.ts.
 *
 * Verifiziert:
 *  - VLQ-Encoding (Edge-Cases: 0, 127, 128, multi-byte)
 *  - Big-endian uint32 Encoding
 *  - SMF-Header (MThd) + Track (MTrk) Layout
 *  - Tempo/Time-Signature/Track-Name Meta-Events
 *  - Note-On/Note-Off Sequenz mit korrekter Channel-Status-Byte
 *  - End-of-Track-Marker
 *  - Track-Length-Field exakt = byte-count der Track-Data
 */
import { describe, it, expect } from "vitest";
import {
  encodeMidiFile,
  encodeVLQ,
  encodeUint32BE,
  type MidiNote,
} from "@/utils/midiFileEncoder";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function findBytes(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

describe("encodeVLQ", () => {
  it("Test 1: 0 to [0x00]", () => {
    expect(Array.from(encodeVLQ(0))).toEqual([0x00]);
  });

  it("Test 2: 127 to [0x7F]", () => {
    expect(Array.from(encodeVLQ(127))).toEqual([0x7f]);
  });

  it("Test 3: 128 to [0x81, 0x00]", () => {
    expect(Array.from(encodeVLQ(128))).toEqual([0x81, 0x00]);
  });

  it("Test 4: 0x1FFFFF to [0xFF, 0xFF, 0x7F]", () => {
    expect(Array.from(encodeVLQ(0x1fffff))).toEqual([0xff, 0xff, 0x7f]);
  });

  it("Bonus: 8192 to [0xC0, 0x00] (SMF spec example)", () => {
    expect(Array.from(encodeVLQ(8192))).toEqual([0xc0, 0x00]);
  });
});

describe("encodeUint32BE", () => {
  it("Test 5: 0 to [0x00, 0x00, 0x00, 0x00]", () => {
    expect(Array.from(encodeUint32BE(0))).toEqual([0x00, 0x00, 0x00, 0x00]);
  });

  it("Test 6: 0x12345678 to [0x12, 0x34, 0x56, 0x78]", () => {
    expect(Array.from(encodeUint32BE(0x12345678))).toEqual([
      0x12, 0x34, 0x56, 0x78,
    ]);
  });
});

describe("encodeMidiFile", () => {
  it("Test 7: empty notes to valid SMF (Header + Track w/ only Meta-Events + EoT)", () => {
    const out = encodeMidiFile([]);
    expect(out.length).toBeGreaterThan(14 + 8);
    expect(out[0]).toBe(0x4d);
    expect(out[1]).toBe(0x54);
    expect(out[2]).toBe(0x68);
    expect(out[3]).toBe(0x64);
    expect(out[out.length - 3]).toBe(0xff);
    expect(out[out.length - 2]).toBe(0x2f);
    expect(out[out.length - 1]).toBe(0x00);
  });

  it("Test 8: Header starts with MThd magic", () => {
    const out = encodeMidiFile([]);
    expect(Array.from(out.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]);
    expect(readUint32BE(out, 4)).toBe(6);
    expect(out[8]).toBe(0x00);
    expect(out[9]).toBe(0x00);
    expect(out[10]).toBe(0x00);
    expect(out[11]).toBe(0x01);
    expect((out[12] << 8) | out[13]).toBe(480);
  });

  it("Test 9: Track starts with MTrk magic", () => {
    const out = encodeMidiFile([]);
    const idx = findBytes(out, [0x4d, 0x54, 0x72, 0x6b]);
    expect(idx).toBe(14);
  });

  it("Test 10: single note contains Note-On + Note-Off bytes", () => {
    const note: MidiNote = {
      tickPos: 0,
      tickDuration: 240,
      note: 60,
      velocity: 100,
    };
    const out = encodeMidiFile([note]);
    expect(findBytes(out, [0x99, 60, 100])).toBeGreaterThan(0);
    expect(findBytes(out, [0x89, 60, 0])).toBeGreaterThan(0);
  });

  it("Test 11: Note-On byte = 0x99 (status 0x90 + channel 9 default)", () => {
    const note: MidiNote = {
      tickPos: 0,
      tickDuration: 120,
      note: 36,
      velocity: 127,
    };
    const out = encodeMidiFile([note]);
    const onIdx = findBytes(out, [0x99, 36, 127]);
    expect(onIdx).toBeGreaterThan(0);
    expect(findBytes(out, [0x90, 36, 127])).toBe(-1);
  });

  it("Test 12: Tempo Meta-Event present (FF 51 03)", () => {
    const out = encodeMidiFile([], { bpm: 120 });
    const idx = findBytes(out, [0xff, 0x51, 0x03]);
    expect(idx).toBeGreaterThan(0);
    const usPerQuarter =
      (out[idx + 3] << 16) | (out[idx + 4] << 8) | out[idx + 5];
    expect(usPerQuarter).toBe(500000);
  });

  it("Test 13: Time-Signature Meta-Event present (FF 58 04)", () => {
    const out = encodeMidiFile([], {
      timeSignature: { numerator: 4, denominator: 4 },
    });
    const idx = findBytes(out, [0xff, 0x58, 0x04]);
    expect(idx).toBeGreaterThan(0);
    expect(out[idx + 3]).toBe(4);
    expect(out[idx + 4]).toBe(2);
    expect(out[idx + 5]).toBe(0x18);
    expect(out[idx + 6]).toBe(0x08);
  });

  it("Test 14: End-of-Track Meta-Event at the end (FF 2F 00)", () => {
    const out = encodeMidiFile([
      { tickPos: 0, tickDuration: 480, note: 60, velocity: 90 },
    ]);
    const last3 = Array.from(out.slice(-3));
    expect(last3).toEqual([0xff, 0x2f, 0x00]);
  });

  it("Test 15: Track-Length-Field is correct (uint32 BE = track-data-byte-count)", () => {
    const out = encodeMidiFile([
      { tickPos: 0, tickDuration: 120, note: 60, velocity: 100 },
      { tickPos: 240, tickDuration: 120, note: 64, velocity: 100 },
    ]);
    const mtrkIdx = findBytes(out, [0x4d, 0x54, 0x72, 0x6b]);
    expect(mtrkIdx).toBe(14);
    const declaredLength = readUint32BE(out, mtrkIdx + 4);
    const actualTrackDataBytes = out.length - (mtrkIdx + 8);
    expect(declaredLength).toBe(actualTrackDataBytes);
  });

  it("Bonus: ppqn option propagates to header division", () => {
    const out = encodeMidiFile([], { ppqn: 960 });
    expect((out[12] << 8) | out[13]).toBe(960);
  });

  it("Bonus: custom channel is respected", () => {
    const note: MidiNote = {
      tickPos: 0,
      tickDuration: 100,
      note: 64,
      velocity: 80,
      channel: 0,
    };
    const out = encodeMidiFile([note]);
    expect(findBytes(out, [0x90, 64, 80])).toBeGreaterThan(0);
    expect(findBytes(out, [0x80, 64, 0])).toBeGreaterThan(0);
  });

  it("Bonus: Track-Name UTF-8 bytes present", () => {
    const out = encodeMidiFile([], { trackName: "Kick" });
    expect(findBytes(out, [0xff, 0x03, 0x04, 0x4b, 0x69, 0x63, 0x6b])).toBeGreaterThan(0);
  });

  it("Bonus: bytesToHex helper formats correctly (diagnostic sanity)", () => {
    expect(bytesToHex(new Uint8Array([0x4d, 0x54, 0x68, 0x64]))).toBe(
      "4d 54 68 64",
    );
  });
});
