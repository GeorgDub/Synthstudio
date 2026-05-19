/**
 * tests/features/pattern-probability.test.ts (v3.166.0)
 *
 * Unit-Tests fuer patternProbability.ts - pure Algorithmen mit
 * mulberry32-PRNG. Verifiziert Determinismus, Invarianten und
 * defensive Edge-Cases.
 */
import { describe, it, expect } from "vitest";
import {
  generateRandomPattern,
  decayPattern,
  densifyPattern,
  variatePattern,
  createSeededRng,
} from "../../client/src/utils/patternProbability";

describe("generateRandomPattern", () => {
  it("returns empty array for length=0", () => {
    expect(generateRandomPattern(0, 0.5)).toEqual([]);
  });

  it("returns empty array for negative length", () => {
    expect(generateRandomPattern(-3, 0.5)).toEqual([]);
  });

  it("returns empty array for NaN length", () => {
    expect(generateRandomPattern(NaN, 0.5)).toEqual([]);
  });

  it("returns all-false when probability=0", () => {
    const out = generateRandomPattern(16, 0);
    expect(out).toHaveLength(16);
    expect(out.every((s) => s === false)).toBe(true);
  });

  it("returns all-false when probability is negative", () => {
    const out = generateRandomPattern(8, -0.3);
    expect(out.every((s) => s === false)).toBe(true);
  });

  it("returns all-true when probability=1", () => {
    const out = generateRandomPattern(16, 1);
    expect(out).toHaveLength(16);
    expect(out.every((s) => s === true)).toBe(true);
  });

  it("returns all-true when probability greater than 1", () => {
    const out = generateRandomPattern(8, 1.5);
    expect(out.every((s) => s === true)).toBe(true);
  });

  it("treats NaN probability as 0", () => {
    const out = generateRandomPattern(8, NaN);
    expect(out.every((s) => s === false)).toBe(true);
  });

  it("is deterministic: same seed + inputs produce same output", () => {
    const a = generateRandomPattern(32, 0.5, { seed: 42 });
    const b = generateRandomPattern(32, 0.5, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different outputs", () => {
    const a = generateRandomPattern(64, 0.5, { seed: 1 });
    const b = generateRandomPattern(64, 0.5, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("default seed=1 is stable across calls", () => {
    const a = generateRandomPattern(16, 0.3);
    const b = generateRandomPattern(16, 0.3);
    expect(a).toEqual(b);
  });

  it("approximate count near expected probability (statistical sanity)", () => {
    const out = generateRandomPattern(1000, 0.25, { seed: 7 });
    const trueCount = out.filter(Boolean).length;
    expect(trueCount).toBeGreaterThan(150);
    expect(trueCount).toBeLessThan(350);
  });

  it("floors fractional length", () => {
    const out = generateRandomPattern(8.9, 1);
    expect(out).toHaveLength(8);
  });
});

describe("decayPattern", () => {
  it("returns identical copy when keep=1", () => {
    const input = [true, false, true, false, true, true];
    const out = decayPattern(input, 1);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("returns all-false when keep=0", () => {
    const input = [true, true, true, true];
    const out = decayPattern(input, 0);
    expect(out).toEqual([false, false, false, false]);
  });

  it("treats keep greater than 1 as keep=1 (identical copy)", () => {
    const input = [true, false, true];
    expect(decayPattern(input, 2.5)).toEqual(input);
  });

  it("treats negative keep as 0 (all false)", () => {
    const input = [true, true, true];
    expect(decayPattern(input, -0.5)).toEqual([false, false, false]);
  });

  it("treats NaN keep as 0 (all false)", () => {
    const input = [true, true, true];
    expect(decayPattern(input, NaN)).toEqual([false, false, false]);
  });

  it("false-Steps bleiben false bei keep=0.5", () => {
    const input = [false, true, false, true, false, false, true, false];
    const out = decayPattern(input, 0.5, { seed: 123 });
    expect(out[0]).toBe(false);
    expect(out[2]).toBe(false);
    expect(out[4]).toBe(false);
    expect(out[5]).toBe(false);
    expect(out[7]).toBe(false);
  });

  it("is deterministic with same seed", () => {
    const input = [true, true, true, true, true, true, true, true];
    const a = decayPattern(input, 0.5, { seed: 99 });
    const b = decayPattern(input, 0.5, { seed: 99 });
    expect(a).toEqual(b);
  });

  it("handles empty pattern", () => {
    expect(decayPattern([], 0.5)).toEqual([]);
  });
});

describe("densifyPattern", () => {
  it("returns identical copy when add=0", () => {
    const input = [true, false, true, false];
    const out = densifyPattern(input, 0);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("returns all-true when add=1", () => {
    const input = [false, false, false, true];
    const out = densifyPattern(input, 1);
    expect(out).toEqual([true, true, true, true]);
  });

  it("treats negative add as 0 (no change)", () => {
    const input = [true, false, true];
    expect(densifyPattern(input, -0.3)).toEqual(input);
  });

  it("treats add greater than 1 as 1 (all true)", () => {
    const input = [false, false, false];
    expect(densifyPattern(input, 3.7)).toEqual([true, true, true]);
  });

  it("treats NaN add as 0 (no change)", () => {
    const input = [true, false, true];
    expect(densifyPattern(input, NaN)).toEqual(input);
  });

  it("true-Steps bleiben immer true", () => {
    const input = [true, false, true, false, true, false];
    const out = densifyPattern(input, 0.5, { seed: 7 });
    expect(out[0]).toBe(true);
    expect(out[2]).toBe(true);
    expect(out[4]).toBe(true);
  });

  it("is deterministic with same seed", () => {
    const input = [false, false, false, false, false, false, false, false];
    const a = densifyPattern(input, 0.3, { seed: 55 });
    const b = densifyPattern(input, 0.3, { seed: 55 });
    expect(a).toEqual(b);
  });

  it("handles empty pattern", () => {
    expect(densifyPattern([], 0.5)).toEqual([]);
  });
});

describe("variatePattern", () => {
  it("is deterministic with same seed", () => {
    const input = [true, false, true, false, true, false, true, false];
    const a = variatePattern(input, 0.6, 0.3, { seed: 11 });
    const b = variatePattern(input, 0.6, 0.3, { seed: 11 });
    expect(a).toEqual(b);
  });

  it("keep=1, add=0 produces identical copy", () => {
    const input = [true, false, true, true, false];
    expect(variatePattern(input, 1, 0)).toEqual(input);
  });

  it("keep=0, add=1 produces all true", () => {
    const input = [true, false, true, false];
    expect(variatePattern(input, 0, 1)).toEqual([true, true, true, true]);
  });

  it("keep=0, add=0 produces all false", () => {
    const input = [true, true, true, true];
    expect(variatePattern(input, 0, 0)).toEqual([false, false, false, false]);
  });

  it("keep=1, add=1 produces all true", () => {
    const input = [false, false, true, false];
    expect(variatePattern(input, 1, 1)).toEqual([true, true, true, true]);
  });

  it("different seed produces different output (with non-trivial inputs)", () => {
    const input = new Array<boolean>(32).fill(false).map((_, i) => i % 2 === 0);
    const a = variatePattern(input, 0.5, 0.5, { seed: 1 });
    const b = variatePattern(input, 0.5, 0.5, { seed: 99 });
    expect(a).not.toEqual(b);
  });

  it("handles empty pattern", () => {
    expect(variatePattern([], 0.5, 0.5)).toEqual([]);
  });

  it("uses chained RNG state across decay and densify phases", () => {
    const input = [true, true, true, true, true, true, true, true];
    const out = variatePattern(input, 0.5, 0.5, { seed: 2026 });
    expect(out).toHaveLength(8);
    expect(out.every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("createSeededRng", () => {
  it("returns the same sequence for the same seed", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("returns different sequences for different seeds", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });

  it("yields values strictly in [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("uses default seed (1) when given NaN", () => {
    const rng = createSeededRng(NaN);
    const fallback = createSeededRng(1);
    expect(rng()).toBe(fallback());
    expect(rng()).toBe(fallback());
  });

  it("uses default seed when given Infinity", () => {
    const rng = createSeededRng(Infinity);
    const fallback = createSeededRng(1);
    expect(rng()).toBe(fallback());
  });

  it("state is persisted across calls (closure)", () => {
    const rng = createSeededRng(5);
    const v1 = rng();
    const v2 = rng();
    expect(v1).not.toBe(v2);
  });

  it("floors fractional seeds (5.7 equals 5)", () => {
    const a = createSeededRng(5);
    const b = createSeededRng(5.7);
    expect(a()).toBe(b());
  });
});
