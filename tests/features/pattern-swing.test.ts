/**
 * tests/features/pattern-swing.test.ts (v3.162.0)
 *
 * Unit tests for the pure swing-quantization helpers.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";

import {
  swingOffsetForStep,
  buildSwingMap,
  SWING_NONE,
  SWING_LIGHT,
  SWING_MEDIUM,
  SWING_HEAVY,
  type SwungStep,
} from "@/utils/patternSwing";

// ─── swingOffsetForStep ──────────────────────────────────────────────────────

describe("swingOffsetForStep", () => {
  it("even index immer 0 (no swing)", () => {
    expect(swingOffsetForStep(0, 0.5, 0.1, 16)).toBe(0);
    expect(swingOffsetForStep(2, 0.5, 0.1, 16)).toBe(0);
    expect(swingOffsetForStep(4, 0.5, 0.1, 16)).toBe(0);
    expect(swingOffsetForStep(14, 0.5, 0.1, 16)).toBe(0);
  });

  it("odd index + swingAmount=0 → 0", () => {
    expect(swingOffsetForStep(1, 0, 0.1, 16)).toBe(0);
    expect(swingOffsetForStep(3, 0, 0.25, 16)).toBe(0);
    expect(swingOffsetForStep(5, SWING_NONE, 0.1, 8)).toBe(0);
  });

  it("odd index + swingAmount=0.5 + stepDur=0.1 → 0.025", () => {
    expect(swingOffsetForStep(1, 0.5, 0.1, 16)).toBeCloseTo(0.025, 9);
    expect(swingOffsetForStep(3, 0.5, 0.1, 16)).toBeCloseTo(0.025, 9);
    expect(swingOffsetForStep(5, 0.5, 0.1, 16)).toBeCloseTo(0.025, 9);
  });

  it("NaN inputs → 0", () => {
    expect(swingOffsetForStep(NaN, 0.5, 0.1, 16)).toBe(0);
    expect(swingOffsetForStep(1, NaN, 0.1, 16)).toBe(0);
    expect(swingOffsetForStep(1, 0.5, NaN, 16)).toBe(0);
    // Infinity / negative stepDur ebenfalls defensiv
    expect(swingOffsetForStep(1, 0.5, Infinity, 16)).toBe(0);
    expect(swingOffsetForStep(1, 0.5, -0.1, 16)).toBe(0);
    expect(swingOffsetForStep(1, -0.5, 0.1, 16)).toBe(0);
  });

  it("swing > 1 wird geclampt", () => {
    // bei swing=1 wäre offset = 1 * 0.1 * 0.5 = 0.05
    const clamped = swingOffsetForStep(1, 2.5, 0.1, 16);
    expect(clamped).toBeCloseTo(0.05, 9);

    const huge = swingOffsetForStep(1, 999, 0.2, 16);
    // 1 * 0.2 * 0.5 = 0.1
    expect(huge).toBeCloseTo(0.1, 9);
  });

  it("respektiert verschiedene Resolutions (8 / 16 / 32)", () => {
    // odd-index off-beat ist für 8/16/32 gleich strukturiert
    expect(swingOffsetForStep(1, 0.5, 0.1, 8)).toBeCloseTo(0.025, 9);
    expect(swingOffsetForStep(1, 0.5, 0.1, 16)).toBeCloseTo(0.025, 9);
    expect(swingOffsetForStep(1, 0.5, 0.1, 32)).toBeCloseTo(0.025, 9);
    // even index bleibt 0 unabhängig von Resolution
    expect(swingOffsetForStep(2, 0.5, 0.1, 8)).toBe(0);
    expect(swingOffsetForStep(2, 0.5, 0.1, 32)).toBe(0);
  });
});

// ─── buildSwingMap ───────────────────────────────────────────────────────────

describe("buildSwingMap", () => {
  it("leeres Pattern → []", () => {
    expect(buildSwingMap([], 0.5, 0.1, 16)).toEqual([]);
  });

  it("alle straight (swing=0) → alle Steps mit swingDeltaMs=0", () => {
    const pattern = [true, true, true, true];
    const result = buildSwingMap(pattern, 0, 0.125, 16);
    expect(result).toHaveLength(4);
    for (const step of result) {
      expect(step.swingDeltaMs).toBe(0);
    }
    expect(result.map((s) => s.stepIndex)).toEqual([0, 1, 2, 3]);
  });

  it("Pattern [T,T,T,T] + swing=0.5 + stepDur=0.125s → odd indices haben deltaMs > 0", () => {
    const pattern = [true, true, true, true];
    const result = buildSwingMap(pattern, 0.5, 0.125, 16);
    expect(result).toHaveLength(4);

    // even indices 0, 2 → deltaMs = 0
    const idx0 = result.find((s) => s.stepIndex === 0);
    const idx2 = result.find((s) => s.stepIndex === 2);
    expect(idx0?.swingDeltaMs).toBe(0);
    expect(idx2?.swingDeltaMs).toBe(0);

    // odd indices 1, 3 → deltaMs > 0
    // expected: 0.5 * 0.125 * 0.5 * 1000 = 31.25
    const idx1 = result.find((s) => s.stepIndex === 1);
    const idx3 = result.find((s) => s.stepIndex === 3);
    expect(idx1?.swingDeltaMs).toBeCloseTo(31.25, 6);
    expect(idx3?.swingDeltaMs).toBeCloseTo(31.25, 6);
    expect(idx1!.swingDeltaMs).toBeGreaterThan(0);
    expect(idx3!.swingDeltaMs).toBeGreaterThan(0);
  });

  it("nur aktive Steps werden gemapped (false-Steps ignoriert)", () => {
    const pattern = [true, false, true, false, false, true, false, true];
    const result = buildSwingMap(pattern, 0.5, 0.1, 16);
    expect(result.map((s) => s.stepIndex)).toEqual([0, 2, 5, 7]);
    // odd-index 5 + 7 → non-zero delta
    const idx5 = result.find((s) => s.stepIndex === 5);
    const idx7 = result.find((s) => s.stepIndex === 7);
    expect(idx5!.swingDeltaMs).toBeGreaterThan(0);
    expect(idx7!.swingDeltaMs).toBeGreaterThan(0);
    // even-index 0 + 2 → delta = 0
    expect(result.find((s) => s.stepIndex === 0)!.swingDeltaMs).toBe(0);
    expect(result.find((s) => s.stepIndex === 2)!.swingDeltaMs).toBe(0);
  });

  it("buildSwingMap ist defensive gegen invalid stepDuration", () => {
    const pattern = [true, true, true, true];
    expect(buildSwingMap(pattern, 0.5, 0, 16)).toEqual([]);
    expect(buildSwingMap(pattern, 0.5, -1, 16)).toEqual([]);
    expect(buildSwingMap(pattern, 0.5, NaN, 16)).toEqual([]);
  });

  it("buildSwingMap clampt swing > 1 implizit", () => {
    const pattern = [false, true];
    const r1 = buildSwingMap(pattern, 1, 0.1, 16);
    const rHuge = buildSwingMap(pattern, 5, 0.1, 16);
    expect(rHuge[0].swingDeltaMs).toBeCloseTo(r1[0].swingDeltaMs, 6);
    // 1 * 0.1 * 0.5 * 1000 = 50
    expect(rHuge[0].swingDeltaMs).toBeCloseTo(50, 6);
  });

  it("liefert immutable Output (neue Array-Instanz, kein Mutate des Inputs)", () => {
    const pattern = [true, true, false, true];
    const snapshot = [...pattern];
    const result: SwungStep[] = buildSwingMap(pattern, 0.5, 0.1, 16);
    expect(pattern).toEqual(snapshot);
    // Nur aktive Steps
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.stepIndex)).toEqual([0, 1, 3]);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("Swing constants", () => {
  it("SWING_LIGHT/MEDIUM/HEAVY haben aufsteigende Werte", () => {
    expect(SWING_NONE).toBe(0);
    expect(SWING_LIGHT).toBeGreaterThan(SWING_NONE);
    expect(SWING_MEDIUM).toBeGreaterThan(SWING_LIGHT);
    expect(SWING_HEAVY).toBeGreaterThan(SWING_MEDIUM);
    expect(SWING_HEAVY).toBeLessThanOrEqual(1);
  });
});
