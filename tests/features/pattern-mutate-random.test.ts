/**
 * tests/features/pattern-mutate-random.test.ts (v3.197)
 *
 * Unit-Tests fuer patternMutateRandom.ts — Random-Mutation-Chain.
 * Verifiziert Public API (randomMutate), Determinismus, intensity-N-Mapping,
 * defensive Sanitizer, source-immutability, op-tracking.
 */
import { describe, it, expect } from "vitest";
import {
  randomMutate,
  type RandomMutateOptions,
  type MutationOp,
} from "../../client/src/utils/patternMutateRandom";

const VALID_OPS: readonly MutationOp[] = [
  "shift",
  "decay",
  "densify",
  "reverse",
  "invert",
  "swap-pairs",
];

const SOURCE_8: readonly boolean[] = [
  true, false, true, false,
  true, false, true, false,
];

const SOURCE_16: readonly boolean[] = [
  true,  false, false, true,
  false, true,  false, false,
  true,  true,  false, false,
  false, false, true,  false,
];

// --- 1. empty source --------------------------------------------------------
describe("randomMutate - empty source", () => {
  it("empty source -> empty pattern + empty operationsApplied", () => {
    const r = randomMutate([]);
    expect(r.pattern).toEqual([]);
    expect(r.operationsApplied).toEqual([]);
  });

  it("empty + options -> empty (no-op vor sanitizer)", () => {
    const r = randomMutate([], { intensity: 1, maxOps: 5, seed: 42 });
    expect(r.pattern).toEqual([]);
    expect(r.operationsApplied).toEqual([]);
  });
});

// --- 2. Determinism via seed ------------------------------------------------
describe("randomMutate - determinism", () => {
  it("gleicher seed -> deep-equal Output", () => {
    const a = randomMutate(SOURCE_16, { seed: 42, intensity: 0.7, maxOps: 4 });
    const b = randomMutate(SOURCE_16, { seed: 42, intensity: 0.7, maxOps: 4 });
    expect(a.pattern).toEqual(b.pattern);
    expect(a.operationsApplied).toEqual(b.operationsApplied);
  });

  it("verschiedene seeds -> mindestens eines abweichend (Pattern oder Ops)", () => {
    const a = randomMutate(SOURCE_16, { seed: 1,    intensity: 1, maxOps: 4 });
    const b = randomMutate(SOURCE_16, { seed: 9999, intensity: 1, maxOps: 4 });
    const sameOps = JSON.stringify(a.operationsApplied) === JSON.stringify(b.operationsApplied);
    const samePattern = JSON.stringify(a.pattern) === JSON.stringify(b.pattern);
    expect(sameOps && samePattern).toBe(false);
  });
});

// --- 3. intensity -> N ops mapping ------------------------------------------
describe("randomMutate - intensity-to-N mapping", () => {
  it("intensity=0 -> mindestens 1 op (minimum)", () => {
    const r = randomMutate(SOURCE_8, { intensity: 0, maxOps: 5, seed: 1 });
    expect(r.operationsApplied.length).toBe(1);
  });

  it("intensity=1 -> max ops (=maxOps)", () => {
    const r = randomMutate(SOURCE_8, { intensity: 1, maxOps: 5, seed: 1 });
    expect(r.operationsApplied.length).toBe(5);
  });

  it("intensity=1 default maxOps -> 3 ops", () => {
    const r = randomMutate(SOURCE_8, { intensity: 1, seed: 1 });
    expect(r.operationsApplied.length).toBe(3);
  });

  it("intensity=0.5 maxOps=4 -> ceil(0.5*4)=2 ops", () => {
    const r = randomMutate(SOURCE_8, { intensity: 0.5, maxOps: 4, seed: 1 });
    expect(r.operationsApplied.length).toBe(2);
  });

  it("intensity > 1 wird auf 1 geclamped -> max ops", () => {
    const r = randomMutate(SOURCE_8, { intensity: 5, maxOps: 3, seed: 1 });
    expect(r.operationsApplied.length).toBe(3);
  });

  it("intensity < 0 wird auf 0 geclamped -> 1 op", () => {
    const r = randomMutate(SOURCE_8, { intensity: -2, maxOps: 4, seed: 1 });
    expect(r.operationsApplied.length).toBe(1);
  });
});

