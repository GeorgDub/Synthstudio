/**
 * tests/features/e2-chord-editing.test.ts
 *
 * v3.310 — E2-Akkord EDITIEREN im StepInspector.
 *
 * Prüft die puren Edit-Helper (addChordNote / updateChordNoteAt /
 * removeChordNoteAt) und den kompletten Edit→Export-Pfad: eine per Helper
 * gebaute Akkord-Liste landet über convertStepToE2 + buildE2PatternBody
 * byte-genau in den Step-Bytes 5..7.
 */

import { describe, it, expect } from "vitest";

import {
  addChordNote,
  updateChordNoteAt,
  removeChordNoteAt,
  E2_CHORD_MAX_NOTES,
} from "../../client/src/components/DrumMachine/drumMachineHelpers";
import { convertStepToE2 } from "../../client/src/utils/electribePatternConvert";
import { buildE2PatternBody } from "../../client/src/utils/e2sExport";
import {
  E2_PART_TABLE_OFFSET,
  E2_PART_SEQ_OFFSET,
} from "../../client/src/utils/korg/e2Layout";

// ─── addChordNote ────────────────────────────────────────────────────────────

describe("addChordNote", () => {
  it("erste Note: große Terz über der Hauptnote (C5=72 → E5=76)", () => {
    expect(addChordNote(undefined, 72)).toEqual([76]);
    expect(addChordNote([], 72)).toEqual([76]);
  });

  it("weitere Noten stapeln sich in Terzen über der letzten", () => {
    const one = addChordNote([], 72);
    const two = addChordNote(one, 72);
    const three = addChordNote(two, 72);
    expect(two).toEqual([76, 80]);
    expect(three).toEqual([76, 80, 84]);
  });

  it("bei vollen 3 Slots kommt das Array unverändert zurück", () => {
    const full = [76, 80, 84];
    expect(addChordNote(full, 72)).toEqual(full);
    expect(addChordNote(full, 72)).toHaveLength(E2_CHORD_MAX_NOTES);
  });

  it("belegte Töne werden übersprungen (kein Doppelton)", () => {
    // Letzte Note 76 → Kandidat 80 ist belegt → weiter auf 83.
    expect(addChordNote([80, 76], 72)).toEqual([80, 76, 83]);
  });

  it("klemmt an den MIDI-Rand statt überzulaufen", () => {
    const next = addChordNote([127], 72);
    expect(next).toHaveLength(2);
    expect(next[1]).toBeLessThanOrEqual(127);
    expect(next[1]).toBeGreaterThan(0);
    expect(next[1]).not.toBe(127); // Duplikat vermieden
  });

  it("ignoriert 0-Slots aus dem Roh-Import ([46,0,0] zählt als eine Note)", () => {
    const next = addChordNote([46, 0, 0], 72);
    expect(next).toEqual([46, 50]);
  });

  it("ungültige Basis fällt nicht auf NaN durch", () => {
    const next = addChordNote([], Number.NaN);
    expect(next).toHaveLength(1);
    expect(next[0]).toBeGreaterThan(0);
    expect(next[0]).toBeLessThanOrEqual(127);
  });
});

// ─── updateChordNoteAt / removeChordNoteAt ───────────────────────────────────

describe("updateChordNoteAt", () => {
  it("ersetzt genau die eine Position", () => {
    expect(updateChordNoteAt([76, 80, 84], 1, 79)).toEqual([76, 79, 84]);
  });

  it("klemmt auf den gültigen E2-Bereich 1..127 und rundet", () => {
    expect(updateChordNoteAt([76], 0, 0)).toEqual([1]);
    expect(updateChordNoteAt([76], 0, 300)).toEqual([127]);
    expect(updateChordNoteAt([76], 0, 63.7)).toEqual([64]);
  });

  it("mutiert das Original nicht", () => {
    const orig = [76, 80];
    updateChordNoteAt(orig, 0, 50);
    expect(orig).toEqual([76, 80]);
  });
});

describe("removeChordNoteAt", () => {
  it("entfernt genau die eine Position", () => {
    expect(removeChordNoteAt([76, 80, 84], 1)).toEqual([76, 84]);
  });

  it("letzte Note entfernt → undefined (Store räumt das Feld ab)", () => {
    expect(removeChordNoteAt([76], 0)).toBeUndefined();
  });
});

// ─── Edit → Export ───────────────────────────────────────────────────────────

describe("Edit→Export: editierter Akkord landet in den Step-Bytes 5..7", () => {
  it("addChordNote-Ergebnis übersteht convertStepToE2 + buildE2PatternBody", () => {
    let chord = addChordNote([], 72);
    chord = addChordNote(chord, 72);
    const step = convertStepToE2({
      active: true,
      velocity: 96,
      pitch: 0,
      chordNotes: chord,
    });
    const body = buildE2PatternBody({
      name: "ChordEdit",
      bpm: 120,
      stepLength: 16,
      parts: [{ steps: [step] }],
    });
    const so = E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    expect([body[so + 5], body[so + 6], body[so + 7]]).toEqual([76, 80, 0]);
  });
});
