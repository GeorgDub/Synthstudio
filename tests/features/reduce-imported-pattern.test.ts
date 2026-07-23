import { describe, it, expect } from "vitest";
import {
  patternNeedsReduction,
  reduceImportedPatternSteps,
  reduceImportResultSteps,
} from "../../client/src/utils/imports/reduceImportedPattern";
import type {
  ImportResult,
  ImportedPattern,
} from "../../client/src/utils/imports/types";

function mkPattern(
  stepCount: number,
  activeAt: number[] = []
): ImportedPattern {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    active: activeAt.includes(i),
  }));
  return {
    name: `P${stepCount}`,
    stepCount,
    parts: [{ name: "part0", steps }],
  };
}

describe("patternNeedsReduction", () => {
  it("false für 16-Step (reale ESX-1) und 64-Step", () => {
    expect(patternNeedsReduction(mkPattern(16))).toBe(false);
    expect(patternNeedsReduction(mkPattern(64))).toBe(false);
  });
  it("true für 128-Step (ESX 8 Bänke → E2S 4 Bänke)", () => {
    expect(patternNeedsReduction(mkPattern(128))).toBe(true);
  });
  it("true, wenn ein Part mehr Steps trägt als stepCount angibt", () => {
    const p = mkPattern(64);
    p.parts[0].steps = Array.from({ length: 128 }, () => ({ active: false }));
    expect(patternNeedsReduction(p)).toBe(true);
  });
});

describe("reduceImportedPatternSteps", () => {
  it("16-Step bleibt unverändert (No-op → gleiche Referenz)", () => {
    const p = mkPattern(16);
    expect(reduceImportedPatternSteps(p)).toBe(p);
  });

  it("128→64 decimate: jeder 2. Step, stepCount auf 64", () => {
    const p = mkPattern(128, [4, 5]); // 4 gerade → bleibt, 5 ungerade → weg
    const out = reduceImportedPatternSteps(p, 64, "decimate");
    expect(out.stepCount).toBe(64);
    expect(out.parts[0].steps).toHaveLength(64);
    expect(out.parts[0].steps[2].active).toBe(true); // Step 4 → Index 2
    expect(out.parts[0].steps.filter(s => s.active)).toHaveLength(1);
  });

  it("128→64 truncate: erste 64", () => {
    const p = mkPattern(128, [70]); // aktiv nur in der zweiten Hälfte
    const out = reduceImportedPatternSteps(p, 64, "truncate");
    expect(out.parts[0].steps).toHaveLength(64);
    expect(out.parts[0].steps.filter(s => s.active)).toHaveLength(0); // Step 70 verworfen
  });
});

describe("reduceImportResultSteps", () => {
  const base: ImportResult = {
    sourceFormat: "esx",
    fileName: "x.esx",
    patterns: [mkPattern(16), mkPattern(128, [0, 2]), mkPattern(64)],
    warnings: [],
  };

  it("reduziert nur die betroffenen Patterns + meldet die Anzahl", () => {
    const { result, reducedCount } = reduceImportResultSteps(base, 64);
    expect(reducedCount).toBe(1);
    expect(result.patterns[0].stepCount).toBe(16);
    expect(result.patterns[1].stepCount).toBe(64);
    expect(result.patterns[2].stepCount).toBe(64);
  });

  it("No-op (nur 16/64-Step) → gleiche Referenz, reducedCount 0", () => {
    const only16: ImportResult = {
      ...base,
      patterns: [mkPattern(16), mkPattern(64)],
    };
    const { result, reducedCount } = reduceImportResultSteps(only16, 64);
    expect(reducedCount).toBe(0);
    expect(result).toBe(only16);
  });
});
