/**
 * Synthstudio – Slide/Glide Tests (v2.14, TB-303-Style)
 */
import { describe, it, expect } from "vitest";
import {
  decideSlide,
  findNextActiveStepIndex,
  SLIDE_DURATION_FACTOR,
} from "../../client/src/utils/slideGlide";

describe("decideSlide (v2.14)", () => {
  it("kein Glide wenn der vorherige Step KEIN Slide hatte", () => {
    const r = decideSlide({
      prevHadSlide: false,
      prevFreq: 220,
      currentFreq: 440,
      stepDurationSec: 0.125,
    });
    expect(r.applyGlide).toBe(false);
    expect(r.glideSeconds).toBe(0);
  });

  it("kein Glide wenn keine prevFreq vorhanden ist", () => {
    const r = decideSlide({
      prevHadSlide: true,
      prevFreq: undefined,
      currentFreq: 440,
      stepDurationSec: 0.125,
    });
    expect(r.applyGlide).toBe(false);
  });

  it("kein Glide bei identischen Frequenzen (kein hörbarer Effekt)", () => {
    const r = decideSlide({
      prevHadSlide: true,
      prevFreq: 440,
      currentFreq: 440,
      stepDurationSec: 0.125,
    });
    expect(r.applyGlide).toBe(false);
  });

  it("Glide aktiv wenn prevHadSlide und unterschiedliche Frequenzen", () => {
    const r = decideSlide({
      prevHadSlide: true,
      prevFreq: 220,
      currentFreq: 440,
      stepDurationSec: 0.125,
    });
    expect(r.applyGlide).toBe(true);
    expect(r.startFreq).toBe(220);
    expect(r.glideSeconds).toBeCloseTo(0.125 * SLIDE_DURATION_FACTOR, 5);
  });

  it("Glide-Mindestdauer 5ms (sehr kurze Steps)", () => {
    const r = decideSlide({
      prevHadSlide: true,
      prevFreq: 220,
      currentFreq: 440,
      stepDurationSec: 0.001, // extrem kurz
    });
    expect(r.applyGlide).toBe(true);
    expect(r.glideSeconds).toBeGreaterThanOrEqual(0.005);
  });

  it("ignoriert ungültige prevFreq (0 oder negativ)", () => {
    expect(decideSlide({ prevHadSlide: true, prevFreq: 0, currentFreq: 440, stepDurationSec: 0.125 }).applyGlide).toBe(false);
    expect(decideSlide({ prevHadSlide: true, prevFreq: -100, currentFreq: 440, stepDurationSec: 0.125 }).applyGlide).toBe(false);
    expect(decideSlide({ prevHadSlide: true, prevFreq: NaN, currentFreq: 440, stepDurationSec: 0.125 }).applyGlide).toBe(false);
  });
});

describe("findNextActiveStepIndex (v2.14)", () => {
  it("findet den nächsten aktiven Step", () => {
    const steps = [
      { active: true },
      { active: false },
      { active: true },
      { active: false },
    ];
    expect(findNextActiveStepIndex(steps, 0)).toBe(2);
    expect(findNextActiveStepIndex(steps, 2)).toBe(0); // wrap-around
  });

  it("liefert -1 wenn KEIN aktiver Step vorhanden", () => {
    const steps = [
      { active: false },
      { active: false },
    ];
    expect(findNextActiveStepIndex(steps, 0)).toBe(-1);
  });

  it("liefert sich selbst NICHT — sucht nur ab fromIndex+1", () => {
    const steps = [{ active: true }, { active: false }, { active: false }];
    // Wenn nur step 0 aktiv ist und wir bei 0 starten → wrap-around findet 0 wieder
    expect(findNextActiveStepIndex(steps, 0)).toBe(0);
  });

  it("leeres Array → -1", () => {
    expect(findNextActiveStepIndex([], 0)).toBe(-1);
  });
});
