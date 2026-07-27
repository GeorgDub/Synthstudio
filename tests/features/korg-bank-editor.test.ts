/**
 * tests/features/korg-bank-editor.test.ts
 *
 * Unit-Tests für v3.7.0 — Bank-Open-Flow im KorgBankEditor.
 *
 * Geprüft wird das pure-Logik-Modul `bankEditorState.ts`. Die React-Komponente
 * `KorgBankEditor.tsx` wird hier NICHT gerendert (kein React-Testing-Library);
 * Smoke-E2E ist via Playwright in tests/web/ vorgesehen, wenn der User es
 * fordert (siehe TASK-v3.7-FOLLOWUP-1).
 *
 * Coverage:
 *   - bankToOpenedSlots: 250-Row-Repräsentation, empty-Placeholders,
 *     isDirty=false at load, rawRiff propagation, original-snapshot
 *   - patchOpenedSlot: editable-field changes set isDirty=true, structural
 *     fields do not auto-flip
 *   - replaceSlotSample: always sets isDirty
 *   - deleteSlot: empty:true + isDirty:true, rawRiff dropped
 *   - revertSlot: isDirty:false, restores all editable + audio fields
 *   - openedSlotsToBuildInputs: dirty vs passthrough counts; empty slots
 *     skipped; corrupt slots dropped
 *   - Bit-exakt Round-Trip-Verifier:
 *       parseE2sBank → bankToOpenedSlots → openedSlotsToBuildInputs
 *       → buildE2sBank({preserveRawRiff:true}) ===  baseline
 */

import { describe, it, expect } from "vitest";
import {
  bankToOpenedSlots,
  countDirtySlots,
  countFilledSlots,
  deleteSlot,
  displayCategory,
  displayName,
  hasUnsavedChanges,
  openedSlotsToBuildInputs,
  patchOpenedSlot,
  replaceSlotSample,
  revertSlot,
} from "@/utils/korg/bankEditorState";
import { buildE2sBank } from "@/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "@/utils/korg/e2sBankReader";
import {
  E2S_MAX_SLOTS,
  LOOP_TYPE_FORWARD,
  LOOP_TYPE_ONESHOT,
} from "@/utils/korg/constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sineFloat(
  frames: number,
  freq = 440,
  sr = 44100,
  amp = 0.5
): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp;
  }
  return out;
}

/** Baut eine Bank mit `n` Slots an Indices 0..n-1 (aufeinanderfolgend). */
function buildTestBank(n: number) {
  const slots = [];
  for (let i = 0; i < n; i++) {
    slots.push({
      slotIndex: i,
      name: `Slot${i}`,
      pcmData: sineFloat(100 + i * 10, 220 + i * 100, 44100, 0.2),
      sampleRate: 44100,
      channels: 1 as const,
      category: i % 18,
      loopType: (i % 2 === 0 ? 1 : 2) as 1 | 2,
      gain12db: i % 3 === 0,
      level: 100,
    });
  }
  return buildE2sBank(slots);
}

// ─── bankToOpenedSlots ────────────────────────────────────────────────────────

describe("bankEditorState — bankToOpenedSlots", () => {
  it("liefert exakt 250 Rows, davon N filled und 250-N empty", () => {
    const baseline = buildTestBank(3);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    expect(slots).toHaveLength(E2S_MAX_SLOTS);
    expect(countFilledSlots(slots)).toBe(3);
    expect(slots.filter(s => s.empty)).toHaveLength(E2S_MAX_SLOTS - 3);
  });

  it("loadBank: parseE2sBank result wird zu Editor-Slots mit isDirty=false", () => {
    const baseline = buildTestBank(2);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    expect(countDirtySlots(slots)).toBe(0);
    expect(hasUnsavedChanges(slots)).toBe(false);
    const filled = slots.filter(s => !s.empty);
    for (const s of filled) {
      expect(s.isDirty).toBe(false);
    }
  });

  it("filled-Slots haben rawRiff (preserveRawRiff=true) und original-Snapshot", () => {
    const baseline = buildTestBank(2);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    const s0 = slots[0];
    expect(s0.empty).toBe(false);
    expect(s0.rawRiff).toBeInstanceOf(Uint8Array);
    expect(s0.rawRiff!.length).toBeGreaterThan(0);
    expect(s0.original).not.toBeNull();
    expect(s0.original!.name).toBe(s0.name);
    expect(s0.original!.rawRiff).toBe(s0.rawRiff);
  });

  it("empty-Slots haben original:null und keinen rawRiff", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    const empty = slots[100]; // beliebiger leerer Slot
    expect(empty.empty).toBe(true);
    expect(empty.original).toBeNull();
    expect(empty.rawRiff).toBeUndefined();
  });

  it("oneshot-Flag wird korrekt aus loopType abgeleitet", () => {
    // Build mit explizitem loopType pro Slot.
    const built = buildE2sBank([
      {
        slotIndex: 0,
        name: "OneShot",
        pcmData: sineFloat(50),
        sampleRate: 44100,
        channels: 1,
        loopType: LOOP_TYPE_ONESHOT,
      },
      {
        slotIndex: 1,
        name: "Forward",
        pcmData: sineFloat(50),
        sampleRate: 44100,
        channels: 1,
        loopType: LOOP_TYPE_FORWARD,
      },
    ]);
    const bank = parseE2sBank(built.buffer, "<t>", { preserveRawRiff: true });
    const slots = bankToOpenedSlots(bank);
    expect(slots[0].oneshot).toBe(true);
    expect(slots[1].oneshot).toBe(false);
  });
});

