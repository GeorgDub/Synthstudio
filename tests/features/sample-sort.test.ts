// @vitest-environment node
/**
 * sample-sort.test.ts (v3.148.0)
 */
import { describe, it, expect } from "vitest";
import {
  sortSamples,
  SAMPLE_SORT_MODES,
  SAMPLE_SORT_LABELS,
  type SortableSample,
} from "@/utils/sampleSort";

function makeSamples(): SortableSample[] {
  return [
    { id: "s1", name: "Charlie", category: "drums", createdAt: 100 },
    { id: "s2", name: "alpha", category: "bass", createdAt: 200 },
    { id: "s3", name: "Bravo", category: "drums", createdAt: 150 },
  ];
}

describe("sampleSort", () => {
  describe("constants", () => {
    it("exports SAMPLE_SORT_MODES with 5 entries", () => {
      expect(SAMPLE_SORT_MODES.length).toBe(5);
      expect(SAMPLE_SORT_MODES).toContain("import");
      expect(SAMPLE_SORT_MODES).toContain("name-asc");
      expect(SAMPLE_SORT_MODES).toContain("name-desc");
      expect(SAMPLE_SORT_MODES).toContain("newest");
      expect(SAMPLE_SORT_MODES).toContain("category");
    });

    it("has labels for all modes", () => {
      for (const mode of SAMPLE_SORT_MODES) {
        expect(SAMPLE_SORT_LABELS[mode]).toBeTruthy();
      }
    });
  });

  describe("sortSamples", () => {
    it("mode=import → unverändert (same array content + length)", () => {
      const input = makeSamples();
      const out = sortSamples(input, "import");
      expect(out.length).toBe(input.length);
      expect(out.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    });

    it("mode=name-asc → alphabetisch A-Z (case-insensitive)", () => {
      const out = sortSamples(makeSamples(), "name-asc");
      expect(out.map((s) => s.name)).toEqual(["alpha", "Bravo", "Charlie"]);
    });

    it("mode=name-desc → alphabetisch Z-A", () => {
      const out = sortSamples(makeSamples(), "name-desc");
      expect(out.map((s) => s.name)).toEqual(["Charlie", "Bravo", "alpha"]);
    });

    it("mode=newest → höchster createdAt zuerst", () => {
      const out = sortSamples(makeSamples(), "newest");
      expect(out.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
    });

    it("mode=newest fallback auf id-timestamp wenn createdAt fehlt", () => {
      const input: SortableSample[] = [
        { id: "slice-1700000001-a", name: "alpha" },
        { id: "slice-1700000003-c", name: "charlie" },
        { id: "slice-1700000002-b", name: "bravo" },
      ];
      const out = sortSamples(input, "newest");
      expect(out.map((s) => s.name)).toEqual(["charlie", "bravo", "alpha"]);
    });

    it("mode=category → nach category sortiert, dann nach Name", () => {
      const out = sortSamples(makeSamples(), "category");
      // bass kommt vor drums, dann innerhalb drums Bravo vor Charlie.
      expect(out.map((s) => s.name)).toEqual(["alpha", "Bravo", "Charlie"]);
    });

    it("mutiert Input nicht", () => {
      const input = makeSamples();
      const inputCopy = JSON.parse(JSON.stringify(input));
      sortSamples(input, "name-asc");
      expect(input).toEqual(inputCopy);
    });

    it("handhabt leeres Array ohne Crash", () => {
      const out = sortSamples([], "name-asc");
      expect(out).toEqual([]);
    });

    it("handhabt 1-Element-Array", () => {
      const out = sortSamples([{ id: "x", name: "solo" }], "name-asc");
      expect(out.map((s) => s.name)).toEqual(["solo"]);
    });

    it("defensive bei missing name → empty string ranks first", () => {
      const input: SortableSample[] = [
        { id: "a", name: "zulu" },
        // @ts-expect-error testing missing name
        { id: "b" },
        { id: "c", name: "alpha" },
      ];
      const out = sortSamples(input, "name-asc");
      // missing name -> "" sortiert vorne
      expect(out[0].id).toBe("b");
    });
  });
});
