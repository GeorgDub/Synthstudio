/**
 * tests/features/arpeggiator.test.ts (TASK-CVG-ARP / v2.60)
 *
 * Pure-Coverage für client/src/utils/arpeggiator.ts (145 LOC).
 *
 * applyArp ist eine reine Funktion (kein Audio, kein DOM, kein Storage):
 * gegeben Noten + Mode + Step-Count produziert sie ArpStep[]. Diese Suite
 * deckt alle 8 Modi + 6 Velocity-Patterns + Octave-Stacking + Determinismus
 * + Edge-Cases (leere Noten, stepSkip, gateLength) ab.
 */
import { describe, it, expect } from "vitest";
import {
  applyArp,
  arpStepAt,
  arpMidiToFreq,
  ARP_MODE_LABELS,
  ARP_OUTPUT_MODE_LABELS,
  ARP_VELOCITY_LABELS,
  type ArpMode,
  type ArpOutputMode,
  type ArpVelocityPattern,
} from "@/utils/arpeggiator";

const C_MAJOR_TRIAD = [60, 64, 67]; // C-E-G

describe("Arpeggiator – Label-Maps", () => {
  it("ARP_MODE_LABELS deckt alle 8 ArpModes ab", () => {
    const modes: ArpMode[] = ["up", "down", "upDown", "random", "chord", "converge", "diverge", "order"];
    for (const m of modes) {
      expect(ARP_MODE_LABELS[m]).toBeTruthy();
      expect(typeof ARP_MODE_LABELS[m]).toBe("string");
    }
  });

  it("ARP_VELOCITY_LABELS deckt alle 6 Pattern ab", () => {
    const patterns: ArpVelocityPattern[] = ["flat", "accent24", "accent13", "crescendo", "decrescendo", "random"];
    for (const p of patterns) {
      expect(ARP_VELOCITY_LABELS[p]).toBeTruthy();
    }
  });

  it("ARP_OUTPUT_MODE_LABELS deckt alle 3 Output-Modi ab", () => {
    const modes: ArpOutputMode[] = ["synth", "channel", "midi"];
    for (const m of modes) {
      expect(ARP_OUTPUT_MODE_LABELS[m]).toBeTruthy();
      expect(typeof ARP_OUTPUT_MODE_LABELS[m]).toBe("string");
    }
  });
});

describe("Arpeggiator – arpStepAt (Playback-Selektion)", () => {
  const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 4 });

  it("Step 0 liefert die erste aktive Note (60)", () => {
    expect(arpStepAt(steps, 0)?.note).toBe(60);
  });

  it("wrappt modular über die Step-Liste (absStep 4 == Step 0)", () => {
    expect(arpStepAt(steps, 4)?.note).toBe(arpStepAt(steps, 0)?.note);
    expect(arpStepAt(steps, 5)?.note).toBe(arpStepAt(steps, 1)?.note);
  });

  it("negative Indizes wrappen sicher (kein Crash / undefined)", () => {
    expect(arpStepAt(steps, -1)?.note).toBe(arpStepAt(steps, 3)?.note);
  });

  it("leere Step-Liste → null", () => {
    expect(arpStepAt([], 0)).toBeNull();
  });

  it("inaktiver Step → null (z.B. keine Noten)", () => {
    const silent = applyArp({ notes: [], mode: "up", octaves: 1, stepCount: 4 });
    expect(arpStepAt(silent, 0)).toBeNull();
  });
});

describe("Arpeggiator – arpMidiToFreq", () => {
  it("A4 (69) == 440 Hz", () => {
    expect(arpMidiToFreq(69)).toBeCloseTo(440, 5);
  });

  it("Oktave höher verdoppelt die Frequenz (81 == 880 Hz)", () => {
    expect(arpMidiToFreq(81)).toBeCloseTo(880, 5);
  });

  it("C4 (60) ≈ 261.63 Hz", () => {
    expect(arpMidiToFreq(60)).toBeCloseTo(261.63, 1);
  });
});

