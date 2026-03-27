/**
 * tests/arpeggiator.test.ts
 *
 * Unit-Tests für arpeggiator.ts + useArpStore (Phase 4, v1.10).
 * Umgebung: Node – kein DOM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyArp, ARP_MODE_LABELS } from "@/utils/arpeggiator";
import type { ArpMode } from "@/utils/arpeggiator";
import {
  __resetArpForTests,
  setArpMode,
  setArpOctaves,
  setArpNotes,
  setArpEnabled,
  getArpState,
} from "@/store/useArpStore";

const C_MAJOR = [60, 64, 67]; // C4, E4, G4

// ─── applyArp ─────────────────────────────────────────────────────────────────

describe("applyArp()", () => {
  it("leeres notes-Array → alle Steps inaktiv", () => {
    const steps = applyArp({ notes: [], mode: "up", octaves: 1, stepCount: 16 });
    expect(steps.every(s => !s.active)).toBe(true);
    expect(steps.length).toBe(16);
  });

  it("up: erste 3 Steps = C4, E4, G4", () => {
    const steps = applyArp({ notes: C_MAJOR, mode: "up", octaves: 1, stepCount: 16 });
    expect(steps[0].note).toBe(60);
    expect(steps[1].note).toBe(64);
    expect(steps[2].note).toBe(67);
  });

  it("down: erste 3 Steps = G4, E4, C4", () => {
    const steps = applyArp({ notes: C_MAJOR, mode: "down", octaves: 1, stepCount: 16 });
    expect(steps[0].note).toBe(67);
    expect(steps[1].note).toBe(64);
    expect(steps[2].note).toBe(60);
  });

  it("octaves=2: C-Dur Tonleiter über 2 Oktaven (6 Töne) → step 3 = C5", () => {
    const steps = applyArp({ notes: C_MAJOR, mode: "up", octaves: 2, stepCount: 16 });
    expect(steps[3].note).toBe(72); // C5 = C4 + 12
  });

  it("upDown: kein Doppler des höchsten Tons", () => {
    const steps = applyArp({ notes: C_MAJOR, mode: "upDown", octaves: 1, stepCount: 10 });
    // Pool = [C4,E4,G4,E4] (upDown ohne Wiederholungen der Extrema), cycling
    const notes = steps.map(s => s.note);
    // G4 (höchster Ton) darf nicht zweimal hintereinander erscheinen
    for (let i = 1; i < notes.length; i++) {
      if (notes[i - 1] === 67) {
        expect(notes[i]).not.toBe(67);
      }
    }
  });

  it("random: deterministisch mit gleichem Seed", () => {
    const a = applyArp({ notes: C_MAJOR, mode: "random", octaves: 1, stepCount: 16, seed: 42 });
    const b = applyArp({ notes: C_MAJOR, mode: "random", octaves: 1, stepCount: 16, seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("chord: alle Steps aktiv", () => {
    const steps = applyArp({ notes: C_MAJOR, mode: "chord", octaves: 1, stepCount: 16 });
    expect(steps.every(s => s.active)).toBe(true);
  });

  it("stepCount wird korrekt eingehalten", () => {
    const steps = applyArp({ notes: C_MAJOR, mode: "up", octaves: 1, stepCount: 32 });
    expect(steps.length).toBe(32);
  });
});

// ─── ARP_MODE_LABELS ──────────────────────────────────────────────────────────

describe("ARP_MODE_LABELS", () => {
  const modes: ArpMode[] = ["up", "down", "upDown", "random", "chord"];
  it("enthält Labels für alle 5 Modi", () => {
    for (const m of modes) {
      expect(ARP_MODE_LABELS[m]).toBeTruthy();
    }
  });
});

// ─── useArpStore ──────────────────────────────────────────────────────────────

describe("useArpStore", () => {
  beforeEach(() => __resetArpForTests());

  it("Initialzustand: disabled, mode=up, octaves=1", () => {
    const s = getArpState();
    expect(s.enabled).toBe(false);
    expect(s.mode).toBe("up");
    expect(s.octaves).toBe(1);
  });

  it("setArpEnabled() schaltet um", () => {
    setArpEnabled(true);
    expect(getArpState().enabled).toBe(true);
  });

  it("setArpMode() setzt den Modus", () => {
    setArpMode("chord");
    expect(getArpState().mode).toBe("chord");
  });

  it("setArpOctaves() setzt die Oktaven", () => {
    setArpOctaves(3);
    expect(getArpState().octaves).toBe(3);
  });

  it("setArpNotes() setzt die Noten-Liste", () => {
    setArpNotes([60, 64, 67]);
    expect(getArpState().notes).toEqual([60, 64, 67]);
  });
});
