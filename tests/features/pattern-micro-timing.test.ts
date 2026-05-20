/**
 * tests/features/pattern-micro-timing.test.ts (v3.191)
 *
 * Pure-Coverage fuer client/src/utils/patternMicroTiming.ts.
 */
import { describe, it, expect } from "vitest";
import {
  generateMicroTiming,
  MICRO_TIMING_PRESETS,
  type MicroTimedStep,
  type MicroTimingPreset,
} from "@/utils/patternMicroTiming";

const ALL_TRUE = (n: number): boolean[] => Array(n).fill(true);

const meanOffset = (steps: MicroTimedStep[]): number =>
  steps.length === 0
    ? 0
    : steps.reduce((acc, s) => acc + s.timingOffsetMs, 0) / steps.length;

const maxAbsOffset = (steps: MicroTimedStep[]): number =>
  steps.length === 0
    ? 0
    : Math.max(...steps.map((s) => Math.abs(s.timingOffsetMs)));

describe("generateMicroTiming - Basis", () => {
  it("empty pattern -> []", () => {
    expect(generateMicroTiming([])).toEqual([]);
  });

  it("non-array -> []", () => {
    // @ts-expect-error - defensiver runtime-Check
    expect(generateMicroTiming(null)).toEqual([]);
    // @ts-expect-error - defensiver runtime-Check
    expect(generateMicroTiming(undefined)).toEqual([]);
  });

  it("nur aktive Steps werden gemappt (inactive werden weggelassen)", () => {
    const pattern = [true, false, true, false, false, true, false, true];
    const result = generateMicroTiming(pattern, { preset: "subtle", seed: 1 });
    expect(result).toHaveLength(4);
    expect(result.map((s) => s.stepIndex)).toEqual([0, 2, 5, 7]);
  });

  it("all-false pattern -> []", () => {
    const pattern = [false, false, false, false];
    const result = generateMicroTiming(pattern, { preset: "loose", seed: 1 });
    expect(result).toEqual([]);
  });
});

describe("generateMicroTiming - Preset-Range", () => {
  it("tight preset -> kleinere maximale offsets als loose (statistisch ueber 200 Steps)", () => {
    const pattern = ALL_TRUE(200);
    const tight = generateMicroTiming(pattern, { preset: "tight", seed: 2025 });
    const loose = generateMicroTiming(pattern, { preset: "loose", seed: 2025 });

    expect(maxAbsOffset(tight)).toBeLessThan(maxAbsOffset(loose));
  });

  it("loose preset -> deutlich groessere offsets als tight", () => {
    const pattern = ALL_TRUE(300);
    const tight = generateMicroTiming(pattern, { preset: "tight", seed: 7 });
    const loose = generateMicroTiming(pattern, { preset: "loose", seed: 7 });

    expect(maxAbsOffset(loose)).toBeGreaterThan(maxAbsOffset(tight) * 3);
  });
});

describe("generateMicroTiming - Bias-Effekt", () => {
  it("behind-the-beat -> mean offset > 0 (Steps spaeter)", () => {
    const pattern = ALL_TRUE(200);
    const result = generateMicroTiming(pattern, {
      preset: "behind-the-beat",
      seed: 42,
    });
    expect(meanOffset(result)).toBeGreaterThan(5);
  });

  it("rushed -> mean offset < 0 (Steps frueher)", () => {
    const pattern = ALL_TRUE(200);
    const result = generateMicroTiming(pattern, {
      preset: "rushed",
      seed: 42,
    });
    expect(meanOffset(result)).toBeLessThan(-5);
  });

  it("subtle (bias=0) -> mean offset nahe 0 (statistisch)", () => {
    const pattern = ALL_TRUE(500);
    const result = generateMicroTiming(pattern, { preset: "subtle", seed: 99 });
    expect(Math.abs(meanOffset(result))).toBeLessThan(1.5);
  });
});

describe("generateMicroTiming - Determinismus", () => {
  it("gleicher seed + Input -> identisches Output", () => {
    const pattern = [true, true, false, true, true, false, true, true];
    const a = generateMicroTiming(pattern, { preset: "loose", seed: 12345 });
    const b = generateMicroTiming(pattern, { preset: "loose", seed: 12345 });
    expect(a).toEqual(b);
  });

  it("unterschiedlicher seed -> unterschiedliches Output", () => {
    const pattern = ALL_TRUE(16);
    const a = generateMicroTiming(pattern, { preset: "loose", seed: 1 });
    const b = generateMicroTiming(pattern, { preset: "loose", seed: 999 });
    let differs = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].timingOffsetMs !== b[i].timingOffsetMs) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});

