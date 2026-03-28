/**
 * performance-mode.test.ts
 *
 * Tests für PerformanceStore und Quantized Pattern Switch (Phase 4)
 */
import { describe, it, expect } from "vitest";

// ─── PerformanceStore-Logik isoliert ─────────────────────────────────────────
// Reine State-Logik aus usePerformanceStore.ts, ohne React-Hooks

interface PerformancePad { patternId: string; color?: string; label?: string; }
interface PerformanceState {
  active: boolean;
  pads: PerformancePad[];
  queuedPatternId: string | null;
  quantizeMode: "bar" | "beat" | "step";
}

function initialState(): PerformanceState {
  return { active: false, pads: [], queuedPatternId: null, quantizeMode: "bar" };
}

function setActive(state: PerformanceState, active: boolean): PerformanceState {
  return { ...state, active };
}

function queuePattern(state: PerformanceState, patternId: string): PerformanceState {
  return {
    ...state,
    queuedPatternId: state.queuedPatternId === patternId ? null : patternId,
  };
}

function clearQueue(state: PerformanceState): PerformanceState {
  return { ...state, queuedPatternId: null };
}

// ─── Quantized Pattern Switch Logik ──────────────────────────────────────────

type QuantizeMode = "bar" | "beat" | "step";

function shouldSwitchPattern(
  stepIndex: number,
  totalSteps: number,
  quantizeMode: QuantizeMode,
  beatsPerBar = 4
): boolean {
  if (quantizeMode === "step") return true;
  if (quantizeMode === "bar") return stepIndex === totalSteps - 1;
  if (quantizeMode === "beat") {
    const stepsPerBeat = Math.round(totalSteps / beatsPerBar);
    return stepIndex % stepsPerBeat === stepsPerBeat - 1;
  }
  return false;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PerformanceStore", () => {
  it("initial state: active=false, pads=[], queuedPatternId=null", () => {
    const state = initialState();
    expect(state.active).toBe(false);
    expect(state.pads).toEqual([]);
    expect(state.queuedPatternId).toBeNull();
    expect(state.quantizeMode).toBe("bar");
  });

  it("setActive(true) aktiviert Performance-Mode", () => {
    const state = setActive(initialState(), true);
    expect(state.active).toBe(true);
  });

  it("queuePattern() setzt queuedPatternId", () => {
    const state = queuePattern(initialState(), "pattern-1");
    expect(state.queuedPatternId).toBe("pattern-1");
  });

  it("clearQueue() setzt queuedPatternId auf null", () => {
    const state = clearQueue(queuePattern(initialState(), "pattern-1"));
    expect(state.queuedPatternId).toBeNull();
  });
});

describe("Quantized Pattern Switch", () => {
  it("quantizeMode=bar: Wechsel erfolgt beim letzten Step des Bars (Step 15 bei 16 Steps)", () => {
    expect(shouldSwitchPattern(15, 16, "bar")).toBe(true);
    expect(shouldSwitchPattern(0, 16, "bar")).toBe(false);
    expect(shouldSwitchPattern(7, 16, "bar")).toBe(false);
  });

  it("quantizeMode=beat: Wechsel erfolgt am letzten Step jedes Beats", () => {
    // 16 Steps, 4 Beats → jeweils Step 3, 7, 11, 15
    expect(shouldSwitchPattern(3, 16, "beat")).toBe(true);
    expect(shouldSwitchPattern(7, 16, "beat")).toBe(true);
    expect(shouldSwitchPattern(11, 16, "beat")).toBe(true);
    expect(shouldSwitchPattern(0, 16, "beat")).toBe(false);
    expect(shouldSwitchPattern(2, 16, "beat")).toBe(false);
  });

  it("quantizeMode=step: sofortiger Wechsel (immer true)", () => {
    for (let i = 0; i < 16; i++) {
      expect(shouldSwitchPattern(i, 16, "step")).toBe(true);
    }
  });

  it("zweimaliges Queuen desselben Pattern löscht die Queue (Toggle-Verhalten)", () => {
    let state = initialState();
    state = queuePattern(state, "pattern-1");
    expect(state.queuedPatternId).toBe("pattern-1");
    state = queuePattern(state, "pattern-1"); // nochmals selbes Pattern
    expect(state.queuedPatternId).toBeNull();
  });
});
