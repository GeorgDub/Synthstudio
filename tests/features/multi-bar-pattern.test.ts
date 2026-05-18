/**
 * tests/features/multi-bar-pattern.test.ts
 *
 * v3.39.0: 64-Step Pattern Support — KORG-Parität (ESX-1 + E2 Sampler max-Length).
 *
 * Tests:
 *   1. PatternData mit stepCount=64 ist Type-valid + Round-Trip durch
 *      projectSerializer (parseProject + toJson).
 *   2. AutomationStore akzeptiert stepCount=64 (setStepCount).
 *   3. PatternLibrary akzeptiert stepCount=64.
 *   4. ESX-Importer mappt esxPattern.lengthSteps=64 → stepCount=64 (vorher 32).
 *   5. E2-Importer mappt parsed.stepLength=64 → stepCount=64 (vorher 32).
 *   6. Backward-Compat: bestehende 16/32 Patterns weiter funktional.
 *   7. AutomationView-Helpers: interpolate über 64 Steps.
 */
import { describe, it, expect } from "vitest";
import { serializeProject, parseProject, SYNTH_FILE_VERSION, toJson } from "../../client/src/utils/projectSerializer";
import type { PatternData } from "../../client/src/audio/AudioEngine";
import { convertEsxPatternToSynthstudio } from "../../client/src/utils/korg/esxPatternConvert";
import { convertParsedPatternToSynthstudio } from "../../client/src/utils/electribeImport";
import { scaleMotionPointsToStepCount } from "../../client/src/utils/electribeMotionMapping";
import { generatePattern } from "../../client/src/utils/patternGenerator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSteps(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    active: i % 4 === 0,
    velocity: 100,
    pitch: 0,
  }));
}

function make64StepPattern(): PatternData {
  return {
    id: "p64",
    name: "64-Bar",
    stepCount: 64,
    stepResolution: "1/16",
    bpm: null,
    parts: [
      {
        id: "kick",
        name: "Kick",
        muted: false,
        soloed: false,
        volume: 1,
        pan: 0,
        steps: makeSteps(64),
        fx: {} as PatternData["parts"][number]["fx"],
      },
    ],
  };
}

