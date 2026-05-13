/**
 * tests/features/midi-layout-import.test.ts
 *
 * Unit-Tests für den generic-JSON MIDI-Layout-Parser (post-v1.38.0).
 *
 * Was getestet wird:
 *  - parseMidiLayoutJson valider Input → ok: true mit korrekten Mappings
 *  - JSON-Syntax-Errors → ok: false mit error
 *  - Fehlender / falscher `synthstudioLayout` Marker
 *  - cc / channel / note Range-Validierung
 *  - Target-Validierung gegen erlaubte Typen
 *  - Größenlimit
 *  - Einzel-Einträge mit Warnings übersprungen
 *  - checkPartIdsExist Cross-Check gegen Pattern-Parts
 */
import { describe, it, expect } from "vitest";
import {
  parseMidiLayoutJson,
  checkPartIdsExist,
  MAX_LAYOUT_FILE_BYTES,
  VALID_TARGET_TYPES,
} from "../../client/src/utils/midiLayoutImport";

describe("parseMidiLayoutJson — Validation", () => {
  it("akzeptiert ein minimales valides Layout", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [
        { cc: 1, channel: 0, target: { type: "bpm" }, label: "Mod → BPM" },
      ],
      noteMappings: [],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(true);
    expect(result.layout?.ccMappings).toHaveLength(1);
    expect(result.layout?.ccMappings[0].cc).toBe(1);
  });

  it("akzeptiert beide Mapping-Arten zusammen", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      name: "Test",
      ccMappings: [
        { cc: 7, channel: 0, target: { type: "masterVolume" }, label: "Master" },
      ],
      noteMappings: [
        { note: 36, channel: 9, partId: "kick", label: "Kick" },
        { note: 38, channel: 9, partId: "snare", label: "Snare" },
      ],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(true);
    expect(result.layout?.name).toBe("Test");
    expect(result.layout?.ccMappings).toHaveLength(1);
    expect(result.layout?.noteMappings).toHaveLength(2);
  });

  it("lehnt leeren String ab", () => {
    expect(parseMidiLayoutJson("").ok).toBe(false);
    expect(parseMidiLayoutJson("   ").ok).toBe(false);
  });

  it("lehnt ungültiges JSON ab", () => {
    const result = parseMidiLayoutJson("{not json}");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/JSON-Parse/);
  });

  it("lehnt nicht-Objekt-Top-Level ab", () => {
    expect(parseMidiLayoutJson("[]").ok).toBe(false);
    expect(parseMidiLayoutJson("42").ok).toBe(false);
    expect(parseMidiLayoutJson('"string"').ok).toBe(false);
    expect(parseMidiLayoutJson("null").ok).toBe(false);
  });

  it("lehnt fehlenden synthstudioLayout-Marker ab", () => {
    const text = JSON.stringify({ ccMappings: [{ cc: 1, channel: 0, target: { type: "bpm" } }] });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/synthstudioLayout/);
  });

  it("lehnt falsche Version ab", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v2",
      ccMappings: [{ cc: 1, channel: 0, target: { type: "bpm" } }],
    });
    expect(parseMidiLayoutJson(text).ok).toBe(false);
  });

  it("lehnt zu große Datei ab", () => {
    const huge = "x".repeat(MAX_LAYOUT_FILE_BYTES + 1);
    const result = parseMidiLayoutJson(huge);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/zu gro/i);
  });

  it("lehnt ab wenn keine validen Mappings drin sind", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [],
      noteMappings: [],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Keine gültigen Mappings/);
  });
});

describe("parseMidiLayoutJson — Einzel-Einträge-Validierung mit Warnings", () => {
  it("überspringt ccMappings mit ungültigem cc + warnt", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [
        { cc: 999, channel: 0, target: { type: "bpm" } }, // invalid cc
        { cc: 1, channel: 0, target: { type: "bpm" } }, // valid
      ],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(true);
    expect(result.layout?.ccMappings).toHaveLength(1);
    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(result.warnings?.[0]).toMatch(/ungültiger cc/);
  });

  it("überspringt ccMappings mit ungültigem channel", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [
        { cc: 1, channel: 99, target: { type: "bpm" } },
        { cc: 2, channel: 0, target: { type: "bpm" } },
      ],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(true);
    expect(result.layout?.ccMappings).toHaveLength(1);
    expect(result.warnings?.some((w) => w.includes("channel"))).toBe(true);
  });

  it("überspringt ccMappings mit ungültigem target-typ", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [
        { cc: 1, channel: 0, target: { type: "definitelyNotAValidType" } },
        { cc: 2, channel: 0, target: { type: "bpm" } },
      ],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(true);
    expect(result.layout?.ccMappings).toHaveLength(1);
    expect(result.warnings?.some((w) => w.includes("target"))).toBe(true);
  });

  it("überspringt noteMappings mit fehlender partId", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      noteMappings: [
        { note: 36, channel: 0, partId: "", label: "x" },
        { note: 38, channel: 0, partId: "snare", label: "Snare" },
      ],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(true);
    expect(result.layout?.noteMappings).toHaveLength(1);
    expect(result.warnings?.some((w) => w.includes("partId"))).toBe(true);
  });

  it("akzeptiert label-Fallback wenn nicht angegeben", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [{ cc: 1, channel: 0, target: { type: "bpm" } }],
    });
    const result = parseMidiLayoutJson(text);
    expect(result.ok).toBe(true);
    expect(result.layout?.ccMappings[0].label).toBe("CC 1");
  });
});

