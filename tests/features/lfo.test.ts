/**
 * tests/features/lfo.test.ts (TASK-257)
 *
 * Unit-Tests für die reine LFO-Math (client/src/utils/lfo.ts).
 * Reine Funktionen → kein Mock nötig, voll deterministisch.
 */
import { describe, it, expect } from "vitest";
import {
  wrapPhase01,
  waveformValue,
  evaluateLfo,
  applyBipolarMod,
  type LfoShape,
} from "@/utils/lfo";

describe("wrapPhase01", () => {
  it("Happy: Werte in [0,1) bleiben unverändert", () => {
    expect(wrapPhase01(0)).toBe(0);
    expect(wrapPhase01(0.25)).toBeCloseTo(0.25);
    expect(wrapPhase01(0.999)).toBeCloseTo(0.999);
  });

  it("Edge: negative + >1 Werte werden korrekt gewickelt", () => {
    expect(wrapPhase01(1.25)).toBeCloseTo(0.25);
    expect(wrapPhase01(-0.25)).toBeCloseTo(0.75);
    expect(wrapPhase01(-2.1)).toBeCloseTo(0.9);
  });

  it("Edge: non-finite → 0", () => {
    expect(wrapPhase01(NaN)).toBe(0);
    expect(wrapPhase01(Infinity)).toBe(0);
  });
});

describe("waveformValue", () => {
  it("Happy: sine an Schlüsselpunkten", () => {
    expect(waveformValue("sine", 0)).toBeCloseTo(0);
    expect(waveformValue("sine", 0.25)).toBeCloseTo(1);
    expect(waveformValue("sine", 0.5)).toBeCloseTo(0);
    expect(waveformValue("sine", 0.75)).toBeCloseTo(-1);
  });

  it("Happy: triangle an Schlüsselpunkten", () => {
    expect(waveformValue("triangle", 0)).toBeCloseTo(0);
    expect(waveformValue("triangle", 0.25)).toBeCloseTo(1);
    expect(waveformValue("triangle", 0.5)).toBeCloseTo(0);
    expect(waveformValue("triangle", 0.75)).toBeCloseTo(-1);
  });

  it("Happy: square ist +1 in erster Hälfte, -1 in zweiter", () => {
    expect(waveformValue("square", 0)).toBe(1);
    expect(waveformValue("square", 0.49)).toBe(1);
    expect(waveformValue("square", 0.5)).toBe(-1);
    expect(waveformValue("square", 0.99)).toBe(-1);
  });

  it("Happy: saw rampt von -1 nach +1", () => {
    expect(waveformValue("saw", 0)).toBeCloseTo(-1);
    expect(waveformValue("saw", 0.5)).toBeCloseTo(0);
    expect(waveformValue("saw", 0.999)).toBeCloseTo(0.998, 2);
  });

  it("Edge: alle Wellenformen bleiben in [-1,+1]", () => {
    for (const wf of ["sine", "triangle", "square", "saw"] as const) {
      for (let i = 0; i < 100; i++) {
        const v = waveformValue(wf, i / 100);
        expect(v).toBeGreaterThanOrEqual(-1.0000001);
        expect(v).toBeLessThanOrEqual(1.0000001);
      }
    }
  });

  it("Edge: Phase wird gewickelt (t und t+1 identisch)", () => {
    expect(waveformValue("sine", 0.3)).toBeCloseTo(waveformValue("sine", 1.3));
    expect(waveformValue("triangle", -0.7)).toBeCloseTo(waveformValue("triangle", 0.3));
  });
});

