/**
 * tests/features/polymeter.test.ts (TASK-CVG-POLYMETER / v2.61)
 *
 * Pure-Coverage für client/src/utils/polymeter.ts (74 LOC).
 *
 * Polymeter-Math wird vom Scheduler pro Step-Trigger ausgewertet. Fehler
 * hier führen zu sichtbaren Timing-Fehlern oder Crash bei negativen
 * Step-Indizes. Diese Suite verifiziert das Modulo-Wrap, Default-Verhalten
 * (kein partStepLength = global) und Persistenz-Boundary-Defensive.
 */
import { describe, it, expect } from "vitest";
import {
  MIN_PART_STEP_LENGTH,
  MAX_PART_STEP_LENGTH,
  clampStepLength,
  effectiveStepIndex,
  isStepWithinPart,
  nextWrapStep,
} from "@/utils/polymeter";

describe("Polymeter – Konstanten", () => {
  it("MIN_PART_STEP_LENGTH ist 1", () => expect(MIN_PART_STEP_LENGTH).toBe(1));
  it("MAX_PART_STEP_LENGTH ist 32 (matches DrumMachine 32-Step Grid)", () => expect(MAX_PART_STEP_LENGTH).toBe(32));
});

describe("Polymeter – clampStepLength", () => {
  it("undefined → undefined (Default-Marker)", () => {
    expect(clampStepLength(undefined)).toBeUndefined();
  });

  it("null → undefined", () => {
    expect(clampStepLength(null)).toBeUndefined();
  });

  it("NaN → undefined (Persistenz-Boundary)", () => {
    expect(clampStepLength(NaN)).toBeUndefined();
  });

  it("Infinity → undefined", () => {
    expect(clampStepLength(Infinity)).toBeUndefined();
  });

  it("0 → undefined (unter MIN)", () => {
    expect(clampStepLength(0)).toBeUndefined();
  });

  it("-5 → undefined (unter MIN)", () => {
    expect(clampStepLength(-5)).toBeUndefined();
  });

  it("4 → 4", () => expect(clampStepLength(4)).toBe(4));
  it("16 → 16", () => expect(clampStepLength(16)).toBe(16));
  it("32 (max) → 32", () => expect(clampStepLength(32)).toBe(32));

  it("33 (über max) → 32 (clamped)", () => {
    expect(clampStepLength(33)).toBe(32);
  });

  it("100 → 32 (clamped)", () => expect(clampStepLength(100)).toBe(32));

  it("fraktional 4.7 → 5 (gerundet)", () => {
    expect(clampStepLength(4.7)).toBe(5);
  });

  it("fraktional 4.3 → 4 (gerundet)", () => {
    expect(clampStepLength(4.3)).toBe(4);
  });

  it("custom max override: clampStepLength(20, 16) → 16", () => {
    expect(clampStepLength(20, 16)).toBe(16);
  });
});

describe("Polymeter – effectiveStepIndex (Modulo-Wrap)", () => {
  it("kein partStepLength → globalStepIndex unverändert", () => {
    expect(effectiveStepIndex(15, undefined)).toBe(15);
  });

  it("partStepLength=0 → globalStepIndex unverändert (Default-Fallback)", () => {
    expect(effectiveStepIndex(7, 0)).toBe(7);
  });

  it("partStepLength=-1 → globalStepIndex unverändert (negativer Wert)", () => {
    expect(effectiveStepIndex(7, -1)).toBe(7);
  });

  it("globalStep=14, partLen=12 → 2 (Modulo)", () => {
    expect(effectiveStepIndex(14, 12)).toBe(2);
  });

  it("globalStep=0, partLen=4 → 0", () => {
    expect(effectiveStepIndex(0, 4)).toBe(0);
  });

  it("globalStep=4, partLen=4 → 0 (Wrap-Punkt)", () => {
    expect(effectiveStepIndex(4, 4)).toBe(0);
  });

  it("globalStep=15, partLen=4 → 3", () => {
    expect(effectiveStepIndex(15, 4)).toBe(3);
  });

  it("Sicherheit: negativer globalStepIndex liefert nicht-negativen Wert", () => {
    // ((-1 % 4) + 4) % 4 = 3
    expect(effectiveStepIndex(-1, 4)).toBe(3);
    expect(effectiveStepIndex(-5, 4)).toBe(3);
  });
});

describe("Polymeter – isStepWithinPart", () => {
  it("kein partStepLength → alle Steps drin", () => {
    expect(isStepWithinPart(0, undefined)).toBe(true);
    expect(isStepWithinPart(31, undefined)).toBe(true);
  });

  it("partStepLength=12, stepIndex=11 → drin (letzter)", () => {
    expect(isStepWithinPart(11, 12)).toBe(true);
  });

  it("partStepLength=12, stepIndex=12 → außerhalb (Off-by-one Guard)", () => {
    expect(isStepWithinPart(12, 12)).toBe(false);
  });

  it("partStepLength=4, stepIndex=15 → außerhalb (16-Step Grid)", () => {
    expect(isStepWithinPart(15, 4)).toBe(false);
  });

  it("partStepLength=0 → alle Steps drin (Default-Fallback)", () => {
    expect(isStepWithinPart(99, 0)).toBe(true);
  });
});

describe("Polymeter – nextWrapStep", () => {
  it("kein partStepLength → null (kein Wrap nötig)", () => {
    expect(nextWrapStep(10, undefined)).toBeNull();
  });

  it("partStepLength=0 → null", () => {
    expect(nextWrapStep(10, 0)).toBeNull();
  });

  it("globalStep=0, partLen=4 → 4 (erstes Wrap am Step 4)", () => {
    expect(nextWrapStep(0, 4)).toBe(4);
  });

  it("globalStep=3, partLen=4 → 4 (nächstes Wrap nach 3)", () => {
    expect(nextWrapStep(3, 4)).toBe(4);
  });

  it("globalStep=4, partLen=4 → 8 (genau am Wrap → liefert NÄCHSTEN Wrap, nicht aktuellen)", () => {
    expect(nextWrapStep(4, 4)).toBe(8);
  });

  it("globalStep=10, partLen=4 → 12", () => {
    expect(nextWrapStep(10, 4)).toBe(12);
  });

  it("globalStep=15, partLen=12 → 24 (zweites Wrap)", () => {
    expect(nextWrapStep(15, 12)).toBe(24);
  });
});
