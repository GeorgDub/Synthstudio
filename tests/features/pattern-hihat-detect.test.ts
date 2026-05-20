/**
 * tests/features/pattern-hihat-detect.test.ts (v3.225)
 *
 * Pure-Coverage for client/src/utils/patternHihatDetect.ts.
 * Inputs must never be mutated; analyzeHihat is deterministic.
 *
 * Pinned Choices (see helper JSDoc):
 *  #1 hatStyle branch order: none -> sparse -> all-16 -> all-8 ->
 *     off-beat -> syncopated (sparse must precede grid checks).
 *  #2 Strict set-equality for grid classifications (NOT majority).
 *  #3 HIHAT_NAME_RE = /hat|hh|ch|oh|hi-?hat|closed.?hat|open.?hat/i
 *  #4 is8thGrid/is16thGrid use exact set-equality.
 *  #5 consistencyScore = clamp(1 - variance(spacings)/max(spacings), 0, 1);
 *     <2 hits -> 0; max(spacings)=0 -> 0.
 *  #6 First matching part wins (analog patternKickSnareDetect v3.223).
 *  #7 Step-length flexibility; canonical sets target 16-step grids.
 *  #8 Pure: no mutate, no Date.now, no Math.random.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeHihat,
  type HihatAnalysis,
  type HihatPartLike,
} from "@/utils/patternHihatDetect";

// ---- Helpers ----

function makePart(name: string, activeIdx: number[], len = 16): HihatPartLike {
  const steps = new Array(len).fill(0).map((_, i) => ({
    active: activeIdx.includes(i),
  }));
  return { name, steps };
}

function snapshot(parts: HihatPartLike[]): string {
  return JSON.stringify(parts);
}

const DEFAULT_NONE: HihatAnalysis = {
  hasHihat: false,
  is8thGrid: false,
  is16thGrid: false,
  hatStyle: "none",
  consistencyScore: 0,
};

// 1) Empty / degenerate --------------------------------------------------

describe("analyzeHihat - empty / degenerate", () => {
  it("empty parts -> none default", () => {
    expect(analyzeHihat([])).toEqual(DEFAULT_NONE);
  });
  it("null cast -> none default", () => {
    expect(analyzeHihat(null as unknown as HihatPartLike[])).toEqual(
      DEFAULT_NONE,
    );
  });
  it("undefined cast -> none default", () => {
    expect(analyzeHihat(undefined as unknown as HihatPartLike[])).toEqual(
      DEFAULT_NONE,
    );
  });
  it("non-array cast -> none default", () => {
    expect(analyzeHihat("nope" as unknown as HihatPartLike[])).toEqual(
      DEFAULT_NONE,
    );
  });
  it("parts with no hihat-named track -> none", () => {
    const parts: HihatPartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("Snare", [4, 12]),
      makePart("Tom", [2, 6, 10, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(false);
    expect(r.hatStyle).toBe("none");
  });
});

// 2) All-16 grid ---------------------------------------------------------

describe("analyzeHihat - all-16 grid", () => {
  it("all 16 steps active -> all-16", () => {
    const parts: HihatPartLike[] = [
      makePart(
        "HiHat",
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      ),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.is16thGrid).toBe(true);
    expect(r.is8thGrid).toBe(false);
    expect(r.hatStyle).toBe("all-16");
  });

  it("all-16 hat + other parts -> still all-16", () => {
    const parts: HihatPartLike[] = [
      makePart("Kick", [0, 8]),
      makePart(
        "Hat",
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      ),
    ];
    expect(analyzeHihat(parts).hatStyle).toBe("all-16");
  });

  it("all-16 consistencyScore equals 1 (uniform spacing)", () => {
    const parts: HihatPartLike[] = [
      makePart(
        "Hat",
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      ),
    ];
    expect(analyzeHihat(parts).consistencyScore).toBe(1);
  });
});

// 3) All-8 grid ----------------------------------------------------------

describe("analyzeHihat - all-8 grid", () => {
  it("exact 8th-grid [0,2,4,6,8,10,12,14] -> all-8", () => {
    const parts: HihatPartLike[] = [
      makePart("Hat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.is8thGrid).toBe(true);
    expect(r.is16thGrid).toBe(false);
    expect(r.hatStyle).toBe("all-8");
  });

  it("8th-grid consistencyScore equals 1", () => {
    const parts: HihatPartLike[] = [
      makePart("Hat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    expect(analyzeHihat(parts).consistencyScore).toBe(1);
  });
});

// 4) Off-beat grid -------------------------------------------------------

describe("analyzeHihat - off-beat grid", () => {
  it("exact off-beat [2,6,10,14] -> off-beat", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [2, 6, 10, 14])];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.is8thGrid).toBe(false);
    expect(r.is16thGrid).toBe(false);
    expect(r.hatStyle).toBe("off-beat");
  });

  it("off-beat consistencyScore equals 1 (uniform spacing of 4)", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [2, 6, 10, 14])];
    expect(analyzeHihat(parts).consistencyScore).toBe(1);
  });
});

// 5) Sparse --------------------------------------------------------------

describe("analyzeHihat - sparse", () => {
  it("single hit -> sparse (Pin #1 sparse precedes grid checks)", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [0])];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("sparse");
  });

  it("two hits -> sparse (< SPARSE_THRESHOLD=3)", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [0, 4])];
    expect(analyzeHihat(parts).hatStyle).toBe("sparse");
  });

  it("zero hits but hat part present -> sparse", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [])];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("sparse");
  });
});

// 6) Case-insensitive name matching --------------------------------------

describe("analyzeHihat - case-insensitive name matching", () => {
  it("HH alias matched", () => {
    const parts: HihatPartLike[] = [
      makePart("HH", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("all-8");
  });

  it("Hi-Hat hyphenated alias matched", () => {
    const parts: HihatPartLike[] = [
      makePart("Hi-Hat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("all-8");
  });

  it("closed_hat alias matched (underscore matches .?)", () => {
    const parts: HihatPartLike[] = [
      makePart("closed_hat", [2, 6, 10, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("off-beat");
  });

  it("uppercase HAT matched", () => {
    const parts: HihatPartLike[] = [makePart("HAT", [0, 4, 8, 12])];
    expect(analyzeHihat(parts).hasHihat).toBe(true);
  });

  it("OH (open hat alias) matched", () => {
    const parts: HihatPartLike[] = [makePart("OH", [2, 6, 10, 14])];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("off-beat");
  });

  it("CH (closed hat alias) matched", () => {
    const parts: HihatPartLike[] = [
      makePart("CH", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("all-8");
  });
});

// 7) Syncopated / irregular ----------------------------------------------

describe("analyzeHihat - syncopated", () => {
  it("irregular pattern not matching canonical grids -> syncopated", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [0, 3, 5, 11])];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.is8thGrid).toBe(false);
    expect(r.is16thGrid).toBe(false);
    expect(r.hatStyle).toBe("syncopated");
  });

  it("near-all-8 with one extra hit -> syncopated (Pin #2 strict)", () => {
    const parts: HihatPartLike[] = [
      makePart("Hat", [0, 1, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.is8thGrid).toBe(false);
    expect(r.hatStyle).toBe("syncopated");
  });

  it("near-off-beat + extra -> syncopated", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [2, 6, 10, 14, 15])];
    expect(analyzeHihat(parts).hatStyle).toBe("syncopated");
  });
});

// 8) Consistency score ---------------------------------------------------

describe("analyzeHihat - consistencyScore", () => {
  it("regular spacing of 4 -> consistencyScore 1", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [0, 4, 8, 12])];
    expect(analyzeHihat(parts).consistencyScore).toBe(1);
  });

  it("irregular spacing -> consistencyScore < 1", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [0, 1, 10, 15])];
    const r = analyzeHihat(parts);
    expect(r.consistencyScore).toBeLessThan(1);
    expect(r.consistencyScore).toBeGreaterThanOrEqual(0);
  });

  it("very irregular -> consistencyScore well below 1", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [0, 1, 14, 15])];
    expect(analyzeHihat(parts).consistencyScore).toBeLessThan(0.5);
  });

  it("single hit -> consistencyScore 0", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [4])];
    expect(analyzeHihat(parts).consistencyScore).toBe(0);
  });

  it("no hits but hat present -> consistencyScore 0", () => {
    const parts: HihatPartLike[] = [makePart("Hat", [])];
    expect(analyzeHihat(parts).consistencyScore).toBe(0);
  });

  it("consistencyScore finite and in [0,1] across various inputs", () => {
    const cases: HihatPartLike[][] = [
      [makePart("Hat", [0, 4, 8, 12])],
      [makePart("Hat", [0, 1, 5, 11, 15])],
      [makePart("Hat", [0, 2, 4, 6, 8, 10, 12, 14])],
      [makePart("Hat", [2, 6, 10, 14])],
    ];
    for (const parts of cases) {
      const r = analyzeHihat(parts);
      expect(Number.isFinite(r.consistencyScore)).toBe(true);
      expect(r.consistencyScore).toBeGreaterThanOrEqual(0);
      expect(r.consistencyScore).toBeLessThanOrEqual(1);
    }
  });
});

// 9) Multi-part filtering ------------------------------------------------

describe("analyzeHihat - multi-part filtering", () => {
  it("hi-hat detected among multiple non-matching parts", () => {
    const parts: HihatPartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("Snare", [4, 12]),
      makePart("Tom", [6, 14]),
      makePart("HiHat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("all-8");
  });

  it("first matching part wins (multiple hihat parts)", () => {
    const parts: HihatPartLike[] = [
      makePart("Hat A", [0, 2, 4, 6, 8, 10, 12, 14]),
      makePart("Hat B", [2, 6, 10, 14]),
    ];
    expect(analyzeHihat(parts).hatStyle).toBe("all-8");
  });
});

// 10) Purity / immutability ----------------------------------------------

describe("analyzeHihat - purity / immutability", () => {
  it("does not mutate input parts", () => {
    const parts: HihatPartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("Hat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const before = snapshot(parts);
    analyzeHihat(parts);
    analyzeHihat(parts);
    expect(snapshot(parts)).toBe(before);
  });

  it("deterministic: two calls yield equal result", () => {
    const parts: HihatPartLike[] = [
      makePart("Hat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    expect(analyzeHihat(parts)).toEqual(analyzeHihat(parts));
  });

  it("returns fresh result object each call", () => {
    expect(analyzeHihat([])).not.toBe(analyzeHihat([]));
  });
});

// 11) Result shape -------------------------------------------------------

describe("analyzeHihat - result shape", () => {
  it("returns exactly 5 keys", () => {
    const r = analyzeHihat([]);
    expect(Object.keys(r).sort()).toEqual([
      "consistencyScore",
      "hasHihat",
      "hatStyle",
      "is16thGrid",
      "is8thGrid",
    ]);
  });

  it("hatStyle is one of allowed labels for any input", () => {
    const allowed = new Set([
      "off-beat",
      "all-16",
      "all-8",
      "syncopated",
      "sparse",
      "none",
    ]);
    const cases: HihatPartLike[][] = [
      [],
      [makePart("Kick", [0])],
      [makePart("Hat", [0])],
      [makePart("Hat", [0, 2, 4, 6, 8, 10, 12, 14])],
      [makePart("Hat", [2, 6, 10, 14])],
      [
        makePart(
          "Hat",
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        ),
      ],
      [makePart("Hat", [0, 3, 5, 11])],
    ];
    for (const parts of cases) {
      expect(allowed.has(analyzeHihat(parts).hatStyle)).toBe(true);
    }
  });
});

// 12) Edge cases ---------------------------------------------------------

describe("analyzeHihat - edge cases", () => {
  it("part with no steps array -> hasHihat true, hatStyle sparse, score 0", () => {
    const parts: HihatPartLike[] = [
      { name: "Hat", steps: undefined as unknown as { active: boolean }[] },
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(true);
    expect(r.hatStyle).toBe("sparse");
    expect(r.consistencyScore).toBe(0);
  });

  it("non-string part name -> skipped, defaults to none", () => {
    const parts: HihatPartLike[] = [
      { name: 123 as unknown as string, steps: [{ active: true }] },
    ];
    const r = analyzeHihat(parts);
    expect(r.hasHihat).toBe(false);
    expect(r.hatStyle).toBe("none");
  });

  it("8-step length all hits -> not is16thGrid/is8thGrid (canonical 16)", () => {
    const parts: HihatPartLike[] = [
      makePart("Hat", [0, 1, 2, 3, 4, 5, 6, 7], 8),
    ];
    const r = analyzeHihat(parts);
    expect(r.is16thGrid).toBe(false);
    expect(r.is8thGrid).toBe(false);
    expect(r.hatStyle).toBe("syncopated");
  });
});
