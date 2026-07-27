/**
 * Synthstudio – ESX-1 Bank Pattern + Sample Editor State (v3.29.0, v3.31.0, v3.32.0)
 *
 * Pure-TypeScript model for the **ESX Edit-Modes** in `KorgBankEditor.tsx`.
 * Wraps a loaded `.esx`-bank (~24-28 MB ArrayBuffer) plus:
 *   - 256 pattern-slot overview rows
 *   - 256 mono-sample + 128 stereo-sample slot overview rows (v3.31/v3.32)
 *   - Map of staged pattern-replacements
 *   - Map of staged sample-replacements (v3.31 mono / v3.32 stereo)
 *
 * Workflow Patterns:
 *   1. parseEsxBank(buffer) → 0..N patterns
 *   2. buildEsxSlotOverview(bank) → 256 rows
 *   3. stageEsxPatch(map, index, block) → next map
 *   4. unstageEsxPatch(map, index) → next map
 *   5. commitEsxPatches(bankBuffer, map) → new ArrayBuffer
 *
 * Workflow Samples (v3.31 mono):
 *   1. parseEsxBank(buffer) → bank.monoSamples
 *   2. buildEsxSampleSlotOverview(bank) → 256 mono rows
 *   3. stageEsxSamplePatch(map, slot, sampleData) → next map
 *   4. unstageEsxSamplePatch(map, slot) → next map
 *   5. commitEsxSamplePatches(bankBuffer, map) → new ArrayBuffer
 *   6. commitEsxPatchesAll(bankBuffer, patternMap, sampleMap) → applies BOTTH,
 *      patterns first (slot-replace), samples after (append + header-update)
 *
 * Workflow Samples (v3.32 stereo):
 *   Identical API but `buildEsxStereoSampleSlotOverview(bank)` returns 128
 *   stereo rows. The sample patcher (`patchEsxBankSample`) already handles
 *   `channels: 2` (PCM split L+R contiguous). `commitEsxSamplePatches`
 *   transparently routes mono+stereo entries via their `channels` field, so
 *   one staged map can mix slot 0 mono + slot 0 stereo without collision —
 *   they patch separate header tables.
 *
 * KEINE Electron-/DOM-/AudioEngine-Dependencies. Reine Daten-Operationen.
 */

import type { EsxBank, EsxPattern, EsxSample } from "./esxParser";
import { patchEsxBankPatterns, type EsxBankPatch } from "./esxBankPatcher";
import {
  patchEsxBankSample,
  renameEsxBankSamples,
  type EsxSamplePatchInput,
  type EsxSampleRename,
} from "./esxSamplePatcher";

export type { EsxSampleRename } from "./esxSamplePatcher";

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Overview row for one of the 256 pattern-slots in a loaded ESX-1 bank.
 * Empty slots get an `empty: true` marker; the parser skips empty slots so
 * we synthesize placeholders for them.
 */
export interface EsxSlotRow {
  /** 0..255 — pattern-slot index inside the bank. */
  index: number;
  /** True when the slot was empty in the loaded bank (= no pattern present). */
  empty: boolean;
  /** Pattern name (ASCII, trimmed). For empty slots: "". */
  name: string;
  /** Pattern BPM. For empty slots: 0. */
  bpm: number;
  /** Pattern step-length (typically 16). For empty slots: 0. */
  stepLength: number;
}

