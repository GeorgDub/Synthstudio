/**
 * tests/features/korg-esx-pattern-decode.test.ts
 *
 * v3.286: VERIFIZIERTER ESX-1 Pattern-Decode (löst die widerlegte Hypothese in
 * korg-esx-patterns.test.ts ab). Gegen open-electribe-editor v1.2.0 +
 * lammas/electribe + reale .esx bestätigt:
 *   - Drum-Step-Trigger = 128-Bit-Bitmaske, 8 Steps/Byte, MSB zuerst, @ Part+18.
 *   - 9 Drum @24 (Stride 34), 3 Stretch/Slice @878 (Stride 32, Seq @+16),
 *     2 Keyboard @330 (Stride 274, Note @+18, Gate @+146).
 *   - samplePointer BE @0: Bit15 = off, Bits0..14 = ID.
 *   - Keyboard-Note: Bit7 = OFF-Flag (Note-on wenn (note&0x80)==0), Note# = &0x7f.
 */
import { describe, it, expect } from "vitest";
import { parseEsxPattern } from "@/utils/korg/esxParser";
import { ESX1_CHUNKSIZE_PATTERN } from "@/utils/korg/constants";

/** Baut einen Pattern-Block mit gesetztem Namen/BPM (patternLength Bars). */
function baseBlock(name: string, bpm: number, bars = 8): Uint8Array {
  const b = new Uint8Array(ESX1_CHUNKSIZE_PATTERN);
  for (let i = 0; i < 8; i++) b[i] = (name + "        ").charCodeAt(i) & 0xff;
  const raw = Math.round(bpm * 128);
  b[8] = (raw >> 8) & 0xff;
  b[9] = raw & 0xff;
  b[11] = (bars - 1) & 0x07; // patternLength
  b[13] = 0x0f; // lastStep 16
  return b;
}

const DRUM0 = 24;
const KB0 = 330;

describe("v3.286 Drum step-trigger bitmask", () => {
  it("dekodiert die 128-Bit-Maske MSB-zuerst (Byte0=0x88 → Steps 0,4)", () => {
    const b = baseBlock("Kick", 130);
    // sequenceData @ DRUM0+18. Byte 0 = 0x88 = 1000 1000 → MSB-first: step0, step4.
    b[DRUM0 + 18] = 0x88;
    // Byte 1 = 0x11 = 0001 0001 → steps 8+3=11, 8+7=15.
    b[DRUM0 + 19] = 0x11;
    const pat = parseEsxPattern(b, 0)!;
    const active = pat.parts[0].steps
      .map((s, i) => (s.active ? i : -1))
      .filter(i => i >= 0);
    expect(active).toEqual([0, 4, 11, 15]);
    expect(pat.parts[0].steps.length).toBe(128);
  });

  it("0x00-Bytes → keine aktiven Steps (vorher fälschlich alle aktiv)", () => {
    const b = baseBlock("Empty", 120);
    const pat = parseEsxPattern(b, 0)!;
    expect(pat.parts[0].steps.every(s => !s.active)).toBe(true);
  });

  it("liefert 14 Parts, effektiv 128 Steps bei 8 Bars", () => {
    const b = baseBlock("Full", 140, 8);
    const pat = parseEsxPattern(b, 0)!;
    expect(pat.parts.length).toBe(14);
    expect((pat as { effectiveSteps?: number }).effectiveSteps).toBe(128);
  });
});

describe("v3.286 samplePointer", () => {
  it("Bit15 = off → sampleId 0; sonst Bits0..14", () => {
    const b = baseBlock("SP", 120);
    // Part0: sampleId 300 (0x012C), Part1: off-flag (0x8000 | 5).
    b[DRUM0] = 0x01;
    b[DRUM0 + 1] = 0x2c;
    b[DRUM0 + 34] = 0x80;
    b[DRUM0 + 34 + 1] = 0x05;
    const pat = parseEsxPattern(b, 0)!;
    expect(pat.parts[0].sampleId).toBe(300);
    expect(pat.parts[1].sampleId).toBe(0); // off → 0
  });
});

describe("v3.286 Keyboard note/gate decode", () => {
  it("Note bit7=OFF-Flag: Note-on nur bei gesetzten Noten, Note# = note&0x7f", () => {
    const b = baseBlock("Synth", 128);
    // Keyboard-Part 0 → parts[12]. Note @ KB0+18. Gate @ KB0+146.
    // Step0: note 0x3C (60, on), Step1: 0xBC (bit7=1 → off), Step2: 0x28 (40, on).
    b[KB0 + 18 + 0] = 0x3c;
    b[KB0 + 18 + 1] = 0xbc;
    b[KB0 + 18 + 2] = 0x28;
    b[KB0 + 146 + 0] = 5; // gate
    const pat = parseEsxPattern(b, 0)!;
    const synth = pat.parts[12];
    expect(synth.steps[0].active).toBe(true);
    expect(synth.steps[0].note).toBe(60);
    expect(synth.steps[0].gate).toBe(5);
    expect(synth.steps[1].active).toBe(false); // bit7 set → off
    expect(synth.steps[2].active).toBe(true);
    expect(synth.steps[2].note).toBe(40);
  });
});
