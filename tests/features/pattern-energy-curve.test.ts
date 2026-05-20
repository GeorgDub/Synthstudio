/**
 * tests/features/pattern-energy-curve.test.ts - v3.211
 *
 * Pure-Coverage fuer client/src/utils/patternEnergyCurve.ts.
 * Foundation fuer Pattern-Build-Detection + Auto-Mix-Automation.
 *
 * Spec pinned via tests:
 *   - Trailing-Window-Konvention (single hit at k -> peak at k)
 *   - velocity default = 127 (Full-Hit) bei active && !velocity
 *   - peakEnergy = RAW pre-normalization; points[peakStepIndex].energy === 1
 *   - detectTrend order: slope -> range -> wave
 *   - windowSize > steps.length wird auf steps.length geclamped UND
 *     der Divisor ist die geclampte Size (kein Inflate).
 */
import { describe, it, expect } from "vitest";
import {
  computeEnergyCurve,
  detectTrend,
  type EnergyPoint,
  type EnergyStepLike,
} from "@/utils/patternEnergyCurve";

// --- Helpers ---------------------------------------------------------------

function mkSteps(activeIdx: readonly number[], len = 16): EnergyStepLike[] {
  const out: EnergyStepLike[] = [];
  for (let i = 0; i < len; i++) {
    out.push({ active: activeIdx.includes(i) });
  }
  return out;
}

function mkStepsWithVel(
  spec: readonly { i: number; v: number | undefined }[],
  len = 16,
): EnergyStepLike[] {
  const out: EnergyStepLike[] = [];
  for (let i = 0; i < len; i++) {
    out.push({ active: false });
  }
  for (const s of spec) {
    if (s.i >= 0 && s.i < len) {
      out[s.i] = { active: true, velocity: s.v };
    }
  }
  return out;
}

function mkPoints(ys: readonly number[], startIdx = 0): EnergyPoint[] {
  return ys.map((y, k) => ({ stepIndex: startIdx + k, energy: y }));
}

// =============================================================================
// computeEnergyCurve - empty / degenerate
// =============================================================================

describe("computeEnergyCurve - empty / degenerate", () => {
  it("empty steps -> empty points, peak=-1, avg=0, flat", () => {
    const r = computeEnergyCurve([]);
    expect(r.points).toEqual([]);
    expect(r.peakEnergy).toBe(0);
    expect(r.peakStepIndex).toBe(-1);
    expect(r.averageEnergy).toBe(0);
    expect(r.trend).toBe("flat");
  });

  it("all-inactive non-empty -> all zero points, peak=-1, flat", () => {
    const r = computeEnergyCurve(mkSteps([], 8));
    expect(r.points.length).toBe(8);
    for (const p of r.points) expect(p.energy).toBe(0);
    expect(r.peakEnergy).toBe(0);
    expect(r.peakStepIndex).toBe(-1);
    expect(r.averageEnergy).toBe(0);
    expect(r.trend).toBe("flat");
  });

  it("stepIndex is 0..n-1 in output points", () => {
    const r = computeEnergyCurve(mkSteps([0, 7], 8));
    for (let i = 0; i < 8; i++) {
      expect(r.points[i].stepIndex).toBe(i);
    }
  });
});

// =============================================================================
// computeEnergyCurve - single hit (pins trailing-window convention)
// =============================================================================

describe("computeEnergyCurve - single hit", () => {
  it("single hit at step k -> peak EXACTLY at step k (trailing window)", () => {
    const steps = mkSteps([5], 16);
    const r = computeEnergyCurve(steps, 4);
    expect(r.peakStepIndex).toBe(5);
    expect(r.points[5].energy).toBe(1);
  });

  it("single hit at step 0 -> peak at step 0", () => {
    const r = computeEnergyCurve(mkSteps([0], 8), 4);
    expect(r.peakStepIndex).toBe(0);
    expect(r.points[0].energy).toBe(1);
  });

  it("single hit at last step -> peak at last step", () => {
    const r = computeEnergyCurve(mkSteps([15], 16), 4);
    expect(r.peakStepIndex).toBe(15);
    expect(r.points[15].energy).toBe(1);
  });
});

// =============================================================================
// computeEnergyCurve - normalization
// =============================================================================

