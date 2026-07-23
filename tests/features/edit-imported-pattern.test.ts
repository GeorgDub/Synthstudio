/**
 * tests/features/edit-imported-pattern.test.ts
 *
 * Pure-Edit-Helper für die editierbare ESX-Import-Vorschau (v3.285).
 */
import { describe, it, expect } from "vitest";
import {
  toggleImportedStep,
  setImportedStepActive,
  clearImportedPart,
  countActiveSteps,
} from "../../client/src/utils/imports/editImportedPattern";
import type { ImportResult } from "../../client/src/utils/imports/types";

function makeResult(): ImportResult {
  return {
    sourceFormat: "esx",
    fileName: "T.esx",
    bpm: 140,
    warnings: [],
    patterns: [
      {
        name: "P1",
        stepCount: 16,
        bpm: 140,
        parts: [
          {
            name: "Kick",
            steps: Array.from({ length: 16 }, (_, i) => ({
              active: i % 4 === 0,
              velocity: 100,
            })),
          },
          {
            name: "Snare",
            steps: Array.from({ length: 16 }, () => ({
              active: false,
              velocity: 100,
            })),
          },
        ],
      },
    ],
  };
}

describe("toggleImportedStep", () => {
  it("toggelt einen inaktiven Step auf aktiv (immutable)", () => {
    const r = makeResult();
    const out = toggleImportedStep(r, 0, 0, 1);
    expect(out.patterns[0].parts[0].steps[1].active).toBe(true);
    // Original unverändert (Immutability)
    expect(r.patterns[0].parts[0].steps[1].active).toBe(false);
    // andere Steps unangetastet
    expect(out.patterns[0].parts[0].steps[0].active).toBe(true);
  });

  it("toggelt einen aktiven Step auf inaktiv", () => {
    const out = toggleImportedStep(makeResult(), 0, 0, 0);
    expect(out.patterns[0].parts[0].steps[0].active).toBe(false);
  });

  it("out-of-range → identisches Result (Referenz)", () => {
    const r = makeResult();
    expect(toggleImportedStep(r, 9, 0, 0)).toBe(r);
    expect(toggleImportedStep(r, 0, 9, 0)).toBe(r);
    expect(toggleImportedStep(r, 0, 0, 99)).toBe(r);
  });

  it("bewahrt velocity/pitch des Steps", () => {
    const r = makeResult();
    r.patterns[0].parts[0].steps[2] = { active: false, velocity: 77, pitch: 3 };
    const out = toggleImportedStep(r, 0, 0, 2);
    expect(out.patterns[0].parts[0].steps[2]).toEqual({
      active: true,
      velocity: 77,
      pitch: 3,
    });
  });
});

describe("setImportedStepActive", () => {
  it("setzt explizit aktiv; idempotent bei gleichem Wert (Referenz)", () => {
    const r = makeResult();
    const on = setImportedStepActive(r, 0, 1, 5, true);
    expect(on.patterns[0].parts[1].steps[5].active).toBe(true);
    // schon aktiv → gleiche Referenz zurück
    expect(setImportedStepActive(on, 0, 1, 5, true)).toBe(on);
  });

  it("out-of-range → identisches Result", () => {
    const r = makeResult();
    expect(setImportedStepActive(r, 0, 0, 99, true)).toBe(r);
  });
});

describe("clearImportedPart", () => {
  it("leert alle Steps eines Parts", () => {
    const out = clearImportedPart(makeResult(), 0, 0);
    expect(out.patterns[0].parts[0].steps.every(s => !s.active)).toBe(true);
    // anderer Part unberührt
    expect(out.patterns[0].parts[1].steps.every(s => !s.active)).toBe(true);
  });

  it("out-of-range → identisches Result", () => {
    const r = makeResult();
    expect(clearImportedPart(r, 0, 9)).toBe(r);
  });
});

describe("countActiveSteps", () => {
  it("zählt aktive Steps über alle Parts", () => {
    // Kick: 4 aktive (0,4,8,12), Snare: 0
    expect(countActiveSteps(makeResult(), 0)).toBe(4);
  });

  it("reagiert auf Edits", () => {
    const out = toggleImportedStep(makeResult(), 0, 1, 2);
    expect(countActiveSteps(out, 0)).toBe(5);
  });

  it("out-of-range → 0", () => {
    expect(countActiveSteps(makeResult(), 9)).toBe(0);
  });
});
