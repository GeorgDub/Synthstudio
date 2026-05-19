/**
 * tests/features/pattern-humanize.test.ts (v3.168)
 *
 * Pure-Coverage fuer client/src/utils/patternHumanize.ts.
 *
 * Verifiziert: leere Patterns, intensity-none/subtle/moderate/heavy,
 * Determinismus per Seed, keepProbability (Drop-Logik), Velocity-Clamping,
 * HUMANIZE_PRESETS-Struktur, Swing-Effekt auf odd-Steps.
 */
import { describe, it, expect } from "vitest";
import {
  humanizePattern,
  HUMANIZE_PRESETS,
  type HumanizedStep,
} from "@/utils/patternHumanize";

const ALL_TRUE = (n: number): boolean[] => Array(n).fill(true);
const ALL_FALSE = (n: number): boolean[] => Array(n).fill(false);

describe("humanizePattern - Basis", () => {
  it("empty pattern -> []", () => {
    expect(humanizePattern([])).toEqual([]);
  });

  it("non-array -> []", () => {
    // @ts-expect-error - defensive runtime check
    expect(humanizePattern(null)).toEqual([]);
    // @ts-expect-error - defensive runtime check
    expect(humanizePattern(undefined)).toEqual([]);
  });

  it("Result-Array hat IMMER pattern.length Eintraege", () => {
    const pattern = [true, false, true, false, true, false, false, true];
    const result = humanizePattern(pattern);
    expect(result).toHaveLength(pattern.length);
    result.forEach((step, i) => {
      expect(step.stepIndex).toBe(i);
    });
  });

  it("intensity none + all-true -> alle Steps active=true, timingOffsetMs=0, velocity=100", () => {
    const pattern = ALL_TRUE(8);
    const result = humanizePattern(pattern, { intensity: "none" });
    expect(result).toHaveLength(8);
    for (const step of result) {
      expect(step.active).toBe(true);
      expect(step.timingOffsetMs).toBe(0);
      expect(step.velocity).toBe(100);
    }
  });

  it("false-Steps bleiben active=false mit velocity=0, timingOffsetMs=0", () => {
    const pattern = ALL_FALSE(16);
    const result = humanizePattern(pattern, { intensity: "heavy" });
    expect(result).toHaveLength(16);
    for (const step of result) {
      expect(step.active).toBe(false);
      expect(step.velocity).toBe(0);
      expect(step.timingOffsetMs).toBe(0);
    }
  });
});

describe("humanizePattern - Velocity-Verhalten", () => {
  it("intensity subtle -> velocity ist nahe 100 (1 sigma ca. velocityJitter/2 = 4)", () => {
    const pattern = ALL_TRUE(64);
    const result = humanizePattern(pattern, { intensity: "subtle", seed: 42 });
    const velocities = result.filter((s) => s.active).map((s) => s.velocity);
    const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    expect(Math.abs(mean - 100)).toBeLessThan(5);
    for (const v of velocities) {
      expect(v).toBeGreaterThanOrEqual(80);
      expect(v).toBeLessThanOrEqual(120);
    }
  });

  it("velocity ist auf [0, 127] geclamped - auch bei extremer Intensity", () => {
    const pattern = ALL_TRUE(200);
    const result = humanizePattern(pattern, { intensity: "heavy", seed: 7 });
    for (const step of result) {
      expect(step.velocity).toBeGreaterThanOrEqual(0);
      expect(step.velocity).toBeLessThanOrEqual(127);
    }
  });
});

describe("humanizePattern - Determinismus", () => {
  it("gleicher seed + Input -> identisches Output (alle Felder match)", () => {
    const pattern = [true, true, false, true, true, false, true, true];
    const a = humanizePattern(pattern, { intensity: "moderate", seed: 12345 });
    const b = humanizePattern(pattern, { intensity: "moderate", seed: 12345 });
    expect(a).toEqual(b);
  });

  it("unterschiedlicher seed -> unterschiedliches Output", () => {
    const pattern = ALL_TRUE(16);
    const a = humanizePattern(pattern, { intensity: "moderate", seed: 1 });
    const b = humanizePattern(pattern, { intensity: "moderate", seed: 999 });
    let differs = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].velocity !== b[i].velocity || a[i].timingOffsetMs !== b[i].timingOffsetMs) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});

describe("humanizePattern - keepProbability", () => {
  it("keepProbability=1 (default) -> alle true-Steps bleiben active=true", () => {
    const pattern = ALL_TRUE(32);
    const result = humanizePattern(pattern, { intensity: "subtle", seed: 1 });
    for (const step of result) {
      expect(step.active).toBe(true);
    }
  });

  it("keepProbability=0 -> alle true-Steps werden active=false mit velocity=0", () => {
    const pattern = ALL_TRUE(16);
    const result = humanizePattern(pattern, {
      intensity: "subtle",
      seed: 1,
      keepProbability: 0,
    });
    expect(result).toHaveLength(16);
    for (const step of result) {
      expect(step.active).toBe(false);
      expect(step.velocity).toBe(0);
      expect(step.timingOffsetMs).toBe(0);
    }
  });

  it("false-Steps bleiben false (auch wenn keepProbability < 1)", () => {
    const pattern = [false, false, false, false, false, false, false, false];
    const result = humanizePattern(pattern, {
      intensity: "moderate",
      seed: 5,
      keepProbability: 0.5,
    });
    expect(result).toHaveLength(8);
    for (const step of result) {
      expect(step.active).toBe(false);
    }
  });

  it("keepProbability=0.5 -> einige active=true, einige active=false (statistisch)", () => {
    const pattern = ALL_TRUE(100);
    const result = humanizePattern(pattern, {
      intensity: "subtle",
      seed: 13,
      keepProbability: 0.5,
    });
    const activeCount = result.filter((s) => s.active).length;
    expect(activeCount).toBeGreaterThan(20);
    expect(activeCount).toBeLessThan(80);
  });
});

