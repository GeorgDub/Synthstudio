/**
 * tests/features/pattern-diff.test.ts (v3.91.0)
 *
 * Pure-Coverage für client/src/utils/patternDiff.ts.
 *
 * diffPatterns ist eine reine Funktion — keine Mutation, kein Math.random.
 * Wir bauen kleine PatternData-Fixtures und prüfen die einzelnen Diff-Buckets.
 */
import { describe, it, expect } from "vitest";
import {
  diffPatterns,
  summarizeDiff,
  classifyPartSteps,
} from "@/utils/patternDiff";
import type {
  PatternData,
  PartData,
  StepData,
  ChannelFx,
} from "@/audio/AudioEngine";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const FX_STUB: ChannelFx = {
  filterEnabled:      false,
  filterType:         "lowpass",
  filterFreq:         20000,
  filterQ:            1,
  filterGain:         0,
  distortionEnabled:  false,
  distortionAmount:   0,
} as unknown as ChannelFx;

function step(active: boolean, velocity?: number): StepData {
  return velocity === undefined
    ? { active }
    : { active, velocity };
}

function part(id: string, name: string, steps: StepData[]): PartData {
  return {
    id,
    name,
    muted:   false,
    soloed:  false,
    volume:  1,
    pan:     0,
    steps,
    fx:      FX_STUB,
  };
}

function makeSteps(activePositions: number[], stepCount = 16, velocity = 100): StepData[] {
  const arr: StepData[] = [];
  for (let i = 0; i < stepCount; i++) {
    arr.push(activePositions.includes(i)
      ? { active: true, velocity }
      : { active: false });
  }
  return arr;
}

