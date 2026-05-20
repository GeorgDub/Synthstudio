// @vitest-environment node
/**
 * pattern-morph-interpolate.test.ts v3.181.0
 * Pure-Coverage fuer patternMorphInterpolate.
 */

import { describe, it, expect } from "vitest";
import {
  morphPatterns,
  morphPatternSequence,
  MORPH_STRATEGY_LABELS,
  type MorphStrategy,
} from "../../client/src/utils/patternMorphInterpolate";

// Test-Helpers

const A8: readonly boolean[] = [
  true, false, true, false,
  true, false, true, false,
];
const B8: readonly boolean[] = [
  false, true, false, true,
  false, true, false, true,
];

describe("morphPatterns", () => {
  it("t=0 -> komplett A (kopie, gleiche Werte)", () => {
    const out = morphPatterns(A8, B8, 0);
    expect(out).toEqual([...A8]);
    // sollte eine echte Kopie sein, kein gemeinsames Storage
    expect(out).not.toBe(A8);
  });

  it("t=1 -> komplett B (kopie, gleiche Werte)", () => {
    const out = morphPatterns(A8, B8, 1);
    expect(out).toEqual([...B8]);
    expect(out).not.toBe(B8);
  });

  it("beide empty -> []", () => {
    const out = morphPatterns([], [], 0.5);
    expect(out).toEqual([]);
  });

  it("determinism: gleicher seed -> gleiches Output", () => {
    const opts = { strategy: "probability" as MorphStrategy, seed: 42 };
    const r1 = morphPatterns(A8, B8, 0.5, opts);
    const r2 = morphPatterns(A8, B8, 0.5, opts);
    expect(r1).toEqual(r2);
  });

  it("threshold strategy: t=0.4 -> A, t=0.6 -> B", () => {
    const opts = { strategy: "threshold" as MorphStrategy };
    expect(morphPatterns(A8, B8, 0.4, opts)).toEqual([...A8]);
    expect(morphPatterns(A8, B8, 0.6, opts)).toEqual([...B8]);
  });

  it("probability strategy: unterschiedliche seeds -> unterschiedliche Outputs", () => {
    const a = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
    const b = [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false];
    const r1 = morphPatterns(a, b, 0.5, { strategy: "probability", seed: 1 });
    const r2 = morphPatterns(a, b, 0.5, { strategy: "probability", seed: 9999 });
    // bei t=0.5 sollten die beiden Outputs sich an mindestens einem Step
    // unterscheiden — sonst ist der RNG kaputt.
    expect(r1).not.toEqual(r2);
  });

  it("unterschiedliche Pattern-Laengen: Output-Length = max(a.length, b.length)", () => {
    const a = [true, true];
    const b = [false, false, false, false, false];
    const out = morphPatterns(a, b, 0, { strategy: "threshold" });
    // t=0 -> a padded mit false bis Laenge 5
    expect(out).toEqual([true, true, false, false, false]);
    expect(out.length).toBe(5);
  });

  it("alternate strategy: gerade Index aus A, ungerade aus B (kein swap bei t<=0.5)", () => {
    const a = [true, true, true, true];   // alle true
    const b = [false, false, false, false]; // alle false
    const out = morphPatterns(a, b, 0.3, { strategy: "alternate" });
    expect(out).toEqual([true, false, true, false]); // even=a, odd=b
  });

  it("alternate strategy: swap bei t > 0.5 (gerade=B, ungerade=A)", () => {
    const a = [true, true, true, true];
    const b = [false, false, false, false];
    const out = morphPatterns(a, b, 0.8, { strategy: "alternate" });
    expect(out).toEqual([false, true, false, true]); // even=b, odd=a
  });

  it("additive strategy: a-true-Steps bleiben bei mittlerem t erhalten, B-true-Steps abh. von rng < t", () => {
    const a = [true, false, false, false];
    const b = [false, true, true, true];
    // t = 0.99 (knapp unter 1, also kein early-return zu reinem B) ->
    // additive: a[i] || (rng() < 0.99 && b[i])
    // Step 0: a=true -> true (immer, via short-circuit OR)
    // Step 1-3: a=false; b=true; rng()<0.99 fast immer -> erwartet true
    const out = morphPatterns(a, b, 0.99, { strategy: "additive", seed: 7 });
    expect(out[0]).toBe(true); // a-true bleibt erhalten
    expect(out).toEqual([true, true, true, true]);

    // t = 0 -> early-return: reines A
    const out0 = morphPatterns(a, b, 0, { strategy: "additive", seed: 7 });
    expect(out0).toEqual([true, false, false, false]);

    // t = 1 -> early-return: reines B (per Spec)
    const out1 = morphPatterns(a, b, 1, { strategy: "additive", seed: 7 });
    expect(out1).toEqual([false, true, true, true]);
  });
});