describe("evaluateLfo", () => {
  const sine = (rateHz: number, phase = 0): LfoShape => ({ waveform: "sine", rateHz, phase });

  it("Happy: 1 Hz Sine erreicht Peak bei t=0.25s", () => {
    expect(evaluateLfo(sine(1), 0)).toBeCloseTo(0);
    expect(evaluateLfo(sine(1), 0.25)).toBeCloseTo(1);
    expect(evaluateLfo(sine(1), 0.5)).toBeCloseTo(0);
    expect(evaluateLfo(sine(1), 0.75)).toBeCloseTo(-1);
  });

  it("Happy: Phasen-Offset verschiebt die Welle", () => {
    // 1 Hz sine, phase 0.25 → bei t=0 schon am Peak.
    expect(evaluateLfo(sine(1, 0.25), 0)).toBeCloseTo(1);
  });

  it("Happy: Rate skaliert die Frequenz (2 Hz erreicht Peak bei t=0.125)", () => {
    expect(evaluateLfo(sine(2), 0.125)).toBeCloseTo(1);
  });

  it("Edge: rate <= 0 friert die Welle ein (nur Phase zählt)", () => {
    expect(evaluateLfo(sine(0, 0.25), 5)).toBeCloseTo(1);
    expect(evaluateLfo(sine(-3, 0.25), 99)).toBeCloseTo(1);
  });

  it("Edge: negative Zeit liefert gültigen gewickelten Wert", () => {
    const v = evaluateLfo(sine(1), -0.25);
    expect(v).toBeCloseTo(-1);
  });

  it("Edge: Ergebnis immer in [-1,+1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = evaluateLfo({ waveform: "saw", rateHz: 3.7, phase: 0.1 }, i * 0.017);
      expect(v).toBeGreaterThanOrEqual(-1.0000001);
      expect(v).toBeLessThanOrEqual(1.0000001);
    }
  });
});

describe("applyBipolarMod", () => {
  it("Happy: amount 0 → Basiswert unverändert", () => {
    expect(applyBipolarMod(0.5, 1, 0, 0, 1)).toBeCloseTo(0.5);
    expect(applyBipolarMod(0.5, -1, 0, 0, 1)).toBeCloseTo(0.5);
  });

  it("Happy: lfo +1, amount +1 → base + halber Range (default span)", () => {
    // span default = (max-min)/2 = 0.5 → 0.5 + 0.5 = 1.0
    expect(applyBipolarMod(0.5, 1, 1, 0, 1)).toBeCloseTo(1);
    // lfo -1 → 0.5 - 0.5 = 0
    expect(applyBipolarMod(0.5, -1, 1, 0, 1)).toBeCloseTo(0);
  });

  it("Happy: negativer amount invertiert", () => {
    expect(applyBipolarMod(0.5, 1, -1, 0, 1)).toBeCloseTo(0);
    expect(applyBipolarMod(0.5, -1, -1, 0, 1)).toBeCloseTo(1);
  });

  it("Edge: Ergebnis wird auf [min,max] geklemmt", () => {
    expect(applyBipolarMod(0.9, 1, 1, 0, 1)).toBe(1); // würde 1.4 ergeben
    expect(applyBipolarMod(0.1, -1, 1, 0, 1)).toBe(0); // würde -0.4 ergeben
  });

  it("Edge: amount außerhalb [-1,1] wird geklemmt", () => {
    // amount 5 → wie amount 1
    expect(applyBipolarMod(0.5, 1, 5, 0, 1)).toBeCloseTo(applyBipolarMod(0.5, 1, 1, 0, 1));
  });

  it("Edge: expliziter span überschreibt default", () => {
    // span 0.1: 0.5 + 1*1*0.1 = 0.6
    expect(applyBipolarMod(0.5, 1, 1, 0, 1, 0.1)).toBeCloseTo(0.6);
  });

  it("Happy: funktioniert mit bipolaren Ranges (pan -1..1)", () => {
    // base 0, lfo 1, amount 1, span default = 1 → 0 + 1 = 1
    expect(applyBipolarMod(0, 1, 1, -1, 1)).toBeCloseTo(1);
    expect(applyBipolarMod(0, -1, 1, -1, 1)).toBeCloseTo(-1);
  });
});