// ─── patchOpenedSlot ──────────────────────────────────────────────────────────

describe("bankEditorState — patchOpenedSlot", () => {
  it("Edit Name → isDirty=true für diesen Slot", () => {
    const baseline = buildTestBank(2);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    const rowId = slots[0].rowId;
    slots = patchOpenedSlot(slots, rowId, { name: "Renamed" });
    expect(slots[0].name).toBe("Renamed");
    expect(slots[0].isDirty).toBe(true);
    // Andere Slots bleiben clean.
    expect(slots[1].isDirty).toBe(false);
  });

  it("Edit Category / Oneshot / gain12db / sampleTune → jeweils isDirty=true", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const base = bankToOpenedSlots(bank);
    const id = base[0].rowId;

    const a = patchOpenedSlot(base, id, { category: 5 });
    expect(a[0].isDirty).toBe(true);

    const b = patchOpenedSlot(base, id, { oneshot: !base[0].oneshot });
    expect(b[0].isDirty).toBe(true);

    const c = patchOpenedSlot(base, id, { gain12db: !base[0].gain12db });
    expect(c[0].isDirty).toBe(true);

    const d = patchOpenedSlot(base, id, { sampleTune: 12 });
    expect(d[0].isDirty).toBe(true);
  });

  it("Patch ohne Änderung des Feldwerts → isDirty bleibt unverändert", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    const id = slots[0].rowId;
    // identisches Patch → kein editable-touched
    const patched = patchOpenedSlot(slots, id, { name: slots[0].name });
    expect(patched[0].isDirty).toBe(false);
  });

  it("Strukturelle Felder (rowId/empty/original) flippen isDirty NICHT auto", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    const id = slots[0].rowId;
    // diese Felder sind strukturell — patch flippt nicht isDirty.
    const out = patchOpenedSlot(slots, id, { empty: false });
    expect(out[0].isDirty).toBe(false);
  });
});

// ─── replaceSlotSample ────────────────────────────────────────────────────────

describe("bankEditorState — replaceSlotSample", () => {
  it("Replace Sample → isDirty=true und neue PCM gespeichert", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    const id = slots[0].rowId;
    const newPcm = new Float32Array(2000);
    slots = replaceSlotSample(slots, id, newPcm, 48000, 2);
    expect(slots[0].isDirty).toBe(true);
    expect(slots[0].pcmData).toBe(newPcm);
    expect(slots[0].sampleRate).toBe(48000);
    expect(slots[0].channels).toBe(2);
    expect(slots[0].frames).toBe(1000); // 2000 / 2 channels
  });

  it("Replace Sample auf empty-Slot fully fills it (empty:false)", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    const emptyRow = slots[50];
    expect(emptyRow.empty).toBe(true);
    slots = replaceSlotSample(
      slots,
      emptyRow.rowId,
      new Float32Array(100),
      44100,
      1
    );
    expect(slots[50].empty).toBe(false);
    expect(slots[50].isDirty).toBe(true);
  });
});

// ─── deleteSlot ───────────────────────────────────────────────────────────────

