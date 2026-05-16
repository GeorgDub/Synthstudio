/**
 * tests/features/gm-drum-map.test.ts (TASK-CVG-GMMAP / v2.63)
 *
 * Pure-Coverage für client/src/utils/gmDrumMap.ts.
 *
 * GM-Level-1 Drum-Map. Diese Suite garantiert die 47 Mappings (Noten 35–81)
 * + Fallback für unbekannte Noten + midiNotesToParts-Categorization-Logik.
 */
import { describe, it, expect } from "vitest";
import { getGmDrumInfo, midiNotesToParts, type DrumCategory } from "@/utils/gmDrumMap";
import type { ParsedMidiNote } from "@/utils/smfParser";

describe("GmDrumMap – getGmDrumInfo", () => {
  it("Note 36 → 'Bass Drum 1' / kicks", () => {
    const info = getGmDrumInfo(36);
    expect(info.note).toBe(36);
    expect(info.name).toBe("Bass Drum 1");
    expect(info.category).toBe("kicks");
  });

  it("Note 35 → 'Acoustic Bass Drum' / kicks", () => {
    expect(getGmDrumInfo(35).category).toBe("kicks");
  });

  it("Note 38 → 'Acoustic Snare' / snares", () => {
    expect(getGmDrumInfo(38).category).toBe("snares");
  });

  it("Note 39 → 'Hand Clap' / claps (eigene Kategorie, NICHT snares)", () => {
    expect(getGmDrumInfo(39).category).toBe("claps");
  });

  it("Note 42 → 'Closed Hi Hat' / hihats", () => {
    expect(getGmDrumInfo(42).category).toBe("hihats");
  });

  it("Note 46 → 'Open Hi-Hat' / hihats", () => {
    expect(getGmDrumInfo(46).category).toBe("hihats");
  });

  it("Note 41 → Floor Tom / toms", () => {
    expect(getGmDrumInfo(41).category).toBe("toms");
  });

  it("Note 49 → 'Crash Cymbal 1' / percussion (Cymbals fallen unter percussion, NICHT hihats)", () => {
    expect(getGmDrumInfo(49).category).toBe("percussion");
  });

  it("Note 56 → 'Cowbell' / percussion", () => {
    expect(getGmDrumInfo(56).name).toBe("Cowbell");
  });

  it("Unbekannte Note 100 → Fallback mit Kategorie 'other'", () => {
    const info = getGmDrumInfo(100);
    expect(info.note).toBe(100);
    expect(info.name).toBe("MIDI Note 100");
    expect(info.category).toBe("other");
  });

  it("Unbekannte Note 34 (gerade unterhalb GM) → 'other'", () => {
    expect(getGmDrumInfo(34).category).toBe("other");
  });

  it("Unbekannte Note 82 (gerade oberhalb GM) → 'other'", () => {
    expect(getGmDrumInfo(82).category).toBe("other");
  });

  it("Note 0 → 'other' (außerhalb GM)", () => {
    expect(getGmDrumInfo(0).category).toBe("other");
  });
});

describe("GmDrumMap – Schema-Integrität (alle 47 Mappings)", () => {
  it("Noten 35–81 sind alle definiert (47 distinkte Mappings)", () => {
    const allNotes = Array.from({ length: 47 }, (_, i) => 35 + i);
    for (const n of allNotes) {
      const info = getGmDrumInfo(n);
      expect(info.category).not.toBe("other");
      expect(info.name.length).toBeGreaterThan(0);
    }
  });

  it("Mindestens 1 Mapping pro Hauptkategorie (kicks/snares/hihats/claps/toms/percussion)", () => {
    const categories = new Set<DrumCategory>();
    for (let n = 35; n <= 81; n++) {
      categories.add(getGmDrumInfo(n).category);
    }
    expect(categories.has("kicks")).toBe(true);
    expect(categories.has("snares")).toBe(true);
    expect(categories.has("hihats")).toBe(true);
    expect(categories.has("claps")).toBe(true);
    expect(categories.has("toms")).toBe(true);
    expect(categories.has("percussion")).toBe(true);
  });
});

// ─── midiNotesToParts ────────────────────────────────────────────────────────

function note(midiNote: number, stepIndex: number, velocity = 100): ParsedMidiNote {
  return { note: midiNote, stepIndex, velocity };
}

describe("GmDrumMap – midiNotesToParts", () => {
  it("Leere Notenliste → leeres Parts-Array", () => {
    expect(midiNotesToParts([])).toEqual([]);
  });

  it("Eine Kick → ein Part mit category=kicks", () => {
    const parts = midiNotesToParts([note(36, 0)]);
    expect(parts).toHaveLength(1);
    expect(parts[0].category).toBe("kicks");
    expect(parts[0].name).toBe("Bass Drum 1");
    expect(parts[0].steps).toEqual([{ stepIndex: 0, velocity: 100 }]);
  });

  it("Mehrere Kicks → ein Part mit allen Steps", () => {
    const parts = midiNotesToParts([
      note(36, 0, 100),
      note(36, 4, 110),
      note(36, 8, 90),
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0].steps).toHaveLength(3);
    expect(parts[0].steps).toEqual([
      { stepIndex: 0, velocity: 100 },
      { stepIndex: 4, velocity: 110 },
      { stepIndex: 8, velocity: 90 },
    ]);
  });

  it("Kick + Snare → zwei Parts mit jeweils einer Kategorie", () => {
    const parts = midiNotesToParts([note(36, 0), note(38, 4)]);
    expect(parts).toHaveLength(2);
    const kicks = parts.find((p) => p.category === "kicks");
    const snares = parts.find((p) => p.category === "snares");
    expect(kicks?.steps[0].stepIndex).toBe(0);
    expect(snares?.steps[0].stepIndex).toBe(4);
  });

  it("Zwei verschiedene Snare-Noten (38 + 40 = Acoustic + Electric) landen im gleichen snares-Part", () => {
    const parts = midiNotesToParts([note(38, 0), note(40, 8)]);
    expect(parts).toHaveLength(1);
    expect(parts[0].category).toBe("snares");
    expect(parts[0].steps).toHaveLength(2);
  });

  it("Name des ersten Sounds in der Kategorie wird zum Part-Name", () => {
    // Erst Electric Snare (40), dann Acoustic Snare (38) → Name ist "Electric Snare"
    const parts = midiNotesToParts([note(40, 0), note(38, 4)]);
    expect(parts[0].name).toBe("Electric Snare");
  });

  it("Part-Reihenfolge folgt dem ersten Auftreten der Kategorie", () => {
    const parts = midiNotesToParts([
      note(42, 0), // hihat
      note(36, 4), // kick
      note(38, 8), // snare
    ]);
    expect(parts.map((p) => p.category)).toEqual(["hihats", "kicks", "snares"]);
  });

  it("Unbekannte MIDI-Note landet in 'other'-Kategorie", () => {
    const parts = midiNotesToParts([note(100, 0)]);
    expect(parts).toHaveLength(1);
    expect(parts[0].category).toBe("other");
    expect(parts[0].name).toBe("MIDI Note 100");
  });

  it("Velocity wird unverändert übernommen (auch 0 und 127)", () => {
    const parts = midiNotesToParts([
      note(36, 0, 0),
      note(36, 4, 127),
    ]);
    expect(parts[0].steps.map((s) => s.velocity)).toEqual([0, 127]);
  });
});
