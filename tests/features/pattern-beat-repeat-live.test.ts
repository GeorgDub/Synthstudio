/**
 * tests/features/pattern-beat-repeat-live.test.ts (v3.189)
 *
 * Pure-Coverage fuer client/src/utils/patternBeatRepeatLive.ts.
 */
import { describe, it, expect } from "vitest";
import {
  createBeatRepeatState,
  triggerBeatRepeat,
  releaseBeatRepeat,
  nextStep,
  beatRepeatReadIndex,
} from "@/utils/patternBeatRepeatLive";

const T = true;
const F = false;

describe("createBeatRepeatState defaults + clamp", () => {
  it("default bufferSteps = 4", () => {
    const s = createBeatRepeatState();
    expect(s.active).toBe(false);
    expect(s.bufferLength).toBe(4);
    expect(s.buffer).toEqual([F, F, F, F]);
    expect(s.currentRepeats).toBe(0);
    expect(s.capturedAtStep).toBe(0);
  });

  it("clamps bufferSteps to 1..64", () => {
    expect(createBeatRepeatState(0).bufferLength).toBe(1);
    expect(createBeatRepeatState(-5).bufferLength).toBe(1);
    expect(createBeatRepeatState(999).bufferLength).toBe(64);
    expect(createBeatRepeatState(8).bufferLength).toBe(8);
  });

  it("NaN bufferSteps falls back to default", () => {
    expect(createBeatRepeatState(NaN).bufferLength).toBe(4);
    expect(createBeatRepeatState(Infinity).bufferLength).toBe(4);
  });
});

describe("triggerBeatRepeat captures buffer", () => {
  it("captures bufferLength steps starting at currentStep", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, F, F, T, T, F, T, F];
    const s1 = triggerBeatRepeat(s0, pattern, 2);
    expect(s1.active).toBe(true);
    expect(s1.buffer).toEqual([F, T, T, F]);
    expect(s1.bufferLength).toBe(4);
    expect(s1.capturedAtStep).toBe(2);
    expect(s1.currentRepeats).toBe(0);
  });

  it("wrap-around bei trigger im Endbereich", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = new Array(16).fill(F);
    pattern[14] = T;
    pattern[15] = T;
    pattern[0] = T;
    pattern[1] = T;
    const s1 = triggerBeatRepeat(s0, pattern, 14);
    expect(s1.buffer).toEqual([T, T, T, T]);
    expect(s1.capturedAtStep).toBe(14);
  });

  it("empty pattern keeps active false", () => {
    const s0 = createBeatRepeatState(4);
    const s1 = triggerBeatRepeat(s0, [], 5);
    expect(s1.active).toBe(false);
    expect(s1.buffer).toEqual([F, F, F, F]);
    expect(s1.capturedAtStep).toBe(5);
  });

  it("NaN currentStep falls back to 0", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, F, T, F, T, F, T, F];
    const s1 = triggerBeatRepeat(s0, pattern, NaN);
    expect(s1.capturedAtStep).toBe(0);
    expect(s1.buffer).toEqual([T, F, T, F]);
  });
});

describe("nextStep inactive", () => {
  it("liest aus normalPattern bei state.active=false", () => {
    const s0 = createBeatRepeatState(4);
    const normal = [T, F, T, F];
    expect(nextStep(s0, normal, 0).active).toBe(true);
    expect(nextStep(s0, normal, 1).active).toBe(false);
    expect(nextStep(s0, normal, 2).active).toBe(true);
    expect(nextStep(s0, normal, 5).active).toBe(false);
    expect(nextStep(s0, normal, 6).active).toBe(true);
  });

  it("state bleibt unveraendert bei inactive", () => {
    const s0 = createBeatRepeatState(4);
    const normal = [T, F, T, F];
    const r = nextStep(s0, normal, 3);
    expect(r.newState).toBe(s0);
  });

  it("empty normalPattern returns active false, state unveraendert", () => {
    const s0 = createBeatRepeatState(4);
    const r = nextStep(s0, [], 0);
    expect(r.active).toBe(false);
    expect(r.newState).toBe(s0);
  });
});

describe("nextStep active reads from buffer", () => {
  it("liest buffer modulo bufferLength", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, F, T, F, F, F, F, F];
    const normal = new Array(8).fill(F);
    const s1 = triggerBeatRepeat(s0, pattern, 0);

    expect(nextStep(s1, normal, 0).active).toBe(true);
    expect(nextStep(s1, normal, 1).active).toBe(false);
    expect(nextStep(s1, normal, 2).active).toBe(true);
    expect(nextStep(s1, normal, 3).active).toBe(false);
    expect(nextStep(s1, normal, 4).active).toBe(true);
    expect(nextStep(s1, normal, 5).active).toBe(false);
    expect(nextStep(s1, normal, 6).active).toBe(true);
    expect(nextStep(s1, normal, 7).active).toBe(false);
  });

  it("inkrementiert currentRepeats bei Cycle-Boundary", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, F, T, F];
    const normal = [F, F, F, F];
    const s1 = triggerBeatRepeat(s0, pattern, 0);

    const r1 = nextStep(s1, normal, 0);
    expect(r1.newState.currentRepeats).toBe(0);
    const r2 = nextStep(s1, normal, 4);
    expect(r2.newState.currentRepeats).toBe(1);
    const r3 = nextStep(s1, normal, 8);
    expect(r3.newState.currentRepeats).toBe(1);
  });
});

