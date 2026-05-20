/**
 * pattern-density-heatmap.test.ts
 * Tests fuer client/src/utils/patternDensityHeatmap.ts (v3.202).
 *
 * Coverage:
 *   - buildHeatmap: empty/single/multi-part, sparse storage,
 *     stepCount = max length, maxValue + avgDensity korrekt,
 *     velocity-Clamping, defensive (NaN/neg/>1/undefined)
 *   - columnDensity: alle inaktiv/aktiv, out-of-bounds, NaN
 *   - rowDensity: leer/voll, missing
 *   - findHotspot: leer/single/tie-break
 */

import { describe, expect, it } from "vitest";
import {
  buildHeatmap,
  columnDensity,
  rowDensity,
  findHotspot,
  type PatternRowLike,
} from "@/utils/patternDensityHeatmap";

// Helpers

function row(
  steps: Array<boolean | { active: boolean; velocity?: number }>,
  partId?: string,
): PatternRowLike {
  return {
    partId,
    partName: partId,
    steps: steps.map((s) =>
      typeof s === "boolean" ? { active: s } : s,
    ),
  };
}

function fourOnTheFloor(): PatternRowLike {
  const steps: boolean[] = new Array(16).fill(false);
  steps[0] = steps[4] = steps[8] = steps[12] = true;
  return row(steps, "kick");
}

// buildHeatmap

describe("buildHeatmap", () => {
  it("empty parts -> all zero", () => {
    const h = buildHeatmap([]);
    expect(h.cells).toEqual([]);
    expect(h.partCount).toBe(0);
    expect(h.stepCount).toBe(0);
    expect(h.maxValue).toBe(0);
    expect(h.avgDensity).toBe(0);
  });

  it("single part, single active step", () => {
    const h = buildHeatmap([row([false, true, false, false], "snare")]);
    expect(h.cells).toEqual([{ partIndex: 0, stepIndex: 1, value: 1 }]);
    expect(h.partCount).toBe(1);
    expect(h.stepCount).toBe(4);
    expect(h.maxValue).toBe(1);
    expect(h.avgDensity).toBeCloseTo(1 / 4, 6);
  });

  it("multi-part 4x16 4-on-the-floor (only kick lane active)", () => {
    const parts = [
      fourOnTheFloor(),
      row(new Array(16).fill(false), "snare"),
      row(new Array(16).fill(false), "hat"),
      row(new Array(16).fill(false), "perc"),
    ];
    const h = buildHeatmap(parts);
    expect(h.partCount).toBe(4);
    expect(h.stepCount).toBe(16);
    expect(h.cells.length).toBe(4);
    expect(h.cells.every((c) => c.partIndex === 0 && c.value === 1)).toBe(true);
    expect(h.cells.map((c) => c.stepIndex)).toEqual([0, 4, 8, 12]);
    expect(h.maxValue).toBe(1);
    expect(h.avgDensity).toBeCloseTo(4 / 64, 6);
  });

  it("avgDensity korrekt (half-full single part)", () => {
    const steps = new Array(8).fill(false).map((_, i) => i % 2 === 0);
    const h = buildHeatmap([row(steps, "a")]);
    expect(h.avgDensity).toBeCloseTo(0.5, 6);
  });

  it("avgDensity full pattern -> 1.0", () => {
    const h = buildHeatmap([row(new Array(4).fill(true), "a")]);
    expect(h.avgDensity).toBeCloseTo(1.0, 6);
  });

  it("maxValue korrekt (varying velocities)", () => {
    const h = buildHeatmap([
      row(
        [
          { active: true, velocity: 0.3 },
          { active: true, velocity: 0.9 },
          { active: true, velocity: 0.5 },
        ],
        "a",
      ),
    ]);
    expect(h.maxValue).toBeCloseTo(0.9, 6);
  });

  it("sparse storage: cells.length = active count, not parts*steps", () => {
    const parts = [
      row([true, false, false, false], "a"),
      row([false, true, false, false], "b"),
      row([false, false, true, false], "c"),
    ];
    const h = buildHeatmap(parts);
    expect(h.cells.length).toBe(3); // 3 active, not 3*4=12
    expect(h.partCount).toBe(3);
    expect(h.stepCount).toBe(4);
    expect(h.avgDensity).toBeCloseTo(3 / 12, 6);
  });

  it("velocity clamping: NaN/neg/>1 -> 1, valid kept", () => {
    const h = buildHeatmap([
      row(
        [
          { active: true, velocity: NaN },
          { active: true, velocity: -0.3 },
          { active: true, velocity: 1.5 },
          { active: true, velocity: 0.7 },
        ],
        "a",
      ),
    ]);
    expect(h.cells.length).toBe(4);
    expect(h.cells[0].value).toBe(1); // NaN -> 1
    expect(h.cells[1].value).toBe(1); // neg -> 1
    expect(h.cells[2].value).toBe(1); // >1 -> 1
    expect(h.cells[3].value).toBeCloseTo(0.7, 6);
  });

  it("velocity undefined -> 1 (default)", () => {
    const h = buildHeatmap([
      row([{ active: true }, { active: true, velocity: 0.5 }], "a"),
    ]);
    expect(h.cells[0].value).toBe(1);
    expect(h.cells[1].value).toBeCloseTo(0.5, 6);
  });

  it("stepCount = max length across parts with different step counts", () => {
    const parts = [row([true, false], "a"), row([false, false, true, false], "b")];
    const h = buildHeatmap(parts);
    expect(h.stepCount).toBe(4);
    expect(h.partCount).toBe(2);
    expect(h.cells.length).toBe(2);
    // avgDensity = 2 active / (2 parts * 4 steps) = 0.25
    expect(h.avgDensity).toBeCloseTo(2 / 8, 6);
  });

  it("defaults bei missing partId/partName (no crash, cells emitted)", () => {
    const part: PatternRowLike = { steps: [{ active: true, velocity: 0.4 }] };
    const h = buildHeatmap([part]);
    expect(h.cells).toEqual([{ partIndex: 0, stepIndex: 0, value: 0.4 }]);
  });

  it("Infinity velocity -> 1 (clamped via finite check)", () => {
    const h = buildHeatmap([
      row([{ active: true, velocity: Infinity }], "a"),
    ]);
    expect(h.cells[0].value).toBe(1);
  });

  it("part with no steps -> no cells, partCount counted, stepCount unchanged", () => {
    const parts: PatternRowLike[] = [row([], "empty"), row([true], "b")];
    const h = buildHeatmap(parts);
    expect(h.partCount).toBe(2);
    expect(h.stepCount).toBe(1);
    expect(h.cells.length).toBe(1);
    expect(h.cells[0].partIndex).toBe(1);
  });
});

