/**
 * tests/features/pattern-flow-direction.test.ts - v3.213
 *
 * Pure-Coverage fuer client/src/utils/patternFlowDirection.ts.
 *
 * Spec pinned via tests:
 *   - Priority-Order half-pair > center-edge-pair > uniform
 *   - Strict greater an der 0.2-Grenze (delta == 0.2 -> uniform)
 *   - Floor-Rounding fuer thirds/sixths
 *   - length < 6 -> direction='uniform' aber densities werden trotzdem berechnet
 *   - confidence in [0..1], NaN-safe
 *   - Hits: strict s === true
 */
import { describe, it, expect } from "vitest";
import {
  detectFlowDirection,
  type FlowResult,
} from "@/utils/patternFlowDirection";

// --- Helpers ---------------------------------------------------------------

function mkSteps(activeIdx: readonly number[], len = 16): boolean[] {
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

describe("detectFlowDirection - empty / degenerate", () => {
  it("empty steps -> uniform, confidence 0, all densities 0", () => {
    const r = detectFlowDirection([]);
    expect(r.direction).toBe("uniform");
    expect(r.confidence).toBe(0);
    expect(r.firstHalfDensity).toBe(0);
    expect(r.secondHalfDensity).toBe(0);
    expect(r.centerDensity).toBe(0);
    expect(r.edgeDensity).toBe(0);
  });

  it("all-false 16 steps -> uniform, all densities 0, confidence 0", () => {
    const r = detectFlowDirection(allFalse(16));
    expect(r.direction).toBe("uniform");
    expect(r.confidence).toBe(0);
    expect(r.firstHalfDensity).toBe(0);
    expect(r.secondHalfDensity).toBe(0);
    expect(r.centerDensity).toBe(0);
    expect(r.edgeDensity).toBe(0);
  });

  it("all-true 16 steps -> uniform (equal everywhere), confidence 0", () => {
    const r = detectFlowDirection(allTrue(16));
    expect(r.direction).toBe("uniform");
    expect(r.firstHalfDensity).toBe(1);
    expect(r.secondHalfDensity).toBe(1);
    expect(r.centerDensity).toBe(1);
    expect(r.edgeDensity).toBe(1);
    expect(r.confidence).toBe(0);
  });

  it("non-array input (cast) -> uniform, confidence 0", () => {
    const r = detectFlowDirection(null as unknown as boolean[]);
    expect(r.direction).toBe("uniform");
    expect(r.confidence).toBe(0);
  });
});

// =============================================================================
// short patterns (< 6) -> uniform but densities still populated
// =============================================================================

describe("detectFlowDirection - short patterns (< 6)", () => {
  it("length 4 with strong forward skew -> still uniform (too short)", () => {
    const r = detectFlowDirection(mkSteps([2, 3], 4));
    expect(r.direction).toBe("uniform");
    expect(r.firstHalfDensity).toBe(0);
    expect(r.secondHalfDensity).toBe(1);
  });

  it("length 5 -> always uniform", () => {
    const r = detectFlowDirection(mkSteps([3, 4], 5));
    expect(r.direction).toBe("uniform");
  });

  it("length 6 -> direction logic engages (boundary)", () => {
    const r = detectFlowDirection(mkSteps([3, 4, 5], 6));
    expect(r.direction).toBe("forward");
  });
});

// =============================================================================
// forward / backward classification
// =============================================================================

describe("detectFlowDirection - forward / backward", () => {
  it("hits all in second half -> forward", () => {
    const r = detectFlowDirection(mkSteps([8, 9, 10, 11, 12, 13, 14, 15], 16));
    expect(r.direction).toBe("forward");
    expect(r.confidence).toBeGreaterThan(0.2);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("hits all in first half -> backward", () => {
    const r = detectFlowDirection(mkSteps([0, 1, 2, 3, 4, 5, 6, 7], 16));
    expect(r.direction).toBe("backward");
    expect(r.confidence).toBeGreaterThan(0.2);
  });

  it("subtle skew toward second half (delta > 0.2) -> forward", () => {
    const r = detectFlowDirection(mkSteps([0, 8, 10, 12, 14], 16));
    expect(r.direction).toBe("forward");
  });
});

// =============================================================================
// center-out / edges-in classification
// =============================================================================

describe("detectFlowDirection - center-out / edges-in", () => {
  it("hits clustered in middle third -> center-out", () => {
    const r = detectFlowDirection(mkSteps([6, 7, 8, 9], 16));
    expect(r.direction).toBe("center-out");
    expect(r.centerDensity).toBeGreaterThan(r.edgeDensity);
  });

  it("hits at the edges (start + end), middle sparse -> edges-in", () => {
    const r = detectFlowDirection(mkSteps([0, 1, 14, 15], 16));
    expect(r.direction).toBe("edges-in");
    expect(r.edgeDensity).toBeGreaterThan(r.centerDensity);
  });

  it("uniform 4-on-the-floor -> uniform", () => {
    const r = detectFlowDirection(mkSteps([0, 4, 8, 12], 16));
    expect(r.direction).toBe("uniform");
  });
});

// =============================================================================
// priority order: half-pair beats center-edge-pair when both fire
// =============================================================================

describe("detectFlowDirection - priority order", () => {
  it("hits in first quarter trigger both pairs - half-pair wins -> backward", () => {
    const r = detectFlowDirection(mkSteps([0, 1, 2, 3], 16));
    expect(r.direction).toBe("backward");
    expect(r.confidence).toBeCloseTo(0.5, 10);
  });

  it("hits in last quarter trigger both pairs - half wins -> forward", () => {
    const r = detectFlowDirection(mkSteps([12, 13, 14, 15], 16));
    expect(r.direction).toBe("forward");
  });
});

// =============================================================================
// strict-greater threshold at exactly 0.2
// =============================================================================

describe("detectFlowDirection - threshold boundary (strict greater)", () => {
  it("halfDelta exactly 0.2 -> falls through to center-edge / uniform", () => {
    const r = detectFlowDirection([true, false, false, false, false, true, false, false, false, true]);
    expect(r.firstHalfDensity).toBeCloseTo(0.2, 10);
    expect(r.secondHalfDensity).toBeCloseTo(0.4, 10);
    expect(r.direction).not.toBe("forward");
    expect(r.direction).not.toBe("backward");
  });

  it("halfDelta just at 0.2 + tiny center-edge -> uniform", () => {
    const r = detectFlowDirection([true, false, false, false, false, true, false, true, false, false]);
    expect(r.direction).toBe("uniform");
    expect(r.confidence).toBeCloseTo(0.2, 10);
  });
});

// =============================================================================
// densities + confidence numeric properties
// =============================================================================

describe("detectFlowDirection - numeric properties", () => {
  it("confidence always in [0..1]", () => {
    const inputs: boolean[][] = [
      mkSteps([0, 1, 2, 3], 16),
      mkSteps([12, 13, 14, 15], 16),
      mkSteps([6, 7, 8, 9], 16),
      mkSteps([0, 15], 16),
      mkSteps([0, 4, 8, 12], 16),
      allTrue(16),
      allFalse(16),
      allTrue(32),
    ];
    for (const s of inputs) {
      const r = detectFlowDirection(s);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("all densities always in [0..1]", () => {
    const inputs: boolean[][] = [
      mkSteps([0, 1, 2, 3], 16),
      mkSteps([12, 13, 14, 15], 16),
      mkSteps([6, 7, 8, 9], 16),
      allTrue(16),
      allFalse(16),
    ];
    for (const s of inputs) {
      const r = detectFlowDirection(s);
      expect(r.firstHalfDensity).toBeGreaterThanOrEqual(0);
      expect(r.firstHalfDensity).toBeLessThanOrEqual(1);
      expect(r.secondHalfDensity).toBeGreaterThanOrEqual(0);
      expect(r.secondHalfDensity).toBeLessThanOrEqual(1);
      expect(r.centerDensity).toBeGreaterThanOrEqual(0);
      expect(r.centerDensity).toBeLessThanOrEqual(1);
      expect(r.edgeDensity).toBeGreaterThanOrEqual(0);
      expect(r.edgeDensity).toBeLessThanOrEqual(1);
    }
  });

  it("uniform confidence reports max abs-delta of the two pairs", () => {
    const r = detectFlowDirection(mkSteps([0, 4, 8, 12], 16));
    expect(r.direction).toBe("uniform");
    expect(r.confidence).toBeCloseTo(0.05, 10);
  });
});

// =============================================================================
// edge cases - single hit
// =============================================================================

describe("detectFlowDirection - edge cases", () => {
  it("single hit in middle (length 16) -> center-out or uniform (not forward/backward)", () => {
    const r = detectFlowDirection(mkSteps([7], 16));
    expect(["center-out", "uniform"]).toContain(r.direction);
    expect(r.direction).not.toBe("forward");
    expect(r.direction).not.toBe("backward");
  });

  it("single hit at start (length 16) -> backward or edges-in or uniform", () => {
    const r = detectFlowDirection(mkSteps([0], 16));
    expect(["backward", "edges-in", "uniform"]).toContain(r.direction);
  });

  it("hits at edges of a 24-step (longer pattern) -> edges-in", () => {
    const r = detectFlowDirection(mkSteps([0, 1, 2, 3, 20, 21, 22, 23], 24));
    expect(r.direction).toBe("edges-in");
  });
});

// =============================================================================
// strict s === true
// =============================================================================

describe("detectFlowDirection - strict boolean contract", () => {
  it("non-true values are treated as inactive", () => {
    // 16-element array: 5 non-true (positions 0..4), 11 true (positions 5..15).
    // half=8: firstHalf=[0..7] has 3 hits -> 3/8 = 0.375;
    //         secondHalf=[8..15] has 8 hits -> 8/8 = 1.0; delta = 0.625 -> forward.
    const weird: unknown[] = [1, "x", {}, null, undefined, true, true, true, true, true, true, true, true, true, true, true];
    const r = detectFlowDirection(weird as boolean[]);
    expect(r.firstHalfDensity).toBeCloseTo(3 / 8, 10);
    expect(r.secondHalfDensity).toBeCloseTo(8 / 8, 10);
    expect(r.direction).toBe("forward");
  });
});

// =============================================================================
// purity / determinism
// =============================================================================

describe("detectFlowDirection - purity", () => {
  it("does not mutate the input array", () => {
    const steps = mkSteps([0, 4, 8, 12], 16);
    const snapshot = [...steps];
    detectFlowDirection(steps);
    expect(steps).toEqual(snapshot);
  });

  it("two calls with identical input return identical results (deterministic)", () => {
    const steps = mkSteps([0, 3, 7, 11, 15], 16);
    const a = detectFlowDirection(steps);
    const b = detectFlowDirection(steps);
    expect(a).toEqual(b);
  });

  it("result is a fresh object on every call (no shared reference)", () => {
    const steps = mkSteps([0, 4, 8, 12], 16);
    const a = detectFlowDirection(steps);
    const b = detectFlowDirection(steps);
    expect(a).not.toBe(b);
  });
});

// =============================================================================
// FlowResult type-exposure smoke
// =============================================================================

describe("FlowResult type contract", () => {
  it("all 6 result keys present + correctly typed", () => {
    const r: FlowResult = detectFlowDirection(mkSteps([0, 4, 8, 12], 16));
    expect(typeof r.direction).toBe("string");
    expect(typeof r.confidence).toBe("number");
    expect(typeof r.firstHalfDensity).toBe("number");
    expect(typeof r.secondHalfDensity).toBe("number");
    expect(typeof r.centerDensity).toBe("number");
    expect(typeof r.edgeDensity).toBe("number");
  });
});
