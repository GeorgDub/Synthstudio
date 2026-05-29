/**
 * tests/features/humanizer-groove-template.test.ts
 *
 * Verhaltens-Tests für die Groove-Engine-Verkabelung (v3.238):
 * Eine aktive GROOVE_TEMPLATES-Vorlage muss ihr Per-Step-Timing UND
 * ihre Per-Step-Velocity-Kurve über computeHumanizerTimingOffset /
 * computeHumanizerVelocityMultiplier in den Sequencer-Pfad einspeisen —
 * nicht nur einen einzelnen Swing-Wert.
 *
 * Wir mutieren den Singleton-State direkt über getHumanizerState() (gibt die
 * Referenz zurück), da der React-Hook in Node ohne Renderer nicht läuft.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  computeHumanizerTimingOffset,
  computeHumanizerVelocityMultiplier,
  getHumanizerState,
  type HumanizerSettings,
} from "../../client/src/store/useHumanizerStore";
import { GROOVE_TEMPLATES } from "../../client/src/utils/grooveEngine";

const STEP_DUR = 0.125; // 120 BPM, 16tel — 125ms

function template(id: string) {
  const t = GROOVE_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Template ${id} nicht gefunden`);
  return t;
}

/** Setzt die globalen Humanizer-Settings (mutiert den Singleton direkt). */
function setGlobal(changes: Partial<HumanizerSettings>) {
  const st = getHumanizerState();
  st.global = {
    swing: 0,
    velocityJitter: 0,
    timingJitter: 0,
    enabled: false,
    swingOnEvenSteps: true,
    preset: null,
    grooveTemplateId: null,
    grooveAmount: 1,
    ...changes,
  };
  st.perPart = {};
}

describe("Humanizer – Groove-Engine-Vorlagen-Verkabelung", () => {
  beforeEach(() => {
    setGlobal({});
  });

  it("MPC-Classic-Timing: Offbeat (Step 1) wird um +18ms verschoben", () => {
    setGlobal({ enabled: true, grooveTemplateId: "mpc-classic", grooveAmount: 1 });
    const tmpl = template("mpc-classic");
    // Step 1 = erster Offbeat → template.timing[1] (18) in Sekunden
    expect(computeHumanizerTimingOffset(1, STEP_DUR)).toBeCloseTo(tmpl.timing[1] * 0.001, 6);
    // Step 0 = Downbeat → 0
    expect(computeHumanizerTimingOffset(0, STEP_DUR)).toBeCloseTo(0, 6);
  });

  it("Verschiedene Templates liefern verschiedene Offbeat-Offsets (nicht alle gleich)", () => {
    const offbeat = (id: string) => {
      setGlobal({ enabled: true, grooveTemplateId: id, grooveAmount: 1 });
      return computeHumanizerTimingOffset(1, STEP_DUR);
    };
    // Hip-Hop (28ms) ≠ TR-909 (8ms) ≠ MPC (18ms) — das war der Bug:
    // vorher kollabierten alle auf einen einzigen Swing-Wert.
    const hh = offbeat("hip-hop");
    const tr = offbeat("tr909");
    const mpc = offbeat("mpc-classic");
    expect(hh).not.toBeCloseTo(tr, 4);
    expect(tr).not.toBeCloseTo(mpc, 4);
    expect(hh).toBeGreaterThan(mpc);
    expect(mpc).toBeGreaterThan(tr);
  });

  it("grooveAmount skaliert das Timing linear", () => {
    setGlobal({ enabled: true, grooveTemplateId: "hip-hop", grooveAmount: 0.5 });
    const tmpl = template("hip-hop");
    expect(computeHumanizerTimingOffset(1, STEP_DUR)).toBeCloseTo(tmpl.timing[1] * 0.001 * 0.5, 6);
  });

  it("Per-Step-Velocity-Kurve greift (Funk-Ghost Ghost-Note auf Step 1)", () => {
    setGlobal({ enabled: true, grooveTemplateId: "funk-ghost", grooveAmount: 1, velocityJitter: 0 });
    const tmpl = template("funk-ghost");
    // Step 1 ist eine Ghost-Note (velocity-Mult < 1)
    expect(tmpl.velocity[1]).toBeLessThan(1);
    expect(computeHumanizerVelocityMultiplier(1)).toBeCloseTo(tmpl.velocity[1], 6);
    // Step 0 = volle Velocity (1.0)
    expect(computeHumanizerVelocityMultiplier(0)).toBeCloseTo(tmpl.velocity[0], 6);
  });

  it("grooveAmount skaliert die Velocity-Abweichung (0.5 → halber Weg zu 1.0)", () => {
    setGlobal({ enabled: true, grooveTemplateId: "funk-ghost", grooveAmount: 0.5, velocityJitter: 0 });
    const tmpl = template("funk-ghost");
    const expected = 1 + (tmpl.velocity[1] - 1) * 0.5;
    expect(computeHumanizerVelocityMultiplier(1)).toBeCloseTo(expected, 6);
  });

  it("Template-Index wrappt modulo Template-Länge (Step 16 == Step 0)", () => {
    setGlobal({ enabled: true, grooveTemplateId: "mpc-classic", grooveAmount: 1 });
    expect(computeHumanizerTimingOffset(16, STEP_DUR)).toBeCloseTo(
      computeHumanizerTimingOffset(0, STEP_DUR),
      6,
    );
  });

  it("disabled → kein Timing-Offset und Velocity-Mult 1.0", () => {
    setGlobal({ enabled: false, grooveTemplateId: "hip-hop", grooveAmount: 1 });
    expect(computeHumanizerTimingOffset(1, STEP_DUR)).toBe(0);
    expect(computeHumanizerVelocityMultiplier(1)).toBe(1.0);
  });

  it("Regression: ohne Template greift weiterhin der einfache Even-Step-Swing", () => {
    setGlobal({ enabled: true, grooveTemplateId: null, swing: 0.4, swingOnEvenSteps: true });
    // Odd-Step bekommt swing * stepDur * 0.5
    expect(computeHumanizerTimingOffset(1, STEP_DUR)).toBeCloseTo(0.4 * STEP_DUR * 0.5, 6);
    // Even-Step bleibt unverschoben
    expect(computeHumanizerTimingOffset(0, STEP_DUR)).toBeCloseTo(0, 6);
  });

  it("Aktives Template ersetzt den manuellen Even-Step-Swing (kein Doppel-Swing)", () => {
    setGlobal({
      enabled: true,
      grooveTemplateId: "tr909",
      grooveAmount: 1,
      swing: 0.5, // sollte ignoriert werden, solange Template aktiv ist
    });
    const tmpl = template("tr909");
    // Nur das Template-Timing, NICHT zusätzlich der manuelle Swing
    expect(computeHumanizerTimingOffset(1, STEP_DUR)).toBeCloseTo(tmpl.timing[1] * 0.001, 6);
  });

  it("Velocity-Mult bleibt in [0.1, 2.0] auch mit Jitter", () => {
    setGlobal({ enabled: true, grooveTemplateId: "hip-hop", grooveAmount: 1, velocityJitter: 1 });
    for (let i = 0; i < 200; i++) {
      const v = computeHumanizerVelocityMultiplier(i % 16);
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(2.0);
    }
  });

  it("undefined grooveAmount wird wie 1.0 behandelt (Alt-Settings)", () => {
    setGlobal({ enabled: true, grooveTemplateId: "mpc-classic", grooveAmount: undefined });
    const tmpl = template("mpc-classic");
    expect(computeHumanizerTimingOffset(1, STEP_DUR)).toBeCloseTo(tmpl.timing[1] * 0.001, 6);
  });
});