function pattern(
  id: string,
  bpm: number | null,
  stepCount: 16 | 32 | 64,
  parts: PartData[],
): PatternData {
  return {
    id,
    name:           id,
    stepCount,
    stepResolution: "1/16",
    bpm,
    parts,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("patternDiff – diffPatterns", () => {
  it("identische Patterns liefern empty diff (keine added/removed/changedVelocity)", () => {
    const steps = makeSteps([0, 4, 8, 12]);
    const a = pattern("a", 120, 16, [part("kick", "Kick", steps)]);
    const b = pattern("b", 120, 16, [part("kick", "Kick", steps.map(s => ({ ...s })))]);

    const d = diffPatterns(a, b);
    expect(d.bpmDelta).toBe(0);
    expect(d.stepCountDelta).toBe(0);
    expect(d.partDiffs).toHaveLength(1);
    const sum = summarizeDiff(d);
    expect(sum).toEqual({ added: 0, removed: 0, changedVelocity: 0 });
  });

  it("Added-Step: in B aktiv, in A inaktiv", () => {
    const a = pattern("a", 120, 16, [part("kick", "Kick", makeSteps([0, 4]))]);
    const b = pattern("b", 120, 16, [part("kick", "Kick", makeSteps([0, 4, 8]))]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs).toHaveLength(1);
    expect(d.partDiffs[0].addedSteps).toEqual([
      { stepIndex: 8, kind: "added", velocityB: 100 },
    ]);
    expect(d.partDiffs[0].removedSteps).toHaveLength(0);
    expect(d.partDiffs[0].changedVelocity).toHaveLength(0);
  });

  it("Removed-Step: in A aktiv, in B inaktiv", () => {
    const a = pattern("a", 120, 16, [part("kick", "Kick", makeSteps([0, 4, 8, 12]))]);
    const b = pattern("b", 120, 16, [part("kick", "Kick", makeSteps([0, 4, 12]))]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs[0].removedSteps).toEqual([
      { stepIndex: 8, kind: "removed", velocityA: 100 },
    ]);
    expect(d.partDiffs[0].addedSteps).toHaveLength(0);
  });

  it("ChangedVelocity: in beiden aktiv, aber Velocity unterscheidet sich", () => {
    const stepsA = makeSteps([0, 4], 16, 100);
    const stepsB: StepData[] = stepsA.map((s, i) =>
      i === 4 ? { active: true, velocity: 80 } : { ...s });

    const a = pattern("a", 120, 16, [part("kick", "Kick", stepsA)]);
    const b = pattern("b", 120, 16, [part("kick", "Kick", stepsB)]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs[0].changedVelocity).toEqual([
      { stepIndex: 4, kind: "changedVelocity", velocityA: 100, velocityB: 80 },
    ]);
    expect(d.partDiffs[0].addedSteps).toHaveLength(0);
    expect(d.partDiffs[0].removedSteps).toHaveLength(0);
  });

  it("Undefined Velocity wird wie Default 100 behandelt — kein false-positive", () => {
    // Beide Steps aktiv: A ohne velocity-Feld, B mit velocity=100 → gleich.
    const stepsA: StepData[] = [{ active: true }, ...makeSteps([], 15)];
    const stepsB: StepData[] = [{ active: true, velocity: 100 }, ...makeSteps([], 15)];

    const a = pattern("a", 120, 16, [part("kick", "Kick", stepsA)]);
    const b = pattern("b", 120, 16, [part("kick", "Kick", stepsB)]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs[0].changedVelocity).toHaveLength(0);
  });

  it("BPM-Delta + StepCount-Delta werden korrekt zurückgegeben", () => {
    const a = pattern("a", 120, 16, [part("kick", "Kick", makeSteps([0]))]);
    const b = pattern("b", 124, 32, [part("kick", "Kick", makeSteps([0], 32))]);

    const d = diffPatterns(a, b);
    expect(d.bpmA).toBe(120);
    expect(d.bpmB).toBe(124);
    expect(d.bpmDelta).toBe(4);
    expect(d.stepCountA).toBe(16);
    expect(d.stepCountB).toBe(32);
    expect(d.stepCountDelta).toBe(16);
  });

  it("BPM-null in einer Seite → bpmDelta=null (UI muss separat formatieren)", () => {
    const a = pattern("a", null, 16, [part("kick", "Kick", makeSteps([0]))]);
    const b = pattern("b", 124,  16, [part("kick", "Kick", makeSteps([0]))]);

    const d = diffPatterns(a, b);
    expect(d.bpmDelta).toBeNull();
    expect(d.bpmA).toBeNull();
    expect(d.bpmB).toBe(124);
  });

  it("StepCount-Mismatch: B länger → extra-Steps in B werden als 'added' gemeldet", () => {
    // A = 16 Steps mit aktiv@0. B = 32 Steps mit aktiv@0,@16,@24.
    const a = pattern("a", 120, 16, [part("kick", "Kick", makeSteps([0]))]);
    const b = pattern("b", 120, 32, [part("kick", "Kick", makeSteps([0, 16, 24], 32))]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs[0].addedSteps.map(s => s.stepIndex)).toEqual([16, 24]);
    expect(d.partDiffs[0].removedSteps).toHaveLength(0);
  });

  it("StepCount-Mismatch: A länger → extra-Steps in A werden als 'removed' gemeldet", () => {
    const a = pattern("a", 120, 32, [part("kick", "Kick", makeSteps([0, 16, 24], 32))]);
    const b = pattern("b", 120, 16, [part("kick", "Kick", makeSteps([0]))]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs[0].removedSteps.map(s => s.stepIndex)).toEqual([16, 24]);
    expect(d.partDiffs[0].addedSteps).toHaveLength(0);
  });

  it("Empty Part vs Filled Part: alle aktiven Steps von B → 'added'", () => {
    const empty  = part("snare", "Snare", makeSteps([]));
    const filled = part("snare", "Snare", makeSteps([4, 12]));

    const a = pattern("a", 120, 16, [empty]);
    const b = pattern("b", 120, 16, [filled]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs[0].addedSteps.map(s => s.stepIndex)).toEqual([4, 12]);
    expect(d.partDiffs[0].removedSteps).toHaveLength(0);
  });

  it("Multi-Part Pattern: jeder Part wird einzeln gemeldet", () => {
    const a = pattern("a", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4, 8, 12])),
      part("snare", "Snare", makeSteps([4, 12])),
      part("hh",    "HiHat", makeSteps([0, 2, 4, 6, 8, 10, 12, 14])),
    ]);
    const b = pattern("b", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4, 8, 12])),                // unchanged
      part("snare", "Snare", makeSteps([4, 12], 16, 80)),              // velocity change
      part("hh",    "HiHat", makeSteps([0, 2, 4, 6, 8, 10, 12, 14, 15])), // added
    ]);

    const d = diffPatterns(a, b);
    expect(d.partDiffs).toHaveLength(3);

    const kick  = d.partDiffs.find(p => p.partId === "kick")!;
    const snare = d.partDiffs.find(p => p.partId === "snare")!;
    const hh    = d.partDiffs.find(p => p.partId === "hh")!;

    expect(kick.addedSteps).toHaveLength(0);
    expect(kick.removedSteps).toHaveLength(0);
    expect(kick.changedVelocity).toHaveLength(0);

    expect(snare.changedVelocity).toHaveLength(2);
    expect(snare.changedVelocity.map(s => s.stepIndex)).toEqual([4, 12]);

    expect(hh.addedSteps).toEqual([{ stepIndex: 15, kind: "added", velocityB: 100 }]);
  });

  it("Part nur in A → presence='removed', alle aktiven Steps werden 'removed' gelistet", () => {
    const a = pattern("a", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4])),
      part("perc",  "Perc",  makeSteps([2, 6])),
    ]);
    const b = pattern("b", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4])),
    ]);

    const d = diffPatterns(a, b);
    const perc = d.partDiffs.find(p => p.partId === "perc")!;
    expect(perc.presence).toBe("removed");
    expect(perc.removedSteps.map(s => s.stepIndex)).toEqual([2, 6]);
    expect(perc.addedSteps).toHaveLength(0);
  });

  it("Part nur in B → presence='added', alle aktiven Steps werden 'added' gelistet", () => {
    const a = pattern("a", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4])),
    ]);
    const b = pattern("b", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4])),
      part("perc",  "Perc",  makeSteps([2, 6])),
    ]);

    const d = diffPatterns(a, b);
    const perc = d.partDiffs.find(p => p.partId === "perc")!;
    expect(perc.presence).toBe("added");
    expect(perc.addedSteps.map(s => s.stepIndex)).toEqual([2, 6]);
    expect(perc.removedSteps).toHaveLength(0);
  });

  it("diffPatterns ist eine reine Funktion — Inputs werden NICHT mutiert", () => {
    const stepsA = makeSteps([0, 4]);
    const stepsB = makeSteps([0, 8]);
    const a = pattern("a", 120, 16, [part("kick", "Kick", stepsA)]);
    const b = pattern("b", 124, 16, [part("kick", "Kick", stepsB)]);

    const snapshotA = JSON.stringify(a);
    const snapshotB = JSON.stringify(b);

    diffPatterns(a, b);

    expect(JSON.stringify(a)).toBe(snapshotA);
    expect(JSON.stringify(b)).toBe(snapshotB);
  });
});

