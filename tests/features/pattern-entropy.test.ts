/**
 * tests/features/pattern-entropy.test.ts (v3.206)
 *
 * Pure-Coverage fuer client/src/utils/patternEntropy.ts.
 * Inputs duerfen nie mutiert werden; saemtliche Funktionen sind deterministisch.
 */
import { describe, it, expect } from "vitest";
import {
  bitEntropy,
  bigramEntropy,
  complexityIndex,
} from "@/utils/patternEntropy";

// --- bitEntropy ------------------------------------------------------------

describe("bitEntropy", () => {
  it("empty array -> entropy 0, normalizedEntropy 0, bigrams []", () => {
    const r = bitEntropy([]);
    expect(r).toEqual({ entropy: 0, normalizedEntropy: 0, bigrams: [] });
  });

  it("single true element -> entropy 0 (no variance), bigrams []", () => {
    const r = bitEntropy([true]);
    expect(r.entropy).toBe(0);
    expect(r.normalizedEntropy).toBe(0);
    expect(r.bigrams).toEqual([]);
  });

  it("single false element -> entropy 0, bigrams []", () => {
    const r = bitEntropy([false]);
    expect(r.entropy).toBe(0);
    expect(r.normalizedEntropy).toBe(0);
    expect(r.bigrams).toEqual([]);
  });

  it("alternating T,F,T,F,T,F -> max bitEntropy = 1.0 (50/50)", () => {
    const r = bitEntropy([true, false, true, false, true, false]);
    expect(r.entropy).toBeCloseTo(1.0, 10);
    expect(r.normalizedEntropy).toBeCloseTo(1.0, 10);
  });

  it("all-true -> entropy 0 (no variance)", () => {
    const r = bitEntropy([true, true, true, true]);
    expect(r.entropy).toBe(0);
    expect(r.normalizedEntropy).toBe(0);
  });

  it("all-false -> entropy 0 (no variance)", () => {
    const r = bitEntropy([false, false, false, false, false, false, false, false]);
    expect(r.entropy).toBe(0);
    expect(r.normalizedEntropy).toBe(0);
  });

  it("3/4 true vs 1/4 false -> entropy ~0.8113 bits", () => {
    const r = bitEntropy([true, true, true, false]);
    expect(r.entropy).toBeCloseTo(0.81127812, 6);
    expect(r.normalizedEntropy).toBeCloseTo(0.81127812, 6);
  });

  it("random-like 16-step pattern -> normalizedEntropy >= 0.8", () => {
    const steps = [
      true, false, true, true, false, true, false, false,
      true, true, false, false, true, false, true, false,
    ];
    const r = bitEntropy(steps);
    expect(r.normalizedEntropy).toBeGreaterThanOrEqual(0.8);
  });

  it("populates bigrams[] from same input (shared top-5)", () => {
    const r = bitEntropy([true, false, true, false]);
    expect(r.bigrams.length).toBeGreaterThan(0);
    expect(r.bigrams[0]).toEqual({ pattern: "10", count: 2 });
    expect(r.bigrams[1]).toEqual({ pattern: "01", count: 1 });
  });

  it("input array is not mutated", () => {
    const steps = [true, false, true, true, false];
    const snapshot = steps.slice();
    bitEntropy(steps);
    expect(steps).toEqual(snapshot);
  });
});

// --- bigramEntropy ---------------------------------------------------------

