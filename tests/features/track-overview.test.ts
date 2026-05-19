/**
 * tests/features/track-overview.test.ts (v3.166)
 *
 * Pure-Coverage fuer client/src/utils/trackOverview.ts.
 */
import { describe, it, expect } from "vitest";
import {
  computeTrackOverview,
  formatTrackOverviewSummary,
  type ChannelLike,
} from "@/utils/trackOverview";
import type { PatternData } from "@/audio/AudioEngine";

// --- Test-Fixtures ----------------------------------------------------------

function makePattern(
  id: string,
  parts: Array<{ steps: boolean[] }>,
): PatternData {
  return {
    id,
    name: id,
    stepCount: 16 as const,
    stepResolution: "1/16" as any,
    bpm: 120,
    parts: parts.map((p, i) => ({
      id: id + "-p" + i,
      name: "Part " + i,
      muted: false,
      soloed: false,
      volume: 1,
      pan: 0,
      steps: p.steps.map((active) => ({ active })),
    })) as any,
  };
}

function makeChannel(
  id: string,
  opts: Partial<Omit<ChannelLike, "id">> = {},
): ChannelLike {
  return { id, ...opts };
}

// --- computeTrackOverview - Empty Cases -------------------------------------

describe("computeTrackOverview - Empty Cases", () => {
  it("Empty input -> all counts 0, density 0", () => {
    const r = computeTrackOverview({ patterns: [], channels: [] });
    expect(r.patternCount).toBe(0);
    expect(r.channelCount).toBe(0);
    expect(r.mutedChannelCount).toBe(0);
    expect(r.soloedChannelCount).toBe(0);
    expect(r.silentChannelCount).toBe(0);
    expect(r.totalActiveSteps).toBe(0);
    expect(r.totalPossibleSteps).toBe(0);
    expect(r.averageDensity).toBe(0);
    expect(r.sampleCount).toBe(0);
  });

  it("Empty input -> summary '0 Patterns · 0 Channels · 0% Density'", () => {
    const r = computeTrackOverview({ patterns: [], channels: [] });
    expect(formatTrackOverviewSummary(r)).toBe(
      "0 Patterns · 0 Channels · 0% Density",
    );
  });

  it("Patterns ohne Parts -> totalPossibleSteps=0, density=0", () => {
    const patterns = [makePattern("p1", []), makePattern("p2", [])];
    const r = computeTrackOverview({ patterns, channels: [] });
    expect(r.patternCount).toBe(2);
    expect(r.totalPossibleSteps).toBe(0);
    expect(r.totalActiveSteps).toBe(0);
    expect(r.averageDensity).toBe(0);
  });
});

// --- computeTrackOverview - Counts ------------------------------------------

describe("computeTrackOverview - Counts", () => {
  it("patternCount = patterns.length", () => {
    const patterns = [
      makePattern("a", [{ steps: [true, false] }]),
      makePattern("b", [{ steps: [true, true] }]),
      makePattern("c", [{ steps: [false] }]),
    ];
    const r = computeTrackOverview({ patterns, channels: [] });
    expect(r.patternCount).toBe(3);
  });

  it("channelCount = channels.length", () => {
    const channels = [makeChannel("c1"), makeChannel("c2"), makeChannel("c3")];
    const r = computeTrackOverview({ patterns: [], channels });
    expect(r.channelCount).toBe(3);
  });

  it("mutedChannelCount only counts muted=true (false + undefined excluded)", () => {
    const channels = [
      makeChannel("a", { muted: true }),
      makeChannel("b", { muted: false }),
      makeChannel("c"),
      makeChannel("d", { muted: true }),
    ];
    const r = computeTrackOverview({ patterns: [], channels });
    expect(r.mutedChannelCount).toBe(2);
  });

  it("soloedChannelCount only counts soloed=true", () => {
    const channels = [
      makeChannel("a", { soloed: true }),
      makeChannel("b", { soloed: false }),
      makeChannel("c"),
      makeChannel("d", { soloed: true }),
      makeChannel("e", { soloed: true }),
    ];
    const r = computeTrackOverview({ patterns: [], channels });
    expect(r.soloedChannelCount).toBe(3);
  });

  it("silentChannelCount only counts volume===0 (not undefined, not 0.001)", () => {
    const channels = [
      makeChannel("a", { volume: 0 }),
      makeChannel("b", { volume: 1 }),
      makeChannel("c", { volume: 0 }),
      makeChannel("d"),
      makeChannel("e", { volume: 0.001 }),
    ];
    const r = computeTrackOverview({ patterns: [], channels });
    expect(r.silentChannelCount).toBe(2);
  });
});

// --- computeTrackOverview - Density -----------------------------------------

