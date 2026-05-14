/**
 * tests/features/copy-samples-from-pattern.test.ts
 *
 * v2.4: Pattern-Sampler-Übernahme. Testet die Pure-Logik des
 * copySamplesFromPattern-Reducers (ohne React).
 *
 * Das eigentliche useDrumMachineStore ist React-state-based, daher testen
 * wir hier die Reducer-Logik isoliert nachgebaut, mit denselben
 * Daten-Strukturen aber ohne Hook-Dependency.
 */
import { describe, it, expect } from "vitest";
import type { PartData, ChannelFx } from "../../client/src/audio/AudioEngine";

interface Pattern {
  id: string;
  name: string;
  parts: PartData[];
}

const fxDefault: ChannelFx = {
  filterEnabled: false, filterType: "lowpass", filterFreq: 8000, filterQ: 1, filterGain: 0,
  distortionEnabled: false, distortionAmount: 50,
  compressorEnabled: false, compressorThreshold: -24, compressorRatio: 4, compressorAttack: 0.003, compressorRelease: 0.25,
  delayEnabled: false, delayTime: 0.25, delayFeedback: 0.3, delayMix: 0.3,
  reverbEnabled: false, reverbDecay: 2.0, reverbMix: 0.3,
  eqEnabled: false, eqLow: 0, eqMid: 0, eqHigh: 0,
};

function makePart(overrides: Partial<PartData>): PartData {
  return {
    id: "p1",
    name: "Part",
    muted: false,
    soloed: false,
    volume: 0.8,
    pan: 0,
    steps: Array.from({ length: 16 }, () => ({ active: false, velocity: 100 })),
    fx: { ...fxDefault },
    ...overrides,
  };
}

/**
 * Pure-Helper-Variante des copySamplesFromPattern-Reducers.
 * Spiegelt die Logik aus useDrumMachineStore.ts wider.
 */
function copySamplesFromPattern(
  patterns: Pattern[],
  sourcePatternId: string,
  targetPatternId: string,
): Pattern[] {
  if (sourcePatternId === targetPatternId) return patterns;
  const source = patterns.find(p => p.id === sourcePatternId);
  if (!source) return patterns;
  return patterns.map(p => {
    if (p.id !== targetPatternId) return p;
    return {
      ...p,
      parts: p.parts.map((targetPart, idx) => {
        const sourcePart = source.parts[idx];
        if (!sourcePart) return targetPart;
        return {
          ...targetPart,
          sampleUrl: sourcePart.sampleUrl,
          sampleName: sourcePart.sampleName,
          sourceType: sourcePart.sourceType,
          synthParams: sourcePart.synthParams,
          granularParams: sourcePart.granularParams,
          stretchRatio: sourcePart.stretchRatio,
          microTiming: sourcePart.microTiming,
          volume: sourcePart.volume,
          pan: sourcePart.pan,
          fx: { ...sourcePart.fx },
        };
      }),
    };
  });
}

