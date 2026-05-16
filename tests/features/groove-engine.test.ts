/**
 * Synthstudio – grooveEngine Tests (v2.56)
 *
 * Pure-Function-Coverage für die bisher untestete utils/grooveEngine.ts:
 * 8 built-in GROOVE_TEMPLATES, applyGroove velocity-Math + Clamp,
 * templateSwingPercent + Edge-Cases.
 */
import { describe, it, expect } from "vitest";
import {
  GROOVE_TEMPLATES,
  applyGroove,
  templateSwingPercent,
  type GrooveTemplate,
} from "../../client/src/utils/grooveEngine";
import type { StepData } from "../../client/src/audio/AudioEngine";

function step(active: boolean, velocity = 100): StepData {
  return { active, velocity, pitch: 0 };
}

function getTemplate(id: string): GrooveTemplate {
  const t = GROOVE_TEMPLATES.find(g => g.id === id);
  if (!t) throw new Error(`Template ${id} not found`);
  return t;
}

describe("GROOVE_TEMPLATES — Schema-Invarianten", () => {
  it("8 Templates sind exportiert", () => {
    expect(GROOVE_TEMPLATES.length).toBe(8);
  });

  it("Jedes Template hat genau 16 timing- und velocity-Werte", () => {
    for (const t of GROOVE_TEMPLATES) {
      expect(t.timing).toHaveLength(16);
      expect(t.velocity).toHaveLength(16);
    }
  });

  it("Jedes Template hat eindeutige id + nicht-leere Felder", () => {
    const ids = new Set<string>();
    for (const t of GROOVE_TEMPLATES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.bpm).toBeGreaterThan(0);
      ids.add(t.id);
    }
    expect(ids.size).toBe(GROOVE_TEMPLATES.length);
  });

  it("Straight-Template hat 0 timing + 1.0 velocity überall", () => {
    const straight = getTemplate("straight");
    expect(straight.timing.every(t => t === 0)).toBe(true);
    expect(straight.velocity.every(v => v === 1.0)).toBe(true);
  });

  it("Velocity-Werte sind im sinnvollen Bereich 0.5..1.5 (Multiplikatoren)", () => {
    for (const t of GROOVE_TEMPLATES) {
      for (const v of t.velocity) {
        expect(v).toBeGreaterThanOrEqual(0.5);
        expect(v).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("Timing-Werte sind im sinnvollen Bereich −50..+50 ms", () => {
    for (const t of GROOVE_TEMPLATES) {
      for (const tm of t.timing) {
        expect(tm).toBeGreaterThanOrEqual(-50);
        expect(tm).toBeLessThanOrEqual(50);
      }
    }
  });
});

describe("applyGroove — Velocity-Math", () => {
  it("Straight-Template ändert active Velocities nicht", () => {
    const straight = getTemplate("straight");
    const steps = [step(true, 100), step(true, 80), step(true, 127)];
    const out = applyGroove(steps, straight);
    expect(out[0].velocity).toBe(100);
    expect(out[1].velocity).toBe(80);
    expect(out[2].velocity).toBe(127);
  });

  it("Inactive Steps werden nicht modifiziert (Velocity bleibt)", () => {
    const mpc = getTemplate("mpc-classic");
    const steps = [step(false, 100), step(false, 80)];
    const out = applyGroove(steps, mpc);
    expect(out[0].velocity).toBe(100);
    expect(out[1].velocity).toBe(80);
  });

  it("Hip-Hop bei amount=1: Offbeat (Step 1) hat 0.75× Velocity → 100 → 75", () => {
    const hh = getTemplate("hip-hop");
    const steps = Array.from({ length: 16 }, () => step(true, 100));
    const out = applyGroove(steps, hh, 1.0);
    expect(out[0].velocity).toBe(100);       // Downbeat: 1.0×
    expect(out[1].velocity).toBe(75);        // Offbeat: 0.75×
  });

  it("amount=0 deaktiviert die Velocity-Variation (alle bleiben 100)", () => {
    const hh = getTemplate("hip-hop");
    const steps = Array.from({ length: 16 }, () => step(true, 100));
    const out = applyGroove(steps, hh, 0);
    for (const s of out) expect(s.velocity).toBe(100);
  });

  it("amount=0.5 wirkt halb so stark wie amount=1", () => {
    const hh = getTemplate("hip-hop");
    const steps = [step(true, 100), step(true, 100)];
    const full = applyGroove(steps, hh, 1.0);
    const half = applyGroove(steps, hh, 0.5);
    // 0.75-mult bei amount=1 → 75, bei amount=0.5 → 87 (entspricht (1 + (0.75-1)*0.5)*100 = 87.5)
    expect(full[1].velocity).toBe(75);
    expect(half[1].velocity).toBe(88); // Math.round(87.5)
  });

  it("Velocity-Clamp: Minimal 1 (verhindert 0 oder negativ)", () => {
    const heavy = {
      id: "x", name: "x", description: "x", bpm: 120,
      timing: Array(16).fill(0),
      velocity: Array(16).fill(0.001),  // extrem niedriger Multiplikator
    } as GrooveTemplate;
    const steps = [step(true, 100)];
    const out = applyGroove(steps, heavy);
    expect(out[0].velocity).toBeGreaterThanOrEqual(1);
  });

  it("Velocity-Clamp: Maximal 127", () => {
    const loud = {
      id: "x", name: "x", description: "x", bpm: 120,
      timing: Array(16).fill(0),
      velocity: Array(16).fill(5),  // 5×-Boost würde > 127 liefern
    } as GrooveTemplate;
    const steps = [step(true, 100)];
    const out = applyGroove(steps, loud);
    expect(out[0].velocity).toBe(127);
  });

  it("Modulo: 32-Step-Pattern wickelt sich auf 16-Slot-Template", () => {
    const hh = getTemplate("hip-hop");
    const steps = Array.from({ length: 32 }, () => step(true, 100));
    const out = applyGroove(steps, hh, 1.0);
    // Step 17 (Index 17, 17%16=1) hat Offbeat-Pattern → 75
    expect(out[17].velocity).toBe(75);
    // Step 16 (16%16=0) hat Downbeat → 100
    expect(out[16].velocity).toBe(100);
  });

  it("applyVelocity=false überspringt die Velocity-Variation", () => {
    const hh = getTemplate("hip-hop");
    const steps = Array.from({ length: 16 }, () => step(true, 100));
    const out = applyGroove(steps, hh, 1.0, true, false);
    for (const s of out) expect(s.velocity).toBe(100);
  });

  it("Step ohne explizite velocity (undefined) wird auf Default 100 mit Multiplikator behandelt", () => {
    const hh = getTemplate("hip-hop");
    const steps: StepData[] = [{ active: true, pitch: 0 } as StepData];
    const out = applyGroove(steps, hh, 1.0);
    expect(out[0].velocity).toBe(100); // Index 0 = Downbeat
  });

  it("Immutable: Input-Array unverändert", () => {
    const hh = getTemplate("hip-hop");
    const input = [step(true, 100)];
    const original = input[0].velocity;
    applyGroove(input, hh, 1.0);
    expect(input[0].velocity).toBe(original);
  });
});

describe("templateSwingPercent", () => {
  it("Straight: Offbeat-timing=0 → 50% (kein Swing)", () => {
    expect(templateSwingPercent(getTemplate("straight"))).toBe(50);
  });

  it("MPC-Classic: Offbeat-timing=18 → 68% (50 + 18*50/50 = 68)", () => {
    expect(templateSwingPercent(getTemplate("mpc-classic"))).toBe(68);
  });

  it("Hip-Hop Heavy: Offbeat-timing=28 → 78%", () => {
    expect(templateSwingPercent(getTemplate("hip-hop"))).toBe(78);
  });

  it("Template mit leerem timing-Array → fallback 50 (Default-Swing)", () => {
    const t: GrooveTemplate = {
      id: "x", name: "x", description: "x", bpm: 120,
      timing: [],
      velocity: [],
    };
    expect(templateSwingPercent(t)).toBe(50);
  });

  it("Shuffle: extreme Swing-Werte werden als hohe % gerundet", () => {
    expect(templateSwingPercent(getTemplate("shuffle"))).toBe(83); // 50 + 33 = 83
  });
});
