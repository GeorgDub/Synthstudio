import { describe, it, expect } from "vitest";
import { buildE2sBank } from "../../client/src/utils/korg/e2sBankBuilder";

// v3.316: Regression — chunk[body+0x1D] = 0x02 (vermeintliches Fix-Byte)
// überschrieb das MSB von importNum (u16 @0x1C = sampleNumber+50). In den
// Referenz-Banken lagen alle importNums in 0x200..0x2FF, daher fiel es nie
// auf; ab sampleNumber 718 (importNum ≥ 0x300) verlor jedes Sample 256.

function importNumOf(sampleNumber: number): number {
  const res = buildE2sBank([
    {
      slotIndex: 0,
      sampleNumber,
      name: "T",
      category: 17,
      pcmData: new Float32Array(100),
      sampleRate: 44100,
      channels: 1,
    },
  ]);
  const b = Buffer.from(res.buffer);
  const p = b.readUInt32LE(0x10);
  const rlen = b.readUInt32LE(p + 4) + 8;
  return b.readUInt16LE(p + rlen - 0x494 + 0x14);
}

describe("e2sBankBuilder importNum MSB", () => {
  it("importNum = sampleNumber+50 auch jenseits von 0x2FF", () => {
    expect(importNumOf(500)).toBe(550); // Bestand (MSB 0x02)
    expect(importNumOf(717)).toBe(767); // letzter Wert vor der Grenze
    expect(importNumOf(718)).toBe(768); // vorher: 512 (MSB zerstoert)
    expect(importNumOf(949)).toBe(999); // hohe User-Slots
  });
});
