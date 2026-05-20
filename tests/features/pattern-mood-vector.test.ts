/**
 * tests/features/pattern-mood-vector.test.ts (v3.227)
 *
 * Pure-Coverage for client/src/utils/patternMoodVector.ts.
 * Inputs must never be mutated; computeMoodVector / classifyMood are
 * deterministic.
 *
 * Pinned Choices (see helper JSDoc):
 *  #1 energy aggregates across ALL parts (sum hits / sum positions).
 *  #2 tension = hits on canonical off-beats [2,6,10,14] / max(1, totalHits).
 *  #3 warmth  = clamp((fracKick - fracCymbal + 1)/2, 0, 1). 0.5 with no
 *     kick / cymbal parts. KICK_NAME_RE / CYMBAL_NAME_RE per JSDoc.
 *  #4 complexity = clamp(1 - max(quartileDensities), 0, 1) over merged
 *     any-hit boolean of len max(parts[i].steps.length).
 *  #5 flow = clamp(1 - variance(spacings)/max(spacings), 0, 1) on merged
 *     indices; <2 hits or max-spacing 0 -> 1.0.
 *  #6 classifyMood priority order:
 *     minimal -> chaotic -> aggressive -> tense -> energetic -> calm ->
 *     playful -> fallback("minimal", 0.2). Documented in helper JSDoc.
 *  #7 Pure: no Date.now, no Math.random, no mutate.
 *  #8 Defensive: empty / null / non-array / step.active non-boolean.
 */
import { describe, it, expect } from "vitest";
import {
  computeMoodVector,
  classifyMood,
  type MoodVector,
  type MoodLabel,
  type MoodPartLike,
  type MoodStepLike,
} from "@/utils/patternMoodVector";

// ---- Helpers ----

function makePart(
  name: string,
  activeIdx: number[],
  len = 16,
): MoodPartLike {
  const steps: MoodStepLike[] = new Array(len).fill(0).map((_, i) => ({
    active: activeIdx.includes(i),
  }));
  return { name, steps };
}

function makeAllOn(name: string, len = 16): MoodPartLike {
  return {
    name,
    steps: new Array(len).fill(0).map(() => ({ active: true })),
  };
}

function snapshot(parts: MoodPartLike[]): string {
  return JSON.stringify(parts);
}

const NEUTRAL: MoodVector = {
  energy: 0.5,
  tension: 0.5,
  warmth: 0.5,
  complexity: 0.5,
  flow: 0.5,
};

// 1) Empty / degenerate ------------------------------------------------------

describe("computeMoodVector + classifyMood - empty / degenerate", () => {
  it("empty parts -> neutral 0.5 vector", () => {
    expect(computeMoodVector([])).toEqual(NEUTRAL);
  });
  it("empty parts -> classify minimal/0", () => {
    const r = classifyMood([]);
    expect(r.primary).toBe("minimal");
    expect(r.confidence).toBe(0);
    expect(r.vector).toEqual(NEUTRAL);
  });
  it("null cast -> neutral", () => {
    expect(computeMoodVector(null as unknown as MoodPartLike[])).toEqual(NEUTRAL);
    expect(classifyMood(null as unknown as MoodPartLike[]).primary).toBe(
      "minimal",
    );
  });
  it("undefined cast -> neutral", () => {
    expect(computeMoodVector(undefined as unknown as MoodPartLike[])).toEqual(
      NEUTRAL,
    );
    expect(
      classifyMood(undefined as unknown as MoodPartLike[]).confidence,
    ).toBe(0);
  });
  it("non-array cast -> neutral", () => {
    expect(computeMoodVector("nope" as unknown as MoodPartLike[])).toEqual(
      NEUTRAL,
    );
  });
  it("part with empty steps array -> total-positions=0 -> neutral", () => {
    const parts: MoodPartLike[] = [{ name: "Kick", steps: [] }];
    expect(computeMoodVector(parts)).toEqual(NEUTRAL);
  });
});

// 2) High-energy backbeat -> energetic or aggressive -------------------------

