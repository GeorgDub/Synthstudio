/**
 * tests/features/pattern-groove-perception.test.ts (v3.222)
 *
 * Pure-Coverage fuer client/src/utils/patternGroovePerception.ts.
 * Inputs duerfen nie mutiert werden; saemtliche Funktionen sind deterministisch.
 *
 * Pinned Choices (siehe Helper-JSDoc):
 *  #1 swing/push-Auswertung NUR auf aktiven OFF-BEAT-Steps (i%2 === 1)
 *  #2 Default-Werte bei empty/no-off-beats: swing=50, feel="tight", micro=0
 *  #3 swingPercent = clamp(avg * 100, 0, 100)
 *  #4 microPushScore = avg(timing - 0.5) ueber aktive Off-Beat-Steps
 *  #5 feel-Mapping: |micro|<0.05 tight; >0.05 push; <-0.05 laidback; sonst loose
 *  #6 Sanitizer: undef/NaN/-Inf/neg -> 0; +Inf/>1 -> 1
 *  #7 steps null/undefined/non-array -> Default
 *  #8 Pure: kein Mutate
 */
import { describe, it, expect } from "vitest";
import {
  perceiveGroove,
  computeSwingPercent,
  detectPushPull,
  type GrooveStepLike,
  type GrooveFeel,
} from "@/utils/patternGroovePerception";

// --- Helpers ---------------------------------------------------------------

function makeSteps(opts: {
  onBeatActiveIndices?: number[];
  offBeatActiveIndices?: number[];
  onBeatTiming?: number;
  offBeatTiming?: number;
  length?: number;
}): GrooveStepLike[] {
  const len = opts.length ?? 16;
  const onIdx = new Set(opts.onBeatActiveIndices ?? []);
  const offIdx = new Set(opts.offBeatActiveIndices ?? []);
  const out: GrooveStepLike[] = [];
  for (let i = 0; i < len; i++) {
    if (i % 2 === 0) {
      out.push({
        active: onIdx.has(i),
        timing: opts.onBeatTiming ?? 0,
      });
    } else {
      out.push({
        active: offIdx.has(i),
        timing: opts.offBeatTiming ?? 0.5,
      });
    }
  }
  return out;
}

function snapshot(steps: GrooveStepLike[]): string {
  return JSON.stringify(steps);
}

// 1) Empty / degenerate ----------------------------------------------------

describe("perceiveGroove - empty / degenerate", () => {
  it("empty array -> default GrooveFeel", () => {
    const r = perceiveGroove([]);
    expect(r).toEqual<GrooveFeel>({
      swingPercent: 50,
      feel: "tight",
      microPushScore: 0,
    });
  });

  it("null cast -> default GrooveFeel (Pin #7)", () => {
    const r = perceiveGroove(null as unknown as GrooveStepLike[]);
    expect(r).toEqual<GrooveFeel>({
      swingPercent: 50,
      feel: "tight",
      microPushScore: 0,
    });
  });

  it("undefined cast -> default GrooveFeel (Pin #7)", () => {
    const r = perceiveGroove(undefined as unknown as GrooveStepLike[]);
    expect(r).toEqual<GrooveFeel>({
      swingPercent: 50,
      feel: "tight",
      microPushScore: 0,
    });
  });

  it("non-array cast -> default GrooveFeel (Pin #7)", () => {
    const r = perceiveGroove(("not-an-array" as unknown) as GrooveStepLike[]);
    expect(r).toEqual<GrooveFeel>({
      swingPercent: 50,
      feel: "tight",
      microPushScore: 0,
    });
  });

  it("all inactive 16 steps -> default (no off-beats counted)", () => {
    const steps = makeSteps({});
    expect(perceiveGroove(steps)).toEqual<GrooveFeel>({
      swingPercent: 50,
      feel: "tight",
      microPushScore: 0,
    });
  });
});

// 2) All-on-beat -> tight + swing=50 ---------------------------------------

describe("perceiveGroove - all-on-beat", () => {
  it("only on-beat steps active, timing=0 -> swing=50, feel=tight, micro=0", () => {
    const steps = makeSteps({
      onBeatActiveIndices: [0, 2, 4, 6, 8, 10, 12, 14],
      onBeatTiming: 0,
    });
    const r = perceiveGroove(steps);
    expect(r.swingPercent).toBe(50);
    expect(r.feel).toBe("tight");
    expect(r.microPushScore).toBe(0);
  });

  it("all-on-beat at timing=0.3 STILL ignored -> swing=50, tight", () => {
    const steps = makeSteps({
      onBeatActiveIndices: [0, 2, 4, 6, 8, 10, 12, 14],
      onBeatTiming: 0.3,
    });
    const r = perceiveGroove(steps);
    expect(r.swingPercent).toBe(50);
    expect(r.feel).toBe("tight");
    expect(r.microPushScore).toBe(0);
  });
});

