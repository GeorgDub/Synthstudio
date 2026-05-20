/**
 * tests/features/pattern-symmetry-score.test.ts - v3.217
 *
 * Pure-Coverage fuer client/src/utils/patternSymmetryScore.ts.
 *
 * Spec pinned via tests:
 *   - Pin #1: computePalindrome compares steps[i] vs steps[length-1-i]
 *             for i in [0, floor(length/2)); score = matching / half.
 *   - Pin #2: empty -> all zero/false; length=1 -> palindrome trivial.
 *   - Pin #3: findMirrorAxis kandidaten k in [1, length-1].
 *   - Pin #4: i in [1, ...] - i=0 (trivial) NOT counted.
 *   - Pin #5: tie-break smallest axisIndex wins.
 *   - Pin #6: halfMirrorScore === findMirrorAxis().score.
 *   - Pin #7: symmetryScore combines both helpers verbatim.
 *   - Pin #8: strict s === true (truthy non-bool count as inactive).
 */
import { describe, it, expect } from "vitest";
import {
  computePalindrome,
  findMirrorAxis,
  symmetryScore,
  type SymmetryResult,
} from "@/utils/patternSymmetryScore";

function mkSteps(activeIdx: readonly number[], len: number): boolean[] {
  const out: boolean[] = new Array(len);
  for (let i = 0; i < len; i++) out[i] = false;
  for (const i of activeIdx) {
    if (i >= 0 && i < len) out[i] = true;
  }
  return out;
}

function allFalse(len: number): boolean[] {
  return new Array(len).fill(false);
}

function allTrue(len: number): boolean[] {
  return new Array(len).fill(true);
}

// =============================================================================
// computePalindrome - empty / degenerate
// =============================================================================

describe("computePalindrome - empty + degenerate", () => {
  it("empty -> { isPalindrome: false, score: 0 }", () => {
    expect(computePalindrome([])).toEqual({ isPalindrome: false, score: 0 });
  });

  it("non-array null -> { false, 0 }", () => {
    expect(computePalindrome(null as unknown as boolean[])).toEqual({
      isPalindrome: false,
      score: 0,
    });
  });

  it("single element [true] -> palindrome trivially true, score 1", () => {
    expect(computePalindrome([true])).toEqual({ isPalindrome: true, score: 1 });
  });

  it("single element [false] -> palindrome trivially true, score 1", () => {
    expect(computePalindrome([false])).toEqual({ isPalindrome: true, score: 1 });
  });
});

// =============================================================================
// computePalindrome - Pin #1 formel + Standard-Tests
// =============================================================================

describe("computePalindrome - core formula (Pin #1)", () => {
  it("2-element same [T,T] -> palindrome, score 1", () => {
    const r = computePalindrome([true, true]);
    expect(r.isPalindrome).toBe(true);
    expect(r.score).toBe(1);
  });

  it("2-element same [F,F] -> palindrome, score 1", () => {
    const r = computePalindrome([false, false]);
    expect(r.isPalindrome).toBe(true);
    expect(r.score).toBe(1);
  });

  it("2-element different [T,F] -> NOT palindrome, score 0", () => {
    const r = computePalindrome([true, false]);
    expect(r.isPalindrome).toBe(false);
    expect(r.score).toBe(0);
  });

  it("classic 5-step palindrome [T,F,T,F,T] -> isPalindrome=true, score=1", () => {
    const r = computePalindrome([true, false, true, false, true]);
    expect(r.isPalindrome).toBe(true);
    expect(r.score).toBe(1);
  });

  it("non-palindrome [T,T,F,F,F] -> isPalindrome=false, score=0", () => {
    const r = computePalindrome([true, true, false, false, false]);
    expect(r.isPalindrome).toBe(false);
    expect(r.score).toBe(0);
  });

  it("[T,F,F,T] reverse=[T,F,F,T] -> palindrome", () => {
    const r = computePalindrome([true, false, false, true]);
    expect(r.isPalindrome).toBe(true);
    expect(r.score).toBe(1);
  });

  it("4-step half-match [T,F,F,F] -> 1/2", () => {
    const r = computePalindrome([true, false, false, false]);
    expect(r.isPalindrome).toBe(false);
    expect(r.score).toBe(0.5);
  });

  it("all-true 8-elem -> palindrome", () => {
    const r = computePalindrome(allTrue(8));
    expect(r.isPalindrome).toBe(true);
    expect(r.score).toBe(1);
  });

  it("all-false 8-elem -> palindrome", () => {
    const r = computePalindrome(allFalse(8));
    expect(r.isPalindrome).toBe(true);
    expect(r.score).toBe(1);
  });

  it("middle element of odd-length is ignored", () => {
    const r = computePalindrome([true, false, false, false, true]);
    expect(r.isPalindrome).toBe(true);
    expect(r.score).toBe(1);
  });
});