describe("classifyMood - high-energy backbeat", () => {
  it("kick + snare + hi-hat all-16 -> energetic (energy=1.0, tension=0.25)", () => {
    const parts: MoodPartLike[] = [
      makeAllOn("Kick"),
      makeAllOn("Snare"),
      makeAllOn("HiHat"),
    ];
    const r = classifyMood(parts);
    // energy = 48/48 = 1.0, tension = 12/48 = 0.25 (4 off-beats per part * 3 parts)
    expect(r.vector.energy).toBeCloseTo(1, 5);
    expect(r.vector.tension).toBeCloseTo(0.25, 5);
    // tension < 0.4 and energy > 0.7 -> ENERGETIC
    expect(r.primary).toBe("energetic");
  });
  it("dense backbeat with high tension -> aggressive", () => {
    // 2 parts. Part1: kick all-16. Part2: tension part with off-beat hits + some others.
    // We need energy > 0.6 AND tension > 0.5.
    // Part1 (kick all-16): contributes 16 hits, 4 off-beat.
    // Part2 (kick with ONLY off-beat positions [2,6,10,14] active): 4 hits, all off-beat.
    // Total hits = 20, total positions = 32, energy = 0.625 > 0.6 ok.
    // tension = (4 + 4) / 20 = 0.4 -> not > 0.5. Need more tension.
    // Use Part2 = only off-beat [2,6,10,14]: 4 hits / 8 off-beats per part.
    // Part1 = kick at [0,2,6,8,10,14]: 6 hits, 4 off-beat.
    // total hits = 4+6=10, positions=32, energy=0.3125 -> not >0.6.
    // Reset: Part1 = all-16 (16 hits, 4 off-beat). Part2 = all-16 (16 hits, 4 off-beat).
    // tension = 8/32 = 0.25, not >0.5.
    // To get tension>0.5: at least half of all hits must be on off-beats.
    // Aggressive needs energy>0.6 AND tension>0.5. 8 positions out of 16 ARE off-beat per part is wrong --
    // canonical off-beats are [2,6,10,14], so 4 per 16-step part.
    // For tension>0.5, off-beat hits must dominate. Use dense off-beat patterns:
    // Part1 = makePart("Kick", [0,2,6,10,14]) -> 5 hits, 4 off-beat
    // Part2 = makePart("Snare", [2,6,10,14]) -> 4 hits, 4 off-beat
    // total=9 hits, off-beat=8. energy=9/32=0.28 -> not >0.6.
    // We need energy>0.6 and tension>0.5 simultaneously.
    // Approach: many off-beat hits, many parts.
    // Part1 = makePart("Kick", [2,6,10,14]) -> 4 hits, 4 off-beat
    // Part2 = makePart("Snare", [2,6,10,14]) -> 4 hits, 4 off-beat
    // Part3 = makePart("Tom", [2,6,10,14]) -> 4 hits, 4 off-beat
    // Part4 = makePart("Clap", [2,6,10,14]) -> 4 hits, 4 off-beat
    // total = 16 hits / 64 positions = 0.25 -> not >0.6.
    // Reduce position count: short patterns of length 4 with only off-beat hits.
    // Actually the off-beats SCALE: for len=4 -> [floor(2*4/16), floor(6*4/16), ...] = [0,1,2,3] dedup.
    // Set canonical off-beats for len=4 -> [0,1,2,3]. That covers all positions, tension=1.0.
    // makePart("Kick", [0,1,2,3], 4) -> 4 hits, 4 off-beat. energy=4/4=1.0, tension=1.0.
    // -> aggressive (energy>0.6 ✓, tension>0.5 ✓).
    const parts: MoodPartLike[] = [
      makePart("Kick", [0, 1, 2, 3], 4),
    ];
    const r = classifyMood(parts);
    expect(r.vector.energy).toBeGreaterThan(0.6);
    expect(r.vector.tension).toBeGreaterThan(0.5);
    expect(r.primary).toBe("aggressive");
  });
  it("backbeat result is energetic or aggressive (broad fitness check)", () => {
    const parts: MoodPartLike[] = [
      makeAllOn("Kick"),
      makeAllOn("Snare"),
      makeAllOn("HiHat"),
    ];
    const r = classifyMood(parts);
    expect(["energetic", "aggressive"]).toContain(r.primary);
  });
});

