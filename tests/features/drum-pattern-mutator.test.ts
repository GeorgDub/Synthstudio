/**
 * tests/features/drum-pattern-mutator.test.ts (v3.164)
 *
 * Pure-Coverage für client/src/utils/drumPatternMutator.ts.
 * Alle Mutationen müssen NEUE Arrays liefern und den Input unverändert
 * lassen.
 */
import { describe, it, expect } from "vitest";
import {
  shiftPattern,
  doubleTimePattern,
  halfTimePattern,
  invertPattern,
  reversePattern,
  mirrorPattern,
} from "@/utils/drumPatternMutator";

// ─── shiftPattern ────────────────────────────────────────────────────────────

describe("shiftPattern", () => {
  it("shift=0 → identische Werte, aber NEUES Array (kein same-reference)", () => {
    const input = [true, false, true, false];
    const out = shiftPattern(input, 0);
    expect(out).toEqual([true, false, true, false]);
    expect(out).not.toBe(input); // different reference
  });

  it("shift=1 → letztes Element wandert nach vorne", () => {
    const input = [true, false, false, false];
    const out = shiftPattern(input, 1);
    expect(out).toEqual([false, true, false, false]);
  });

  it("shift=-1 → erstes Element wandert nach hinten", () => {
    const input = [true, false, false, false];
    const out = shiftPattern(input, -1);
    expect(out).toEqual([false, false, false, true]);
  });

  it("shift > length → wraps modulo length", () => {
    const input = [true, false, false, false];
    // length=4, shift=5 ≡ shift=1
    const out = shiftPattern(input, 5);
    expect(out).toEqual([false, true, false, false]);
  });

  it("empty input → []", () => {
    expect(shiftPattern([], 3)).toEqual([]);
  });
});

// ─── doubleTimePattern ───────────────────────────────────────────────────────

describe("doubleTimePattern", () => {
  it("[T,F,T,F] → [T,T,F,F] (stretch-pair erste Hälfte)", () => {
    const out = doubleTimePattern([true, false, true, false]);
    expect(out).toEqual([true, true, false, false]);
  });

  it("empty → []", () => {
    expect(doubleTimePattern([])).toEqual([]);
  });

  it("single [T] → [T] (length=1, no pairing)", () => {
    expect(doubleTimePattern([true])).toEqual([true]);
  });
});

// ─── halfTimePattern ─────────────────────────────────────────────────────────

describe("halfTimePattern", () => {
  it("[T,F,T,F,T,F] → [T,T,T] (every 2nd step)", () => {
    const out = halfTimePattern([true, false, true, false, true, false]);
    expect(out).toEqual([true, true, true]);
  });

  it("odd length [T,F,T,F,T] → [T,T] (floor n/2)", () => {
    const out = halfTimePattern([true, false, true, false, true]);
    expect(out).toEqual([true, true]);
  });

  it("empty → []", () => {
    expect(halfTimePattern([])).toEqual([]);
  });
});

// ─── invertPattern ───────────────────────────────────────────────────────────

describe("invertPattern", () => {
  it("[T,F,T,F] → [F,T,F,T]", () => {
    expect(invertPattern([true, false, true, false])).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("empty → []", () => {
    expect(invertPattern([])).toEqual([]);
  });
});

// ─── reversePattern ──────────────────────────────────────────────────────────

describe("reversePattern", () => {
  it("[T,F,F,F] → [F,F,F,T]", () => {
    expect(reversePattern([true, false, false, false])).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("palindrome [T,F,F,T] → [T,F,F,T] (unverändert)", () => {
    expect(reversePattern([true, false, false, true])).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });
});

// ─── mirrorPattern ───────────────────────────────────────────────────────────

describe("mirrorPattern", () => {
  it("[T,F] → [T,F,F,T] (doubles length)", () => {
    expect(mirrorPattern([true, false])).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it("single [T] → [T,T]", () => {
    expect(mirrorPattern([true])).toEqual([true, true]);
  });

  it("empty → []", () => {
    expect(mirrorPattern([])).toEqual([]);
  });
});

// ─── Immutability ────────────────────────────────────────────────────────────

describe("immutability", () => {
  it("shiftPattern: Input bleibt unverändert, Output ist neues Array", () => {
    const input = [true, false, true, false];
    const snapshot = [...input];
    const out = shiftPattern(input, 2);
    expect(input).toEqual(snapshot); // input untouched
    expect(out).not.toBe(input); // distinct reference
  });
});
