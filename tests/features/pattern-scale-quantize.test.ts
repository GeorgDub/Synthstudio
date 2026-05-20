/**
 * tests/features/pattern-scale-quantize.test.ts (v3.176.0)
 *
 * Pure-Coverage für client/src/utils/patternScaleQuantize.ts.
 *
 * Snappt MIDI-Note-Pitches auf eine Scale. Reine Math gegen Pitch-Classes
 * + Direction-Strategy — kein AudioContext, kein Store.
 */
import { describe, it, expect } from "vitest";
import {
  quantizeNoteToScale,
  quantizeNotesToScale,
  isNoteInScale,
  generateScaleNotes,
  type SnapDirection,
} from "@/utils/patternScaleQuantize";

describe("quantizeNoteToScale", () => {
  it("note already in scale (C major, note 60 = C) → unchanged", () => {
    // C-Dur erlaubt PC 0 (C). Note 60 darf nicht verändert werden.
    expect(quantizeNoteToScale(60, { scaleRoot: 0, scale: "major" })).toBe(60);
  });

  it("C# in C-major + nearest → snaps up to D (62) on tie (prefer up)", () => {
    // PC 1 (C#) — Distanz zu C(0) = -1, zu D(2) = +1. Equal → prefer up.
    expect(
      quantizeNoteToScale(61, { scaleRoot: 0, scale: "major", snapDirection: "nearest" }),
    ).toBe(62);
  });

  it("C#5 (note 61) in C-major + 'up' → 62 (D)", () => {
    expect(
      quantizeNoteToScale(61, { scaleRoot: 0, scale: "major", snapDirection: "up" }),
    ).toBe(62);
  });

  it("C#5 (note 61) in C-major + 'down' → 60 (C)", () => {
    expect(
      quantizeNoteToScale(61, { scaleRoot: 0, scale: "major", snapDirection: "down" }),
    ).toBe(60);
  });

  it("custom scaleRoot (D major = scaleRoot 2): note 60 (C) nearest → 61", () => {
    // D-Dur abs-PCs = {1,2,4,6,7,9,11}. PC 0 (C) → nächste: +1 (PC 1) oder -1 (PC 11). Tie → up → 61.
    expect(
      quantizeNoteToScale(60, { scaleRoot: 2, scale: "major", snapDirection: "nearest" }),
    ).toBe(61);
  });

  it("NaN note → 0", () => {
    expect(quantizeNoteToScale(Number.NaN, { scale: "major" })).toBe(0);
  });
});

describe("quantizeNotesToScale", () => {
  it("batch [60, 61, 62] in C-major nearest → [60, 62, 62] (immutable)", () => {
    const input = [60, 61, 62] as const;
    const out = quantizeNotesToScale(input, { scale: "major", snapDirection: "nearest" });
    expect(out).toEqual([60, 62, 62]);
    // immutable: new array, source unchanged
    expect(out).not.toBe(input as unknown as number[]);
  });

  it("empty array → []", () => {
    expect(quantizeNotesToScale([], { scale: "major" })).toEqual([]);
  });
});

describe("isNoteInScale", () => {
  it("note 60 (C) in C major → true", () => {
    expect(isNoteInScale(60, { scaleRoot: 0, scale: "major" })).toBe(true);
  });

  it("note 61 (C#) in C major → false", () => {
    expect(isNoteInScale(61, { scaleRoot: 0, scale: "major" })).toBe(false);
  });
});

describe("generateScaleNotes", () => {
  it("C major: exactly 75 notes in 0..127", () => {
    // Major = 7 PCs. In 0..127 (128 Werte): PCs 0,2,4,5,7 ergeben je 11 (0..120), PCs 9,11 je 10. Total = 75.
    const notes = generateScaleNotes(0, "major");
    expect(notes.length).toBe(75);
  });

  it("C major contains 60 (C4) and 62 (D4) but NOT 61 (C#4); ascending sorted", () => {
    const notes = generateScaleNotes(0, "major");
    expect(notes).toContain(60);
    expect(notes).toContain(62);
    expect(notes).not.toContain(61);
    // ascending sorted
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeGreaterThan(notes[i - 1]);
    }
  });
});

describe("defensive fallbacks", () => {
  it("snapDirection 'invalid' falls back to 'nearest'", () => {
    // C# in C-Dur mit invalid direction → muss wie 'nearest' arbeiten → 62
    const bogus = "invalid" as unknown as SnapDirection;
    expect(
      quantizeNoteToScale(61, { scaleRoot: 0, scale: "major", snapDirection: bogus }),
    ).toBe(62);
  });
});