describe("bigramEntropy", () => {
  it("empty array -> entropy 0, bigrams []", () => {
    const r = bigramEntropy([]);
    expect(r).toEqual({ entropy: 0, normalizedEntropy: 0, bigrams: [] });
  });

  it("single element -> bigrams [] (no window fits)", () => {
    const r = bigramEntropy([true]);
    expect(r.entropy).toBe(0);
    expect(r.bigrams).toEqual([]);
  });

  it("2-step input [T,F] -> exactly one bigram 10", () => {
    const r = bigramEntropy([true, false]);
    expect(r.entropy).toBe(0);
    expect(r.normalizedEntropy).toBe(0);
    expect(r.bigrams).toEqual([{ pattern: "10", count: 1 }]);
  });

  it("all-same elements -> entropy 0", () => {
    const r1 = bigramEntropy([true, true, true, true]);
    expect(r1.entropy).toBe(0);
    expect(r1.bigrams).toEqual([{ pattern: "11", count: 3 }]);

    const r2 = bigramEntropy([false, false, false, false]);
    expect(r2.entropy).toBe(0);
    expect(r2.bigrams).toEqual([{ pattern: "00", count: 3 }]);
  });

  it("alternating T,F,T,F -> entropy ~0.9183", () => {
    const r = bigramEntropy([true, false, true, false]);
    expect(r.entropy).toBeCloseTo(0.91829583, 6);
  });

  it("balanced [F,F,T,T,F] -> entropy 2.0 bits (max)", () => {
    const r = bigramEntropy([false, false, true, true, false]);
    expect(r.entropy).toBeCloseTo(2.0, 10);
    expect(r.normalizedEntropy).toBeCloseTo(1.0, 10);
  });

  it("bigrams[] limited to top-5, filters zero counts", () => {
    const four = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const r = bigramEntropy(four);
    expect(r.bigrams).toEqual([
      { pattern: "00", count: 8 },
      { pattern: "10", count: 4 },
      { pattern: "01", count: 3 },
    ]);
    expect(r.bigrams.length).toBeLessThanOrEqual(5);
  });

  it("tie-breaking: equal counts sorted lexicographically", () => {
    const r = bigramEntropy([true, false, true, false, true]);
    expect(r.bigrams[0]).toEqual({ pattern: "01", count: 2 });
    expect(r.bigrams[1]).toEqual({ pattern: "10", count: 2 });
  });

  it("input array is not mutated", () => {
    const steps = [true, false, true, true, false, false];
    const snapshot = steps.slice();
    bigramEntropy(steps);
    expect(steps).toEqual(snapshot);
  });
});

// --- complexityIndex -------------------------------------------------------

describe("complexityIndex", () => {
  it("empty array -> 0", () => {
    expect(complexityIndex([])).toBe(0);
  });

  it("all-true -> 0", () => {
    expect(complexityIndex([true, true, true, true])).toBe(0);
  });

  it("all-false -> 0", () => {
    expect(complexityIndex([false, false, false, false, false, false])).toBe(0);
  });

  it("result is always in 0..1", () => {
    const inputs: boolean[][] = [
      [],
      [true],
      [false, false],
      [true, false, true, false, true, false, true, false],
      [true, true, false, false, true, true, false, false],
      [false, false, true, true, false],
    ];
    for (const steps of inputs) {
      const c = complexityIndex(steps);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("4-on-the-floor pattern -> low-to-mid complexity (< 0.8)", () => {
    const four = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const c = complexityIndex(four);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(0.8);
  });

  it("balanced [F,F,T,T,F] -> higher complexity than 4-on-floor", () => {
    const balanced = [false, false, true, true, false];
    const four = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    expect(complexityIndex(balanced)).toBeGreaterThan(complexityIndex(four));
  });

  it("alternating pattern -> mid-high complexity", () => {
    const c = complexityIndex([true, false, true, false, true, false, true, false]);
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(0.8);
  });

  it("random-like 16-step pattern -> complexity >= 0.6", () => {
    const steps = [
      true, false, true, true, false, true, false, false,
      true, true, false, false, true, false, true, false,
    ];
    expect(complexityIndex(steps)).toBeGreaterThanOrEqual(0.6);
  });

  it("input array is not mutated", () => {
    const steps = [true, false, true, true, false, true];
    const snapshot = steps.slice();
    complexityIndex(steps);
    expect(steps).toEqual(snapshot);
  });
});
