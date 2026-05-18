/**
 * tests/features/pattern-generator-64step.test.ts (v3.51.0)
 *
 * v3.40 erweiterte den stepCount-Type auf 64, aber die Pattern-Generator-
 * Templates basieren auf festen 16er-Indices — Steps 16..63 blieben leer.
 * v3.51.0 ändert das: Templates werden als Density-Spec interpretiert und
 * über alle Bars expandiert (16 → 32 → 64). Zusätzlich kommt eine
 * Last-Bar-Variation (Snare-Fill auf 4. Beat, Per-Bar Velocity-Drift,
 * Ghost-HiHats in den letzten zwei Bars bei 64-step).
 *
 * Backward-Compat: stepCount=16 verhält sich byte-für-byte wie v3.50.
 */
import { describe, it, expect } from "vitest";
import { generatePattern, type GeneratedPattern } from "@/utils/patternGenerator";

function findPart(pattern: GeneratedPattern, namePart: string) {
  return pattern.parts.find(p => p.name.toLowerCase().includes(namePart.toLowerCase()));
}

function activeIndices(pattern: GeneratedPattern, namePart: string): number[] {
  const part = findPart(pattern, namePart);
  if (!part) return [];
  return part.steps.flatMap((s, i) => (s.active ? [i] : []));
}

