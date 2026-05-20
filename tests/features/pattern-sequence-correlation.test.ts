/**
 * tests/features/pattern-sequence-correlation.test.ts (v3.204)
 *
 * Pure-Coverage fuer client/src/utils/patternSequenceCorrelation.ts.
 * Inputs duerfen nie mutiert werden; saemtliche Funktionen sind deterministisch.
 */
import { describe, it, expect } from "vitest";
import {
  compareSequences,
  findBestShift,
  patternSimilarity,
} from "@/utils/patternSequenceCorrelation";

// --- compareSequences -------------------------------------------------------

describe("compareSequences", () => {
  it("both empty -> similarity 0, matchingSteps 0, totalSteps 0, shifted 0", () => {
    const r = compareSequences([], []);
    expect(r).toEqual({
      similarity: 0,
      matchingSteps: 0,
      totalSteps: 0,
      shifted: 0,
    });
  });

  it("one side empty -> similarity 0, totalSteps 0", () => {
    expect(compareSequences([], [true, false, true])).toEqual({
      similarity: 0,
      matchingSteps: 0,
      totalSteps: 0,
      shifted: 0,
    });
    expect(compareSequences([true, false], [])).toEqual({
      similarity: 0,
      matchingSteps: 0,
      totalSteps: 0,
      shifted: 0,
    });
  });

  it("identical arrays -> similarity 1, matchingSteps = length", () => {
    const a = [true, false, true, true, false];
    const r = compareSequences(a, a.slice());
    expect(r.similarity).toBe(1);
    expect(r.matchingSteps).toBe(5);
    expect(r.totalSteps).toBe(5);
    expect(r.shifted).toBe(0);
  });

  it("completely opposite (all-true vs all-false) -> similarity 0", () => {
    const a = [true, true, true, true];
    const b = [false, false, false, false];
    const r = compareSequences(a, b);
    expect(r.similarity).toBe(0);
    expect(r.matchingSteps).toBe(0);
    expect(r.totalSteps).toBe(4);
  });

  it("50/50 match -> similarity 0.5", () => {
    const a = [true, true, false, false];
    const b = [true, false, false, true];
    const r = compareSequences(a, b);
    expect(r.similarity).toBe(0.5);
    expect(r.matchingSteps).toBe(2);
    expect(r.totalSteps).toBe(4);
  });

  it("different lengths -> totalSteps = min length", () => {
    const a = [true, false, true, false, true];
    const b = [true, false, true];
    const r = compareSequences(a, b);
    expect(r.totalSteps).toBe(3);
    expect(r.matchingSteps).toBe(3);
    expect(r.similarity).toBe(1);
  });

  it("single-element arrays match correctly", () => {
    expect(compareSequences([true], [true]).similarity).toBe(1);
    expect(compareSequences([false], [false]).similarity).toBe(1);
    expect(compareSequences([true], [false]).similarity).toBe(0);
  });

  it("does NOT mutate inputs", () => {
    const a = [true, false, true];
    const b = [false, false, true];
    const aSnap = a.slice();
    const bSnap = b.slice();
    compareSequences(a, b);
    expect(a).toEqual(aSnap);
    expect(b).toEqual(bSnap);
  });
});

// --- findBestShift ----------------------------------------------------------

