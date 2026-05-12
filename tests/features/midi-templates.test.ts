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
});