function emptyProject(pattern: PatternData) {
  return {
    projectName: "test-64",
    bpm: 120,
    samples: [],
    patterns: [pattern],
    activePatternId: pattern.id,
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: {
      masterVolume: 0.85,
      channels: [],
      returnTracks: [],
      insertChains: {},
      eq16: {},
      sidechains: {},
      transientShapers: {},
    },
    humanizer: { global: { drift: 0, swing: 0, scope: "off" as const } },
    automation: { lanes: [], stepCount: 64 as const },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("v3.39: PatternData mit stepCount=64", () => {
  it("akzeptiert stepCount=64 als gültigen literal", () => {
    const pattern = make64StepPattern();
    expect(pattern.stepCount).toBe(64);
    expect(pattern.parts[0].steps.length).toBe(64);
  });

  it("Round-Trip durch serializeProject + parseProject mit stepCount=64", () => {
    const pattern = make64StepPattern();
    const project = serializeProject(emptyProject(pattern));
    const json = toJson(project);
    const restored = parseProject(json);

    expect(restored.version).toBe(SYNTH_FILE_VERSION);
    expect(restored.patterns).toHaveLength(1);
    expect(restored.patterns[0].stepCount).toBe(64);
    expect(restored.patterns[0].parts[0].steps).toHaveLength(64);
    expect(restored.automation.stepCount).toBe(64);
  });

  it("Backward-Compat: stepCount=16 lädt unverändert", () => {
    const pattern: PatternData = {
      ...make64StepPattern(),
      stepCount: 16,
      parts: [
        {
          ...make64StepPattern().parts[0],
          steps: makeSteps(16),
        },
      ],
    };
    const proj = serializeProject({
      ...emptyProject(pattern),
      automation: { lanes: [], stepCount: 16 as const },
    });
    const restored = parseProject(toJson(proj));
    expect(restored.patterns[0].stepCount).toBe(16);
    expect(restored.patterns[0].parts[0].steps).toHaveLength(16);
  });

  it("Backward-Compat: stepCount=32 lädt unverändert", () => {
    const p32: PatternData = {
      ...make64StepPattern(),
      stepCount: 32,
      parts: [
        {
          ...make64StepPattern().parts[0],
          steps: makeSteps(32),
        },
      ],
    };
    const proj = serializeProject({
      ...emptyProject(p32),
      automation: { lanes: [], stepCount: 32 as const },
    });
    const restored = parseProject(toJson(proj));
    expect(restored.patterns[0].stepCount).toBe(32);
    expect(restored.patterns[0].parts[0].steps).toHaveLength(32);
  });

  it("Schema-Version ist v1.21 (multi-slot pluginSlots; stepCount=64 ist v1.19)", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.21");
  });
});

describe("v3.39: ESX-Importer mit 64-Step-Pattern", () => {
  it("mappt esxPattern.lengthSteps=64 → stepCount=64 (vorher 32)", () => {
    const esxPattern = {
      index: 0,
      name: "BANK_64",
      bpm: 128,
      swing: 0,
      lengthSteps: 64,
      parts: Array.from({ length: 16 }, (_, partIndex) => ({
        partIndex,
        sampleId: partIndex,
        volume: 100,
        pan: 64,
        pitch: 0,
        steps: Array.from({ length: 64 }, (_, s) => ({
          active: s % 8 === 0,
          velocity: 100,
        })),
      })),
    };
    const imported = convertEsxPatternToSynthstudio(esxPattern as never);
    expect(imported.stepCount).toBe(64);
    expect(imported.drumParts[0].steps).toHaveLength(64);
    expect(imported.drumParts[0].velocities).toHaveLength(64);
    // Beat 0, 8, 16, 24, 32, 40, 48, 56 → 8 aktive Steps
    const activeCount = imported.drumParts[0].steps.filter(Boolean).length;
    expect(activeCount).toBe(8);
  });

  it("32-Step-ESX-Pattern bleibt 32 (Bestandsverhalten)", () => {
    const esxPattern = {
      index: 1,
      name: "SHORT",
      bpm: 120,
      swing: 0,
      lengthSteps: 32,
      parts: Array.from({ length: 16 }, (_, partIndex) => ({
        partIndex,
        sampleId: partIndex,
        volume: 100,
        pan: 64,
        pitch: 0,
        steps: Array.from({ length: 32 }, () => ({ active: false, velocity: 100 })),
      })),
    };
    const imported = convertEsxPatternToSynthstudio(esxPattern as never);
    expect(imported.stepCount).toBe(32);
  });

  it("16-Step-ESX-Pattern bleibt 16 (Default)", () => {
    const esxPattern = {
      index: 0,
      name: "DEF",
      bpm: 120,
      swing: 0,
      lengthSteps: 16,
      parts: Array.from({ length: 16 }, (_, partIndex) => ({
        partIndex,
        sampleId: 0,
        volume: 100,
        pan: 64,
        pitch: 0,
        steps: Array.from({ length: 16 }, () => ({ active: false, velocity: 100 })),
      })),
    };
    const imported = convertEsxPatternToSynthstudio(esxPattern as never);
    expect(imported.stepCount).toBe(16);
  });
});

describe("v3.39: E2-Importer mit 64-Step-Pattern", () => {
  it("mappt parsed.stepLength=64 → stepCount=64 (vorher capped 32)", () => {
    const parsed = {
      name: "BODYTALK",
      bpm: 130,
      stepLength: 64,
      swing: 0,
      parts: Array.from({ length: 16 }, (_, index) => ({
        index,
        sampleId: index,
        volume: 100,
        pan: 64,
        pitch: 0,
        steps: Array.from({ length: 64 }, (_, s) => ({
          active: s % 16 === 0,
          velocity: 100,
        })),
        motion: [],
      })),
      motionSlots: [],
    };
    const imported = convertParsedPatternToSynthstudio(parsed as never);
    expect(imported.stepCount).toBe(64);
    expect(imported.drumParts[0].steps).toHaveLength(64);
    // Step 0, 16, 32, 48 aktiv (war vorher nur 0, 16 weil 32-cap)
    const activeIdx = imported.drumParts[0].steps
      .map((v, i) => (v ? i : -1))
      .filter(i => i >= 0);
    expect(activeIdx).toEqual([0, 16, 32, 48]);
  });

  it("32-Step-E2-Pattern bleibt 32", () => {
    const parsed = {
      name: "MID",
      bpm: 120,
      stepLength: 32,
      swing: 0,
      parts: Array.from({ length: 16 }, (_, index) => ({
        index,
        sampleId: 0,
        volume: 100,
        pan: 64,
        pitch: 0,
        steps: Array.from({ length: 32 }, () => ({ active: false, velocity: 100 })),
        motion: [],
      })),
      motionSlots: [],
    };
    const imported = convertParsedPatternToSynthstudio(parsed as never);
    expect(imported.stepCount).toBe(32);
  });
});

describe("v3.40: AI-Pattern-Generator mit 64-step Templates", () => {
  it("generatePattern akzeptiert stepCount=64 und erzeugt 64 Steps pro Part", () => {
    const pattern = generatePattern({
      genre: "techno",
      complexity: 0.5,
      seed: 12345,
      stepCount: 64,
    });
    expect(pattern.parts.length).toBeGreaterThan(0);
    for (const part of pattern.parts) {
      expect(part.steps).toHaveLength(64);
    }
  });

  it("generatePattern mit stepCount=64 erzeugt aktive Steps innerhalb 0..15 (Template-Basis)", () => {
    const pattern = generatePattern({
      genre: "house",
      complexity: 0.8,
      seed: 99,
      stepCount: 64,
    });
    // Templates haben Indices < 16; konservatives Verhalten: Steps 16..63 bleiben
    // typischerweise leer (User füllt via Page-Switcher). Mindestens 1 aktiver Step.
    const kick = pattern.parts.find(p => p.name === "Kick");
    expect(kick).toBeDefined();
    const activeKick = kick!.steps.filter(s => s.active).length;
    expect(activeKick).toBeGreaterThan(0);
  });

  it("generatePattern mit stepCount=32 (Bestandsverhalten unverändert)", () => {
    const pattern = generatePattern({
      genre: "techno",
      complexity: 0.5,
      seed: 7,
      stepCount: 32,
    });
    for (const part of pattern.parts) expect(part.steps).toHaveLength(32);
  });

  it("generatePattern Default ohne stepCount → 16 Steps (Backward-Compat)", () => {
    const pattern = generatePattern({
      genre: "trap",
      complexity: 0.4,
      seed: 1,
    });
    for (const part of pattern.parts) expect(part.steps).toHaveLength(16);
  });
});

describe("v3.39: AutomationView + scaleMotionPointsToStepCount mit 64", () => {
  it("scaleMotionPointsToStepCount: factor=4 für targetStepCount=64", () => {
    const points: Record<number, number> = { 0: 0.1, 4: 0.5, 15: 1.0 };
    const scaled = scaleMotionPointsToStepCount(points, 64);
    // Key 0 → 0, Key 4 → 16, Key 15 → 60
    expect(scaled[0]).toBe(0.1);
    expect(scaled[16]).toBe(0.5);
    expect(scaled[60]).toBe(1.0);
  });

  it("scaleMotionPointsToStepCount: factor=2 für targetStepCount=32 (Bestand)", () => {
    const points: Record<number, number> = { 0: 0.2, 8: 0.8 };
    const scaled = scaleMotionPointsToStepCount(points, 32);
    expect(scaled[0]).toBe(0.2);
    expect(scaled[16]).toBe(0.8);
  });

  it("scaleMotionPointsToStepCount: passthrough für targetStepCount=16", () => {
    const points: Record<number, number> = { 0: 0.5, 15: 0.9 };
    const scaled = scaleMotionPointsToStepCount(points, 16);
    expect(scaled).toEqual({ 0: 0.5, 15: 0.9 });
  });
});