// 3) Off-beats pushed back (timing>0.5) -> push ----------------------------

describe("perceiveGroove - off-beats pushed back", () => {
  it("off-beats at timing=0.65 -> microPush > 0, feel=push", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7, 9, 11, 13, 15],
      offBeatTiming: 0.65,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBeCloseTo(0.15, 10);
    expect(r.feel).toBe("push");
    expect(r.swingPercent).toBeCloseTo(65, 10);
  });

  it("off-beats at timing=0.55 -> micro ~ 0.05 (FP-just-over) -> push", () => {
    // 0.55 - 0.5 == 0.05000000000000004 in IEEE-754, so the boundary
    // tips into push by an ulp. The exact-0.05 case would be "loose"
    // (see feel-mapping-boundaries describe).
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3],
      offBeatTiming: 0.55,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBeCloseTo(0.05, 10);
    expect(r.feel).toBe("push");
  });
});

// 4) Off-beats pulled forward (timing<0.5) -> laidback ---------------------

describe("perceiveGroove - off-beats pulled forward", () => {
  it("off-beats at timing=0.35 -> microPush < 0, feel=laidback", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7, 9, 11, 13, 15],
      offBeatTiming: 0.35,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBeCloseTo(-0.15, 10);
    expect(r.feel).toBe("laidback");
    expect(r.swingPercent).toBeCloseTo(35, 10);
  });

  it("off-beats at timing=0.2 -> strong laidback", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7],
      offBeatTiming: 0.2,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBeCloseTo(-0.3, 10);
    expect(r.feel).toBe("laidback");
    expect(r.swingPercent).toBeCloseTo(20, 10);
  });
});

// 5) Shuffle / triplet feel ------------------------------------------------

describe("perceiveGroove - shuffle/triplet", () => {
  it("shuffle pattern (off-beat at 0.67) -> swingPercent ~ 67, push", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7, 9, 11, 13, 15],
      offBeatTiming: 0.67,
    });
    const r = perceiveGroove(steps);
    expect(r.swingPercent).toBeCloseTo(67, 5);
    expect(r.microPushScore).toBeCloseTo(0.17, 5);
    expect(r.feel).toBe("push");
  });

  it("triplet at 2/3 -> swing ~ 66.67", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3],
      offBeatTiming: 2 / 3,
    });
    const r = perceiveGroove(steps);
    expect(r.swingPercent).toBeCloseTo(200 / 3, 5);
    expect(r.feel).toBe("push");
  });
});

// 6) Consistency -----------------------------------------------------------

describe("perceiveGroove - consistency", () => {
  it("all active with same off-beat timing -> consistent microPush", () => {
    const steps = makeSteps({
      onBeatActiveIndices: [0, 2, 4, 6, 8, 10, 12, 14],
      offBeatActiveIndices: [1, 3, 5, 7, 9, 11, 13, 15],
      onBeatTiming: 0,
      offBeatTiming: 0.5,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBe(0);
    expect(r.feel).toBe("tight");
    expect(r.swingPercent).toBe(50);
  });

  it("detectPushPull and perceiveGroove yield same microPushScore", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7],
      offBeatTiming: 0.6,
    });
    const m = detectPushPull(steps);
    const g = perceiveGroove(steps);
    expect(g.microPushScore).toBe(m);
  });
});

// 7) Single-step trivial ---------------------------------------------------

describe("perceiveGroove - single step", () => {
  it("single on-beat step -> default (no off-beats)", () => {
    const r = perceiveGroove([{ active: true, timing: 0 }]);
    expect(r.swingPercent).toBe(50);
    expect(r.microPushScore).toBe(0);
    expect(r.feel).toBe("tight");
  });

  it("single inactive step -> default", () => {
    const r = perceiveGroove([{ active: false, timing: 0.5 }]);
    expect(r.swingPercent).toBe(50);
    expect(r.feel).toBe("tight");
  });

  it("two-step, single off-beat active at 0.5 -> tight", () => {
    const r = perceiveGroove([
      { active: false, timing: 0 },
      { active: true, timing: 0.5 },
    ]);
    expect(r.swingPercent).toBe(50);
    expect(r.feel).toBe("tight");
    expect(r.microPushScore).toBe(0);
  });
});

// 8) Sanitizer / timing edge cases (Pin #6) --------------------------------

