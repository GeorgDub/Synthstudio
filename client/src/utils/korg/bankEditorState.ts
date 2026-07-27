/**
 * Synthstudio – KorgBankEditor State Helpers (v3.7.0)
 *
 * Pure helpers for the KorgBankEditor's Open-Bank-Flow. Extracted so the
 * logic is testable without React/DOM (siehe tests/features/korg-bank-editor.test.ts).
 *
 * Responsibilities:
 *   - Map a parsed E2sBank → Editor's internal slot-list (mode='edit')
 *   - Mark slots dirty when ANY editable field changes
 *   - Convert dirty/clean slots back to E2sSlotInput[] for buildE2sBank()
 *
 * The component-side `EditorSlot` (mode='new', from useProjectStore.samples)
 * remains unchanged in `KorgBankEditor.tsx`. The two slot-models share a few
 * fields but their lifecycles are distinct: `new` slots always come out of
 * the picker (always dirty), `edit` slots may pass-through rawRiff verbatim.
 */

import type { E2sBank, E2sSlice, E2sSlot } from "./e2sBankReader";
import type { E2sSlotInput } from "./e2sBankBuilder";
import {
  E2S_CATEGORY_NAMES,
  E2S_MAX_SLOTS,
  LOOP_TYPE_FORWARD,
  LOOP_TYPE_ONESHOT,
} from "./constants";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * v3.7.0 — One row in the Edit-Existing-Bank slot-browser. Mirrors
 * `E2sSlot` but tracks per-row `isDirty` + edit-state, and may also
 * be `empty: true` (slot index unused in the source bank).
 */
export interface OpenedSlot {
  /** Stable React key. */
  rowId: string;
  /** Slot-Index 0..1019 (== OSC_0index) in der on-disk Offset-Tabelle. */
  slotIndex: number;
  /** Slot is empty in the source bank (offset=0). UI shows "Empty" placeholder. */
  empty: boolean;

  // — Filled-Slot fields (only meaningful when empty===false) —
  name: string;
  category: number;
  /** True = oneshot (loopType=1), false = forward-loop (loopType=2). */
  oneshot: boolean;
  /** +12dB Gain flag. */
  gain12db: boolean;
  /** OSC_SampleTune (esli +0x55, i8): Coarse-Tune, Oe2sSLE-Range -63..+63. */
  sampleTune: number;
  /** playVolume-Level 0..127 (esli +0x2c, u16 normalisiert). */
  level: number;
  /** Loop-Start in Frames (esli +0x34, relativ zu StartPoint). Nur bei
   *  Forward-Loop (oneshot=false) relevant. */
  loopStart: number;
  /** Loop-/Sample-Ende in Frames (esli +0x38, letzter Frame inklusive). */
  loopEnd: number;

  // — PCM + audio fields —
  pcmData?: Float32Array;
  sampleRate?: number;
  channels?: 1 | 2;
  frames?: number;

  // — Bit-exact passthrough —
  /** Raw RIFF chunk bytes from the parser; bit-exact passthrough source. */
  rawRiff?: Uint8Array;

  /**
   * v3.8.0 — ESLI-Slices (max 64). Leeres Array = keine Slices definiert,
   * E2S spielt das Sample als Single-Shot. Edits hier setzen isDirty=true.
   */
  slices: E2sSlice[];

  // — Edit tracking —
  /** True = any field edited since load OR sample replaced; forces re-encode at save. */
  isDirty: boolean;

  // — Original snapshot (für Revert) —
  /** Snapshot of fields at load-time. `null` for empty slots. */
  original: OpenedSlotSnapshot | null;
}

/** Minimal snapshot kept for `revertSlot()`. */
export interface OpenedSlotSnapshot {
  name: string;
  category: number;
  oneshot: boolean;
  gain12db: boolean;
  sampleTune: number;
  level: number;
  loopStart: number;
  loopEnd: number;
  pcmData: Float32Array;
  sampleRate: number;
  channels: 1 | 2;
  frames: number;
  rawRiff?: Uint8Array;
  /** v3.8.0 — Snapshot der Slices für Revert. */
  slices: E2sSlice[];
}

// ─── Bank → OpenedSlot[] ──────────────────────────────────────────────────────

