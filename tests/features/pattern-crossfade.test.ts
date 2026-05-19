/**
 * tests/features/pattern-crossfade.test.ts (v3.123.0)
 *
 * Unit tests for the pure pattern-crossfade helpers + store.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  crossfadeGain,
  getCrossfadeProgress,
  shouldStartCrossfade,
  clampLength,
  sanitizeCurve,
  sanitizeConfig,
  DEFAULT_CONFIG,
  MAX_LENGTH,
  MIN_LENGTH,
} from "@/utils/patternCrossfade";

import {
  getPatternCrossfadeState,
  setEnabled,
  setLength,
  setCurve,
  resetCrossfade,
  __resetPatternCrossfadeStoreForTests,
} from "@/store/usePatternCrossfadeStore";

const EPS = 1e-9;

function closeTo(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe("crossfadeGain — linear curve", () => {
  it("at t=0: gainA=1, gainB=0", () => {
    const g = crossfadeGain(0, "linear");
    expect(g.gainA).toBeCloseTo(1, 9);
    expect(g.gainB).toBeCloseTo(0, 9);
  });

  it("at t=1: gainA=0, gainB=1", () => {
    const g = crossfadeGain(1, "linear");
    expect(g.gainA).toBeCloseTo(0, 9);
    expect(g.gainB).toBeCloseTo(1, 9);
  });

  it("at t=0.5: gainA=0.5, gainB=0.5", () => {
    const g = crossfadeGain(0.5, "linear");
    expect(g.gainA).toBeCloseTo(0.5, 9);
    expect(g.gainB).toBeCloseTo(0.5, 9);
  });

  it("clamps t<0 to 0", () => {
    const g = crossfadeGain(-0.5, "linear");
    expect(g.gainA).toBeCloseTo(1, 9);
    expect(g.gainB).toBeCloseTo(0, 9);
  });

  it("clamps t>1 to 1", () => {
    const g = crossfadeGain(2, "linear");
    expect(g.gainA).toBeCloseTo(0, 9);
    expect(g.gainB).toBeCloseTo(1, 9);
  });

  it("NaN-safe: NaN → t=0", () => {
    const g = crossfadeGain(NaN, "linear");
    expect(g.gainA).toBeCloseTo(1, 9);
    expect(g.gainB).toBeCloseTo(0, 9);
  });
});

describe("crossfadeGain — equalPower curve", () => {
  it("sum-of-squares = 1 at any t", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const g = crossfadeGain(t, "equalPower");
      const sumSq = g.gainA * g.gainA + g.gainB * g.gainB;
      expect(closeTo(sumSq, 1, 1e-9)).toBe(true);
    }
  });

  it("at t=0.5: both gains ≈ 0.7071 (cos(π/4)=sin(π/4))", () => {
    const g = crossfadeGain(0.5, "equalPower");
    expect(g.gainA).toBeCloseTo(Math.SQRT1_2, 6);
    expect(g.gainB).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("at t=0: gainA=1, gainB=0", () => {
    const g = crossfadeGain(0, "equalPower");
    expect(g.gainA).toBeCloseTo(1, 6);
    expect(g.gainB).toBeCloseTo(0, 6);
  });

  it("at t=1: gainA=0, gainB=1", () => {
    const g = crossfadeGain(1, "equalPower");
    expect(g.gainA).toBeCloseTo(0, 6);
    expect(g.gainB).toBeCloseTo(1, 6);
  });
});

describe("crossfadeGain — sine curve (smooth shaping)", () => {
  it("at t=0: gainA=1, gainB=0", () => {
    const g = crossfadeGain(0, "sine");
    expect(g.gainA).toBeCloseTo(1, 9);
    expect(g.gainB).toBeCloseTo(0, 9);
  });

  it("at t=1: gainA=0, gainB=1", () => {
    const g = crossfadeGain(1, "sine");
    expect(g.gainA).toBeCloseTo(0, 9);
    expect(g.gainB).toBeCloseTo(1, 9);
  });

  it("at t=0.5: both gains = 0.25 (softer than linear)", () => {
    const g = crossfadeGain(0.5, "sine");
    expect(g.gainA).toBeCloseTo(0.25, 9);
    expect(g.gainB).toBeCloseTo(0.25, 9);
  });

  it("monotonic: gainA decreases as t increases", () => {
    let prev = 1;
    for (const t of [0.1, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      const g = crossfadeGain(t, "sine");
      expect(g.gainA).toBeLessThanOrEqual(prev + EPS);
      prev = g.gainA;
    }
  });
});

describe("crossfadeGain — invalid curve falls back to linear", () => {
  it("unknown curve string returns linear gain", () => {
    // @ts-expect-error: testing runtime fallback
    const g = crossfadeGain(0.5, "weird");
    expect(g.gainA).toBeCloseTo(0.5, 9);
    expect(g.gainB).toBeCloseTo(0.5, 9);
  });
});

describe("getCrossfadeProgress", () => {
  it("returns null outside window (before)", () => {
    // total=16, fadeLength=4 → window=[12,16). currentStep=11 → null
    expect(getCrossfadeProgress(11, 16, 4)).toBeNull();
    expect(getCrossfadeProgress(0, 16, 4)).toBeNull();
    expect(getCrossfadeProgress(5, 16, 4)).toBeNull();
  });

  it("returns 0 at window start", () => {
    expect(getCrossfadeProgress(12, 16, 4)).toBeCloseTo(0, 9);
  });

  it("returns 0..1 inside window", () => {
    expect(getCrossfadeProgress(13, 16, 4)).toBeCloseTo(0.25, 9);
    expect(getCrossfadeProgress(14, 16, 4)).toBeCloseTo(0.5, 9);
    expect(getCrossfadeProgress(15, 16, 4)).toBeCloseTo(0.75, 9);
    expect(getCrossfadeProgress(16, 16, 4)).toBeCloseTo(1, 9);
  });

  it("returns null when fadeLength=0", () => {
    expect(getCrossfadeProgress(15, 16, 0)).toBeNull();
  });

  it("returns null when totalSteps=0", () => {
    expect(getCrossfadeProgress(0, 0, 4)).toBeNull();
  });

  it("returns null with NaN inputs", () => {
    expect(getCrossfadeProgress(NaN, 16, 4)).toBeNull();
    expect(getCrossfadeProgress(15, NaN, 4)).toBeNull();
    expect(getCrossfadeProgress(15, 16, NaN)).toBeNull();
  });

  it("works with non-default total / fadeLength", () => {
    // total=32, fadeLength=8 → window=[24,32]
    expect(getCrossfadeProgress(23, 32, 8)).toBeNull();
    expect(getCrossfadeProgress(24, 32, 8)).toBeCloseTo(0, 9);
    expect(getCrossfadeProgress(28, 32, 8)).toBeCloseTo(0.5, 9);
    expect(getCrossfadeProgress(32, 32, 8)).toBeCloseTo(1, 9);
  });
});

describe("shouldStartCrossfade", () => {
  it("true at step (N - fadeLength)", () => {
    expect(shouldStartCrossfade(12, 16, 4)).toBe(true);
    expect(shouldStartCrossfade(24, 32, 8)).toBe(true);
    expect(shouldStartCrossfade(15, 16, 1)).toBe(true);
  });

  it("false at other steps", () => {
    expect(shouldStartCrossfade(11, 16, 4)).toBe(false);
    expect(shouldStartCrossfade(13, 16, 4)).toBe(false);
    expect(shouldStartCrossfade(15, 16, 4)).toBe(false);
    expect(shouldStartCrossfade(0, 16, 4)).toBe(false);
  });

  it("false when fadeLength=0", () => {
    expect(shouldStartCrossfade(16, 16, 0)).toBe(false);
  });

  it("false with NaN inputs", () => {
    expect(shouldStartCrossfade(NaN, 16, 4)).toBe(false);
    expect(shouldStartCrossfade(12, NaN, 4)).toBe(false);
    expect(shouldStartCrossfade(12, 16, NaN)).toBe(false);
  });
});

describe("clampLength", () => {
  it("clamps to [0, 16]", () => {
    expect(clampLength(-5)).toBe(MIN_LENGTH);
    expect(clampLength(0)).toBe(0);
    expect(clampLength(8)).toBe(8);
    expect(clampLength(16)).toBe(16);
    expect(clampLength(100)).toBe(MAX_LENGTH);
  });

  it("rounds to int", () => {
    expect(clampLength(3.4)).toBe(3);
    expect(clampLength(3.6)).toBe(4);
  });

  it("non-finite → default lengthSteps", () => {
    expect(clampLength(NaN)).toBe(DEFAULT_CONFIG.lengthSteps);
    expect(clampLength(Infinity)).toBe(DEFAULT_CONFIG.lengthSteps);
  });
});

describe("sanitizeCurve", () => {
  it("returns valid curve", () => {
    expect(sanitizeCurve("linear")).toBe("linear");
    expect(sanitizeCurve("equalPower")).toBe("equalPower");
    expect(sanitizeCurve("sine")).toBe("sine");
  });

  it("invalid curve → 'linear'", () => {
    expect(sanitizeCurve("weird")).toBe("linear");
    expect(sanitizeCurve(null)).toBe("linear");
    expect(sanitizeCurve(undefined)).toBe("linear");
    expect(sanitizeCurve(42)).toBe("linear");
  });
});

describe("sanitizeConfig", () => {
  it("sanitizes garbage input → DEFAULT_CONFIG", () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig(42)).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial input with defaults", () => {
    const out = sanitizeConfig({ enabled: true });
    expect(out.enabled).toBe(true);
    expect(out.lengthSteps).toBe(DEFAULT_CONFIG.lengthSteps);
    expect(out.curve).toBe(DEFAULT_CONFIG.curve);
  });

  it("clamps lengthSteps", () => {
    expect(sanitizeConfig({ lengthSteps: 100 }).lengthSteps).toBe(MAX_LENGTH);
    expect(sanitizeConfig({ lengthSteps: -5 }).lengthSteps).toBe(MIN_LENGTH);
  });

  it("falls back invalid curve to linear", () => {
    expect(sanitizeConfig({ curve: "x" }).curve).toBe("linear");
  });
});

// ─── Store ───────────────────────────────────────────────────────────────────

describe("usePatternCrossfadeStore", () => {
  beforeEach(() => {
    __resetPatternCrossfadeStoreForTests();
  });

  it("initial state = DEFAULT_CONFIG", () => {
    expect(getPatternCrossfadeState()).toEqual(DEFAULT_CONFIG);
  });

  it("setEnabled toggles", () => {
    setEnabled(true);
    expect(getPatternCrossfadeState().enabled).toBe(true);
    setEnabled(false);
    expect(getPatternCrossfadeState().enabled).toBe(false);
  });

  it("setLength clamps to [0,16]", () => {
    setLength(100);
    expect(getPatternCrossfadeState().lengthSteps).toBe(MAX_LENGTH);
    setLength(-1);
    expect(getPatternCrossfadeState().lengthSteps).toBe(MIN_LENGTH);
    setLength(8);
    expect(getPatternCrossfadeState().lengthSteps).toBe(8);
  });

  it("setCurve validates", () => {
    setCurve("equalPower");
    expect(getPatternCrossfadeState().curve).toBe("equalPower");
    setCurve("sine");
    expect(getPatternCrossfadeState().curve).toBe("sine");
    // @ts-expect-error: testing fallback
    setCurve("weird");
    expect(getPatternCrossfadeState().curve).toBe("linear");
  });

  it("resetCrossfade restores DEFAULT_CONFIG", () => {
    setEnabled(true);
    setLength(10);
    setCurve("sine");
    resetCrossfade();
    expect(getPatternCrossfadeState()).toEqual(DEFAULT_CONFIG);
  });

  it("persistence: written values survive a __reset (smoke for localStorage path)", () => {
    setEnabled(true);
    setLength(7);
    setCurve("sine");
    // localStorage is JSDOM-backed in vitest. After reset (which clears LS),
    // state should fall back to DEFAULT_CONFIG.
    __resetPatternCrossfadeStoreForTests();
    expect(getPatternCrossfadeState()).toEqual(DEFAULT_CONFIG);
  });
});
