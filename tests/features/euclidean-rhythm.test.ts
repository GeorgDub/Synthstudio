// @vitest-environment node
/**
 * euclidean-rhythm.test.ts (v3.157.0)
 */
import { describe, it, expect } from "vitest";
import {
  euclideanPattern,
  euclideanPatternBjorklund,
  rotatePattern,
  countHits,
  EUCLIDEAN_PRESETS,
} from "@/utils/euclideanRhythm";

describe("euclideanRhythm", () => {
  describe("euclideanPattern", () => {
    it("E(0, 8) → alle false", () => {
      const p = euclideanPattern(0, 8);
      expect(p).toEqual(new Array(8).fill(false));
    });

    it("E(8, 8) → alle true", () => {
      const p = euclideanPattern(8, 8);
      expect(p).toEqual(new Array(8).fill(true));
    });

    it("E(hits >= steps) → alle true", () => {
      const p = euclideanPattern(10, 8);
      expect(p).toEqual(new Array(8).fill(true));
    });

    it("steps = 0 → leeres Array", () => {
      expect(euclideanPattern(3, 0)).toEqual([]);
    });

    it("E(3, 8) Tresillo: hit count = 3", () => {
      const p = euclideanPattern(3, 8);
      expect(p.length).toBe(8);
      expect(countHits(p)).toBe(3);
    });

    it("E(5, 8) Cinquillo: hit count = 5", () => {
      const p = euclideanPattern(5, 8);
      expect(countHits(p)).toBe(5);
    });

    it("E(4, 16) Techno: 4-on-the-floor an Positionen 0, 4, 8, 12", () => {
      const p = euclideanPattern(4, 16);
      expect(p[0]).toBe(true);
      expect(p[4]).toBe(true);
      expect(p[8]).toBe(true);
      expect(p[12]).toBe(true);
      expect(countHits(p)).toBe(4);
    });

    it("E(3, 16) Bossa: erste Position true", () => {
      const p = euclideanPattern(3, 16);
      expect(p[0]).toBe(true);
      expect(countHits(p)).toBe(3);
    });

    it("non-integer Inputs werden floor'd", () => {
      const p1 = euclideanPattern(3.7, 8.9);
      expect(p1.length).toBe(8);
      expect(countHits(p1)).toBe(3);
    });

    it("rotation rotiert das Pattern", () => {
      const p0 = euclideanPattern(3, 8);
      const p2 = euclideanPattern(3, 8, 2);
      // gleicher Hit-Count
      expect(countHits(p0)).toBe(countHits(p2));
      // andere Anordnung (außer p0[0] === p2[2])
      expect(p2[2]).toBe(p0[0]);
    });
  });

  describe("rotatePattern", () => {
    it("rotation = 0 → identische Kopie", () => {
      const p: boolean[] = [true, false, true, false];
      const result = rotatePattern(p, 0);
      expect(result).toEqual(p);
      expect(result).not.toBe(p);
    });

    it("rotation = 1 → letzte Position springt nach vorne", () => {
      const p: boolean[] = [true, false, false, true];
      const result = rotatePattern(p, 1);
      expect(result).toEqual([true, true, false, false]);
    });

    it("negative rotation rotiert links", () => {
      const p: boolean[] = [true, false, false, true];
      const result = rotatePattern(p, -1);
      expect(result).toEqual([false, false, true, true]);
    });

    it("rotation > length wraps around", () => {
      const p: boolean[] = [true, false, false, false];
      const result = rotatePattern(p, 5); // 5 % 4 = 1
      expect(result).toEqual([false, true, false, false]);
    });

    it("leeres Array → leer", () => {
      expect(rotatePattern([], 3)).toEqual([]);
    });
  });

  describe("EUCLIDEAN_PRESETS", () => {
    it("hat mindestens 5 Presets", () => {
      expect(EUCLIDEAN_PRESETS.length).toBeGreaterThanOrEqual(5);
    });

    it("alle Presets haben valide hits/steps", () => {
      for (const preset of EUCLIDEAN_PRESETS) {
        expect(preset.hits).toBeGreaterThan(0);
        expect(preset.steps).toBeGreaterThan(0);
        expect(preset.hits).toBeLessThanOrEqual(preset.steps);
        expect(preset.id.length).toBeGreaterThan(0);
        expect(preset.name.length).toBeGreaterThan(0);
      }
    });

    it("Tresillo-Preset erzeugt valides 3,8 Pattern", () => {
      const preset = EUCLIDEAN_PRESETS.find((p) => p.id === "tresillo");
      expect(preset).toBeDefined();
      const pattern = euclideanPattern(preset!.hits, preset!.steps);
      expect(countHits(pattern)).toBe(3);
      expect(pattern.length).toBe(8);
    });
  });

  describe("Bjorklund algorithm correctness", () => {
    it("E(5, 13) liefert 5 evenly-spaced hits", () => {
      const p = euclideanPatternBjorklund(5, 13);
      expect(p.length).toBe(13);
      expect(countHits(p)).toBe(5);
      // erstes Position immer true (Bjorklund property).
      expect(p[0]).toBe(true);
    });

    it("E(7, 12) liefert valides Pattern (Tom Tom Club)", () => {
      const p = euclideanPatternBjorklund(7, 12);
      expect(countHits(p)).toBe(7);
      expect(p[0]).toBe(true);
    });
  });

  describe("countHits", () => {
    it("zählt true-Werte", () => {
      expect(countHits([true, false, true, true, false])).toBe(3);
    });

    it("leeres Array → 0", () => {
      expect(countHits([])).toBe(0);
    });
  });
});
