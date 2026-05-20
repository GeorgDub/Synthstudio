/**
 * tests/features/pattern-kick-snare-detect.test.ts (v3.223)
 *
 * Pure-Coverage for client/src/utils/patternKickSnareDetect.ts.
 * Inputs must never be mutated; analyzeKickSnare is deterministic.
 *
 * Pinned Choices (see helper JSDoc):
 *  #1 strongBeats = [0, floor(len/2)]; weakBeats = [floor(len/4), floor(3*len/4)]
 *     (musical-backbeat semantics; spec text contradicts the test example
 *     and was resolved in favor of the example).
 *  #2 length-adaptation rule (same formula for any len)
 *  #3 KICK_NAME_RE = /kick|bd|bass\s*drum/i
 *  #4 SNARE_NAME_RE = /snare|sd|sn/i
 *  #5 ratios use strong.length / weak.length as denominator (0 when empty)
 *  #6 isBackbeat = hasKick && hasSnare && kOnS > 0.5 && sOnW > 0.5
 *  #7 groovePattern branch order: backbeat / kick-heavy / snare-heavy
 *     / broken / sparse / unknown
 *  #8 Pure: no mutate
 */
import { describe, it, expect } from "vitest";
import {
  analyzeKickSnare,
  type KickSnareAnalysis,
  type PartLike,
} from "@/utils/patternKickSnareDetect";

// ---- Helpers ----

function makePart(name: string, activeIdx: number[], len = 16): PartLike {
  const steps = new Array(len).fill(0).map((_, i) => ({
    active: activeIdx.includes(i),
  }));
  return { name, steps };
}

function snapshot(parts: PartLike[]): string {
  return JSON.stringify(parts);
}

const DEFAULT_SPARSE: KickSnareAnalysis = {
  hasKick: false,
  hasSnare: false,
  isBackbeat: false,
  kickOnStrong: 0,
  snareOnWeak: 0,
  groovePattern: "sparse",
};

// 1) Empty / degenerate ---------------------------------------------------

