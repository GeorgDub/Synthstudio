/**
 * tests/features/fx-param-bindings.test.ts
 *
 * v1.76: FX-Parameter als MidiLearnTarget bindbar.
 * Pure-Test der Range-Mapping-Helper aus `client/src/audio/AudioEngine.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  FX_PARAM_RANGES,
  findFxParamRange,
  midiValueToFxParam,
} from "../../client/src/audio/AudioEngine";

describe("FX_PARAM_RANGES (v1.76)", () => {
  it("enthält die wichtigen Filter/Reverb/Delay/EQ-Params", () => {
    const params = FX_PARAM_RANGES.map((r) => r.param);
    // Filter
    expect(params).toContain("filterFreq");
    expect(params).toContain("filterQ");
    // Reverb
    expect(params).toContain("reverbDecay");
    expect(params).toContain("reverbMix");
    // Delay
    expect(params).toContain("delayTime");
    expect(params).toContain("delayFeedback");
    expect(params).toContain("delayMix");
    // EQ
    expect(params).toContain("eqLow");
    expect(params).toContain("eqMid");
    expect(params).toContain("eqHigh");
    // Distortion + Compressor
    expect(params).toContain("distortionAmount");
    expect(params).toContain("compressorThreshold");
  });

  it("jeder Range hat valides min < max", () => {
    FX_PARAM_RANGES.forEach((r) => {
      expect(r.min).toBeLessThan(r.max);
      expect(r.label.length).toBeGreaterThan(0);
    });
  });

  it("filterFreq ist als exponential markiert (log-scale für Frequenz)", () => {
    const r = findFxParamRange("filterFreq");
    expect(r?.exponential).toBe(true);
  });

  it("findFxParamRange findet existierende Params", () => {
    expect(findFxParamRange("delayMix")?.min).toBe(0);
    expect(findFxParamRange("delayMix")?.max).toBe(1);
  });

  it("findFxParamRange gibt undefined für unbekannte Params", () => {
    // @ts-expect-error - bewusst ungültiger Wert
    expect(findFxParamRange("nicht-existent")).toBeUndefined();
  });
});

describe("midiValueToFxParam (v1.76)", () => {
  it("linear: MIDI 0 → min, MIDI 127 → max", () => {
    const range = { param: "delayMix" as const, label: "Delay Wet", min: 0, max: 1 };
    expect(midiValueToFxParam(0, range)).toBe(0);
    expect(midiValueToFxParam(127, range)).toBe(1);
  });

  it("linear: MIDI 64 → ungefähr Mitte des Range", () => {
    const range = { param: "delayMix" as const, label: "Delay Wet", min: 0, max: 1 };
    expect(midiValueToFxParam(64, range)).toBeCloseTo(0.5, 1);
  });

  it("linear: negative Min werden korrekt skaliert (EQ -15..+15)", () => {
    const range = { param: "eqLow" as const, label: "EQ Low", min: -15, max: 15 };
    expect(midiValueToFxParam(0,   range)).toBe(-15);
    expect(midiValueToFxParam(127, range)).toBe(15);
    expect(midiValueToFxParam(64,  range)).toBeCloseTo(0.118, 2); // (64/127)*30 - 15
  });

  it("exponential: MIDI 0 → min, MIDI 127 → max", () => {
    const range = findFxParamRange("filterFreq")!;
    expect(midiValueToFxParam(0,   range)).toBeCloseTo(20, 5);
    expect(midiValueToFxParam(127, range)).toBeCloseTo(20000, 0);
  });

  it("exponential: MIDI 64 ist NICHT die lineare Mitte (10010Hz wäre linear → exp ergibt ~640Hz)", () => {
    const range = findFxParamRange("filterFreq")!;
    const v = midiValueToFxParam(64, range);
    // Bei exp mapping ist Mitte ≈ sqrt(min*max) = sqrt(400000) ≈ 632 Hz
    expect(v).toBeGreaterThan(400);
    expect(v).toBeLessThan(900);
  });

  it("clamped: MIDI <0 → min, MIDI >127 → max", () => {
    const range = { param: "delayMix" as const, label: "Delay Wet", min: 0, max: 1 };
    expect(midiValueToFxParam(-5,  range)).toBe(0);
    expect(midiValueToFxParam(200, range)).toBe(1);
  });

  it("ist round-trip monoton: höherer MIDI → höherer Param", () => {
    const range = findFxParamRange("reverbDecay")!;
    const a = midiValueToFxParam(10, range);
    const b = midiValueToFxParam(50, range);
    const c = midiValueToFxParam(100, range);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});
