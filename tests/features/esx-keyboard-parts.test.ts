/**
 * tests/features/esx-keyboard-parts.test.ts
 *
 * ESX-1 Keyboard/Synth-Parts (2 pro Pattern, je 128 Note + 128 Gate Bytes) —
 * die echten 128-Step-Melodiedaten eines Length_8-Patterns. Layout verifiziert
 * gegen open-electribe-editor v1.2.0 (NUM_PARTS_KEYBOARD=2,
 * CHUNKSIZE_PARTS_KEYBOARD=274, Note/Gate je 128) + reale .esx.
 */
import { describe, it, expect } from "vitest";
import { parseEsxPattern } from "../../client/src/utils/korg/esxParser";

const PATTERN_SIZE = 4280;
const KB0_OFF = 330; // erster Keyboard-Part
const KB1_OFF = 330 + 274; // zweiter Keyboard-Part = 604

function buildPattern(): Uint8Array {
  const raw = new Uint8Array(PATTERN_SIZE);
  // Name (macht das Pattern non-empty)
  for (const [i, c] of Array.from("KBTEST").entries()) raw[i] = c.charCodeAt(0);
  // BPM BE = 120 × 128 = 15360 = 0x3C00
  raw[8] = 0x3c;
  raw[9] = 0x00;
  // patternLength Byte 11 = 0x07 → Length_8 → 128 effektive Steps
  raw[11] = 0x07;
  // Keyboard-Part 0 @ 330: sampleId BE = 120, vol@+9 = 100, pan@+10 = 64
  raw[KB0_OFF + 0] = 0x00;
  raw[KB0_OFF + 1] = 120;
  raw[KB0_OFF + 9] = 100;
  raw[KB0_OFF + 10] = 64;
  raw[KB0_OFF + 18] = 60; // note[0]
  raw[KB0_OFF + 18 + 127] = 72; // note[127]
  raw[KB0_OFF + 146] = 5; // gate[0]
  // Keyboard-Part 1 @ 604: sampleId 240, vol 46
  raw[KB1_OFF + 0] = 0x00;
  raw[KB1_OFF + 1] = 240;
  raw[KB1_OFF + 9] = 46;
  raw[KB1_OFF + 10] = 64;
  return raw;
}

describe("ESX keyboard parts (128 note/gate)", () => {
  it("liest 2 Keyboard-Parts mit je 128 Note + 128 Gate", () => {
    const pat = parseEsxPattern(buildPattern(), 0);
    expect(pat).not.toBeNull();
    expect(pat!.keyboardParts).toHaveLength(2);
    for (const kp of pat!.keyboardParts) {
      expect(kp.note).toHaveLength(128);
      expect(kp.gate).toHaveLength(128);
    }
  });

  it("dekodiert Header (sampleId BE, volume, pan) korrekt", () => {
    const pat = parseEsxPattern(buildPattern(), 0)!;
    expect(pat.keyboardParts[0].sampleId).toBe(120);
    expect(pat.keyboardParts[0].volume).toBe(100);
    expect(pat.keyboardParts[0].pan).toBe(64);
    expect(pat.keyboardParts[1].sampleId).toBe(240);
    expect(pat.keyboardParts[1].volume).toBe(46);
  });

  it("die 128 Note/Gate-Werte kommen an der richtigen Stelle an", () => {
    const pat = parseEsxPattern(buildPattern(), 0)!;
    expect(pat.keyboardParts[0].note[0]).toBe(60);
    expect(pat.keyboardParts[0].note[127]).toBe(72);
    expect(pat.keyboardParts[0].gate[0]).toBe(5);
  });

  it("ein Length_8-Pattern meldet 128 effektive Steps (Keyboard = echte 128)", () => {
    const pat = parseEsxPattern(buildPattern(), 0)!;
    expect(pat.patternLength).toBe(8);
    expect(pat.effectiveSteps).toBe(128);
    // Keyboard-Part trägt genau so viele Note-Werte wie effektive Steps.
    expect(pat.keyboardParts[0].note.length).toBe(pat.effectiveSteps);
  });
});