describe("Arpeggiator – Edge-Cases", () => {
  it("leere Noten → alle Steps inactive mit note=60", () => {
    const steps = applyArp({ notes: [], mode: "up", octaves: 1, stepCount: 8 });
    expect(steps).toHaveLength(8);
    for (const s of steps) {
      expect(s.active).toBe(false);
      expect(s.note).toBe(60);
      expect(s.velocity).toBe(0);
    }
  });

  it("stepCount=0 → leeres Array", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 0 });
    expect(steps).toHaveLength(0);
  });

  it("stepCount=16 produziert exakt 16 Steps", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 16 });
    expect(steps).toHaveLength(16);
  });
});

describe("Arpeggiator – Mode 'up'", () => {
  it("zyklisch C-E-G über 6 Steps", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 6 });
    expect(steps.map((s) => s.note)).toEqual([60, 64, 67, 60, 64, 67]);
    for (const s of steps) expect(s.active).toBe(true);
  });

  it("octaves=2 stacked: C-E-G-C5-E5-G5", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 2, stepCount: 6 });
    expect(steps.map((s) => s.note)).toEqual([60, 64, 67, 72, 76, 79]);
  });

  it("octaves=3 stacked: 9 distinct Pool-Notes", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 3, stepCount: 9 });
    expect(steps.map((s) => s.note)).toEqual([60, 64, 67, 72, 76, 79, 84, 88, 91]);
  });
});

describe("Arpeggiator – Mode 'down'", () => {
  it("zyklisch G-E-C", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "down", octaves: 1, stepCount: 6 });
    expect(steps.map((s) => s.note)).toEqual([67, 64, 60, 67, 64, 60]);
  });

  it("octaves=2 stacked descending", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "down", octaves: 2, stepCount: 6 });
    expect(steps.map((s) => s.note)).toEqual([79, 76, 72, 67, 64, 60]);
  });
});

describe("Arpeggiator – Mode 'upDown'", () => {
  it("3 Noten: pool ist [60,64,67,64] (Endpunkte nicht doppelt)", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "upDown", octaves: 1, stepCount: 8 });
    expect(steps.map((s) => s.note)).toEqual([60, 64, 67, 64, 60, 64, 67, 64]);
  });
});

describe("Arpeggiator – Mode 'chord'", () => {
  it("alle Steps spielen die tiefste Note (sortedNotes[0])", () => {
    const steps = applyArp({ notes: [67, 60, 64], mode: "chord", octaves: 1, stepCount: 4 });
    // tiefste Note nach Sortierung ist 60
    for (const s of steps) {
      expect(s.note).toBe(60);
      expect(s.active).toBe(true);
    }
  });
});

describe("Arpeggiator – Mode 'random' (Determinismus mit Seed)", () => {
  it("gleicher Seed → identische Sequenz", () => {
    const a = applyArp({ notes: C_MAJOR_TRIAD, mode: "random", octaves: 1, stepCount: 8, seed: 42 });
    const b = applyArp({ notes: C_MAJOR_TRIAD, mode: "random", octaves: 1, stepCount: 8, seed: 42 });
    expect(a.map((s) => s.note)).toEqual(b.map((s) => s.note));
  });

  it("unterschiedlicher Seed → unterschiedliche Sequenz (fast immer)", () => {
    const a = applyArp({ notes: C_MAJOR_TRIAD, mode: "random", octaves: 1, stepCount: 16, seed: 1 });
    const b = applyArp({ notes: C_MAJOR_TRIAD, mode: "random", octaves: 1, stepCount: 16, seed: 2 });
    expect(a.map((s) => s.note)).not.toEqual(b.map((s) => s.note));
  });

  it("alle gewählten Noten kommen aus dem Pool", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "random", octaves: 2, stepCount: 20, seed: 7 });
    const pool = new Set([60, 64, 67, 72, 76, 79]);
    for (const s of steps) expect(pool.has(s.note)).toBe(true);
  });
});

describe("Arpeggiator – Mode 'converge'", () => {
  it("4 Noten [60,64,67,72] → [60,72,64,67]", () => {
    const steps = applyArp({ notes: [60, 64, 67, 72], mode: "converge", octaves: 1, stepCount: 4 });
    expect(steps.map((s) => s.note)).toEqual([60, 72, 64, 67]);
  });
});