describe("releaseBeatRepeat reset", () => {
  it("setzt active auf false und resetet currentRepeats", () => {
    const s0 = createBeatRepeatState(4);
    const s1 = triggerBeatRepeat(s0, [T, F, T, F, T, F, T, F], 0);
    const s2 = nextStep(s1, [F, F, F, F, F, F, F, F], 4).newState;
    expect(s2.currentRepeats).toBe(1);
    const s3 = releaseBeatRepeat(s2);
    expect(s3.active).toBe(false);
    expect(s3.currentRepeats).toBe(0);
    expect(s3.buffer).toEqual(s2.buffer);
  });

  it("nach release liest nextStep normalPattern wieder", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, T, T, T];
    const normal = [F, F, F, F];
    const s1 = triggerBeatRepeat(s0, pattern, 0);
    expect(nextStep(s1, normal, 0).active).toBe(true);
    const s2 = releaseBeatRepeat(s1);
    expect(nextStep(s2, normal, 0).active).toBe(false);
  });
});

describe("nextStep maxRepeats auto-release", () => {
  it("maxRepeats=2 auto-release nach 2 Cycles", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, T, T, T];
    const normal = [F, F, F, F];
    let st = triggerBeatRepeat(s0, pattern, 0);
    const opts = { maxRepeats: 2 };

    let r = nextStep(st, normal, 0, opts);
    expect(r.active).toBe(true);
    st = r.newState;

    r = nextStep(st, normal, 4, opts);
    expect(r.active).toBe(true);
    expect(r.newState.currentRepeats).toBe(1);
    expect(r.newState.active).toBe(true);
    st = r.newState;

    r = nextStep(st, normal, 8, opts);
    expect(r.active).toBe(true);
    expect(r.newState.currentRepeats).toBe(2);
    expect(r.newState.active).toBe(true);
    st = r.newState;

    r = nextStep(st, normal, 12, opts);
    expect(r.active).toBe(false);
    expect(r.newState.active).toBe(false);
    expect(r.newState.currentRepeats).toBe(0);
  });

  it("default maxRepeats Infinity kein Auto-Release", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, T, T, T];
    const normal = [F, F, F, F];
    let st = triggerBeatRepeat(s0, pattern, 0);
    for (let s = 0; s < 1000; s += 4) {
      const r = nextStep(st, normal, s);
      st = r.newState;
    }
    expect(st.active).toBe(true);
  });
});

describe("capturedAtStep tracking", () => {
  it("trigger setzt capturedAtStep auf currentStep", () => {
    const s0 = createBeatRepeatState(4);
    const pattern = [T, F, T, F, T, F, T, F];
    const s1 = triggerBeatRepeat(s0, pattern, 7);
    expect(s1.capturedAtStep).toBe(7);
  });

  it("delta wird relativ zu capturedAtStep berechnet, nicht zu 0", () => {
    const s0 = createBeatRepeatState(2);
    const pattern = [F, F, F, F, F, F, T, F];
    const normal = new Array(8).fill(F);
    const s1 = triggerBeatRepeat(s0, pattern, 6);
    expect(s1.buffer).toEqual([T, F]);
    expect(nextStep(s1, normal, 6).active).toBe(true);
    expect(nextStep(s1, normal, 7).active).toBe(false);
    expect(nextStep(s1, normal, 8).active).toBe(true);
  });
});

describe("defensive NaN + negative inputs", () => {
  it("NaN step safeStep 0", () => {
    const s0 = createBeatRepeatState(4);
    const normal = [T, F, T, F];
    expect(nextStep(s0, normal, NaN).active).toBe(true);
  });

  it("negative step positive modulo bei inactive read", () => {
    const s0 = createBeatRepeatState(4);
    const normal = [T, F, T, F];
    expect(nextStep(s0, normal, -1).active).toBe(false);
  });

  it("Infinity step safeStep 0", () => {
    const s0 = createBeatRepeatState(4);
    const normal = [T, F, T, F];
    expect(nextStep(s0, normal, Infinity).active).toBe(true);
  });
});

