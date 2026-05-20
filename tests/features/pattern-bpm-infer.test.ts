// @vitest-environment node
/**
 * pattern-bpm-infer.test.ts v3.179.0
 * Tests fuer den Pattern-BPM-Inference Pure-Helper.
 */

import { describe, it, expect } from "vitest";
import {
  inferPatternBpm,
  GENRE_BPM_DEFAULTS,
} from "../../client/src/utils/patternBpmInfer";
import type { PatternData } from "../../client/src/audio/AudioEngine";
import type { PartData, StepData, ChannelFx } from "../../client/src/audio/AudioEngine";

// Test-Helpers

function makeDefaultFx(): ChannelFx {
  return {
    eq: { low: 0, mid: 0, high: 0 },
    filter: { type: "lowpass", freq: 20000, q: 1 },
    distortion: { drive: 0 },
    compressor: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 },
    delay: { time: 0.25, feedback: 0.3, mix: 0 },
    reverb: { decay: 1.5, mix: 0 },
  } as unknown as ChannelFx;
}

function makeStep(active: boolean): StepData {
  return { active };
}

function makePart(
  id: string,
  activeIndexes: number[],
  stepCount = 16,
): PartData {
  const steps: StepData[] = new Array(stepCount).fill(null).map((_, i) =>
    makeStep(activeIndexes.includes(i)),
  );
  return {
    id,
    name: id,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: makeDefaultFx(),
  };
}

function makePattern(parts: PartData[], stepCount: 16 | 32 | 64 = 16): PatternData {
  return {
    id: "p1",
    name: "Test",
    stepCount,
    stepResolution: "1/16" as PatternData["stepResolution"],
    bpm: null,
    parts,
  };
}

// 4-on-the-floor Kick (Steps 0, 4, 8, 12).
function fourOnTheFloor(): PartData {
  return makePart("kick", [0, 4, 8, 12]);
}