describe("findBestShift", () => {
  it("both empty -> similarity 0, shifted 0", () => {
    expect(findBestShift([], [])).toEqual({
      similarity: 0,
      matchingSteps: 0,
      totalSteps: 0,
      shifted: 0,
    });
  });

  it("one side empty -> similarity 0, shifted 0", () => {
    expect(findBestShift([true, false], [])).toEqual({
      similarity: 0,
      matchingSteps: 0,
      totalSteps: 0,
      shifted: 0,
    });
    expect(findBestShift([], [true, false])).toEqual({
      similarity: 0,
      matchingSteps: 0,
      totalSteps: 0,
      shifted: 0,
    });
  });

  it("different lengths -> fallback to compareSequences (shifted 0)", () => {
    const a = [true, false, true, false];
    const b = [true, false];
    const r = findBestShift(a, b);
    expect(r.shifted).toBe(0);
    expect(r.totalSteps).toBe(2);
    expect(r.matchingSteps).toBe(2);
    expect(r.similarity).toBe(1);
  });

  it("identical -> shifted 0, similarity 1", () => {
    const a = [true, false, false, true, false, false, true, false];
    const r = findBestShift(a, a.slice());
    expect(r.similarity).toBe(1);
    expect(r.shifted).toBe(0);
  });

  it("right-shift by 2: findet shift=2 mit similarity=1", () => {
    // rotated[i] = b[(i - k + n) % n].
    // For rotated == a with a[0]=true, k=2, n=8:
    //   need b[(0 - 2 + 8) % 8] = b[6] = true (and all other b[i]=false).
    const a = [true, false, false, false, false, false, false, false];
    const b = [false, false, false, false, false, false, true, false];
    const r = findBestShift(a, b);
    expect(r.similarity).toBe(1);
    expect(r.shifted).toBe(2);
    expect(r.matchingSteps).toBe(8);
    expect(r.totalSteps).toBe(8);
  });

  it("right-shift by 1 on classic 4-on-floor finds shift=1", () => {
    const a = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    // b designed so that rotated_b_with_k1[i] == a[i].
    // rotated[0] = b[(0 - 1 + 16) % 16] = b[15]; a[0] = true -> b[15] = true.
    // rotated[4] = b[3];  a[4]=true -> b[3]=true.
    // rotated[8] = b[7];  -> b[7]=true.
    // rotated[12]= b[11]; -> b[11]=true.
    const b = [
      false, false, false, true,
      false, false, false, true,
      false, false, false, true,
      false, false, false, true,
    ];
    const r = findBestShift(a, b);
    expect(r.similarity).toBe(1);
    expect(r.shifted).toBe(1);
  });

  it("all-true vs all-false -> similarity 0 regardless of shift", () => {
    const a = [true, true, true, true];
    const b = [false, false, false, false];
    const r = findBestShift(a, b);
    expect(r.similarity).toBe(0);
    expect(r.totalSteps).toBe(4);
  });

  it("all-true vs all-true -> similarity 1; picks shifted=0 (first best hit)", () => {
    const a = [true, true, true, true];
    const b = [true, true, true, true];
    const r = findBestShift(a, b);
    expect(r.similarity).toBe(1);
    expect(r.shifted).toBe(0);
  });

  it("single-element arrays", () => {
    expect(findBestShift([true], [true])).toEqual({
      similarity: 1,
      matchingSteps: 1,
      totalSteps: 1,
      shifted: 0,
    });
    expect(findBestShift([true], [false])).toEqual({
      similarity: 0,
      matchingSteps: 0,
      totalSteps: 1,
      shifted: 0,
    });
  });

  it("partial match: best shift beats no-shift", () => {
    //   a hits at indices {0, 3, 6}; b hits at {1, 4, 7}
    //   For rotated[i] = b[(i - k + 8) % 8] == a[i] for all i,
    //   need (i - k) mod 8 in b-hits when i in a-hits.
    //   i=0 -> need b[(-k+8)%8] = true -> b[7] is true -> k=1? then
    //   (-1+8)%8 = 7 yes. i=3 -> b[(3-1+8)%8] = b[2] = false. So k=1 fails.
    //   Try k=7: i=0 -> b[(0-7+8)%8] = b[1] = true. i=3 -> b[(3-7+8)%8]=b[4]=true.
    //   i=6 -> b[(6-7+8)%8] = b[7] = true. All other i: a[i]=false, need b[(i-7+8)%8]=false:
    //   i=1 -> b[2]=false; i=2 -> b[3]=false; i=4 -> b[5]=false; i=5 -> b[6]=false;
    //   i=7 -> b[0]=false. All match -> k=7 gives similarity 1.
    const a = [true, false, false, true, false, false, true, false];
    const b = [false, true, false, false, true, false, false, true];
    const direct = compareSequences(a, b);
    const best = findBestShift(a, b);
    expect(direct.similarity).toBeLessThan(1);
    expect(best.similarity).toBe(1);
    expect(best.shifted).toBe(7);
  });

  it("does NOT mutate inputs", () => {
    const a = [true, false, false, true, false];
    const b = [false, true, false, false, true];
    const aSnap = a.slice();
    const bSnap = b.slice();
    findBestShift(a, b);
    expect(a).toEqual(aSnap);
    expect(b).toEqual(bSnap);
  });
});

// --- patternSimilarity ------------------------------------------------------

describe("patternSimilarity", () => {
  it("both empty -> 0", () => {
    expect(patternSimilarity([], [])).toBe(0);
  });

  it("identical -> 1", () => {
    const a = [true, false, true, false];
    expect(patternSimilarity(a, a.slice())).toBe(1);
  });

  it("completely opposite -> 0", () => {
    expect(patternSimilarity([true, true], [false, false])).toBe(0);
  });

  it("is symmetric: patternSimilarity(a,b) === patternSimilarity(b,a)", () => {
    const a = [true, false, false, true, true, false, true, false];
    const b = [false, true, false, true, false, false, true, true];
    expect(patternSimilarity(a, b)).toBe(patternSimilarity(b, a));
  });

  it("matches compareSequences.similarity for equal-length inputs", () => {
    const a = [true, false, true, true, false, false];
    const b = [true, true, true, false, false, false];
    expect(patternSimilarity(a, b)).toBe(compareSequences(a, b).similarity);
  });

  it("handles different lengths via min-length compare", () => {
    const a = [true, false, true, false, true];
    const b = [true, false, true];
    // both compareSequences calls use min(5,3)=3, all 3 match -> 1.0
    expect(patternSimilarity(a, b)).toBe(1);
  });
});
