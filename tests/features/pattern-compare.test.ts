/**
 * tests/features/pattern-compare.test.ts (v3.163.0)
 *
 * Pure-Coverage fuer client/src/utils/patternCompare.ts.
 *
 * comparePatterns ist eine reine Funktion - keine Mutation, kein
 * Math.random. Wir bauen kleine PatternData-Fixtures und pruefen die
 * Diff-Buckets + Summary-Formatting.
 */
import { describe, it, expect } from "vitest";
import {
  comparePatterns,
  formatCompareSummary,
  type PatternCompareResult,
} from "@/utils/patternCompare";
import type { PatternData, ChannelFx } from "@/audio/AudioEngine";

// Fixtures

const FX_STUB: ChannelFx = {
  filterEnabled:     false,
  filterType:        "lowpass",
  filterFreq:        20000,
  filterQ:           1,
  filterGain:        0,
  distortionEnabled: false,
  distortionAmount:  0,
} as unknown as ChannelFx;

function makePattern(
  id: string,
  parts: Array<{ id: string; name: string; steps: boolean[] }>,
): PatternData {
  return {
    id,
    name:           "Pattern " + id,
    stepCount:      16 as const,
    stepResolution: "1/16" as any,
    bpm:            120,
    parts: parts.map((p) => ({
      id:     p.id,
      name:   p.name,
      muted:  false,
      soloed: false,
      volume: 1,
      pan:    0,
      steps:  p.steps.map((active) => ({ active })),
      fx:     FX_STUB,
    })) as any,
  };
}

// Tests

describe("comparePatterns - identical handling", () => {
  it("returns identical=true fuer komplett identische Patterns", () => {
    const a = makePattern("A", [
      { id: "kick",  name: "Kick",  steps: [true, false, true, false] },
      { id: "snare", name: "Snare", steps: [false, true, false, true] },
    ]);
    const b = makePattern("B", [
      { id: "kick",  name: "Kick",  steps: [true, false, true, false] },
      { id: "snare", name: "Snare", steps: [false, true, false, true] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.identical).toBe(true);
    expect(r.diffs.length).toBe(0);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(0);
    expect(r.patternAOnlyPartIds).toEqual([]);
    expect(r.patternBOnlyPartIds).toEqual([]);
  });

  it("returns identical=true wenn beide Patterns leer sind", () => {
    const a = makePattern("A", []);
    const b = makePattern("B", []);
    expect(comparePatterns(a, b).identical).toBe(true);
  });
});

describe("comparePatterns - single step diffs", () => {
  it("erkennt einen zusaetzlichen aktiven Step in B (added=1)", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick", steps: [true, false, false, false] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick", steps: [true, true, false, false] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.addedCount).toBe(1);
    expect(r.removedCount).toBe(0);
    expect(r.identical).toBe(false);
    expect(r.diffs).toEqual([
      { partId: "kick", partName: "Kick", stepIndex: 1, kind: "added" },
    ]);
  });

  it("erkennt einen entfernten aktiven Step in B (removed=1)", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick", steps: [true, true, false, false] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick", steps: [true, false, false, false] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(1);
    expect(r.diffs).toEqual([
      { partId: "kick", partName: "Kick", stepIndex: 1, kind: "removed" },
    ]);
  });
});
describe("comparePatterns - different patterns", () => {
  it("zaehlt mehrere added und removed Steps in einem Part korrekt", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick", steps: [false, true, false, true, false, true, false, true] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick", steps: [true, false, true, false, false, true, false, true] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.addedCount).toBe(2);
    expect(r.removedCount).toBe(2);
    expect(r.diffs.map((d) => d.stepIndex + ":" + d.kind)).toEqual([
      "0:added",
      "1:removed",
      "2:added",
      "3:removed",
    ]);
  });

  it("komplett unterschiedliche Patterns: alle Steps wechseln Polaritaet", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick", steps: [true, true, true, true] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick", steps: [false, false, false, false] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(4);
    expect(r.diffs.every((d) => d.kind === "removed")).toBe(true);
  });
});

