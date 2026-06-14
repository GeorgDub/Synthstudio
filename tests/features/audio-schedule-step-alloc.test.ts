// @vitest-environment jsdom
/**
 * audio-schedule-step-alloc.test.ts — TASK-254 Regressionstests.
 *
 * Sichert ab, dass die Allokations-Optimierung von `_scheduleStep`
 * (forEach→for, gehoistete Lookups, vorab-alloziertes Uint8Array +
 * gebundener Clock-Pulse-Sender) das TIMING + die REIHENFOLGE der
 * geplanten Events NICHT verändert. Pure Verhaltens-Invarianten —
 * keine echte Web-Audio-Wiedergabe nötig.
 *
 * Getestet über die öffentliche `onStep`-Seam: jeder getriggerte Voice
 * liefert ein `ScheduledStep` mit partIndex / stepIndex / time / velocity /
 * pan / pitch. Wir spiegeln diese Felder in eine eigene Liste (kein Ref auf
 * das engine-Objekt) und prüfen Ordnung + Werte.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { AudioEngine } from "../../client/src/audio/AudioEngine";
import type { PartData, PatternData, ScheduledStep, StepData } from "../../client/src/audio/AudioEngine";

// ─── Minimaler AudioContext-Mock ──────────────────────────────────────────────
// _scheduleStep liest nur this.ctx.currentTime; alle Sound-erzeugenden Pfade
// werden in diesen Tests gar nicht erreicht (Parts ohne sampleUrl/synthParams),
// daher reicht ein currentTime-Stub.
const fakeCtx = { currentTime: 0 } as unknown as AudioContext;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkStep(active: boolean, over: Partial<StepData> = {}): StepData {
  return { active, velocity: 100, probability: 100, ...over };
}

function mkPart(id: string, steps: StepData[], over: Partial<PartData> = {}): PartData {
  return {
    id,
    name: id,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: {} as PartData["fx"],
    ...over,
  };
}

function mkPattern(parts: PartData[]): PatternData {
  return {
    id: "p1",
    name: "p1",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: 120,
    parts,
  } as unknown as PatternData;
}

/** Ruft die (private) Scheduler-Methode für einen Step auf. */
function scheduleStep(stepIndex: number, time: number, pattern: PatternData): void {
  (AudioEngine as unknown as {
    _scheduleStep: (i: number, t: number, p: PatternData) => void;
  })._scheduleStep(stepIndex, time, pattern);
}

/** Eine ganze Pattern-Runde planen, Step-Events in Reihenfolge sammeln. */
function runPattern(pattern: PatternData, steps: number, stepDur = 0.125): ScheduledStep[] {
  const collected: ScheduledStep[] = [];
  const unsub = AudioEngine.onStep((s) => {
    // Felder kopieren (kein Ref auf evtl. wiederverwendete Strukturen).
    collected.push({
      partIndex: s.partIndex,
      stepIndex: s.stepIndex,
      time: s.time,
      velocity: s.velocity,
      pan: s.pan,
      pitch: s.pitch,
      reverse: s.reverse,
    });
  });
  for (let i = 0; i < steps; i++) {
    scheduleStep(i, i * stepDur, pattern);
  }
  unsub();
  return collected;
}

