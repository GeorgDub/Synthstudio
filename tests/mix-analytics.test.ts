/**
 * Mix Analytics – Vitest unit tests (environment: "node")
 *
 * Tests:
 *  1.  computeDensityMap – empty parts → totalDensity 0
 *  2.  computeDensityMap – 1 part, all steps active → partDensity[0] 1.0
 *  3.  computeDensityMap – velocity weighting (velocity 64 ≈ 0.504)
 *  4.  computeDensityMap – probability weighting (probability 50 → weight 0.5)
 *  5.  computeDensityMap – stepDensity aggregates correctly across parts
 *  6.  detectFlashingPairs – two parts always co-active → coActivation 1.0
 *  7.  detectFlashingPairs – no clash when threshold not reached
 *  8.  detectFlashingPairs – returns empty array for 0 parts
 *  9.  SpectrumAnalyzer – getBandMagnitude returns -Infinity when buffer is filled with -Infinity
 * 10.  totalDensity – half-filled pattern ≈ 0.5
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  computeDensityMap,
  detectFlashingPairs,
} from "../client/src/utils/patternDensity";
import type { DensityMap } from "../client/src/utils/patternDensity";
import { SpectrumAnalyzer } from "../client/src/audio/SpectrumAnalyzer";
import type { PartData, StepData } from "../client/src/audio/AudioEngine";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStep(
  active: boolean,
  velocity = 127,
  probability = 100,
): StepData {
  return { active, velocity, probability };
}

function makePart(
  id: string,
  steps: StepData[],
  muted = false,
): PartData {
  return {
    id,
    name: id,
    muted,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: {
      filterEnabled: false,
      filterType: "lowpass",
      filterFreq: 20000,
      filterQ: 1,
      filterGain: 0,
      distortionEnabled: false,
      distortionAmount: 0,
      compressorEnabled: false,
      compressorThreshold: -24,
      compressorRatio: 4,
      compressorAttack: 0.003,
      compressorRelease: 0.25,
      delayEnabled: false,
      delayTime: 0,
      delayFeedback: 0,
      delayMix: 0,
      reverbEnabled: false,
      reverbDecay: 2,
      reverbMix: 0,
      eqEnabled: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
    },
  };
}

// ─── AudioContext / AnalyserNode mock (minimal, node-safe) ───────────────────

beforeAll(() => {
  const FREQ_BINS = 1024; // fftSize / 2

  class MockAnalyserNode {
    fftSize = 2048;
    smoothingTimeConstant = 0;
    get frequencyBinCount() {
      return this.fftSize / 2;
    }
    connect() {}
    disconnect() {}
    getFloatFrequencyData(arr: Float32Array) {
      arr.fill(-Infinity);
    }
  }

  class MockAudioContext {
    sampleRate = 44100;
    createAnalyser() {
      return new MockAnalyserNode() as unknown as AnalyserNode;
    }
  }

  // Inject into globalThis so SpectrumAnalyzer can reference them
  (globalThis as Record<string, unknown>).AudioContext =
    MockAudioContext as unknown as typeof AudioContext;
  (globalThis as Record<string, unknown>).AnalyserNode =
    MockAnalyserNode as unknown as typeof AnalyserNode;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("computeDensityMap", () => {
  it("1. empty parts → totalDensity 0", () => {
    const map: DensityMap = computeDensityMap([]);
    expect(map.totalDensity).toBe(0);
    expect(map.partCount).toBe(0);
    expect(map.stepCount).toBe(0);
  });

  it("2. 1 part, all steps active → partDensity[0] = 1.0", () => {
    const steps = Array.from({ length: 8 }, () => makeStep(true));
    const map = computeDensityMap([makePart("kick", steps)]);
    expect(map.partDensity[0]).toBeCloseTo(1.0, 5);
  });

  it("3. velocity weighting: velocity=64 → weight ≈ 64/127", () => {
    const steps = [makeStep(true, 64, 100)];
    const map = computeDensityMap([makePart("p1", steps)]);
    expect(map.cells[0][0]).toBeCloseTo(64 / 127, 5);
  });

  it("4. probability weighting: probability=50 → weight ≈ 0.5", () => {
    const steps = [makeStep(true, 127, 50)];
    const map = computeDensityMap([makePart("p1", steps)]);
    expect(map.cells[0][0]).toBeCloseTo(0.5, 5);
  });

  it("5. stepDensity aggregates correctly across parts", () => {
    // Two parts, step 0: both active at full weight → stepDensity[0] = 1.0
    // step 1: only first active → stepDensity[1] = 0.5
    const steps1 = [makeStep(true), makeStep(true)];
    const steps2 = [makeStep(true), makeStep(false)];
    const map = computeDensityMap([
      makePart("a", steps1),
      makePart("b", steps2),
    ]);
    expect(map.stepDensity[0]).toBeCloseTo(1.0, 5);
    expect(map.stepDensity[1]).toBeCloseTo(0.5, 5);
  });
});

describe("detectFlashingPairs", () => {
  it("6. two parts always co-active → coActivation 1.0", () => {
    const steps = Array.from({ length: 4 }, () => makeStep(true));
    const pairs = detectFlashingPairs([
      makePart("kick", steps),
      makePart("bass", steps),
    ]);
    expect(pairs.length).toBe(1);
    expect(pairs[0].coActivation).toBeCloseTo(1.0, 5);
  });

  it("7. no clash when threshold not reached", () => {
    // Only 1/4 steps co-active → coActivation 0.25, well below default 0.5
    const stepsA = [makeStep(true), makeStep(false), makeStep(false), makeStep(false)];
    const stepsB = [makeStep(true), makeStep(true),  makeStep(true),  makeStep(true)];
    const pairs = detectFlashingPairs([
      makePart("kick", stepsA),
      makePart("bass", stepsB),
    ]);
    expect(pairs.length).toBe(0);
  });

  it("8. returns empty array for 0 parts", () => {
    const pairs = detectFlashingPairs([]);
    expect(pairs).toEqual([]);
  });
});

describe("SpectrumAnalyzer", () => {
  it("9. getBandMagnitude returns -Infinity when buffer filled with -Infinity (mock)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = new (globalThis as any).AudioContext() as AudioContext;
    const analyzer = new SpectrumAnalyzer(ctx, 2048);
    // No source connected – buffer filled with -Infinity by mock
    const magnitude = analyzer.getBandMagnitude(80, 300);
    expect(magnitude).toBe(-Infinity);
  });
});

describe("totalDensity", () => {
  it("10. half-filled pattern → totalDensity ≈ 0.5", () => {
    // 8 steps: first 4 active, last 4 inactive – single part, full velocity
    const steps = [
      makeStep(true), makeStep(true), makeStep(true), makeStep(true),
      makeStep(false), makeStep(false), makeStep(false), makeStep(false),
    ];
    const map = computeDensityMap([makePart("snare", steps)]);
    expect(map.totalDensity).toBeCloseTo(0.5, 5);
  });
});