/** Bank-level editor state (mutable, but small — just metadata + patch map). */
export interface EsxEditorState {
  /** Source filename of the loaded bank (for UI display + filename default). */
  sourceName: string;
  /** Snapshot byteLength of the loaded bank — preserved across patches. */
  byteLength: number;
  /** 256 overview rows in slot-index order. */
  rows: EsxSlotRow[];
  /**
   * Staged slot replacements: slot-index → 4280-byte pattern block. A second
   * patch on the same slot replaces the earlier staged block.
   */
  pendingPatches: Map<number, ArrayBuffer>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when a pattern's name matches the well-known "Init Pattern"
 * placeholder used by the ESX-1 OS for fresh / unedited slots. The compare is
 * case-insensitive and whitespace-trimmed because some 3rd-party tools store
 * `INIT PATTERN`, `Init Pattern`, or `init pat` etc.
 */
export function isInitPatternName(name: string): boolean {
  if (typeof name !== "string") return false;
  const lower = name.trim().toLowerCase();
  return lower === "init pattern" || lower === "init pat" || lower === "init";
}

/**
 * Build the 256-row overview list from a parsed bank. The parser returns a
 * compact array (empty slots skipped), so we expand it back into a dense
 * 256-row array for the UI.
 *
 * @param bank Parsed bank
 * @param totalSlots Number of slots (default 256 — ESX1_NUM_PATTERNS)
 */
export function buildEsxSlotOverview(
  bank: EsxBank,
  totalSlots = 256
): EsxSlotRow[] {
  const byIndex = new Map<number, EsxPattern>();
  for (const p of bank.patterns) {
    if (typeof p.index === "number") byIndex.set(p.index, p);
  }
  const rows: EsxSlotRow[] = new Array(totalSlots);
  for (let i = 0; i < totalSlots; i++) {
    const p = byIndex.get(i);
    if (!p) {
      rows[i] = {
        index: i,
        empty: true,
        name: "",
        bpm: 0,
        stepLength: 0,
      };
    } else {
      rows[i] = {
        index: i,
        empty: false,
        name: p.name ?? "",
        bpm: p.bpm,
        stepLength: p.lengthSteps,
      };
    }
  }
  return rows;
}

/**
 * Stage a slot-replacement. If `index` already has a staged patch, the new
 * block replaces it (last-write-wins).
 *
 * Returns the next pendingPatches map (not mutated in-place — caller decides
 * to set a new state object).
 */
export function stageEsxPatch(
  pending: Map<number, ArrayBuffer>,
  index: number,
  block: ArrayBuffer
): Map<number, ArrayBuffer> {
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 256
  ) {
    throw new Error(`stageEsxPatch: invalid slot index ${index}`);
  }
  if (!(block instanceof ArrayBuffer) || block.byteLength !== 4280) {
    throw new Error(
      `stageEsxPatch: block must be ArrayBuffer of exactly 4280 bytes (got ${
        block instanceof ArrayBuffer ? `${block.byteLength}B` : typeof block
      })`
    );
  }
  const next = new Map(pending);
  next.set(index, block);
  return next;
}

/** Remove a staged patch. Returns a new map. */
export function unstageEsxPatch(
  pending: Map<number, ArrayBuffer>,
  index: number
): Map<number, ArrayBuffer> {
  if (!pending.has(index)) return pending;
  const next = new Map(pending);
  next.delete(index);
  return next;
}

/** Apply all staged patches to the loaded bank-buffer, producing a new buffer. */
export function commitEsxPatches(
  bankBuffer: ArrayBuffer | Uint8Array,
  pending: Map<number, ArrayBuffer>
): ArrayBuffer {
  const patches: EsxBankPatch[] = [];
  // Sort by index for deterministic write order (also helps tests).
  const indices = Array.from(pending.keys()).sort((a, b) => a - b);
  for (const idx of indices) {
    const data = pending.get(idx);
    if (data) patches.push({ index: idx, data });
  }
  return patchEsxBankPatterns(bankBuffer, patches);
}

/** Returns true when at least one slot replacement is staged. */
export function hasPendingEsxPatches(
  pending: Map<number, ArrayBuffer>
): boolean {
  return pending.size > 0;
}

/** Count of staged slot replacements. */
export function countPendingEsxPatches(
  pending: Map<number, ArrayBuffer>
): number {
  return pending.size;
}

/**
 * Apply a search/filter to the overview rows.
 *
 * @param rows full list
 * @param query case-insensitive substring of name (or "<index>" prefix)
 * @param hideInit if true, suppress slots whose pattern matches `isInitPatternName`
 * @param hideEmpty if true, suppress empty (= no pattern present) slots
 */
