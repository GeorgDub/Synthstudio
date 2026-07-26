/**
 * tests/features/e2s-offset-table-layout.test.ts — v3.286.0
 *
 * Pinnt die korrigierte Offset-Tabellen-Geometrie des `.all`-Containers und
 * den Slot-Browser-Filter, der erst dadurch nötig wurde.
 *
 * Warum ein eigenes File: die vorhandenen E2S-Suiten prüfen die Geometrie
 * ausschließlich *symbolisch* (`E2S_ALL_OFFSET_TABLE_START + i * 4`). Genau
 * deshalb blieben sie grün, während die Konstante falsch war — sie prüfen die
 * Konsistenz von Reader und Builder, nicht deren Übereinstimmung mit dem
 * Gerät. Die Tests hier nennen die Zahlen deshalb absichtlich beim Namen.
 *
 * Die Herleitung der Korrektur (0x07E0/250 → 0x0058/1002) steht in
 * `client/src/utils/korg/constants.ts` bei `E2S_ALL_OFFSET_TABLE_START`.
 */

import { describe, it, expect } from "vitest";
import { buildE2sBank, type E2sSlotInput } from "@/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "@/utils/korg/e2sBankReader";
import {
  bankToOpenedSlots,
  filterOpenedSlots,
  type OpenedSlot,
} from "@/utils/korg/bankEditorState";
import {
  E2S_ALL_OFFSET_TABLE_BYTES,
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_ALL_SIGNATURE_LEN,
  E2S_MAX_SLOTS,
  E2S_SLOT_INDEX_MAX,
} from "@/utils/korg/constants";

function pcm(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((i / n) * Math.PI * 2) * 0.5;
  return out;
}

function slot(slotIndex: number, name: string): E2sSlotInput {
  return { slotIndex, name, pcmData: pcm(64), sampleRate: 44100, channels: 1 };
}

// ─── Geometrie ────────────────────────────────────────────────────────────────

describe("E2S .all offset-table geometry", () => {
  it("starts at 0x0058 with 1002 entries", () => {
    // Absichtlich literal: ein symbolischer Test kann einen falschen Wert
    // nicht bemerken, weil er ihn selbst benutzt.
    expect(E2S_ALL_OFFSET_TABLE_START).toBe(0x0058);
    expect(E2S_MAX_SLOTS).toBe(1002);
    expect(E2S_ALL_OFFSET_TABLE_BYTES).toBe(4008);
  });

  it("fills the prelude exactly — table end == sample-area start", () => {
    // Das ist die Rechnung, die den alten Wert entlarvt hätte:
    // 0x07E0 + 250*4 = 0x0BC8, und das ist nicht 0x1000.
    expect(E2S_ALL_OFFSET_TABLE_START + E2S_ALL_OFFSET_TABLE_BYTES).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
    expect(0x07e0 + 250 * 4).not.toBe(E2S_ALL_SAMPLE_AREA_START);
  });

  it("leaves room for the 16-byte signature plus a 72-byte header rest", () => {
    expect(E2S_ALL_OFFSET_TABLE_START).toBeGreaterThan(E2S_ALL_SIGNATURE_LEN);
    expect(E2S_ALL_OFFSET_TABLE_START - E2S_ALL_SIGNATURE_LEN).toBe(0x48);
  });

  it("explains the old 0x07E0 reading: it was index 482 of this table", () => {
    // Die Werks-`e2sSample.all` belegt die Indizes 482..492. Ihr erster
    // nicht-null-Eintrag landet damit genau auf 0x07E0 — daher sah die
    // Tabelle aus, als beginne sie dort, und die 482 Nullen davor galten
    // als "reserved padding".
    expect(E2S_ALL_OFFSET_TABLE_START + 482 * 4).toBe(0x07e0);
  });

  it("exposes 1000 user-pickable slots plus 2 reserved table entries", () => {
    expect(E2S_SLOT_INDEX_MAX).toBe(1000);
    expect(E2S_MAX_SLOTS - E2S_SLOT_INDEX_MAX).toBe(2);
  });
});

// ─── Hacktribe-Reichweite ─────────────────────────────────────────────────────