describe("perceiveGroove - sanitizer edge cases", () => {
  it("timing undefined -> treated as 0 -> laidback", () => {
    const steps: GrooveStepLike[] = [
      { active: true, timing: 0 },
      { active: true },
    ];
    expect(detectPushPull(steps)).toBeCloseTo(-0.5, 10);
    expect(perceiveGroove(steps).feel).toBe("laidback");
  });

  it("timing NaN -> treated as 0", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: Number.NaN },
    ];
    expect(detectPushPull(steps)).toBeCloseTo(-0.5, 10);
    expect(computeSwingPercent(steps)).toBe(0);
  });

  it("timing negative -> clamped to 0", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: -3 },
    ];
    expect(detectPushPull(steps)).toBeCloseTo(-0.5, 10);
    expect(computeSwingPercent(steps)).toBe(0);
  });

  it("timing > 1 -> clamped to 1", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: 5 },
    ];
    expect(detectPushPull(steps)).toBeCloseTo(0.5, 10);
    expect(computeSwingPercent(steps)).toBe(100);
    expect(perceiveGroove(steps).feel).toBe("push");
  });

  it("timing +Infinity -> clamped to 1", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: Number.POSITIVE_INFINITY },
    ];
    expect(computeSwingPercent(steps)).toBe(100);
  });

  it("timing -Infinity -> clamped to 0", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: Number.NEGATIVE_INFINITY },
    ];
    expect(computeSwingPercent(steps)).toBe(0);
  });

  it("mixed valid + NaN off-beats -> NaN -> 0", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: 0.6 },
      { active: false, timing: 0 },
      { active: true, timing: Number.NaN },
    ];
    expect(computeSwingPercent(steps)).toBeCloseTo(30, 10);
    expect(detectPushPull(steps)).toBeCloseTo(-0.2, 10);
  });
});

// 9) detectPushPull standalone --------------------------------------------

describe("detectPushPull standalone", () => {
  it("empty -> 0", () => {
    expect(detectPushPull([])).toBe(0);
  });

  it("no active off-beats -> 0", () => {
    const steps = makeSteps({ onBeatActiveIndices: [0, 2, 4] });
    expect(detectPushPull(steps)).toBe(0);
  });

  it("single active off-beat at 0.5 -> 0", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1],
      offBeatTiming: 0.5,
    });
    expect(detectPushPull(steps)).toBe(0);
  });

  it("single active off-beat at 1 -> +0.5", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: 1 },
    ];
    expect(detectPushPull(steps)).toBeCloseTo(0.5, 10);
  });

  it("single active off-beat at 0 -> -0.5", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: 0 },
    ];
    expect(detectPushPull(steps)).toBeCloseTo(-0.5, 10);
  });

  it("null cast -> 0", () => {
    expect(detectPushPull(null as unknown as GrooveStepLike[])).toBe(0);
  });
});

// 10) computeSwingPercent standalone --------------------------------------

describe("computeSwingPercent standalone", () => {
  it("empty -> 50 (default)", () => {
    expect(computeSwingPercent([])).toBe(50);
  });

  it("no active off-beats -> 50", () => {
    const steps = makeSteps({ onBeatActiveIndices: [0, 2, 4] });
    expect(computeSwingPercent(steps)).toBe(50);
  });

  it("off-beat at 0.5 -> 50", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7],
      offBeatTiming: 0.5,
    });
    expect(computeSwingPercent(steps)).toBe(50);
  });

  it("off-beat at 0.75 -> 75 (full shuffle)", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3],
      offBeatTiming: 0.75,
    });
    expect(computeSwingPercent(steps)).toBe(75);
  });

  it("off-beat at 0 -> 0 (extreme pull)", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3],
      offBeatTiming: 0,
    });
    expect(computeSwingPercent(steps)).toBe(0);
  });

  it("mixed timings averaged", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: 0.4 },
      { active: false, timing: 0 },
      { active: true, timing: 0.8 },
    ];
    expect(computeSwingPercent(steps)).toBeCloseTo(60, 10);
  });

  it("ignores inactive off-beats", () => {
    const steps: GrooveStepLike[] = [
      { active: false, timing: 0 },
      { active: true, timing: 0.75 },
      { active: false, timing: 0 },
      { active: false, timing: 0.1 },
    ];
    expect(computeSwingPercent(steps)).toBe(75);
  });
});

// 11) Purity / immutability -----------------------------------------------