describe("computeEnergyCurve - normalization", () => {
  it("peakEnergy < 1 when sparse, points[peakIdx].energy === 1", () => {
    const r = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 127 }], 16), 4);
    expect(r.peakEnergy).toBeCloseTo(0.25, 10);
    expect(r.points[r.peakStepIndex].energy).toBe(1);
  });

  it("dense full-velocity 4-on-the-floor reaches peakEnergy = 1", () => {
    const steps = mkSteps([0, 1, 2, 3, 4, 5, 6, 7], 8);
    const r = computeEnergyCurve(steps, 4);
    expect(r.peakEnergy).toBeCloseTo(1, 10);
  });

  it("averageEnergy in [0..1] for any input", () => {
    const r = computeEnergyCurve(mkSteps([0, 4, 8, 12], 16), 4);
    expect(r.averageEnergy).toBeGreaterThanOrEqual(0);
    expect(r.averageEnergy).toBeLessThanOrEqual(1);
  });

  it("averageEnergy is mean over NORMALIZED points", () => {
    const r = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 127 }], 4), 4);
    expect(r.averageEnergy).toBeCloseTo(0.25, 10);
  });
});

// =============================================================================
// computeEnergyCurve - trend classification
// =============================================================================

describe("computeEnergyCurve - trends", () => {
  it("rising pattern (sparse -> dense) -> trend rising", () => {
    // 8-step pattern, hits clustered in second half -> clear positive slope.
    const steps = mkSteps([4, 5, 6, 7], 8);
    const r = computeEnergyCurve(steps, 4);
    expect(r.trend).toBe("rising");
  });

  it("falling pattern (dense -> sparse) -> trend falling", () => {
    // 16-step pattern, hits clustered at the start with a long empty tail
    // so the trailing-window energy clearly falls overall (slope < -0.05).
    const steps = mkSteps([0, 1, 2, 3], 16);
    const r = computeEnergyCurve(steps, 4);
    expect(r.trend).toBe("falling");
  });

  it("flat 4-on-the-floor with same velocity -> trend flat", () => {
    const steps = mkSteps([0, 4, 8, 12], 16);
    const r = computeEnergyCurve(steps, 4);
    expect(r.trend).toBe("flat");
  });

  it("wave pattern (early + late cluster, mid dip) -> trend wave", () => {
    const steps = mkSteps([0, 1, 2, 3, 12, 13, 14, 15], 16);
    const r = computeEnergyCurve(steps, 4);
    expect(r.trend).toBe("wave");
  });
});

// =============================================================================
// computeEnergyCurve - windowSize behavior
// =============================================================================

describe("computeEnergyCurve - windowSize", () => {
  it("windowSize=1 -> no smoothing", () => {
    const r = computeEnergyCurve(mkSteps([0, 2, 4], 8), 1);
    expect(r.points[0].energy).toBe(1);
    expect(r.points[1].energy).toBe(0);
    expect(r.points[2].energy).toBe(1);
    expect(r.points[3].energy).toBe(0);
    expect(r.points[4].energy).toBe(1);
  });

  it("windowSize NaN -> default 4", () => {
    const r1 = computeEnergyCurve(mkSteps([3], 8), NaN as unknown as number);
    const r2 = computeEnergyCurve(mkSteps([3], 8), 4);
    expect(r1.peakEnergy).toBeCloseTo(r2.peakEnergy, 10);
    expect(r1.peakStepIndex).toBe(r2.peakStepIndex);
  });

  it("windowSize < 1 -> default 4", () => {
    const r1 = computeEnergyCurve(mkSteps([3], 8), 0);
    const r2 = computeEnergyCurve(mkSteps([3], 8), 4);
    expect(r1.peakEnergy).toBeCloseTo(r2.peakEnergy, 10);
  });

  it("windowSize > steps.length -> clamped, divisor uses clamped size", () => {
    const r = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 127 }], 4), 100);
    expect(r.peakEnergy).toBeCloseTo(0.25, 10);
    expect(r.peakEnergy).toBeLessThan(1);
  });

  it("windowSize non-integer -> floored", () => {
    const r1 = computeEnergyCurve(mkSteps([3], 8), 3.7);
    const r2 = computeEnergyCurve(mkSteps([3], 8), 3);
    expect(r1.peakEnergy).toBeCloseTo(r2.peakEnergy, 10);
  });
});

// =============================================================================
// computeEnergyCurve - velocity sanitizers
// =============================================================================