/**
 * Convert a parsed E2sBank into the editor slot-list (E2S_MAX_SLOTS rows).
 *
 * Every position 0..E2S_MAX_SLOTS-1 is represented — empty slots get
 * `empty: true` placeholders. All loaded slots start with `isDirty: false`.
 *
 * @param bank Result von `parseE2sBank(buf, src, { preserveRawRiff: true })`.
 *             Wenn `bank.slots[i].rawRiff` undefined ist, kann der Slot bei
 *             Save NICHT bit-exakt durchgereicht werden — Builder muss
 *             re-encoden. Das ist v3.6-conform.
 * @param keyPrefix Optional prefix für `rowId` (default `slot`).
 */
export function bankToOpenedSlots(
  bank: E2sBank,
  keyPrefix = "slot"
): OpenedSlot[] {
  const out: OpenedSlot[] = [];
  for (let i = 0; i < E2S_MAX_SLOTS; i++) {
    const src: E2sSlot | null = bank.slots[i] ?? null;
    if (src === null) {
      out.push({
        rowId: `${keyPrefix}-${i}`,
        slotIndex: i,
        empty: true,
        name: "",
        category: 0,
        oneshot: true,
        gain12db: false,
        sampleTune: 0,
        level: 127,
        loopStart: 0,
        loopEnd: 0,
        slices: [],
        isDirty: false,
        original: null,
      });
      continue;
    }
    // Defensive: kopiere Slices in eigene Objekte (Builder mutiert sie nicht,
    // aber wir wollen Snapshot-Isolation für Revert garantieren).
    const slicesCopy: E2sSlice[] = src.slices.map(s => ({
      start: s.start,
      length: s.length,
      attackLength: s.attackLength,
      amplitude: s.amplitude,
    }));
    const snapshot: OpenedSlotSnapshot = {
      name: src.name,
      category: src.category,
      oneshot: src.loopType === LOOP_TYPE_ONESHOT,
      gain12db: src.gain12db,
      sampleTune: src.sampleTune ?? 0, // v3.284: Reader dekodiert +0x55 i8
      level: src.level ?? 127, // v3.284: playVolume-Level durchreichen
      loopStart: src.loopStart ?? 0, // v3.284: Loop-Punkte durchreichen
      loopEnd: src.loopEnd ?? 0,
      pcmData: src.pcmData,
      sampleRate: src.sampleRate,
      channels: src.channels,
      frames: src.frames,
      rawRiff: src.rawRiff,
      slices: slicesCopy.map(s => ({ ...s })),
    };
    out.push({
      rowId: `${keyPrefix}-${i}`,
      slotIndex: i,
      empty: false,
      name: src.name,
      category: src.category,
      oneshot: src.loopType === LOOP_TYPE_ONESHOT,
      gain12db: src.gain12db,
      sampleTune: src.sampleTune ?? 0,
      level: src.level ?? 127,
      loopStart: src.loopStart ?? 0,
      loopEnd: src.loopEnd ?? 0,
      pcmData: src.pcmData,
      sampleRate: src.sampleRate,
      channels: src.channels,
      frames: src.frames,
      rawRiff: src.rawRiff,
      slices: slicesCopy,
      isDirty: false,
      original: snapshot,
    });
  }
  return out;
}

// ─── Edit Operations ──────────────────────────────────────────────────────────

/**
 * Apply a patch to one slot in the list. Sets `isDirty: true` automatically
 * if any user-editable field changes. Returns a NEW array (immutable update).
 *
 * Editable fields (any of these → isDirty:
 *   name, category, oneshot, gain12db, sampleTune, pcmData/sampleRate/channels.
 *
 * `slotIndex`, `rowId`, `empty`, `original`, `isDirty`, `rawRiff` are
 * structural — patching them does NOT auto-flip isDirty.
 */
