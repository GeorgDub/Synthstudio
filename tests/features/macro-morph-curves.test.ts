// @vitest-environment node
/**
 * macro-morph-curves.test.ts — v3.128.0
 * Tests für Curve-Shaping in macroMorph.ts (closes v3.115 caveat).
 */

import { describe, it, expect } from "vitest";
import {
  morphValues,
  shapeMorphCurve,
  sanitizeMorphCurve,
  MORPH_CURVES,
  type MorphCurve,
} from "../../client/src/utils/macroMorph";

describe("v3.128 shapeMorphCurve", () => {
  it("linear: t=0 → 0", () => {
    expect(shapeMorphCurve(0, "linear")).toBe(0);
  });

  it("linear: t=1 → 1", () => {
    expect(shapeMorphCurve(1, "linear")).toBe(1);
  });

  it("linear: t=0.5 → 0.5", () => {
    expect(shapeMorphCurve(0.5, "linear")).toBe(0.5);
  });

  it("exp: t=0 → 0", () => {
    expect(shapeMorphCurve(0, "exp")).toBe(0);
  });

  it("exp: t=1 → 1", () => {
    expect(shapeMorphCurve(1, "exp")).toBe(1);
  });

  it("exp: t=0.5 → 0.25 (slow start)", () => {
    expect(shapeMorphCurve(0.5, "exp")).toBeCloseTo(0.25, 5);
  });

  it("log: t=0 → 0", () => {
    expect(shapeMorphCurve(0, "log")).toBe(0);
  });

  it("log: t=1 → 1", () => {
    expect(shapeMorphCurve(1, "log")).toBe(1);
  });

  it("log: t=0.25 → 0.5 (fast start)", () => {
    expect(shapeMorphCurve(0.25, "log")).toBeCloseTo(0.5, 5);
  });

  it("sigmoid: t=0 → ~0 (normalisiert)", () => {
    expect(shapeMorphCurve(0, "sigmoid")).toBeCloseTo(0, 5);
  });

  it("sigmoid: t=1 → ~1 (normalisiert)", () => {
    expect(shapeMorphCurve(1, "sigmoid")).toBeCloseTo(1, 5);
  });

  it("sigmoid: t=0.5 → 0.5 (S-mittelpunkt)", () => {
    expect(shapeMorphCurve(0.5, "sigmoid")).toBeCloseTo(0.5, 5);
  });

  it("sigmoid: smooth at endpoints (gradient klein bei t=0)", () => {
    const y0 = shapeMorphCurve(0, "sigmoid");
    const y1 = shapeMorphCurve(0.05, "sigmoid");
    // Smooth start: small change between 0 and 0.05
    expect(y1 - y0).toBeLessThan(0.05);
  });

  it("default curve = linear", () => {
    expect(shapeMorphCurve(0.7)).toBe(0.7);
  });

  it("clamps t<0 → 0", () => {
    expect(shapeMorphCurve(-0.5, "linear")).toBe(0);
  });

  it("clamps t>1 → 1", () => {
    expect(shapeMorphCurve(1.5, "linear")).toBe(1);
  });

  it("NaN → 0 (clamp)", () => {
    expect(shapeMorphCurve(NaN, "linear")).toBe(0);
  });
});

describe("v3.128 sanitizeMorphCurve", () => {
  it("valid curve passthrough", () => {
    expect(sanitizeMorphCurve("linear")).toBe("linear");
    expect(sanitizeMorphCurve("exp")).toBe("exp");
    expect(sanitizeMorphCurve("log")).toBe("log");
    expect(sanitizeMorphCurve("sigmoid")).toBe("sigmoid");
  });

  it("invalid string → linear", () => {
    expect(sanitizeMorphCurve("smooth")).toBe("linear");
    expect(sanitizeMorphCurve("")).toBe("linear");
  });

  it("non-string → linear", () => {
    expect(sanitizeMorphCurve(null)).toBe("linear");
    expect(sanitizeMorphCurve(undefined)).toBe("linear");
    expect(sanitizeMorphCurve(123)).toBe("linear");
  });

  it("MORPH_CURVES enum size = 4", () => {
    expect(MORPH_CURVES.length).toBe(4);
  });
});

describe("v3.128 morphValues with curves", () => {
  const A = [0, 0, 0, 0, 0, 0, 0, 0];
  const B = [1, 1, 1, 1, 1, 1, 1, 1];

  it("linear at 0.5 → midpoint", () => {
    const out = morphValues(A, B, 0.5, "linear");
    expect(out.every((v) => v === 0.5)).toBe(true);
  });

  it("exp at 0.5 → quarter (slow start)", () => {
    const out = morphValues(A, B, 0.5, "exp");
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-5)).toBe(true);
  });

  it("log at 0.25 → half (fast start)", () => {
    const out = morphValues(A, B, 0.25, "log");
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-5)).toBe(true);
  });

  it("sigmoid at 0.5 → midpoint", () => {
    const out = morphValues(A, B, 0.5, "sigmoid");
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-3)).toBe(true);
  });

  it("backwards-compat: morphValues without curve defaults linear", () => {
    const out = morphValues(A, B, 0.5);
    expect(out.every((v) => v === 0.5)).toBe(true);
  });

  it("all curves: t=0 → all values = A", () => {
    for (const curve of MORPH_CURVES) {
      const out = morphValues(A, B, 0, curve);
      expect(out).toEqual(A);
    }
  });

  it("all curves: t=1 → all values = B", () => {
    for (const curve of MORPH_CURVES) {
      const out = morphValues(A, B, 1, curve);
      expect(out.every((v) => Math.abs(v - 1) < 1e-4)).toBe(true);
    }
  });
});
