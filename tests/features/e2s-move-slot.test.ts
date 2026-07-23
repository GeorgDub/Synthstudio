/**
 * e2s-move-slot.test.ts — Oe2sSLE „Move / Exchange / #Num ändern".
 *
 * moveOrSwapSlot verschiebt (Ziel frei) oder tauscht (Ziel belegt) den Inhalt
 * zwischen zwei Slot-Positionen. slotIndex bleibt (== OSC_0index); der Builder
 * schreibt beim Re-Encode die neue Nummer. Voller Pipeline-Round-Trip beweist,
 * dass ein verschobenes Sample unter der neuen Nummer wieder auftaucht.
 */
import { describe, it, expect } from "vitest";
import {
  bankToOpenedSlots,
  moveOrSwapSlot,
  openedSlotsToBuildInputs,
} from "../../client/src/utils/korg/bankEditorState";
import { buildE2sBank } from "../../client/src/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "../../client/src/utils/korg/e2sBankReader";

function loadedSlots(entries: Array<{ slotIndex: number; name: string }>) {
  const built = buildE2sBank(
    entries.map(e => ({
      slotIndex: e.slotIndex,
      name: e.name,
      pcmData: new Float32Array([0, 0.2, -0.2, 0.1]),
      sampleRate: 44100,
      channels: 1 as const,
    }))
  );
  return bankToOpenedSlots(parseE2sBank(built.buffer));
}

describe("moveOrSwapSlot", () => {
  it("verschiebt auf freie Nummer: Quelle leer, Ziel belegt", () => {
    const slots = loadedSlots([{ slotIndex: 501, name: "A" }]);
    const out = moveOrSwapSlot(slots, "slot-501", 600);
    expect(out[501].empty).toBe(true);
    expect(out[501].isDirty).toBe(true);
    expect(out[600].empty).toBe(false);
    expect(out[600].name).toBe("A");
    expect(out[600].isDirty).toBe(true);
    // rawRiff wurde gelöscht → Re-Encode mit neuer Nummer erzwungen.
    expect(out[600].rawRiff).toBeUndefined();
  });

  it("tauscht bei belegtem Ziel", () => {
    const slots = loadedSlots([
      { slotIndex: 501, name: "A" },
      { slotIndex: 502, name: "B" },
    ]);
    const out = moveOrSwapSlot(slots, "slot-501", 502);
    expect(out[501].name).toBe("B");
    expect(out[502].name).toBe("A");
    expect(out[501].isDirty).toBe(true);
    expect(out[502].isDirty).toBe(true);
  });

  it("No-op bei gleicher Nummer / out-of-range / unbekannter Row", () => {
    const slots = loadedSlots([{ slotIndex: 501, name: "A" }]);
    expect(moveOrSwapSlot(slots, "slot-501", 501)).toBe(slots);
    expect(moveOrSwapSlot(slots, "slot-501", -1)).toBe(slots);
    expect(moveOrSwapSlot(slots, "slot-501", 999999)).toBe(slots);
    expect(moveOrSwapSlot(slots, "nope", 600)).toBe(slots);
  });

  it("No-op wenn Quelle und Ziel beide leer", () => {
    const slots = loadedSlots([{ slotIndex: 501, name: "A" }]);
    expect(moveOrSwapSlot(slots, "slot-10", 20)).toBe(slots);
  });

  it("Pipeline-Round-Trip: Sample erscheint unter der neuen Nummer", () => {
    const slots = loadedSlots([{ slotIndex: 501, name: "Mover" }]);
    const moved = moveOrSwapSlot(slots, "slot-501", 640);
    const { inputs } = openedSlotsToBuildInputs(moved);
    const bank = parseE2sBank(buildE2sBank(inputs).buffer);
    expect(bank.slots[501]).toBeNull();
    expect(bank.slots[640]?.name).toBe("Mover");
    // Die Geräte-Sample-Nummer (esli OSC_0index) folgt der neuen Position.
    expect(bank.slots[640]?.sampleNumber).toBe(640);
  });
});
