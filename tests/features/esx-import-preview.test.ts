import { describe, it, expect } from "vitest";
import {
  buildEsxImportPreview,
  previewEsxPattern,
} from "../../client/src/utils/imports/esxImportPreview";
import type {
  EsxBank,
  EsxPattern,
  EsxPart,
  EsxKeyboardPart,
} from "../../client/src/utils/korg/esxParser";

function drumPart(activeSteps: number[]): EsxPart {
  const steps = Array.from({ length: 16 }, (_, i) => ({
    active: activeSteps.includes(i),
    velocity: activeSteps.includes(i) ? 100 : 0,
  }));
  return {
    partIndex: 0,
    sampleId: 1,
    volume: 100,
    pan: 64,
    pitch: 0,
    fxAmount: 0,
    steps,
  };
}

function keyboardPart(firstNote: number): EsxKeyboardPart {
  const note = new Uint8Array(128);
  note[0] = firstNote;
  return {
    partIndex: 0,
    sampleId: 1,
    volume: 100,
    pan: 64,
    note,
    gate: new Uint8Array(128),
  };
}

function pattern(
  index: number,
  effectiveSteps: number,
  opts: {
    drums?: EsxPart[];
    keyboards?: EsxKeyboardPart[];
    bpm?: number;
    name?: string;
  } = {}
): EsxPattern {
  return {
    index,
    name: opts.name ?? `PAT${index}`,
    bpm: opts.bpm ?? 120,
    lengthSteps: 16,
    patternLength: effectiveSteps / 16,
    effectiveSteps,
    swing: 0,
    parts: opts.drums ?? [],
    keyboardParts: opts.keyboards ?? [],
  };
}

function bank(patterns: EsxPattern[]): EsxBank {
  return {
    source: "test.esx",
    monoSamples: [{}, {}, {}] as never,
    stereoSamples: [{}] as never,
    patterns,
    songs: [],
    declaredMonoCount: 3,
    declaredStereoCount: 1,
    warnings: ["w1"],
  };
}

describe("previewEsxPattern", () => {
  it("16-Step-Pattern → keine Reduktion nötig", () => {
    const pv = previewEsxPattern(
      pattern(0, 16, { drums: [drumPart([0, 4, 8, 12])] })
    );
    expect(pv.effectiveSteps).toBe(16);
    expect(pv.needsReduction).toBe(false);
    expect(pv.activeDrumParts).toBe(1);
    expect(pv.hasMelody).toBe(false);
  });

  it("128-Step-Pattern → Reduktion nötig (E2S max 64)", () => {
    const pv = previewEsxPattern(
      pattern(1, 128, { keyboards: [keyboardPart(60)] })
    );
    expect(pv.effectiveSteps).toBe(128);
    expect(pv.needsReduction).toBe(true);
    expect(pv.hasMelody).toBe(true);
  });

  it("64-Step-Pattern → gerade noch ohne Reduktion", () => {
    expect(previewEsxPattern(pattern(2, 64)).needsReduction).toBe(false);
  });
});

describe("buildEsxImportPreview", () => {
  it("zählt Patterns, Samples und Reduktions-Kandidaten", () => {
    const pv = buildEsxImportPreview(
      bank([
        pattern(0, 16, { drums: [drumPart([0])] }),
        pattern(1, 128, { keyboards: [keyboardPart(60)] }),
        pattern(2, 128),
        pattern(3, 32),
      ])
    );
    expect(pv.patternCount).toBe(4);
    expect(pv.monoSamples).toBe(3);
    expect(pv.stereoSamples).toBe(1);
    expect(pv.patternsNeedingReduction).toBe(2); // die beiden 128er
    expect(pv.warnings).toEqual(["w1"]);
  });

  it("leerer Bank → leere Vorschau", () => {
    const pv = buildEsxImportPreview(bank([]));
    expect(pv.patternCount).toBe(0);
    expect(pv.patternsNeedingReduction).toBe(0);
  });
});