describe("comparePatterns - part add/remove", () => {
  it("erkennt einen neuen Part in B mit allen aktiven Steps als added", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick", steps: [true, false, true, false] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick", steps: [true, false, true, false] },
      { id: "hat",  name: "HiHat", steps: [true, true, false, true] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.patternBOnlyPartIds).toEqual(["hat"]);
    expect(r.patternAOnlyPartIds).toEqual([]);
    expect(r.addedCount).toBe(3);
    expect(r.removedCount).toBe(0);
    expect(r.diffs.every((d) => d.partId === "hat" && d.kind === "added")).toBe(true);
  });

  it("erkennt einen entfernten Part in B (nur in A) und zaehlt active steps als removed", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick",  steps: [true, false, true, false] },
      { id: "perc", name: "Perc", steps: [true, true, true, false] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick",  steps: [true, false, true, false] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.patternAOnlyPartIds).toEqual(["perc"]);
    expect(r.patternBOnlyPartIds).toEqual([]);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(3);
    expect(r.diffs.every((d) => d.partId === "perc" && d.kind === "removed")).toBe(true);
  });
});
describe("comparePatterns - step length mismatch", () => {
  it("a hat 4 Steps, b hat 8 - extra active steps in b zaehlen als added", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick", steps: [true, false, false, false] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick", steps: [true, false, false, false, true, false, true, false] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.addedCount).toBe(2);
    expect(r.removedCount).toBe(0);
    expect(r.diffs.map((d) => d.stepIndex)).toEqual([4, 6]);
  });

  it("a hat 8 Steps, b hat 4 - extra active steps in a zaehlen als removed", () => {
    const a = makePattern("A", [
      { id: "kick", name: "Kick", steps: [true, false, false, false, true, false, true, false] },
    ]);
    const b = makePattern("B", [
      { id: "kick", name: "Kick", steps: [true, false, false, false] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(2);
    expect(r.diffs.map((d) => d.stepIndex)).toEqual([4, 6]);
  });
});

describe("comparePatterns - ordering", () => {
  it("sortiert diffs nach partId aufsteigend, dann stepIndex aufsteigend", () => {
    const a = makePattern("A", [
      { id: "zebra", name: "Z", steps: [false, false, false] },
      { id: "alpha", name: "A", steps: [false, false, false] },
    ]);
    const b = makePattern("B", [
      { id: "zebra", name: "Z", steps: [true, false, true] },
      { id: "alpha", name: "A", steps: [false, true, false] },
    ]);
    const r = comparePatterns(a, b);
    expect(r.diffs.map((d) => d.partId + ":" + d.stepIndex)).toEqual([
      "alpha:1",
      "zebra:0",
      "zebra:2",
    ]);
  });

  it("partName faellt auf A zurueck wenn B den Part nicht hat (removed Part)", () => {
    const a = makePattern("A", [
      { id: "perc", name: "PercA", steps: [true] },
    ]);
    const b = makePattern("B", []);
    const r = comparePatterns(a, b);
    expect(r.diffs[0]?.partName).toBe("PercA");
  });
});
describe("formatCompareSummary", () => {
  function makeResult(overrides: Partial<PatternCompareResult>): PatternCompareResult {
    return {
      diffs:               [],
      addedCount:          0,
      removedCount:        0,
      identical:           true,
      patternAOnlyPartIds: [],
      patternBOnlyPartIds: [],
      ...overrides,
    };
  }

  it("identical liefert literal identisch", () => {
    expect(formatCompareSummary(makeResult({ identical: true }))).toBe("identisch");
  });

  it("nur added/removed steps liefert +X steps, -Y steps", () => {
    const s = formatCompareSummary(
      makeResult({ identical: false, addedCount: 12, removedCount: 3 }),
    );
    expect(s).toBe("+12 steps, -3 steps");
  });

  it("mit 1 neuem Part (Singular)", () => {
    const s = formatCompareSummary(
      makeResult({
        identical:           false,
        addedCount:          5,
        removedCount:        0,
        patternBOnlyPartIds: ["hat"],
      }),
    );
    expect(s).toBe("+5 steps, -0 steps, 1 neuer Part");
  });

  it("mit 2 neuen Parts (Plural) + 1 entferntem Part (Singular)", () => {
    const s = formatCompareSummary(
      makeResult({
        identical:           false,
        addedCount:          5,
        removedCount:        2,
        patternAOnlyPartIds: ["perc"],
        patternBOnlyPartIds: ["hat", "ride"],
      }),
    );
    expect(s).toBe("+5 steps, -2 steps, 2 neue Parts, 1 entfernter Part");
  });

  it("mit nur entfernten Parts (Plural)", () => {
    const s = formatCompareSummary(
      makeResult({
        identical:           false,
        addedCount:          0,
        removedCount:        7,
        patternAOnlyPartIds: ["perc", "hat"],
      }),
    );
    expect(s).toBe("+0 steps, -7 steps, 2 entfernte Parts");
  });
});
