/**
 * tests/features/reorder-patterns.test.ts
 *
 * v2.8: Pattern-Reorder Reducer-Logic getestet als pure Funktion.
 */
import { describe, it, expect } from "vitest";

interface Pattern { id: string; name: string }

/**
 * Pure-Helper-Spiegel der reorderPatterns-Reducer-Logic aus useDrumMachineStore.
 * Sortiert das Pattern an fromIndex an die Position toIndex.
 */
function reorder(patterns: Pattern[], fromIndex: number, toIndex: number): Pattern[] {
  if (fromIndex === toIndex) return patterns;
  if (fromIndex < 0 || fromIndex >= patterns.length) return patterns;
  if (toIndex < 0 || toIndex >= patterns.length) return patterns;
  const next = [...patterns];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

const sample: Pattern[] = [
  { id: "A", name: "Intro" },
  { id: "B", name: "Verse" },
  { id: "C", name: "Drop" },
  { id: "D", name: "Outro" },
];

describe("reorderPatterns (v2.8)", () => {
  it("verschiebt von 0 nach 2 → A wandert in die Mitte", () => {
    const r = reorder(sample, 0, 2);
    expect(r.map(p => p.id)).toEqual(["B", "C", "A", "D"]);
  });

  it("verschiebt von 3 nach 0 → letztes wird erstes", () => {
    const r = reorder(sample, 3, 0);
    expect(r.map(p => p.id)).toEqual(["D", "A", "B", "C"]);
  });

  it("verschiebt von 1 nach 2 → einfacher Swap (sortof)", () => {
    const r = reorder(sample, 1, 2);
    expect(r.map(p => p.id)).toEqual(["A", "C", "B", "D"]);
  });

  it("fromIndex === toIndex → unverändert", () => {
    expect(reorder(sample, 1, 1)).toEqual(sample);
  });

  it("out-of-range fromIndex → no-op", () => {
    expect(reorder(sample, 99, 1)).toEqual(sample);
    expect(reorder(sample, -1, 1)).toEqual(sample);
  });

  it("out-of-range toIndex → no-op", () => {
    expect(reorder(sample, 0, 99)).toEqual(sample);
    expect(reorder(sample, 0, -1)).toEqual(sample);
  });

  it("Pattern-IDs bleiben stabil", () => {
    const r = reorder(sample, 0, 3);
    expect(new Set(r.map(p => p.id))).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("leeres Array → leer", () => {
    expect(reorder([], 0, 0)).toEqual([]);
  });

  it("ein Pattern → no-op", () => {
    const single = [{ id: "A", name: "Only" }];
    expect(reorder(single, 0, 0)).toEqual(single);
  });
});
