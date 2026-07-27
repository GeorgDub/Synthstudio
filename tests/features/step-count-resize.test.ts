/**
 * tests/features/step-count-resize.test.ts
 *
 * Coverage für resizeSteps — die Pure-Logik hinter "globale Step-Anzahl auf
 * alle Patterns anwenden" (Synth.md: höhere Ebene statt pro Pattern).
 */
import { describe, it, expect } from "vitest";
import {
  resizeSteps,
  growSteps,
} from "../../client/src/components/DrumMachine/drumMachineHelpers";

const mk = () => ({ active: false, velocity: 100, pitch: 0 });

describe("resizeSteps", () => {
  it("Happy Path: 16 → 32 füllt mit Default-Steps auf", () => {
    const steps = Array.from({ length: 16 }, () => ({
      active: true,
      velocity: 64,
      pitch: 2,
    }));
    const out = resizeSteps(steps, 32, mk);
    expect(out).toHaveLength(32);
    // Bestehende Steps unverändert
    expect(out[0]).toEqual({ active: true, velocity: 64, pitch: 2 });
    // Neue Steps sind Default
    expect(out[16]).toEqual({ active: false, velocity: 100, pitch: 0 });
  });

  it("64 → 16 schneidet hinten ab (behält die ersten 16)", () => {
    const steps = Array.from({ length: 64 }, (_, i) => ({
      active: i < 16,
      velocity: 100,
      pitch: 0,
    }));
    const out = resizeSteps(steps, 16, mk);
    expect(out).toHaveLength(16);
    expect(out.every(s => s.active)).toBe(true);
  });

  it("gleiche Länge → identische Referenz (kein unnötiges Kopieren)", () => {
    const steps = Array.from({ length: 16 }, mk);
    expect(resizeSteps(steps, 16, mk)).toBe(steps);
  });

  it("Edge Case: leeres Array → count Default-Steps", () => {
    expect(resizeSteps([], 16, mk)).toHaveLength(16);
  });

  it("Edge Case: negativer count → unverändert (defensiv)", () => {
    const steps = Array.from({ length: 4 }, mk);
    expect(resizeSteps(steps, -1, mk)).toBe(steps);
  });

  it("erzeugt unabhängige Step-Objekte (kein geteilter Default)", () => {
    const out = resizeSteps([], 3, mk);
    out[0].active = true;
    expect(out[1].active).toBe(false);
  });

  // v3.285: 128-Step-Support (Sequencer-intern; alle auf einer Seite).
  it("64 → 128 füllt auf 128 auf, behält die ersten 64", () => {
    const steps = Array.from({ length: 64 }, (_, i) => ({
      active: i % 4 === 0,
      velocity: 100,
      pitch: 0,
    }));
    const out = resizeSteps(steps, 128, mk);
    expect(out).toHaveLength(128);
    expect(out[0].active).toBe(true);
    expect(out[4].active).toBe(true);
    // Aufgefüllte Steps sind Default-inaktiv.
    expect(out[64]).toEqual({ active: false, velocity: 100, pitch: 0 });
    expect(out[127]).toEqual({ active: false, velocity: 100, pitch: 0 });
  });

  it("128 → 32 schneidet auf die ersten 32 zurück", () => {
    const steps = Array.from({ length: 128 }, (_, i) => ({
      active: true,
      velocity: i,
      pitch: 0,
    }));
    const out = resizeSteps(steps, 32, mk);
    expect(out).toHaveLength(32);
    expect(out[31].velocity).toBe(31);
  });

  it("16 → 128 ist ein 8-facher Ausbau (Default-Padding)", () => {
    const out = resizeSteps(Array.from({ length: 16 }, mk), 128, mk);
    expect(out).toHaveLength(128);
    expect(out.filter(s => s.active)).toHaveLength(0);
  });
});

// v3.292: growSteps — nicht-destruktiver Live-Umschalter (16↔32↔64↔128).
describe("growSteps (non-destruktiv)", () => {
  it("wächst 16 → 64 (padded), behält die ersten 16", () => {
    const steps = Array.from({ length: 16 }, (_, i) => ({
      active: true,
      velocity: i,
      pitch: 0,
    }));
    const out = growSteps(steps, 64, mk);
    expect(out).toHaveLength(64);
    expect(out[0]).toEqual({ active: true, velocity: 0, pitch: 0 });
    expect(out[15].active).toBe(true);
    expect(out[16]).toEqual({ active: false, velocity: 100, pitch: 0 });
  });

  it("schneidet NIE ab: 128 → 16 lässt das 128er-Array unverändert", () => {
    const steps = Array.from({ length: 128 }, (_, i) => ({
      active: i >= 64, // Daten in der oberen Hälfte
      velocity: 100,
      pitch: 0,
    }));
    const out = growSteps(steps, 16, mk);
    // Ref-stabil + volle Länge → höhere Steps bleiben erhalten (nur ausgeblendet).
    expect(out).toBe(steps);
    expect(out).toHaveLength(128);
    expect(out[100].active).toBe(true);
  });

  it("Round-Trip 128 → 16 → 128 verliert keine hohen Steps", () => {
    const steps = Array.from({ length: 128 }, (_, i) => ({
      active: i === 120,
      velocity: 100,
      pitch: 0,
    }));
    const down = growSteps(steps, 16, mk); // bleibt 128
    const up = growSteps(down, 128, mk); // bleibt 128
    expect(up[120].active).toBe(true);
    expect(up).toHaveLength(128);
  });

  it("gleiche Länge → ref-stabil (kein Kopieren)", () => {
    const steps = Array.from({ length: 32 }, mk);
    expect(growSteps(steps, 32, mk)).toBe(steps);
  });
});
