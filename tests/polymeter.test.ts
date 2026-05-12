/**
 * tests/polymeter.test.ts
 *
 * Unit-Tests für die Polymeter / Polyrhythmische-Step-Utilities.
 * Verifiziert: Clamping, modular Step-Index, Wrap-Logik.
 */
import { describe, it, expect } from "vitest";
import {
  MIN_PART_STEP_LENGTH,
  MAX_PART_STEP_LENGTH,
  clampStepLength,
  effectiveStepIndex,
  isStepWithinPart,
  nextWrapStep,
} from "../client/src/utils/polymeter";

describe("clampStepLength", () => {
  it("erlaubt Werte im gültigen Bereich [1, max]", () => {
    expect(clampStepLength(1)).toBe(1);
    expect(clampStepLength(12)).toBe(12);
    expect(clampStepLength(32)).toBe(32);
  });

  it("clampt auf max", () => {
    expect(clampStepLength(50)).toBe(MAX_PART_STEP_LENGTH);
    expect(clampStepLength(100, 16)).toBe(16);
  });

  it("liefert undefined für invalide Werte", () => {
    expect(clampStepLength(undefined)).toBeUndefined();
    expect(clampStepLength(null)).toBeUndefined();
    expect(clampStepLength(0)).toBeUndefined();           // < MIN
    expect(clampStepLength(-5)).toBeUndefined();          // negativ
    expect(clampStepLength(NaN)).toBeUndefined();
    expect(clampStepLength(Infinity)).toBeUndefined();
    expect(clampStepLength(-Infinity)).toBeUndefined();
  });

  it("rundet Fließkommawerte", () => {
    expect(clampStepLength(4.4)).toBe(4);
    expect(clampStepLength(4.6)).toBe(5);
    expect(clampStepLength(0.4)).toBeUndefined();          // < MIN nach rounding
  });

  it("respektiert MIN_PART_STEP_LENGTH", () => {
    expect(MIN_PART_STEP_LENGTH).toBe(1);
    expect(clampStepLength(MIN_PART_STEP_LENGTH)).toBe(MIN_PART_STEP_LENGTH);
  });
});

describe("effectiveStepIndex", () => {
  it("ohne Polymeter (undefined length): identity", () => {
    expect(effectiveStepIndex(0, undefined)).toBe(0);
    expect(effectiveStepIndex(15, undefined)).toBe(15);
    expect(effectiveStepIndex(31, undefined)).toBe(31);
  });

  it("wrappt modular bei eigener Part-Länge", () => {
    expect(effectiveStepIndex(0, 12)).toBe(0);
    expect(effectiveStepIndex(11, 12)).toBe(11);
    expect(effectiveStepIndex(12, 12)).toBe(0);
    expect(effectiveStepIndex(13, 12)).toBe(1);
    expect(effectiveStepIndex(24, 12)).toBe(0);
  });

  it("erzeugt Polymeter-Effekt (Kick 16, Perc 12)", () => {
    // Pattern 0..15, Part-Länge 12: wraps bei 12 zurück
    const lengths = [];
    for (let i = 0; i < 16; i++) lengths.push(effectiveStepIndex(i, 12));
    expect(lengths).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3]);
  });

  it("3er-Polyrhythmus", () => {
    const indices = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => effectiveStepIndex(i, 3));
    expect(indices).toEqual([0, 1, 2, 0, 1, 2, 0, 1]);
  });

  it("Länge=0 oder negativ wird wie undefined behandelt", () => {
    expect(effectiveStepIndex(5, 0)).toBe(5);
    expect(effectiveStepIndex(5, -1)).toBe(5);
  });
});

describe("isStepWithinPart", () => {
  it("undefined length: alle Steps gehören dazu", () => {
    expect(isStepWithinPart(0, undefined)).toBe(true);
    expect(isStepWithinPart(31, undefined)).toBe(true);
  });

  it("Step innerhalb der Länge: true", () => {
    expect(isStepWithinPart(0, 12)).toBe(true);
    expect(isStepWithinPart(11, 12)).toBe(true);
  });

  it("Step außerhalb der Länge: false", () => {
    expect(isStepWithinPart(12, 12)).toBe(false);
    expect(isStepWithinPart(31, 12)).toBe(false);
  });
});

describe("nextWrapStep", () => {
  it("liefert null ohne Polymeter", () => {
    expect(nextWrapStep(5, undefined)).toBe(null);
    expect(nextWrapStep(5, 0)).toBe(null);
  });

  it("liefert nächste Wrap-Position", () => {
    expect(nextWrapStep(0, 4)).toBe(4);
    expect(nextWrapStep(3, 4)).toBe(4);
    expect(nextWrapStep(4, 4)).toBe(8);
    expect(nextWrapStep(10, 12)).toBe(12);
    expect(nextWrapStep(12, 12)).toBe(24);
  });
});
