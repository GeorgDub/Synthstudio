/**
 * tests/features/midi-layout-export.test.ts
 *
 * Unit-Tests für `client/src/utils/midiLayoutExport.ts` (v1.73).
 *
 * Schwerpunkt: Round-Trip-Invariante — Output von `buildMidiLayoutJson` muss
 * vom existierenden `parseMidiLayoutJson` (v1.38+) wieder akzeptiert werden,
 * und die geparsten Mappings müssen den Original-Mappings entsprechen.
 */
import { describe, it, expect } from "vitest";
import { buildMidiLayoutJson, sanitizeLayoutFileName, LAYOUT_VERSION, defaultLayoutNameForDevice } from "../../client/src/utils/midiLayoutExport";
import { parseMidiLayoutJson } from "../../client/src/utils/midiLayoutImport";
import type { MidiMapping, MidiNoteMapping } from "../../client/src/hooks/useMidi";

describe("buildMidiLayoutJson (v1.73)", () => {
  it("erzeugt gültiges JSON mit synthstudioLayout-Marker", () => {
    const json = buildMidiLayoutJson({ name: "Test", ccMappings: [], noteMappings: [] });
    const parsed = JSON.parse(json);
    expect(parsed.synthstudioLayout).toBe(LAYOUT_VERSION);
    expect(parsed.synthstudioLayout).toBe("v1");
    expect(parsed.name).toBe("Test");
  });

  it("ist pretty-printed (mehrzeilig, mit Indentation)", () => {
    const json = buildMidiLayoutJson({ name: "X", ccMappings: [], noteMappings: [] });
    expect(json).toContain("\n");
    expect(json).toContain("  "); // 2-space-indent
  });

  it("Round-Trip: CC-Mapping wird identisch reproduziert", () => {
    const ccMappings: MidiMapping[] = [
      { cc: 7, channel: 1, target: { type: "playStop" }, label: "Play / Stop" },
      { cc: 64, channel: 0, target: { type: "volume", partId: "p1", partName: "Kick" }, label: "Volume: Kick" },
    ];
    const json = buildMidiLayoutJson({ name: "RT-Test", ccMappings, noteMappings: [] });
    const result = parseMidiLayoutJson(json);
    expect(result.ok).toBe(true);
    expect(result.layout!.ccMappings).toEqual(ccMappings);
  });

  it("Round-Trip: Note-Mapping wird identisch reproduziert", () => {
    const noteMappings: MidiNoteMapping[] = [
      { note: 36, channel: 10, partId: "p1", label: "Kick" },
      { note: 38, channel: 10, partId: "p2", label: "Snare" },
    ];
    const json = buildMidiLayoutJson({ name: "RT-Note", ccMappings: [], noteMappings });
    const result = parseMidiLayoutJson(json);
    expect(result.ok).toBe(true);
    expect(result.layout!.noteMappings).toEqual(noteMappings);
  });

  it("Round-Trip: gemischte CC + Note werden beide reproduziert (Electribe-Case)", () => {
    const ccMappings: MidiMapping[] = [
      { cc: 1, channel: 1, target: { type: "bpm" }, label: "BPM" },
      { cc: 7, channel: 1, target: { type: "masterVolume" }, label: "Master Volume" },
    ];
    const noteMappings: MidiNoteMapping[] = [
      { note: 36, channel: 10, partId: "p1", label: "Pad 1" },
      { note: 37, channel: 10, partId: "p2", label: "Pad 2" },
    ];
    const json = buildMidiLayoutJson({ name: "Mein Electribe 2", ccMappings, noteMappings });
    const result = parseMidiLayoutJson(json);
    expect(result.ok).toBe(true);
    expect(result.layout!.name).toBe("Mein Electribe 2");
    expect(result.layout!.ccMappings).toEqual(ccMappings);
    expect(result.layout!.noteMappings).toEqual(noteMappings);
  });

  it("leere Mappings (keine CC, keine Note) erzeugen valide JSON aber Parse meldet 'keine gültigen Mappings'", () => {
    const json = buildMidiLayoutJson({ name: "Leer", ccMappings: [], noteMappings: [] });
    expect(() => JSON.parse(json)).not.toThrow();
    const result = parseMidiLayoutJson(json);
    // parseMidiLayoutJson erwartet mind. einen Mapping-Eintrag
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/leeres Resultat|gültigen Mappings/);
  });

  it("alle MidiLearnTarget-Typen werden korrekt serialisiert", () => {
    const ccMappings: MidiMapping[] = [
      { cc: 1,  channel: 1, target: { type: "patternNext" }, label: "Next" },
      { cc: 2,  channel: 1, target: { type: "tapTempo" },    label: "Tap" },
      { cc: 3,  channel: 1, target: { type: "scenelaunch", sceneIndex: 4 }, label: "Scene 5" },
    ];
    const json = buildMidiLayoutJson({ name: "All", ccMappings, noteMappings: [] });
    const result = parseMidiLayoutJson(json);
    expect(result.ok).toBe(true);
    expect(result.layout!.ccMappings).toEqual(ccMappings);
  });
});

