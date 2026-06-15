/**
 * tests/features/mod-source.test.ts (TASK-257-FOLLOWUP-3)
 *
 * Unit-Tests für die reinen Mod-Source-Helper (Macro + Envelope) in
 * client/src/utils/modSource.ts. Keine Browser-/Audio-Abhängigkeit.
 */
import { describe, it, expect } from "vitest";
import {
  macroToModValue,
  evaluateEnv,
  defaultEnvConfig,
  type EnvConfig,
} from "@/utils/modSource";

// ─── macroToModValue ──────────────────────────────────────────────────────────

describe("macroToModValue – unipolarer Pass-Through", () => {
  it("Happy: 0 → 0, 1 → 1, 0.5 → 0.5", () => {
    expect(macroToModValue(0)).toBe(0);
    expect(macroToModValue(1)).toBe(1);
    expect(macroToModValue(0.5)).toBe(0.5);
  });

  it("Edge: klemmt außerhalb [0,1]", () => {
    expect(macroToModValue(-0.3)).toBe(0);
    expect(macroToModValue(2.5)).toBe(1);
  });

  it("Edge: nicht-finite → 0 (defensiv, inkl. Infinity)", () => {
    expect(macroToModValue(NaN)).toBe(0);
    expect(macroToModValue(Infinity)).toBe(0);
    expect(macroToModValue(-Infinity)).toBe(0);
  });
});

// ─── evaluateEnv – zyklische Hüllkurve über die Zeit ──────────────────────────

describe("evaluateEnv – Kurvenauswertung über die Zeit", () => {
  const env: EnvConfig = { attack: 1, decay: 1, sustain: 0.5, release: 1, loopSec: 4 };
  // Periode = max(loopSec=4, A+D+R=3) = 4
  // [0,1) Attack 0→1, [1,2) Decay 1→0.5, [2,3) Sustain 0.5, [3,4) Release 0.5→0

  it("Happy: Attack-Phase steigt linear 0 → 1", () => {
    expect(evaluateEnv(env, 0)).toBeCloseTo(0, 5);
    expect(evaluateEnv(env, 0.5)).toBeCloseTo(0.5, 5);
    expect(evaluateEnv(env, 0.999)).toBeCloseTo(0.999, 3);
  });

  it("Happy: Decay-Phase fällt 1 → sustain", () => {
    expect(evaluateEnv(env, 1)).toBeCloseTo(1, 5);
    expect(evaluateEnv(env, 1.5)).toBeCloseTo(0.75, 5); // halfway 1→0.5
    expect(evaluateEnv(env, 1.999)).toBeCloseTo(0.5, 2);
  });

  it("Happy: Sustain-Phase konstant", () => {
    expect(evaluateEnv(env, 2)).toBeCloseTo(0.5, 5);
    expect(evaluateEnv(env, 2.5)).toBeCloseTo(0.5, 5);
  });

  it("Happy: Release-Phase fällt sustain → 0", () => {
    expect(evaluateEnv(env, 3)).toBeCloseTo(0.5, 5);
    expect(evaluateEnv(env, 3.5)).toBeCloseTo(0.25, 5); // halfway 0.5→0
  });

  it("Edge: loopt — Zeit über Periode wickelt zurück", () => {
    // t=4.5 entspricht t=0.5 (Attack)
    expect(evaluateEnv(env, 4.5)).toBeCloseTo(evaluateEnv(env, 0.5), 5);
    // t=8 entspricht t=0
    expect(evaluateEnv(env, 8)).toBeCloseTo(evaluateEnv(env, 0), 5);
  });

  it("Edge: negative Zeit wickelt korrekt nach [0,period)", () => {
    // t=-0.5 → period-0.5 = 3.5 (Release)
    expect(evaluateEnv(env, -0.5)).toBeCloseTo(evaluateEnv(env, 3.5), 5);
  });

  it("Edge: alle Zeiten 0 → keine Bewegung (immer 0)", () => {
    const flat: EnvConfig = { attack: 0, decay: 0, sustain: 0.7, release: 0, loopSec: 0 };
    expect(evaluateEnv(flat, 0)).toBe(0);
    expect(evaluateEnv(flat, 5)).toBe(0);
  });

  it("Edge: nur Attack (decay/release 0), Sustain hält Rest des Loops", () => {
    const a: EnvConfig = { attack: 1, decay: 0, sustain: 0.5, release: 0, loopSec: 2 };
    // [0,1) Attack, [1,2) Sustain=0.5 (decay 0 → sofort auf sustain; release 0)
    expect(evaluateEnv(a, 0.5)).toBeCloseTo(0.5, 5);
    expect(evaluateEnv(a, 1)).toBeCloseTo(0.5, 5);
    expect(evaluateEnv(a, 1.5)).toBeCloseTo(0.5, 5);
  });

  it("Edge: Werte immer in [0,1]", () => {
    for (let t = 0; t < 8; t += 0.13) {
      const v = evaluateEnv(env, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("defaultEnvConfig liefert plausible, hörbare Defaults", () => {
    const d = defaultEnvConfig();
    expect(d.attack).toBeGreaterThan(0);
    expect(d.loopSec).toBeGreaterThan(d.attack + d.decay + d.release);
    expect(d.sustain).toBeGreaterThan(0);
    expect(d.sustain).toBeLessThanOrEqual(1);
  });
});
