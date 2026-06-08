/**
 * tests/features/step-count-resize.test.ts
 *
 * Coverage für resizeSteps — die Pure-Logik hinter "globale Step-Anzahl auf
 * alle Patterns anwenden" (Synth.md: höhere Ebene statt pro Pattern).
 */
import { describe, it, expect } from "vitest";
import { resizeSteps } from "../../client/src/components/DrumMachine/drumMachineHelpers";

const mk = () => ({ active: false, velocity: 100, pitch: 0 });

describe("resizeSteps", () => {
  it("Happy Path: 16 → 32 füllt mit Default-Steps auf", () => {
    const steps = Array.from({ length: 16 }, () => ({ active: true, velocity: 64, pitch: 2 }));
    const out = resizeSteps(steps, 32, mk);
    expect(out).toHaveLength(32);
    // Bestehende Steps unverändert
    expect(out[0]).toEqual({ active: true, velocity: 64, pitch: 2 });
    // Neue Steps sind Default
    expect(out[16]).toEqual({ active: false, velocity: 100, pitch: 0 });
  });

  it("64 → 16 schneidet hinten ab (behält die ersten 16)", () => {
    const steps = Array.from({ length: 64 }, (_, i) => ({ active: i < 16, velocity: 100, pitch: 0 }));
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
});