describe("analyzeKickSnare - empty / degenerate", () => {
  it("empty parts -> sparse default", () => {
    const r = analyzeKickSnare([]);
    expect(r).toEqual(DEFAULT_SPARSE);
  });

  it("null cast -> sparse default", () => {
    const r = analyzeKickSnare(null as unknown as PartLike[]);
    expect(r).toEqual(DEFAULT_SPARSE);
  });

  it("undefined cast -> sparse default", () => {
    const r = analyzeKickSnare(undefined as unknown as PartLike[]);
    expect(r).toEqual(DEFAULT_SPARSE);
  });

  it("non-array cast -> sparse default", () => {
    const r = analyzeKickSnare("nope" as unknown as PartLike[]);
    expect(r).toEqual(DEFAULT_SPARSE);
  });

  it("parts with no kick/snare names -> hasKick=hasSnare=false, sparse", () => {
    const parts: PartLike[] = [
      makePart("Hat", [0, 4, 8, 12]),
      makePart("Tom", [2, 6, 10, 14]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(false);
    expect(r.hasSnare).toBe(false);
    expect(r.isBackbeat).toBe(false);
    // 8 hits -> not < 4 -> falls through to "unknown"
    expect(r.groovePattern).toBe("unknown");
  });
});

// 2) Standard backbeat ----------------------------------------------------

describe("analyzeKickSnare - standard backbeat", () => {
  it("kick 0,8 + snare 4,12 -> backbeat", () => {
    const parts: PartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("Snare", [4, 12]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(true);
    expect(r.hasSnare).toBe(true);
    expect(r.isBackbeat).toBe(true);
    expect(r.kickOnStrong).toBe(1);
    expect(r.snareOnWeak).toBe(1);
    expect(r.groovePattern).toBe("backbeat");
  });

  it("kick 0,8 + snare 4,12 + extra hat hits -> still backbeat", () => {
    const parts: PartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("Snare", [4, 12]),
      makePart("Hat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.groovePattern).toBe("backbeat");
  });
});

// 3) Kick-heavy / snare-heavy ---------------------------------------------

describe("analyzeKickSnare - kick-heavy / snare-heavy", () => {
  it("kick on 0,8 only (no snare) -> kick-heavy", () => {
    const parts: PartLike[] = [makePart("Kick", [0, 8])];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(true);
    expect(r.hasSnare).toBe(false);
    expect(r.kickOnStrong).toBe(1);
    expect(r.groovePattern).toBe("kick-heavy");
  });

  it("snare on 4,12 only (no kick) -> snare-heavy", () => {
    const parts: PartLike[] = [makePart("Snare", [4, 12])];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(false);
    expect(r.hasSnare).toBe(true);
    expect(r.snareOnWeak).toBe(1);
    expect(r.groovePattern).toBe("snare-heavy");
  });

  it("kick-only with weak placement -> still classifies via branch order", () => {
    // kick on weak beats only -> kickOnStrong=0, branch falls through
    const parts: PartLike[] = [makePart("Kick", [4, 12])];
    const r = analyzeKickSnare(parts);
    expect(r.kickOnStrong).toBe(0);
    expect(r.hasSnare).toBe(false);
    // hasKick true, hasSnare false, kickOnStrong=0 -> none of backbeat/
    // kick-heavy/snare-heavy/broken; totalHits=2 < 4 -> sparse
    expect(r.groovePattern).toBe("sparse");
  });
});

// 4) Broken placement -----------------------------------------------------

describe("analyzeKickSnare - broken placement", () => {
  it("kick on 2,6 (weak beats) + snare on 0,8 (strong) -> broken", () => {
    const parts: PartLike[] = [
      makePart("Kick", [2, 6]),
      makePart("Snare", [0, 8]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.kickOnStrong).toBe(0);
    expect(r.snareOnWeak).toBe(0);
    expect(r.isBackbeat).toBe(false);
    expect(r.groovePattern).toBe("broken");
  });

  it("partial backbeat (kick 0 only + snare 4 only) -> broken (50% not > 50%)", () => {
    const parts: PartLike[] = [
      makePart("Kick", [0]),
      makePart("Snare", [4]),
    ];
    const r = analyzeKickSnare(parts);
    // kickOnStrong = 1/2 = 0.5, snareOnWeak = 1/2 = 0.5
    // both at 0.5, not strictly > 0.5 -> isBackbeat=false
    expect(r.kickOnStrong).toBe(0.5);
    expect(r.snareOnWeak).toBe(0.5);
    expect(r.isBackbeat).toBe(false);
    expect(r.groovePattern).toBe("broken");
  });
});

// 5) Sparse ---------------------------------------------------------------

describe("analyzeKickSnare - sparse", () => {
  it("few hits, no kick or snare named -> sparse", () => {
    const parts: PartLike[] = [
      makePart("Hat", [0]),
      makePart("Tom", [1]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(false);
    expect(r.hasSnare).toBe(false);
    expect(r.groovePattern).toBe("sparse");
  });

  it("all parts empty -> sparse", () => {
    const parts: PartLike[] = [
      makePart("Hat", []),
      makePart("Tom", []),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.groovePattern).toBe("sparse");
  });
});

// 6) Case-insensitive name matching --------------------------------------

describe("analyzeKickSnare - case-insensitive name matching", () => {
  it("KICK upper-case -> detected", () => {
    const parts: PartLike[] = [makePart("KICK", [0, 8])];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(true);
  });

  it("MixedCase Kick Drum -> detected", () => {
    const parts: PartLike[] = [makePart("Kick Drum", [0, 8])];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(true);
  });

  it("Snare upper-case -> detected", () => {
    const parts: PartLike[] = [makePart("SNARE", [4, 12])];
    const r = analyzeKickSnare(parts);
    expect(r.hasSnare).toBe(true);
  });
});

// 7) Short-name aliases --------------------------------------------------

describe("analyzeKickSnare - short-name aliases", () => {
  it("BD as kick alias -> detected", () => {
    const parts: PartLike[] = [
      makePart("BD", [0, 8]),
      makePart("Snare", [4, 12]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(true);
    expect(r.groovePattern).toBe("backbeat");
  });

  it("SN as snare alias -> detected", () => {
    const parts: PartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("SN", [4, 12]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasSnare).toBe(true);
    expect(r.groovePattern).toBe("backbeat");
  });

  it("SD as snare alias -> detected", () => {
    const parts: PartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("SD", [4, 12]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasSnare).toBe(true);
    expect(r.groovePattern).toBe("backbeat");
  });

  it("Bass Drum (with space) -> detected as kick", () => {
    const parts: PartLike[] = [
      makePart("Bass Drum", [0, 8]),
      makePart("Snare", [4, 12]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(true);
    expect(r.groovePattern).toBe("backbeat");
  });
});

// 8) 8-step adaptation ---------------------------------------------------

describe("analyzeKickSnare - 8-step adaptation (Pin #2)", () => {
  it("8-step kick on 0,4 + snare on 2,6 -> backbeat", () => {
    // len=8 -> strong=[0,4], weak=[2,6]
    const parts: PartLike[] = [
      makePart("Kick", [0, 4], 8),
      makePart("Snare", [2, 6], 8),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.kickOnStrong).toBe(1);
    expect(r.snareOnWeak).toBe(1);
    expect(r.isBackbeat).toBe(true);
    expect(r.groovePattern).toBe("backbeat");
  });

  it("8-step with hits on wrong slots -> broken", () => {
    const parts: PartLike[] = [
      makePart("Kick", [2, 6], 8),
      makePart("Snare", [0, 4], 8),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.kickOnStrong).toBe(0);
    expect(r.snareOnWeak).toBe(0);
    expect(r.groovePattern).toBe("broken");
  });
});

// 9) Purity / immutability -----------------------------------------------

describe("analyzeKickSnare - purity / immutability", () => {
  it("does not mutate input parts", () => {
    const parts: PartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("Snare", [4, 12]),
    ];
    const before = snapshot(parts);
    analyzeKickSnare(parts);
    analyzeKickSnare(parts);
    expect(snapshot(parts)).toBe(before);
  });

  it("deterministic: two calls yield equal result", () => {
    const parts: PartLike[] = [
      makePart("Kick", [0, 8]),
      makePart("Snare", [4, 12]),
    ];
    const a = analyzeKickSnare(parts);
    const b = analyzeKickSnare(parts);
    expect(a).toEqual(b);
  });

  it("returns fresh result object each call", () => {
    const a = analyzeKickSnare([]);
    const b = analyzeKickSnare([]);
    expect(a).not.toBe(b);
  });
});

// 10) Result shape -------------------------------------------------------

describe("analyzeKickSnare - result shape", () => {
  it("returns exactly 6 keys", () => {
    const r = analyzeKickSnare([]);
    expect(Object.keys(r).sort()).toEqual([
      "groovePattern",
      "hasKick",
      "hasSnare",
      "isBackbeat",
      "kickOnStrong",
      "snareOnWeak",
    ]);
  });

  it("kickOnStrong / snareOnWeak in [0, 1] across arbitrary input", () => {
    const cases: PartLike[][] = [
      [],
      [makePart("Kick", [0, 8]), makePart("Snare", [4, 12])],
      [makePart("Kick", [0, 2, 4, 6, 8, 10, 12, 14])],
      [makePart("Snare", [0, 2, 4, 6, 8, 10, 12, 14])],
    ];
    for (const parts of cases) {
      const r = analyzeKickSnare(parts);
      expect(r.kickOnStrong).toBeGreaterThanOrEqual(0);
      expect(r.kickOnStrong).toBeLessThanOrEqual(1);
      expect(r.snareOnWeak).toBeGreaterThanOrEqual(0);
      expect(r.snareOnWeak).toBeLessThanOrEqual(1);
    }
  });
});

// 11) Edge cases ---------------------------------------------------------

describe("analyzeKickSnare - edge cases", () => {
  it("first matching part wins (multiple kicks defined)", () => {
    const parts: PartLike[] = [
      makePart("Kick A", [0, 8]),
      makePart("Kick B", []),
      makePart("Snare", [4, 12]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.kickOnStrong).toBe(1);
  });

  it("part with empty steps array is ignored for hit counting", () => {
    const parts: PartLike[] = [
      makePart("Kick", [], 16),
      makePart("Snare", [4, 12]),
    ];
    const r = analyzeKickSnare(parts);
    expect(r.hasKick).toBe(true);
    expect(r.kickOnStrong).toBe(0);
    // hasKick && hasSnare && !isBackbeat -> broken
    expect(r.groovePattern).toBe("broken");
  });

  it("snare on too few weak beats -> not snare-heavy", () => {
    // 1 snare hit at weak beat -> snareOnWeak = 1/2 = 0.5, not > 0.5
    const parts: PartLike[] = [makePart("Snare", [4])];
    const r = analyzeKickSnare(parts);
    expect(r.snareOnWeak).toBe(0.5);
    expect(r.hasKick).toBe(false);
    expect(r.hasSnare).toBe(true);
    // Falls through to sparse (totalHits=1 < 4)
    expect(r.groovePattern).toBe("sparse");
  });
});