describe("bankEditorState — deleteSlot", () => {
  it("Delete → empty:true + isDirty:true; rawRiff weg, aber original behalten", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    const id = slots[0].rowId;
    const origRaw = slots[0].rawRiff;
    expect(origRaw).toBeInstanceOf(Uint8Array);
    slots = deleteSlot(slots, id);
    expect(slots[0].empty).toBe(true);
    expect(slots[0].isDirty).toBe(true);
    expect(slots[0].rawRiff).toBeUndefined(); // dropped
    expect(slots[0].pcmData).toBeUndefined();
    // Original-Snapshot bleibt für Revert
    expect(slots[0].original).not.toBeNull();
  });
});

// ─── revertSlot ───────────────────────────────────────────────────────────────

describe("bankEditorState — revertSlot", () => {
  it("Revert nach Edit → isDirty:false + Felder zurückgesetzt", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    const id = slots[0].rowId;
    const origName = slots[0].name;
    slots = patchOpenedSlot(slots, id, { name: "X", category: 9 });
    expect(slots[0].isDirty).toBe(true);
    slots = revertSlot(slots, id);
    expect(slots[0].isDirty).toBe(false);
    expect(slots[0].name).toBe(origName);
  });

  it("Revert nach Delete → Slot wieder filled + rawRiff zurück", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    const id = slots[0].rowId;
    const origRaw = slots[0].rawRiff;
    slots = deleteSlot(slots, id);
    expect(slots[0].empty).toBe(true);
    slots = revertSlot(slots, id);
    expect(slots[0].empty).toBe(false);
    expect(slots[0].rawRiff).toBe(origRaw);
    expect(slots[0].isDirty).toBe(false);
  });

  it("Revert auf urspr. empty Slot → bleibt empty", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots0 = bankToOpenedSlots(bank);
    const emptyRow = slots0[100];
    expect(emptyRow.empty).toBe(true);
    expect(emptyRow.original).toBeNull();
    let slots = replaceSlotSample(
      slots0,
      emptyRow.rowId,
      new Float32Array(50),
      44100,
      1
    );
    expect(slots[100].empty).toBe(false);
    slots = revertSlot(slots, emptyRow.rowId);
    expect(slots[100].empty).toBe(true);
    expect(slots[100].isDirty).toBe(false);
  });
});

// ─── openedSlotsToBuildInputs ─────────────────────────────────────────────────

describe("bankEditorState — openedSlotsToBuildInputs", () => {
  it("zählt dirty vs passthrough Slots korrekt", () => {
    const baseline = buildTestBank(3);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    // Slot 0 + 1 unverändert (rawRiff passthrough), Slot 2 wird editiert.
    slots = patchOpenedSlot(slots, slots[2].rowId, { name: "Edited" });
    const out = openedSlotsToBuildInputs(slots);
    expect(out.inputs).toHaveLength(3);
    expect(out.passthroughCount).toBe(2);
    expect(out.dirtyCount).toBe(1);
    expect(out.droppedCount).toBe(0);
  });

  it("empty Slots werden gedroppt (kein input → offset=0 im File)", () => {
    const baseline = buildTestBank(2);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    const out = openedSlotsToBuildInputs(slots);
    expect(out.inputs).toHaveLength(2);
  });

  it("Save mit preserveRawRiff=true: unedited Slots passthrough, edited re-encoded", () => {
    const baseline = buildTestBank(3);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    slots = patchOpenedSlot(slots, slots[1].rowId, { name: "Edit1" });
    const out = openedSlotsToBuildInputs(slots);
    const rebuilt = buildE2sBank(out.inputs, { preserveRawRiff: true });
    // Re-parse and verify.
    const reparsed = parseE2sBank(rebuilt.buffer);
    expect(reparsed.slots[0]?.name).toBe("Slot0"); // passthrough → unchanged
    expect(reparsed.slots[1]?.name).toBe("Edit1"); // re-encoded
    expect(reparsed.slots[2]?.name).toBe("Slot2"); // passthrough → unchanged
  });

  it("Bit-exact Round-Trip ohne Edits — File-Hash identisch zur Baseline", () => {
    function fnv1a(buf: Uint8Array): number {
      let h = 0x811c9dc5;
      for (let i = 0; i < buf.length; i++) {
        h ^= buf[i];
        h = (h * 0x01000193) >>> 0;
      }
      return h >>> 0;
    }
    const baseline = buildTestBank(2);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    const out = openedSlotsToBuildInputs(slots);
    const rebuilt = buildE2sBank(out.inputs, { preserveRawRiff: true });
    const baseHash = fnv1a(new Uint8Array(baseline.buffer));
    const rebuiltHash = fnv1a(new Uint8Array(rebuilt.buffer));
    expect(rebuiltHash).toBe(baseHash);
  });
});

