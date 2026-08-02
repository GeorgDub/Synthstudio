import { describe, it, expect } from "vitest";
import { buildE2ExportGuide } from "../../client/src/utils/e2ExportGuide";
import { DEFAULT_CHANNEL_FX } from "../../client/src/audio/AudioEngine";
import type { PatternData, PartData, StepData } from "../../client/src/audio/AudioEngine";

// v3.314: Der Sequenzer→E2-Export bekommt eine Zuweisungsdatei — Sample-
// Zuordnung + Channel-FX stehen nicht im .e2spat-Format und müssen am
// Gerät nachgebaut werden.

function step(active: boolean): StepData {
  return { active, velocity: 100 } as StepData;
}

function part(over: Partial<PartData>): PartData {
  return {
    id: "p",
    name: "Part",
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps: [step(true)],
    fx: { ...DEFAULT_CHANNEL_FX },
    ...over,
  } as PartData;
}

function pattern(parts: PartData[], name = "Test"): PatternData {
  return {
    id: "pat",
    name,
    stepCount: 16,
    stepResolution: "16",
    bpm: 128,
    parts,
  } as unknown as PatternData;
}

describe("buildE2ExportGuide", () => {
  it("listet aktive Parts mit Sample, E2-Level/Pan und aktivierten FX", () => {
    const p1 = part({
      name: "Kick",
      sampleName: "BiG_KiCkX.wav",
      volume: 0.5,
      pan: -1,
      fx: {
        ...DEFAULT_CHANNEL_FX,
        compressorEnabled: true,
        compressorThreshold: -20,
        compressorRatio: 4,
        reverbEnabled: true,
        reverbDecay: 2.5,
        reverbMix: 0.3,
      },
    });
    const silent = part({ name: "Leer", steps: [step(false)] });
    const md = buildE2ExportGuide([pattern([p1, silent], "Banger")], {
      title: "test.e2spat",
    });

    expect(md).toContain("test.e2spat");
    expect(md).toContain("Banger");
    expect(md).toContain("BiG_KiCkX.wav");
    expect(md).toContain("| 1 |"); // Part 1
    expect(md).toContain("| 64 |"); // volume 0.5 → E2 64
    expect(md).toContain("| 1 |"); // pan -1 → E2 1
    expect(md).toContain("IFX Compressor");
    expect(md).toContain("MFX Hall/Plate");
    // Part ohne aktive Steps taucht nicht auf
    expect(md).not.toContain("Leer");
  });

  it("Synth-Parts ohne Sample werden als Synth-Quelle gelabelt", () => {
    const p = part({ name: "Lead", sourceType: "wavetable", sampleName: undefined });
    const md = buildE2ExportGuide([pattern([p])]);
    expect(md).toContain("[wavetable-Synth]");
  });

  it("leerer Export → Hinweis statt leerer Tabellen", () => {
    const md = buildE2ExportGuide([pattern([part({ steps: [step(false)] })])]);
    expect(md).toContain("Keine Parts mit aktiven Steps");
  });
});
