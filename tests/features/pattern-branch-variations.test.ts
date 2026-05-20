/**
 * tests/features/pattern-branch-variations.test.ts (v3.182)
 *
 * Pure-Coverage für client/src/utils/patternBranchVariations.ts.
 *
 * Verifiziert:
 *   - Empty-source-Handling
 *   - count-Defaults und -Clamping
 *   - Determinismus via baseSeed
 *   - intensity-Gating der Operations
 *   - BRANCH_OPERATION_LABELS-Vollständigkeit
 */
import { describe, it, expect } from "vitest";
import {
  generateBranchVariations,
  BRANCH_OPERATION_LABELS,
  type BranchVariation,
} from "@/utils/patternBranchVariations";

const ALL_FALSE = (n: number): boolean[] => Array(n).fill(false);
const ALL_TRUE = (n: number): boolean[] => Array(n).fill(true);
const SAMPLE_16: boolean[] = [
  true, false, true, false,
  true, false, true, false,
  false, true, false, true,
  false, true, false, true,
];

describe("generateBranchVariations basics", () => {
  it("empty source erzeugt count Variationen mit empty patterns", () => {
    const result = generateBranchVariations([], { count: 4, baseSeed: 1, intensity: 0.5 });
    expect(result).toHaveLength(4);
    for (const v of result) {
      expect(v.pattern).toEqual([]);
    }
  });

  it("count default 4 (kein count uebergeben) erzeugt 4 variations", () => {
    const result = generateBranchVariations(SAMPLE_16, { baseSeed: 1 });
    expect(result).toHaveLength(4);
  });

  it("count=0 erzeugt leeres Array", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 0, baseSeed: 1 });
    expect(result).toEqual([]);
  });

  it("count negativ erzeugt leeres Array", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: -5, baseSeed: 1 });
    expect(result).toEqual([]);
  });

  it("count > 16 wird auf 16 geclamped", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 99, baseSeed: 1 });
    expect(result).toHaveLength(16);
  });

  it("count NaN fallback default 4", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: NaN, baseSeed: 1 });
    expect(result).toHaveLength(4);
  });
});

describe("generateBranchVariations determinism", () => {
  it("gleicher baseSeed erzeugt identical variations", () => {
    const a = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 42, intensity: 0.5 });
    const b = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 42, intensity: 0.5 });
    expect(a).toEqual(b);
  });

  it("unterschiedliche baseSeed liefert unterschiedliche pattern-Bytes", () => {
    const a = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0.5 });
    const b = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 12345, intensity: 0.5 });
    let anyDiff = false;
    for (let v = 0; v < a.length; v++) {
      for (let i = 0; i < a[v].pattern.length; i++) {
        if (a[v].pattern[i] !== b[v].pattern[i]) {
          anyDiff = true;
          break;
        }
      }
      if (anyDiff) break;
    }
    expect(anyDiff).toBe(true);
  });

  it("variation.seed = baseSeed + index * 7", () => {
    const baseSeed = 100;
    const result = generateBranchVariations(SAMPLE_16, { count: 5, baseSeed, intensity: 0.5 });
    for (let i = 0; i < result.length; i++) {
      expect(result[i].seed).toBe(baseSeed + i * 7);
    }
  });

  it("Input bleibt unveraendert (immutability)", () => {
    const input = SAMPLE_16.slice();
    const snapshot = input.slice();
    generateBranchVariations(input, { count: 4, baseSeed: 1, intensity: 0.9 });
    expect(input).toEqual(snapshot);
  });
});

