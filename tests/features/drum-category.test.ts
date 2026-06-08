/**
 * tests/features/drum-category.test.ts (v3.269)
 *
 * Pure-Coverage für categorizeDrumName (Name → Drum-Kategorie, Auto-Mix-Targets).
 */
import { describe, it, expect } from "vitest";
import { categorizeDrumName } from "@/utils/drumCategory";

describe("categorizeDrumName – Happy Path", () => {
  it.each([
    ["Kick 1", "kick"],
    ["BD 808", "kick"],
    ["Snare 909", "snare"],
    ["Clap", "clap"],
    ["Closed Hat", "hihat-closed"],
    ["Open Hat", "hihat-open"],
    ["Crash Cymbal", "cymbal"],
    ["Conga Perc", "perc"],
    ["Sub Bass", "bass"],
    ["Lead Synth", "synth"],
    ["Vocal Chop", "vocal"],
    ["Riser FX", "fx"],
    ["Drum Loop", "loop"],
  ])("%s → %s", (name, expected) => {
    expect(categorizeDrumName(name)).toBe(expected);
  });
});

describe("categorizeDrumName – Spezifität (Reihenfolge)", () => {
  it("'Open Hat' wird hihat-open, nicht hihat-closed", () => {
    expect(categorizeDrumName("Open Hat")).toBe("hihat-open");
  });

  it("'Sub Bass' wird bass (nicht synth)", () => {
    expect(categorizeDrumName("Sub Bass")).toBe("bass");
  });

  it("'808' allein → kick", () => {
    expect(categorizeDrumName("808")).toBe("kick");
  });
});

describe("categorizeDrumName – Edge Cases", () => {
  it("leerer Name → unknown", () => {
    expect(categorizeDrumName("")).toBe("unknown");
  });

  it("null/undefined → unknown", () => {
    expect(categorizeDrumName(null)).toBe("unknown");
    expect(categorizeDrumName(undefined)).toBe("unknown");
  });

  it("unbekannter Name → unknown", () => {
    expect(categorizeDrumName("Zorblax")).toBe("unknown");
  });

  it("Case-insensitiv", () => {
    expect(categorizeDrumName("KICK")).toBe("kick");
    expect(categorizeDrumName("sNaRe")).toBe("snare");
  });
});