describe("sanitizeLayoutFileName (v1.73)", () => {
  it("leerer Input → 'midi-layout'", () => {
    expect(sanitizeLayoutFileName("")).toBe("midi-layout");
    expect(sanitizeLayoutFileName("   ")).toBe("midi-layout");
  });

  it("ASCII-Name unverändert (außer Spaces → Bindestrich)", () => {
    expect(sanitizeLayoutFileName("MyElectribe")).toBe("MyElectribe");
    expect(sanitizeLayoutFileName("My Electribe")).toBe("My-Electribe");
  });

  it("entfernt unsichere Zeichen (Path-Separator, Quotes)", () => {
    expect(sanitizeLayoutFileName('Setup/V1')).toBe("SetupV1");
    expect(sanitizeLayoutFileName('Foo"Bar')).toBe("FooBar");
    expect(sanitizeLayoutFileName("Foo:Bar")).toBe("FooBar");
  });

  it("kollabiert mehrere Bindestriche zu einem", () => {
    expect(sanitizeLayoutFileName("a---b")).toBe("a-b");
    expect(sanitizeLayoutFileName("a   b   c")).toBe("a-b-c");
  });

  it("trimmt führende/anhängende Bindestriche", () => {
    expect(sanitizeLayoutFileName("-foo-")).toBe("foo");
    expect(sanitizeLayoutFileName(" foo ")).toBe("foo");
  });

  it("behält Unicode-Buchstaben + Zahlen (deutsche Umlaute, etc.)", () => {
    expect(sanitizeLayoutFileName("Mörder-Setup")).toBe("Mörder-Setup");
    expect(sanitizeLayoutFileName("Setup 2026")).toBe("Setup-2026");
  });
});

// ─── defaultLayoutNameForDevice (v1.79) ────────────────────────────────────────

describe("defaultLayoutNameForDevice (v1.79)", () => {
  it("undefined / null → 'Mein MIDI-Setup' Fallback", () => {
    expect(defaultLayoutNameForDevice()).toBe("Mein MIDI-Setup");
    expect(defaultLayoutNameForDevice(null)).toBe("Mein MIDI-Setup");
    expect(defaultLayoutNameForDevice(undefined)).toBe("Mein MIDI-Setup");
  });

  it("leerer / whitespace-only String → Fallback", () => {
    expect(defaultLayoutNameForDevice("")).toBe("Mein MIDI-Setup");
    expect(defaultLayoutNameForDevice("   ")).toBe("Mein MIDI-Setup");
  });

  it("Device-Name wird mit '-Setup' Suffix angehängt", () => {
    expect(defaultLayoutNameForDevice("Korg Electribe 2")).toBe("Korg Electribe 2-Setup");
    expect(defaultLayoutNameForDevice("Launchpad MK2")).toBe("Launchpad MK2-Setup");
  });

  it("Whitespace am Anfang/Ende wird getrimmt", () => {
    expect(defaultLayoutNameForDevice("  MPK Mini  ")).toBe("MPK Mini-Setup");
  });
});