export function patchOpenedSlot(
  slots: OpenedSlot[],
  rowId: string,
  patch: Partial<OpenedSlot>
): OpenedSlot[] {
  return slots.map(s => {
    if (s.rowId !== rowId) return s;
    const editableTouched =
      (patch.name !== undefined && patch.name !== s.name) ||
      (patch.category !== undefined && patch.category !== s.category) ||
      (patch.oneshot !== undefined && patch.oneshot !== s.oneshot) ||
      (patch.gain12db !== undefined && patch.gain12db !== s.gain12db) ||
      (patch.sampleTune !== undefined && patch.sampleTune !== s.sampleTune) ||
      (patch.level !== undefined && patch.level !== s.level) ||
      (patch.loopStart !== undefined && patch.loopStart !== s.loopStart) ||
      (patch.loopEnd !== undefined && patch.loopEnd !== s.loopEnd) ||
      patch.pcmData !== undefined ||
      patch.sampleRate !== undefined ||
      patch.channels !== undefined ||
      patch.slices !== undefined;
    return {
      ...s,
      ...patch,
      isDirty: editableTouched ? true : (patch.isDirty ?? s.isDirty),
    };
  });
}

/**
 * v3.8.0 — Convenience-Helper: setze nur die Slices eines Slots. Flippt
 * `isDirty=true` (auch wenn die Liste leer wird — Delete-All ist eine Edit).
 */
export function setSlotSlices(
  slots: OpenedSlot[],
  rowId: string,
  slices: E2sSlice[]
): OpenedSlot[] {
  return slots.map(s =>
    s.rowId === rowId
      ? { ...s, slices: slices.map(sl => ({ ...sl })), isDirty: true }
      : s
  );
}

/**
 * Replace the PCM payload of a slot. Always sets `isDirty: true`.
 * Caller must supply matching `sampleRate` and `channels`. `frames` is
 * recomputed from `pcmData.length / channels`.
 */
export function replaceSlotSample(
  slots: OpenedSlot[],
  rowId: string,
  pcmData: Float32Array,
  sampleRate: number,
  channels: 1 | 2
): OpenedSlot[] {
  const frames = Math.floor(pcmData.length / channels);
  return slots.map(s =>
    s.rowId === rowId
      ? {
          ...s,
          empty: false,
          pcmData,
          sampleRate,
          channels,
          frames,
          // v3.8.0 — Slices beziehen sich auf das alte PCM. Bei Sample-Replace
          // werden sie zurückgesetzt — der User kann anschließend Auto-Slice
          // oder manuelle Marker setzen.
          slices: [],
          isDirty: true,
        }
      : s
  );
}

/**
 * Mark a slot as deleted: empty=true + isDirty=true. The original snapshot
 * is preserved so revert can restore it.
 *
 * Note: in the on-disk output, this slot's offset-table entry will be 0
 * (no RIFF written). The original `rawRiff` is DROPPED from the export.
 * This is the trade-off documented in the README caveat.
 */
export function deleteSlot(slots: OpenedSlot[], rowId: string): OpenedSlot[] {
  return slots.map(s =>
    s.rowId === rowId
      ? {
          ...s,
          empty: true,
          // Reset display-fields but KEEP `original` for revert.
          name: "",
          category: 0,
          oneshot: true,
          gain12db: false,
          sampleTune: 0,
          level: 127,
          loopStart: 0,
          loopEnd: 0,
          pcmData: undefined,
          sampleRate: undefined,
          channels: undefined,
          frames: undefined,
          rawRiff: undefined,
          slices: [],
          isDirty: true,
        }
      : s
  );
}

/**
 * Revert a slot to its original (load-time) state. Sets isDirty:false.
 * No-op if the slot has no original (it was empty when loaded).
 */
export function revertSlot(slots: OpenedSlot[], rowId: string): OpenedSlot[] {
  return slots.map(s => {
    if (s.rowId !== rowId) return s;
    const o = s.original;
    if (!o) {
      // Originally empty — revert means "make empty again".
      return {
        ...s,
        empty: true,
        name: "",
        category: 0,
        oneshot: true,
        gain12db: false,
        sampleTune: 0,
        level: 127,
        loopStart: 0,
        loopEnd: 0,
        pcmData: undefined,
        sampleRate: undefined,
        channels: undefined,
        frames: undefined,
        rawRiff: undefined,
        slices: [],
        isDirty: false,
      };
    }
    return {
      ...s,
      empty: false,
      name: o.name,
      category: o.category,
      oneshot: o.oneshot,
      gain12db: o.gain12db,
      sampleTune: o.sampleTune,
      level: o.level,
      loopStart: o.loopStart,
      loopEnd: o.loopEnd,
      pcmData: o.pcmData,
      sampleRate: o.sampleRate,
      channels: o.channels,
      frames: o.frames,
      rawRiff: o.rawRiff,
      slices: o.slices.map(sl => ({ ...sl })),
      isDirty: false,
    };
  });
}

