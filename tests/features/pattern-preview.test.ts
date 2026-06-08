/**
 * tests/features/pattern-preview.test.ts
 *
 * Coverage für die Pattern-Library-Vorschau-Logik (Synth.md: "kleine Vorschau /
 * anhör Funktion"). Testet die Pure-Helfer computePatternPreviewHits +
 * msPerStep + previewDurationMs.
 */
import { describe, it, expect } from "vitest";
import {
  computePatternPreviewHits,
  msPerStep,
  previewDurationMs,
  type PreviewPattern,
} from "../../client/src/utils/patternPreview";

function part(over: Partial<PreviewPattern["parts"][number]> = {}) {
  return {
    sampleUrl: "kick.wav",
    volume: 1,
    sourceType: "sample",
    steps: [],
    ...over,
  };
}

const fourOnFloor: PreviewPattern = {
  stepCount: 16,
  stepResolution: "1/16",
  bpm: 120,
  parts: [
    part({
      sampleUrl: "kick.wav",
      steps: Array.from({ length: 16 }, (_, i) => ({ active: i % 4 === 0 })),
    }),
  ],
};

describe("msPerStep", () => {
  it("120 BPM, 1/16 → 125ms pro Step", () => {
    expect(msPerStep(120, "1/16")).toBeCloseTo(125);
  });

  it("1/8 ist doppelt so lang wie 1/16", () => {
    expect(msPerStep(120, "1/8")).toBeCloseTo(250);
  });

  it("ungültiges BPM fällt auf 120 zurück", () => {
    expect(msPerStep(0, "1/16")).toBeCloseTo(125);
  });
});

describe("computePatternPreviewHits", () => {
  it("Happy Path: Four-on-the-Floor → 4 Hits auf Step 0,4,8,12", () => {
    const hits = computePatternPreviewHits(fourOnFloor, { bpm: 120 });
    expect(hits).toHaveLength(4);
    expect(hits.map((h) => h.timeMs)).toEqual([0, 500, 1000, 1500]);
    expect(hits.every((h) => h.sampleUrl === "kick.wav")).toBe(true);
  });

  it("nutzt Pattern-eigenes BPM vor Fallback", () => {
    const hits = computePatternPreviewHits(
      { ...fourOnFloor, bpm: 240 },
      { bpm: 120 },
    );
    // doppelt so schnell → halbe Zeiten
    expect(hits.map((h) => h.timeMs)).toEqual([0, 250, 500, 750]);
  });

  it("Velocity + Part-Volume fließen in volume ein", () => {
    const p: PreviewPattern = {
      stepCount: 1,
      stepResolution: "1/16",
      bpm: 120,
      parts: [part({ volume: 0.5, steps: [{ active: true, velocity: 127 }] })],
    };
    const hits = computePatternPreviewHits(p, { bpm: 120 });
    expect(hits[0].volume).toBeCloseTo(0.5);
  });

  it("Edge Case: Synth-Parts (wavetable) werden übersprungen", () => {
    const p: PreviewPattern = {
      stepCount: 1,
      stepResolution: "1/16",
      bpm: 120,
      parts: [
        part({ sourceType: "wavetable", steps: [{ active: true }] }),
        part({ sampleUrl: undefined, steps: [{ active: true }] }),
      ],
    };
    expect(computePatternPreviewHits(p, { bpm: 120 })).toHaveLength(0);
  });

  it("Edge Case: keine aktiven Steps → keine Hits", () => {
    const p: PreviewPattern = {
      stepCount: 4,
      stepResolution: "1/16",
      bpm: 120,
      parts: [part({ steps: Array.from({ length: 4 }, () => ({ active: false })) })],
    };
    expect(computePatternPreviewHits(p, { bpm: 120 })).toEqual([]);
  });

  it("bars=2 wiederholt das Pattern (loopt Steps)", () => {
    const hits = computePatternPreviewHits(fourOnFloor, { bpm: 120, bars: 2 });
    expect(hits).toHaveLength(8);
  });

  it("Hits sind zeitlich sortiert (mehrere Parts)", () => {
    const p: PreviewPattern = {
      stepCount: 4,
      stepResolution: "1/16",
      bpm: 120,
      parts: [
        part({ sampleUrl: "hat.wav", steps: [
          { active: false }, { active: true }, { active: false }, { active: true },
        ] }),
        part({ sampleUrl: "kick.wav", steps: [
          { active: true }, { active: false }, { active: true }, { active: false },
        ] }),
      ],
    };
    const hits = computePatternPreviewHits(p, { bpm: 120 });
    const times = hits.map((h) => h.timeMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("previewDurationMs", () => {
  it("16 Steps @120 BPM 1/16 = 2000ms (1 Bar)", () => {
    expect(previewDurationMs(fourOnFloor, { bpm: 120 })).toBe(2000);
  });
});