// =============================================================================
// findMirrorAxis - empty / degenerate / Pin #3
// =============================================================================

describe("findMirrorAxis - empty + degenerate (Pin #3)", () => {
  it("empty -> { axisIndex: 0, score: 0 }", () => {
    expect(findMirrorAxis([])).toEqual({ axisIndex: 0, score: 0 });
  });

  it("non-array null -> { 0, 0 }", () => {
    expect(findMirrorAxis(null as unknown as boolean[])).toEqual({
      axisIndex: 0,
      score: 0,
    });
  });

  it("single element -> { axisIndex: 0, score: 1 }", () => {
    expect(findMirrorAxis([true])).toEqual({ axisIndex: 0, score: 1 });
    expect(findMirrorAxis([false])).toEqual({ axisIndex: 0, score: 1 });
  });
});

// =============================================================================
// findMirrorAxis - Pin #4: i in [1, ...], boundary semantics
// =============================================================================

describe("findMirrorAxis - core semantics (Pin #4)", () => {
  it("symmetric [T,F,T] -> best axis at center (k=1), score 1", () => {
    const r = findMirrorAxis([true, false, true]);
    expect(r.axisIndex).toBe(1);
    expect(r.score).toBe(1);
  });

  it("symmetric [T,F,T,F,T] -> some axis hits score 1 (tie-break smallest=k=1)", () => {
    // Multiple axes hit score=1 here (k=1, k=2, k=3). Tie-break Pin #5
    // picks smallest -> k=1. Center axis k=2 still has score 1.
    const r = findMirrorAxis([true, false, true, false, true]);
    expect(r.score).toBe(1);
    expect(r.axisIndex).toBe(1);
  });

  it("symmetric [F,T,F,T,F] -> tie-break smallest k=1, score 1", () => {
    const r = findMirrorAxis([false, true, false, true, false]);
    expect(r.score).toBe(1);
    expect(r.axisIndex).toBe(1);
  });

  it("asymmetric pattern where only center is symmetric -> k=center wins", () => {
    // [F,T,F,F,F,T,F]: only k=3 has full symmetry across all pairs.
    // k=1: i=1 -> (0,2)=(F,F) ok -> 1/1 = 1.
    // Hmm tie with k=3. Use [T,F,F,F,F,F,T] instead:
    // k=1: i=1 -> (0,2)=(T,F) NO -> 0/1
    // k=2: i=1 -> (1,3)=(F,F) ok; i=2 -> (0,4)=(T,F) NO -> 1/2
    // k=3: i=1 -> (2,4)=(F,F) ok; i=2 -> (1,5)=(F,F) ok; i=3 -> (0,6)=(T,T) ok -> 3/3 = 1
    // k=4: i=1 -> (3,5)=(F,F) ok; i=2 -> (2,6)=(F,T) NO -> 1/2
    // k=5: i=1 -> (4,6)=(F,T) NO -> 0/1
    // k=6: i=1 -> (5,7) out -> 0/0 = 0
    // -> k=3 unique winner with score 1.
    const r = findMirrorAxis([true, false, false, false, false, false, true]);
    expect(r.axisIndex).toBe(3);
    expect(r.score).toBe(1);
  });

  it("asymmetric -> score may be less than 1 at every axis", () => {
    const r = findMirrorAxis([true, true, false, false, false]);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.axisIndex).toBeGreaterThanOrEqual(0);
    expect(r.axisIndex).toBeLessThanOrEqual(4);
  });

  it("all-true patterns -> score 1", () => {
    const r = findMirrorAxis(allTrue(7));
    expect(r.score).toBe(1);
  });

  it("all-false patterns -> score 1", () => {
    const r = findMirrorAxis(allFalse(7));
    expect(r.score).toBe(1);
  });
});