describe("morphPatternSequence", () => {
  it("steps=3 -> 3 patterns [A, mix, B]", () => {
    const seq = morphPatternSequence(A8, B8, 3, { strategy: "threshold" });
    expect(seq.length).toBe(3);
    // t=0
    expect(seq[0]).toEqual([...A8]);
    // t=0.5 (threshold: >=0.5 -> b)
    expect(seq[1]).toEqual([...B8]);
    // t=1
    expect(seq[2]).toEqual([...B8]);
  });

  it("steps=4 -> [A, 33%, 66%, B] mit ersten/letztem als A/B", () => {
    const seq = morphPatternSequence(A8, B8, 4, { strategy: "threshold" });
    expect(seq.length).toBe(4);
    expect(seq[0]).toEqual([...A8]);
    expect(seq[3]).toEqual([...B8]);
  });

  it("steps=0 -> []", () => {
    expect(morphPatternSequence(A8, B8, 0)).toEqual([]);
  });

  it("steps=1 -> [A]", () => {
    const seq = morphPatternSequence(A8, B8, 1);
    expect(seq.length).toBe(1);
    expect(seq[0]).toEqual([...A8]);
  });

  it("steps NaN/negative -> []", () => {
    expect(morphPatternSequence(A8, B8, NaN)).toEqual([]);
    expect(morphPatternSequence(A8, B8, -3)).toEqual([]);
  });
});

describe("MORPH_STRATEGY_LABELS", () => {
  it("alle 4 strategies haben non-empty labels", () => {
    const keys: MorphStrategy[] = ["threshold", "probability", "alternate", "additive"];
    for (const k of keys) {
      expect(typeof MORPH_STRATEGY_LABELS[k]).toBe("string");
      expect(MORPH_STRATEGY_LABELS[k].length).toBeGreaterThan(0);
    }
  });
});

describe("defensive defaults", () => {
  it("t NaN -> 0 (-> A)", () => {
    const out = morphPatterns(A8, B8, NaN);
    expect(out).toEqual([...A8]);
  });

  it("t = -0.5 -> 0 (-> A)", () => {
    const out = morphPatterns(A8, B8, -0.5);
    expect(out).toEqual([...A8]);
  });

  it("t = 2.0 -> 1 (-> B)", () => {
    const out = morphPatterns(A8, B8, 2);
    expect(out).toEqual([...B8]);
  });

  it("invalid strategy -> fallback probability (determinism mit seed)", () => {
    // Cast auf MorphStrategy fuer den Test, obwohl der Wert ungueltig ist.
    const bad = { strategy: "nonsense" as unknown as MorphStrategy, seed: 1 };
    const fallback = { strategy: "probability" as MorphStrategy, seed: 1 };
    const r1 = morphPatterns(A8, B8, 0.5, bad);
    const r2 = morphPatterns(A8, B8, 0.5, fallback);
    expect(r1).toEqual(r2);
  });

  it("seed NaN -> Default-Seed (1), Output deterministisch", () => {
    const r1 = morphPatterns(A8, B8, 0.5, { strategy: "probability", seed: NaN });
    const r2 = morphPatterns(A8, B8, 0.5, { strategy: "probability", seed: 1 });
    expect(r1).toEqual(r2);
  });

  it("a-empty, b non-empty -> Output-Length = b.length, t=1 -> b", () => {
    const out = morphPatterns([], B8, 1, { strategy: "threshold" });
    expect(out).toEqual([...B8]);
  });
});