describe("E2S bank round-trip beyond the old 250-slot ceiling", () => {
  it("carries a sample at index 501 through build → parse", () => {
    // 501 ist der Grund für die ganze Korrektur: dort fangen Hacktribes
    // User-Sample-Slots an. Mit dem alten Layout war dieser Slot nicht
    // adressierbar — der Builder hat ihn als out-of-range verworfen.
    const built = buildE2sBank([slot(501, "HT501")]);
    expect(built.slotCount).toBe(1);

    const bank = parseE2sBank(built.buffer, "ht.all");
    expect(bank.slots[501]).not.toBeNull();
    expect(bank.slots[501]?.name).toBe("HT501");
    expect(bank.offsetTable[501]).toBe(E2S_ALL_SAMPLE_AREA_START);
  });

  it("keeps the legacy 0x07E0 region empty when only slot 501 is used", () => {
    // Gegenprobe zum alten Verhalten: hätte die Tabelle wirklich bei 0x07E0
    // begonnen, müsste dort jetzt der Offset stehen. Er steht bei
    // 0x0058 + 501*4 = 0x082C.
    const built = buildE2sBank([slot(501, "HT501")]);
    const dv = new DataView(built.buffer);
    expect(dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 501 * 4, true)).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
    expect(dv.getUint32(0x07e0, true)).toBe(0);
  });

  it("addresses the very last slot (1001) without escaping the prelude", () => {
    const built = buildE2sBank([slot(E2S_MAX_SLOTS - 1, "LAST")]);
    const bank = parseE2sBank(built.buffer, "last.all");
    expect(bank.slots[E2S_MAX_SLOTS - 1]?.name).toBe("LAST");
    // Der Eintrag für den letzten Slot liegt noch VOR der Sample-Area.
    expect(E2S_ALL_OFFSET_TABLE_START + (E2S_MAX_SLOTS - 1) * 4 + 4).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
  });

  it("spreads samples across the whole table and reads every one back", () => {
    const indices = [0, 1, 249, 250, 500, 501, 999, 1001];
    const built = buildE2sBank(indices.map((i) => slot(i, `S${i}`)));
    expect(built.slotCount).toBe(indices.length);

    const bank = parseE2sBank(built.buffer, "spread.all");
    for (const i of indices) {
      expect(bank.slots[i]?.name).toBe(`S${i}`);
    }
    expect(bank.slots.filter((s) => s !== null)).toHaveLength(indices.length);
  });

  it("still rejects an index at or past the table size", () => {
    const built = buildE2sBank([slot(E2S_MAX_SLOTS, "TOOFAR")]);
    expect(built.slotCount).toBe(0);
    expect(built.warnings.join(" ")).toMatch(/out of range/i);
  });
});

// ─── Slot-Browser-Filter ──────────────────────────────────────────────────────

describe("filterOpenedSlots", () => {
  function rows(): OpenedSlot[] {
    const built = buildE2sBank([slot(0, "Kick"), slot(501, "Vocal"), slot(777, "Snare")]);
    return bankToOpenedSlots(parseE2sBank(built.buffer, "f.all"));
  }

  it("produces one row per table entry before filtering", () => {
    expect(rows()).toHaveLength(E2S_MAX_SLOTS);
  });

  it("hides empty slots — the reason the filter exists", () => {
    const visible = filterOpenedSlots(rows(), "", true);
    expect(visible.map((s) => s.slotIndex)).toEqual([0, 501, 777]);
  });

  it("shows everything when hideEmpty is off", () => {
    expect(filterOpenedSlots(rows(), "", false)).toHaveLength(E2S_MAX_SLOTS);
  });

  it("finds a slot by name, case-insensitively", () => {
    const visible = filterOpenedSlots(rows(), "vOcAl", true);
    expect(visible.map((s) => s.slotIndex)).toEqual([501]);
  });

  it("finds a slot by index, with or without padding or a leading #", () => {
    for (const q of ["501", "#501"]) {
      expect(filterOpenedSlots(rows(), q, true).map((s) => s.slotIndex)).toEqual([501]);
    }
    // Zero-padded trifft ebenfalls (die Liste zeigt #000-Stil).
    expect(filterOpenedSlots(rows(), "000", false).map((s) => s.slotIndex)).toEqual([0]);
  });

  it("does not match an index by substring", () => {
    // "77" darf nicht #777 treffen — sonst ist die Suche nach einem Slot
    // unbrauchbar, sobald die Bank voll ist.
    expect(filterOpenedSlots(rows(), "77", true)).toHaveLength(0);
  });

  it("keeps an edited empty slot visible despite hideEmpty", () => {
    // Sonst verschwindet der Slot, den man gerade geleert hat, unter dem
    // Cursor — mitsamt der noch nicht gespeicherten Änderung.
    const all = rows();
    const edited = all.map((s) =>
      s.slotIndex === 42 ? { ...s, isDirty: true } : s,
    );
    const visible = filterOpenedSlots(edited, "", true);
    expect(visible.map((s) => s.slotIndex)).toEqual([0, 42, 501, 777]);
  });

  it("preserves slot order and never reorders", () => {
    const visible = filterOpenedSlots(rows(), "", true);
    const idx = visible.map((s) => s.slotIndex);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("returns an empty list rather than throwing on no match", () => {
    expect(filterOpenedSlots(rows(), "kein-solcher-slot", true)).toEqual([]);
    expect(filterOpenedSlots([], "", true)).toEqual([]);
  });
});
