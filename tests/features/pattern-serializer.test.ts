/**
 * tests/features/pattern-serializer.test.ts (v3.169.0)
 *
 * Pure-Coverage fuer client/src/utils/patternSerializer.ts.
 *
 * Alle Funktionen sind side-effect-frei (ausser new Date().toISOString() im
 * serialize-Pfad). Wir pruefen den Round-Trip, nicht den Timestamp.
 */
import { describe, it, expect } from "vitest";
import {
  serializePattern,
  parsePattern,
  defaultPatternFilename,
  PATTERN_EXPORT_MAGIC,
  PATTERN_EXPORT_SCHEMA_VERSION,
  type PatternExportEnvelope,
} from "@/utils/patternSerializer";
import type { PatternData, StepData } from "@/audio/AudioEngine";

function makePattern(): PatternData {
  return {
    id: "test-id",
    name: "Test Pattern",
    stepCount: 16 as const,
    stepResolution: "1/16" as any,
    bpm: 120,
    parts: [
      {
        id: "p1",
        name: "Kick",
        muted: false,
        soloed: false,
        volume: 1,
        pan: 0,
        steps: [
          { active: true },  { active: false }, { active: false }, { active: false },
          { active: true },  { active: false }, { active: false }, { active: false },
          { active: true },  { active: false }, { active: false }, { active: false },
          { active: true },  { active: false }, { active: false }, { active: false },
        ],
      },
    ] as any,
  };
}

function makePatternWithVelocities(): PatternData {
  const steps: StepData[] = [];
  for (let i = 0; i < 16; i++) {
    steps.push({
      active: i % 4 === 0,
      velocity: i === 0 ? 64 : 100,
    });
  }
  return {
    id: "vel-id",
    name: "Vel Pattern",
    stepCount: 16 as const,
    stepResolution: "1/16" as any,
    bpm: 100,
    parts: [
      {
        id: "p1",
        name: "Snare",
        muted: false,
        soloed: false,
        volume: 0.8,
        pan: -0.2,
        steps,
      },
    ] as any,
  };
}

