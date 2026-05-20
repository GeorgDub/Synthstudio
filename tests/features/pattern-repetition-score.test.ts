/**
 * tests/features/pattern-repetition-score.test.ts - v3.215
 *
 * Pure-Coverage fuer client/src/utils/patternRepetitionScore.ts.
 *
 * Spec pinned via tests:
 *   - Pin #1: similarity = matching-count / L
 *   - Pin #2: strict gt 0.8 (similarity == 0.8 -> kein Match)
 *   - Pin #3: repetitionScore = covered-union-size / length
 *   - Pin #4: dedup overlapping (keep longest / highest similarity)
 *   - Pin #5: uniqueRegions = count maximal-runs nicht-covered
 *   - Pin #6: sort descending similarity, descending length, ascending startA
 *   - Pin #7: minLength NaN / lt 1 -> 4; gt floor(length/2) -> clamp
 *   - Pin #8: length lt 2*minLength -> []
 */
import { describe, it, expect } from "vitest";
import {
  findRepetitions,
  computeRepetitionScore,
  type RepetitionResult,
} from "@/utils/patternRepetitionScore";

const SIM_THRESHOLD = 0.8;

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
// empty / degenerate
// =============================================================================

describe("computeRepetitionScore - empty + degenerate", () => {
  it("empty steps -> empty result", () => {
    const r = computeRepetitionScore([]);
    expect(r.repetitionScore).toBe(0);
    expect(r.matches).toEqual([]);
    expect(r.uniqueRegions).toBe(0);
  });

  it("findRepetitions on empty -> []", () => {
    expect(findRepetitions([])).toEqual([]);
  });

  it("non-array null -> empty result", () => {
    const r = computeRepetitionScore(null as unknown as boolean[]);
    expect(r.repetitionScore).toBe(0);
    expect(r.matches).toEqual([]);
    expect(r.uniqueRegions).toBe(0);
  });

  it("findRepetitions non-array -> []", () => {
    expect(findRepetitions(null as unknown as boolean[])).toEqual([]);
  });

  it("length lt 2*minLength (default 4) -> empty matches", () => {
    const r = computeRepetitionScore(allTrue(7));
    expect(r.matches).toEqual([]);
    expect(r.repetitionScore).toBe(0);
    expect(r.uniqueRegions).toBe(1);
  });
});

// =============================================================================
// all-true / all-false (massiv repetitiv)
// =============================================================================

describe("findRepetitions - all-same patterns are maximally repetitive", () => {
  it("all-true 16 -> repetitionScore high (>= 0.9)", () => {
    const r = computeRepetitionScore(allTrue(16));
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.repetitionScore).toBeGreaterThanOrEqual(0.9);
    for (const m of r.matches) {
      expect(m.similarity).toBe(1);
    }
  });

  it("all-false 16 -> repetitionScore high (>= 0.9)", () => {
    const r = computeRepetitionScore(allFalse(16));
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.repetitionScore).toBeGreaterThanOrEqual(0.9);
  });

  it("all-true covered = all -> uniqueRegions 0", () => {
    const r = computeRepetitionScore(allTrue(16));
    expect(r.uniqueRegions).toBe(0);
  });
});

// =============================================================================
// ABAB pattern (4-step repeat)
// =============================================================================

