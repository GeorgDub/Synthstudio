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

function bankWithLevel(level: number) {
  const inputs: E2sSlotInput[] = [
    {
      slotIndex: 0,
      name: "LvlA",
      pcmData: new Float32Array(32),
      sampleRate: 44100,
      channels: 1,
      level,
    },
  ];
  const built = buildE2sBank(inputs);
  const bank = parseE2sBank(built.buffer, "t.all");
  return bank.slots.find(s => s && s.name === "LvlA") ?? null;
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

describe("E2S level round-trip (playVolume)", () => {
  // Level 0..127 ↔ playVolume 0..65535 hat ±1 Rundungsverlust durch die
  // zwei floor-Skalierungen — wir prüfen, dass der Wert erhalten bleibt
  // (nicht auf Builder-Default 127 zurückfällt), mit ±1 Toleranz.
  it("mittlerer Level bleibt erhalten (±1)", () => {
    const lvl = bankWithLevel(64)?.level ?? -1;
    expect(Math.abs(lvl - 64)).toBeLessThanOrEqual(1);
  });

  it("Max-Level 127 → 127", () => {
    expect(bankWithLevel(127)?.level).toBe(127);
  });

  it("hoher Level (100) bleibt hoch, nicht Default", () => {
    const lvl = bankWithLevel(100)?.level ?? -1;
    expect(Math.abs(lvl - 100)).toBeLessThanOrEqual(1);
  });
});

describe("E2S loop-point byte↔frame convention", () => {
  // Builder: End_byte = loopEndBytes - frameBytes (Oe2sSLE: End = letzter Frame).
  // Reader: loopEnd(frames) = End_byte / frameBytes. Also round-trippt
  //   loopStartBytes = startFrame * frameBytes
  //   loopEndBytes   = (endFrame + 1) * frameBytes
  it("Loop-Punkte (Frames) round-trippen über build→parse (mono)", () => {
    const frameBytes = 2; // mono 16-bit
    const startFrame = 8;
    const endFrame = 40;
    const inputs: E2sSlotInput[] = [
      {
        slotIndex: 0,
        name: "LoopA",
        pcmData: new Float32Array(64),
        sampleRate: 44100,
        channels: 1,
        loopType: 2, // forward loop
        loopStartBytes: startFrame * frameBytes,
        loopEndBytes: (endFrame + 1) * frameBytes,
      },
    ];
    const built = buildE2sBank(inputs);
    const slot = parseE2sBank(built.buffer, "t.all").slots.find(
      s => s && s.name === "LoopA"
    );
    expect(slot?.loopStart).toBe(startFrame);
    expect(slot?.loopEnd).toBe(endFrame);
  });
});
