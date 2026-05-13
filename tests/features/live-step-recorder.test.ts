/**
 * tests/features/live-step-recorder.test.ts
 *
 * Live Step Recording — Pure-Logic-Tests für note → part mapping.
 *
 * Was getestet wird:
 *  - findPartIdByCategory: case-insensitive substring match auf part.name
 *  - mapMidiNoteToPart: MIDI-Note → GM-Category → matchender Part
 *  - Edge cases: leere Parts-Liste, unbekannte Note, mehrere Treffer
 *
 * Was NICHT getestet wird (braucht AudioEngine + DOM-Event-Loop):
 *  - Der eigentliche Recording-Flow (Event listener + currentStep)
 *  - dm.toggleStep / setStepVelocity bei armed+playing+input
 */
import { describe, it, expect } from "vitest";
import {
  findPartIdByCategory,
  mapMidiNoteToPart,
} from "../../client/src/hooks/useLiveStepRecorder";

describe("findPartIdByCategory", () => {
  const parts = [
    { id: "kick-1", name: "Kick" },
    { id: "snare-2", name: "Snare" },
    { id: "hat-3", name: "Hi-Hat cl." },
    { id: "hat-4", name: "Hi-Hat op." },
    { id: "clap-5", name: "Clap" },
    { id: "tom-6", name: "Tom Hi" },
    { id: "perc-7", name: "Perc" },
    { id: "fx-8", name: "FX" },
  ];

  it("matched kicks-Kategorie auf Kick-Part", () => {
    expect(findPartIdByCategory(parts, "kicks")).toBe("kick-1");
  });

  it("matched snares-Kategorie auf Snare-Part", () => {
    expect(findPartIdByCategory(parts, "snares")).toBe("snare-2");
  });

  it("matched hihats-Kategorie auf Hi-Hat-Part (erste Treffer = Closed)", () => {
    expect(findPartIdByCategory(parts, "hihats")).toBe("hat-3");
  });

  it("matched claps-Kategorie auf Clap-Part", () => {
    expect(findPartIdByCategory(parts, "claps")).toBe("clap-5");
  });

  it("matched toms-Kategorie auf Tom-Part", () => {
    expect(findPartIdByCategory(parts, "toms")).toBe("tom-6");
  });

  it("matched percussion-Kategorie auf Perc-Part", () => {
    expect(findPartIdByCategory(parts, "percussion")).toBe("perc-7");
  });

  it("returnt null wenn keine matchende Part-Kategorie", () => {
    const partsNoKick = [
      { id: "snare-2", name: "Snare" },
      { id: "hat-3", name: "Hi-Hat" },
    ];
    expect(findPartIdByCategory(partsNoKick, "kicks")).toBeNull();
  });

  it("returnt null bei leerer Parts-Liste", () => {
    expect(findPartIdByCategory([], "kicks")).toBeNull();
  });

  it("ist case-insensitive", () => {
    const upperParts = [{ id: "x", name: "KICK" }, { id: "y", name: "SNARE" }];
    expect(findPartIdByCategory(upperParts, "kicks")).toBe("x");
    expect(findPartIdByCategory(upperParts, "snares")).toBe("y");
  });

  it("returnt null für 'other' (keine Keywords)", () => {
    expect(findPartIdByCategory(parts, "other")).toBeNull();
  });

  it("matched alternative Schreibweisen (BD für kick)", () => {
    const alt = [{ id: "bd-1", name: "BD 808" }];
    expect(findPartIdByCategory(alt, "kicks")).toBe("bd-1");
  });
});

describe("mapMidiNoteToPart", () => {
  const parts = [
    { id: "kick", name: "Kick" },
    { id: "snare", name: "Snare" },
    { id: "hat", name: "Hi-Hat cl." },
    { id: "perc", name: "Perc" },
  ];

  it("MIDI 36 (Bass Drum 1) → Kick", () => {
    expect(mapMidiNoteToPart(36, parts)).toBe("kick");
  });

  it("MIDI 38 (Acoustic Snare) → Snare", () => {
    expect(mapMidiNoteToPart(38, parts)).toBe("snare");
  });

  it("MIDI 42 (Closed Hi-Hat) → Hi-Hat", () => {
    expect(mapMidiNoteToPart(42, parts)).toBe("hat");
  });

  it("MIDI 49 (Crash Cymbal) → Perc (fallback via percussion category)", () => {
    expect(mapMidiNoteToPart(49, parts)).toBe("perc");
  });

  it("Note außerhalb GM-Drum-Range → null (other-Kategorie)", () => {
    expect(mapMidiNoteToPart(0, parts)).toBeNull();
    expect(mapMidiNoteToPart(127, parts)).toBeNull();
  });

  it("returnt null wenn aktive Pattern keinen matchenden Part hat", () => {
    const onlyKick = [{ id: "kick", name: "Kick" }];
    expect(mapMidiNoteToPart(38, onlyKick)).toBeNull(); // 38 = Snare, kein Snare-Part
  });
});