// columnDensity

describe("columnDensity", () => {
  it("alle inaktiv -> 0", () => {
    const parts = [
      row([false, false, false], "a"),
      row([false, false, false], "b"),
    ];
    expect(columnDensity(parts, 0)).toBe(0);
    expect(columnDensity(parts, 1)).toBe(0);
    expect(columnDensity(parts, 2)).toBe(0);
  });

  it("alle aktiv -> 1", () => {
    const parts = [row([true, true], "a"), row([true, true], "b")];
    expect(columnDensity(parts, 0)).toBe(1);
    expect(columnDensity(parts, 1)).toBe(1);
  });

  it("partial -> fraction", () => {
    const parts = [
      row([true, false], "a"),
      row([true, false], "b"),
      row([false, false], "c"),
      row([false, false], "d"),
    ];
    expect(columnDensity(parts, 0)).toBeCloseTo(0.5, 6);
    expect(columnDensity(parts, 1)).toBe(0);
  });

  it("out-of-bounds stepIndex -> 0", () => {
    const parts = [row([true, true], "a")];
    expect(columnDensity(parts, 5)).toBe(0);
    expect(columnDensity(parts, -1)).toBe(0);
  });

  it("NaN stepIndex -> 0", () => {
    const parts = [row([true], "a")];
    expect(columnDensity(parts, NaN)).toBe(0);
  });

  it("empty parts -> 0", () => {
    expect(columnDensity([], 0)).toBe(0);
  });

  it("mixed step lengths: out-of-range for shorter parts treated inactive", () => {
    const parts = [row([true, true, true], "a"), row([true], "b")];
    // stepIndex=2: a active (1), b out-of-range (counts as inactive)
    expect(columnDensity(parts, 2)).toBeCloseTo(0.5, 6);
  });
});

// rowDensity

describe("rowDensity", () => {
  it("leer -> 0", () => {
    expect(rowDensity(row([], "a"))).toBe(0);
  });

  it("voll -> 1", () => {
    expect(rowDensity(row([true, true, true, true], "a"))).toBe(1);
  });

  it("half -> 0.5", () => {
    expect(rowDensity(row([true, false, true, false], "a"))).toBeCloseTo(0.5, 6);
  });

  it("alle inaktiv -> 0", () => {
    expect(rowDensity(row([false, false, false], "a"))).toBe(0);
  });
});

// findHotspot

describe("findHotspot", () => {
  it("leere Heatmap -> null", () => {
    const h = buildHeatmap([]);
    expect(findHotspot(h)).toBeNull();
  });

  it("all-inactive parts -> null", () => {
    const h = buildHeatmap([row([false, false], "a"), row([false], "b")]);
    expect(findHotspot(h)).toBeNull();
  });

  it("single active cell -> die Cell", () => {
    const h = buildHeatmap([row([false, true, false], "a")]);
    expect(findHotspot(h)).toEqual({ partIndex: 0, stepIndex: 1, value: 1 });
  });

  it("varying velocities -> hoechster value gewinnt", () => {
    const h = buildHeatmap([
      row(
        [
          { active: true, velocity: 0.3 },
          { active: true, velocity: 0.9 },
          { active: true, velocity: 0.5 },
        ],
        "a",
      ),
    ]);
    const hot = findHotspot(h);
    expect(hot).not.toBeNull();
    expect(hot!.stepIndex).toBe(1);
    expect(hot!.value).toBeCloseTo(0.9, 6);
  });

  it("tie -> erster Treffer gewinnt (deterministic)", () => {
    const h = buildHeatmap([
      row([{ active: true, velocity: 0.8 }, { active: true, velocity: 0.8 }], "a"),
    ]);
    const hot = findHotspot(h);
    expect(hot).not.toBeNull();
    expect(hot!.stepIndex).toBe(0); // first beats second on tie
  });
});
