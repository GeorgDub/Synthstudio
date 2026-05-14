/**
 * tests/features/midi-templates.test.ts
 *
 * Unit-Tests für MIDI-Hardware-Templates.
 */
import { describe, it, expect } from "vitest";
import {
  MIDI_TEMPLATES,
  getMidiTemplate,
  listTemplateIds,
  templateToMappings,
} from "../../client/src/utils/midiTemplates";

describe("MIDI-Templates", () => {
  it("MIDI_TEMPLATES enthält mindestens 6 Vorlagen", () => {
    expect(MIDI_TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });

  it("Jede Vorlage hat eine eindeutige ID", () => {
    const ids = MIDI_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Jede Vorlage hat name + manufacturer + description", () => {
    MIDI_TEMPLATES.forEach(t => {
      expect(t.name).toBeTruthy();
      expect(t.manufacturer).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(10);
    });
  });

  it("getMidiTemplate findet existierende Templates", () => {
    expect(getMidiTemplate("launchpad-mk2")).toBeDefined();
    expect(getMidiTemplate("nanokontrol2")).toBeDefined();
  });

  it("getMidiTemplate gibt undefined für unbekannte ID", () => {
    expect(getMidiTemplate("nicht-existent")).toBeUndefined();
  });

  it("listTemplateIds liefert alle IDs", () => {
    const ids = listTemplateIds();
    expect(ids).toContain("launchpad-mk2");
    expect(ids).toContain("nanokontrol2");
    expect(ids).toContain("mpc-one");
  });

  it("templateToMappings ergänzt Labels automatisch", () => {
    const t = getMidiTemplate("launchpad-mk2")!;
    const { cc, notes } = templateToMappings(t);
    // cc-Mappings haben jetzt Labels
    expect(cc.length).toBe(t.ccMappings.length);
    expect(cc[0].label).toBeTruthy();
    // Note-Mappings auch
    expect(notes.length).toBe(t.noteMappings.length);
    expect(notes[0].label).toBeTruthy();
  });

  it("templateToMappings benutzt partResolver wenn übergeben", () => {
    const t = getMidiTemplate("launchpad-mk2")!;
    const { notes } = templateToMappings(t, (id) => `RESOLVED-${id}`);
    expect(notes[0].label).toMatch(/^RESOLVED-/);
  });

  it("Launchpad MK2 hat 8 Top-Row Transport-CCs (104-111)", () => {
    const t = getMidiTemplate("launchpad-mk2")!;
    const transportCCs = t.ccMappings.filter(m => m.cc >= 104 && m.cc <= 111);
    expect(transportCCs).toHaveLength(8);
  });

  it("nanoKONTROL2 hat 8 Slider + 8 Knobs + 8 Mute + 8 Solo", () => {
    const t = getMidiTemplate("nanokontrol2")!;
    const volumes = t.ccMappings.filter(m => m.target.type === "volume");
    const pans    = t.ccMappings.filter(m => m.target.type === "pan");
    const mutes   = t.ccMappings.filter(m => m.target.type === "mute");
    const solos   = t.ccMappings.filter(m => m.target.type === "solo");
    expect(volumes).toHaveLength(8);
    expect(pans).toHaveLength(8);
    expect(mutes).toHaveLength(8);
    expect(solos).toHaveLength(8);
  });

  it("MPC One enthält GM Drum Map (note 36 = Kick → part-0)", () => {
    const t = getMidiTemplate("mpc-one")!;
    const kickMapping = t.noteMappings.find(n => n.note === 36);
    expect(kickMapping).toBeDefined();
    expect(kickMapping?.partId).toBe("part-0");
  });

  // ─── Korg Electribe 2 / 2S (v1.74) ───────────────────────────────────────
  describe("Korg Electribe 2 Template (v1.74)", () => {
    it("ist registriert und auffindbar", () => {
      const t = getMidiTemplate("korg-electribe-2");
      expect(t).toBeDefined();
      expect(t!.manufacturer).toBe("Korg");
    });

    it("hat 16 Pad-Mappings (beide Pad-Reihen)", () => {
      const t = getMidiTemplate("korg-electribe-2")!;
      expect(t.noteMappings).toHaveLength(16);
    });

    it("Pads liegen auf Ch10 (GM-Drum-Channel) - Electribe-Default", () => {
      const t = getMidiTemplate("korg-electribe-2")!;
      t.noteMappings.forEach(n => {
        expect(n.channel).toBe(10);
      });
    });

    it("Pad-Notes liegen kontinuierlich im Bereich 36-51", () => {
      const t = getMidiTemplate("korg-electribe-2")!;
      const notes = t.noteMappings.map(n => n.note).sort((a, b) => a - b);
      expect(notes[0]).toBe(36);
      expect(notes[notes.length - 1]).toBe(51);
      expect(notes).toEqual([36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51]);
    });

    it("Pads sind als 2x8-Grid auf part-0..part-7 zweifach gemappt", () => {
      const t = getMidiTemplate("korg-electribe-2")!;
      // Note 36 + Note 44 → beide auf part-0
      const firstRow = t.noteMappings.filter(n => n.note >= 36 && n.note <= 43);
      const secondRow = t.noteMappings.filter(n => n.note >= 44 && n.note <= 51);
      expect(firstRow).toHaveLength(8);
      expect(secondRow).toHaveLength(8);
      // Beide Reihen mappen auf identische partIds
      firstRow.forEach((n, i) => {
        expect(n.partId).toBe(`part-${i}`);
        expect(secondRow[i].partId).toBe(`part-${i}`);
      });
    });

    it("hat CC-Mappings für masterVolume + BPM + 4 Part-Volumes", () => {
      const t = getMidiTemplate("korg-electribe-2")!;
      const types = t.ccMappings.map(m => m.target.type);
      expect(types).toContain("masterVolume");
      expect(types).toContain("bpm");
      expect(types.filter(t => t === "volume")).toHaveLength(4);
    });

    it("ist Round-Trip-kompatibel mit templateToMappings (Labels generiert)", () => {
      const t = getMidiTemplate("korg-electribe-2")!;
      const { cc, notes } = templateToMappings(t);
      expect(cc).toHaveLength(t.ccMappings.length);
      expect(notes).toHaveLength(t.noteMappings.length);
      cc.forEach(m => expect(m.label).toBeTruthy());
      notes.forEach(m => expect(m.label).toBeTruthy());
    });
  });
});