describe("multiple trigger/release cycles", () => {
  it("re-trigger nach release captured neuen Buffer", () => {
    const s0 = createBeatRepeatState(2);
    const patternA = [T, T, F, F];
    const patternB = [F, F, T, T];
    const normal = [F, F, F, F];

    let st = triggerBeatRepeat(s0, patternA, 0);
    expect(st.buffer).toEqual([T, T]);
    expect(nextStep(st, normal, 0).active).toBe(true);

    st = releaseBeatRepeat(st);
    expect(st.active).toBe(false);

    st = triggerBeatRepeat(st, patternB, 2);
    expect(st.active).toBe(true);
    expect(st.buffer).toEqual([T, T]);
    expect(st.capturedAtStep).toBe(2);
    expect(st.currentRepeats).toBe(0);
  });

  it("trigger waehrend bereits active frischer Capture", () => {
    const s0 = createBeatRepeatState(2);
    const pattern = [T, F, F, T, T, F, F, T];
    const normal = new Array(8).fill(F);

    let st = triggerBeatRepeat(s0, pattern, 0);
    expect(st.buffer).toEqual([T, F]);
    st = nextStep(st, normal, 4).newState;
    expect(st.currentRepeats).toBe(1);

    st = triggerBeatRepeat(st, pattern, 3);
    expect(st.buffer).toEqual([T, T]);
    expect(st.capturedAtStep).toBe(3);
    expect(st.currentRepeats).toBe(0);
    expect(st.active).toBe(true);
  });
});

// ─── v3.240: beatRepeatReadIndex (Sequencer-Read-Remap) ───────────────────────

describe("beatRepeatReadIndex – Sequencer-Read-Remap", () => {
  it("inaktiv → Identität für beliebige Steps", () => {
    const st = createBeatRepeatState(4); // active:false
    for (const s of [0, 1, 7, 15, 31]) {
      expect(beatRepeatReadIndex(st, s)).toBe(s);
    }
  });

  it("aktiv, capturedAtStep=0, bufferLength=4 → loopt 0..3", () => {
    const st = { active: true, capturedAtStep: 0, bufferLength: 4 };
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((s) => beatRepeatReadIndex(st, s)))
      .toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
  });

  it("aktiv, capturedAtStep=4, bufferLength=4 → Fenster 4..7 loopt", () => {
    const st = { active: true, capturedAtStep: 4, bufferLength: 4 };
    expect([4, 5, 6, 7, 8, 9].map((s) => beatRepeatReadIndex(st, s)))
      .toEqual([4, 5, 6, 7, 4, 5]);
  });

  it("Step vor dem Capture → Identität (kein Rückwärts-Loop)", () => {
    const st = { active: true, capturedAtStep: 8, bufferLength: 4 };
    expect(beatRepeatReadIndex(st, 3)).toBe(3);
    expect(beatRepeatReadIndex(st, 7)).toBe(7);
    expect(beatRepeatReadIndex(st, 8)).toBe(8);
  });

  it("bufferLength=1 → friert auf einen Step ein", () => {
    const st = { active: true, capturedAtStep: 5, bufferLength: 1 };
    expect([5, 6, 7, 8].map((s) => beatRepeatReadIndex(st, s))).toEqual([5, 5, 5, 5]);
  });

  it("ungültige bufferLength (0/NaN/Infinity) → Default 4", () => {
    for (const bad of [0, NaN, Infinity]) {
      const st = { active: true, capturedAtStep: 0, bufferLength: bad as number };
      expect(beatRepeatReadIndex(st, 4)).toBe(0); // wie bufferLength 4
      expect(beatRepeatReadIndex(st, 5)).toBe(1);
    }
  });

  it("NaN stepIndex → 0", () => {
    const st = { active: true, capturedAtStep: 0, bufferLength: 4 };
    expect(beatRepeatReadIndex(st, NaN)).toBe(0);
  });

  it("Komposition mit Pattern-Wrap (%length): Fenster am Pattern-Ende wandert in den Loop", () => {
    // captured=14, L=4 in einem 16-Step-Pattern → Read-Order 14,15,0,1 (gewollt).
    const st = { active: true, capturedAtStep: 14, bufferLength: 4 };
    const wrapped = [14, 15, 16, 17, 18, 19, 20, 21].map((s) => beatRepeatReadIndex(st, s) % 16);
    expect(wrapped).toEqual([14, 15, 0, 1, 14, 15, 0, 1]);
  });

  it("releaseBeatRepeat → readIndex wieder Identität", () => {
    let st = triggerBeatRepeat(createBeatRepeatState(4), [T, F, T, F, T, F, T, F], 0);
    expect(beatRepeatReadIndex(st, 5)).toBe(1); // aktiv
    st = releaseBeatRepeat(st);
    expect(beatRepeatReadIndex(st, 5)).toBe(5); // identisch
  });
});
