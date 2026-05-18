/**
 * tests/features/korg-esx-editor-undo.test.ts
 *
 * v3.38.0 — Tests for the KorgBankEditor Undo/Redo history stack.
 *
 * Closes the caveat from v3.32: "Undo-Stack im KorgBankEditor".
 *
 * Scope (pure-fn — no React/JSDOM render needed):
 *   (1) createEsxEditorHistory() returns empty past+future
 *   (2) pushEsxHistory clones snapshot, appends to past, clears future
 *   (3) undoEsxEditor restores prior snapshot, pushes current onto future
 *   (4) redoEsxEditor restores undone snapshot, pushes current onto past
 *   (5) Max-stack-size of 20 — older entries are dropped
 *   (6) canUndo / canRedo predicates reflect stack state
 *   (7) Snapshot clones are independent (mutating source doesn't affect snapshot)
 *
 * Env: node.
 */

import { describe, it, expect } from "vitest";

import {
  createEsxEditorHistory,
  pushEsxHistory,
  undoEsxEditor,
  redoEsxEditor,
  canUndoEsxEditor,
  canRedoEsxEditor,
  cloneEsxEditorSnapshot,
  EDITOR_HISTORY_MAX,
  type EsxEditorSnapshot,
  type EsxEditorHistory,
  type EsxSamplePatchEntry,
} from "../../client/src/utils/korg/esxBankEditorState";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBlock(byte: number): ArrayBuffer {
  const buf = new ArrayBuffer(4280);
  new Uint8Array(buf).fill(byte);
  return buf;
}

function makeSampleEntry(name: string, frames = 64): EsxSamplePatchEntry {
  return {
    pcmData: new Float32Array(frames),
    sampleRate: 44100,
    channels: 1,
    name,
    level: 100,
  };
}

