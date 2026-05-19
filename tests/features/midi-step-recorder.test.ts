/**
 * tests/features/midi-step-recorder.test.ts  (v3.97.0)
 *
 * Tests für useMidiStepRecorderStore + Note-On → Step-Write Logic.
 *
 * Aufteilung:
 *   - Store-Actions (setEnabled, setArmedPart, setMode, advanceStep, reset)
 *   - Note-Routing-Simulation (entspricht dem App.tsx-Listener auf
 *     "midi:stepRecorder"-Events) — gegen ein Minimal-PatternData-Mock
 *
 * Der Store ist Modul-Singleton — beforeEach ruft __resetForTests().
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (Store nutzt es nicht, aber andere Module könnten) ────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  isMidiStepRecorderEnabled,
  getMidiStepRecorderState,
  setEnabled,
  setArmedPart,
  setMode,
  advanceStep,
  setCurrentStep,
  reset,
  __resetForTests,
  type MidiStepRecorderMode,
} from "@/store/useMidiStepRecorderStore";

// ─── Pattern-Mock (Minimal-Form analog DrumMachine-Store) ────────────────────

interface StepMock { active: boolean; velocity: number; }
interface PartMock { id: string; name: string; steps: StepMock[]; }
interface PatternMock { stepCount: number; parts: PartMock[]; }

function makePart(id: string, name: string, steps: number): PartMock {
  return {
    id,
    name,
    steps: Array.from({ length: steps }, () => ({ active: false, velocity: 100 })),
  };
}

function makePattern(stepCount: number, partIds: string[]): PatternMock {
  return {
    stepCount,
    parts: partIds.map((id, i) => makePart(id, `Part${i + 1}`, stepCount)),
  };
}

/**
 * Simulation des App.tsx-Listeners auf "midi:stepRecorder"-Events.
 * Entspricht 1:1 dem Wiring in App.tsx (siehe v3.97.0-useEffect).
 */
function applyNoteOnToPattern(
  pattern: PatternMock,
  velocity: number,
): void {
  const rec = getMidiStepRecorderState();
  if (!rec.enabled || !rec.armedPartId) return;
  const part = pattern.parts.find((p) => p.id === rec.armedPartId);
  if (!part) return;
  const stepIndex = rec.currentStep;
  if (stepIndex < 0 || stepIndex >= pattern.stepCount) return;
  const cur = part.steps[stepIndex];
  if (rec.mode === "overwrite") {
    // Clear vor write
    cur.active = false;
    cur.velocity = 100;
    cur.active = true;
  } else {
    // Overdub
    if (!cur.active) cur.active = true;
  }
  cur.velocity = Math.max(1, Math.min(127, velocity));
  advanceStep(pattern.stepCount);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useMidiStepRecorderStore – Defaults", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("startet mit enabled=false, currentStep=0, armedPartId=null, mode='overwrite'", () => {
    const snap = getMidiStepRecorderState();
    expect(snap.enabled).toBe(false);
    expect(snap.currentStep).toBe(0);
    expect(snap.armedPartId).toBeNull();
    expect(snap.mode).toBe("overwrite");
  });

  it("isMidiStepRecorderEnabled spiegelt setEnabled", () => {
    expect(isMidiStepRecorderEnabled()).toBe(false);
    setEnabled(true);
    expect(isMidiStepRecorderEnabled()).toBe(true);
    setEnabled(false);
    expect(isMidiStepRecorderEnabled()).toBe(false);
  });
});