describe("findRepetitions - ABAB pattern", () => {
  it("ABAB length-8 (steps [0,4]) -> single 4-length match found, score 1.0", () => {
    const steps = mkSteps([0, 4], 8);
    const matches = findRepetitions(steps);
    expect(matches.length).toBeGreaterThan(0);
    const fullMatch = matches.find(
      (m) => m.startA === 0 && m.startB === 4 && m.length === 4,
    );
    expect(fullMatch).toBeDefined();
    expect(fullMatch!.similarity).toBe(1);

    const r = computeRepetitionScore(steps);
    expect(r.repetitionScore).toBe(1.0);
    expect(r.uniqueRegions).toBe(0);
  });

  it("ABAB length-16 (steps [0,4,8,12]) -> repetition high", () => {
    const steps = mkSteps([0, 4, 8, 12], 16);
    const r = computeRepetitionScore(steps);
    expect(r.repetitionScore).toBeGreaterThanOrEqual(0.9);
    expect(r.matches.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Pin #1: Similarity formula = matching / L
// =============================================================================

describe("Pin #1: similarity = matching-count / L", () => {
  it("5-window with 4/5 matching -> similarity 0.8 strict-gt NO match", () => {
    // window A [0..5) = [t,t,t,t,f]
    // window B [8..13) = [t,t,t,t,t]
    // matching positions = 4, similarity = 4/5 = 0.8 -> strict gt 0.8 -> drop
    const steps = mkSteps([0, 1, 2, 3, 8, 9, 10, 11, 12], 16);
    const matches = findRepetitions(steps);
    const exact = matches.find(
      (m) => m.startA === 0 && m.startB === 8 && m.length === 5,
    );
    expect(exact).toBeUndefined();
  });

  it("identical windows -> similarity 1 included", () => {
    const steps = allFalse(16);
    const matches = findRepetitions(steps);
    expect(matches.some((m) => m.similarity === 1)).toBe(true);
  });
});

// =============================================================================
// Pin #2: Strict gt 0.8 threshold
// =============================================================================

describe("Pin #2: similarity threshold is strict greater-than 0.8", () => {
  it("exactly 0.8 similarity -> not a match", () => {
    // construct A [0..10): 8 true positions 0..7, false 8..9
    // B [10..20): true positions 12..19, false 10..11
    // shift = pos 2..7 both true (6 matches), pos 0..1 mismatch, pos 8..9 mismatch
    // similarity = 6/10 = 0.6 - need exact 0.8.
    // Instead: A all-false except pos 0..1 = true; B all-false except pos 10..11 = true.
    // matching = 8 (false positions) - similarity = 8/10 = 0.8
    const steps = new Array(20).fill(false);
    steps[0] = true; steps[1] = true;
    steps[10] = true; steps[11] = true;
    // window A [0..10) = [t,t,f,f,f,f,f,f,f,f]
    // window B [10..20) = [t,t,f,f,f,f,f,f,f,f]
    // identical -> similarity 1, not 0.8! need genuine 80% case.
    // Try: A 9-false-1-true vs B 8-false-2-true differ at exactly 2 positions.
    steps[5] = true;
    // window A [0..10) = pos 0,1,5 true (3 true, 7 false)
    // window B [10..20) = pos 10,11 true (2 true, 8 false)
    // match positions in window: idx 0 (both true), idx 1 (both true),
    //   idx 5 (A=true B=false MISMATCH), others (A=false B=false MATCH)
    // = 9 matches / 10 = 0.9 -> match included (not what we want)
    // Easier: use a smaller length-5 window with known similarity 0.8.
    const s2 = new Array(15).fill(false);
    s2[0] = true; s2[1] = true; s2[2] = true; s2[3] = true;
    s2[10] = true; s2[11] = true; s2[12] = true; s2[13] = true;
    s2[14] = true;
    // window A [0..5) = [t,t,t,t,f]
    // window B [10..15) = [t,t,t,t,t]
    // matching = 4/5 = 0.8 -> strict gt -> NO match
    const matches = findRepetitions(s2, 5);
    const exact = matches.find(
      (m) => m.startA === 0 && m.startB === 10 && m.length === 5,
    );
    expect(exact).toBeUndefined();
  });

  it("similarity 0.9 -> match included", () => {
    // Length-10 windows with 9 matching = 0.9 -> match (strict gt 0.8).
    // Note: many overlapping length-10 windows exist in this 20-step array;
    // dedup keeps just one. We assert SOME length-10 match with sim ~ 0.9
    // exists, not specifically (0,10) which loses to (0,1) on tie-break.
    const steps = new Array(20).fill(false);
    for (let i = 0; i < 10; i++) steps[i] = true;
    for (let i = 10; i < 20; i++) steps[i] = true;
    steps[10] = false;
    const matches = findRepetitions(steps, 10);
    expect(matches.length).toBeGreaterThan(0);
    const lengthTen = matches.find((x) => x.length === 10);
    expect(lengthTen).toBeDefined();
    expect(lengthTen!.similarity).toBeCloseTo(0.9, 5);
  });
});

// =============================================================================
// Pin #3: repetitionScore = union-of-covered / length
// =============================================================================

describe("Pin #3: repetitionScore is union-of-covered indices over length", () => {
  it("ABAB length-8 with one length-4 match -> score 1.0", () => {
    const steps = mkSteps([0, 4], 8);
    const r = computeRepetitionScore(steps);
    expect(r.repetitionScore).toBe(1.0);
  });

  it("score in [0..1] for various inputs", () => {
    const samples = [
      allFalse(16),
      allTrue(16),
      mkSteps([0, 4, 8, 12], 16),
      mkSteps([0, 1, 2, 3], 16),
      mkSteps([2, 7, 11], 16),
    ];
    for (const s of samples) {
      const r = computeRepetitionScore(s);
      expect(r.repetitionScore).toBeGreaterThanOrEqual(0);
      expect(r.repetitionScore).toBeLessThanOrEqual(1);
    }
  });
});

// =============================================================================
// Pin #4: dedup overlapping (keep longest)
// =============================================================================

describe("Pin #4: dedup overlapping matches keeps longest", () => {
  it("no two kept matches have overlapping A-ranges or B-ranges", () => {
    const steps = allTrue(20);
    const matches = findRepetitions(steps);
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const a = matches[i];
        const b = matches[j];
        const aAEnd = a.startA + a.length;
        const bAEnd = b.startA + b.length;
        const overlapA = a.startA < bAEnd && b.startA < aAEnd;
        const aBEnd = a.startB + a.length;
        const bBEnd = b.startB + b.length;
        const overlapB = a.startB < bBEnd && b.startB < aBEnd;
        expect(overlapA || overlapB).toBe(false);
      }
    }
  });

  it("longest available match preferred when conflicting", () => {
    const steps = allTrue(20);
    const matches = findRepetitions(steps);
    expect(matches.length).toBeGreaterThan(0);
    const maxLen = Math.max(...matches.map((m) => m.length));
    expect(maxLen).toBe(10);
  });
});

// =============================================================================
// Pin #5: uniqueRegions = count of maximal non-covered runs
// =============================================================================

describe("Pin #5: uniqueRegions counts maximal non-covered runs", () => {
  it("all covered -> 0 unique regions", () => {
    const r = computeRepetitionScore(allTrue(16));
    expect(r.uniqueRegions).toBe(0);
  });

  it("none-covered (length lt 2*minLength) -> 1 unique region", () => {
    const r = computeRepetitionScore(allTrue(5));
    expect(r.matches).toEqual([]);
    expect(r.uniqueRegions).toBe(1);
  });

  it("uniqueRegions is non-negative integer", () => {
    const samples = [
      mkSteps([0, 4, 8, 12], 16),
      mkSteps([0, 1, 2, 3], 16),
      mkSteps([5, 7, 9], 16),
    ];
    for (const s of samples) {
      const r = computeRepetitionScore(s);
      expect(r.uniqueRegions).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(r.uniqueRegions)).toBe(true);
    }
  });
});

// =============================================================================
// Pin #6: sort-order
// =============================================================================

describe("Pin #6: matches sorted by similarity desc, then length desc, then startA asc", () => {
  it("matches list is sorted descending by similarity", () => {
    const steps = mkSteps([0, 1, 4, 5, 8, 9, 12, 13], 16);
    const matches = findRepetitions(steps);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].similarity).toBeGreaterThanOrEqual(
        matches[i].similarity,
      );
    }
  });

  it("ties in similarity broken by length descending", () => {
    const steps = allTrue(20);
    const matches = findRepetitions(steps);
    for (let i = 1; i < matches.length; i++) {
      if (matches[i - 1].similarity === matches[i].similarity) {
        expect(matches[i - 1].length).toBeGreaterThanOrEqual(matches[i].length);
      }
    }
  });
});