// ─── Move / Swap slot numbers (v3.284, Oe2sSLE „Move/Exchange/#Num") ──────────

/** Die inhaltlichen Felder eines Slots (alles außer Position/rowId/original). */
interface SlotContent {
  empty: boolean;
  name: string;
  category: number;
  oneshot: boolean;
  gain12db: boolean;
  sampleTune: number;
  level: number;
  loopStart: number;
  loopEnd: number;
  pcmData?: Float32Array;
  sampleRate?: number;
  channels?: 1 | 2;
  frames?: number;
  slices: E2sSlice[];
}

function extractSlotContent(s: OpenedSlot): SlotContent {
  return {
    empty: s.empty,
    name: s.name,
    category: s.category,
    oneshot: s.oneshot,
    gain12db: s.gain12db,
    sampleTune: s.sampleTune,
    level: s.level,
    loopStart: s.loopStart,
    loopEnd: s.loopEnd,
    pcmData: s.pcmData,
    sampleRate: s.sampleRate,
    channels: s.channels,
    frames: s.frames,
    slices: s.slices.map(sl => ({ ...sl })),
  };
}

/**
 * Wendet fremden Inhalt auf einen Slot an. Position (slotIndex/rowId/original)
 * bleibt; `rawRiff` wird gelöscht + `isDirty=true` gesetzt, weil sich die
 * Slot-/Geräte-Nummer (== slotIndex) ändert und die esli neu geschrieben werden
 * MUSS (der Builder schreibt OSC_0index = slotIndex).
 */
function withSlotContent(row: OpenedSlot, c: SlotContent): OpenedSlot {
  return {
    ...row,
    empty: c.empty,
    name: c.name,
    category: c.category,
    oneshot: c.oneshot,
    gain12db: c.gain12db,
    sampleTune: c.sampleTune,
    level: c.level,
    loopStart: c.loopStart,
    loopEnd: c.loopEnd,
    pcmData: c.pcmData,
    sampleRate: c.sampleRate,
    channels: c.channels,
    frames: c.frames,
    rawRiff: undefined,
    slices: c.slices.map(sl => ({ ...sl })),
    isDirty: true,
  };
}

/**
 * Oe2sSLE „Move / Exchange / #Num ändern": verschiebt/tauscht den Inhalt eines
 * Slots auf eine andere Slot-Nummer (== OSC_0index nach der Offset-Tabellen-
 * Angleichung). Ziel frei → Verschieben (Quelle wird leer); Ziel belegt →
 * Tauschen. Positionen (slotIndex) bleiben; nur der Inhalt wandert. Beide
 * betroffenen Rows werden isDirty=true (Re-Encode mit neuer Nummer).
 *
 * No-op (gleiche Referenz) bei: unbekannter rowId, Ziel out-of-range, Ziel ==
 * Quelle, oder beide leer.
 *
 * @param slots      Aktuelle Slot-Liste.
 * @param fromRowId  Quell-Row.
 * @param toIndex    Ziel-Slot-Index (== gewünschte OSC_0index).
 */
export function moveOrSwapSlot(
  slots: OpenedSlot[],
  fromRowId: string,
  toIndex: number
): OpenedSlot[] {
  const from = slots.find(s => s.rowId === fromRowId);
  if (!from) return slots;
  if (
    !Number.isInteger(toIndex) ||
    toIndex < 0 ||
    toIndex >= E2S_MAX_SLOTS ||
    toIndex === from.slotIndex
  ) {
    return slots;
  }
  const to = slots.find(s => s.slotIndex === toIndex);
  if (!to) return slots;
  if (from.empty && to.empty) return slots;

  const contentFrom = extractSlotContent(from);
  const contentTo = extractSlotContent(to);
  return slots.map(s => {
    if (s.rowId === from.rowId) return withSlotContent(s, contentTo);
    if (s.rowId === to.rowId) return withSlotContent(s, contentFrom);
    return s;
  });
}

// ─── Merge-Import einer zweiten .all-Bank (v3.284, Oe2sSLE „Import all") ───────

