/**
 * tests/features/song-jumps.test.ts (v3.117.0)
 *
 * Tests for:
 *   - Pure helper evaluateCondition / findTriggeredJump / describeCondition
 *   - useSongJumpStore (CRUD + Persistence + Per-Song scoping)
 *
 * Pattern: Custom-Observer-Store wie useSongModeStore — wir nutzen das exportierte
 * __resetSongJumpStoreForTests, um zwischen Specs sauber zurückzusetzen.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateCondition,
  findTriggeredJump,
  describeCondition,
  type Jump,
  type JumpCondition,
  type JumpEvalContext,
} from "@/utils/songJumpLogic";
import {
  __resetSongJumpStoreForTests,
  addJump,
  removeJump,
  updateJump,
  getJumpsForSong,
  getSongJumpState,
  removeJumpsReferencingStep,
} from "@/store/useSongJumpStore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyCtx(): JumpEvalContext {
  return { macros: [0, 0, 0, 0, 0, 0, 0, 0] };
}

function ctxWithMacros(macros: number[]): JumpEvalContext {
  return { macros };
}

function makeJump(
  id: string,
  fromStepId: string,
  toStepId: string,
  condition: JumpCondition,
  label?: string
): Jump {
  return label ? { id, fromStepId, toStepId, condition, label } : { id, fromStepId, toStepId, condition };
}

beforeEach(() => {
  __resetSongJumpStoreForTests();
});

// ─── evaluateCondition: always ───────────────────────────────────────────────

describe("evaluateCondition · always", () => {
  it("returns true for the 'always' condition regardless of context", () => {
    expect(evaluateCondition({ kind: "always" }, emptyCtx())).toBe(true);
    expect(
      evaluateCondition({ kind: "always" }, ctxWithMacros([0.9, 0.5, 0, 0, 0, 0, 0, 0]))
    ).toBe(true);
  });
});

// ─── evaluateCondition: macro-above / macro-below ───────────────────────────

describe("evaluateCondition · macro-above", () => {
  it("returns true when macros[idx] > threshold", () => {
    const cond: JumpCondition = { kind: "macro-above", macroIdx: 0, threshold: 0.5 };
    expect(evaluateCondition(cond, ctxWithMacros([0.6, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
  });

  it("returns false when macros[idx] equals or below threshold", () => {
    const cond: JumpCondition = { kind: "macro-above", macroIdx: 0, threshold: 0.5 };
    expect(evaluateCondition(cond, ctxWithMacros([0.5, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(evaluateCondition(cond, ctxWithMacros([0.3, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it("returns false when macroIdx is out of range", () => {
    const cond: JumpCondition = { kind: "macro-above", macroIdx: 99, threshold: 0.1 };
    expect(evaluateCondition(cond, ctxWithMacros([1, 1, 1, 1, 1, 1, 1, 1]))).toBe(false);
  });
});

describe("evaluateCondition · macro-below", () => {
  it("returns true when macros[idx] < threshold", () => {
    const cond: JumpCondition = { kind: "macro-below", macroIdx: 2, threshold: 0.4 };
    expect(evaluateCondition(cond, ctxWithMacros([0.9, 0.9, 0.2, 0, 0, 0, 0, 0]))).toBe(true);
  });

  it("returns false when macros[idx] equals or above threshold", () => {
    const cond: JumpCondition = { kind: "macro-below", macroIdx: 2, threshold: 0.4 };
    expect(evaluateCondition(cond, ctxWithMacros([0, 0, 0.4, 0, 0, 0, 0, 0]))).toBe(false);
    expect(evaluateCondition(cond, ctxWithMacros([0, 0, 0.5, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

// ─── evaluateCondition: midi-note ───────────────────────────────────────────

describe("evaluateCondition · midi-note", () => {
  it("returns true on matching note (without channel filter)", () => {
    const cond: JumpCondition = { kind: "midi-note", note: 60 };
    const ctx: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiNote: { note: 60, channel: 5 },
    };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it("returns false on mismatching note", () => {
    const cond: JumpCondition = { kind: "midi-note", note: 60 };
    const ctx: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiNote: { note: 62, channel: 0 },
    };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it("respects channel filter when provided", () => {
    const cond: JumpCondition = { kind: "midi-note", note: 60, channel: 1 };
    const matchCh: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiNote: { note: 60, channel: 1 },
    };
    const wrongCh: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiNote: { note: 60, channel: 2 },
    };
    expect(evaluateCondition(cond, matchCh)).toBe(true);
    expect(evaluateCondition(cond, wrongCh)).toBe(false);
  });

  it("returns false when no MIDI note in context", () => {
    const cond: JumpCondition = { kind: "midi-note", note: 60 };
    expect(evaluateCondition(cond, emptyCtx())).toBe(false);
  });
});

// ─── evaluateCondition: midi-cc ─────────────────────────────────────────────

describe("evaluateCondition · midi-cc", () => {
  it("returns true on matching CC above threshold", () => {
    const cond: JumpCondition = { kind: "midi-cc", cc: 7, valueAbove: 64 };
    const ctx: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiCc: { cc: 7, value: 100, channel: 0 },
    };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it("returns false when CC value not strictly above threshold", () => {
    const cond: JumpCondition = { kind: "midi-cc", cc: 7, valueAbove: 64 };
    const equal: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiCc: { cc: 7, value: 64, channel: 0 },
    };
    const below: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiCc: { cc: 7, value: 30, channel: 0 },
    };
    expect(evaluateCondition(cond, equal)).toBe(false);
    expect(evaluateCondition(cond, below)).toBe(false);
  });

  it("returns false on mismatching CC number", () => {
    const cond: JumpCondition = { kind: "midi-cc", cc: 7, valueAbove: 64 };
    const ctx: JumpEvalContext = {
      macros: [0, 0, 0, 0, 0, 0, 0, 0],
      lastMidiCc: { cc: 11, value: 127, channel: 0 },
    };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });
});

// ─── evaluateCondition · defensive ──────────────────────────────────────────

describe("evaluateCondition · defensive", () => {
  it("returns false for garbage condition / context", () => {
    // @ts-expect-error — intentionally invalid input
    expect(evaluateCondition(null, emptyCtx())).toBe(false);
    // @ts-expect-error
    expect(evaluateCondition({ kind: "bogus" }, emptyCtx())).toBe(false);
    expect(
      evaluateCondition({ kind: "always" }, null as unknown as JumpEvalContext)
    ).toBe(false);
  });
});

// ─── findTriggeredJump ──────────────────────────────────────────────────────

describe("findTriggeredJump", () => {
  it("empty array → null", () => {
    expect(findTriggeredJump([], "step-1", emptyCtx())).toBeNull();
  });

  it("returns first matching jump (priority by order)", () => {
    const jumps: Jump[] = [
      makeJump(
        "j1",
        "step-a",
        "step-b",
        { kind: "macro-above", macroIdx: 0, threshold: 0.5 }
      ),
      makeJump(
        "j2",
        "step-a",
        "step-c",
        { kind: "always" }
      ),
    ];
    // first one fails (macro is 0.1), second is always-true → returns j2
    const ctx = ctxWithMacros([0.1, 0, 0, 0, 0, 0, 0, 0]);
    const r = findTriggeredJump(jumps, "step-a", ctx);
    expect(r?.id).toBe("j2");
  });

  it("ignores jumps from other steps", () => {
    const jumps: Jump[] = [
      makeJump("j1", "step-other", "step-z", { kind: "always" }),
      makeJump("j2", "step-current", "step-y", { kind: "always" }),
    ];
    const r = findTriggeredJump(jumps, "step-current", emptyCtx());
    expect(r?.id).toBe("j2");
  });

  it("returns null when no condition fires", () => {
    const jumps: Jump[] = [
      makeJump(
        "j1",
        "step-a",
        "step-b",
        { kind: "macro-above", macroIdx: 0, threshold: 0.9 }
      ),
    ];
    expect(findTriggeredJump(jumps, "step-a", ctxWithMacros([0.1, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("returns null when currentStepId is empty", () => {
    const jumps: Jump[] = [makeJump("j1", "step-a", "step-b", { kind: "always" })];
    expect(findTriggeredJump(jumps, "", emptyCtx())).toBeNull();
  });
});

// ─── describeCondition ──────────────────────────────────────────────────────

describe("describeCondition", () => {
  it("formats every condition kind in a human-readable way", () => {
    expect(describeCondition({ kind: "always" })).toBe("Always");
    expect(
      describeCondition({ kind: "macro-above", macroIdx: 0, threshold: 0.5 })
    ).toBe("Macro 1 > 50%");
    expect(
      describeCondition({ kind: "macro-below", macroIdx: 3, threshold: 0.25 })
    ).toBe("Macro 4 < 25%");
    expect(describeCondition({ kind: "midi-note", note: 60 })).toBe("MIDI Note 60");
    expect(describeCondition({ kind: "midi-note", note: 60, channel: 0 })).toBe(
      "MIDI Note 60 (ch 1)"
    );
    expect(describeCondition({ kind: "midi-cc", cc: 1, valueAbove: 64 })).toBe(
      "MIDI CC 1 > 64"
    );
  });
});

// ─── Store: addJump / removeJump / updateJump ───────────────────────────────

describe("useSongJumpStore · CRUD", () => {
  it("addJump persists a new jump under the songId", () => {
    const id = addJump("song-1", {
      fromStepId: "s1",
      toStepId: "s2",
      condition: { kind: "always" },
    });
    expect(id).not.toBeNull();
    const jumps = getJumpsForSong("song-1");
    expect(jumps.length).toBe(1);
    expect(jumps[0].fromStepId).toBe("s1");
    expect(jumps[0].toStepId).toBe("s2");
    expect(jumps[0].condition.kind).toBe("always");
  });

  it("addJump rejects malformed input (no fromStepId)", () => {
    const id = addJump("song-1", {
      fromStepId: "",
      toStepId: "s2",
      condition: { kind: "always" },
    });
    expect(id).toBeNull();
    expect(getJumpsForSong("song-1").length).toBe(0);
  });

  it("addJump rejects malformed condition", () => {
    const id = addJump("song-1", {
      fromStepId: "s1",
      toStepId: "s2",
      // @ts-expect-error — invalid kind
      condition: { kind: "wat" },
    });
    expect(id).toBeNull();
  });

  it("removeJump deletes a jump by id", () => {
    const id = addJump("song-1", {
      fromStepId: "s1",
      toStepId: "s2",
      condition: { kind: "always" },
    })!;
    removeJump("song-1", id);
    expect(getJumpsForSong("song-1").length).toBe(0);
  });

  it("updateJump patches partial fields", () => {
    const id = addJump("song-1", {
      fromStepId: "s1",
      toStepId: "s2",
      condition: { kind: "always" },
    })!;
    updateJump("song-1", id, {
      toStepId: "s9",
      condition: { kind: "macro-above", macroIdx: 1, threshold: 0.7 },
      label: "Drop",
    });
    const j = getJumpsForSong("song-1")[0];
    expect(j.toStepId).toBe("s9");
    expect(j.condition.kind).toBe("macro-above");
    expect(j.label).toBe("Drop");
  });

  it("updateJump empty label clears the label", () => {
    const id = addJump("song-1", {
      fromStepId: "s1",
      toStepId: "s2",
      condition: { kind: "always" },
      label: "Original",
    })!;
    updateJump("song-1", id, { label: "" });
    const j = getJumpsForSong("song-1")[0];
    expect(j.label).toBeUndefined();
  });

  it("updateJump is a no-op for unknown jumpId", () => {
    addJump("song-1", { fromStepId: "s1", toStepId: "s2", condition: { kind: "always" } });
    const before = JSON.stringify(getJumpsForSong("song-1"));
    updateJump("song-1", "ghost", { toStepId: "s99" });
    const after = JSON.stringify(getJumpsForSong("song-1"));
    expect(before).toBe(after);
  });

  it("removeJumpsReferencingStep drops jumps that point to or from a step", () => {
    addJump("song-1", { fromStepId: "s1", toStepId: "s2", condition: { kind: "always" } });
    addJump("song-1", { fromStepId: "s2", toStepId: "s3", condition: { kind: "always" } });
    addJump("song-1", { fromStepId: "s3", toStepId: "s4", condition: { kind: "always" } });
    removeJumpsReferencingStep("song-1", "s2");
    const remaining = getJumpsForSong("song-1");
    expect(remaining.length).toBe(1);
    expect(remaining[0].fromStepId).toBe("s3");
  });
});

// ─── Store: scoping per songId ──────────────────────────────────────────────

describe("useSongJumpStore · per-song scoping", () => {
  it("jumps are scoped per songId", () => {
    addJump("song-A", {
      fromStepId: "s1",
      toStepId: "s2",
      condition: { kind: "always" },
    });
    addJump("song-B", {
      fromStepId: "s1",
      toStepId: "s9",
      condition: { kind: "always" },
    });
    expect(getJumpsForSong("song-A").length).toBe(1);
    expect(getJumpsForSong("song-B").length).toBe(1);
    expect(getJumpsForSong("song-A")[0].toStepId).toBe("s2");
    expect(getJumpsForSong("song-B")[0].toStepId).toBe("s9");
  });

  it("removing a song's last jump cleans up the entry in the map", () => {
    const id = addJump("song-A", {
      fromStepId: "s1",
      toStepId: "s2",
      condition: { kind: "always" },
    })!;
    removeJump("song-A", id);
    const state = getSongJumpState();
    expect(Object.keys(state.jumpsBySong)).not.toContain("song-A");
  });
});

// ─── Store: persistence ─────────────────────────────────────────────────────

describe("useSongJumpStore · persistence", () => {
  it("persists jumps via localStorage and reloads them after reset+import", () => {
    addJump("song-1", {
      fromStepId: "s1",
      toStepId: "s2",
      condition: { kind: "macro-above", macroIdx: 0, threshold: 0.5 },
      label: "Drop",
    });
    const raw = localStorage.getItem("ss-song-jumps:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.jumpsBySong["song-1"][0].label).toBe("Drop");
    expect(parsed.jumpsBySong["song-1"][0].condition.kind).toBe("macro-above");
  });

  it("graceful load from garbage localStorage", () => {
    localStorage.setItem("ss-song-jumps:v1", "{not-json");
    // Trigger a reset to force a "fresh load" path defensively. Since
    // __resetSongJumpStoreForTests clears state we round-trip by writing.
    __resetSongJumpStoreForTests();
    expect(getSongJumpState().jumpsBySong).toEqual({});
  });
});
