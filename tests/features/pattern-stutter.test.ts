/**
 * tests/features/pattern-stutter.test.ts (v3.184)
 *
 * Pure-Coverage für client/src/utils/patternStutter.ts.
 *
 * Sichert Verhalten von applyStutter / applyHalfStutter + STUTTER_PRESETS:
 *  - Edge-Cases (leer, NaN, out-of-range)
 *  - Block-Wiederholungs-Algorithmus
 *  - Immutabilität (neue Arrays, Input unverändert)
 */
import { describe, it, expect } from "vitest";
import {
  applyStutter,
  applyHalfStutter,
  STUTTER_PRESETS,
} from "@/utils/patternStutter";

const T = true;
const F = false;

describe("applyStutter — edge cases", () => {
  it("empty pattern → []", () => {
    expect(applyStutter([])).toEqual([]);
    expect(applyStutter([], { stutterCount: 4 })).toEqual([]);
  });

  it("stutterCount = length → identische Kopie", () => {
    const input = [T, F, T, F, T, F, T, F];
    const result = applyStutter(input, { stutterCount: 8 });
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("stutterCount > length → identische Kopie", () => {
    const input = [T, F, T, F];
    const result = applyStutter(input, { stutterCount: 99 });
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("startIndex >= length → identische Kopie", () => {
    const input = [T, F, T, F, T, F, T, F];
    const result = applyStutter(input, { startIndex: 8, stutterCount: 2 });
    expect(result).toEqual(input);
    expect(result).not.toBe(input);

    const result2 = applyStutter(input, { startIndex: 100, stutterCount: 2 });
    expect(result2).toEqual(input);
  });

  it("startIndex NaN/negative → behandelt wie 0", () => {
    const input = [T, F, F, F, F, F, F, F];
    const fromNaN = applyStutter(input, { startIndex: NaN, stutterCount: 2 });
    const fromNeg = applyStutter(input, { startIndex: -5, stutterCount: 2 });
    const fromZero = applyStutter(input, { startIndex: 0, stutterCount: 2 });
    expect(fromNaN).toEqual(fromZero);
    expect(fromNeg).toEqual(fromZero);
  });

  it("stutterCount NaN → default = floor(length/4)", () => {
    const input = [
      T, F, F, T,
      F, F, F, F,
      F, F, F, F,
      F, F, F, F,
    ];
    const fromNaN = applyStutter(input, { stutterCount: NaN });
    const fromExplicit = applyStutter(input, { stutterCount: 4 });
    expect(fromNaN).toEqual(fromExplicit);
    expect(fromNaN).toEqual([
      T, F, F, T,
      T, F, F, T,
      T, F, F, T,
      T, F, F, T,
    ]);
  });

  it("stutterCount < 1 → default = floor(length/4)", () => {
    const input = [T, F, F, F, F, F, F, F];
    const fromZero = applyStutter(input, { stutterCount: 0 });
    const fromNeg = applyStutter(input, { stutterCount: -3 });
    expect(fromZero).toEqual([T, F, T, F, T, F, T, F]);
    expect(fromNeg).toEqual([T, F, T, F, T, F, T, F]);
  });

  it("default-floor-of-zero (length<4) wird auf 1 gehoben (kein Div-by-zero/NaN)", () => {
    const input = [T, F, T];
    const result = applyStutter(input);
    expect(result).toEqual([T, T, T]);
    expect(result.every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("applyStutter — Block-Wiederholungs-Algorithmus", () => {
  it("stutterCount=1 → alle Steps ab startIndex = pattern[startIndex]", () => {
    const input = [T, F, T, F, T, F, T, F];
    const r0 = applyStutter(input, { startIndex: 0, stutterCount: 1 });
    expect(r0).toEqual([T, T, T, T, T, T, T, T]);

    const r2 = applyStutter(input, { startIndex: 2, stutterCount: 1 });
    expect(r2).toEqual([T, F, T, T, T, T, T, T]);
  });

  it("[T,F,T,F,T,F,T,F] mit count=2, start=0 → Block [T,F] wiederholt", () => {
    const input = [T, F, T, F, T, F, T, F];
    const result = applyStutter(input, { startIndex: 0, stutterCount: 2 });
    expect(result).toEqual([T, F, T, F, T, F, T, F]);
  });

  it("[T,F,F,F,F,F,F,F] mit count=2, start=0 → [T,F,T,F,T,F,T,F]", () => {
    const input = [T, F, F, F, F, F, F, F];
    const result = applyStutter(input, { startIndex: 0, stutterCount: 2 });
    expect(result).toEqual([T, F, T, F, T, F, T, F]);
  });

  it("Pre-stutter region bleibt unverändert (startIndex > 0)", () => {
    const input = [T, T, T, T, T, F, F, T];
    const result = applyStutter(input, { startIndex: 4, stutterCount: 2 });
    expect(result.slice(0, 4)).toEqual([T, T, T, T]);
    expect(result.slice(4)).toEqual([T, F, T, F]);
  });

  it("Block größer als die Reststrecke wird sauber abgeschnitten", () => {
    const input = [F, F, F, F, T, F];
    const result = applyStutter(input, { startIndex: 4, stutterCount: 4 });
    expect(result).toEqual([F, F, F, F, T, F]);
    expect(result.every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("applyStutter — Immutabilität", () => {
  it("Input-Array wird nicht mutiert", () => {
    const input = [T, F, T, F, F, F, F, F];
    const snapshot = input.slice();
    applyStutter(input, { stutterCount: 2 });
    expect(input).toEqual(snapshot);
  });

  it("Identische Kopie hat trotzdem neue Referenz", () => {
    const input = [T, F, T];
    const result = applyStutter(input, { stutterCount: 99 });
    expect(result).not.toBe(input);
    expect(result).toEqual(input);
  });
});

describe("applyHalfStutter", () => {
  it("erste Hälfte unverändert, zweite Hälfte gestuttert", () => {
    const input = [T, T, T, T, F, F, F, F];
    const result = applyHalfStutter(input);
    expect(result.slice(0, 4)).toEqual([T, T, T, T]);
    expect(result.slice(4)).toEqual([F, F, F, F]);
  });

  it("nimmt expliziten stutterCount an", () => {
    const input = [F, F, F, F, T, F, F, F];
    const result = applyHalfStutter(input, 1);
    expect(result).toEqual([F, F, F, F, T, T, T, T]);
  });

  it("length=16 default count = max(2, floor(16/8)) = 2", () => {
    const input = [
      T, T, T, T, T, T, T, T,
      T, F, F, F, F, F, F, F,
    ];
    const result = applyHalfStutter(input);
    expect(result.slice(0, 8)).toEqual([T, T, T, T, T, T, T, T]);
    expect(result.slice(8)).toEqual([T, F, T, F, T, F, T, F]);
  });

  it("empty pattern → []", () => {
    expect(applyHalfStutter([])).toEqual([]);
    expect(applyHalfStutter([], 2)).toEqual([]);
  });
});

describe("STUTTER_PRESETS", () => {
  it("enthält mindestens 4 Einträge", () => {
    expect(STUTTER_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("alle Einträge haben count (number >= 1) und label (non-empty string)", () => {
    for (const preset of STUTTER_PRESETS) {
      expect(typeof preset.count).toBe("number");
      expect(preset.count).toBeGreaterThanOrEqual(1);
      expect(typeof preset.label).toBe("string");
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it("Preset-Counts deckt Roll, 2, 4, 8 ab", () => {
    const counts = STUTTER_PRESETS.map((p) => p.count);
    expect(counts).toEqual(expect.arrayContaining([1, 2, 4, 8]));
  });
});