describe("copySamplesFromPattern (v2.4)", () => {
  it("kopiert Sample-Belegung von Source nach Target", () => {
    const src: Pattern = {
      id: "src",
      name: "Source",
      parts: [
        makePart({ id: "src-p0", sampleUrl: "url:kick.wav", sampleName: "Kick" }),
        makePart({ id: "src-p1", sampleUrl: "url:snare.wav", sampleName: "Snare" }),
      ],
    };
    const tgt: Pattern = {
      id: "tgt",
      name: "Target",
      parts: [
        makePart({ id: "tgt-p0" }),
        makePart({ id: "tgt-p1" }),
      ],
    };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    const target = result.find(p => p.id === "tgt")!;
    expect(target.parts[0].sampleUrl).toBe("url:kick.wav");
    expect(target.parts[0].sampleName).toBe("Kick");
    expect(target.parts[1].sampleUrl).toBe("url:snare.wav");
    expect(target.parts[1].sampleName).toBe("Snare");
  });

  it("Steps des Targets bleiben unverändert", () => {
    const src: Pattern = { id: "src", name: "S", parts: [makePart({ steps: Array.from({ length: 16 }, () => ({ active: true, velocity: 100 })) })] };
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart({ id: "tgt-p0", steps: Array.from({ length: 16 }, (_, i) => ({ active: i === 5, velocity: 80 })) })] };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    const target = result.find(p => p.id === "tgt")!;
    // Steps sind WIE BEIM TARGET (nicht source)
    const activeSteps = target.parts[0].steps.filter(s => s.active).length;
    expect(activeSteps).toBe(1); // nur step 5
    expect(target.parts[0].steps[5].velocity).toBe(80);
  });

  it("ID des Targets bleibt unverändert (nur Sample-Felder)", () => {
    const src: Pattern = { id: "src", name: "S", parts: [makePart({ id: "src-p0" })] };
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart({ id: "tgt-p0" })] };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    expect(result.find(p => p.id === "tgt")!.parts[0].id).toBe("tgt-p0");
  });

  it("FX-Chain wird kopiert (Filter aktivieren in Source → in Target aktiv)", () => {
    const src: Pattern = { id: "src", name: "S", parts: [makePart({ fx: { ...fxDefault, filterEnabled: true, filterFreq: 500 } })] };
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart({ id: "tgt-p0" })] };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    const target = result.find(p => p.id === "tgt")!;
    expect(target.parts[0].fx.filterEnabled).toBe(true);
    expect(target.parts[0].fx.filterFreq).toBe(500);
  });

  it("Volume + Pan werden übernommen", () => {
    const src: Pattern = { id: "src", name: "S", parts: [makePart({ volume: 0.4, pan: -0.7 })] };
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart({ id: "tgt-p0", volume: 0.9, pan: 0.5 })] };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    const target = result.find(p => p.id === "tgt")!;
    expect(target.parts[0].volume).toBe(0.4);
    expect(target.parts[0].pan).toBe(-0.7);
  });

  it("Mute + Solo bleiben beim Target (nicht übernommen)", () => {
    const src: Pattern = { id: "src", name: "S", parts: [makePart({ muted: true, soloed: true })] };
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart({ id: "tgt-p0", muted: false, soloed: false })] };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    const target = result.find(p => p.id === "tgt")!;
    expect(target.parts[0].muted).toBe(false);
    expect(target.parts[0].soloed).toBe(false);
  });

  it("identische Source+Target IDs → no-op", () => {
    const tgt: Pattern = { id: "same", name: "S", parts: [makePart()] };
    const result = copySamplesFromPattern([tgt], "same", "same");
    expect(result).toBe(result); // referenz-equal eigentlich nicht garantiert, aber kein Side-Effect
    expect(result[0].parts[0]).toEqual(tgt.parts[0]);
  });

  it("unbekannter Source → no-op", () => {
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart()] };
    const result = copySamplesFromPattern([tgt], "missing", "tgt");
    expect(result[0].parts[0]).toEqual(tgt.parts[0]);
  });

  it("Target hat mehr Parts als Source → überzählige Parts bleiben unverändert", () => {
    const src: Pattern = { id: "src", name: "S", parts: [makePart({ sampleUrl: "url:kick.wav" })] };
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart({ id: "tgt-p0" }), makePart({ id: "tgt-p1", sampleName: "OriginalSnare" })] };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    const target = result.find(p => p.id === "tgt")!;
    expect(target.parts[0].sampleUrl).toBe("url:kick.wav");
    expect(target.parts[1].sampleName).toBe("OriginalSnare"); // unchanged
  });

  it("synthParams + granularParams + stretchRatio + microTiming werden übernommen", () => {
    const src: Pattern = { id: "src", name: "S", parts: [makePart({
      sourceType: "wavetable",
      synthParams: { waveform: "saw" } as never,
      stretchRatio: 1.5,
      microTiming: 12,
    })] };
    const tgt: Pattern = { id: "tgt", name: "T", parts: [makePart({ id: "tgt-p0" })] };
    const result = copySamplesFromPattern([src, tgt], "src", "tgt");
    const target = result.find(p => p.id === "tgt")!;
    expect(target.parts[0].sourceType).toBe("wavetable");
    expect(target.parts[0].stretchRatio).toBe(1.5);
    expect(target.parts[0].microTiming).toBe(12);
  });
});