describe("parseMidiLayoutJson — Range-Boundaries", () => {
  it("akzeptiert cc=0 (untere Grenze)", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [{ cc: 0, channel: 0, target: { type: "bpm" } }],
    });
    expect(parseMidiLayoutJson(text).ok).toBe(true);
  });

  it("akzeptiert cc=127 (obere Grenze)", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [{ cc: 127, channel: 0, target: { type: "bpm" } }],
    });
    expect(parseMidiLayoutJson(text).ok).toBe(true);
  });

  it("akzeptiert channel=16 (obere Grenze inkl.)", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [{ cc: 1, channel: 16, target: { type: "bpm" } }],
    });
    expect(parseMidiLayoutJson(text).ok).toBe(true);
  });

  it("lehnt cc=-1 ab", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [{ cc: -1, channel: 0, target: { type: "bpm" } }],
    });
    const result = parseMidiLayoutJson(text);
    // Single invalid entry → warning, kein-mappings-error
    expect(result.ok).toBe(false);
  });

  it("lehnt cc=128 ab", () => {
    const text = JSON.stringify({
      synthstudioLayout: "v1",
      ccMappings: [{ cc: 128, channel: 0, target: { type: "bpm" } }],
    });
    expect(parseMidiLayoutJson(text).ok).toBe(false);
  });
});

describe("VALID_TARGET_TYPES", () => {
  it("enthält alle Transport-targets", () => {
    expect(VALID_TARGET_TYPES.has("bpm")).toBe(true);
    expect(VALID_TARGET_TYPES.has("playStop")).toBe(true);
    expect(VALID_TARGET_TYPES.has("record")).toBe(true);
    expect(VALID_TARGET_TYPES.has("masterVolume")).toBe(true);
  });

  it("enthält Pattern-targets", () => {
    expect(VALID_TARGET_TYPES.has("patternNext")).toBe(true);
    expect(VALID_TARGET_TYPES.has("patternPrev")).toBe(true);
  });

  it("erkennt non-existente Targets nicht", () => {
    expect(VALID_TARGET_TYPES.has("definitelyNotATarget")).toBe(false);
    expect(VALID_TARGET_TYPES.has("")).toBe(false);
  });
});

describe("checkPartIdsExist", () => {
  it("returnt keine Warnings wenn alle partIds bekannt sind", () => {
    const warnings = checkPartIdsExist(
      [
        { note: 36, channel: 0, partId: "kick", label: "Kick" },
        { note: 38, channel: 0, partId: "snare", label: "Snare" },
      ],
      ["kick", "snare", "hat"],
    );
    expect(warnings).toEqual([]);
  });

  it("warnt wenn partIds fehlen", () => {
    const warnings = checkPartIdsExist(
      [
        { note: 36, channel: 0, partId: "kick", label: "Kick" },
        { note: 50, channel: 0, partId: "unknown-part", label: "?" },
      ],
      ["kick", "snare"],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown-part/);
  });

  it("dedupliziert Warnings für mehrfach fehlende IDs", () => {
    const warnings = checkPartIdsExist(
      [
        { note: 36, channel: 0, partId: "missing", label: "a" },
        { note: 38, channel: 0, partId: "missing", label: "b" },
      ],
      ["kick"],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/1 unbekannte/);
  });

  it("kürzt die Liste auf 5 Beispiele bei vielen fehlenden", () => {
    const noteMappings = Array.from({ length: 10 }, (_, i) => ({
      note: 60 + i,
      channel: 0,
      partId: `missing-${i}`,
      label: `m${i}`,
    }));
    const warnings = checkPartIdsExist(noteMappings, []);
    expect(warnings[0]).toMatch(/10 unbekannte/);
    expect(warnings[0]).toMatch(/…/);
  });

  it("returnt keine Warnings bei leerer Mapping-Liste", () => {
    expect(checkPartIdsExist([], [])).toEqual([]);
  });
});
