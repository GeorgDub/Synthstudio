/**
 * Synthstudio – applySourceTypeChange Tests (v2.54 / TASK-129 Welle 4)
 *
 * Verifiziert dass setPartSourceType bei Wechsel auf wavetable/fm die
 * synthParams sicherstellt damit der AudioEngine-Synth-Pfad spielt.
 */
import { describe, it, expect } from "vitest";
import { applySourceTypeChange } from "../../client/src/store/useDrumMachineStore";
import { DEFAULT_SYNTH_PARAMS } from "../../client/src/audio/SynthEngine";
import type { PatternData, PartData } from "../../client/src/audio/AudioEngine";

function makePart(id: string, sourceType?: "sample" | "wavetable" | "fm" | "granular"): PartData {
  return {
    id, name: id, sampleUrl: undefined,
    muted: false, soloed: false, volume: 1, pan: 0,
    stepResolution: undefined, steps: [],
    fx: {} as PartData["fx"],
    sourceType,
  };
}

function makePattern(id: string, parts: PartData[]): PatternData {
  return {
    id, name: id, parts,
    stepCount: 16, bpm: null, stepResolution: "1/16",
  } as PatternData;
}

describe("applySourceTypeChange — Sample → Wavetable (synthParams setzen)", () => {
  it("Setzt sourceType + DEFAULT_SYNTH_PARAMS mit mode=wavetable", () => {
    const part = makePart("p1", "sample");
    const [result] = applySourceTypeChange([makePattern("pat", [part])], "p1", "wavetable");
    const updated = result.parts[0];
    expect(updated.sourceType).toBe("wavetable");
    expect(updated.synthParams).toBeDefined();
    expect(updated.synthParams?.mode).toBe("wavetable");
    expect(updated.synthParams?.oscType).toBe(DEFAULT_SYNTH_PARAMS.oscType);
  });

  it("Setzt sourceType + DEFAULT_SYNTH_PARAMS mit mode=fm", () => {
    const part = makePart("p1", "sample");
    const [result] = applySourceTypeChange([makePattern("pat", [part])], "p1", "fm");
    const updated = result.parts[0];
    expect(updated.sourceType).toBe("fm");
    expect(updated.synthParams?.mode).toBe("fm");
    expect(updated.synthParams?.fmRatio).toBe(DEFAULT_SYNTH_PARAMS.fmRatio);
  });
});

describe("applySourceTypeChange — bestehende synthParams werden beibehalten", () => {
  it("Wavetable→FM: nur mode wechselt, oscType/ADSR/etc. unverändert", () => {
    const customSynth = {
      ...DEFAULT_SYNTH_PARAMS,
      mode: "wavetable" as const,
      oscType: "square" as OscillatorType,
      attack: 1.5,
      sustain: 0.42,
    };
    const part: PartData = { ...makePart("p1", "wavetable"), synthParams: customSynth };
    const [result] = applySourceTypeChange([makePattern("pat", [part])], "p1", "fm");
    const updated = result.parts[0];
    expect(updated.synthParams?.mode).toBe("fm");
    expect(updated.synthParams?.oscType).toBe("square");
    expect(updated.synthParams?.attack).toBe(1.5);
    expect(updated.synthParams?.sustain).toBe(0.42);
  });
});

describe("applySourceTypeChange — Sample/Granular: kein synthParams-Touch", () => {
  it("Sample→Sample: synthParams bleiben undefined", () => {
    const part = makePart("p1", "sample");
    const [result] = applySourceTypeChange([makePattern("pat", [part])], "p1", "sample");
    expect(result.parts[0].synthParams).toBeUndefined();
    expect(result.parts[0].sourceType).toBe("sample");
  });

  it("Wavetable→Sample: synthParams werden erhalten (User kann zurück-switchen)", () => {
    const part: PartData = {
      ...makePart("p1", "wavetable"),
      synthParams: { ...DEFAULT_SYNTH_PARAMS, attack: 0.99 },
    };
    const [result] = applySourceTypeChange([makePattern("pat", [part])], "p1", "sample");
    expect(result.parts[0].sourceType).toBe("sample");
    expect(result.parts[0].synthParams?.attack).toBe(0.99);
  });

  it("Sample→Granular: synthParams unangetastet (bleibt undefined)", () => {
    const part = makePart("p1", "sample");
    const [result] = applySourceTypeChange([makePattern("pat", [part])], "p1", "granular");
    expect(result.parts[0].sourceType).toBe("granular");
    expect(result.parts[0].synthParams).toBeUndefined();
  });
});

describe("applySourceTypeChange — Round-Trip Sample ↔ FM ↔ Wavetable", () => {
  it("Bewahrt synthParams beim Mehrfach-Switchen (User-Config bleibt erhalten)", () => {
    const part = makePart("p1", "sample");
    let patterns = [makePattern("pat", [part])];

    // 1. Sample → FM: synthParams werden initialisiert mit FM-Mode
    patterns = applySourceTypeChange(patterns, "p1", "fm");
    expect(patterns[0].parts[0].synthParams?.mode).toBe("fm");

    // 2. Custom-Edit simulieren — User tunt fmRatio
    patterns = patterns.map(p => ({
      ...p,
      parts: p.parts.map(pt => pt.id === "p1" && pt.synthParams
        ? { ...pt, synthParams: { ...pt.synthParams, fmRatio: 7 } }
        : pt),
    }));

    // 3. FM → Wavetable: mode wechselt, fmRatio=7 bleibt
    patterns = applySourceTypeChange(patterns, "p1", "wavetable");
    expect(patterns[0].parts[0].synthParams?.mode).toBe("wavetable");
    expect(patterns[0].parts[0].synthParams?.fmRatio).toBe(7);

    // 4. Zurück zu Sample → synthParams bleiben unangetastet
    patterns = applySourceTypeChange(patterns, "p1", "sample");
    expect(patterns[0].parts[0].sourceType).toBe("sample");
    expect(patterns[0].parts[0].synthParams?.fmRatio).toBe(7);
  });
});

describe("applySourceTypeChange — Cross-Pattern + Edge-Cases", () => {
  it("Update wirkt auf alle Patterns die den Part enthalten", () => {
    const part = makePart("p1", "sample");
    const patterns = [makePattern("pat1", [part]), makePattern("pat2", [part])];
    const result = applySourceTypeChange(patterns, "p1", "wavetable");
    for (const p of result) {
      expect(p.parts.find(pt => pt.id === "p1")?.sourceType).toBe("wavetable");
      expect(p.parts.find(pt => pt.id === "p1")?.synthParams?.mode).toBe("wavetable");
    }
  });

  it("Unbekannte partId → keine Änderung", () => {
    const part = makePart("p1", "sample");
    const result = applySourceTypeChange([makePattern("pat", [part])], "nicht-da", "fm");
    expect(result[0].parts[0]).toEqual(part);
  });

  it("Immutability: neue Array-Refs (kein In-Place-Update)", () => {
    const part = makePart("p1", "sample");
    const patterns = [makePattern("pat", [part])];
    const result = applySourceTypeChange(patterns, "p1", "fm");
    expect(result).not.toBe(patterns);
    expect(result[0]).not.toBe(patterns[0]);
    expect(result[0].parts).not.toBe(patterns[0].parts);
    // Original-Part unverändert
    expect(patterns[0].parts[0].sourceType).toBe("sample");
    expect(patterns[0].parts[0].synthParams).toBeUndefined();
  });
});