describe("useMidiStepRecorderStore – Actions", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("setArmedPart setzt armedPartId und resettet currentStep", () => {
    setCurrentStep(5);
    expect(getMidiStepRecorderState().currentStep).toBe(5);
    setArmedPart("kick-id");
    const snap = getMidiStepRecorderState();
    expect(snap.armedPartId).toBe("kick-id");
    expect(snap.currentStep).toBe(0); // reset on arm-change
  });

  it("setArmedPart ist idempotent bei gleichem Wert", () => {
    setArmedPart("a");
    setCurrentStep(3);
    setArmedPart("a"); // sollte Cursor NICHT zurücksetzen
    expect(getMidiStepRecorderState().currentStep).toBe(3);
  });

  it("setMode akzeptiert nur 'overwrite' und 'overdub'", () => {
    setMode("overdub");
    expect(getMidiStepRecorderState().mode).toBe("overdub");
    setMode("overwrite");
    expect(getMidiStepRecorderState().mode).toBe("overwrite");
    // Invalid → ignored
    setMode("garbage" as MidiStepRecorderMode);
    expect(getMidiStepRecorderState().mode).toBe("overwrite");
  });

  it("setEnabled(false) resettet currentStep auf 0", () => {
    setEnabled(true);
    setArmedPart("a");
    setCurrentStep(7);
    expect(getMidiStepRecorderState().currentStep).toBe(7);
    setEnabled(false);
    expect(getMidiStepRecorderState().currentStep).toBe(0);
  });

  it("reset() leert alles auf Defaults", () => {
    setEnabled(true);
    setArmedPart("a");
    setMode("overdub");
    setCurrentStep(4);
    reset();
    const snap = getMidiStepRecorderState();
    expect(snap.enabled).toBe(false);
    expect(snap.armedPartId).toBeNull();
    expect(snap.mode).toBe("overwrite");
    expect(snap.currentStep).toBe(0);
  });
});

describe("useMidiStepRecorderStore – advanceStep wrap modulo stepCount", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("advanceStep zählt linear hoch", () => {
    expect(getMidiStepRecorderState().currentStep).toBe(0);
    advanceStep(16);
    expect(getMidiStepRecorderState().currentStep).toBe(1);
    advanceStep(16);
    advanceStep(16);
    expect(getMidiStepRecorderState().currentStep).toBe(3);
  });

  it("wrappt am Pattern-Ende zurück auf 0 (16 Steps)", () => {
    for (let i = 0; i < 15; i++) advanceStep(16);
    expect(getMidiStepRecorderState().currentStep).toBe(15);
    advanceStep(16);
    expect(getMidiStepRecorderState().currentStep).toBe(0);
  });

  it("wrappt korrekt bei stepCount=32", () => {
    setCurrentStep(31);
    advanceStep(32);
    expect(getMidiStepRecorderState().currentStep).toBe(0);
  });

  it("clamps stepCount auf >=1 (defensiv: 0 würde sonst NaN/Infinity geben)", () => {
    setCurrentStep(5);
    advanceStep(0); // → behandelt als 1, Modulo 1 = 0
    expect(getMidiStepRecorderState().currentStep).toBe(0);
  });
});

describe("MIDI-Step-Recorder – Note-On → Step-Write (overwrite mode)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("schreibt aktiven Step + Velocity bei armed + enabled", () => {
    const pattern = makePattern(16, ["kick", "snare"]);
    setEnabled(true);
    setArmedPart("kick");
    applyNoteOnToPattern(pattern, 96);
    const kick = pattern.parts.find((p) => p.id === "kick")!;
    expect(kick.steps[0].active).toBe(true);
    expect(kick.steps[0].velocity).toBe(96);
  });

  it("auto-advance nach jedem Note-On — drei Hits → Steps 0,1,2 aktiv", () => {
    const pattern = makePattern(16, ["kick"]);
    setEnabled(true);
    setArmedPart("kick");
    applyNoteOnToPattern(pattern, 90);
    applyNoteOnToPattern(pattern, 100);
    applyNoteOnToPattern(pattern, 110);
    const kick = pattern.parts[0];
    expect(kick.steps[0].active).toBe(true);
    expect(kick.steps[0].velocity).toBe(90);
    expect(kick.steps[1].active).toBe(true);
    expect(kick.steps[1].velocity).toBe(100);
    expect(kick.steps[2].active).toBe(true);
    expect(kick.steps[2].velocity).toBe(110);
    // Cursor auf 3
    expect(getMidiStepRecorderState().currentStep).toBe(3);
  });

  it("Overwrite: bestehender aktiver Step wird mit neuer Velocity überschrieben", () => {
    const pattern = makePattern(16, ["kick"]);
    pattern.parts[0].steps[0].active = true;
    pattern.parts[0].steps[0].velocity = 50; // existing
    setEnabled(true);
    setMode("overwrite");
    setArmedPart("kick");
    applyNoteOnToPattern(pattern, 120);
    expect(pattern.parts[0].steps[0].active).toBe(true);
    expect(pattern.parts[0].steps[0].velocity).toBe(120);
  });
});