/** E2sSlot (Reader-Output) → SlotContent (Editor-Inhalt). */
function e2sSlotToContent(src: E2sSlot): SlotContent {
  return {
    empty: false,
    name: src.name,
    category: src.category,
    oneshot: src.loopType === LOOP_TYPE_ONESHOT,
    gain12db: src.gain12db,
    sampleTune: src.sampleTune ?? 0,
    level: src.level ?? 127,
    loopStart: src.loopStart ?? 0,
    loopEnd: src.loopEnd ?? 0,
    pcmData: src.pcmData,
    sampleRate: src.sampleRate,
    channels: src.channels,
    frames: src.frames,
    slices: src.slices.map(sl => ({ ...sl })),
  };
}

export interface E2sMergeResult {
  slots: OpenedSlot[];
  /** Wie viele importierte Samples platziert wurden. */
  merged: number;
  /** Wie viele mangels freier Slots übersprungen wurden. */
  skipped: number;
}

/**
 * Oe2sSLE „Import e2sSample.all": mergt die Samples einer ZWEITEN geparsten Bank
 * in die aktuelle Editor-Slot-Liste. Belegte Slots der Quelle wandern der Reihe
 * nach in die nächsten FREIEN Slot-Nummern ab `fromNumber` (renumbering).
 * Positionen bleiben; jeder befüllte Ziel-Slot wird isDirty=true (Re-Encode mit
 * der neuen Nummer). Reichen die freien Slots nicht, wird der Rest übersprungen.
 *
 * @param slots         Aktuelle Editor-Slots.
 * @param importedSlots `parseE2sBank(otherFile).slots`.
 * @param fromNumber    Start-Slot-Nummer für die Zuweisung (default 501).
 */
export function mergeE2sBankIntoOpenedSlots(
  slots: OpenedSlot[],
  importedSlots: ReadonlyArray<E2sSlot | null>,
  fromNumber = 501
): E2sMergeResult {
  const start = Math.max(
    0,
    Math.min(E2S_MAX_SLOTS - 1, Math.floor(fromNumber))
  );
  const freeQueue = slots
    .filter(s => s.empty && s.slotIndex >= start)
    .map(s => s.slotIndex)
    .sort((a, b) => a - b);

  const sources = importedSlots.filter(
    (s): s is E2sSlot => s != null && !!s.pcmData && s.pcmData.length > 0
  );

  const assignments = new Map<number, E2sSlot>();
  let merged = 0;
  let skipped = 0;
  for (const src of sources) {
    const target = freeQueue.shift();
    if (target === undefined) {
      skipped++;
      continue;
    }
    assignments.set(target, src);
    merged++;
  }
  if (merged === 0) return { slots, merged: 0, skipped };

  const next = slots.map(row => {
    const src = assignments.get(row.slotIndex);
    return src ? withSlotContent(row, e2sSlotToContent(src)) : row;
  });
  return { slots: next, merged, skipped };
}

// ─── Save: OpenedSlot[] → E2sSlotInput[] ──────────────────────────────────────

/**
 * Convert the editor's slot-list to `E2sSlotInput[]` ready for
 * `buildE2sBank(inputs, { preserveRawRiff: true })`.
 *
 * Rules:
 *   - `empty: true` slots are dropped (no entry in inputs → offset=0).
 *   - Non-empty + isDirty=false + rawRiff → passes through bit-exact.
 *   - Non-empty + isDirty=true → re-encoded by builder (rawRiff still
 *     supplied but ignored due to isDirty).
 *   - PCM-less filled slots are dropped with a warning indicator (this
 *     would be a corrupt load anyway and shouldn't happen).
 *
 * @returns `inputs` ready for builder + counts for UI-Toast.
 */
export interface OpenedSlotBuildResult {
  inputs: E2sSlotInput[];
  dirtyCount: number;
  passthroughCount: number;
  droppedCount: number;
}

