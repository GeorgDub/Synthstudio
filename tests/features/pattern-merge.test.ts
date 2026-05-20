/**
 * tests/features/pattern-merge.test.ts (v3.172.0)
 *
 * Unit tests for the pure pattern-merge helpers.
 */
import { describe, it, expect } from "vitest";

import {
  mergePatterns,
  unionPatterns,
  intersectionPatterns,
  xorPatterns,
  aMinusBPatterns,
  alternatePatterns,
  MERGE_STRATEGY_LABELS,
  type MergeStrategy,
} from "@/utils/patternMerge";

const T = true;
const F = false;

// ─── union ──────────────────────────────────────────────────────────────────

describe("mergePatterns — union", () => {
  it("[T,F,T,F] union [F,T,F,F] = [T,T,T,F]", () => {
    const out = mergePatterns([T, F, T, F], [F, T, F, F], { strategy: "union" });
    expect(out).toEqual([T, T, T, F]);
  });

  it("empty union anything = anything (same length)", () => {
    const out = mergePatterns([], [T, F, T, T], { strategy: "union" });
    expect(out).toEqual([T, F, T, T]);
  });
});

// ─── intersection ───────────────────────────────────────────────────────────

describe("mergePatterns — intersection", () => {
  it("[T,T,F,F] ∩ [T,F,T,F] = [T,F,F,F]", () => {
    const out = mergePatterns([T, T, F, F], [T, F, T, F], {
      strategy: "intersection",
    });
    expect(out).toEqual([T, F, F, F]);
  });

  it("anything ∩ empty = all-false (length = anything's length)", () => {
    const out = mergePatterns([T, T, T, T], [], { strategy: "intersection" });
    expect(out).toEqual([F, F, F, F]);
  });
});

// ─── xor ────────────────────────────────────────────────────────────────────

describe("mergePatterns — xor", () => {
  it("[T,T,F,F] XOR [T,F,T,F] = [F,T,T,F]", () => {
    const out = mergePatterns([T, T, F, F], [T, F, T, F], { strategy: "xor" });
    expect(out).toEqual([F, T, T, F]);
  });

  it("self XOR self = all-false", () => {
    const a = [T, F, T, T, F, F, T, F];
    const out = mergePatterns(a, a, { strategy: "xor" });
    expect(out).toEqual([F, F, F, F, F, F, F, F]);
  });
});

// ─── a-minus-b ──────────────────────────────────────────────────────────────

describe("mergePatterns — a-minus-b", () => {
  it("[T,T,F] minus [F,T,F] = [T,F,F]", () => {
    const out = mergePatterns([T, T, F], [F, T, F], { strategy: "a-minus-b" });
    expect(out).toEqual([T, F, F]);
  });

  it("anything minus empty = anything", () => {
    const a = [T, F, T, T];
    const out = mergePatterns(a, [], { strategy: "a-minus-b" });
    expect(out).toEqual([T, F, T, T]);
  });
});

// ─── alternate ──────────────────────────────────────────────────────────────

describe("mergePatterns — alternate", () => {
  it("[T,T,T,T] alternate [F,F,F,F] = [T,F,T,F]", () => {
    const out = mergePatterns([T, T, T, T], [F, F, F, F], {
      strategy: "alternate",
    });
    expect(out).toEqual([T, F, T, F]);
  });

  it("[F,F,F,F] alternate [T,T,T,T] = [F,T,F,T]", () => {
    const out = mergePatterns([F, F, F, F], [T, T, T, T], {
      strategy: "alternate",
    });
    expect(out).toEqual([F, T, F, T]);
  });
});

// ─── length-handling ────────────────────────────────────────────────────────

describe("mergePatterns — length handling", () => {
  it("respects explicit outputLength regardless of input sizes", () => {
    const out = mergePatterns([T, F], [T, T, T, F, F], {
      strategy: "union",
      outputLength: 3,
    });
    expect(out).toHaveLength(3);
    // i=0: T||T=T, i=1: F||T=T, i=2: F (a oor)||T=T
    expect(out).toEqual([T, T, T]);
  });

  it("padWithLast=true repliziert das letzte Element der kuerzeren Seite", () => {
    // a length=2 (last=true), b length=4. With padWithLast,
    // a[2] and a[3] read as a[1]=true.
    const out = mergePatterns([F, T], [F, F, F, F], {
      strategy: "union",
      padWithLast: true,
    });
    // i=0: F||F=F, i=1: T||F=T, i=2: T(pad)||F=T, i=3: T(pad)||F=T
    expect(out).toEqual([F, T, T, T]);
  });
});

// ─── defaults / defensive ───────────────────────────────────────────────────

describe("mergePatterns — defaults & defensive", () => {
  it("empty + empty → []", () => {
    const out = mergePatterns([], [], { strategy: "union" });
    expect(out).toEqual([]);
  });

  it("invalid strategy falls back to union", () => {
    const out = mergePatterns([T, F, T], [F, T, F], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      strategy: "garbage" as any,
    });
    expect(out).toEqual([T, T, T]);
  });

  it("missing options uses default strategy (union) and max-length", () => {
    const out = mergePatterns([T, F, F], [F, T]);
    // length = max(3,2) = 3; b[2] is missing -> false
    // i=0: T||F=T, i=1: F||T=T, i=2: F||F=F
    expect(out).toEqual([T, T, F]);
  });

  it("default (no padWithLast) reads out-of-range as false", () => {
    const out = mergePatterns([T, T], [F, F, F, F], { strategy: "union" });
    // a[2],a[3] -> false (no pad). i=0: T||F=T, i=1: T||F=T, i=2: F||F=F, i=3: F||F=F
    expect(out).toEqual([T, T, F, F]);
  });
});

// ─── MERGE_STRATEGY_LABELS ──────────────────────────────────────────────────

describe("MERGE_STRATEGY_LABELS", () => {
  it("hat non-empty Labels fuer alle 5 Strategien", () => {
    const keys: MergeStrategy[] = [
      "union",
      "intersection",
      "xor",
      "a-minus-b",
      "alternate",
    ];
    for (const k of keys) {
      const label = MERGE_STRATEGY_LABELS[k];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(MERGE_STRATEGY_LABELS)).toHaveLength(5);
  });
});

// ─── Convenience-Functions ──────────────────────────────────────────────────

describe("Convenience-Functions delegieren an mergePatterns", () => {
  const a = [T, T, F, F];
  const b = [T, F, T, F];

  it("unionPatterns ≡ mergePatterns(strategy: union)", () => {
    expect(unionPatterns(a, b)).toEqual(
      mergePatterns(a, b, { strategy: "union" }),
    );
  });

  it("intersectionPatterns ≡ mergePatterns(strategy: intersection)", () => {
    expect(intersectionPatterns(a, b)).toEqual(
      mergePatterns(a, b, { strategy: "intersection" }),
    );
  });

  it("xorPatterns ≡ mergePatterns(strategy: xor)", () => {
    expect(xorPatterns(a, b)).toEqual(
      mergePatterns(a, b, { strategy: "xor" }),
    );
  });

  it("aMinusBPatterns ≡ mergePatterns(strategy: a-minus-b)", () => {
    expect(aMinusBPatterns(a, b)).toEqual(
      mergePatterns(a, b, { strategy: "a-minus-b" }),
    );
  });

  it("alternatePatterns ≡ mergePatterns(strategy: alternate)", () => {
    expect(alternatePatterns(a, b)).toEqual(
      mergePatterns(a, b, { strategy: "alternate" }),
    );
  });
});