describe("purity / immutability", () => {
  it("perceiveGroove does not mutate input", () => {
    const steps = makeSteps({
      onBeatActiveIndices: [0, 2, 4, 6, 8, 10, 12, 14],
      offBeatActiveIndices: [1, 3, 5, 7, 9, 11, 13, 15],
      offBeatTiming: 0.6,
    });
    const before = snapshot(steps);
    perceiveGroove(steps);
    perceiveGroove(steps);
    expect(snapshot(steps)).toBe(before);
  });

  it("computeSwingPercent + detectPushPull do not mutate input", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7],
      offBeatTiming: 0.65,
    });
    const before = snapshot(steps);
    computeSwingPercent(steps);
    detectPushPull(steps);
    expect(snapshot(steps)).toBe(before);
  });

  it("deterministic two calls yield identical result", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 5, 9, 13],
      offBeatTiming: 0.62,
    });
    const a = perceiveGroove(steps);
    const b = perceiveGroove(steps);
    expect(a).toEqual(b);
  });

  it("returns fresh result objects", () => {
    const steps: GrooveStepLike[] = [];
    const a = perceiveGroove(steps);
    const b = perceiveGroove(steps);
    expect(a).not.toBe(b);
  });
});

// 12) Feel-mapping boundary semantics -------------------------------------

describe("perceiveGroove - feel-mapping boundaries", () => {
  it("micro 0.04 (just under threshold) -> tight", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5, 7, 9, 11, 13, 15],
      offBeatTiming: 0.54,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBeCloseTo(0.04, 10);
    expect(r.feel).toBe("tight");
  });

  it("micro 0.06 -> push (just over threshold)", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3],
      offBeatTiming: 0.56,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBeCloseTo(0.06, 10);
    expect(r.feel).toBe("push");
  });

  it("micro -0.06 -> laidback (just over negative threshold)", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3],
      offBeatTiming: 0.44,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBeCloseTo(-0.06, 10);
    expect(r.feel).toBe("laidback");
  });

  it("micro exactly 0 -> tight (centered)", () => {
    const steps = makeSteps({
      offBeatActiveIndices: [1, 3, 5],
      offBeatTiming: 0.5,
    });
    const r = perceiveGroove(steps);
    expect(r.microPushScore).toBe(0);
    expect(r.feel).toBe("tight");
  });

  it("output result-shape has exactly 3 keys", () => {
    const r = perceiveGroove([{ active: true, timing: 0 }]);
    expect(Object.keys(r).sort()).toEqual(["feel", "microPushScore", "swingPercent"]);
  });
});

// 13) Bounds - output ranges ----------------------------------------------

describe("perceiveGroove - output bounds", () => {
  it("swingPercent stays in [0, 100] across arbitrary input", () => {
    const cases: GrooveStepLike[][] = [
      makeSteps({ offBeatActiveIndices: [1, 3, 5], offBeatTiming: 0 }),
      makeSteps({ offBeatActiveIndices: [1, 3, 5], offBeatTiming: 1 }),
      makeSteps({ offBeatActiveIndices: [1, 3], offBeatTiming: 0.5 }),
      makeSteps({ offBeatActiveIndices: [1, 3, 5, 7], offBeatTiming: 0.67 }),
    ];
    for (const steps of cases) {
      const r = perceiveGroove(steps);
      expect(r.swingPercent).toBeGreaterThanOrEqual(0);
      expect(r.swingPercent).toBeLessThanOrEqual(100);
    }
  });

  it("microPushScore stays in [-1, 1] across arbitrary input", () => {
    const cases: GrooveStepLike[][] = [
      makeSteps({ offBeatActiveIndices: [1, 3, 5], offBeatTiming: 0 }),
      makeSteps({ offBeatActiveIndices: [1, 3, 5], offBeatTiming: 1 }),
      makeSteps({ offBeatActiveIndices: [1, 3], offBeatTiming: 0.5 }),
    ];
    for (const steps of cases) {
      const r = perceiveGroove(steps);
      expect(r.microPushScore).toBeGreaterThanOrEqual(-1);
      expect(r.microPushScore).toBeLessThanOrEqual(1);
    }
  });

  it("feel is one of the four allowed strings", () => {
    const allowed = new Set(["tight", "push", "laidback", "loose"]);
    const cases: GrooveStepLike[][] = [
      [],
      makeSteps({ offBeatActiveIndices: [1], offBeatTiming: 0.65 }),
      makeSteps({ offBeatActiveIndices: [1], offBeatTiming: 0.35 }),
      makeSteps({ offBeatActiveIndices: [1], offBeatTiming: 0.5 }),
      makeSteps({ offBeatActiveIndices: [1], offBeatTiming: 0.55 }),
    ];
    for (const steps of cases) {
      const r = perceiveGroove(steps);
      expect(allowed.has(r.feel)).toBe(true);
    }
  });
});