describe("Pattern-Generator v3.51 — 64-step Coverage über alle Bars", () => {
  it("Techno Kick @ 64-step hat Triggers auf [0,4,8,...,60] (alle 4 Steps)", () => {
    const pattern = generatePattern({
      genre: "techno",
      complexity: 0,        // 0 → keine xKick extras, nur Base-Kick
      seed: 42,
      stepCount: 64,
    });
    const kickActive = activeIndices(pattern, "kick");
    // Base-Kick ist [0,4,8,12], expandiert auf 4 Bars: 0..60 alle 4 Steps.
    // Plus Last-Bar-Variation darf Kick NICHT verändern.
    for (const expected of [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]) {
      expect(kickActive).toContain(expected);
    }
  });

  it("Trap Hi-Hat-cl @ 64-step hat 64 aktive Steps (every-step in base-bar)", () => {
    const pattern = generatePattern({
      genre: "trap",
      complexity: 0.5,       // >= 0.3 → volles hatCl Set
      seed: 7,
      stepCount: 64,
    });
    const hatActive = activeIndices(pattern, "hi-hat cl");
    // Trap-HiHat: alle 16 Steps per Bar × 4 Bars = 64.
    // Last-Bar-Variation appliziert nur GHOST-NOTES auf bereits inaktive Steps —
    // ein bereits voll-besetzter HiHat-Track sollte 64 aktive Steps haben.
    expect(hatActive).toHaveLength(64);
  });

  it("House Snare @ 64-step hat 8 Trigger aus Base-Spec (+ Last-Bar-Fill-Hits)", () => {
    const pattern = generatePattern({
      genre: "house",
      complexity: 0,         // 0 → keine xSnare extras
      seed: 1,
      stepCount: 64,
    });
    const snare = findPart(pattern, "snare")!;
    // Base-Snare ist [4,12], expandiert auf 4 Bars → 8 Triggers auf
    // [4,12,20,28,36,44,52,60]. Last-Bar-Variation füllt zusätzlich
    // [60,61,62,63] mit Fill — Step 60 ist bereits Teil der Base-Expansion.
    // Erwartet: alle Base-Indices aktiv + Fill auf 60..63 aktiv.
    for (const base of [4, 12, 20, 28, 36, 44, 52, 60]) {
      expect(snare.steps[base].active).toBe(true);
    }
    for (const fill of [60, 61, 62, 63]) {
      expect(snare.steps[fill].active).toBe(true);
    }
  });

  it("Last-Bar-Variation füllt Steps 60..63 (4. Beat des letzten Bars) als Fill", () => {
    const pattern = generatePattern({
      genre: "techno",
      complexity: 0.3,
      seed: 1234,
      stepCount: 64,
    });
    const snare = findPart(pattern, "snare")!;
    // Snare-Fill auf den letzten 4 Steps des letzten Bars.
    for (let i = 60; i <= 63; i++) {
      expect(snare.steps[i].active).toBe(true);
      expect(snare.steps[i].velocity).toBeGreaterThan(0);
    }
  });

  it("32-step Pattern verhält sich analog: 2-Bar-Expansion + Last-Bar-Fill", () => {
    const pattern = generatePattern({
      genre: "techno",
      complexity: 0,
      seed: 99,
      stepCount: 32,
    });
    const kickActive = activeIndices(pattern, "kick");
    // techno Kick base [0,4,8,12] × 2 Bars → 8 Triggers.
    for (const expected of [0, 4, 8, 12, 16, 20, 24, 28]) {
      expect(kickActive).toContain(expected);
    }
    // Last-Bar-Fill in Bar-1 → Snare-Steps 28..31 aktiv.
    const snare = findPart(pattern, "snare")!;
    for (let i = 28; i <= 31; i++) {
      expect(snare.steps[i].active).toBe(true);
    }
  });

  it("Backward-Compat: 16-step Pattern unverändert (kein Last-Bar-Fill)", () => {
    // Snapshot der 16-step-Ausgabe vor und nach Refactor muss identisch bleiben.
    // Bei stepCount=16 gibt es keine "Last Bar"-Variation, weil bars < 2.
    const pattern = generatePattern({
      genre: "house",
      complexity: 0.5,
      seed: 12345,
    });
    for (const part of pattern.parts) {
      expect(part.steps).toHaveLength(16);
    }
    // Bestätige House-Kick-Base [0,4,8,12] (oder durch complexity erweitert,
    // aber niemals AUSSERHALB [0..15]).
    const kickActive = activeIndices(pattern, "kick");
    for (const idx of kickActive) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(16);
    }
    // Snare base [4,12] muss aktiv sein bei complexity=0.5 (kein Fill auf 12..15).
    const snare = findPart(pattern, "snare")!;
    expect(snare.steps[4].active).toBe(true);
    expect(snare.steps[12].active).toBe(true);
  });

  it("Ghost-HiHat-Notes erscheinen auf 16th-Offbeats in den letzten 2 Bars (64-step)", () => {
    // Bei complexity=0 sind viele HiHat-Steps inaktiv → Ghost-Noten füllen
    // einige der Offbeat-Positionen in Bar 2-3.
    const pattern = generatePattern({
      genre: "house",   // House hatCl base [2,6,10,14] — Offbeats 1,3,5... sind frei
      complexity: 0,
      seed: 555,
      stepCount: 64,
    });
    const hat = findPart(pattern, "hi-hat cl")!;
    // Ghost-Noten haben velocity 30..55. Wir prüfen, dass MIND. EIN Ghost-Step
    // in den letzten 2 Bars (32..63) auftaucht, der NICHT durch Base/Extra
    // gesetzt wäre.
    let ghostsInLast2Bars = 0;
    for (let i = 32; i < 64; i++) {
      if (hat.steps[i].active && hat.steps[i].velocity <= 55 && hat.steps[i].velocity >= 30) {
        ghostsInLast2Bars++;
      }
    }
    expect(ghostsInLast2Bars).toBeGreaterThan(0);
  });

  it("Determinismus: gleicher Seed @ 64-step → identische Ausgabe", () => {
    const a = generatePattern({ genre: "dnb", complexity: 0.6, seed: 8888, stepCount: 64 });
    const b = generatePattern({ genre: "dnb", complexity: 0.6, seed: 8888, stepCount: 64 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("Coverage-Gesamtcheck: 64-step Pattern hat aktive Steps WEIT über Index 15 (closes v3.40)", () => {
    const pattern = generatePattern({
      genre: "techno",
      complexity: 0.5,
      seed: 31337,
      stepCount: 64,
    });
    // Aggregiere alle aktiven Step-Indices über alle Parts.
    const allActiveIndices = new Set<number>();
    for (const part of pattern.parts) {
      part.steps.forEach((s, i) => { if (s.active) allActiveIndices.add(i); });
    }
    // v3.40-Bug: alle aktiven Steps wären < 16. v3.51 muss aktive Steps in
    // jedem 16er-Bar haben.
    const inBar0 = [...allActiveIndices].some(i => i < 16);
    const inBar1 = [...allActiveIndices].some(i => i >= 16 && i < 32);
    const inBar2 = [...allActiveIndices].some(i => i >= 32 && i < 48);
    const inBar3 = [...allActiveIndices].some(i => i >= 48 && i < 64);
    expect(inBar0).toBe(true);
    expect(inBar1).toBe(true);
    expect(inBar2).toBe(true);
    expect(inBar3).toBe(true);
  });
});