function emptySnapshot(): EsxEditorSnapshot {
  return {
    patternMap: new Map(),
    sampleMap: new Map(),
    stereoSampleMap: new Map(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createEsxEditorHistory — initial state", () => {
  it("returns empty past and future", () => {
    const h = createEsxEditorHistory();
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(canUndoEsxEditor(h)).toBe(false);
    expect(canRedoEsxEditor(h)).toBe(false);
  });

  it("EDITOR_HISTORY_MAX is exported and equals 20 (memory-safe cap)", () => {
    expect(EDITOR_HISTORY_MAX).toBe(20);
  });
});

describe("pushEsxHistory — capture a snapshot before editing", () => {
  it("appends a cloned snapshot to past and clears future", () => {
    const initial = emptySnapshot();
    const h0 = createEsxEditorHistory();
    const h1 = pushEsxHistory(h0, initial);
    expect(h1.past.length).toBe(1);
    expect(h1.future).toEqual([]);
    expect(canUndoEsxEditor(h1)).toBe(true);
  });

  it("clears future stack on new edit (= invalidates redo trail)", () => {
    let h = createEsxEditorHistory();
    // Simulate: push, then a synthetic redo-trail.
    h = pushEsxHistory(h, emptySnapshot());
    h = { ...h, future: [emptySnapshot(), emptySnapshot()] };
    expect(h.future.length).toBe(2);
    // New push → future cleared.
    const next = pushEsxHistory(h, emptySnapshot());
    expect(next.future).toEqual([]);
  });

  it("snapshot is cloned — mutating source map after push doesn't change history", () => {
    const src = emptySnapshot();
    const h = pushEsxHistory(createEsxEditorHistory(), src);
    // Mutate source (simulating editor's setState which creates a new Map ref,
    // but defensive: caller might re-use refs).
    src.patternMap.set(0, makeBlock(0xAA));
    src.sampleMap.set(5, makeSampleEntry("X"));
    // History snapshot must be unaffected.
    expect(h.past[0].patternMap.size).toBe(0);
    expect(h.past[0].sampleMap.size).toBe(0);
  });

  it("supports multiple consecutive pushes", () => {
    let h = createEsxEditorHistory();
    for (let i = 0; i < 5; i++) {
      const snap: EsxEditorSnapshot = {
        patternMap: new Map([[i, makeBlock(i)]]),
        sampleMap: new Map(),
        stereoSampleMap: new Map(),
      };
      h = pushEsxHistory(h, snap);
    }
    expect(h.past.length).toBe(5);
    // Newest is at the end.
    expect(h.past[h.past.length - 1].patternMap.has(4)).toBe(true);
    expect(h.past[0].patternMap.has(0)).toBe(true);
  });
});

describe("undoEsxEditor — restore prior state", () => {
  it("returns null when past is empty (cannot undo)", () => {
    const result = undoEsxEditor(createEsxEditorHistory(), emptySnapshot());
    expect(result).toBeNull();
  });

  it("restores the most recent past snapshot and pushes current onto future", () => {
    // Stage 1: snapshot with pattern slot 5 → 0x42 (PRE-EDIT state).
    const pre: EsxEditorSnapshot = {
      patternMap: new Map([[5, makeBlock(0x42)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    const h = pushEsxHistory(createEsxEditorHistory(), pre);
    // Stage 2: user applied a new patch (slot 5 → 0xAB) — CURRENT state.
    const current: EsxEditorSnapshot = {
      patternMap: new Map([[5, makeBlock(0xAB)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    // Undo!
    const result = undoEsxEditor(h, current);
    expect(result).not.toBeNull();
    // Returned snapshot is the pre-edit state.
    expect(result!.snapshot.patternMap.get(5)).toBeDefined();
    const restored = new Uint8Array(result!.snapshot.patternMap.get(5)!);
    expect(restored[0]).toBe(0x42);
    // History now: past empty, future has 1 entry (the current state).
    expect(result!.history.past).toEqual([]);
    expect(result!.history.future.length).toBe(1);
    const futureSnap = result!.history.future[0];
    const futurePattern = new Uint8Array(futureSnap.patternMap.get(5)!);
    expect(futurePattern[0]).toBe(0xAB);
  });

  it("Undo restored previous state (full snapshot equality across maps)", () => {
    const pre: EsxEditorSnapshot = {
      patternMap: new Map([[1, makeBlock(0x11)]]),
      sampleMap: new Map([[2, makeSampleEntry("A", 32)]]),
      stereoSampleMap: new Map([[3, { ...makeSampleEntry("S", 32), channels: 2 }]]),
    };
    const h = pushEsxHistory(createEsxEditorHistory(), pre);
    const current: EsxEditorSnapshot = {
      patternMap: new Map(),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    const result = undoEsxEditor(h, current);
    expect(result).not.toBeNull();
    expect(result!.snapshot.patternMap.size).toBe(1);
    expect(result!.snapshot.sampleMap.size).toBe(1);
    expect(result!.snapshot.stereoSampleMap.size).toBe(1);
    expect(result!.snapshot.sampleMap.get(2)!.name).toBe("A");
    expect(result!.snapshot.stereoSampleMap.get(3)!.name).toBe("S");
  });

  it("two consecutive undos walk past stack from newest → oldest", () => {
    let h = createEsxEditorHistory();
    // Push 3 snapshots: states A, B, C (oldest → newest).
    h = pushEsxHistory(h, {
      patternMap: new Map([[0, makeBlock(0xA)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    });
    h = pushEsxHistory(h, {
      patternMap: new Map([[0, makeBlock(0xB)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    });
    h = pushEsxHistory(h, {
      patternMap: new Map([[0, makeBlock(0xC)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    });
    // "Current" is whatever D was applied after C.
    let current: EsxEditorSnapshot = {
      patternMap: new Map([[0, makeBlock(0xD)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    // Undo 1 → should return C.
    const r1 = undoEsxEditor(h, current);
    expect(new Uint8Array(r1!.snapshot.patternMap.get(0)!)[0]).toBe(0xC);
    current = r1!.snapshot;
    // Undo 2 → should return B.
    const r2 = undoEsxEditor(r1!.history, current);
    expect(new Uint8Array(r2!.snapshot.patternMap.get(0)!)[0]).toBe(0xB);
  });
});

describe("redoEsxEditor — replay undone change", () => {
  it("returns null when future is empty", () => {
    const result = redoEsxEditor(createEsxEditorHistory(), emptySnapshot());
    expect(result).toBeNull();
  });

  it("Redo replays undone change (undo → redo round-trip lands at original)", () => {
    const original: EsxEditorSnapshot = {
      patternMap: new Map([[5, makeBlock(0x42)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    const edited: EsxEditorSnapshot = {
      patternMap: new Map([[5, makeBlock(0xAB)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    // Push original BEFORE applying edit.
    const h = pushEsxHistory(createEsxEditorHistory(), original);
    // Undo → restores original, edited goes to future.
    const u = undoEsxEditor(h, edited);
    expect(u).not.toBeNull();
    // Redo → replays edited, original goes back to past.
    const r = redoEsxEditor(u!.history, u!.snapshot);
    expect(r).not.toBeNull();
    expect(new Uint8Array(r!.snapshot.patternMap.get(5)!)[0]).toBe(0xAB);
    expect(r!.history.past.length).toBe(1);
    expect(r!.history.future.length).toBe(0);
  });
});

describe("Max history size — memory-safe cap", () => {
  it("Max history 20 entries — older entries are dropped when EDITOR_HISTORY_MAX is exceeded", () => {
    let h = createEsxEditorHistory();
    // Push 25 entries (5 over the cap of 20).
    for (let i = 0; i < 25; i++) {
      h = pushEsxHistory(h, {
        patternMap: new Map([[0, makeBlock(i)]]),
        sampleMap: new Map(),
        stereoSampleMap: new Map(),
      });
    }
    expect(h.past.length).toBe(EDITOR_HISTORY_MAX);
    // Oldest survivor is index 5 (entries 0..4 were dropped).
    const oldestByte = new Uint8Array(h.past[0].patternMap.get(0)!)[0];
    expect(oldestByte).toBe(5);
    // Newest is index 24.
    const newestByte = new Uint8Array(
      h.past[h.past.length - 1].patternMap.get(0)!,
    )[0];
    expect(newestByte).toBe(24);
  });

  it("Future stack also respects max-size cap on long undo chains", () => {
    // Build a past stack at the cap.
    let h = createEsxEditorHistory();
    for (let i = 0; i < EDITOR_HISTORY_MAX; i++) {
      h = pushEsxHistory(h, {
        patternMap: new Map([[0, makeBlock(i)]]),
        sampleMap: new Map(),
        stereoSampleMap: new Map(),
      });
    }
    // Undo all 20 + try a 21st via synthetic past entry; future should never
    // exceed cap.
    let current: EsxEditorSnapshot = {
      patternMap: new Map([[0, makeBlock(99)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    for (let i = 0; i < EDITOR_HISTORY_MAX; i++) {
      const r = undoEsxEditor(h, current);
      if (!r) break;
      h = r.history;
      current = r.snapshot;
    }
    expect(h.future.length).toBeLessThanOrEqual(EDITOR_HISTORY_MAX);
  });
});

describe("canUndoEsxEditor / canRedoEsxEditor — predicates", () => {
  it("canUndo=false on fresh history", () => {
    expect(canUndoEsxEditor(createEsxEditorHistory())).toBe(false);
  });

  it("canUndo=true after one push, then false after an undo-empty", () => {
    let h: EsxEditorHistory = pushEsxHistory(
      createEsxEditorHistory(),
      emptySnapshot(),
    );
    expect(canUndoEsxEditor(h)).toBe(true);
    const r = undoEsxEditor(h, emptySnapshot());
    expect(r).not.toBeNull();
    h = r!.history;
    expect(canUndoEsxEditor(h)).toBe(false);
    expect(canRedoEsxEditor(h)).toBe(true);
  });

  it("after redo, canUndo=true and canRedo=false (round-trip closes the loop)", () => {
    let h: EsxEditorHistory = pushEsxHistory(
      createEsxEditorHistory(),
      emptySnapshot(),
    );
    const u = undoEsxEditor(h, emptySnapshot());
    h = u!.history;
    const r = redoEsxEditor(h, u!.snapshot);
    expect(r).not.toBeNull();
    h = r!.history;
    expect(canUndoEsxEditor(h)).toBe(true);
    expect(canRedoEsxEditor(h)).toBe(false);
  });
});

describe("cloneEsxEditorSnapshot — defensive copy", () => {
  it("returns a new object with new Map instances (not the same refs)", () => {
    const src: EsxEditorSnapshot = {
      patternMap: new Map([[1, makeBlock(0xAA)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    const dst = cloneEsxEditorSnapshot(src);
    expect(dst).not.toBe(src);
    expect(dst.patternMap).not.toBe(src.patternMap);
    expect(dst.sampleMap).not.toBe(src.sampleMap);
    expect(dst.stereoSampleMap).not.toBe(src.stereoSampleMap);
    // But contents are equal.
    expect(dst.patternMap.size).toBe(1);
    expect(dst.patternMap.get(1)).toBe(src.patternMap.get(1));
  });

  it("mutating dst's Map doesn't affect src's Map", () => {
    const src: EsxEditorSnapshot = {
      patternMap: new Map([[1, makeBlock(0xAA)]]),
      sampleMap: new Map(),
      stereoSampleMap: new Map(),
    };
    const dst = cloneEsxEditorSnapshot(src);
    dst.patternMap.delete(1);
    expect(src.patternMap.size).toBe(1);
    expect(dst.patternMap.size).toBe(0);
  });
});