// =============================================================================
// findMirrorAxis - Pin #5: tie-break smallest axisIndex
// =============================================================================

describe("findMirrorAxis - tie-break smallest axisIndex (Pin #5)", () => {
  it("all-true 4-elem: smallest k=1 wins", () => {
    const r = findMirrorAxis(allTrue(4));
    expect(r.score).toBe(1);
    expect(r.axisIndex).toBe(1);
  });

  it("all-false 6-elem: smallest k=1 wins", () => {
    const r = findMirrorAxis(allFalse(6));
    expect(r.score).toBe(1);
    expect(r.axisIndex).toBe(1);
  });
});

// =============================================================================
// findMirrorAxis - score bounds
// =============================================================================

describe("findMirrorAxis - score bounds", () => {
  it("score always in [0..1]", () => {
    const samples: boolean[][] = [
      allFalse(8),
      allTrue(8),
      mkSteps([0, 4, 8, 12], 16),
      mkSteps([0, 1, 2, 3], 16),
      mkSteps([2, 7, 11], 16),
      [true, false, false, true, false, true, true],
    ];
    for (const s of samples) {
      const r = findMirrorAxis(s);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("axisIndex always in [0, length-1]", () => {
    const samples: boolean[][] = [
      allFalse(8),
      allTrue(8),
      mkSteps([0, 4, 8, 12], 16),
      mkSteps([0, 1, 2, 3], 16),
    ];
    for (const s of samples) {
      const r = findMirrorAxis(s);
      expect(r.axisIndex).toBeGreaterThanOrEqual(0);
      expect(r.axisIndex).toBeLessThanOrEqual(s.length - 1);
      expect(Number.isInteger(r.axisIndex)).toBe(true);
    }
  });
});

// =============================================================================
// symmetryScore - combined result (Pin #7)
// =============================================================================

describe("symmetryScore - combined result (Pin #7)", () => {
  it("returns valid structure with all 4 keys", () => {
    const r: SymmetryResult = symmetryScore(allTrue(8));
    expect(typeof r.isPalindrome).toBe("boolean");
    expect(typeof r.palindromeScore).toBe("number");
    expect(typeof r.mirrorAxis).toBe("number");
    expect(typeof r.halfMirrorScore).toBe("number");
    const keys = Object.keys(r).sort();
    expect(keys).toEqual([
      "halfMirrorScore",
      "isPalindrome",
      "mirrorAxis",
      "palindromeScore",
    ]);
  });

  it("palindromeScore + halfMirrorScore both in [0..1]", () => {
    const samples: boolean[][] = [
      [],
      [true],
      allTrue(8),
      allFalse(8),
      [true, false, true, false, true],
      [true, true, false, false, false],
      mkSteps([0, 4, 8, 12], 16),
    ];
    for (const s of samples) {
      const r = symmetryScore(s);
      expect(r.palindromeScore).toBeGreaterThanOrEqual(0);
      expect(r.palindromeScore).toBeLessThanOrEqual(1);
      expect(r.halfMirrorScore).toBeGreaterThanOrEqual(0);
      expect(r.halfMirrorScore).toBeLessThanOrEqual(1);
    }
  });

  it("delegates to computePalindrome + findMirrorAxis verbatim", () => {
    const steps = [true, false, true, false, true];
    const r = symmetryScore(steps);
    const pal = computePalindrome(steps);
    const mir = findMirrorAxis(steps);
    expect(r.isPalindrome).toBe(pal.isPalindrome);
    expect(r.palindromeScore).toBe(pal.score);
    expect(r.mirrorAxis).toBe(mir.axisIndex);
    expect(r.halfMirrorScore).toBe(mir.score);
  });

  it("empty -> all zero/false", () => {
    const r = symmetryScore([]);
    expect(r.isPalindrome).toBe(false);
    expect(r.palindromeScore).toBe(0);
    expect(r.mirrorAxis).toBe(0);
    expect(r.halfMirrorScore).toBe(0);
  });

  it("length=1 -> trivial palindrome + axis defaults", () => {
    const r = symmetryScore([true]);
    expect(r.isPalindrome).toBe(true);
    expect(r.palindromeScore).toBe(1);
    expect(r.mirrorAxis).toBe(0);
    expect(r.halfMirrorScore).toBe(1);
  });

  it("classic palindrome [T,F,T,F,T] -> isPalindrome + halfMirror=1 (smallest-tie axis)", () => {
    const r = symmetryScore([true, false, true, false, true]);
    expect(r.isPalindrome).toBe(true);
    expect(r.palindromeScore).toBe(1);
    expect(r.halfMirrorScore).toBe(1);
    // Multiple axes hit score=1 (k=1, k=2, k=3); Pin #5 -> smallest = 1.
    expect(r.mirrorAxis).toBe(1);
  });

  it("non-palindrome [T,T,F,F,F] -> isPalindrome=false", () => {
    const r = symmetryScore([true, true, false, false, false]);
    expect(r.isPalindrome).toBe(false);
    expect(r.palindromeScore).toBeLessThan(1);
  });

  it("random asymmetric pattern -> scores in [0..1]", () => {
    const s = mkSteps([0, 3, 7, 8, 11, 14], 16);
    const r = symmetryScore(s);
    expect(r.palindromeScore).toBeLessThanOrEqual(1);
    expect(r.halfMirrorScore).toBeLessThanOrEqual(1);
    expect(r.palindromeScore).toBeGreaterThanOrEqual(0);
    expect(r.halfMirrorScore).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// Pin #8: strict s === true contract
// =============================================================================

describe("strict s === true contract (Pin #8)", () => {
  it("truthy non-bool values count as inactive", () => {
    const sneaky = [1, 0, "x", "", true, false] as unknown as boolean[];
    // Treating non-true as false: array becomes [F,F,F,F,T,F].
    // pairs i in [0..3): (0,5)=(F,F) ok, (1,4)=(F,T) no, (2,3)=(F,F) ok -> 2/3
    const r = computePalindrome(sneaky);
    expect(r.score).toBeCloseTo(2 / 3, 6);
    expect(r.isPalindrome).toBe(false);
  });

  it("symmetryScore on truthy non-bool stays in valid bounds", () => {
    const sneaky = [1, 0, "x", "", true, false, true, false] as unknown as boolean[];
    const r = symmetryScore(sneaky);
    expect(r.palindromeScore).toBeGreaterThanOrEqual(0);
    expect(r.palindromeScore).toBeLessThanOrEqual(1);
    expect(r.halfMirrorScore).toBeGreaterThanOrEqual(0);
    expect(r.halfMirrorScore).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// Purity / immutability
// =============================================================================

describe("purity - no mutate, deterministic, fresh output", () => {
  it("computePalindrome does not mutate input", () => {
    const steps = [true, false, true, false, true];
    const snap = [...steps];
    computePalindrome(steps);
    expect(steps).toEqual(snap);
  });

  it("findMirrorAxis does not mutate input", () => {
    const steps = mkSteps([0, 4, 8, 12], 16);
    const snap = [...steps];
    findMirrorAxis(steps);
    expect(steps).toEqual(snap);
  });

  it("symmetryScore does not mutate input", () => {
    const steps = mkSteps([0, 4, 8, 12], 16);
    const snap = [...steps];
    symmetryScore(steps);
    expect(steps).toEqual(snap);
  });

  it("two calls return identical results", () => {
    const steps = mkSteps([0, 1, 2, 3, 8, 9, 10, 11], 16);
    const a = symmetryScore(steps);
    const b = symmetryScore(steps);
    expect(a.isPalindrome).toBe(b.isPalindrome);
    expect(a.palindromeScore).toBe(b.palindromeScore);
    expect(a.mirrorAxis).toBe(b.mirrorAxis);
    expect(a.halfMirrorScore).toBe(b.halfMirrorScore);
  });

  it("result object is fresh on every call", () => {
    const steps = allTrue(8);
    const a = symmetryScore(steps);
    const b = symmetryScore(steps);
    expect(a).not.toBe(b);
  });
});
