import { describe, it, expect } from "vitest";
import {
  e2PatternToSynthstudio,
  E2_DEFAULT_NOTE,
} from "../../client/src/utils/korg/e2PatternToSynthstudio";
import { decodePatternBody } from "../../client/src/utils/korg/e2Sysex";
import { buildE2PatternBody } from "../../client/src/utils/e2sExport";

// Build a decoded pattern via the real writer -> decoder chain, then map it.
function decodedFrom(input: Parameters<typeof buildE2PatternBody>[0]) {
  return decodePatternBody(buildE2PatternBody(input));
}

describe("e2PatternToSynthstudio", () => {
  it("maps name, bpm and step-count (happy path)", () => {
    const p = e2PatternToSynthstudio(
      decodedFrom({ name: "IMPME", bpm: 140, stepLength: 32, parts: [] })
    );
    expect(p.name).toBe("IMPME");
    expect(p.bpm).toBeCloseTo(140, 1);
    expect(p.stepCount).toBe(32);
    expect(p.stepResolution).toBe("1/16");
    expect(p.parts).toHaveLength(16); // E2 always has 16 parts
  });

  it("maps active steps: active/velocity + pitch relative to E2 default note", () => {
    const decoded = decodedFrom({
      name: "STEPS",
      bpm: 120,
      stepLength: 16,
      parts: [
        {
          sampleId: 501,
          volume: 127,
          steps: [
            { active: true, note: E2_DEFAULT_NOTE, velocity: 80 }, // default note -> pitch 0
            { active: false },
            { active: true, note: E2_DEFAULT_NOTE + 7, velocity: 100 }, // +7 semitones
          ],
        },
      ],
    });
    const p = e2PatternToSynthstudio(decoded);
    const part0 = p.parts[0];
    expect(part0.name).toContain("#501");
    expect(part0.volume).toBeCloseTo(1, 2); // 127/127
    expect(part0.steps[0]).toMatchObject({
      active: true,
      velocity: 80,
      pitch: 0,
    });
    expect(part0.steps[1].active).toBe(false);
    expect(part0.steps[2]).toMatchObject({
      active: true,
      velocity: 100,
      pitch: 7,
    });
    // step arrays are the pattern length
    expect(part0.steps).toHaveLength(16);
  });

  it("maps part volume 0..127 -> 0..1 and pan 0..127 (64=center) -> -1..+1", () => {
    // Directly craft a decoded object (bypass writer) to control volume/pan.
    const decoded = {
      name: "MIX",
      bpm: 120,
      stepLength: 16,
      parts: Array.from({ length: 16 }, (_, i) => ({
        sampleRef: 0,
        volume: i === 0 ? 64 : 127,
        pan: i === 0 ? 0 : 127,
        steps: [],
        activeCount: 0,
      })),
    };
    const p = e2PatternToSynthstudio(decoded);
    expect(p.parts[0].volume).toBeCloseTo(64 / 127, 3);
    expect(p.parts[0].pan).toBeCloseTo(-1, 2); // pan 0 -> hard left
    expect(p.parts[1].pan).toBeCloseTo(127 / 64 - 1, 2); // ~+0.98 -> clamped <= 1
  });

  it("falls back to a name and null bpm on empty/invalid input (edge case)", () => {
    const p = e2PatternToSynthstudio(
      { name: "", bpm: 0, stepLength: 16, parts: [] },
      { fallbackName: "Fallback" }
    );
    expect(p.name).toBe("Fallback");
    expect(p.bpm).toBeNull(); // 0 BPM is out of the 20..300 range
    expect(p.parts).toHaveLength(0);
  });

  it("produces a PatternData the DrumMachine store shape expects", () => {
    const p = e2PatternToSynthstudio(
      decodedFrom({
        name: "SHAPE",
        bpm: 120,
        stepLength: 16,
        parts: [{ steps: [] }],
      })
    );
    // required PartData fields present
    for (const part of p.parts) {
      expect(part).toHaveProperty("id");
      expect(part).toHaveProperty("muted", false);
      expect(part).toHaveProperty("soloed", false);
      expect(part).toHaveProperty("fx");
      expect(Array.isArray(part.steps)).toBe(true);
    }
  });
});