describe("patternDiff – summarizeDiff", () => {
  it("summiert added/removed/changedVelocity über alle Parts", () => {
    const a = pattern("a", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4])),
      part("snare", "Snare", makeSteps([8])),
    ]);
    const b = pattern("b", 120, 16, [
      part("kick",  "Kick",  makeSteps([0, 4, 12])),       // +1 added
      part("snare", "Snare", makeSteps([8], 16, 70)),      // +1 changedVel
    ]);
    const d = diffPatterns(a, b);
    expect(summarizeDiff(d)).toEqual({ added: 1, removed: 0, changedVelocity: 1 });
  });
});

describe("patternDiff – classifyPartSteps", () => {
  it("liefert ein Array mit den richtigen StepDiffKinds an den richtigen Indices", () => {
    const a = pattern("a", 120, 16, [part("kick", "Kick", makeSteps([0, 4, 8]))]);
    const b = pattern("b", 120, 16, [
      part("kick", "Kick", [
        ...makeSteps([0]),
      ].concat(makeSteps([], 15))) // only step 0 active
    ]);
    // Manuell: step 0 unchanged, step 4 + 8 removed.
    const d = diffPatterns(a, b);
    const arr = classifyPartSteps(d.partDiffs[0], 16);
    expect(arr[0]).toBeUndefined();
    expect(arr[4]).toBe("removed");
    expect(arr[8]).toBe("removed");
    expect(arr[2]).toBeUndefined();
    expect(arr).toHaveLength(16);
  });

  it("ignoriert Step-Indices außerhalb der stepCount-Grenze", () => {
    const a = pattern("a", 120, 32, [part("kick", "Kick", makeSteps([20], 32))]);
    const b = pattern("b", 120, 32, [part("kick", "Kick", makeSteps([], 32))]);
    const d = diffPatterns(a, b);
    const arr = classifyPartSteps(d.partDiffs[0], 16); // nur 16 anfragen
    expect(arr).toHaveLength(16);
    expect(arr.every(x => x === undefined)).toBe(true);
  });
});
