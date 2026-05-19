// @vitest-environment node
/**
 * pattern-density-analyzer.test.ts (v3.159.0)
 *
 * Tests for patternDensityAnalyzer.ts — single-pattern boolean[] analysis.
 * NB: existing patternDensity.ts/pattern-density.test.ts analysieren
 * Multi-Part-PatternData; semantisch unterschiedlich.
 */
import { describe, it, expect } from "vitest";
import {
  calculateDensity,
  categorizeDensity,
  countConsecutiveRuns,
  hitDistances,
  syncopationScore,
} from "@/utils/patternDensityAnalyzer";

describe("patternDensityAnalyzer", () => {
  describe("calculateDensity", () => {
    it("leeres Pattern → empty", () => {
      const r = calculateDensity([]);
      expect(r.density).toBe(0);
      expect(r.hits).toBe(0);
      expect(r.total).toBe(0);
      expect(r.category).toBe("empty");
    });

    it("alle false → empty", () => {
      const r = calculateDensity([false, false, false]);
      expect(r.category).toBe("empty");
      expect(r.density).toBe(0);
    });

    it("alle true → full", () => {
      const r = calculateDensity([true, true, true, true]);
      expect(r.density).toBe(1);
      expect(r.category).toBe("full");
    });

    it("1/16 → sparse", () => {
      const p = new Array(16).fill(false);
      p[0] = true;
      const r = calculateDensity(p);
      expect(r.density).toBeCloseTo(0.0625, 4);
      expect(r.category).toBe("sparse");
    });

    it("8/16 → medium (boundary)", () => {
      const p = new Array(16).fill(false);
      for (let i = 0; i < 8; i++) p[i] = true;
      const r = calculateDensity(p);
      expect(r.density).toBe(0.5);
      expect(r.category).toBe("medium");
    });

    it("12/16 → dense", () => {
      const p = new Array(16).fill(false);
      for (let i = 0; i < 12; i++) p[i] = true;
      const r = calculateDensity(p);
      expect(r.density).toBe(0.75);
      expect(r.category).toBe("dense");
    });
  });

  describe("categorizeDensity", () => {
    it("0 → empty", () => expect(categorizeDensity(0)).toBe("empty"));
    it("0.1 → sparse", () => expect(categorizeDensity(0.1)).toBe("sparse"));
    it("0.25 → sparse (boundary)", () => expect(categorizeDensity(0.25)).toBe("sparse"));
    it("0.4 → medium", () => expect(categorizeDensity(0.4)).toBe("medium"));
    it("0.7 → dense", () => expect(categorizeDensity(0.7)).toBe("dense"));
    it("1.0 → full", () => expect(categorizeDensity(1)).toBe("full"));
    it("NaN → empty (defensive)", () => expect(categorizeDensity(NaN)).toBe("empty"));
  });

  describe("countConsecutiveRuns", () => {
    it("[T,T,F,T,F,F,T,T,T] → [2, 1, 3]", () => {
      expect(countConsecutiveRuns([true, true, false, true, false, false, true, true, true])).toEqual([2, 1, 3]);
    });

    it("alle false → []", () => {
      expect(countConsecutiveRuns([false, false, false])).toEqual([]);
    });

    it("alle true → [length]", () => {
      expect(countConsecutiveRuns([true, true, true])).toEqual([3]);
    });

    it("trailing run wird gezählt", () => {
      expect(countConsecutiveRuns([false, true, true])).toEqual([2]);
    });

    it("leeres Array → []", () => {
      expect(countConsecutiveRuns([])).toEqual([]);
    });
  });

  describe("hitDistances", () => {
    it("[T,F,F,T,F,T] → [3, 2]", () => {
      expect(hitDistances([true, false, false, true, false, true])).toEqual([3, 2]);
    });

    it("1 hit → []", () => {
      expect(hitDistances([false, true, false])).toEqual([]);
    });

    it("0 hits → []", () => {
      expect(hitDistances([false, false])).toEqual([]);
    });

    it("4-on-the-floor → [4, 4, 4]", () => {
      const p = new Array(16).fill(false);
      p[0] = p[4] = p[8] = p[12] = true;
      expect(hitDistances(p)).toEqual([4, 4, 4]);
    });
  });

  describe("syncopationScore", () => {
    it("4-on-the-floor → 0 (regelmäßig)", () => {
      const p = new Array(16).fill(false);
      p[0] = p[4] = p[8] = p[12] = true;
      expect(syncopationScore(p)).toBe(0);
    });

    it("< 2 hits → 0 (keine Distanzen)", () => {
      expect(syncopationScore([false, true, false])).toBe(0);
      expect(syncopationScore([false, false])).toBe(0);
    });

    it("unregelmäßiges Pattern → > 0", () => {
      const p = [true, false, false, false, false, false, false, true, false, true, false, false, false, false, false, false];
      expect(syncopationScore(p)).toBeGreaterThan(0);
    });

    it("liefert Wert 0..1", () => {
      const p = [true, true, false, false, false, false, true, false];
      const score = syncopationScore(p);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });
});