describe("MIDI-Step-Recorder – Note-On in Overdub-Modus", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("Overdub additive: aktiviert inaktive Steps", () => {
    const pattern = makePattern(16, ["kick"]);
    setEnabled(true);
    setMode("overdub");
    setArmedPart("kick");
    applyNoteOnToPattern(pattern, 80);
    expect(pattern.parts[0].steps[0].active).toBe(true);
    expect(pattern.parts[0].steps[0].velocity).toBe(80);
  });

  it("Overdub: bereits aktiver Step bleibt aktiv, nur Velocity wird geupdatet", () => {
    const pattern = makePattern(16, ["kick"]);
    pattern.parts[0].steps[0].active = true;
    pattern.parts[0].steps[0].velocity = 40;
    setEnabled(true);
    setMode("overdub");
    setArmedPart("kick");
    applyNoteOnToPattern(pattern, 127);
    expect(pattern.parts[0].steps[0].active).toBe(true);
    expect(pattern.parts[0].steps[0].velocity).toBe(127);
    // Cursor advance trotzdem
    expect(getMidiStepRecorderState().currentStep).toBe(1);
  });
});

describe("MIDI-Step-Recorder – disabled = no-op", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("kein Write wenn enabled=false (auch mit armed Channel)", () => {
    const pattern = makePattern(16, ["kick"]);
    setEnabled(false);
    setArmedPart("kick");
    applyNoteOnToPattern(pattern, 100);
    expect(pattern.parts[0].steps[0].active).toBe(false);
    expect(pattern.parts[0].steps[0].velocity).toBe(100); // default unverändert
    expect(getMidiStepRecorderState().currentStep).toBe(0); // kein advance
  });

  it("kein Write wenn enabled=true aber armedPartId=null", () => {
    const pattern = makePattern(16, ["kick"]);
    setEnabled(true);
    setArmedPart(null);
    applyNoteOnToPattern(pattern, 100);
    expect(pattern.parts[0].steps[0].active).toBe(false);
    expect(getMidiStepRecorderState().currentStep).toBe(0);
  });

  it("kein Write wenn armedPartId nicht im Pattern existiert", () => {
    const pattern = makePattern(16, ["kick"]);
    setEnabled(true);
    setArmedPart("ghost-part-id"); // existiert nicht
    applyNoteOnToPattern(pattern, 100);
    expect(pattern.parts[0].steps[0].active).toBe(false);
  });
});

describe("MIDI-Step-Recorder – Velocity-Clamping", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("Velocity wird auf 1..127 geclamped", () => {
    const pattern = makePattern(16, ["kick"]);
    setEnabled(true);
    setArmedPart("kick");
    applyNoteOnToPattern(pattern, 0); // → clamped auf 1
    expect(pattern.parts[0].steps[0].velocity).toBe(1);
    applyNoteOnToPattern(pattern, 999); // → clamped auf 127
    expect(pattern.parts[0].steps[1].velocity).toBe(127);
  });
});

describe("MIDI-Step-Recorder – Listener-API (Snapshot-Subscribe)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetForTests();
  });

  it("getMidiStepRecorderState liefert frische Werte nach Mutation", () => {
    setEnabled(true);
    setArmedPart("foo");
    setMode("overdub");
    setCurrentStep(7);
    const snap = getMidiStepRecorderState();
    expect(snap).toEqual({
      enabled: true,
      currentStep: 7,
      armedPartId: "foo",
      mode: "overdub",
    });
  });
});
