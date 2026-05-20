/**
 * tests/features/pattern-midi-export.test.ts (v3.173.0)
 */
import { describe, it, expect } from "vitest";
import {
  patternToMidiEvents,
  GM_DRUM_MAP,
} from "../../client/src/utils/patternMidiExport";
import type { PatternData } from "../../client/src/audio/AudioEngine";

type StepSpec = boolean | { active: boolean; velocity?: number };

function makePattern(
  parts: Array<{ steps: StepSpec[] }>,
  stepCount: 16 | 32 | 64 = 16,
): PatternData {
  const builtParts = parts.map((p, i) => ({
    id: "p" + i,
    name: "Part " + i,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps: p.steps.map((s) =>
      typeof s === "boolean" ? { active: s } : s,
    ),
    fx: {},
  }));
  const pattern = {
    id: "test",
    name: "Test",
    stepCount,
    stepResolution: "1/16",
    bpm: 120,
    parts: builtParts,
  };
  return pattern as unknown as PatternData;
}

describe("patternToMidiEvents", () => {
  it("liefert events:[] bei leerem Pattern (keine parts)", () => {
    const pattern = makePattern([]);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toEqual([]);
    expect(result.totalTicks).toBe(16 * 120);
    expect(result.ppqn).toBe(480);
  });

  it("liefert events:[] wenn alle Steps inaktiv", () => {
    const pattern = makePattern([
      { steps: [false, false, false, false] },
      { steps: [false, false] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toEqual([]);
  });

  it("Single part, 1 active step (idx 0) liefert 1 event mit tickPos=0", () => {
    const pattern = makePattern([{ steps: [true, false, false, false] }]);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].tickPos).toBe(0);
    expect(result.events[0].note).toBe(GM_DRUM_MAP[0]);
    expect(result.events[0].partIndex).toBe(0);
  });

  it("Pattern mit 4 active steps liefert 4 events sortiert by tickPos", () => {
    const pattern = makePattern([
      { steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toHaveLength(4);
    expect(result.events.map((e) => e.tickPos)).toEqual([0, 480, 960, 1440]);
  });

  it("Multi-part Pattern hat events von verschiedenen parts mit verschiedenen note-nums", () => {
    const pattern = makePattern([
      { steps: [true] },
      { steps: [true] },
      { steps: [true] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({ tickPos: 0, partIndex: 0, note: 36 });
    expect(result.events[1]).toMatchObject({ tickPos: 0, partIndex: 1, note: 38 });
    expect(result.events[2]).toMatchObject({ tickPos: 0, partIndex: 2, note: 42 });
  });

  it("partIndex in event korrekt gesetzt", () => {
    const pattern = makePattern([
      { steps: [false] },
      { steps: [false] },
      { steps: [true] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].partIndex).toBe(2);
  });

  it("velocity default 100 wenn Step keine velocity hat", () => {
    const pattern = makePattern([{ steps: [{ active: true }] }]);
    const result = patternToMidiEvents(pattern);
    expect(result.events[0].velocity).toBe(100);
  });

  it("velocity aus step uebernommen wenn gesetzt", () => {
    const pattern = makePattern([
      { steps: [{ active: true, velocity: 64 }] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events[0].velocity).toBe(64);
  });

  it("velocity=0 wird auf 1 geclamped (MIDI 0 = note-off)", () => {
    const pattern = makePattern([
      { steps: [{ active: true, velocity: 0 }] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events[0].velocity).toBe(1);
  });

  it("velocity > 127 wird auf 127 geclamped", () => {
    const pattern = makePattern([
      { steps: [{ active: true, velocity: 200 }] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events[0].velocity).toBe(127);
  });

  it("ppqn=960 ergibt ticksPerStep = 240", () => {
    const pattern = makePattern([
      { steps: [true, false, true] },
    ]);
    const result = patternToMidiEvents(pattern, { ppqn: 960 });
    expect(result.ppqn).toBe(960);
    expect(result.events.map((e) => e.tickPos)).toEqual([0, 480]);
    expect(result.events[0].tickDuration).toBe(240);
  });

  it("custom partToNoteMap ueberschreibt GM_DRUM_MAP", () => {
    const customMap = [60, 61, 62, 63];
    const pattern = makePattern([
      { steps: [true] },
      { steps: [true] },
    ]);
    const result = patternToMidiEvents(pattern, { partToNoteMap: customMap });
    expect(result.events[0].note).toBe(60);
    expect(result.events[1].note).toBe(61);
  });

  it("partToNoteMap zu kurz faellt zurueck auf GM_DRUM_MAP", () => {
    const customMap = [60];
    const pattern = makePattern([
      { steps: [true] },
      { steps: [true] },
    ]);
    const result = patternToMidiEvents(pattern, { partToNoteMap: customMap });
    expect(result.events[0].note).toBe(60);
    expect(result.events[1].note).toBe(38);
  });

  it("GM_DRUM_MAP hat 16 Eintraege mit gueltigen MIDI-Notes 0..127", () => {
    expect(GM_DRUM_MAP).toHaveLength(16);
    for (const note of GM_DRUM_MAP) {
      expect(note).toBeGreaterThanOrEqual(0);
      expect(note).toBeLessThanOrEqual(127);
      expect(Number.isInteger(note)).toBe(true);
    }
  });

  it("events sortiert by tickPos ascending, secondary partIndex", () => {
    const pattern = makePattern([
      { steps: [false, true] },
      { steps: [true, false] },
    ]);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ tickPos: 0, partIndex: 1 });
    expect(result.events[1]).toMatchObject({ tickPos: 120, partIndex: 0 });
  });

  it("totalTicks = stepCount * ticksPerStep", () => {
    const pattern = makePattern([{ steps: [] }], 32);
    const result = patternToMidiEvents(pattern);
    expect(result.totalTicks).toBe(32 * 120);
    expect(result.ticksPerBar).toBe(result.totalTicks);
  });

  it("ungueltige ppqn (0, NaN, negativ) faellt zurueck auf 480", () => {
    const pattern = makePattern([{ steps: [true] }]);
    expect(patternToMidiEvents(pattern, { ppqn: 0 }).ppqn).toBe(480);
    expect(patternToMidiEvents(pattern, { ppqn: -100 }).ppqn).toBe(480);
    expect(patternToMidiEvents(pattern, { ppqn: NaN }).ppqn).toBe(480);
  });

  it("ungueltige stepsPerQuarter faellt zurueck auf 4", () => {
    const pattern = makePattern([{ steps: [true, false, false, false, true] }]);
    const result = patternToMidiEvents(pattern, { stepsPerQuarter: 0 });
    expect(result.events[0].tickPos).toBe(0);
    expect(result.events[1].tickPos).toBe(480);
  });

  it("custom noteDurationTicks ueberschreibt default", () => {
    const pattern = makePattern([{ steps: [true] }]);
    const result = patternToMidiEvents(pattern, { noteDurationTicks: 60 });
    expect(result.events[0].tickDuration).toBe(60);
  });

  it("custom defaultVelocity", () => {
    const pattern = makePattern([{ steps: [{ active: true }] }]);
    const result = patternToMidiEvents(pattern, { defaultVelocity: 80 });
    expect(result.events[0].velocity).toBe(80);
  });

  it("Part-Index > 15 faellt zurueck auf 60 (Middle-C)", () => {
    const parts: Array<{ steps: StepSpec[] }> = [];
    for (let i = 0; i < 17; i++) {
      parts.push({ steps: i === 16 ? [true] : [false] });
    }
    const pattern = makePattern(parts);
    const result = patternToMidiEvents(pattern);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].note).toBe(60);
  });
});
