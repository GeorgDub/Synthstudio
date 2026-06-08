/**
 * tests/features/arp-store.test.ts (TASK-CVG-ARP-STORE / v2.64)
 *
 * Unit-Tests für useArpStore (Modul-Singleton ohne Persistenz).
 * Verifiziert Setter + getArpSteps Integration mit applyArp.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setArpEnabled,
  setArpMode,
  setArpOctaves,
  setArpNotes,
  setArpStepCount,
  setArpOutputMode,
  setArpTargetPartId,
  resetArp,
  getArpSteps,
  getArpState,
  __resetArpForTests,
} from "@/store/useArpStore";

describe("useArpStore – Default-State", () => {
  beforeEach(() => __resetArpForTests());

  it("startet mit enabled=false", () => {
    expect(getArpState().enabled).toBe(false);
  });

  it("Default-Notes ist C-Major-Triad [60, 64, 67]", () => {
    expect(getArpState().notes).toEqual([60, 64, 67]);
  });

  it("Default-Mode ist 'up'", () => {
    expect(getArpState().mode).toBe("up");
  });

  it("Default-Octaves ist 1", () => {
    expect(getArpState().octaves).toBe(1);
  });

  it("Default-StepCount ist 16", () => {
    expect(getArpState().stepCount).toBe(16);
  });
});

describe("useArpStore – Setter", () => {
  beforeEach(() => __resetArpForTests());

  it("setArpEnabled toggle", () => {
    setArpEnabled(true);
    expect(getArpState().enabled).toBe(true);
    setArpEnabled(false);
    expect(getArpState().enabled).toBe(false);
  });

  it("setArpMode wechselt auf 'down'", () => {
    setArpMode("down");
    expect(getArpState().mode).toBe("down");
  });

  it("setArpMode wechselt auf 'random'", () => {
    setArpMode("random");
    expect(getArpState().mode).toBe("random");
  });

  it("setArpOctaves auf 3", () => {
    setArpOctaves(3);
    expect(getArpState().octaves).toBe(3);
  });

  it("setArpNotes setzt komplett neue Noten", () => {
    setArpNotes([72, 76, 79]);
    expect(getArpState().notes).toEqual([72, 76, 79]);
  });

  it("setArpStepCount auf 32", () => {
    setArpStepCount(32);
    expect(getArpState().stepCount).toBe(32);
  });
});

describe("useArpStore – State-Immutability", () => {
  beforeEach(() => __resetArpForTests());

  it("Setter mutieren keine alten getArpState-Snapshots", () => {
    const snapshot = getArpState();
    setArpMode("down");
    // alter snapshot bleibt 'up', neuer getArpState liefert 'down'
    expect(snapshot.mode).toBe("up");
    expect(getArpState().mode).toBe("down");
  });
});

describe("useArpStore – getArpSteps (Integration mit applyArp)", () => {
  beforeEach(() => __resetArpForTests());

  it("Default → 16 Steps mit Notes [60,64,67] in up-Mode", () => {
    const steps = getArpSteps();
    expect(steps).toHaveLength(16);
    // Erste 3 Steps spielen die 3 Noten der Reihe nach
    expect(steps.slice(0, 3).map((s) => s.note)).toEqual([60, 64, 67]);
  });

  it("Mode-Wechsel auf 'down' kehrt die Note-Reihenfolge um", () => {
    setArpMode("down");
    const steps = getArpSteps();
    expect(steps.slice(0, 3).map((s) => s.note)).toEqual([67, 64, 60]);
  });

  it("setArpOctaves(2) erweitert den Pool", () => {
    setArpOctaves(2);
    const steps = getArpSteps();
    expect(steps.slice(0, 6).map((s) => s.note)).toEqual([60, 64, 67, 72, 76, 79]);
  });

  it("setArpNotes([]) → alle Steps inactive", () => {
    setArpNotes([]);
    const steps = getArpSteps();
    expect(steps.every((s) => !s.active)).toBe(true);
  });

  it("setArpStepCount(8) → 8 Steps", () => {
    setArpStepCount(8);
    expect(getArpSteps()).toHaveLength(8);
  });

  it("Kombinierter State-Switch: notes + octaves + stepCount", () => {
    setArpNotes([60, 67]);
    setArpOctaves(2);
    setArpStepCount(4);
    const steps = getArpSteps();
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.note)).toEqual([60, 67, 72, 79]);
  });
});

describe("useArpStore – Output-Modus (v3.268)", () => {
  beforeEach(() => __resetArpForTests());

  it("Default outputMode ist 'synth'", () => {
    expect(getArpState().outputMode).toBe("synth");
  });

  it("Default targetPartId ist null", () => {
    expect(getArpState().targetPartId).toBeNull();
  });

  it("setArpOutputMode wechselt auf 'channel'", () => {
    setArpOutputMode("channel");
    expect(getArpState().outputMode).toBe("channel");
  });

  it("setArpOutputMode wechselt auf 'midi'", () => {
    setArpOutputMode("midi");
    expect(getArpState().outputMode).toBe("midi");
  });

  it("setArpTargetPartId setzt + leert (null)", () => {
    setArpTargetPartId("part-7");
    expect(getArpState().targetPartId).toBe("part-7");
    setArpTargetPartId(null);
    expect(getArpState().targetPartId).toBeNull();
  });
});

describe("useArpStore – resetArp (Neues Projekt, v3.270)", () => {
  beforeEach(() => __resetArpForTests());

  it("setzt ALLE Felder auf Defaults zurück (vorher leckte State ins neue Projekt)", () => {
    setArpEnabled(true);
    setArpMode("down");
    setArpOctaves(3);
    setArpNotes([1, 2, 3]);
    setArpStepCount(8);
    setArpOutputMode("midi");
    setArpTargetPartId("part-x");
    resetArp();
    const s = getArpState();
    expect(s.enabled).toBe(false);
    expect(s.mode).toBe("up");
    expect(s.octaves).toBe(1);
    expect(s.notes).toEqual([60, 64, 67]);
    expect(s.stepCount).toBe(16);
    expect(s.outputMode).toBe("synth");
    expect(s.targetPartId).toBeNull();
  });

  it("ist idempotent / safe auch wenn bereits auf Defaults", () => {
    resetArp();
    resetArp();
    expect(getArpState().enabled).toBe(false);
    expect(getArpState().notes).toEqual([60, 64, 67]);
  });
});

describe("useArpStore – __resetArpForTests", () => {
  it("setzt alle Felder auf Defaults zurück", () => {
    setArpEnabled(true);
    setArpMode("down");
    setArpOctaves(3);
    setArpNotes([1, 2, 3]);
    setArpStepCount(32);
    setArpOutputMode("midi");
    setArpTargetPartId("part-x");
    __resetArpForTests();
    const s = getArpState();
    expect(s.enabled).toBe(false);
    expect(s.mode).toBe("up");
    expect(s.octaves).toBe(1);
    expect(s.notes).toEqual([60, 64, 67]);
    expect(s.stepCount).toBe(16);
    expect(s.outputMode).toBe("synth");
    expect(s.targetPartId).toBeNull();
  });
});
