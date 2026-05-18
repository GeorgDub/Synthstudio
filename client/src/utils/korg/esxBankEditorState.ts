/**
 * Synthstudio – ESX-1 Bank Pattern-Patch Editor State (v3.29.0)
 *
 * Pure-TypeScript model for the **ESX Pattern-Edit-Mode** in
 * `KorgBankEditor.tsx`. Wraps a loaded `.esx`-bank (~24-28 MB ArrayBuffer)
 * plus a list of 256 slot-overview rows and a Map of staged slot-replacements.
 *
 * Workflow:
 *   1. parseEsxBank(buffer) → 0..N patterns (empty slots are skipped by parser)
 *   2. buildEsxSlotOverview(bank, totalSlots=256) → 256 rows incl. empty slots
 *   3. User clicks "Replace with current Synthstudio Pattern" on a slot →
 *      stageEsxPatch(state, index, patternInput) stores the 4280B-block in
 *      `pendingPatches: Map<index, ArrayBuffer>`. Same call again replaces
 *      the previous staged patch.
 *   4. unstageEsxPatch(state, index) removes a staged patch (revert).
 *   5. commitEsxPatches(bankBuffer, state) → patchEsxBankPatterns(bankBuffer,
 *      [...stagedPatches]) → new ArrayBuffer ready for `.esx` save.
 *
 * KEINE Electron-/DOM-/AudioEngine-Dependencies. Reine Daten-Operationen.
 */

import type { EsxBank, EsxPattern } from "./esxParser";
import {
  patchEsxBankPatterns,
  type EsxBankPatch,
} from "./esxBankPatcher";

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