export function openedSlotsToBuildInputs(
  slots: OpenedSlot[]
): OpenedSlotBuildResult {
  const inputs: E2sSlotInput[] = [];
  let dirtyCount = 0;
  let passthroughCount = 0;
  let droppedCount = 0;
  for (const s of slots) {
    if (s.empty) continue;
    if (!s.pcmData || !s.sampleRate || !s.channels) {
      // Filled but missing audio — drop defensively.
      droppedCount++;
      continue;
    }
    // Loop-Punkte (Frames) → Bytes für den Builder. Konvention (round-trip-
    // getestet, siehe e2s-sample-tune.test): loopStartBytes = startFrame*fB,
    // loopEndBytes = (endFrame+1)*fB, weil der Builder End = loopEndBytes - fB
    // schreibt (Oe2sSLE: End = letzter Frame). fB = frameBytes = channels*2.
    const frameBytes = (s.channels === 2 ? 2 : 1) * 2;
    const hasLoopPoints = s.loopEnd > 0;
    const input: E2sSlotInput = {
      slotIndex: s.slotIndex,
      name: s.name,
      category: s.category,
      pcmData: s.pcmData,
      sampleRate: s.sampleRate,
      channels: s.channels,
      loopType: s.oneshot ? LOOP_TYPE_ONESHOT : LOOP_TYPE_FORWARD,
      gain12db: s.gain12db,
      sampleTune: s.sampleTune,
      level: s.level,
      loopStartBytes: hasLoopPoints
        ? Math.max(0, Math.floor(s.loopStart)) * frameBytes
        : undefined,
      loopEndBytes: hasLoopPoints
        ? (Math.floor(s.loopEnd) + 1) * frameBytes
        : undefined,
      // v3.8.0 — Slices propagieren. Builder ignoriert sie für passthrough-Slots
      // (rawRiff bit-exact), aber bei dirty/re-encode werden sie korrekt
      // serialisiert (siehe e2sBankBuilder.ts:548).
      slices: s.slices.length > 0 ? s.slices.map(sl => ({ ...sl })) : undefined,
      rawRiff: s.rawRiff,
      isDirty: s.isDirty,
    };
    inputs.push(input);
    if (s.isDirty) dirtyCount++;
    else if (s.rawRiff) passthroughCount++;
    else dirtyCount++; // no rawRiff → counts as re-encoded
  }
  return { inputs, dirtyCount, passthroughCount, droppedCount };
}

// ─── Tiny utility — slot-summary für UI Filter / Tests ────────────────────────

export function countFilledSlots(slots: OpenedSlot[]): number {
  let n = 0;
  for (const s of slots) if (!s.empty) n++;
  return n;
}

export function countDirtySlots(slots: OpenedSlot[]): number {
  let n = 0;
  for (const s of slots) if (s.isDirty) n++;
  return n;
}

export function hasUnsavedChanges(slots: OpenedSlot[]): boolean {
  return slots.some(s => s.isDirty);
}

/** UI-Helfer: name (oder fallback) für Slot-Browser. */
export function displayName(s: OpenedSlot): string {
  if (s.empty) return "—Empty—";
  return s.name || "(unnamed)";
}

/** UI-Helfer: category-Name. */
export function displayCategory(s: OpenedSlot): string {
  if (s.empty) return "";
  return E2S_CATEGORY_NAMES[s.category] ?? "User";
}

/**
 * v3.286 — Filter für den Slot-Browser.
 *
 * Wurde nötig, als die Offset-Tabelle auf ihre volle Länge korrigiert wurde:
 * eine Hacktribe-Bank hat ihre User-Samples ab Index 501, davor stehen
 * hunderte leere Slots. Ohne Filter müsste man die durchscrollen.
 *
 * Reihenfolge bleibt die Slot-Reihenfolge — es wird nur weggelassen, nie
 * umsortiert. `hideEmpty` wirkt nicht auf geänderte Slots: was man gerade
 * bearbeitet hat, darf nicht unter dem Cursor verschwinden.
 *
 * Suche trifft den Index (`5`, `005`, `#5`) oder den Namen (case-insensitive).
 */
export function filterOpenedSlots(
  slots: ReadonlyArray<OpenedSlot>,
  query: string,
  hideEmpty: boolean,
): OpenedSlot[] {
  const q = (query ?? "").trim().toLowerCase().replace(/^#/, "");
  return slots.filter((s) => {
    if (hideEmpty && s.empty && !s.isDirty) return false;
    if (q.length === 0) return true;
    const idxStr = String(s.slotIndex);
    if (idxStr === q || idxStr.padStart(3, "0") === q) return true;
    return s.name.toLowerCase().includes(q);
  });
}
