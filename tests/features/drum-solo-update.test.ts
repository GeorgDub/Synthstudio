/**
 * Synthstudio – applySoloUpdate Tests (v2.50 / FOLLOWUP-102-3)
 *
 * Pure-Transform-Test für die exclusive-vs-additive Solo-Semantik aus
 * setPartSoloed. Deckt die Branch ab die in Roadmap als „next" Item stand.
 *
 * Test-Fokus:
 * - exclusive=true (Default, Radio-Button-Verhalten): un-solo aller anderen
 * - exclusive=false (additive, DAW-Konvention): andere Parts unverändert
 * - Cross-Pattern: Update wirkt auf alle Patterns gleichzeitig (matched
 *   das Original-Verhalten von updatePatterns(ps => ps.map(...))).
 */
import { describe, it, expect } from "vitest";
import { applySoloUpdate } from "../../client/src/store/useDrumMachineStore";
import type { PatternData, PartData } from "../../client/src/audio/AudioEngine";

function makePart(id: string, soloed = false, muted = false): PartData {
  return {
    id,
    name: id,
    sampleUrl: undefined,
    muted,
    soloed,
    volume: 1,
    pan: 0,
    stepResolution: undefined,
    steps: [],
    fx: {} as PartData["fx"],
  };
}

function makePattern(id: string, parts: PartData[]): PatternData {
  return {
    id,
    name: id,
    parts,
    stepCount: 16,
    bpm: null,
    stepResolution: "1/16",
  } as PatternData;
}

describe("applySoloUpdate — exclusive=true (Radio-Button-Default)", () => {
  it("Setzt soloed=true auf Ziel-Part und false auf alle anderen", () => {
    const pattern = makePattern("pat", [
      makePart("p1"),
      makePart("p2", true),  // war soloed
      makePart("p3"),
    ]);
    const [result] = applySoloUpdate([pattern], "p1", true, true);
    const p1 = result.parts.find(p => p.id === "p1");
    const p2 = result.parts.find(p => p.id === "p2");
    const p3 = result.parts.find(p => p.id === "p3");
    expect(p1?.soloed).toBe(true);
    expect(p2?.soloed).toBe(false); // un-solo'd
    expect(p3?.soloed).toBe(false);
  });

  it("Setzt soloed=false auf Ziel + räumt alle anderen ebenfalls auf (Solo deaktivieren)", () => {
    const pattern = makePattern("pat", [
      makePart("p1", true),
      makePart("p2", true),
    ]);
    const [result] = applySoloUpdate([pattern], "p1", false, true);
    expect(result.parts.find(p => p.id === "p1")?.soloed).toBe(false);
    expect(result.parts.find(p => p.id === "p2")?.soloed).toBe(false);
  });

  it("Ziel-Part existiert nicht → alle anderen bekommen soloed=false (Side-Effect)", () => {
    // Spiegelt das Pre-Refactor-Verhalten 1:1: weil das map() den Ziel-Part
    // nie matched, fällt es immer in den exclusive-else-Branch und cleart alles.
    const pattern = makePattern("pat", [
      makePart("p1", true),
      makePart("p2", true),
    ]);
    const [result] = applySoloUpdate([pattern], "nicht-existent", true, true);
    expect(result.parts.every(p => p.soloed === false)).toBe(true);
  });
});

describe("applySoloUpdate — exclusive=false (DAW-additive)", () => {
  it("Setzt nur Ziel-Part — andere bleiben unverändert", () => {
    const pattern = makePattern("pat", [
      makePart("p1", false),
      makePart("p2", true),
      makePart("p3", true),
    ]);
    const [result] = applySoloUpdate([pattern], "p1", true, false);
    expect(result.parts.find(p => p.id === "p1")?.soloed).toBe(true);
    expect(result.parts.find(p => p.id === "p2")?.soloed).toBe(true);
    expect(result.parts.find(p => p.id === "p3")?.soloed).toBe(true);
  });

  it("Un-solo additive: andere bleiben aktiviert", () => {
    const pattern = makePattern("pat", [
      makePart("p1", true),
      makePart("p2", true),
    ]);
    const [result] = applySoloUpdate([pattern], "p1", false, false);
    expect(result.parts.find(p => p.id === "p1")?.soloed).toBe(false);
    expect(result.parts.find(p => p.id === "p2")?.soloed).toBe(true);
  });

  it("Ziel-Part fehlt → kein Side-Effect (keine Änderung)", () => {
    const before = [makePart("p1", true), makePart("p2", true)];
    const [result] = applySoloUpdate([makePattern("pat", before)], "nicht-existent", true, false);
    expect(result.parts).toEqual(before);
  });
});

describe("applySoloUpdate — Cross-Pattern (alle Patterns gleichzeitig)", () => {
  it("Update wirkt auf alle Patterns die den Part enthalten (gleicher ID)", () => {
    const patterns = [
      makePattern("pat1", [makePart("p1", false), makePart("p2", true)]),
      makePattern("pat2", [makePart("p1", false), makePart("p2", true)]),
    ];
    const result = applySoloUpdate(patterns, "p1", true, true);
    for (const p of result) {
      expect(p.parts.find(pt => pt.id === "p1")?.soloed).toBe(true);
      expect(p.parts.find(pt => pt.id === "p2")?.soloed).toBe(false);
    }
  });

  it("Pattern-Mengen-Schutz: gibt eine neue Array-Referenz zurück (immutable)", () => {
    const patterns = [makePattern("pat", [makePart("p1")])];
    const result = applySoloUpdate(patterns, "p1", true, true);
    expect(result).not.toBe(patterns);
    expect(result[0]).not.toBe(patterns[0]);
    expect(result[0].parts).not.toBe(patterns[0].parts);
  });
});

describe("applySoloUpdate — Edge-Cases", () => {
  it("Leere Patterns-Liste → leeres Resultat", () => {
    expect(applySoloUpdate([], "p1", true, true)).toEqual([]);
  });

  it("Pattern mit 0 Parts → bleibt mit 0 Parts (kein Crash)", () => {
    const empty = makePattern("pat", []);
    const [result] = applySoloUpdate([empty], "p1", true, true);
    expect(result.parts).toEqual([]);
  });

  it("Bewahrt Part-Properties außerhalb von soloed (volume, muted, name)", () => {
    const original = {
      ...makePart("p1", false, true),
      volume: 0.42,
      name: "Lead",
    };
    const [result] = applySoloUpdate([makePattern("pat", [original])], "p1", true, true);
    const after = result.parts[0];
    expect(after.volume).toBe(0.42);
    expect(after.name).toBe("Lead");
    expect(after.muted).toBe(true);
    expect(after.soloed).toBe(true);
  });
});