describe("computeEnergyCurve - velocity sanitizers", () => {
  it("active without velocity -> treated as 127 (full hit)", () => {
    const r = computeEnergyCurve(mkSteps([3], 16), 4);
    expect(r.peakEnergy).toBeCloseTo(0.25, 10);
  });

  it("velocity NaN -> default 127", () => {
    const r1 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: NaN }], 16), 4);
    const r2 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 127 }], 16), 4);
    expect(r1.peakEnergy).toBeCloseTo(r2.peakEnergy, 10);
  });

  it("velocity negative -> clamped to 0", () => {
    const r = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: -50 }], 16), 4);
    expect(r.peakEnergy).toBe(0);
    expect(r.peakStepIndex).toBe(-1);
  });

  it("velocity > 127 -> clamped to 127", () => {
    const r1 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 9999 }], 16), 4);
    const r2 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 127 }], 16), 4);
    expect(r1.peakEnergy).toBeCloseTo(r2.peakEnergy, 10);
  });

  it("velocity Infinity -> default 127", () => {
    const r1 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: Infinity }], 16), 4);
    const r2 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 127 }], 16), 4);
    expect(r1.peakEnergy).toBeCloseTo(r2.peakEnergy, 10);
  });

  it("higher velocity -> higher raw peak", () => {
    const r64 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 64 }], 16), 4);
    const r127 = computeEnergyCurve(mkStepsWithVel([{ i: 3, v: 127 }], 16), 4);
    expect(r127.peakEnergy).toBeGreaterThan(r64.peakEnergy);
  });
});

// =============================================================================
// computeEnergyCurve - peak identification
// =============================================================================

describe("computeEnergyCurve - peak identification", () => {
  it("peakStepIndex sits at densest region (trailing window)", () => {
    const steps = mkSteps([7, 8, 9], 16);
    const r = computeEnergyCurve(steps, 4);
    expect(r.peakStepIndex).toBe(9);
  });

  it("ties resolve to first occurrence (deterministic)", () => {
    const steps = mkSteps([0, 1, 8, 9], 16);
    const r = computeEnergyCurve(steps, 2);
    expect(r.peakStepIndex).toBe(1);
  });
});

// =============================================================================
// detectTrend - direct unit tests
// =============================================================================

describe("detectTrend - direct", () => {
  it("empty -> flat", () => {
    expect(detectTrend([])).toBe("flat");
  });

  it("single point -> flat", () => {
    expect(detectTrend(mkPoints([0.5]))).toBe("flat");
  });

  it("strict monotonic rise -> rising", () => {
    expect(detectTrend(mkPoints([0, 0.2, 0.4, 0.6, 0.8, 1.0]))).toBe("rising");
  });

  it("strict monotonic fall -> falling", () => {
    expect(detectTrend(mkPoints([1.0, 0.8, 0.6, 0.4, 0.2, 0]))).toBe("falling");
  });

  it("flat constant -> flat", () => {
    expect(detectTrend(mkPoints([0.5, 0.5, 0.5, 0.5, 0.5]))).toBe("flat");
  });

  it("wave (long oscillation, slope ~ 0, range > 0.1) -> wave", () => {
    // 10-point alternation: slope ~ 0.030 (< 0.05), range = 1 (> 0.1) -> wave.
    expect(
      detectTrend(mkPoints([0, 1, 0, 1, 0, 1, 0, 1, 0, 1])),
    ).toBe("wave");
  });

  it("rising slope wins over small range check (order matters)", () => {
    const r = detectTrend(mkPoints([0.0, 0.06, 0.12]));
    expect(r).toBe("rising");
  });

  it("range < 0.1 and slope ~= 0 -> flat (not wave)", () => {
    expect(detectTrend(mkPoints([0.5, 0.55, 0.5, 0.55, 0.5]))).toBe("flat");
  });
});

// =============================================================================
// purity / immutability
// =============================================================================

describe("computeEnergyCurve - purity", () => {
  it("does not mutate the input steps array", () => {
    const steps = mkStepsWithVel(
      [
        { i: 0, v: 100 },
        { i: 4, v: 80 },
        { i: 8, v: 60 },
      ],
      16,
    );
    const snapshot = steps.map((s) => ({ ...s }));
    computeEnergyCurve(steps, 4);
    expect(steps).toEqual(snapshot);
  });

  it("two calls with identical input return identical results", () => {
    const steps = mkSteps([0, 3, 7, 11, 15], 16);
    const a = computeEnergyCurve(steps, 4);
    const b = computeEnergyCurve(steps, 4);
    expect(a).toEqual(b);
  });
});