describe("generateMicroTiming - Custom-Overrides", () => {
  it("custom jitterMs ueberschreibt preset.jitterMs", () => {
    const pattern = ALL_TRUE(300);
    const overridden = generateMicroTiming(pattern, {
      preset: "tight",
      jitterMs: 50,
      seed: 1,
    });
    const presetOnly = generateMicroTiming(pattern, { preset: "tight", seed: 1 });

    expect(maxAbsOffset(overridden)).toBeGreaterThan(maxAbsOffset(presetOnly) * 5);
  });

  it("custom biasMs ueberschreibt preset.biasMs", () => {
    const pattern = ALL_TRUE(200);
    const overridden = generateMicroTiming(pattern, {
      preset: "subtle",
      biasMs: 20,
      seed: 1,
    });
    expect(meanOffset(overridden)).toBeGreaterThan(15);
  });

  it("negative custom biasMs ueberschreibt positive preset.biasMs", () => {
    const pattern = ALL_TRUE(200);
    const overridden = generateMicroTiming(pattern, {
      preset: "behind-the-beat",
      biasMs: -10,
      seed: 1,
    });
    expect(meanOffset(overridden)).toBeLessThan(-5);
  });
});

describe("generateMicroTiming - Defensive", () => {
  it("invalid preset -> fallback subtle", () => {
    const pattern = ALL_TRUE(8);
    // @ts-expect-error - bogus preset Test
    const result = generateMicroTiming(pattern, { preset: "bogus", seed: 1 });
    const reference = generateMicroTiming(pattern, { preset: "subtle", seed: 1 });
    expect(result).toEqual(reference);
  });

  it("NaN jitterMs -> fallback preset.jitterMs", () => {
    const pattern = ALL_TRUE(8);
    const result = generateMicroTiming(pattern, {
      preset: "subtle",
      jitterMs: NaN,
      seed: 1,
    });
    const reference = generateMicroTiming(pattern, { preset: "subtle", seed: 1 });
    expect(result).toEqual(reference);
  });

  it("NaN biasMs -> fallback preset.biasMs", () => {
    const pattern = ALL_TRUE(8);
    const result = generateMicroTiming(pattern, {
      preset: "behind-the-beat",
      biasMs: NaN,
      seed: 1,
    });
    const reference = generateMicroTiming(pattern, {
      preset: "behind-the-beat",
      seed: 1,
    });
    expect(result).toEqual(reference);
  });

  it("alle offsets sind finite numbers", () => {
    const pattern = ALL_TRUE(64);
    const result = generateMicroTiming(pattern, { preset: "loose", seed: 13 });
    for (const step of result) {
      expect(Number.isFinite(step.timingOffsetMs)).toBe(true);
    }
  });

  it("seed fehlt -> default 1 -> deterministisch reproduzierbar", () => {
    const pattern = ALL_TRUE(8);
    const a = generateMicroTiming(pattern, { preset: "loose" });
    const b = generateMicroTiming(pattern, { preset: "loose", seed: 1 });
    expect(a).toEqual(b);
  });
});

describe("MICRO_TIMING_PRESETS", () => {
  it("hat 5 Eintraege mit korrekten jitter/bias-Werten", () => {
    const keys = Object.keys(MICRO_TIMING_PRESETS) as MicroTimingPreset[];
    expect(keys).toHaveLength(5);
    expect(keys.sort()).toEqual(
      ["behind-the-beat", "loose", "rushed", "subtle", "tight"],
    );

    expect(MICRO_TIMING_PRESETS.tight).toEqual({ jitterMs: 1, biasMs: 0 });
    expect(MICRO_TIMING_PRESETS.subtle).toEqual({ jitterMs: 4, biasMs: 0 });
    expect(MICRO_TIMING_PRESETS.loose).toEqual({ jitterMs: 12, biasMs: 0 });
    expect(MICRO_TIMING_PRESETS["behind-the-beat"]).toEqual({
      jitterMs: 6,
      biasMs: 8,
    });
    expect(MICRO_TIMING_PRESETS.rushed).toEqual({ jitterMs: 6, biasMs: -8 });
  });
});
