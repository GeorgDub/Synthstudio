/**
 * tests/features/pattern-follow-action-chain.test.ts (v3.187.0)
 *
 * Unit-Tests fuer patternFollowActionChain.ts - Pattern-Follow-Action-Resolver.
 * Verifiziert Stay-Logik, alle 7 Action-Typen, Wrap-Verhalten, Determinismus
 * via Seed, defensive Behavior + FOLLOW_ACTION_LABELS.
 */
import { describe, it, expect } from "vitest";
import {
  resolveFollowAction,
  FOLLOW_ACTION_LABELS,
  type FollowActionDef,
  type FollowState,
  type FollowActionType,
} from "../../client/src/utils/patternFollowActionChain";

const PATTERNS = [
  { id: "p1" },
  { id: "p2" },
  { id: "p3" },
  { id: "p4" },
] as const;

const FRESH_STATE: FollowState = {
  currentPatternId: "p1",
  currentRepeats: 0,
  chainPosition: 0,
};

// --- 1. Empty Patterns ----------------------------------------------------
describe("resolveFollowAction - empty patterns", () => {
  it("empty patterns -> stay on currentId + repeats++", () => {
    const action: FollowActionDef = { type: "next" };
    const result = resolveFollowAction([], action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p1");
    expect(result.nextState.currentPatternId).toBe("p1");
    expect(result.nextState.currentRepeats).toBe(1);
    expect(result.nextState.chainPosition).toBe(0);
  });

  it("empty patterns ignoriert action.type komplett", () => {
    const action: FollowActionDef = { type: "random" };
    const result = resolveFollowAction([], action, FRESH_STATE, 42);
    expect(result.nextPatternId).toBe("p1");
  });
});

// --- 2. Stay-Logik (repeatCount) ------------------------------------------
describe("resolveFollowAction - stay logic with repeatCount", () => {
  it("repeatCount default (1) -> action greift sofort beim ersten Call", () => {
    const action: FollowActionDef = { type: "next" };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p2");
    expect(result.nextState.currentRepeats).toBe(0);
  });

  it("repeatCount=3 -> 2x stay, dann action", () => {
    const action: FollowActionDef = { type: "next", repeatCount: 3 };
    const r1 = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(r1.nextPatternId).toBe("p1");
    expect(r1.nextState.currentRepeats).toBe(1);
    const r2 = resolveFollowAction(PATTERNS, action, r1.nextState);
    expect(r2.nextPatternId).toBe("p1");
    expect(r2.nextState.currentRepeats).toBe(2);
    const r3 = resolveFollowAction(PATTERNS, action, r2.nextState);
    expect(r3.nextPatternId).toBe("p2");
    expect(r3.nextState.currentRepeats).toBe(0);
  });

  it("repeatCount=NaN -> behandelt wie 1", () => {
    const action: FollowActionDef = { type: "next", repeatCount: NaN };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p2");
  });

  it("repeatCount=0 oder -5 -> behandelt wie 1 (sanitize)", () => {
    const a0: FollowActionDef = { type: "next", repeatCount: 0 };
    const r0 = resolveFollowAction(PATTERNS, a0, FRESH_STATE);
    expect(r0.nextPatternId).toBe("p2");
    const aNeg: FollowActionDef = { type: "next", repeatCount: -5 };
    const rNeg = resolveFollowAction(PATTERNS, aNeg, FRESH_STATE);
    expect(rNeg.nextPatternId).toBe("p2");
  });
});

// --- 3. none Action -------------------------------------------------------
describe("resolveFollowAction - none", () => {
  it("none -> bleibt auf currentPatternId (Loop)", () => {
    const action: FollowActionDef = { type: "none" };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p1");
    expect(result.nextState.currentRepeats).toBe(0);
  });
});

// --- 4. next / prev Wrap --------------------------------------------------
describe("resolveFollowAction - next / prev wrap", () => {
  it("next wrap: letztes pattern -> erstes", () => {
    const action: FollowActionDef = { type: "next" };
    const state: FollowState = { currentPatternId: "p4", currentRepeats: 0, chainPosition: 0 };
    const result = resolveFollowAction(PATTERNS, action, state);
    expect(result.nextPatternId).toBe("p1");
  });

  it("prev wrap: erstes pattern -> letztes", () => {
    const action: FollowActionDef = { type: "prev" };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p4");
  });

  it("prev mitten in der liste", () => {
    const action: FollowActionDef = { type: "prev" };
    const state: FollowState = { currentPatternId: "p3", currentRepeats: 0, chainPosition: 0 };
    const result = resolveFollowAction(PATTERNS, action, state);
    expect(result.nextPatternId).toBe("p2");
  });

  it("next mit currentId NICHT in patterns -> patterns[0]", () => {
    const action: FollowActionDef = { type: "next" };
    const state: FollowState = { currentPatternId: "missing", currentRepeats: 0, chainPosition: 0 };
    const result = resolveFollowAction(PATTERNS, action, state);
    expect(result.nextPatternId).toBe("p1");
  });
});

// --- 5. random ------------------------------------------------------------
describe("resolveFollowAction - random", () => {
  it("random deterministisch via seed", () => {
    const action: FollowActionDef = { type: "random" };
    const r1 = resolveFollowAction(PATTERNS, action, FRESH_STATE, 42);
    const r2 = resolveFollowAction(PATTERNS, action, FRESH_STATE, 42);
    expect(r1.nextPatternId).toBe(r2.nextPatternId);
  });

  it("random mit unterschiedlichen seeds liefert unterschiedliche IDs", () => {
    const action: FollowActionDef = { type: "random" };
    const results = new Set<string>();
    for (let s = 1; s <= 20; s++) {
      const r = resolveFollowAction(PATTERNS, action, FRESH_STATE, s);
      results.add(r.nextPatternId);
    }
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it("random Ergebnis ist immer eine gueltige Pattern-ID", () => {
    const action: FollowActionDef = { type: "random" };
    const ids = new Set(PATTERNS.map((p) => p.id));
    for (let s = 1; s <= 50; s++) {
      const r = resolveFollowAction(PATTERNS, action, FRESH_STATE, s);
      expect(ids.has(r.nextPatternId)).toBe(true);
    }
  });
});

// --- 6. specific ----------------------------------------------------------
describe("resolveFollowAction - specific", () => {
  it("specific mit gueltiger targetId -> liefert target", () => {
    const action: FollowActionDef = { type: "specific", targetId: "p3" };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p3");
  });

  it("specific mit ungueltiger targetId -> currentPatternId", () => {
    const action: FollowActionDef = { type: "specific", targetId: "doesnotexist" };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p1");
  });

  it("specific ohne targetId -> currentPatternId", () => {
    const action: FollowActionDef = { type: "specific" };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p1");
  });
});

// --- 7. chain -------------------------------------------------------------
describe("resolveFollowAction - chain", () => {
  it("chain advance: position 0 -> p2, position 1 -> p3", () => {
    const action: FollowActionDef = { type: "chain", chainIds: ["p2", "p3", "p4"] };
    const r1 = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(r1.nextPatternId).toBe("p2");
    expect(r1.nextState.chainPosition).toBe(1);
    const r2 = resolveFollowAction(PATTERNS, action, r1.nextState);
    expect(r2.nextPatternId).toBe("p3");
    expect(r2.nextState.chainPosition).toBe(2);
    const r3 = resolveFollowAction(PATTERNS, action, r2.nextState);
    expect(r3.nextPatternId).toBe("p4");
    expect(r3.nextState.chainPosition).toBe(3);
  });

  it("chain wrap: position >= chainIds.length -> modulo back to start", () => {
    const action: FollowActionDef = { type: "chain", chainIds: ["p2", "p3"] };
    const state: FollowState = { currentPatternId: "p1", currentRepeats: 0, chainPosition: 2 };
    const r = resolveFollowAction(PATTERNS, action, state);
    expect(r.nextPatternId).toBe("p2");
    expect(r.nextState.chainPosition).toBe(1);
  });

  it("chain mit leerem chainIds -> currentPatternId", () => {
    const action: FollowActionDef = { type: "chain", chainIds: [] };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p1");
  });

  it("chain ohne chainIds -> currentPatternId", () => {
    const action: FollowActionDef = { type: "chain" };
    const result = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(result.nextPatternId).toBe("p1");
  });

  it("chain mit candidate-ID nicht in patterns -> currentPatternId, position advance", () => {
    const action: FollowActionDef = { type: "chain", chainIds: ["ghost", "p2"] };
    const r = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(r.nextPatternId).toBe("p1");
    expect(r.nextState.chainPosition).toBe(1);
  });
});

// --- 8. weighted ----------------------------------------------------------
describe("resolveFollowAction - weighted", () => {
  it("weighted deterministisch via seed", () => {
    const action: FollowActionDef = {
      type: "weighted",
      weights: [
        { id: "p1", weight: 1 },
        { id: "p2", weight: 1 },
        { id: "p3", weight: 1 },
      ],
    };
    const r1 = resolveFollowAction(PATTERNS, action, FRESH_STATE, 7);
    const r2 = resolveFollowAction(PATTERNS, action, FRESH_STATE, 7);
    expect(r1.nextPatternId).toBe(r2.nextPatternId);
  });

  it("weighted mit nur einem positiven gewicht -> genau diese ID", () => {
    const action: FollowActionDef = {
      type: "weighted",
      weights: [
        { id: "p1", weight: 0 },
        { id: "p2", weight: 0 },
        { id: "p3", weight: 10 },
        { id: "p4", weight: 0 },
      ],
    };
    for (let s = 1; s <= 10; s++) {
      const r = resolveFollowAction(PATTERNS, action, FRESH_STATE, s);
      expect(r.nextPatternId).toBe("p3");
    }
  });

  it("weighted leere weights -> currentPatternId", () => {
    const action: FollowActionDef = { type: "weighted", weights: [] };
    const r = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(r.nextPatternId).toBe("p1");
  });

  it("weighted alle weights <=0 -> currentPatternId", () => {
    const action: FollowActionDef = {
      type: "weighted",
      weights: [
        { id: "p2", weight: 0 },
        { id: "p3", weight: -5 },
        { id: "p4", weight: NaN },
      ],
    };
    const r = resolveFollowAction(PATTERNS, action, FRESH_STATE, 1);
    expect(r.nextPatternId).toBe("p1");
  });

  it("weighted mit gewaehlter ID nicht in patterns -> currentPatternId", () => {
    const action: FollowActionDef = {
      type: "weighted",
      weights: [{ id: "ghost", weight: 10 }],
    };
    const r = resolveFollowAction(PATTERNS, action, FRESH_STATE, 1);
    expect(r.nextPatternId).toBe("p1");
  });
});

// --- 9. FOLLOW_ACTION_LABELS ----------------------------------------------
describe("FOLLOW_ACTION_LABELS", () => {
  it("hat alle 7 keys", () => {
    const required: FollowActionType[] = [
      "none", "next", "prev", "random", "specific", "chain", "weighted",
    ];
    for (const k of required) {
      expect(FOLLOW_ACTION_LABELS[k]).toBeTruthy();
      expect(typeof FOLLOW_ACTION_LABELS[k]).toBe("string");
    }
  });

  it("labels sind nicht-leere strings", () => {
    for (const label of Object.values(FOLLOW_ACTION_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

// --- 10. State-Update-Semantik --------------------------------------------
describe("resolveFollowAction - state-update semantics", () => {
  it("action greift -> currentRepeats wird auf 0 zurueckgesetzt", () => {
    const action: FollowActionDef = { type: "next" };
    const state: FollowState = { currentPatternId: "p1", currentRepeats: 5, chainPosition: 2 };
    const r = resolveFollowAction(PATTERNS, action, state);
    expect(r.nextState.currentRepeats).toBe(0);
  });

  it("stay -> chainPosition bleibt unveraendert", () => {
    const action: FollowActionDef = { type: "next", repeatCount: 5 };
    const state: FollowState = { currentPatternId: "p1", currentRepeats: 0, chainPosition: 3 };
    const r = resolveFollowAction(PATTERNS, action, state);
    expect(r.nextState.chainPosition).toBe(3);
  });

  it("non-chain action laesst chainPosition unveraendert", () => {
    const action: FollowActionDef = { type: "next" };
    const state: FollowState = { currentPatternId: "p1", currentRepeats: 0, chainPosition: 7 };
    const r = resolveFollowAction(PATTERNS, action, state);
    expect(r.nextState.chainPosition).toBe(7);
  });

  it("Eingaben werden nicht mutiert", () => {
    const patternsRef = [...PATTERNS];
    const chainIds = ["p2", "p3"];
    const weights = [{ id: "p2", weight: 5 }, { id: "p3", weight: 3 }];
    const before = JSON.stringify({ patternsRef, chainIds, weights });
    resolveFollowAction(patternsRef, { type: "chain", chainIds }, FRESH_STATE);
    resolveFollowAction(patternsRef, { type: "weighted", weights }, FRESH_STATE, 9);
    resolveFollowAction(patternsRef, { type: "next" }, FRESH_STATE);
    const after = JSON.stringify({ patternsRef, chainIds, weights });
    expect(after).toBe(before);
  });

  it("nextState.currentPatternId == returned nextPatternId", () => {
    const action: FollowActionDef = { type: "next" };
    const r = resolveFollowAction(PATTERNS, action, FRESH_STATE);
    expect(r.nextState.currentPatternId).toBe(r.nextPatternId);
  });
});