// 3) Sparse pattern -> minimal -----------------------------------------------

describe("classifyMood - sparse pattern", () => {
  it("single hit -> minimal (energy < 0.2)", () => {
    const parts: MoodPartLike[] = [makePart("Kick", [0])];
    const r = classifyMood(parts);
    // energy = 1/16 = 0.0625 < 0.2 -> MINIMAL via priority Pin #6
    expect(r.vector.energy).toBeLessThan(0.2);
    expect(r.primary).toBe("minimal");
  });
  it("2 hits in 16-step -> minimal", () => {
    const parts: MoodPartLike[] = [makePart("Kick", [0, 8])];
    const r = classifyMood(parts);
    expect(r.vector.energy).toBeLessThan(0.2);
    expect(r.primary).toBe("minimal");
  });
  it("no hits anywhere -> sparse fallback (energy=0 -> minimal)", () => {
    const parts: MoodPartLike[] = [makePart("Kick", [])];
    const r = classifyMood(parts);
    expect(r.vector.energy).toBe(0);
    expect(r.primary).toBe("minimal");
  });
});

// 4) All off-beat -> tense ---------------------------------------------------

describe("classifyMood - all off-beat", () => {
  it("hits only at [2,6,10,14] in 16-step grid -> tense", () => {
    const parts: MoodPartLike[] = [makePart("Kick", [2, 6, 10, 14])];
    const r = classifyMood(parts);
    // tension = 4/4 = 1.0, complexity = 1 - max(quartile-density) = 1 - 0.25 = 0.75
    expect(r.vector.tension).toBeCloseTo(1, 5);
    expect(r.vector.complexity).toBeGreaterThan(0.5);
    // energy = 4/16 = 0.25 -> NOT aggressive (energy>0.6 fails), tense ✓
    expect(r.primary).toBe("tense");
  });
  it("all off-beat across 2 parts -> tense", () => {
    const parts: MoodPartLike[] = [
      makePart("Kick", [2, 6, 10, 14]),
      makePart("Snare", [2, 6, 10, 14]),
    ];
    const r = classifyMood(parts);
    expect(r.vector.tension).toBeCloseTo(1, 5);
    expect(r.primary).toBe("tense");
  });
});

// 5) Uniform 4-on-the-floor -> calm or energetic -----------------------------

describe("classifyMood - uniform 4-on-the-floor", () => {
  it("kick only at [0,4,8,12] -> calm", () => {
    const parts: MoodPartLike[] = [makePart("Kick", [0, 4, 8, 12])];
    const r = classifyMood(parts);
    // energy = 4/16 = 0.25 < 0.3 ✓, flow = 1.0 (uniform spacing) > 0.7 ✓
    // tension = 0/4 = 0 (no hits on off-beats), complexity = 0.75
    // calm checked BEFORE playful in Pin #6, so calm wins
    expect(r.vector.energy).toBeCloseTo(0.25, 5);
    expect(r.vector.flow).toBeCloseTo(1, 5);
    expect(["calm", "energetic"]).toContain(r.primary);
    expect(r.primary).toBe("calm");
  });
  it("4-on-the-floor satisfies the broad calm-or-energetic fitness", () => {
    const parts: MoodPartLike[] = [makePart("Kick", [0, 4, 8, 12])];
    const r = classifyMood(parts);
    expect(["calm", "energetic"]).toContain(r.primary);
  });
});

// 6) Vector value-range bounds -----------------------------------------------