// --- 4. operationsApplied tracking ------------------------------------------
describe("randomMutate - operations tracking", () => {
  it("operationsApplied enthaelt nur valid MutationOp values", () => {
    const r = randomMutate(SOURCE_16, { intensity: 1, maxOps: 8, seed: 7 });
    expect(r.operationsApplied.length).toBe(8);
    for (const op of r.operationsApplied) {
      expect(VALID_OPS).toContain(op);
    }
  });

  it("ueber mehrere Seeds erscheinen alle 6 Ops im Pool (Sanity)", () => {
    const seen = new Set<MutationOp>();
    for (let s = 1; s <= 30; s++) {
      const r = randomMutate(SOURCE_8, { intensity: 1, maxOps: 6, seed: s });
      for (const op of r.operationsApplied) seen.add(op);
    }
    for (const op of VALID_OPS) {
      expect(seen.has(op)).toBe(true);
    }
  });

  it("sequential apply: length bleibt erhalten und ops getrackt", () => {
    const r = randomMutate(SOURCE_8, { intensity: 1, maxOps: 5, seed: 3 });
    expect(r.pattern.length).toBe(SOURCE_8.length);
    expect(r.operationsApplied.length).toBe(5);
  });
});

// --- 5. source immutability -------------------------------------------------
describe("randomMutate - purity", () => {
  it("source wird nicht mutiert", () => {
    const src = [...SOURCE_16];
    const before = JSON.stringify(src);
    randomMutate(src, { intensity: 1, maxOps: 6, seed: 11 });
    expect(JSON.stringify(src)).toBe(before);
  });

  it("readonly-source erlaubt (runtime ok)", () => {
    const r = randomMutate(SOURCE_8 as readonly boolean[], { seed: 1 });
    expect(r.pattern.length).toBe(SOURCE_8.length);
  });
});

// --- 6. Defensive sanitizers -----------------------------------------------
describe("randomMutate - defensive sanitizers", () => {
  it("NaN options -> defaults greifen (kein throw)", () => {
    const opts: RandomMutateOptions = {
      intensity: NaN,
      maxOps: NaN,
      seed: NaN,
    };
    const r = randomMutate(SOURCE_8, opts);
    expect(r.operationsApplied.length).toBe(2);
    expect(r.pattern.length).toBe(SOURCE_8.length);
  });

  it("maxOps NaN -> default 3 (mit intensity=1 -> 3 ops)", () => {
    const r = randomMutate(SOURCE_8, { intensity: 1, maxOps: NaN, seed: 1 });
    expect(r.operationsApplied.length).toBe(3);
  });

  it("maxOps=0 oder negativ -> default 3", () => {
    const r0 = randomMutate(SOURCE_8, { intensity: 1, maxOps: 0, seed: 1 });
    expect(r0.operationsApplied.length).toBe(3);
    const rNeg = randomMutate(SOURCE_8, { intensity: 1, maxOps: -5, seed: 1 });
    expect(rNeg.operationsApplied.length).toBe(3);
  });

  it("intensity Infinity -> non-finite faellt auf default 0.5 (ceil(0.5*4)=2)", () => {
    const r = randomMutate(SOURCE_8, {
      intensity: Number.POSITIVE_INFINITY,
      maxOps: 4,
      seed: 1,
    });
    expect(r.operationsApplied.length).toBe(2);
  });

  it("seed NaN -> default 1 (deterministisch reproduzierbar)", () => {
    const a = randomMutate(SOURCE_8, { intensity: 1, maxOps: 3, seed: NaN });
    const b = randomMutate(SOURCE_8, { intensity: 1, maxOps: 3, seed: 1 });
    expect(a.pattern).toEqual(b.pattern);
    expect(a.operationsApplied).toEqual(b.operationsApplied);
  });

  it("undefined options -> defaults greifen", () => {
    const r = randomMutate(SOURCE_8);
    expect(r.operationsApplied.length).toBe(2);
    expect(r.pattern.length).toBe(SOURCE_8.length);
  });
});

// --- 7. Length preservation -------------------------------------------------
describe("randomMutate - length preservation", () => {
  it("alle Ops sind length-preserving", () => {
    for (let s = 1; s <= 10; s++) {
      const r = randomMutate(SOURCE_16, { intensity: 1, maxOps: 6, seed: s });
      expect(r.pattern.length).toBe(SOURCE_16.length);
    }
  });

  it("single-element source bleibt single-element nach allen Ops", () => {
    const r = randomMutate([true], { intensity: 1, maxOps: 6, seed: 7 });
    expect(r.pattern.length).toBe(1);
    expect(r.operationsApplied.length).toBe(6);
  });
});