describe("serializePattern", () => {
  it("round-trip serialize parse liefert gleiche stepBits name bpm", () => {
    const original = makePattern();
    const json = serializePattern(original);
    const parsed = parsePattern(json);

    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Test Pattern");
    expect(parsed!.bpm).toBe(120);
    expect(parsed!.stepCount).toBe(16);
    expect(parsed!.parts).toHaveLength(1);
    expect(parsed!.parts[0].name).toBe("Kick");

    const activeIndices = parsed!.parts[0].steps
      .map((s, i) => (s.active ? i : -1))
      .filter((i) => i >= 0);
    expect(activeIndices).toEqual([0, 4, 8, 12]);
  });

  it("ID wird gestripped envelope.pattern hat kein id-field", () => {
    const original = makePattern();
    const json = serializePattern(original);
    const envelope = JSON.parse(json) as PatternExportEnvelope;

    expect(envelope.pattern).not.toHaveProperty("id");
    expect(envelope.pattern.parts[0].id).toBe("p1");
  });

  it("velocities werden weggelassen wenn alle default 100", () => {
    const original = makePattern();
    const json = serializePattern(original);
    const envelope = JSON.parse(json) as PatternExportEnvelope;

    expect(envelope.pattern.parts[0].velocities).toBeUndefined();
  });

  it("velocities werden exportiert wenn mind eine abweicht", () => {
    const original = makePatternWithVelocities();
    const json = serializePattern(original);
    const envelope = JSON.parse(json) as PatternExportEnvelope;

    expect(envelope.pattern.parts[0].velocities).toBeDefined();
    expect(envelope.pattern.parts[0].velocities!.length).toBe(16);
    expect(envelope.pattern.parts[0].velocities![0]).toBe(64);
    expect(envelope.pattern.parts[0].velocities![1]).toBe(100);
  });

  it("envelope hat magic schemaVersion exportedAt", () => {
    const json = serializePattern(makePattern());
    const envelope = JSON.parse(json) as PatternExportEnvelope;

    expect(envelope.magic).toBe(PATTERN_EXPORT_MAGIC);
    expect(envelope.schemaVersion).toBe(PATTERN_EXPORT_SCHEMA_VERSION);
    expect(typeof envelope.exportedAt).toBe("string");
    expect(envelope.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("parsePattern", () => {
  it("round-trip stepBits werden korrekt zu boolean array", () => {
    const json = serializePattern(makePattern());
    const parsed = parsePattern(json);

    expect(parsed).not.toBeNull();
    const steps = parsed!.parts[0].steps;
    expect(steps[0].active).toBe(true);
    expect(steps[1].active).toBe(false);
    expect(steps[4].active).toBe(true);
    expect(steps[12].active).toBe(true);
    expect(steps[15].active).toBe(false);
  });

  it("round-trip velocities werden in steps wieder eingelesen", () => {
    const json = serializePattern(makePatternWithVelocities());
    const parsed = parsePattern(json);

    expect(parsed).not.toBeNull();
    expect(parsed!.parts[0].steps[0].velocity).toBe(64);
    expect(parsed!.parts[0].steps[1].velocity).toBe(100);
  });

  it("invalid JSON null", () => {
    expect(parsePattern("not-json-at-all")).toBeNull();
    expect(parsePattern("{")).toBeNull();
    expect(parsePattern("")).toBeNull();
  });

  it("missing magic null", () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      pattern: { name: "X", stepCount: 16, bpm: 120, parts: [] },
    });
    expect(parsePattern(bad)).toBeNull();
  });

  it("wrong schemaVersion null", () => {
    const bad = JSON.stringify({
      magic: PATTERN_EXPORT_MAGIC,
      schemaVersion: 999,
      exportedAt: new Date().toISOString(),
      pattern: { name: "X", stepCount: 16, bpm: 120, parts: [] },
    });
    expect(parsePattern(bad)).toBeNull();
  });

  it("stepBits length mismatch null", () => {
    const bad = JSON.stringify({
      magic: PATTERN_EXPORT_MAGIC,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      pattern: {
        name: "X",
        stepCount: 16,
        bpm: 120,
        parts: [
          {
            id: "p1",
            name: "Kick",
            stepBits: "10101010",
            muted: false,
            soloed: false,
            volume: 1,
            pan: 0,
          },
        ],
      },
    });
    expect(parsePattern(bad)).toBeNull();
  });

  it("invalid bpm negativ null", () => {
    const bad = JSON.stringify({
      magic: PATTERN_EXPORT_MAGIC,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      pattern: {
        name: "X",
        stepCount: 16,
        bpm: -100,
        parts: [],
      },
    });
    expect(parsePattern(bad)).toBeNull();
  });

  it("missing pattern.name null", () => {
    const bad = JSON.stringify({
      magic: PATTERN_EXPORT_MAGIC,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      pattern: {
        stepCount: 16,
        bpm: 120,
        parts: [],
      },
    });
    expect(parsePattern(bad)).toBeNull();
  });

  it("bpm null bleibt null verwendet globales BPM", () => {
    const env: PatternExportEnvelope = {
      magic: PATTERN_EXPORT_MAGIC,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      pattern: {
        name: "NullBpm",
        stepCount: 8,
        bpm: null,
        parts: [
          {
            id: "p1",
            name: "K",
            stepBits: "10001000",
            muted: false,
            soloed: false,
            volume: 1,
            pan: 0,
          },
        ],
      },
    };
    const parsed = parsePattern(JSON.stringify(env));
    expect(parsed).not.toBeNull();
    expect(parsed!.bpm).toBeNull();
    expect(parsed!.stepCount).toBe(8);
    expect(parsed!.parts[0].steps.map((s) => s.active)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("invalid stepBits null", () => {
    const bad = JSON.stringify({
      magic: PATTERN_EXPORT_MAGIC,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      pattern: {
        name: "X",
        stepCount: 4,
        bpm: 120,
        parts: [
          {
            id: "p1",
            name: "K",
            stepBits: "12X0",
            muted: false,
            soloed: false,
            volume: 1,
            pan: 0,
          },
        ],
      },
    });
    expect(parsePattern(bad)).toBeNull();
  });
});

describe("defaultPatternFilename", () => {
  it("sanitize sample with space and bang", () => {
    expect(defaultPatternFilename("My Pattern!")).toBe(
      "My-Pattern-.synth-pattern.json",
    );
  });

  it("fallback bei empty zu pattern-default", () => {
    expect(defaultPatternFilename("")).toBe("pattern.synth-pattern.json");
  });

  it("erlaubte chars bleiben erhalten", () => {
    expect(defaultPatternFilename("Verse_A-01")).toBe(
      "Verse_A-01.synth-pattern.json",
    );
  });
});