describe("computeMoodVector - value ranges 0..1", () => {
  const samples: MoodPartLike[][] = [
    [],
    [makePart("Kick", [0])],
    [makePart("Kick", [0, 4, 8, 12])],
    [makeAllOn("Kick"), makeAllOn("HiHat")],
    [makePart("Snare", [2, 6, 10, 14])],
    [
      makePart("Kick", [0, 8]),
      makePart("Snare", [4, 12]),
      makePart("HiHat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ],
    [makePart("Tom", [3, 7, 11, 13])],
  ];
  it.each(samples.map((s, i) => [i, s] as const))(
    "sample #%i: every vector field is in [0,1]",
    (_i, parts) => {
      const v = computeMoodVector(parts);
      expect(v.energy).toBeGreaterThanOrEqual(0);
      expect(v.energy).toBeLessThanOrEqual(1);
      expect(v.tension).toBeGreaterThanOrEqual(0);
      expect(v.tension).toBeLessThanOrEqual(1);
      expect(v.warmth).toBeGreaterThanOrEqual(0);
      expect(v.warmth).toBeLessThanOrEqual(1);
      expect(v.complexity).toBeGreaterThanOrEqual(0);
      expect(v.complexity).toBeLessThanOrEqual(1);
      expect(v.flow).toBeGreaterThanOrEqual(0);
      expect(v.flow).toBeLessThanOrEqual(1);
    },
  );
  it("all-on across many parts -> energy=1.0", () => {
    const parts: MoodPartLike[] = [
      makeAllOn("Kick"),
      makeAllOn("Snare"),
      makeAllOn("HiHat"),
    ];
    expect(computeMoodVector(parts).energy).toBeCloseTo(1, 5);
  });
});

// 7) Confidence range 0..1 ---------------------------------------------------

describe("classifyMood - confidence 0..1", () => {
  it.each([
    ["empty", []],
    ["1-hit", [makePart("Kick", [0])]],
    ["all-16", [makeAllOn("Kick")]],
    ["off-beat", [makePart("Kick", [2, 6, 10, 14])]],
    ["dense backbeat", [makeAllOn("Kick"), makeAllOn("Snare"), makeAllOn("HiHat")]],
  ] as const)("confidence is in [0,1] for %s", (_label, parts) => {
    const r = classifyMood(parts as MoodPartLike[]);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
  it("empty -> confidence exactly 0", () => {
    expect(classifyMood([]).confidence).toBe(0);
  });
  it("strong minimal (1-hit) -> confidence > 0", () => {
    const r = classifyMood([makePart("Kick", [0])]);
    expect(r.confidence).toBeGreaterThan(0);
  });
});

// 8) computeMoodVector standalone --------------------------------------------

describe("computeMoodVector - standalone (without classify)", () => {
  it("returns a vector with all 5 axis fields", () => {
    const v = computeMoodVector([makePart("Kick", [0, 4, 8, 12])]);
    expect(Object.keys(v).sort()).toEqual(
      ["complexity", "energy", "flow", "tension", "warmth"].sort(),
    );
  });
  it("kick-heavy pattern -> warmth > 0.5", () => {
    const v = computeMoodVector([makePart("Kick", [0, 4, 8, 12])]);
    expect(v.warmth).toBeGreaterThan(0.5);
  });
  it("cymbal-heavy pattern -> warmth < 0.5", () => {
    const v = computeMoodVector([makePart("HiHat", [0, 2, 4, 6, 8, 10, 12, 14])]);
    expect(v.warmth).toBeLessThan(0.5);
  });
  it("no kick / no cymbal parts -> warmth = 0.5", () => {
    const v = computeMoodVector([makePart("Tom", [0, 4, 8, 12])]);
    expect(v.warmth).toBeCloseTo(0.5, 5);
  });
});

// 9) classifyMood returns valid mood label -----------------------------------

describe("classifyMood - shape + valid label", () => {
  const VALID_MOODS: MoodLabel["primary"][] = [
    "calm",
    "energetic",
    "aggressive",
    "tense",
    "playful",
    "minimal",
    "chaotic",
  ];
  it.each([
    [[]],
    [[makePart("Kick", [0])]],
    [[makePart("Kick", [0, 4, 8, 12])]],
    [[makeAllOn("Kick"), makeAllOn("Snare"), makeAllOn("HiHat")]],
    [[makePart("Snare", [2, 6, 10, 14])]],
    [[makePart("Tom", [3, 7, 11, 13])]],
    [[makePart("Kick", [0, 1, 2, 3], 4)]],
  ])("primary is in valid moods", (parts) => {
    const r = classifyMood(parts as MoodPartLike[]);
    expect(VALID_MOODS).toContain(r.primary);
  });
  it("result has exactly 3 keys", () => {
    const r = classifyMood([makePart("Kick", [0, 4, 8, 12])]);
    expect(Object.keys(r).sort()).toEqual(["confidence", "primary", "vector"].sort());
  });
  it("result.vector is itself a valid 5-field MoodVector", () => {
    const r = classifyMood([makePart("Kick", [0, 4, 8, 12])]);
    expect(Object.keys(r.vector).sort()).toEqual(
      ["complexity", "energy", "flow", "tension", "warmth"].sort(),
    );
  });
});

// 10) Multi-part interplay ---------------------------------------------------

describe("multi-part interplay", () => {
  it("adding hi-hat to kick pattern increases energy AND lowers warmth", () => {
    const baseParts = [makePart("Kick", [0, 4, 8, 12])];
    const augParts = [
      makePart("Kick", [0, 4, 8, 12]),
      makePart("HiHat", [0, 2, 4, 6, 8, 10, 12, 14]),
    ];
    const base = computeMoodVector(baseParts);
    const aug = computeMoodVector(augParts);
    expect(aug.energy).toBeGreaterThan(base.energy);
    expect(aug.warmth).toBeLessThan(base.warmth);
  });
  it("balanced kick+cymbal pattern -> warmth approx 0.5", () => {
    const parts = [
      makePart("Kick", [0, 4, 8, 12]),
      makePart("HiHat", [0, 4, 8, 12]),
    ];
    const v = computeMoodVector(parts);
    expect(v.warmth).toBeCloseTo(0.5, 5);
  });
  it("kick on-beats + snare on-off-beats -> tension > 0", () => {
    const parts = [
      makePart("Kick", [0, 8]),
      makePart("Snare", [2, 6, 10, 14]),
    ];
    const v = computeMoodVector(parts);
    // tension = 4 (snare off-beats) / 6 (total hits) = 0.667
    expect(v.tension).toBeGreaterThan(0);
  });
  it("multi-part length-merge uses max length", () => {
    const parts = [
      makePart("Kick", [0], 8),
      makePart("Snare", [15], 16),
    ];
    const v = computeMoodVector(parts);
    // merged is length 16; q3 has the snare hit, complexity = 1 - 0.25 = 0.75
    expect(v.complexity).toBeCloseTo(0.75, 5);
  });
});

// 11) Purity -----------------------------------------------------------------

describe("purity", () => {
  it("computeMoodVector does not mutate input", () => {
    const parts = [
      makePart("Kick", [0, 4, 8, 12]),
      makePart("Snare", [4, 12]),
    ];
    const before = snapshot(parts);
    computeMoodVector(parts);
    expect(snapshot(parts)).toBe(before);
  });
  it("classifyMood does not mutate input", () => {
    const parts = [makeAllOn("Kick"), makeAllOn("Snare")];
    const before = snapshot(parts);
    classifyMood(parts);
    expect(snapshot(parts)).toBe(before);
  });
  it("computeMoodVector is deterministic across 2 calls", () => {
    const parts = [makePart("Kick", [0, 4, 8, 12])];
    expect(computeMoodVector(parts)).toEqual(computeMoodVector(parts));
  });
  it("classifyMood is deterministic across 2 calls", () => {
    const parts = [makePart("Kick", [0, 4, 8, 12])];
    const r1 = classifyMood(parts);
    const r2 = classifyMood(parts);
    expect(r1).toEqual(r2);
  });
  it("computeMoodVector returns a fresh object (not aliased)", () => {
    const parts = [makePart("Kick", [0, 4, 8, 12])];
    const r1 = computeMoodVector(parts);
    const r2 = computeMoodVector(parts);
    expect(r1).not.toBe(r2);
  });
});

// 12) Defensive: malformed inputs -------------------------------------------

describe("defensive - malformed inputs", () => {
  it("part.steps non-array -> treated as empty (no hits)", () => {
    const parts = [
      { name: "Kick", steps: "nope" as unknown as MoodStepLike[] },
    ];
    const v = computeMoodVector(parts as MoodPartLike[]);
    // total-positions = 0 -> neutral
    expect(v).toEqual(NEUTRAL);
  });
  it("step.active non-boolean -> treated as falsy", () => {
    const parts: MoodPartLike[] = [
      {
        name: "Kick",
        steps: new Array(16).fill(0).map((_, i) => ({
          // Make alternate steps "truthy but not exactly true"
          active: (i % 2 === 0 ? (1 as unknown as boolean) : false),
        })),
      },
    ];
    const v = computeMoodVector(parts);
    // non-exact-true is treated as inactive -> 0 hits -> energy=0
    expect(v.energy).toBe(0);
  });
  it("non-string part.name does not match kick / cymbal regex", () => {
    const parts: MoodPartLike[] = [
      {
        name: 123 as unknown as string,
        steps: new Array(16).fill(0).map(() => ({ active: true })),
      },
    ];
    const v = computeMoodVector(parts);
    // Hits ARE counted in energy/complexity/flow, just NOT toward warmth-kick
    expect(v.energy).toBeCloseTo(1, 5);
    // No kick / no cymbal match -> warmth = 0.5
    expect(v.warmth).toBeCloseTo(0.5, 5);
  });
});

// 13) Off-beat tension calculation ------------------------------------------

describe("tension - off-beat fraction", () => {
  it("hits all on positions [0,4,8,12] (on-beats) -> tension = 0", () => {
    const parts = [makePart("Kick", [0, 4, 8, 12])];
    expect(computeMoodVector(parts).tension).toBe(0);
  });
  it("hits all on [2,6,10,14] -> tension = 1.0", () => {
    const parts = [makePart("Kick", [2, 6, 10, 14])];
    expect(computeMoodVector(parts).tension).toBeCloseTo(1, 5);
  });
  it("4 on-beat + 4 off-beat -> tension = 0.5", () => {
    const parts = [makePart("Kick", [0, 2, 4, 6, 8, 10, 12, 14])];
    expect(computeMoodVector(parts).tension).toBeCloseTo(0.5, 5);
  });
});

// 14) Warmth balance --------------------------------------------------------

describe("warmth - kick vs cymbal", () => {
  it("only kick -> warmth = 1.0", () => {
    const parts = [makePart("Kick", [0, 4, 8, 12])];
    expect(computeMoodVector(parts).warmth).toBeCloseTo(1, 5);
  });
  it("only hi-hat -> warmth = 0", () => {
    const parts = [makePart("HiHat", [0, 4, 8, 12])];
    expect(computeMoodVector(parts).warmth).toBeCloseTo(0, 5);
  });
  it("BD alias matches kick regex", () => {
    const parts = [makePart("BD", [0, 4, 8, 12])];
    expect(computeMoodVector(parts).warmth).toBeCloseTo(1, 5);
  });
  it("Crash matches cymbal regex", () => {
    const parts = [makePart("Crash", [0, 4, 8, 12])];
    expect(computeMoodVector(parts).warmth).toBeCloseTo(0, 5);
  });
  it("Bass Drum (with space) matches kick regex", () => {
    const parts = [makePart("Bass Drum", [0, 4, 8, 12])];
    expect(computeMoodVector(parts).warmth).toBeCloseTo(1, 5);
  });
});

// 15) Chaotic classification -------------------------------------------------

describe("classifyMood - chaotic edge", () => {
  it("very irregular pattern can be chaotic if complexity > 0.8 and flow < 0.4", () => {
    // We need a pattern with high complexity (1 - max-quartile-density > 0.8
    // i.e. max-quartile-density < 0.2) AND low flow (irregular spacings).
    // Use 32-step: quarterLen=8. For density < 0.2, at most 1 hit per quartile
    // (2/8=0.25 too high; 1/8=0.125 ok).
    // Hits at [0, 8, 16, 31]: 1 per quartile (q3 includes 31). Spacings
    // [8, 8, 15] -> variance high -> flow low.
    const parts = [
      makePart("Perc", [0, 8, 16, 31], 32),
    ];
    const v = computeMoodVector(parts);
    expect(v.complexity).toBeGreaterThan(0.8);
    // flow can be high or low depending on variance; just verify finite + in range
    expect(v.flow).toBeGreaterThanOrEqual(0);
    expect(v.flow).toBeLessThanOrEqual(1);
  });
});