// Busy Trap-Style: viele Hi-Hat-Subdivisions + Snare + Kick.
function busyTrapPattern(): PatternData {
  const kick = makePart("kick",  [0, 6, 10]);
  const snare = makePart("snare", [4, 12]);
  const hh = makePart("hh", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  return makePattern([kick, snare, hh]);
}

// Syncopated DnB-Style: Break-Pattern mit unregelmaessigen Distanzen.
function syncopatedDnbPattern(): PatternData {
  const kick = makePart("kick",  [0, 7, 10]);
  const snare = makePart("snare", [4, 11]);
  const hh = makePart("hh", [1, 3, 5, 6, 9, 13, 14, 15]);
  return makePattern([kick, snare, hh]);
}

// Tests

describe("GENRE_BPM_DEFAULTS", () => {
  it("hat mind. 5 entries", () => {
    expect(Object.keys(GENRE_BPM_DEFAULTS).length).toBeGreaterThanOrEqual(5);
  });

  it("alle BPM in [40, 220] und range deckt bpm ab", () => {
    for (const [genre, entry] of Object.entries(GENRE_BPM_DEFAULTS)) {
      expect(entry.bpm).toBeGreaterThanOrEqual(40);
      expect(entry.bpm).toBeLessThanOrEqual(220);
      expect(entry.range[0]).toBeLessThanOrEqual(entry.bpm);
      expect(entry.range[1]).toBeGreaterThanOrEqual(entry.bpm);
      expect(entry.range[0]).toBeGreaterThanOrEqual(40);
      expect(entry.range[1]).toBeLessThanOrEqual(220);
      expect(typeof genre).toBe("string");
    }
  });
});

describe("inferPatternBpm — empty pattern", () => {
  it("empty pattern (keine parts) → defaults (pop, 120, conf 0, reasoning 'Empty pattern')", () => {
    const empty = makePattern([]);
    const res = inferPatternBpm(empty);
    expect(res.suggestedBpm).toBe(120);
    expect(res.confidence).toBe(0);
    expect(res.genreHint).toBe("pop");
    expect(res.reasoning).toBe("Empty pattern");
  });

  it("parts ohne active steps → empty defaults", () => {
    const silent = makePart("silent", []);
    const pat = makePattern([silent]);
    const res = inferPatternBpm(pat);
    expect(res.suggestedBpm).toBe(120);
    expect(res.confidence).toBe(0);
    expect(res.genreHint).toBe("pop");
  });
});

describe("inferPatternBpm — preferredGenre", () => {
  it("preferredGenre 'trap' → suggestedBpm 140", () => {
    const pat = makePattern([fourOnTheFloor()]);
    const res = inferPatternBpm(pat, { preferredGenre: "trap" });
    expect(res.suggestedBpm).toBe(140);
    expect(res.genreHint).toBe("trap");
    expect(res.confidence).toBeGreaterThan(0);
  });

  it("preferredGenre 'house' → suggestedBpm 124", () => {
    const pat = makePattern([fourOnTheFloor()]);
    const res = inferPatternBpm(pat, { preferredGenre: "house" });
    expect(res.suggestedBpm).toBe(124);
    expect(res.genreHint).toBe("house");
  });

  it("preferredGenre 'dnb' → suggestedBpm 174", () => {
    const pat = makePattern([fourOnTheFloor()]);
    const res = inferPatternBpm(pat, { preferredGenre: "dnb" });
    expect(res.suggestedBpm).toBe(174);
    expect(res.genreHint).toBe("dnb");
  });

  it("preferredGenre 'invalid' → fallback 'pop' + 120", () => {
    const pat = makePattern([fourOnTheFloor()]);
    const res = inferPatternBpm(pat, { preferredGenre: "invalid-genre-xyz" });
    expect(res.suggestedBpm).toBe(120);
    expect(res.genreHint).toBe("pop");
    expect(res.reasoning).toMatch(/Unknown preferredGenre/i);
  });
});

describe("inferPatternBpm — heuristic", () => {
  it("4-on-the-floor sparse (Density ~0.25) → hip-hop or ambient (sparse bucket)", () => {
    const pat = makePattern([fourOnTheFloor()]);
    const res = inferPatternBpm(pat);
    expect(["hip-hop", "ambient"]).toContain(res.genreHint);
    expect(res.suggestedBpm).toBeGreaterThanOrEqual(60);
    expect(res.suggestedBpm).toBeLessThanOrEqual(110);
  });

  it("4-on-the-floor + Snare → bekanntes Genre aus Defaults", () => {
    const pat = makePattern([fourOnTheFloor(), makePart("snare", [4, 12])]);
    const res = inferPatternBpm(pat);
    expect(Object.keys(GENRE_BPM_DEFAULTS)).toContain(res.genreHint);
  });

  it("busy trap pattern (Density > 0.5) → trap or dnb (high density)", () => {
    const pat = busyTrapPattern();
    const res = inferPatternBpm(pat);
    expect(["trap", "dnb"]).toContain(res.genreHint);
    expect(res.suggestedBpm).toBeGreaterThanOrEqual(130);
  });

  it("syncopated dnb pattern → dnb/trap/techno", () => {
    const pat = syncopatedDnbPattern();
    const res = inferPatternBpm(pat);
    expect(["dnb", "trap", "techno"]).toContain(res.genreHint);
  });

  it("reasoning is non-empty fuer non-empty pattern", () => {
    const pat = makePattern([fourOnTheFloor()]);
    const res = inferPatternBpm(pat);
    expect(typeof res.reasoning).toBe("string");
    expect(res.reasoning.length).toBeGreaterThan(0);
  });

  it("confidence in [0, 1] fuer heuristic", () => {
    const pat = makePattern([fourOnTheFloor()]);
    const res = inferPatternBpm(pat);
    expect(res.confidence).toBeGreaterThanOrEqual(0);
    expect(res.confidence).toBeLessThanOrEqual(1);
  });
});

describe("inferPatternBpm — invariants", () => {
  const testPatterns: { name: string; pattern: PatternData; options?: { preferredGenre?: string } }[] = [
    { name: "empty",          pattern: makePattern([]) },
    { name: "4-on-floor",     pattern: makePattern([fourOnTheFloor()]) },
    { name: "busy trap",      pattern: busyTrapPattern() },
    { name: "syncopated dnb", pattern: syncopatedDnbPattern() },
    { name: "user trap",      pattern: makePattern([fourOnTheFloor()]), options: { preferredGenre: "trap" } },
    { name: "user invalid",   pattern: makePattern([fourOnTheFloor()]), options: { preferredGenre: "invalid" } },
    { name: "user ambient",   pattern: makePattern([fourOnTheFloor()]), options: { preferredGenre: "ambient" } },
    { name: "user footwork",  pattern: makePattern([fourOnTheFloor()]), options: { preferredGenre: "footwork" } },
  ];

  it("all suggestedBpm in [40, 220]", () => {
    for (const { pattern, options } of testPatterns) {
      const res = inferPatternBpm(pattern, options);
      expect(res.suggestedBpm).toBeGreaterThanOrEqual(40);
      expect(res.suggestedBpm).toBeLessThanOrEqual(220);
    }
  });

  it("all confidence in [0, 1]", () => {
    for (const { pattern, options } of testPatterns) {
      const res = inferPatternBpm(pattern, options);
      expect(res.confidence).toBeGreaterThanOrEqual(0);
      expect(res.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("all genreHint in GENRE_BPM_DEFAULTS keys", () => {
    for (const { pattern, options } of testPatterns) {
      const res = inferPatternBpm(pattern, options);
      expect(typeof res.genreHint).toBe("string");
      expect(res.genreHint.length).toBeGreaterThan(0);
      expect(Object.keys(GENRE_BPM_DEFAULTS)).toContain(res.genreHint);
    }
  });

  it("all reasoning is string", () => {
    for (const { pattern, options } of testPatterns) {
      const res = inferPatternBpm(pattern, options);
      expect(typeof res.reasoning).toBe("string");
    }
  });
});
