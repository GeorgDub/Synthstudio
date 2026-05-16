/**
 * tests/features/transpose.test.ts (TASK-CVG-TRANSPOSE / v2.60)
 *
 * Pure-Coverage für client/src/utils/transpose.ts (54 LOC).
 *
 * Klein, aber sicherheitskritisch: clampSemitones + transposeNote werden
 * vom Piano-Roll-Playback und der AudioEngine pro Step-Trigger aufgerufen.
 * Falsche Output-Werte = falsche Tonhöhen oder MIDI-Out-of-Range-Crashes.
 */
import { describe, it, expect } from "vitest";
import {
  TRANSPOSE_MIN,
  TRANSPOSE_MAX,
  MIDI_MIN,
  MIDI_MAX,
  clampSemitones,
  transposeNote,
  semitoneLabel,
} from "@/utils/transpose";

describe("Transpose – Konstanten", () => {
  it("Transpose-Range ist ±24 (DAW-Standard ±2 Oktaven)", () => {
    expect(TRANSPOSE_MIN).toBe(-24);
    expect(TRANSPOSE_MAX).toBe(24);
  });

  it("MIDI-Range ist [0, 127]", () => {
    expect(MIDI_MIN).toBe(0);
    expect(MIDI_MAX).toBe(127);
  });
});

describe("Transpose – clampSemitones", () => {
  it("0 bleibt 0", () => expect(clampSemitones(0)).toBe(0));
  it("+5 bleibt +5", () => expect(clampSemitones(5)).toBe(5));
  it("-7 bleibt -7", () => expect(clampSemitones(-7)).toBe(-7));
  it("+24 (max) bleibt +24", () => expect(clampSemitones(24)).toBe(24));
  it("-24 (min) bleibt -24", () => expect(clampSemitones(-24)).toBe(-24));

  it("über max: +50 → +24", () => expect(clampSemitones(50)).toBe(24));
  it("unter min: -100 → -24", () => expect(clampSemitones(-100)).toBe(-24));

  it("fraktionale Werte werden gerundet: 3.4 → 3", () => {
    expect(clampSemitones(3.4)).toBe(3);
  });
  it("fraktionale Werte werden gerundet: 3.6 → 4", () => {
    expect(clampSemitones(3.6)).toBe(4);
  });

  it("NaN → 0 (Defensive für Persistenz-Boundary)", () => {
    expect(clampSemitones(NaN)).toBe(0);
  });

  it("Infinity → wird gerundet zu MAX_SAFE_INTEGER, dann geclamped → +24", () => {
    expect(clampSemitones(Infinity)).toBe(0);
  });

  it("-Infinity → 0 (über Number.isFinite-Guard)", () => {
    expect(clampSemitones(-Infinity)).toBe(0);
  });
});

describe("Transpose – transposeNote", () => {
  it("C4(60) + 5 = F4(65)", () => expect(transposeNote(60, 5)).toBe(65));
  it("C4(60) - 5 = G3(55)", () => expect(transposeNote(60, -5)).toBe(55));
  it("C4(60) + 0 = 60 (Identity)", () => expect(transposeNote(60, 0)).toBe(60));

  it("clamp am unteren MIDI-Ende: 3 - 5 = 0 (statt -2)", () => {
    expect(transposeNote(3, -5)).toBe(0);
  });

  it("clamp am oberen MIDI-Ende: 125 + 10 = 127 (statt 135)", () => {
    expect(transposeNote(125, 10)).toBe(127);
  });

  it("clamp wenn beide Werte negativ extrem", () => {
    expect(transposeNote(0, -1)).toBe(0);
    expect(transposeNote(-5, -10)).toBe(0); // beide negativ
  });

  it("clamp wenn beide Werte extrem hoch", () => {
    expect(transposeNote(127, 100)).toBe(127);
  });

  it("fraktionale Noten werden gerundet vor Addition", () => {
    expect(transposeNote(60.4, 5)).toBe(65);
    expect(transposeNote(60.7, 5)).toBe(66);
  });

  it("fraktionale Semitones werden gerundet", () => {
    expect(transposeNote(60, 5.4)).toBe(65);
    expect(transposeNote(60, 5.7)).toBe(66);
  });

  it("Edge: MIDI_MIN + 0 = MIDI_MIN", () => {
    expect(transposeNote(MIDI_MIN, 0)).toBe(MIDI_MIN);
  });

  it("Edge: MIDI_MAX + 0 = MIDI_MAX", () => {
    expect(transposeNote(MIDI_MAX, 0)).toBe(MIDI_MAX);
  });
});

describe("Transpose – semitoneLabel", () => {
  it("0 → '0' (kein Plus-Sign)", () => expect(semitoneLabel(0)).toBe("0"));
  it("+5 → '+5'", () => expect(semitoneLabel(5)).toBe("+5"));
  it("-7 → '-7'", () => expect(semitoneLabel(-7)).toBe("-7"));

  it("+12 → '+12 (8va)' (Oktav-Up Marker)", () => {
    expect(semitoneLabel(12)).toBe("+12 (8va)");
  });

  it("-12 → '-12 (8vb)' (Oktav-Down Marker, ohne +-Prefix)", () => {
    expect(semitoneLabel(-12)).toBe("-12 (8vb)");
  });

  it("+24 → '+24 (15ma)' (Doppel-Oktav-Up)", () => {
    expect(semitoneLabel(24)).toBe("+24 (15ma)");
  });

  it("-24 → '-24 (15mb)' (Doppel-Oktav-Down)", () => {
    expect(semitoneLabel(-24)).toBe("-24 (15mb)");
  });

  it("over-range Eingabe wird intern gecampted: 50 → +24-Marker", () => {
    expect(semitoneLabel(50)).toBe("+24 (15ma)");
  });

  it("under-range Eingabe: -100 → -24-Marker", () => {
    expect(semitoneLabel(-100)).toBe("-24 (15mb)");
  });

  it("NaN → '0' (via clampSemitones)", () => {
    expect(semitoneLabel(NaN)).toBe("0");
  });

  it("fraktionale Werte: 11.6 → '+12 (8va)' nach Rundung", () => {
    expect(semitoneLabel(11.6)).toBe("+12 (8va)");
  });
});