// =============================================================================
// Pin #7: minLength sanitizer
// =============================================================================

describe("Pin #7: minLength sanitizer", () => {
  it("NaN minLength -> default 4", () => {
    const steps = allTrue(16);
    const a = findRepetitions(steps, NaN);
    const b = findRepetitions(steps, 4);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(0);
  });

  it("negative minLength -> default 4", () => {
    const steps = allTrue(16);
    const a = findRepetitions(steps, -10);
    const b = findRepetitions(steps, 4);
    expect(a.length).toBe(b.length);
  });

  it("zero minLength -> default 4", () => {
    const steps = allTrue(16);
    const a = findRepetitions(steps, 0);
    const b = findRepetitions(steps, 4);
    expect(a.length).toBe(b.length);
  });

  it("non-integer minLength -> Math.floor", () => {
    const steps = allTrue(16);
    const a = findRepetitions(steps, 4.7);
    const b = findRepetitions(steps, 4);
    expect(a.length).toBe(b.length);
  });

  it("minLength gt floor(length/2) collides with Pin #8 - Pin #8 wins - []", () => {
    // Pin #7 specifies clamp to floor(length/2). But Pin #8 fires first on
    // the requested value, and "rawMin gt length/2" iff "2*rawMin gt length",
    // so the clamp branch is documented but unreachable. Verify Pin #8 wins.
    const steps = allTrue(16);
    expect(findRepetitions(steps, 100)).toEqual([]);
    expect(findRepetitions(steps, 9)).toEqual([]);
  });

  it("minLength at exactly length/2 boundary runs (no clamp, no early-exit)", () => {
    // length=16, minLength=8: rawMin=8, 2*8=16, NOT lt 16 -> early-exit does
    // not fire; clamp does not fire either (8 = floor(16/2)). Algorithm runs.
    const matches = findRepetitions(allTrue(16), 8);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("Infinity minLength -> default 4", () => {
    const steps = allTrue(16);
    const a = findRepetitions(steps, Infinity);
    const b = findRepetitions(steps, 4);
    expect(a.length).toBe(b.length);
  });

  it("undefined minLength -> default 4", () => {
    const steps = allTrue(16);
    const a = findRepetitions(steps);
    const b = findRepetitions(steps, 4);
    expect(a.length).toBe(b.length);
  });
});

// =============================================================================
// Pin #8: length lt 2*minLength early exit
// =============================================================================

describe("Pin #8: length lt 2*minLength -> empty matches", () => {
  it("length 7 + default minLength 4 (need 8) -> []", () => {
    expect(findRepetitions(allTrue(7))).toEqual([]);
  });

  it("length 8 + default minLength 4 -> some matches possible", () => {
    expect(findRepetitions(allTrue(8)).length).toBeGreaterThan(0);
  });

  it("length 5 + minLength 3 (need 6) -> []", () => {
    expect(findRepetitions(allTrue(5), 3)).toEqual([]);
  });
});

// =============================================================================
// findRepetitions standalone
// =============================================================================

describe("findRepetitions standalone shape contract", () => {
  it("returns array of RepetitionMatch with all 4 keys", () => {
    const matches = findRepetitions(allTrue(16));
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(typeof m.startA).toBe("number");
      expect(typeof m.startB).toBe("number");
      expect(typeof m.length).toBe("number");
      expect(typeof m.similarity).toBe("number");
      expect(m.startB).toBeGreaterThan(m.startA);
      expect(m.length).toBeGreaterThanOrEqual(1);
      expect(m.similarity).toBeGreaterThan(SIM_THRESHOLD);
    }
  });
});

// =============================================================================
// computeRepetitionScore returns valid structure
// =============================================================================

describe("computeRepetitionScore - shape contract", () => {
  it("returns object with all 3 keys + correct types", () => {
    const r: RepetitionResult = computeRepetitionScore(allTrue(16));
    expect(typeof r.repetitionScore).toBe("number");
    expect(Array.isArray(r.matches)).toBe(true);
    expect(typeof r.uniqueRegions).toBe("number");
    expect(Number.isInteger(r.uniqueRegions)).toBe(true);
    expect(r.repetitionScore).toBeGreaterThanOrEqual(0);
    expect(r.repetitionScore).toBeLessThanOrEqual(1);
  });

  it("matches array elements have all RepetitionMatch keys", () => {
    const r = computeRepetitionScore(allTrue(16));
    for (const m of r.matches) {
      const keys = Object.keys(m).sort();
      expect(keys).toEqual(["length", "similarity", "startA", "startB"]);
    }
  });
});

// =============================================================================
// Purity / immutability
// =============================================================================

describe("purity - no mutate, deterministic, fresh output", () => {
  it("input array is not mutated", () => {
    const steps = mkSteps([0, 4, 8, 12], 16);
    const snapshot = [...steps];
    computeRepetitionScore(steps);
    findRepetitions(steps);
    expect(steps).toEqual(snapshot);
  });

  it("two calls return identical results", () => {
    const steps = mkSteps([0, 1, 2, 3, 8, 9, 10, 11], 16);
    const a = computeRepetitionScore(steps);
    const b = computeRepetitionScore(steps);
    expect(a.repetitionScore).toBe(b.repetitionScore);
    expect(a.uniqueRegions).toBe(b.uniqueRegions);
    expect(a.matches.length).toBe(b.matches.length);
  });

  it("matches array is fresh on every call", () => {
    const steps = allTrue(16);
    const a = findRepetitions(steps);
    const b = findRepetitions(steps);
    expect(a).not.toBe(b);
  });

  it("result object is fresh on every call", () => {
    const steps = allTrue(16);
    const a = computeRepetitionScore(steps);
    const b = computeRepetitionScore(steps);
    expect(a).not.toBe(b);
    expect(a.matches).not.toBe(b.matches);
  });
});

// =============================================================================
// Strict boolean contract
// =============================================================================

describe("strict s === true contract", () => {
  it("truthy non-true values count as inactive (no crash + valid result)", () => {
    const sneaky = [1, 0, "x", "", true, false, true, false, 1, 0, "x", "", true, false, true, false] as unknown as boolean[];
    const r = computeRepetitionScore(sneaky);
    expect(r.repetitionScore).toBeGreaterThanOrEqual(0);
    expect(r.repetitionScore).toBeLessThanOrEqual(1);
    expect(Number.isInteger(r.uniqueRegions)).toBe(true);
  });
});
