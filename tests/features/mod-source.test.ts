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
  evaluateEnvTriggered,
  nextEnvTrigger,
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

// ─── evaluateEnvTriggered – one-shot ab Trigger (TASK-271) ────────────────────

describe("evaluateEnvTriggered – getriggerte one-shot Hüllkurve", () => {
  const env: EnvConfig = { attack: 1, decay: 1, sustain: 0.5, release: 1, loopSec: 4 };
  // Periode = max(loopSec=4, A+D+R=3) = 4
  // ab Trigger: [0,1) Attack 0→1, [1,2) Decay 1→0.5, [2,3) Sustain, [3,4) Release→0

  it("Idle: triggerTime===null → 0 (Anfangswert, keine Bewegung)", () => {
    expect(evaluateEnvTriggered(env, 0, null)).toBe(0);
    expect(evaluateEnvTriggered(env, 100, null)).toBe(0);
  });

  it("Idle: nicht-finiter triggerTime → 0 (defensiv)", () => {
    expect(evaluateEnvTriggered(env, 5, NaN)).toBe(0);
    expect(evaluateEnvTriggered(env, 5, Infinity)).toBe(0);
  });

  it("Happy: ab Trigger startet ADSR bei 0 und steigt (Attack)", () => {
    const trig = 10;
    expect(evaluateEnvTriggered(env, trig, trig)).toBeCloseTo(0, 5); // genau am Trigger
    expect(evaluateEnvTriggered(env, trig + 0.5, trig)).toBeCloseTo(0.5, 5); // Attack-Mitte
    expect(evaluateEnvTriggered(env, trig + 1, trig)).toBeCloseTo(1, 5); // Peak
  });

  it("Happy: Decay/Sustain/Release relativ zum Trigger", () => {
    const trig = 3.7;
    expect(evaluateEnvTriggered(env, trig + 1.5, trig)).toBeCloseTo(0.75, 5); // Decay-Mitte
    expect(evaluateEnvTriggered(env, trig + 2.5, trig)).toBeCloseTo(0.5, 5); // Sustain
    expect(evaluateEnvTriggered(env, trig + 3.5, trig)).toBeCloseTo(0.25, 5); // Release-Mitte
  });

  it("One-shot: nach Ablauf der Periode bleibt 0 (KEIN Loop)", () => {
    const trig = 0;
    // evaluateEnv würde bei t=4.5 zu t=0.5 wrappen (0.5); evaluateEnvTriggered NICHT.
    expect(evaluateEnv(env, 4.5)).toBeCloseTo(0.5, 5);
    expect(evaluateEnvTriggered(env, 4.5, trig)).toBe(0);
    expect(evaluateEnvTriggered(env, 8, trig)).toBe(0);
    expect(evaluateEnvTriggered(env, 4, trig)).toBe(0); // genau am Periodenende
  });

  it("Edge: now vor Trigger (negatives elapsed) → 0 (Attack-Start)", () => {
    expect(evaluateEnvTriggered(env, 5, 6)).toBeCloseTo(0, 5);
  });

  it("Regression: identisch zu evaluateEnv im ersten Durchlauf [0,period)", () => {
    const trig = 100;
    for (let dt = 0; dt < 4; dt += 0.17) {
      expect(evaluateEnvTriggered(env, trig + dt, trig)).toBeCloseTo(
        evaluateEnv(env, dt),
        6,
      );
    }
  });

  it("Edge: degenerierte Periode (alles 0) → immer 0", () => {
    const flat: EnvConfig = { attack: 0, decay: 0, sustain: 0.7, release: 0, loopSec: 0 };
    expect(evaluateEnvTriggered(flat, 5, 0)).toBe(0);
  });
});

// ─── nextEnvTrigger – Transport-Trigger-Edge (TASK-271 Task A) ────────────────

describe("nextEnvTrigger – Transport-Kopplung der env-Trigger", () => {
  it("Stop: playing=false → null (Envelope idle), egal welcher Vorwert", () => {
    expect(nextEnvTrigger(null, false, false, 5)).toBeNull();
    expect(nextEnvTrigger(3.2, false, false, 5)).toBeNull();
    expect(nextEnvTrigger(3.2, false, true, 5)).toBeNull(); // playing dominiert
  });

  it("Transport-Start (Rising-Edge): justStarted → now (retrigger ab Play)", () => {
    expect(nextEnvTrigger(null, true, true, 12.5)).toBe(12.5);
    // retriggert AUCH wenn vorher schon ein Trigger lief (one-shot ab Play):
    expect(nextEnvTrigger(2.0, true, true, 12.5)).toBe(12.5);
  });

  it("Mid-Playback-Aktivierung: läuft schon, Route erstmals aktiv (current=null) → now", () => {
    expect(nextEnvTrigger(null, true, false, 7.3)).toBe(7.3);
  });

  it("Läuft bereits, kein Edge → current unverändert (kein Re-Trigger pro Frame)", () => {
    expect(nextEnvTrigger(4.0, true, false, 9.9)).toBe(4.0);
  });

  it("Integration: Trigger-Edge füttert evaluateEnvTriggered konsistent (Play→Attack ab 0)", () => {
    const env: EnvConfig = { attack: 1, decay: 1, sustain: 0.5, release: 1, loopSec: 4 };
    // Frame am Play-Start (t=10): Trigger=10, elapsed=0 → 0 (Attack-Start).
    const trig = nextEnvTrigger(null, true, true, 10);
    expect(trig).toBe(10);
    expect(evaluateEnvTriggered(env, 10, trig)).toBeCloseTo(0, 5);
    // Späterer Frame (t=10.5), kein Edge → Trigger bleibt 10, elapsed=0.5 → 0.5.
    const trig2 = nextEnvTrigger(trig, true, false, 10.5);
    expect(trig2).toBe(10);
    expect(evaluateEnvTriggered(env, 10.5, trig2)).toBeCloseTo(0.5, 5);
    // Stop (t=12): Trigger=null → idle → 0.
    const trig3 = nextEnvTrigger(trig2, false, false, 12);
    expect(trig3).toBeNull();
    expect(evaluateEnvTriggered(env, 12, trig3)).toBe(0);
  });
});