describe("TASK-254: _scheduleStep Allokations-Optimierung — Timing/Ordering invariant", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers(); // setTimeout (Position-Callback + MIDI-Clock-Pulse) nicht feuern lassen
    fakeCtx.currentTime = 0;
    // ctx + Step-Count auf der Singleton-Engine setzen.
    Object.assign(AudioEngine as unknown as Record<string, unknown>, {
      ctx: fakeCtx,
      _steps: 16,
    });
    // Determinismus: shouldTriggerStep nutzt Math.random für probability<100.
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    // Laufzeit-Globalslots (Humanizer/Beat-Repeat) ausschalten — sie würden
    // Timing/Velocity perturbieren und sind in den Tests irrelevant.
    delete (globalThis as Record<string, unknown>)["__synthstudio_humanizer__"];
    delete (globalThis as Record<string, unknown>)["__synthstudio_beatrepeat__"];
  });

  afterEach(() => {
    randomSpy.mockRestore();
    vi.clearAllTimers();
    vi.useRealTimers();
    Object.assign(AudioEngine as unknown as Record<string, unknown>, { ctx: null });
  });

  it("normal pattern: feuert je aktivem Step in Part-Reihenfolge mit korrekter time", () => {
    // Part A feuert auf Steps 0 + 2, Part B auf Step 0. Pattern-Länge 4.
    const partA = mkPart("A", [
      mkStep(true, { velocity: 110 }),
      mkStep(false),
      mkStep(true, { velocity: 90, pitch: 3 }),
      mkStep(false),
    ]);
    const partB = mkPart("B", [
      mkStep(true, { velocity: 80 }),
      mkStep(false),
      mkStep(false),
      mkStep(false),
    ], { pan: -0.5 });
    const pattern = mkPattern([partA, partB]);

    const events = runPattern(pattern, 4, 0.125);

    // Erwartet: Step0 → A(0) dann B(0); Step2 → A(2).
    expect(events).toHaveLength(3);

    // Reihenfolge innerhalb Step0: Part-Index 0 vor 1 (forEach→for muss Ordnung wahren).
    expect(events[0]).toMatchObject({ partIndex: 0, stepIndex: 0, time: 0, velocity: 110, pan: 0, pitch: 0 });
    expect(events[1]).toMatchObject({ partIndex: 1, stepIndex: 0, time: 0, velocity: 80, pan: -0.5 });
    // Step2: nur Part A, time = 2 * stepDur.
    expect(events[2]).toMatchObject({ partIndex: 0, stepIndex: 2, time: 0.25, velocity: 90, pitch: 3 });
  });

  it("edge case: leeres/spärliches Pattern feuert keine bzw. nur die aktiven Events", () => {
    // Komplett leeres Pattern → 0 Events.
    const empty = mkPattern([mkPart("A", [mkStep(false), mkStep(false)])]);
    expect(runPattern(empty, 2, 0.125)).toHaveLength(0);

    // Spärlich: ein einziger aktiver Step inmitten von Leerlauf.
    const sparse = mkPattern([
      mkPart("A", [mkStep(false), mkStep(false), mkStep(true, { velocity: 64 }), mkStep(false)]),
    ]);
    const ev = runPattern(sparse, 4, 0.1);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ partIndex: 0, stepIndex: 2, time: 0.2, velocity: 64 });
  });

  it("determinismus: zwei identische Durchläufe liefern byte-gleiche Event-Sequenz", () => {
    const build = () => mkPattern([
      mkPart("A", [mkStep(true, { velocity: 100, pitch: 1 }), mkStep(true, { velocity: 50 })]),
      mkPart("B", [mkStep(false), mkStep(true, { velocity: 77, reverse: true })], { pan: 0.25 }),
    ]);

    const run1 = runPattern(build(), 2, 0.125);
    const run2 = runPattern(build(), 2, 0.125);

    expect(run2).toEqual(run1);
    // Sanity: nicht leer — sonst wäre die Gleichheit trivial.
    expect(run1.length).toBe(3);
  });

  it("zwei Parts auf demselben Step bleiben distinkt (kein gepooltes scheduled-Objekt)", () => {
    // Schützt gegen versehentliches Pooling des ScheduledStep: beide Voices
    // müssen ihre eigenen velocity/pitch/pan/reverse behalten.
    const partA = mkPart("A", [mkStep(true, { velocity: 120, pitch: 5, reverse: true })]);
    const partB = mkPart("B", [mkStep(true, { velocity: 30, pitch: -2 })], { pan: 0.9 });
    const events = runPattern(mkPattern([partA, partB]), 1, 0.125);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ partIndex: 0, velocity: 120, pitch: 5, reverse: true, pan: 0 });
    expect(events[1]).toMatchObject({ partIndex: 1, velocity: 30, pitch: -2, reverse: false, pan: 0.9 });
  });

  it("solo-Logik: nur soloed Parts feuern (loop-basierter .some-Ersatz korrekt)", () => {
    const partA = mkPart("A", [mkStep(true, { velocity: 100 })]);
    const partB = mkPart("B", [mkStep(true, { velocity: 100 })], { soloed: true });
    const partC = mkPart("C", [mkStep(true, { velocity: 100 })]);
    const events = runPattern(mkPattern([partA, partB, partC]), 1, 0.125);

    // Nur Part B (soloed) darf feuern.
    expect(events).toHaveLength(1);
    expect(events[0].partIndex).toBe(1);
  });

  it("muted Part wird übersprungen (continue statt return im for-Loop)", () => {
    const partA = mkPart("A", [mkStep(true, { velocity: 100 })], { muted: true });
    const partB = mkPart("B", [mkStep(true, { velocity: 100 })]);
    const events = runPattern(mkPattern([partA, partB]), 1, 0.125);

    expect(events).toHaveLength(1);
    expect(events[0].partIndex).toBe(1);
  });
});
