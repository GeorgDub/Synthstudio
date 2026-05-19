/**
 * tests/features/song-sequencer.test.ts (v3.109.0)
 *
 * Tests for:
 *   - Pure helper getNextStep / expandSong / clampRepeatCount
 *   - useSongModeStore (CRUD + Transport + Persistence)
 *
 * Pattern: Custom-Observer-Store wie useSceneStore — wir nutzen das exportierte
 * __resetSongModeStoreForTests, um zwischen Specs sauber zurückzusetzen.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getNextStep,
  expandSong,
  clampRepeatCount,
  firstPatternId,
  type Song,
} from "@/utils/songSequencer";
import {
  __resetSongModeStoreForTests,
  addSong,
  removeSong,
  renameSong,
  setSongLoopMode,
  addStep,
  removeStep,
  setStepRepeat,
  setStepLabel,
  reorderStep,
  setActiveSong,
  resetTransport,
  advance,
  getSongModeState,
  getActiveSong,
} from "@/store/useSongModeStore";

// ─── helper ──────────────────────────────────────────────────────────────────

function makeSong(loopMode: Song["loopMode"], stepDefs: Array<{ p: string; r: number }>): Song {
  return {
    id: "song-1",
    name: "Test",
    loopMode,
    steps: stepDefs.map((d, i) => ({
      id: `step-${i}`,
      patternId: d.p,
      repeatCount: d.r,
    })),
  };
}

// ─── Pure: clampRepeatCount ──────────────────────────────────────────────────

describe("clampRepeatCount", () => {
  it("clamps to MIN_REPEAT=1 for values below", () => {
    expect(clampRepeatCount(0)).toBe(1);
    expect(clampRepeatCount(-5)).toBe(1);
  });

  it("clamps to MAX_REPEAT=64 for values above", () => {
    expect(clampRepeatCount(100)).toBe(64);
    expect(clampRepeatCount(Infinity)).toBe(1); // non-finite → MIN
  });

  it("rounds non-integers", () => {
    expect(clampRepeatCount(3.4)).toBe(3);
    expect(clampRepeatCount(3.6)).toBe(4);
  });

  it("falls back to MIN_REPEAT for NaN", () => {
    expect(clampRepeatCount(NaN)).toBe(1);
  });
});

// ─── Pure: getNextStep ───────────────────────────────────────────────────────

describe("getNextStep – same-step repeat", () => {
  it("stays on same step until repeatCount is reached", () => {
    const s = makeSong("once", [{ p: "A", r: 3 }, { p: "B", r: 1 }]);
    // After play 1 of 3: stay
    const r1 = getNextStep(s, 0, 0);
    expect(r1.nextStepIdx).toBe(0);
    expect(r1.nextRepeat).toBe(1);
    expect(r1.patternId).toBe("A");
    // After play 2 of 3: stay
    const r2 = getNextStep(s, 0, 1);
    expect(r2.nextStepIdx).toBe(0);
    expect(r2.nextRepeat).toBe(2);
    // After play 3 of 3: advance
    const r3 = getNextStep(s, 0, 2);
    expect(r3.nextStepIdx).toBe(1);
    expect(r3.patternId).toBe("B");
  });

  it("advances immediately when repeatCount=1", () => {
    const s = makeSong("once", [{ p: "A", r: 1 }, { p: "B", r: 1 }]);
    const r = getNextStep(s, 0, 0);
    expect(r.patternId).toBe("B");
    expect(r.nextStepIdx).toBe(1);
  });

  it("clamps a step's stored garbage repeatCount", () => {
    // repeatCount=0 should be treated as 1 → advance immediately
    const s: Song = {
      id: "g",
      name: "g",
      loopMode: "once",
      steps: [
        { id: "s0", patternId: "A", repeatCount: 0 },
        { id: "s1", patternId: "B", repeatCount: 1 },
      ],
    };
    const r = getNextStep(s, 0, 0);
    expect(r.patternId).toBe("B");
  });
});

describe("getNextStep – loopMode", () => {
  it("'once' returns finished after last step's last repeat", () => {
    const s = makeSong("once", [{ p: "A", r: 1 }, { p: "B", r: 1 }]);
    const last = getNextStep(s, 1, 0); // after B's only play
    expect(last.isFinished).toBe(true);
    expect(last.patternId).toBeNull();
    expect(last.nextStepIdx).toBe(-1);
  });

  it("'loop' wraps from last back to first", () => {
    const s = makeSong("loop", [{ p: "A", r: 1 }, { p: "B", r: 1 }]);
    const r = getNextStep(s, 1, 0);
    expect(r.isFinished).toBe(false);
    expect(r.patternId).toBe("A");
    expect(r.nextStepIdx).toBe(0);
  });

  it("'pingpong' reverses direction at end", () => {
    const s = makeSong("pingpong", [
      { p: "A", r: 1 },
      { p: "B", r: 1 },
      { p: "C", r: 1 },
    ]);
    // At C (idx 2) going +1, bounce to B (idx 1) direction=-1
    const r1 = getNextStep(s, 2, 0, 1);
    expect(r1.nextStepIdx).toBe(1);
    expect(r1.direction).toBe(-1);
    expect(r1.patternId).toBe("B");
    // At A (idx 0) going -1, bounce to B direction=+1
    const r2 = getNextStep(s, 0, 0, -1);
    expect(r2.nextStepIdx).toBe(1);
    expect(r2.direction).toBe(1);
    expect(r2.patternId).toBe("B");
  });

  it("'pingpong' single-step song stays on step 0", () => {
    const s = makeSong("pingpong", [{ p: "A", r: 1 }]);
    const r = getNextStep(s, 0, 0, 1);
    expect(r.nextStepIdx).toBe(0);
    expect(r.isFinished).toBe(false);
  });
});

describe("getNextStep – edge cases", () => {
  it("empty song returns finished", () => {
    const s: Song = { id: "x", name: "x", loopMode: "once", steps: [] };
    const r = getNextStep(s, 0, 0);
    expect(r.isFinished).toBe(true);
    expect(r.patternId).toBeNull();
  });

  it("out-of-range currentStepIdx returns finished", () => {
    const s = makeSong("loop", [{ p: "A", r: 1 }]);
    expect(getNextStep(s, 5, 0).isFinished).toBe(true);
    expect(getNextStep(s, -1, 0).isFinished).toBe(true);
  });

  it("single step with repeat=1 finishes after one play in 'once' mode", () => {
    const s = makeSong("once", [{ p: "A", r: 1 }]);
    const r = getNextStep(s, 0, 0);
    expect(r.isFinished).toBe(true);
  });
});

// ─── Pure: expandSong ────────────────────────────────────────────────────────

describe("expandSong", () => {
  it("expands A×2 B×3 to [A,A,B,B,B] in 'once' mode", () => {
    const s = makeSong("once", [
      { p: "A", r: 2 },
      { p: "B", r: 3 },
    ]);
    expect(expandSong(s)).toEqual(["A", "A", "B", "B", "B"]);
  });

  it("expands looped A×1 B×1 wraps until maxLength", () => {
    const s = makeSong("loop", [
      { p: "A", r: 1 },
      { p: "B", r: 1 },
    ]);
    expect(expandSong(s, 6)).toEqual(["A", "B", "A", "B", "A", "B"]);
  });

  it("expands pingpong A B C with repeats", () => {
    const s = makeSong("pingpong", [
      { p: "A", r: 1 },
      { p: "B", r: 1 },
      { p: "C", r: 1 },
    ]);
    // A B C B A B C B A …
    expect(expandSong(s, 9)).toEqual(["A", "B", "C", "B", "A", "B", "C", "B", "A"]);
  });

  it("empty song returns []", () => {
    expect(expandSong({ id: "x", name: "x", loopMode: "loop", steps: [] })).toEqual([]);
  });
});

describe("firstPatternId", () => {
  it("returns first step's patternId", () => {
    const s = makeSong("once", [{ p: "A", r: 1 }]);
    expect(firstPatternId(s)).toBe("A");
  });

  it("returns null for empty song", () => {
    expect(firstPatternId({ id: "x", name: "x", loopMode: "once", steps: [] })).toBeNull();
  });
});

// ─── Store: CRUD ─────────────────────────────────────────────────────────────

describe("useSongModeStore – Song CRUD", () => {
  beforeEach(() => __resetSongModeStoreForTests());

  it("addSong inserts a new empty song", () => {
    const id = addSong("My Song");
    const st = getSongModeState();
    expect(st.songs).toHaveLength(1);
    expect(st.songs[0].id).toBe(id);
    expect(st.songs[0].name).toBe("My Song");
    expect(st.songs[0].steps).toEqual([]);
    expect(st.songs[0].loopMode).toBe("once");
  });

  it("addSong with empty name falls back to 'Untitled Song'", () => {
    addSong("   ");
    expect(getSongModeState().songs[0].name).toBe("Untitled Song");
  });

  it("removeSong removes by ID and clears activeSongId if matched", () => {
    const id = addSong("A");
    setActiveSong(id);
    expect(getSongModeState().activeSongId).toBe(id);
    removeSong(id);
    expect(getSongModeState().songs).toHaveLength(0);
    expect(getSongModeState().activeSongId).toBeNull();
  });

  it("renameSong updates name; empty input ignored", () => {
    const id = addSong("Old");
    renameSong(id, "New");
    expect(getSongModeState().songs[0].name).toBe("New");
    renameSong(id, "   ");
    expect(getSongModeState().songs[0].name).toBe("New");
  });

  it("setSongLoopMode changes mode", () => {
    const id = addSong("S");
    setSongLoopMode(id, "loop");
    expect(getSongModeState().songs[0].loopMode).toBe("loop");
    setSongLoopMode(id, "pingpong");
    expect(getSongModeState().songs[0].loopMode).toBe("pingpong");
  });
});

describe("useSongModeStore – Step CRUD", () => {
  beforeEach(() => __resetSongModeStoreForTests());

  it("addStep appends step with clamped repeatCount", () => {
    const sid = addSong("S");
    const stepId = addStep(sid, "pat-A", 4);
    expect(stepId).not.toBeNull();
    const s = getSongModeState().songs[0];
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0].patternId).toBe("pat-A");
    expect(s.steps[0].repeatCount).toBe(4);
  });

  it("addStep returns null for empty patternId", () => {
    const sid = addSong("S");
    expect(addStep(sid, "")).toBeNull();
  });

  it("addStep returns null for unknown songId", () => {
    expect(addStep("ghost", "pat-A")).toBeNull();
  });

  it("setStepRepeat clamps to MIN..MAX", () => {
    const sid = addSong("S");
    const stepId = addStep(sid, "pat-A", 1)!;
    setStepRepeat(sid, stepId, 999);
    expect(getSongModeState().songs[0].steps[0].repeatCount).toBe(64);
    setStepRepeat(sid, stepId, -5);
    expect(getSongModeState().songs[0].steps[0].repeatCount).toBe(1);
  });

  it("setStepLabel sets and clears label", () => {
    const sid = addSong("S");
    const stepId = addStep(sid, "pat-A", 1)!;
    setStepLabel(sid, stepId, "Intro");
    expect(getSongModeState().songs[0].steps[0].label).toBe("Intro");
    setStepLabel(sid, stepId, "");
    expect(getSongModeState().songs[0].steps[0].label).toBeUndefined();
  });

  it("removeStep removes by stepId", () => {
    const sid = addSong("S");
    const s1 = addStep(sid, "pat-A", 1)!;
    addStep(sid, "pat-B", 1)!;
    removeStep(sid, s1);
    const steps = getSongModeState().songs[0].steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].patternId).toBe("pat-B");
  });

  it("reorderStep preserves repeats + labels", () => {
    const sid = addSong("S");
    const s1 = addStep(sid, "pat-A", 4)!;
    addStep(sid, "pat-B", 2)!;
    addStep(sid, "pat-C", 7)!;
    setStepLabel(sid, s1, "Intro");
    // Move idx 0 → 2: B C A
    reorderStep(sid, 0, 2);
    const steps = getSongModeState().songs[0].steps;
    expect(steps.map(s => s.patternId)).toEqual(["pat-B", "pat-C", "pat-A"]);
    expect(steps[2].label).toBe("Intro");
    expect(steps[2].repeatCount).toBe(4);
    expect(steps[0].repeatCount).toBe(2);
  });

  it("reorderStep ignores out-of-range indices", () => {
    const sid = addSong("S");
    addStep(sid, "pat-A", 1);
    addStep(sid, "pat-B", 1);
    reorderStep(sid, -1, 1);
    reorderStep(sid, 0, 5);
    const ids = getSongModeState().songs[0].steps.map(s => s.patternId);
    expect(ids).toEqual(["pat-A", "pat-B"]);
  });
});

// ─── Store: Transport / advance ──────────────────────────────────────────────

describe("useSongModeStore – Transport advance()", () => {
  beforeEach(() => __resetSongModeStoreForTests());

  it("advance with no active song returns finished=true", () => {
    const r = advance();
    expect(r.patternId).toBeNull();
    expect(r.isFinished).toBe(true);
  });

  it("advance for A×2 B×3 (once) yields [A,A,B,B,B,null]", () => {
    const sid = addSong("S");
    addStep(sid, "A", 2);
    addStep(sid, "B", 3);
    setActiveSong(sid);

    // The first play is "implicit" (initial activation). advance() drives
    // subsequent plays. So we expect 4 successful advances + 1 final null.
    const seq: Array<string | null> = [];
    for (let i = 0; i < 5; i++) {
      seq.push(advance().patternId);
    }
    // After activation, currentStep=0/repeat=0 means "A just played once".
    // advance() steps: → A (repeat=1) → B (step 1, repeat=0) → B (repeat=1)
    //                  → B (repeat=2) → null (finished after B's 3rd)
    expect(seq).toEqual(["A", "B", "B", "B", null]);
  });

  it("advance in loop mode wraps forever", () => {
    const sid = addSong("S");
    addStep(sid, "A", 1);
    addStep(sid, "B", 1);
    setSongLoopMode(sid, "loop");
    setActiveSong(sid);

    const seq = [advance().patternId, advance().patternId, advance().patternId, advance().patternId];
    expect(seq).toEqual(["B", "A", "B", "A"]);
  });

  it("advance in pingpong reverses direction", () => {
    const sid = addSong("S");
    addStep(sid, "A", 1);
    addStep(sid, "B", 1);
    addStep(sid, "C", 1);
    setSongLoopMode(sid, "pingpong");
    setActiveSong(sid);

    // initial: idx 0 A. advance → B(1), C(2), B(1, dir=-1), A(0, dir=-1), B(1, dir=+1)
    const seq = [
      advance().patternId,
      advance().patternId,
      advance().patternId,
      advance().patternId,
      advance().patternId,
      advance().patternId,
    ];
    expect(seq).toEqual(["B", "C", "B", "A", "B", "C"]);
  });

  it("resetTransport returns to step 0", () => {
    const sid = addSong("S");
    addStep(sid, "A", 1);
    addStep(sid, "B", 1);
    setSongLoopMode(sid, "loop");
    setActiveSong(sid);
    advance(); // → B
    advance(); // → A
    expect(getSongModeState().currentStepIdx).toBe(0);
    resetTransport();
    expect(getSongModeState().currentStepIdx).toBe(0);
    expect(getSongModeState().currentRepeat).toBe(0);
    expect(getSongModeState().direction).toBe(1);
  });

  it("setActiveSong resets cursor", () => {
    const sid = addSong("S");
    addStep(sid, "A", 5);
    setSongLoopMode(sid, "loop");
    setActiveSong(sid);
    advance(); // repeat=1
    expect(getSongModeState().currentRepeat).toBe(1);
    setActiveSong(sid);
    expect(getSongModeState().currentRepeat).toBe(0);
  });

  it("setActiveSong null deactivates", () => {
    const sid = addSong("S");
    setActiveSong(sid);
    setActiveSong(null);
    expect(getSongModeState().activeSongId).toBeNull();
    expect(getActiveSong()).toBeNull();
  });

  it("removing active song clears active state", () => {
    const sid = addSong("S");
    setActiveSong(sid);
    removeSong(sid);
    expect(getActiveSong()).toBeNull();
  });
});

// ─── Persistence ─────────────────────────────────────────────────────────────

describe("useSongModeStore – Persistence", () => {
  beforeEach(() => __resetSongModeStoreForTests());

  it("addSong persists to localStorage", () => {
    const id = addSong("Persistable");
    addStep(id, "pat-A", 3);
    const raw = localStorage.getItem("ss-song-mode:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.songs).toHaveLength(1);
    expect(parsed.songs[0].name).toBe("Persistable");
    expect(parsed.songs[0].steps[0].repeatCount).toBe(3);
  });

  it("transport state is NOT persisted", () => {
    const id = addSong("S");
    addStep(id, "A", 5);
    setSongLoopMode(id, "loop");
    setActiveSong(id);
    advance();
    advance();
    const raw = JSON.parse(localStorage.getItem("ss-song-mode:v1") || "{}");
    expect(raw.currentStepIdx).toBeUndefined();
    expect(raw.currentRepeat).toBeUndefined();
    expect(raw.direction).toBeUndefined();
  });

  it("garbage in localStorage is ignored gracefully", () => {
    localStorage.setItem("ss-song-mode:v1", "not-json-{{{");
    __resetSongModeStoreForTests();
    // After reset, store falls back to defaults; loading would also be safe
    expect(getSongModeState().songs).toEqual([]);
  });
});