describe("Arpeggiator – Mode 'diverge'", () => {
  it("4 Noten startet im Mittelteil und expandiert", () => {
    const steps = applyArp({ notes: [60, 64, 67, 72], mode: "diverge", octaves: 1, stepCount: 4 });
    // mid=2, d=0→pool[2]=67; d=1→pool[1]=64 dann pool[3]=72; d=2→pool[0]=60
    expect(steps.map((s) => s.note)).toEqual([67, 64, 72, 60]);
  });
});

describe("Arpeggiator – Mode 'order' (Eingabe-Reihenfolge)", () => {
  it("respektiert User-Reihenfolge auch bei unsortierten Notes", () => {
    const steps = applyArp({ notes: [67, 60, 64], mode: "order", octaves: 1, stepCount: 6 });
    expect(steps.map((s) => s.note)).toEqual([67, 60, 64, 67, 60, 64]);
  });
});

describe("Arpeggiator – Velocity-Patterns", () => {
  it("'flat' liefert konstant 90", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 4, velocityPattern: "flat" });
    for (const s of steps) expect(s.velocity).toBe(90);
  });

  it("'accent24' alterniert 70/110", () => {
    const steps = applyArp({ notes: [60, 64], mode: "up", octaves: 1, stepCount: 4, velocityPattern: "accent24" });
    // accent24: noteIndex 0=70, 1=110, 2=70, 3=110 (basiert auf stepIdx === noteIndex hier)
    expect(steps.map((s) => s.velocity)).toEqual([70, 110, 70, 110]);
  });

  it("'accent13' alterniert 110/70", () => {
    const steps = applyArp({ notes: [60, 64], mode: "up", octaves: 1, stepCount: 4, velocityPattern: "accent13" });
    expect(steps.map((s) => s.velocity)).toEqual([110, 70, 110, 70]);
  });

  it("'crescendo' steigt monoton an", () => {
    const steps = applyArp({ notes: [60, 64], mode: "up", octaves: 1, stepCount: 2, velocityPattern: "crescendo" });
    // crescendo läuft über pool.length=2 → stepIdx 0→40, 1→127
    expect(steps[0].velocity).toBeLessThan(steps[1].velocity);
    expect(steps[0].velocity).toBeGreaterThanOrEqual(40);
    expect(steps[1].velocity).toBeLessThanOrEqual(127);
  });

  it("'decrescendo' fällt monoton ab", () => {
    const steps = applyArp({ notes: [60, 64], mode: "up", octaves: 1, stepCount: 2, velocityPattern: "decrescendo" });
    expect(steps[0].velocity).toBeGreaterThan(steps[1].velocity);
    expect(steps[0].velocity).toBeLessThanOrEqual(127);
    expect(steps[1].velocity).toBeGreaterThanOrEqual(40);
  });

  it("'random' liegt im 50..127 Bereich (deterministisch mit Seed)", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 16, seed: 99, velocityPattern: "random" });
    for (const s of steps) {
      expect(s.velocity).toBeGreaterThanOrEqual(50);
      expect(s.velocity).toBeLessThanOrEqual(127);
    }
  });
});

describe("Arpeggiator – stepSkip", () => {
  it("stepSkip=1 → jeder 2. Step inactive (Indizes 1,3,5,…)", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 6, stepSkip: 1 });
    expect(steps.map((s) => s.active)).toEqual([true, false, true, false, true, false]);
  });

  it("stepSkip=2 → jeder 3. Step inactive", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 6, stepSkip: 2 });
    expect(steps.map((s) => s.active)).toEqual([true, true, false, true, true, false]);
  });

  it("stepSkip=0 (default) → alle aktiv (bei nicht-leeren Noten)", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 4 });
    for (const s of steps) expect(s.active).toBe(true);
  });
});

describe("Arpeggiator – gateLength", () => {
  it("gateLength=0.5 propagiert auf jeden Step.length", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 4, gateLength: 0.5 });
    for (const s of steps) expect(s.length).toBe(0.5);
  });

  it("default gateLength=1", () => {
    const steps = applyArp({ notes: C_MAJOR_TRIAD, mode: "up", octaves: 1, stepCount: 2 });
    for (const s of steps) expect(s.length).toBe(1);
  });
});