describe("HUMANIZE_PRESETS", () => {
  it("hat 4 Eintraege mit korrekten Werten", () => {
    const keys = Object.keys(HUMANIZE_PRESETS);
    expect(keys).toHaveLength(4);
    expect(keys.sort()).toEqual(["heavy", "moderate", "none", "subtle"]);

    expect(HUMANIZE_PRESETS.none).toEqual({
      intensity: "none",
      timingJitterMs: 0,
      velocityJitter: 0,
      swingAmount: 0,
    });
    expect(HUMANIZE_PRESETS.subtle).toEqual({
      intensity: "subtle",
      timingJitterMs: 4,
      velocityJitter: 8,
      swingAmount: 0.05,
    });
    expect(HUMANIZE_PRESETS.moderate).toEqual({
      intensity: "moderate",
      timingJitterMs: 8,
      velocityJitter: 15,
      swingAmount: 0.15,
    });
    expect(HUMANIZE_PRESETS.heavy).toEqual({
      intensity: "heavy",
      timingJitterMs: 18,
      velocityJitter: 28,
      swingAmount: 0.33,
    });
  });
});

describe("humanizePattern - Intensity-Skalierung + Swing", () => {
  it("heavy intensity hat groessere timing-Range als subtle (statistisch ueber 100 Steps)", () => {
    const pattern = ALL_TRUE(100);
    const subtle = humanizePattern(pattern, { intensity: "subtle", seed: 2025 });
    const heavy = humanizePattern(pattern, { intensity: "heavy", seed: 2025 });

    const range = (steps: HumanizedStep[]): number => {
      const offs = steps.filter((s) => s.active).map((s) => s.timingOffsetMs);
      return Math.max(...offs) - Math.min(...offs);
    };

    expect(range(heavy)).toBeGreaterThan(range(subtle));
  });

  it("Swing-Effekt: odd-Steps haben anderen mean-timingOffset als even-Steps (swingAmount > 0)", () => {
    const pattern = ALL_TRUE(64);
    const result = humanizePattern(pattern, {
      intensity: "moderate",
      seed: 99,
      stepDurationSec: 0.125,
    });

    const evenOffs = result.filter((s, i) => s.active && i % 2 === 0).map((s) => s.timingOffsetMs);
    const oddOffs = result.filter((s, i) => s.active && i % 2 === 1).map((s) => s.timingOffsetMs);
    const meanEven = evenOffs.reduce((a, b) => a + b, 0) / evenOffs.length;
    const meanOdd = oddOffs.reduce((a, b) => a + b, 0) / oddOffs.length;

    // Moderate swing = 0.15 -> swingOffsetMs = 0.15 * 0.125 * 1000 * 0.5 = 9.375 ms
    expect(meanOdd - meanEven).toBeGreaterThan(5);
  });

  it("intensity none -> keine swing-Verschiebung trotz odd-Steps", () => {
    const pattern = ALL_TRUE(8);
    const result = humanizePattern(pattern, { intensity: "none" });
    for (const step of result) {
      expect(step.timingOffsetMs).toBe(0);
    }
  });
});

describe("humanizePattern - Defensive", () => {
  it("NaN / negative stepDurationSec -> fallback 0.125", () => {
    const pattern = ALL_TRUE(8);
    const result = humanizePattern(pattern, {
      intensity: "moderate",
      seed: 1,
      stepDurationSec: NaN,
    });
    for (const step of result) {
      expect(Number.isFinite(step.timingOffsetMs)).toBe(true);
      expect(Number.isFinite(step.velocity)).toBe(true);
    }
  });

  it("ungueltige intensity -> fallback subtle", () => {
    const pattern = ALL_TRUE(8);
    // @ts-expect-error - defensiver Test fuer unbekannte intensity-Strings
    const result = humanizePattern(pattern, { intensity: "bogus", seed: 1 });
    const reference = humanizePattern(pattern, { intensity: "subtle", seed: 1 });
    expect(result).toEqual(reference);
  });

  it("seed fehlt -> default 1 -> deterministisch reproduzierbar", () => {
    const pattern = ALL_TRUE(8);
    const a = humanizePattern(pattern, { intensity: "moderate" });
    const b = humanizePattern(pattern, { intensity: "moderate", seed: 1 });
    expect(a).toEqual(b);
  });
});
