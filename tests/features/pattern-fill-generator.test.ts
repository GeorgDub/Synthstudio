/**
 * tests/features/pattern-fill-generator.test.ts (v3.167)
 *
 * Pure-Coverage für client/src/utils/patternFillGenerator.ts.
 *
 * Sichert Verhalten von generateFill / generateBuildUp / generateRoll /
 * clearFillRegion + FILL_PRESETS. Determinismus über Seed wird explizit
 * verifiziert, Build-Up-Probability-Ramp statistisch.
 */
import { describe, it, expect } from "vitest";
import {
  generateFill,
  generateBuildUp,
  generateRoll,
  clearFillRegion,
  FILL_PRESETS,
} from "@/utils/patternFillGenerator";

const ALL_FALSE = (n: number): boolean[] => Array(n).fill(false);
const ALL_TRUE = (n: number): boolean[] => Array(n).fill(true);

describe("generateFill", () => {
  it("empty pattern → []", () => {
    expect(generateFill([])).toEqual([]);
  });

  it("density=0 → identische Kopie (additiv, keine neuen Hits)", () => {
    const input = ALL_FALSE(12);
    const result = generateFill(input, { density: 0 });
    expect(result).toEqual(input);
    // Auch wenn Original Hits enthält: keine neuen kommen dazu, Originale bleiben
    const input2 = [true, false, true, false, true, false, false, false, false, false, false, false];
    const result2 = generateFill(input2, { density: 0 });
    expect(result2).toEqual(input2);
    // Distinct array (immutable)
    expect(result2).not.toBe(input2);
  });

  it("density=1 → fill-region komplett aktiv (additiv: mind. so viele Hits wie original + alle neuen)", () => {
    const input = ALL_FALSE(12);
    const result = generateFill(input, { density: 1, fillLength: 4 });
    // fill-region (letzte 4) = alle true
    for (let i = 8; i < 12; i++) {
      expect(result[i]).toBe(true);
    }
    // Pre-fill-region unverändert false
    for (let i = 0; i < 8; i++) {
      expect(result[i]).toBe(false);
    }
  });

  it("determinismus: gleicher seed + input → gleicher output", () => {
    const input = ALL_FALSE(16);
    const a = generateFill(input, { density: 0.5, seed: 42 });
    const b = generateFill(input, { density: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });

  it("unterschiedlicher seed → unterschiedliches output (mind. 1 step weicht ab)", () => {
    const input = ALL_FALSE(32);
    const a = generateFill(input, { density: 0.5, seed: 1, fillLength: 16 });
    const b = generateFill(input, { density: 0.5, seed: 999, fillLength: 16 });
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);
  });

  it("Pre-fill region bleibt 1:1 unverändert (additiv)", () => {
    const input = [true, false, true, false, false, true, false, false, false, false, false, false];
    const result = generateFill(input, { density: 1, fillLength: 4 });
    // erste 8 (length - fillLength = 12 - 4 = 8) bleiben unverändert
    expect(result.slice(0, 8)).toEqual(input.slice(0, 8));
  });

  it("replaceExisting=true entfernt existierende Hits bei density=0", () => {
    const input = ALL_TRUE(12);
    const result = generateFill(input, { density: 0, fillLength: 4, replaceExisting: true });
    // fill-region: alle false
    for (let i = 8; i < 12; i++) {
      expect(result[i]).toBe(false);
    }
    // pre-fill bleibt true
    for (let i = 0; i < 8; i++) {
      expect(result[i]).toBe(true);
    }
  });

  it("defensive: density=NaN nicht crashen, fillLength=NaN → fallback floor(length/3)", () => {
    const input = ALL_FALSE(15);
    expect(() => generateFill(input, { density: NaN })).not.toThrow();
    // Mit fillLength=NaN sollte Fallback floor(15/3)=5 sein
    const r = generateFill(input, { density: 1, fillLength: NaN });
    // letzte 5 sind true (density=1 garantiert)
    for (let i = 10; i < 15; i++) {
      expect(r[i]).toBe(true);
    }
    // Steps 0..9 bleiben false
    for (let i = 0; i < 10; i++) {
      expect(r[i]).toBe(false);
    }
  });

  it("fillLength>length → clamped auf length", () => {
    const input = ALL_FALSE(8);
    const result = generateFill(input, { density: 1, fillLength: 999 });
    // Gesamter Pattern als fill-region
    expect(result).toEqual(ALL_TRUE(8));
  });
});

describe("generateBuildUp", () => {
  it("empty pattern → []", () => {
    expect(generateBuildUp([])).toEqual([]);
  });

  it("Erster Fill-Step hat kleinere Wahrscheinlichkeit als letzter (statistisch über mehrere Seeds)", () => {
    const length = 16;
    const fillLength = 8;
    const fillStart = length - fillLength; // = 8
    let firstCount = 0;
    let lastCount = 0;
    const trials = 100;
    for (let seed = 0; seed < trials; seed++) {
      const result = generateBuildUp(ALL_FALSE(length), {
        density: 0.5,
        fillLength,
        seed,
        replaceExisting: true,
      });
      if (result[fillStart]) firstCount++;
      if (result[length - 1]) lastCount++;
    }
    // Erster Step: prob = 0.5 * 0.5 = 0.25 (~25/100)
    // Letzter Step: prob = 0.5 * 1.5 = 0.75 (~75/100)
    expect(lastCount).toBeGreaterThan(firstCount);
    expect(lastCount).toBeGreaterThan(firstCount * 1.5);
  });

  it("Build-Up liefert immer Array gleicher Länge", () => {
    const input = ALL_FALSE(20);
    const result = generateBuildUp(input, { density: 0.5 });
    expect(result).toHaveLength(20);
  });

  it("Pre-fill region bleibt unverändert", () => {
    const input = [true, true, false, false, false, false, false, false, false, false, false, false];
    const result = generateBuildUp(input, { density: 0.5, fillLength: 4, seed: 7 });
    expect(result.slice(0, 8)).toEqual(input.slice(0, 8));
  });
});

describe("generateRoll", () => {
  it("Roll: alle letzten fillLength Steps sind true", () => {
    const input = ALL_FALSE(16);
    const result = generateRoll(input, { fillLength: 4 });
    for (let i = 12; i < 16; i++) {
      expect(result[i]).toBe(true);
    }
  });

  it("Rest des Patterns bleibt unverändert", () => {
    const input = [true, false, true, false, false, true, false, false, false, false, false, false];
    const result = generateRoll(input, { fillLength: 4 });
    expect(result.slice(0, 8)).toEqual(input.slice(0, 8));
  });

  it("empty pattern → []", () => {
    expect(generateRoll([])).toEqual([]);
  });

  it("default fillLength = floor(length/3)", () => {
    const input = ALL_FALSE(15);
    const result = generateRoll(input);
    // floor(15/3) = 5, letzte 5 sind true
    for (let i = 10; i < 15; i++) {
      expect(result[i]).toBe(true);
    }
    for (let i = 0; i < 10; i++) {
      expect(result[i]).toBe(false);
    }
  });

  it("Immutability: Input bleibt unverändert", () => {
    const input = ALL_FALSE(8);
    const snapshot = input.slice();
    generateRoll(input, { fillLength: 2 });
    expect(input).toEqual(snapshot);
  });
});

describe("clearFillRegion", () => {
  it("Letzte N Steps werden false (auch wenn vorher true)", () => {
    const input = ALL_TRUE(12);
    const result = clearFillRegion(input, 4);
    for (let i = 8; i < 12; i++) {
      expect(result[i]).toBe(false);
    }
    // pre-region bleibt true
    for (let i = 0; i < 8; i++) {
      expect(result[i]).toBe(true);
    }
  });

  it("fillLength=0 → identische Kopie", () => {
    const input = [true, false, true, false, true];
    const result = clearFillRegion(input, 0);
    expect(result).toEqual(input);
    // Aber neues Array
    expect(result).not.toBe(input);
  });

  it("empty pattern → []", () => {
    expect(clearFillRegion([], 4)).toEqual([]);
  });

  it("fillLength>length → clamped: gesamtes Pattern wird false", () => {
    const result = clearFillRegion(ALL_TRUE(6), 999);
    expect(result).toEqual(ALL_FALSE(6));
  });
});

describe("FILL_PRESETS", () => {
  it("hat mind. 4 Einträge mit non-empty id/name/description", () => {
    expect(FILL_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const p of FILL_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.description).toBe("string");
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("enthält Standard-IDs subtle/busy/buildup/roll", () => {
    const ids = FILL_PRESETS.map((p) => p.id);
    expect(ids).toContain("subtle");
    expect(ids).toContain("busy");
    expect(ids).toContain("buildup");
    expect(ids).toContain("roll");
  });
});
