import { describe, it, expect } from "vitest";
import {
  buildEsxImportPreview,
  previewEsxPattern,
  previewEsxSong,
} from "../../client/src/utils/imports/esxImportPreview";
import type {
  EsxBank,
  EsxPattern,
  EsxPart,
  EsxKeyboardPart,
  EsxSong,
  EsxSongEvent,
} from "../../client/src/utils/korg/esxParser";

function songEvent(pattern: number, length: number): EsxSongEvent {
  return { time: 0, pattern, length, flags: 0, data: 0 };
}

function song(
  index: number,
  events: EsxSongEvent[],
  name = `SONG${index}`
): EsxSong {
  return { index, name, bpm: 120, eventCount: events.length, events };
}

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

function bank(patterns: EsxPattern[], songs: EsxSong[] = []): EsxBank {
  return {
    source: "test.esx",
    monoSamples: [{}, {}, {}] as never,
    stereoSamples: [{}] as never,
    patterns,
    songs,
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
    expect(pv.songs).toEqual([]);
  });

  it("belegte Songs erscheinen, leere werden gefiltert", () => {
    const pv = buildEsxImportPreview(
      bank(
        [pattern(0, 16, { drums: [drumPart([0])] })],
        [
          song(0, [songEvent(5, 2), songEvent(70, 4)]), // 2 Slots (A + B)
          song(1, []), // leer → gefiltert
        ]
      )
    );
    expect(pv.songs).toHaveLength(1);
    expect(pv.songs[0]).toMatchObject({ index: 0, slotCount: 2 });
  });
});

describe("previewEsxSong", () => {
  it("Song mit Events → Slot-Count + Name + Index", () => {
    const pv = previewEsxSong(
      song(3, [songEvent(0, 1), songEvent(64, 2)], "MYSONG")
    );
    expect(pv).not.toBeNull();
    expect(pv!.index).toBe(3);
    expect(pv!.name).toBe("MYSONG");
    expect(pv!.slotCount).toBe(2);
  });

  it("Song ohne Events → null (aus der Vorschau gefiltert)", () => {
    expect(previewEsxSong(song(4, []))).toBeNull();
  });
});
