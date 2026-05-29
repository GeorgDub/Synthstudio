/**
 * tests/features/pattern-manager.test.ts — reine Helfer des Pattern-Managers.
 */
import { describe, it, expect } from "vitest";
import {
  countActiveSteps,
  countActiveChannels,
  collectPatternLabels,
  patternMatchesQuery,
  sortPatternsBy,
  type PMPattern,
} from "../../client/src/utils/patternManager";

const mk = (name: string, parts: Array<{ name: string; sampleName?: string; active: number[] }>): PMPattern => ({
  id: name,
  name,
  stepCount: 16,
  parts: parts.map(p => ({
    name: p.name,
    sampleName: p.sampleName,
    steps: Array.from({ length: 16 }, (_, i) => ({ active: p.active.includes(i) })),
  })),
});

describe("countActiveSteps / countActiveChannels", () => {
  const p = mk("P", [
    { name: "Kick", active: [0, 4, 8, 12] },
    { name: "Snare", active: [4, 12] },
    { name: "Hat", active: [] },
  ]);
  it("zählt aktive Steps über alle Parts", () => {
    expect(countActiveSteps(p)).toBe(6);
  });
  it("zählt nur Kanäle mit ≥1 aktivem Step", () => {
    expect(countActiveChannels(p)).toBe(2);
  });
});

describe("collectPatternLabels", () => {
  it("Pattern-Name + Part-Namen + Sample-Namen, dedupliziert", () => {
    const p = mk("Beat 1", [
      { name: "Kick", sampleName: "CB_Kick.wav", active: [] },
      { name: "Kick", sampleName: "CB_Kick.wav", active: [] }, // dup
      { name: "Snare", sampleName: "snr.wav", active: [] },
    ]);
    expect(collectPatternLabels(p)).toEqual(["Beat 1", "Kick", "CB_Kick.wav", "Snare", "snr.wav"]);
  });
});

describe("patternMatchesQuery", () => {
  const p = mk("Verse", [{ name: "SNARE 1", sampleName: "Kore Snare_6.wav", active: [] }]);
  it("leeres Query trifft immer", () => {
    expect(patternMatchesQuery(p, "  ")).toBe(true);
  });
  it("trifft Pattern-Name", () => {
    expect(patternMatchesQuery(p, "vers")).toBe(true);
  });
  it("trifft Kanal-Name (case-insensitive)", () => {
    expect(patternMatchesQuery(p, "snare")).toBe(true);
  });
  it("trifft Sample-Name", () => {
    expect(patternMatchesQuery(p, "kore")).toBe(true);
  });
  it("kein Treffer → false", () => {
    expect(patternMatchesQuery(p, "kick")).toBe(false);
  });
});

describe("sortPatternsBy", () => {
  const a = mk("Pattern 2", [{ name: "x", active: [0] }]);                       // 1 step, 1 ch
  const b = mk("Pattern 10", [{ name: "x", active: [0, 1, 2] }, { name: "y", active: [3] }]); // 4 steps, 2 ch
  const c = mk("Pattern 1", [{ name: "x", active: [0, 1] }]);                    // 2 steps, 1 ch
  const list = [a, b, c];

  it("original behält Eingabereihenfolge", () => {
    expect(sortPatternsBy(list, "original").map(p => p.name)).toEqual(["Pattern 2", "Pattern 10", "Pattern 1"]);
  });
  it("density: vollste zuerst", () => {
    expect(sortPatternsBy(list, "density").map(p => p.name)).toEqual(["Pattern 10", "Pattern 1", "Pattern 2"]);
  });
  it("channels: meiste Kanäle zuerst", () => {
    expect(sortPatternsBy(list, "channels")[0].name).toBe("Pattern 10");
  });
  it("name: numerisch korrekt (Pattern 2 < Pattern 10)", () => {
    expect(sortPatternsBy(list, "name").map(p => p.name)).toEqual(["Pattern 1", "Pattern 2", "Pattern 10"]);
  });
  it("mutiert die Eingabe nicht", () => {
    const copy = [...list];
    sortPatternsBy(list, "density");
    expect(list).toEqual(copy);
  });
});
