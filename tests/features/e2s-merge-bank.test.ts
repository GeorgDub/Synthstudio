/**
 * e2s-merge-bank.test.ts — Oe2sSLE „Import e2sSample.all" (Merge).
 *
 * mergeE2sBankIntoOpenedSlots platziert die Samples einer zweiten Bank in die
 * nächsten freien Slots ab einer Start-Nummer. Voller Pipeline-Round-Trip
 * beweist, dass die gemergten Samples unter ihren neuen Nummern gebaut werden.
 */
import { describe, it, expect } from "vitest";
import {
  bankToOpenedSlots,
  mergeE2sBankIntoOpenedSlots,
  openedSlotsToBuildInputs,
} from "../../client/src/utils/korg/bankEditorState";
import { buildE2sBank } from "../../client/src/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "../../client/src/utils/korg/e2sBankReader";

function buildBank(entries: Array<{ slotIndex: number; name: string }>) {
  return buildE2sBank(
    entries.map(e => ({
      slotIndex: e.slotIndex,
      name: e.name,
      pcmData: new Float32Array([0, 0.2, -0.2, 0.1]),
      sampleRate: 44100,
      channels: 1 as const,
    }))
  ).buffer;
}

/** Editor-Slots aus einer frisch gebauten Bank. */
function opened(entries: Array<{ slotIndex: number; name: string }>) {
  return bankToOpenedSlots(parseE2sBank(buildBank(entries)));
}

/** Reader-Slots (Import-Quelle) aus einer frisch gebauten Bank. */
function importedSlots(entries: Array<{ slotIndex: number; name: string }>) {
  return parseE2sBank(buildBank(entries)).slots;
}

describe("mergeE2sBankIntoOpenedSlots", () => {
  it("platziert importierte Samples in freie Slots ab fromNumber", () => {
    const current = opened([{ slotIndex: 501, name: "Cur" }]);
    const imported = importedSlots([
      { slotIndex: 600, name: "ImpA" },
      { slotIndex: 601, name: "ImpB" },
    ]);
    const res = mergeE2sBankIntoOpenedSlots(current, imported, 502);
    expect(res.merged).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.slots[501].name).toBe("Cur");
    expect(res.slots[502].name).toBe("ImpA");
    expect(res.slots[503].name).toBe("ImpB");
    expect(res.slots[502].isDirty).toBe(true);
    expect(res.slots[502].rawRiff).toBeUndefined();
  });

  it("überspringt, wenn keine freien Slots mehr im Bereich sind", () => {
    const current = opened([{ slotIndex: 1019, name: "X" }]);
    const imported = importedSlots([
      { slotIndex: 600, name: "A" },
      { slotIndex: 601, name: "B" },
    ]);
    // Ab 1019: nur Slot 1019, der belegt ist → keine freien.
    const res = mergeE2sBankIntoOpenedSlots(current, imported, 1019);
    expect(res.merged).toBe(0);
    expect(res.skipped).toBe(2);
    expect(res.slots).toBe(current); // ref-stabil bei 0 merges
  });

  it("Pipeline-Round-Trip: gemergte Samples erscheinen unter neuen Nummern", () => {
    const current = opened([{ slotIndex: 501, name: "Cur" }]);
    const imported = importedSlots([{ slotIndex: 700, name: "Merged" }]);
    const res = mergeE2sBankIntoOpenedSlots(current, imported, 510);
    const { inputs } = openedSlotsToBuildInputs(res.slots);
    const bank = parseE2sBank(buildE2sBank(inputs).buffer);
    expect(bank.slots[501]?.name).toBe("Cur");
    expect(bank.slots[510]?.name).toBe("Merged");
    expect(bank.slots[510]?.sampleNumber).toBe(510);
  });
});
