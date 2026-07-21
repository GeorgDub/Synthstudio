import { describe, it, expect } from "vitest";
import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_OFFSET_TABLE_BYTES,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_MAX_SLOTS,
} from "../../client/src/utils/korg/constants";
import { buildE2sBank } from "../../client/src/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "../../client/src/utils/korg/e2sBankReader";

// Regression guard for the .all offset-table fix (TASK-029 equivalent).
// The pre-fix bug read the table at 0x07E0 with 250 slots — an artefact of one
// test file placing samples at index 482 (0x0058 + 482*4 == 0x07E0).
describe(".all offset-table layout (regression)", () => {
  it("table starts at 0x0058 with 1002 slots and ends exactly at the sample area", () => {
    expect(E2S_ALL_OFFSET_TABLE_START).toBe(0x0058);
    expect(E2S_MAX_SLOTS).toBe(1002);
    expect(E2S_ALL_OFFSET_TABLE_BYTES).toBe(1002 * 4);
    expect(E2S_ALL_OFFSET_TABLE_START + E2S_ALL_OFFSET_TABLE_BYTES).toBe(
      E2S_ALL_SAMPLE_AREA_START,
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
    // Pre-fix this was impossible: the 250-slot cap rejected any index >= 250.
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
    expect(bank.slots.filter((s) => s !== null)).toHaveLength(2);
  });
});