// ─── Mode-Switch / hasUnsavedChanges helpers ──────────────────────────────────

describe("bankEditorState — Display Helpers", () => {
  it("displayName + displayCategory liefern lesbare Strings", () => {
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    const slots = bankToOpenedSlots(bank);
    expect(displayName(slots[0])).toBe("Slot0");
    expect(displayCategory(slots[0])).toMatch(/^[A-Za-z. ]+$/);
    expect(displayName(slots[200])).toBe("—Empty—");
    expect(displayCategory(slots[200])).toBe("");
  });

  it("hasUnsavedChanges flippt nach erster Edit auf true", () => {
    const baseline = buildTestBank(2);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    expect(hasUnsavedChanges(slots)).toBe(false);
    slots = patchOpenedSlot(slots, slots[0].rowId, { name: "Mod" });
    expect(hasUnsavedChanges(slots)).toBe(true);
  });
});

// ─── Mode-Wechsel-Schutz: Hinweis für UI-Caller ───────────────────────────────

describe("bankEditorState — Edit-Detection-Gate für UI", () => {
  it("Mode-Wechsel-Schutz: hasUnsavedChanges wahr nach Patch", () => {
    // Dieser Test dokumentiert dass der UI-Layer (KorgBankEditor.tryChangeMode)
    // korrekt erkennen kann ob ein Confirm-Prompt nötig ist. Der Store-Layer
    // verschluckt NIE silent Änderungen — der UI-Code muss explizit confirm()
    // aufrufen und der User entscheidet.
    const baseline = buildTestBank(1);
    const bank = parseE2sBank(baseline.buffer, "<t>", {
      preserveRawRiff: true,
    });
    let slots = bankToOpenedSlots(bank);
    expect(hasUnsavedChanges(slots)).toBe(false);
    slots = patchOpenedSlot(slots, slots[0].rowId, { sampleTune: 5 });
    expect(hasUnsavedChanges(slots)).toBe(true);
    // Wenn der User confirm() bestätigt, leert der Caller einfach openedSlots[].
    // Wenn nicht: slots[] bleibt unverändert mit isDirty:true. Der Test
    // verifiziert dass es keinen "silent reset" gibt.
    expect(slots[0].isDirty).toBe(true);
  });
});

// ─── Loop-Punkt-Editing (v3.284, Oe2sSLE) ─────────────────────────────────────
describe("loop-point edit round-trip (OpenedSlot pipeline)", () => {
  it("liest Loop-Punkte, editiert sie und baut sie bit-genau zurück", () => {
    const frameBytes = 2; // mono 16-bit
    const startFrame = 4;
    const endFrame = 30;
    // 1) Bank mit definierten Loop-Punkten bauen.
    const built = buildE2sBank([
      {
        slotIndex: 0,
        name: "Loopy",
        pcmData: sineFloat(64),
        sampleRate: 44100,
        channels: 1 as const,
        loopType: LOOP_TYPE_FORWARD,
        loopStartBytes: startFrame * frameBytes,
        loopEndBytes: (endFrame + 1) * frameBytes,
      },
    ]);
    // 2) Laden → OpenedSlot: Loop-Punkte müssen ankommen (kein Verlust).
    const bank = parseE2sBank(built.buffer);
    const slots = bankToOpenedSlots(bank);
    const row = slots.find(s => !s.empty)!;
    expect(row.loopStart).toBe(startFrame);
    expect(row.loopEnd).toBe(endFrame);

    // 3) Loop-Ende editieren → build → parse: neuer Wert überlebt.
    const edited = patchOpenedSlot(slots, row.rowId, { loopEnd: 20 });
    expect(edited.find(s => s.rowId === row.rowId)!.isDirty).toBe(true);
    const { inputs } = openedSlotsToBuildInputs(edited);
    const rebuilt = parseE2sBank(buildE2sBank(inputs).buffer);
    const back = rebuilt.slots.find(s => s && s.name === "Loopy")!;
    expect(back.loopStart).toBe(startFrame);
    expect(back.loopEnd).toBe(20);
  });
});
