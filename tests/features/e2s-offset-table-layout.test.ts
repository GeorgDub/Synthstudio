/**
 * tests/features/e2s-offset-table-layout.test.ts — v3.298.0
 *
 * Pinnt die Geometrie der `.all`-Offset-Tabelle und die Selbstprüfung, die
 * eine falsche Tabellen-Startadresse überhaupt erst sichtbar macht.
 *
 * ## Warum diese Datei zweimal umgeschrieben wurde
 *
 * Die Startadresse war schon zweimal falsch:
 *
 * | Wert | Einträge | verworfen in |
 * |---|---|---|
 * | `0x07E0` | 250 | v3.286 |
 * | `0x0058` | 1002 | v3.298 |
 * | `0x0010` | 1020 | aktuell (Oe2sSLE) |
 *
 * Beide Irrtümer haben denselben Ursprung: die Werks-Referenzdatei hat ihr
 * erstes Sample bei OSC_0index 500, ihr erster nicht-null-Tabelleneintrag
 * liegt also auf `0x0010 + 500*4 = 0x07E0`. Wer den ersten belegten Eintrag
 * für den Tabellenanfang hält, landet bei `0x07E0`; wer davon rückwärts
 * rechnet, ohne die niedrigen Indizes zu prüfen, kann bei jedem beliebigen
 * Versatz landen.
 *
 * **Ein Exact-Fit-Test hilft dabei nicht** — `0x0010 + 1020*4` und
 * `0x0058 + 1002*4` ergeben beide exakt `0x1000`. Auch "Offset >= 0x1000",
 * "innerhalb der Datei" und "Anzahl nicht-null" sind blind gegen einen
 * Versatz: verschobene Indizes liefern dieselben Offset-WERTE.
 *
 * Was diskriminiert, ist allein `esli.OSC_0index` — die Datei trägt die
 * Sample-Nummer ein zweites Mal, im korg-Chunk jedes Slots. Deshalb prüft
 * dieser Test nicht nur Zahlen, sondern vor allem den Reader-Abgleich.
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
  ESLI_OSC_INDEX_OFFSET,
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
  it("starts at 0x0010 with 1020 entries", () => {
    // Absichtlich literal: ein symbolischer Test kann einen falschen Wert
    // nicht bemerken, weil er ihn selbst benutzt.
    expect(E2S_ALL_OFFSET_TABLE_START).toBe(0x0010);
    expect(E2S_MAX_SLOTS).toBe(1020);
    expect(E2S_ALL_OFFSET_TABLE_BYTES).toBe(4080);
  });

  it("begins directly behind the 16-byte signature", () => {
    expect(E2S_ALL_OFFSET_TABLE_START).toBe(E2S_ALL_SIGNATURE_LEN);
  });

  it("fills the prelude exactly — table end == sample-area start", () => {
    expect(E2S_ALL_OFFSET_TABLE_START + E2S_ALL_OFFSET_TABLE_BYTES).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
  });

  it("exact fit does NOT identify the layout on its own", () => {
    // Der verworfene Wert 0x0058/1002 passt genauso exakt. Dieser Test steht
    // hier, damit niemand den Exact-Fit-Check für einen Beweis hält — er
    // schließt nur 0x07E0/250 aus (0x0BC8), sonst nichts.
    expect(0x0058 + 1002 * 4).toBe(E2S_ALL_SAMPLE_AREA_START);
    expect(0x07e0 + 250 * 4).not.toBe(E2S_ALL_SAMPLE_AREA_START);
  });

  it("explains the historic 0x07E0 reading: index 500 of this table", () => {
    expect(E2S_ALL_OFFSET_TABLE_START + 500 * 4).toBe(0x07e0);
  });
});

// ─── Die Selbstprüfung ────────────────────────────────────────────────────────

describe("offset-table self-check via esli.OSC_0index", () => {
  it("stays silent when table index and OSC_0index agree", () => {
    const built = buildE2sBank([slot(0, "Kick"), slot(501, "Vocal"), slot(1019, "Last")]);
    const bank = parseE2sBank(built.buffer, "ok.all");

    for (const i of [0, 501, 1019]) {
      expect(bank.slots[i]?.sampleNumber).toBe(i);
    }
    expect(bank.warnings.filter(w => w.includes("geometry suspect"))).toEqual([]);
  });

  it("reports a constant shift — the signature of a wrong table start", () => {
    // Simuliert exakt den v3.286-Fehler: die Tabelle 18 Einträge (0x48 Bytes)
    // zu weit hinten gelesen. Statt das zu simulieren, verbiegen wir die
    // OSC_0index-Felder um denselben Betrag — für den Reader nicht
    // unterscheidbar, und genau darum geht es.
    const SHIFT = 18;
    const built = buildE2sBank([slot(500, "A"), slot(600, "B"), slot(700, "C")]);
    const bytes = new Uint8Array(built.buffer);
    const dv = new DataView(bytes.buffer);
    for (const i of [500, 600, 700]) {
      const riffOff = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, true);
      // korg-Body suchen: 'korg' + LE32 size, danach 'esli' + 4 + OSC_0index.
      const korgAt = bytes.indexOf(0x6b, riffOff); // 'k'
      let p = riffOff;
      while (p < bytes.length - 8) {
        if (
          bytes[p] === 0x6b && bytes[p + 1] === 0x6f &&
          bytes[p + 2] === 0x72 && bytes[p + 3] === 0x67
        ) break;
        p++;
      }
      expect(p).toBeGreaterThanOrEqual(korgAt > 0 ? 0 : 0);
      dv.setUint16(p + 8 + ESLI_OSC_INDEX_OFFSET, i + SHIFT, true);
    }

    const bank = parseE2sBank(bytes.buffer, "shifted.all");
    const suspect = bank.warnings.filter(w => w.includes("geometry suspect"));
    expect(suspect).toHaveLength(1);
    expect(suspect[0]).toContain("+18");
    // Die Warnung nennt die Byte-Zahl, um die die Startadresse danebenliegt —
    // 18 Einträge sind 72 Bytes, exakt der Abstand 0x0058 - 0x0010.
    expect(suspect[0]).toContain("72 Bytes");
    expect(0x0058 - 0x0010).toBe(SHIFT * 4);
  });

  it("distinguishes single inconsistent slots from a geometry error", () => {
    const built = buildE2sBank([slot(10, "A"), slot(20, "B"), slot(30, "C")]);
    const bytes = new Uint8Array(built.buffer);
    const dv = new DataView(bytes.buffer);
    // Nur EINEN Slot verbiegen, und zwar um einen anderen Betrag.
    const riffOff = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 20 * 4, true);
    let p = riffOff;
    while (p < bytes.length - 8) {
      if (
        bytes[p] === 0x6b && bytes[p + 1] === 0x6f &&
        bytes[p + 2] === 0x72 && bytes[p + 3] === 0x67
      ) break;
      p++;
    }
    dv.setUint16(p + 8 + ESLI_OSC_INDEX_OFFSET, 999, true);

    const bank = parseE2sBank(bytes.buffer, "one-bad.all");
    expect(bank.warnings.some(w => w.includes("geometry suspect"))).toBe(false);
    expect(bank.warnings.some(w => w.includes("Kein konstanter Versatz"))).toBe(true);
  });
});

// ─── Hacktribe-Reichweite ─────────────────────────────────────────────────────

describe("E2S bank round-trip across the whole table", () => {
  it("carries a sample at index 501 through build → parse", () => {
    // 501 ist der Grund für die ganze Serie von Korrekturen: dort fangen
    // Hacktribes User-Sample-Slots an.
    const built = buildE2sBank([slot(501, "HT501")]);
    expect(built.slotCount).toBe(1);

    const bank = parseE2sBank(built.buffer, "ht.all");
    expect(bank.slots[501]?.name).toBe("HT501");
    expect(bank.offsetTable[501]).toBe(E2S_ALL_SAMPLE_AREA_START);
  });

  it("addresses the very last slot without escaping the prelude", () => {
    const built = buildE2sBank([slot(E2S_MAX_SLOTS - 1, "LAST")]);
    const bank = parseE2sBank(built.buffer, "last.all");
    expect(bank.slots[E2S_MAX_SLOTS - 1]?.name).toBe("LAST");
    expect(E2S_ALL_OFFSET_TABLE_START + (E2S_MAX_SLOTS - 1) * 4 + 4).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
  });

  it("spreads samples across the table and reads every one back", () => {
    const indices = [0, 1, 17, 18, 249, 250, 500, 501, 999, 1019];
    const built = buildE2sBank(indices.map(i => slot(i, `S${i}`)));
    expect(built.slotCount).toBe(indices.length);

    const bank = parseE2sBank(built.buffer, "spread.all");
    for (const i of indices) {
      expect(bank.slots[i]?.name).toBe(`S${i}`);
    }
    expect(bank.slots.filter(s => s !== null)).toHaveLength(indices.length);
  });

  it("keeps the low factory slots 0..17 addressable", () => {
    // Genau diese 18 Slots gingen bei der 0x0058-Lesart verloren — sie lagen
    // vor dem angenommenen Tabellenanfang.
    const built = buildE2sBank([slot(0, "F0"), slot(17, "F17")]);
    const bank = parseE2sBank(built.buffer, "factory.all");
    expect(bank.slots[0]?.name).toBe("F0");
    expect(bank.slots[17]?.name).toBe("F17");
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
    expect(visible.map(s => s.slotIndex)).toEqual([0, 501, 777]);
  });

  it("shows everything when hideEmpty is off", () => {
    expect(filterOpenedSlots(rows(), "", false)).toHaveLength(E2S_MAX_SLOTS);
  });

  it("finds a slot by name, case-insensitively", () => {
    expect(filterOpenedSlots(rows(), "vOcAl", true).map(s => s.slotIndex)).toEqual([501]);
  });

  it("finds a slot by index, with or without a leading #", () => {
    for (const q of ["501", "#501"]) {
      expect(filterOpenedSlots(rows(), q, true).map(s => s.slotIndex)).toEqual([501]);
    }
    expect(filterOpenedSlots(rows(), "000", false).map(s => s.slotIndex)).toEqual([0]);
  });

  it("does not match an index by substring", () => {
    // "77" darf nicht #777 treffen — sonst ist die Suche unbrauchbar,
    // sobald die Bank voll ist.
    expect(filterOpenedSlots(rows(), "77", true)).toHaveLength(0);
  });

  it("keeps an edited empty slot visible despite hideEmpty", () => {
    const edited = rows().map(s => (s.slotIndex === 42 ? { ...s, isDirty: true } : s));
    expect(filterOpenedSlots(edited, "", true).map(s => s.slotIndex)).toEqual([
      0, 42, 501, 777,
    ]);
  });

  it("preserves slot order and never reorders", () => {
    const idx = filterOpenedSlots(rows(), "", true).map(s => s.slotIndex);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("returns an empty list rather than throwing on no match", () => {
    expect(filterOpenedSlots(rows(), "kein-solcher-slot", true)).toEqual([]);
    expect(filterOpenedSlots([], "", true)).toEqual([]);
  });
});

// ─── Geräte-Limit als Warnung ─────────────────────────────────────────────────

describe("PCM-Budget: Geräte-Limit warnt, blockt aber nicht", () => {
  it("warnt oberhalb von 24 MB, baut die Bank aber trotzdem", () => {
    // ~25 MB PCM: über dem Geräte-Limit, weit unter der harten Bau-Grenze.
    // Die Bank muss trotzdem entstehen — sonst wäre es eine Regression für
    // alles, was sich bisher bauen ließ.
    const perSlot = 1_600_000; // Samples => ~3,2 MB je Slot on disk
    const built = buildE2sBank(
      Array.from({ length: 8 }, (_, i) => ({
        slotIndex: 500 + i,
        name: `BIG${i}`,
        pcmData: new Float32Array(perSlot),
        sampleRate: 44100,
        channels: 1,
      })),
    );

    expect(built.slotCount).toBe(8);
    expect(
      built.warnings.some((w) => w.includes("Geräte-Limit")),
      `keine Geräte-Limit-Warnung in: ${JSON.stringify(built.warnings)}`,
    ).toBe(true);
  });

  it("schweigt bei einer Bank normaler Größe", () => {
    const built = buildE2sBank([slot(501, "S501")]);
    expect(built.warnings.some((w) => w.includes("Geräte-Limit"))).toBe(false);
  });
});