export function filterEsxRows(
  rows: ReadonlyArray<EsxSlotRow>,
  query: string,
  hideInit: boolean,
  hideEmpty: boolean
): EsxSlotRow[] {
  const q = (query ?? "").trim().toLowerCase();
  return rows.filter(r => {
    if (hideEmpty && r.empty) return false;
    if (hideInit && !r.empty && isInitPatternName(r.name)) return false;
    if (q.length === 0) return true;
    // Match against index (#5, 005, 5) or name.
    const idxStr = String(r.index);
    if (idxStr === q || idxStr.padStart(3, "0") === q) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// v3.31.0 — Sample-Tab State
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Overview row for one of the 256 mono sample-slots in a loaded ESX-1 bank.
 * Empty slots get an `empty: true` marker. Length is stored in PCM frames.
 */
export interface EsxSampleSlotRow {
  /** 0..255 — mono slot-index inside the bank. */
  index: number;
  /** True when the slot was empty in the loaded bank. */
  empty: boolean;
  /** Sample name (ASCII, trimmed). For empty slots: "". */
  name: string;
  /** Channels: 1 = mono, 2 = stereo. v3.31 fokussiert auf mono → immer 1. */
  channels: 1 | 2;
  /** Sample-Rate in Hz. For empty slots: 0. */
  sampleRate: number;
  /** Anzahl PCM-Frames pro Channel. For empty slots: 0. */
  frames: number;
  /** Geräte-Lautstärke 0..127. For empty slots: 0. */
  level: number;
}

/**
 * Stage-entry for one sample-slot replacement. Mirrors `EsxSamplePatchInput`
 * but is `index`-less because the map-key carries the slot index.
 */
export interface EsxSamplePatchEntry {
  /** Float32 PCM, interleaved L,R,L,R,… bei stereo. */
  pcmData: Float32Array;
  /** Sample-rate (Hz). */
  sampleRate: number;
  /** 1 = mono, 2 = stereo. v3.31 fokussiert auf mono. */
  channels: 1 | 2;
  /** Slot-Name (max 8 ASCII chars). */
  name: string;
  /** Optional playback-level 0..127. Default 100. */
  level?: number;
}

/**
 * Build the 256-row mono-sample overview list from a parsed bank.
 *
 * @param bank Parsed bank (bank.monoSamples is a sparse list — only filled slots)
 * @param totalSlots Number of slots (default 256 — ESX1_MAX_MONO_SLOTS)
 */
export function buildEsxSampleSlotOverview(
  bank: EsxBank,
  totalSlots = 256
): EsxSampleSlotRow[] {
  const byIndex = new Map<number, EsxSample>();
  for (const s of bank.monoSamples) {
    if (typeof s.index === "number") byIndex.set(s.index, s);
  }
  const rows: EsxSampleSlotRow[] = new Array(totalSlots);
  for (let i = 0; i < totalSlots; i++) {
    const s = byIndex.get(i);
    if (!s) {
      rows[i] = {
        index: i,
        empty: true,
        name: "",
        channels: 1,
        sampleRate: 0,
        frames: 0,
        level: 0,
      };
    } else {
      rows[i] = {
        index: i,
        empty: false,
        name: s.name ?? "",
        channels: s.channels,
        sampleRate: s.sampleRate,
        frames: s.frames,
        level: s.level,
      };
    }
  }
  return rows;
}

/**
 * Stage a sample-slot replacement. If `slot` already has a staged entry, the
 * new entry replaces it (last-write-wins). Returns a new map.
 */
export function stageEsxSamplePatch(
  pending: Map<number, EsxSamplePatchEntry>,
  slot: number,
  entry: EsxSamplePatchEntry
): Map<number, EsxSamplePatchEntry> {
  if (
    typeof slot !== "number" ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= 256
  ) {
    throw new Error(`stageEsxSamplePatch: invalid slot index ${slot}`);
  }
  if (!entry || typeof entry !== "object") {
    throw new Error("stageEsxSamplePatch: entry must be an object");
  }
  if (!(entry.pcmData instanceof Float32Array) || entry.pcmData.length === 0) {
    throw new Error(
      "stageEsxSamplePatch: entry.pcmData must be non-empty Float32Array"
    );
  }
  if (entry.channels !== 1 && entry.channels !== 2) {
    throw new Error(`stageEsxSamplePatch: invalid channels ${entry.channels}`);
  }
  if (
    typeof entry.sampleRate !== "number" ||
    !Number.isFinite(entry.sampleRate) ||
    entry.sampleRate <= 0
  ) {
    throw new Error(
      `stageEsxSamplePatch: invalid sampleRate ${entry.sampleRate}`
    );
  }
  const next = new Map(pending);
  next.set(slot, entry);
  return next;
}

/** Remove a staged sample-patch. Returns a new map (or SAME ref if absent). */
export function unstageEsxSamplePatch(
  pending: Map<number, EsxSamplePatchEntry>,
  slot: number
): Map<number, EsxSamplePatchEntry> {
  if (!pending.has(slot)) return pending;
  const next = new Map(pending);
  next.delete(slot);
  return next;
}

/** Returns true when at least one sample-slot replacement is staged. */
export function hasPendingEsxSamplePatches(
  pending: Map<number, EsxSamplePatchEntry>
): boolean {
  return pending.size > 0;
}

/** Count of staged sample-slot replacements. */
export function countPendingEsxSamplePatches(
  pending: Map<number, EsxSamplePatchEntry>
): number {
  return pending.size;
}

/**
 * Apply all staged sample-patches to the loaded bank-buffer, producing a new
 * buffer. Sample-patches are appended sequentially — each call to
 * `patchEsxBankSample` grows the bank by the new PCM size and updates the
 * target slot header. Sorted by slot index for deterministic write order.
 */
export function commitEsxSamplePatches(
  bankBuffer: ArrayBuffer | Uint8Array,
  pending: Map<number, EsxSamplePatchEntry>
): ArrayBuffer {
  if (pending.size === 0) {
    // Return a fresh copy so the caller can't mutate the input via the
    // returned buffer.
    const src =
      bankBuffer instanceof Uint8Array
        ? bankBuffer
        : new Uint8Array(bankBuffer);
    const out = new ArrayBuffer(src.byteLength);
    new Uint8Array(out).set(src);
    return out;
  }
  const indices = Array.from(pending.keys()).sort((a, b) => a - b);
  let current: ArrayBuffer | Uint8Array = bankBuffer;
  for (const idx of indices) {
    const entry = pending.get(idx);
    if (!entry) continue;
    const patch: EsxSamplePatchInput = {
      index: idx,
      channels: entry.channels,
      pcmData: entry.pcmData,
      sampleRate: entry.sampleRate,
      name: entry.name,
      level: entry.level,
    };
    current = patchEsxBankSample(current, patch);
  }
  return current instanceof ArrayBuffer
    ? current
    : ((current as Uint8Array).buffer.slice(
        (current as Uint8Array).byteOffset,
        (current as Uint8Array).byteOffset + (current as Uint8Array).byteLength
      ) as ArrayBuffer);
}

/**
 * Apply BOTH pattern-patches AND sample-patches to a bank-buffer.
 *
 * Order: Patterns first (slot-replace, fixed size), then Samples (append PCM,
 * grows buffer). Pattern offsets are fixed [0x0200..0x130000) so they don't
 * collide with sample-region writes.
 */
export function commitEsxPatchesAll(
  bankBuffer: ArrayBuffer | Uint8Array,
  patternPending: Map<number, ArrayBuffer>,
  samplePending: Map<number, EsxSamplePatchEntry>,
  renamePending?: Map<string, EsxSampleRename>
): ArrayBuffer {
  // Step 1: apply pattern patches.
  let buf: ArrayBuffer = commitEsxPatches(bankBuffer, patternPending);
  // Step 2: apply sample patches.
  if (samplePending.size > 0) {
    buf = commitEsxSamplePatches(buf, samplePending);
  }
  // Step 3: apply name-only renames LAST (surgical, bit-exact) so ein Rename
  // einen frischen Sample-Patch-Namen desselben Slots überschreiben kann.
  if (renamePending && renamePending.size > 0) {
    buf = commitEsxSampleRenames(buf, renamePending);
  }
  return buf;
}

// ─── Sample-Rename-Staging (v3.284 — name-only, bit-exakt) ───────────────────

/**
 * Stabiler Map-Key für einen Sample-Rename. Mono + Stereo teilen sich denselben
 * Slot-Index, deshalb geht der Kanal in den Key ein (`"1:3"` vs `"2:3"`).
 */
export function esxSampleRenameKey(channels: 1 | 2, index: number): string {
  return `${channels}:${index}`;
}

/**
 * Staged einen Slot-Rename (last-write-wins). Ein leerer/gleichnamiger Rename
 * wird trotzdem gestaged — der Caller entscheidet über Dedup via UI.
 */
export function stageEsxSampleRename(
  pending: Map<string, EsxSampleRename>,
  rename: EsxSampleRename
): Map<string, EsxSampleRename> {
  if (rename.channels !== 1 && rename.channels !== 2) {
    throw new Error(
      `stageEsxSampleRename: invalid channels ${rename.channels}`
    );
  }
  if (
    typeof rename.index !== "number" ||
    !Number.isInteger(rename.index) ||
    rename.index < 0
  ) {
    throw new Error(`stageEsxSampleRename: invalid index ${rename.index}`);
  }
  const next = new Map(pending);
  next.set(esxSampleRenameKey(rename.channels, rename.index), rename);
  return next;
}

/** Entfernt einen gestagten Rename. Gibt dieselbe Ref zurück, wenn nicht da. */
export function unstageEsxSampleRename(
  pending: Map<string, EsxSampleRename>,
  channels: 1 | 2,
  index: number
): Map<string, EsxSampleRename> {
  const key = esxSampleRenameKey(channels, index);
  if (!pending.has(key)) return pending;
  const next = new Map(pending);
  next.delete(key);
  return next;
}

/** Anzahl gestagter Renames. */
export function countPendingEsxSampleRenames(
  pending: Map<string, EsxSampleRename>
): number {
  return pending.size;
}

/** true, wenn mindestens ein Rename gestaged ist. */
export function hasPendingEsxSampleRenames(
  pending: Map<string, EsxSampleRename>
): boolean {
  return pending.size > 0;
}

/**
 * Wendet alle gestagten Renames in einem Pass an (name-only, bit-exakt). Gibt
 * bei leerer Map eine frische Kopie zurück, damit der Caller den Input nicht
 * über den Rückgabe-Buffer mutieren kann.
 */
export function commitEsxSampleRenames(
  bankBuffer: ArrayBuffer | Uint8Array,
  pending: Map<string, EsxSampleRename>
): ArrayBuffer {
  if (pending.size === 0) {
    const src =
      bankBuffer instanceof Uint8Array
        ? bankBuffer
        : new Uint8Array(bankBuffer);
    const out = new ArrayBuffer(src.byteLength);
    new Uint8Array(out).set(src);
    return out;
  }
  return renameEsxBankSamples(bankBuffer, Array.from(pending.values()));
}

/**
 * Format a frame-count as a "M:SS.ms" string (e.g. "0:01.234") for the UI
 * length display. Uses sampleRate to convert frames → seconds.
 */
export function formatSampleLength(frames: number, sampleRate: number): string {
  if (!Number.isFinite(frames) || frames <= 0) return "—";
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return `${frames} fr`;
  const seconds = frames / sampleRate;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds - m * 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * Apply a search/filter to sample-rows. Mirrors `filterEsxRows` for patterns.
 *
 * @param rows full list
 * @param query case-insensitive substring of name (or "<index>" prefix)
 * @param hideEmpty if true, suppress empty slots
 */
export function filterEsxSampleRows(
  rows: ReadonlyArray<EsxSampleSlotRow>,
  query: string,
  hideEmpty: boolean
): EsxSampleSlotRow[] {
  const q = (query ?? "").trim().toLowerCase();
  return rows.filter(r => {
    if (hideEmpty && r.empty) return false;
    if (q.length === 0) return true;
    const idxStr = String(r.index);
    if (idxStr === q || idxStr.padStart(3, "0") === q) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// v3.32.0 — Stereo Sample-Tab State
// ═══════════════════════════════════════════════════════════════════════════

/**
 * v3.32.0 — Overview row for one of the 128 stereo sample-slots.
 *
 * Same shape as `EsxSampleSlotRow` but the `index` is in stereo-slot-space
 * (0..127). The underlying parser stores stereo samples with `index = 256+i`
 * (mono-slots use 0..255 so the parser uses a single shared index-space). We
 * normalise back to stereo-local indices 0..127 here so the UI can render a
 * dense 128-row list.
 */
export interface EsxStereoSampleSlotRow {
  /** 0..127 — stereo slot-index inside the bank (LOCAL, not the parser's 256+i). */
  index: number;
  /** True when the slot was empty in the loaded bank. */
  empty: boolean;
  /** Sample name (ASCII, trimmed). For empty slots: "". */
  name: string;
  /** Always 2 (stereo). */
  channels: 2;
  /** Sample-Rate in Hz. For empty slots: 0. */
  sampleRate: number;
  /** Anzahl PCM-Frames pro Channel (NOT total — stereo encodes 2× this). */
  frames: number;
  /** Geräte-Lautstärke 0..127. For empty slots: 0. */
  level: number;
}

/**
 * v3.32.0 — Build the 128-row stereo-sample overview list from a parsed bank.
 *
 * Mirrors `buildEsxSampleSlotOverview` but operates on `bank.stereoSamples`.
 * The parser uses `sample.index = ESX1_MAX_MONO_SLOTS + i` for stereo slots,
 * so we subtract `ESX1_MAX_MONO_SLOTS` (256) to get the stereo-local 0..127.
 *
 * @param bank Parsed bank
 * @param totalSlots Number of stereo slots (default 128 — ESX1_MAX_STEREO_SLOTS)
 */
export function buildEsxStereoSampleSlotOverview(
  bank: EsxBank,
  totalSlots = 128
): EsxStereoSampleSlotRow[] {
  const MONO_SLOTS = 256;
  const byIndex = new Map<number, EsxSample>();
  for (const s of bank.stereoSamples) {
    if (typeof s.index === "number") {
      // Parser uses 256+i — normalise to 0..127.
      const local = s.index - MONO_SLOTS;
      if (local >= 0 && local < totalSlots) byIndex.set(local, s);
    }
  }
  const rows: EsxStereoSampleSlotRow[] = new Array(totalSlots);
  for (let i = 0; i < totalSlots; i++) {
    const s = byIndex.get(i);
    if (!s) {
      rows[i] = {
        index: i,
        empty: true,
        name: "",
        channels: 2,
        sampleRate: 0,
        frames: 0,
        level: 0,
      };
    } else {
      rows[i] = {
        index: i,
        empty: false,
        name: s.name ?? "",
        channels: 2,
        sampleRate: s.sampleRate,
        frames: s.frames,
        level: s.level,
      };
    }
  }
  return rows;
}

/**
 * v3.32.0 — Stage a stereo-sample-slot replacement. Slot is 0..127 (stereo-
 * local). Entry must have `channels === 2` and an interleaved L,R,L,R PCM
 * Float32Array (length === frames*2).
 */
export function stageEsxStereoSamplePatch(
  pending: Map<number, EsxSamplePatchEntry>,
  slot: number,
  entry: EsxSamplePatchEntry
): Map<number, EsxSamplePatchEntry> {
  if (
    typeof slot !== "number" ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= 128
  ) {
    throw new Error(
      `stageEsxStereoSamplePatch: invalid stereo-slot index ${slot}`
    );
  }
  if (!entry || typeof entry !== "object") {
    throw new Error("stageEsxStereoSamplePatch: entry must be an object");
  }
  if (!(entry.pcmData instanceof Float32Array) || entry.pcmData.length === 0) {
    throw new Error(
      "stageEsxStereoSamplePatch: entry.pcmData must be non-empty Float32Array"
    );
  }
  if (entry.channels !== 2) {
    throw new Error(
      `stageEsxStereoSamplePatch: entry.channels must be 2 (got ${entry.channels})`
    );
  }
  if (entry.pcmData.length % 2 !== 0) {
    throw new Error(
      "stageEsxStereoSamplePatch: stereo pcmData must have even length (L,R interleaved)"
    );
  }
  if (
    typeof entry.sampleRate !== "number" ||
    !Number.isFinite(entry.sampleRate) ||
    entry.sampleRate <= 0
  ) {
    throw new Error(
      `stageEsxStereoSamplePatch: invalid sampleRate ${entry.sampleRate}`
    );
  }
  const next = new Map(pending);
  next.set(slot, entry);
  return next;
}

/** v3.32.0 — Remove a staged stereo-sample-patch. */
export function unstageEsxStereoSamplePatch(
  pending: Map<number, EsxSamplePatchEntry>,
  slot: number
): Map<number, EsxSamplePatchEntry> {
  if (!pending.has(slot)) return pending;
  const next = new Map(pending);
  next.delete(slot);
  return next;
}

/** v3.32.0 — Returns true when at least one stereo-slot replacement is staged. */
export function hasPendingEsxStereoSamplePatches(
  pending: Map<number, EsxSamplePatchEntry>
): boolean {
  return pending.size > 0;
}

/** v3.32.0 — Count of staged stereo-slot replacements. */
export function countPendingEsxStereoSamplePatches(
  pending: Map<number, EsxSamplePatchEntry>
): number {
  return pending.size;
}

/**
 * v3.32.0 — Apply all staged stereo-sample-patches to the loaded bank-buffer.
 * Mirrors `commitEsxSamplePatches` but invokes `patchEsxBankSample` with
 * `channels: 2` for each entry.
 */
export function commitEsxStereoSamplePatches(
  bankBuffer: ArrayBuffer | Uint8Array,
  pending: Map<number, EsxSamplePatchEntry>
): ArrayBuffer {
  if (pending.size === 0) {
    const src =
      bankBuffer instanceof Uint8Array
        ? bankBuffer
        : new Uint8Array(bankBuffer);
    const out = new ArrayBuffer(src.byteLength);
    new Uint8Array(out).set(src);
    return out;
  }
  const indices = Array.from(pending.keys()).sort((a, b) => a - b);
  let current: ArrayBuffer | Uint8Array = bankBuffer;
  for (const idx of indices) {
    const entry = pending.get(idx);
    if (!entry) continue;
    if (entry.channels !== 2) {
      throw new Error(
        `commitEsxStereoSamplePatches: entry at slot ${idx} has channels ${entry.channels}, expected 2`
      );
    }
    const patch: EsxSamplePatchInput = {
      index: idx,
      channels: 2,
      pcmData: entry.pcmData,
      sampleRate: entry.sampleRate,
      name: entry.name,
      level: entry.level,
    };
    current = patchEsxBankSample(current, patch);
  }
  return current instanceof ArrayBuffer
    ? current
    : ((current as Uint8Array).buffer.slice(
        (current as Uint8Array).byteOffset,
        (current as Uint8Array).byteOffset + (current as Uint8Array).byteLength
      ) as ArrayBuffer);
}

/**
 * v3.32.0 — Filter helper for stereo-sample-rows. Mirrors filterEsxSampleRows.
 */
export function filterEsxStereoSampleRows(
  rows: ReadonlyArray<EsxStereoSampleSlotRow>,
  query: string,
  hideEmpty: boolean
): EsxStereoSampleSlotRow[] {
  const q = (query ?? "").trim().toLowerCase();
  return rows.filter(r => {
    if (hideEmpty && r.empty) return false;
    if (q.length === 0) return true;
    const idxStr = String(r.index);
    if (idxStr === q || idxStr.padStart(3, "0") === q) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// v3.38.0 — Undo / Redo Stack for the KorgBankEditor
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum number of snapshots kept in the undo/redo stack (memory-safe). */
export const EDITOR_HISTORY_MAX = 20;

/**
 * v3.38.0 — Single editor snapshot. Captures the three pending-patch maps
 * (patterns + mono samples + stereo samples) that comprise the ESX edit
 * session. Maps are kept by reference: the editor produces new Map instances
 * on every stage/unstage (immutable pattern) so reference equality is enough
 * to detect "no change". We do NOT snapshot the bank buffer itself — patches
 * are applied at save-time only.
 */
export interface EsxEditorSnapshot {
  patternMap: Map<number, ArrayBuffer>;
  sampleMap: Map<number, EsxSamplePatchEntry>;
  stereoSampleMap: Map<number, EsxSamplePatchEntry>;
}

/**
 * v3.38.0 — Undo/Redo history container. `past` stores prior snapshots
 * (oldest first → newest last), `future` stores undone snapshots that can
 * be re-applied via redo (newest first → oldest last).
 */
export interface EsxEditorHistory {
  past: EsxEditorSnapshot[];
  future: EsxEditorSnapshot[];
}

/** Create an empty history container. */
export function createEsxEditorHistory(): EsxEditorHistory {
  return { past: [], future: [] };
}

/**
 * Shallow-clone a snapshot. Maps are wrapped in `new Map(src)` so callers
 * can keep modifying their state without disturbing the saved snapshot.
 * The Map *values* (ArrayBuffer / EsxSamplePatchEntry) are NOT deep-cloned
 * — they are treated as immutable by convention in this module.
 */
export function cloneEsxEditorSnapshot(
  snap: EsxEditorSnapshot
): EsxEditorSnapshot {
  return {
    patternMap: new Map(snap.patternMap),
    sampleMap: new Map(snap.sampleMap),
    stereoSampleMap: new Map(snap.stereoSampleMap),
  };
}

/**
 * Push the *previous* state onto the past stack. Caller must invoke this
 * BEFORE applying a new patch (so the snapshot represents the pre-change
 * state). Clears the future stack — once a new edit is made, the old redo
 * trail is gone.
 *
 * Returns a NEW history object (input is not mutated). When the resulting
 * `past` would exceed `EDITOR_HISTORY_MAX`, the oldest entry is dropped.
 */
export function pushEsxHistory(
  history: EsxEditorHistory,
  prevSnapshot: EsxEditorSnapshot
): EsxEditorHistory {
  const snap = cloneEsxEditorSnapshot(prevSnapshot);
  const nextPast = [...history.past, snap];
  // Drop oldest entries until we're at or below cap.
  while (nextPast.length > EDITOR_HISTORY_MAX) {
    nextPast.shift();
  }
  return { past: nextPast, future: [] };
}

/**
 * Pop the most recent past-snapshot, returning it as the snapshot to apply
 * and pushing the *current* state onto the future stack so it can be redone.
 *
 * Returns `null` when there's nothing to undo (the editor should leave the
 * current state untouched in that case).
 */
export function undoEsxEditor(
  history: EsxEditorHistory,
  currentSnapshot: EsxEditorSnapshot
): { snapshot: EsxEditorSnapshot; history: EsxEditorHistory } | null {
  if (history.past.length === 0) return null;
  const nextPast = history.past.slice(0, -1);
  const snap = history.past[history.past.length - 1];
  const future = [...history.future, cloneEsxEditorSnapshot(currentSnapshot)];
  while (future.length > EDITOR_HISTORY_MAX) {
    future.shift();
  }
  return {
    snapshot: snap,
    history: { past: nextPast, future },
  };
}

/**
 * Pop the most recent future-snapshot (= an earlier undone state), returning
 * it as the snapshot to apply and pushing the *current* state onto the past
 * stack so the redo can be re-undone.
 *
 * Returns `null` when there's nothing to redo.
 */
export function redoEsxEditor(
  history: EsxEditorHistory,
  currentSnapshot: EsxEditorSnapshot
): { snapshot: EsxEditorSnapshot; history: EsxEditorHistory } | null {
  if (history.future.length === 0) return null;
  const nextFuture = history.future.slice(0, -1);
  const snap = history.future[history.future.length - 1];
  const past = [...history.past, cloneEsxEditorSnapshot(currentSnapshot)];
  while (past.length > EDITOR_HISTORY_MAX) {
    past.shift();
  }
  return {
    snapshot: snap,
    history: { past, future: nextFuture },
  };
}

/** Returns true if at least one undo step is available. */
export function canUndoEsxEditor(history: EsxEditorHistory): boolean {
  return history.past.length > 0;
}

/** Returns true if at least one redo step is available. */
export function canRedoEsxEditor(history: EsxEditorHistory): boolean {
  return history.future.length > 0;
}
