/**
 * e2s-sample-tune.test.ts — Round-Trip für OSC_SampleTune (esli +0x55, i8).
 *
 * Audit-Fix (Oe2sSLE): der Reader dekodierte den Tune-Wert vorher NICHT
 * (bankToOpenedSlots hartkodierte 0), obwohl der Builder ihn schreibt → Tune
 * ging beim Laden/Editieren verloren. Diese Tests beweisen den Round-Trip über
 * buildE2sBank → parseE2sBank für positive, negative und geclampte Werte.
 */
import { describe, it, expect } from "vitest";
import { buildE2sBank, type E2sSlotInput } from "@/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "@/utils/korg/e2sBankReader";

function bankWithTune(tune: number) {
  const inputs: E2sSlotInput[] = [
    {
      slotIndex: 0,
      name: "TuneA",
      pcmData: new Float32Array(32),
      sampleRate: 44100,
      channels: 1,
      sampleTune: tune,
    },
  ];
  const built = buildE2sBank(inputs);
  const bank = parseE2sBank(built.buffer, "t.all");
  return bank.slots.find(s => s && s.name === "TuneA") ?? null;
}

describe("E2S sampleTune round-trip", () => {
  it("positiver Tune wird zurückgelesen", () => {
    expect(bankWithTune(12)?.sampleTune).toBe(12);
  });

  it("negativer Tune (i8 sign) wird korrekt zurückgelesen", () => {
    expect(bankWithTune(-7)?.sampleTune).toBe(-7);
  });

  it("Tune 0 (kein Tune)", () => {
    expect(bankWithTune(0)?.sampleTune).toBe(0);
  });

  it("Werte über +63 werden auf +63 geclampt (Oe2sSLE-Range)", () => {
    expect(bankWithTune(120)?.sampleTune).toBe(63);
  });

  it("Werte unter -63 werden auf -63 geclampt", () => {
    expect(bankWithTune(-120)?.sampleTune).toBe(-63);
  });
});
