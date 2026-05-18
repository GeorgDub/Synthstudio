/**
 * Synthstudio – ESX-1 Bank Pattern + Sample Editor State (v3.29.0, v3.31.0)
 *
 * Pure-TypeScript model for the **ESX Edit-Modes** in `KorgBankEditor.tsx`.
 * Wraps a loaded `.esx`-bank (~24-28 MB ArrayBuffer) plus:
 *   - 256 pattern-slot overview rows
 *   - 256 mono-sample slot overview rows (v3.31)
 *   - Map of staged pattern-replacements
 *   - Map of staged sample-replacements (v3.31)
 *
 * Workflow Patterns:
 *   1. parseEsxBank(buffer) → 0..N patterns
 *   2. buildEsxSlotOverview(bank) → 256 rows
 *   3. stageEsxPatch(map, index, block) → next map
 *   4. unstageEsxPatch(map, index) → next map
 *   5. commitEsxPatches(bankBuffer, map) → new ArrayBuffer
 *
 * Workflow Samples (v3.31):
 *   1. parseEsxBank(buffer) → bank.monoSamples
 *   2. buildEsxSampleSlotOverview(bank) → 256 rows
 *   3. stageEsxSamplePatch(map, slot, sampleData) → next map
 *   4. unstageEsxSamplePatch(map, slot) → next map
 *   5. commitEsxSamplePatches(bankBuffer, map) → new ArrayBuffer
 *   6. commitEsxPatchesAll(bankBuffer, patternMap, sampleMap) → applies BOTH,
 *      patterns first (slot-replace), samples after (append + header-update)
 *
 * KEINE Electron-/DOM-/AudioEngine-Dependencies. Reine Daten-Operationen.
 */

import type { EsxBank, EsxPattern, EsxSample } from "./esxParser";
import {
  patchEsxBankPatterns,
  type EsxBankPatch,
} from "./esxBankPatcher";
import {
  patchEsxBankSample,
  type EsxSamplePatchInput,
} from "./esxSamplePatcher";

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
  return (
    lower === "init pattern" ||
    lower === "init pat" ||
    lower === "init"
  );
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
  totalSlots = 256,
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
  block: ArrayBuffer,
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
      })`,
    );
  }
  const next = new Map(pending);
  next.set(index, block);
  return next;
}

/** Remove a staged patch. Returns a new map. */
export function unstageEsxPatch(
  pending: Map<number, ArrayBuffer>,
  index: number,
): Map<number, ArrayBuffer> {
  if (!pending.has(index)) return pending;
  const next = new Map(pending);
  next.delete(index);
  return next;
}

/** Apply all staged patches to the loaded bank-buffer, producing a new buffer. */
export function commitEsxPatches(
  bankBuffer: ArrayBuffer | Uint8Array,
  pending: Map<number, ArrayBuffer>,
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
export function hasPendingEsxPatches(pending: Map<number, ArrayBuffer>): boolean {
  return pending.size > 0;
}

/** Count of staged slot replacements. */
export function countPendingEsxPatches(
  pending: Map<number, ArrayBuffer>,
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
  hideEmpty: boolean,
): EsxSlotRow[] {
  const q = (query ?? "").trim().toLowerCase();
  return rows.filter((r) => {
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
  totalSlots = 256,
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
  entry: EsxSamplePatchEntry,
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
    throw new Error("stageEsxSamplePatch: entry.pcmData must be non-empty Float32Array");
  }
  if (entry.channels !== 1 && entry.channels !== 2) {
    throw new Error(`stageEsxSamplePatch: invalid channels ${entry.channels}`);
  }
  if (
    typeof entry.sampleRate !== "number" ||
    !Number.isFinite(entry.sampleRate) ||
    entry.sampleRate <= 0
  ) {
    throw new Error(`stageEsxSamplePatch: invalid sampleRate ${entry.sampleRate}`);
  }
  const next = new Map(pending);
  next.set(slot, entry);
  return next;
}

/** Remove a staged sample-patch. Returns a new map (or SAME ref if absent). */
export function unstageEsxSamplePatch(
  pending: Map<number, EsxSamplePatchEntry>,
  slot: number,
): Map<number, EsxSamplePatchEntry> {
  if (!pending.has(slot)) return pending;
  const next = new Map(pending);
  next.delete(slot);
  return next;
}

/** Returns true when at least one sample-slot replacement is staged. */
export function hasPendingEsxSamplePatches(
  pending: Map<number, EsxSamplePatchEntry>,
): boolean {
  return pending.size > 0;
}

/** Count of staged sample-slot replacements. */
export function countPendingEsxSamplePatches(
  pending: Map<number, EsxSamplePatchEntry>,
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
  pending: Map<number, EsxSamplePatchEntry>,
): ArrayBuffer {
  if (pending.size === 0) {
    // Return a fresh copy so the caller can't mutate the input via the
    // returned buffer.
    const src = bankBuffer instanceof Uint8Array ? bankBuffer : new Uint8Array(bankBuffer);
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
    : (current as Uint8Array).buffer.slice(
        (current as Uint8Array).byteOffset,
        (current as Uint8Array).byteOffset + (current as Uint8Array).byteLength,
      ) as ArrayBuffer;
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
): ArrayBuffer {
  // Step 1: apply pattern patches.
  let buf: ArrayBuffer = commitEsxPatches(bankBuffer, patternPending);
  // Step 2: apply sample patches.
  if (samplePending.size > 0) {
    buf = commitEsxSamplePatches(buf, samplePending);
  }
  return buf;
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
  hideEmpty: boolean,
): EsxSampleSlotRow[] {
  const q = (query ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (hideEmpty && r.empty) return false;
    if (q.length === 0) return true;
    const idxStr = String(r.index);
    if (idxStr === q || idxStr.padStart(3, "0") === q) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    return false;
  });
}