describe("generateBranchVariations intensity gating", () => {
  it("intensity 0 erzeugt minimal changes (nur shift)", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0 });
    for (const v of result) {
      expect(v.operations).toEqual(["shift"]);
    }
  });

  it("intensity 1 erzeugt alle 5 operations", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 1 });
    for (const v of result) {
      expect(v.operations).toEqual(["shift", "decay", "densify", "swap-pairs", "mirror"]);
    }
  });

  it("intensity 0.5 ergibt shift + decay + densify (kein swap-pairs/mirror)", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0.5 });
    for (const v of result) {
      expect(v.operations).toEqual(["shift", "decay", "densify"]);
    }
  });

  it("intensity 0.3 ergibt shift + decay", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0.3 });
    for (const v of result) {
      expect(v.operations).toEqual(["shift", "decay"]);
    }
  });

  it("intensity 0.7 ergibt shift + decay + densify + swap-pairs", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0.7 });
    for (const v of result) {
      expect(v.operations).toEqual(["shift", "decay", "densify", "swap-pairs"]);
    }
  });

  it("intensity NaN fallback 0.3 ergibt shift + decay", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: NaN });
    for (const v of result) {
      expect(v.operations).toEqual(["shift", "decay"]);
    }
  });

  it("intensity unter 0 fallback 0.3", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: -0.5 });
    for (const v of result) {
      expect(v.operations).toEqual(["shift", "decay"]);
    }
  });

  it("intensity ueber 1 fallback 0.3", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 1.5 });
    for (const v of result) {
      expect(v.operations).toEqual(["shift", "decay"]);
    }
  });
});

describe("generateBranchVariations output structure", () => {
  it("variation.pattern length matches source length", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0.9 });
    for (const v of result) {
      expect(v.pattern).toHaveLength(SAMPLE_16.length);
    }
  });

  it("each variation hat non-empty operations array mit mindestens shift", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0 });
    for (const v of result) {
      expect(v.operations.length).toBeGreaterThanOrEqual(1);
      expect(v.operations[0]).toBe("shift");
    }
  });

  it("variation.index ist 0..count-1 in Reihenfolge", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 6, baseSeed: 1, intensity: 0.5 });
    expect(result.map((v: BranchVariation) => v.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("pattern besteht ausschliesslich aus booleans", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 0.9 });
    for (const v of result) {
      for (const b of v.pattern) {
        expect(typeof b).toBe("boolean");
      }
    }
  });

  it("ALL_FALSE source plus intensity 1 erhaelt korrekte Operations und Laenge", () => {
    const result = generateBranchVariations(ALL_FALSE(16), { count: 2, baseSeed: 1, intensity: 1 });
    for (const v of result) {
      expect(v.pattern).toHaveLength(16);
      expect(v.operations).toEqual(["shift", "decay", "densify", "swap-pairs", "mirror"]);
    }
  });

  it("ALL_TRUE source plus intensity 0 erzeugt rotiertes ALL_TRUE (also weiter ALL_TRUE)", () => {
    const result = generateBranchVariations(ALL_TRUE(16), { count: 2, baseSeed: 1, intensity: 0 });
    for (const v of result) {
      expect(v.pattern).toEqual(ALL_TRUE(16));
      expect(v.operations).toEqual(["shift"]);
    }
  });
});

describe("BRANCH_OPERATION_LABELS", () => {
  it("hat genau 5 Eintraege mit non-empty string-Werten", () => {
    const keys = Object.keys(BRANCH_OPERATION_LABELS);
    expect(keys).toHaveLength(5);
    for (const k of keys) {
      const v = BRANCH_OPERATION_LABELS[k];
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("enthaelt alle Operation-IDs: shift, decay, densify, swap-pairs, mirror", () => {
    expect(BRANCH_OPERATION_LABELS).toHaveProperty("shift");
    expect(BRANCH_OPERATION_LABELS).toHaveProperty("decay");
    expect(BRANCH_OPERATION_LABELS).toHaveProperty("densify");
    expect(BRANCH_OPERATION_LABELS).toHaveProperty("swap-pairs");
    expect(BRANCH_OPERATION_LABELS).toHaveProperty("mirror");
  });

  it("Labels matchen erwartete Display-Strings", () => {
    expect(BRANCH_OPERATION_LABELS.shift).toBe("Shift");
    expect(BRANCH_OPERATION_LABELS.decay).toBe("Decay");
    expect(BRANCH_OPERATION_LABELS.densify).toBe("Densify");
    expect(BRANCH_OPERATION_LABELS["swap-pairs"]).toBe("Swap Pairs");
    expect(BRANCH_OPERATION_LABELS.mirror).toBe("Mirror");
  });

  it("Operations aus variation.operations sind alle in LABELS-Map", () => {
    const result = generateBranchVariations(SAMPLE_16, { count: 4, baseSeed: 1, intensity: 1 });
    for (const v of result) {
      for (const op of v.operations) {
        expect(BRANCH_OPERATION_LABELS).toHaveProperty(op);
      }
    }
  });
});