describe("computeTrackOverview - Density", () => {
  it("averageDensity from actual active steps (2/4 = 0.5)", () => {
    const patterns = [makePattern("p", [{ steps: [true, false, true, false] }])];
    const r = computeTrackOverview({ patterns, channels: [] });
    expect(r.totalActiveSteps).toBe(2);
    expect(r.totalPossibleSteps).toBe(4);
    expect(r.averageDensity).toBe(0.5);
  });

  it("averageDensity across multiple patterns + parts (6/12 = 0.5)", () => {
    const patterns = [
      makePattern("p1", [
        { steps: [true, true, true, true] },
        { steps: [false, false, false, false] },
      ]),
      makePattern("p2", [{ steps: [true, false, true, false] }]),
    ];
    const r = computeTrackOverview({ patterns, channels: [] });
    expect(r.totalActiveSteps).toBe(6);
    expect(r.totalPossibleSteps).toBe(12);
    expect(r.averageDensity).toBe(0.5);
  });

  it("All-active pattern -> density = 1.0", () => {
    const patterns = [makePattern("full", [{ steps: [true, true, true, true] }])];
    const r = computeTrackOverview({ patterns, channels: [] });
    expect(r.averageDensity).toBe(1);
  });
});

// --- computeTrackOverview - sampleCount -------------------------------------

describe("computeTrackOverview - sampleCount", () => {
  it("sampleCount from input.totalSamples", () => {
    const r = computeTrackOverview({
      patterns: [],
      channels: [],
      totalSamples: 42,
    });
    expect(r.sampleCount).toBe(42);
  });

  it("sampleCount default 0 when not provided", () => {
    const r = computeTrackOverview({ patterns: [], channels: [] });
    expect(r.sampleCount).toBe(0);
  });
});

// --- formatTrackOverviewSummary ---------------------------------------------

describe("formatTrackOverviewSummary", () => {
  it("Contains muted-info when count > 0", () => {
    const r = computeTrackOverview({
      patterns: [makePattern("p", [{ steps: [true, false] }])],
      channels: [
        makeChannel("a", { muted: true }),
        makeChannel("b", { muted: true }),
        makeChannel("c", { muted: true }),
        makeChannel("d"),
      ],
    });
    const s = formatTrackOverviewSummary(r);
    expect(s).toContain("4 Channels");
    expect(s).toContain("(3 muted)");
  });

  it("Omits muted-info when count is 0", () => {
    const r = computeTrackOverview({
      patterns: [],
      channels: [makeChannel("a"), makeChannel("b")],
    });
    const s = formatTrackOverviewSummary(r);
    expect(s).toContain("2 Channels");
    expect(s).not.toContain("muted");
    expect(s).not.toContain("(");
  });

  it("Contains sample count when > 0", () => {
    const r = computeTrackOverview({
      patterns: [],
      channels: [],
      totalSamples: 24,
    });
    const s = formatTrackOverviewSummary(r);
    expect(s).toContain("24 Samples");
  });

  it("Omits sample count when 0", () => {
    const r = computeTrackOverview({ patterns: [], channels: [] });
    const s = formatTrackOverviewSummary(r);
    expect(s).not.toContain("Samples");
  });

  it("Combines muted + solo inline (1 muted/2 solo)", () => {
    const r = computeTrackOverview({
      patterns: [],
      channels: [
        makeChannel("a", { muted: true }),
        makeChannel("b", { soloed: true }),
        makeChannel("c", { soloed: true }),
      ],
    });
    const s = formatTrackOverviewSummary(r);
    expect(s).toContain("(1 muted/2 solo)");
  });

  it("Density rounded via Math.round(d*100) (1/3 -> 33%)", () => {
    const patterns = [makePattern("p", [{ steps: [true, false, false] }])];
    const r = computeTrackOverview({ patterns, channels: [] });
    const s = formatTrackOverviewSummary(r);
    expect(s).toContain("~33% Density");
  });

  it("Full example: 8 Patterns + 12 Channels + 3 muted + 50% Density + 24 Samples", () => {
    const patterns = Array.from({ length: 8 }, (_, i) =>
      makePattern("p" + i, [
        {
          steps: [
            true, true, true, true, true, true, true, true,
            false, false, false, false, false, false, false, false,
          ],
        },
      ]),
    );
    const channels = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeChannel("m" + i, { muted: true }),
      ),
      ...Array.from({ length: 9 }, (_, i) => makeChannel("c" + i)),
    ];
    const r = computeTrackOverview({
      patterns,
      channels,
      totalSamples: 24,
    });
    const s = formatTrackOverviewSummary(r);
    expect(s).toBe(
      "8 Patterns · 12 Channels (3 muted) · ~50% Density · 24 Samples",
    );
  });
});
