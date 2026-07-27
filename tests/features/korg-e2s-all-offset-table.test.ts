import { describe, it, expect } from "vitest";
import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_OFFSET_TABLE_BYTES,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_MAX_SLOTS,
} from "../../client/src/utils/korg/constants";
import { buildE2sBank } from "../../client/src/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "../../client/src/utils/korg/e2sBankReader";

// Regression guard for the .all offset-table layout, aligned to Oe2sSLE
// (e2s_sample_all.py): table at 0x0010 with 1020 LE32 slots, index == OSC_0index.
// The pre-fix values (0x07E0/250, later 0x0058/1002) were mis-derivations from
// single test files whose first sample sat at OSC_0index 500 (0x0010 + 500*4 ==
// 0x07E0).
describe(".all offset-table layout (regression)", () => {
  it("table starts at 0x0010 with 1020 slots and ends exactly at the sample area", () => {
    expect(E2S_ALL_OFFSET_TABLE_START).toBe(0x0010);
    expect(E2S_MAX_SLOTS).toBe(1020);
    expect(E2S_ALL_OFFSET_TABLE_BYTES).toBe(1020 * 4);
    expect(E2S_ALL_OFFSET_TABLE_START + E2S_ALL_OFFSET_TABLE_BYTES).toBe(
      E2S_ALL_SAMPLE_AREA_START
    );
    expect(E2S_ALL_SAMPLE_AREA_START).toBe(0x1000);
  });

  // Minimal mono PCM slot input for the builder.
  function slot(slotIndex: number, name: string) {
    return {
      slotIndex,
      name,
      pcmData: new Float32Array([0, 0.3, -0.3, 0.1, -0.1, 0, 0.05, -0.05]),
      sampleRate: 44100,
      channels: 1 as const,
    };
  }

  it("places a hacktribe-range slot (>= 501) in the table and round-trips it", () => {
    const { buffer } = buildE2sBank([slot(501, "HT501"), slot(999, "HT999")]);
    const dv = new DataView(buffer);

    // Offsets for slots 501 and 999 must be non-zero and inside the sample area.
    const off501 = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 501 * 4, true);
    const off999 = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 999 * 4, true);
    expect(off501).toBeGreaterThanOrEqual(E2S_ALL_SAMPLE_AREA_START);
    expect(off999).toBeGreaterThanOrEqual(E2S_ALL_SAMPLE_AREA_START);

    const bank = parseE2sBank(buffer);
    expect(bank.slots).toHaveLength(E2S_MAX_SLOTS);
    expect(bank.slots[501]?.name).toBe("HT501");
    expect(bank.slots[999]?.name).toBe("HT999");
    // Everything else empty.
    expect(bank.slots.filter(s => s !== null)).toHaveLength(2);
  });

  it("liest niedrig nummerierte Slots 0..17 (0x0010-Start, Oe2sSLE)", () => {
    // Vor der Oe2sSLE-Angleichung (Start 0x0058) wurden Tabellen-Indizes 0..17
    // übersprungen. Ein Sample bei OSC_0index 5 muss jetzt gelesen werden — sein
    // Pointer liegt bei 0x0010 + 5*4 = 0x24.
    const { buffer } = buildE2sBank([slot(5, "LOW5")]);
    const dv = new DataView(buffer);
    expect(dv.getUint32(0x10 + 5 * 4, true)).toBeGreaterThanOrEqual(
      E2S_ALL_SAMPLE_AREA_START
    );
    const bank = parseE2sBank(buffer);
    expect(bank.slots[5]?.name).toBe("LOW5");
  });

  it("erlaubt den neuen Höchst-Index 1019 (Tabelle endet bei 0x1000)", () => {
    const { buffer } = buildE2sBank([slot(1019, "TOP")]);
    const dv = new DataView(buffer);
    // Letzter Tabellen-Eintrag @ 0x0010 + 1019*4 = 0xFFC, +4 = 0x1000.
    expect(dv.getUint32(0x10 + 1019 * 4, true)).toBeGreaterThanOrEqual(
      E2S_ALL_SAMPLE_AREA_START
    );
    const bank = parseE2sBank(buffer);
    expect(bank.slots[1019]?.name).toBe("TOP");
  });
});
