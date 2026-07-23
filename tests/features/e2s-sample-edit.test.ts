import { describe, it, expect } from "vitest";
import { trimE2sSlotPcm } from "../../client/src/utils/korg/e2sSampleEdit";
import {
  bankToOpenedSlots,
  openedSlotsToBuildInputs,
  patchOpenedSlot,
} from "../../client/src/utils/korg/bankEditorState";
import { buildE2sBank } from "../../client/src/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "../../client/src/utils/korg/e2sBankReader";

describe("trimE2sSlotPcm — mono", () => {
  const mono = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // 10 frames

  it("schneidet auf [2,5] → 4 Frames mit korrekten Samples", () => {
    const r = trimE2sSlotPcm(mono, 1, 2, 5);
    expect(r.frames).toBe(4);
    expect(Array.from(r.pcmData)).toEqual([2, 3, 4, 5]);
  });

  it("ganzes Sample [0,9] → No-op (gleiche Referenz)", () => {
    const r = trimE2sSlotPcm(mono, 1, 0, 9);
    expect(r.frames).toBe(10);
    expect(r.pcmData).toBe(mono);
  });

  it("out-of-range wird geklemmt", () => {
    const r = trimE2sSlotPcm(mono, 1, -5, 999);
    expect(r.frames).toBe(10);
    expect(r.pcmData).toBe(mono); // 0..9 = ganzes Sample → No-op
  });

  it("start > end → getauscht", () => {
    const r = trimE2sSlotPcm(mono, 1, 6, 3);
    expect(Array.from(r.pcmData)).toEqual([3, 4, 5, 6]);
  });
});

describe("trimE2sSlotPcm — stereo (interleaved)", () => {
  // 4 Frames: (L,R) = (0,10),(1,11),(2,12),(3,13)
  const stereo = Float32Array.from([0, 10, 1, 11, 2, 12, 3, 13]);

  it("schneidet Frame [1,2] → 2 Frames, beide Kanäle korrekt", () => {
    const r = trimE2sSlotPcm(stereo, 2, 1, 2);
    expect(r.frames).toBe(2);
    expect(Array.from(r.pcmData)).toEqual([1, 11, 2, 12]);
  });
});

describe("trimE2sSlotPcm — edge cases", () => {
  it("leeres PCM → 0 Frames, kein Throw", () => {
    const r = trimE2sSlotPcm(new Float32Array(0), 1, 0, 10);
    expect(r.frames).toBe(0);
    expect(r.pcmData.length).toBe(0);
  });

  it("Single-Frame-Trim funktioniert", () => {
    const r = trimE2sSlotPcm(Float32Array.from([9, 8, 7]), 1, 1, 1);
    expect(r.frames).toBe(1);
    expect(Array.from(r.pcmData)).toEqual([8]);
  });
});

describe("Trim → build → parse (voller Pipeline-Round-Trip)", () => {
  it("getrimmtes Sample wird kürzer re-encoded", () => {
    const frames = 64;
    const pcm = new Float32Array(frames);
    for (let i = 0; i < frames; i++) pcm[i] = Math.sin(i * 0.2) * 0.5;
    // Bank bauen, laden, Slot 0 auf [10,29] trimmen.
    const built = buildE2sBank([
      {
        slotIndex: 0,
        name: "Trimmy",
        pcmData: pcm,
        sampleRate: 44100,
        channels: 1,
      },
    ]);
    const slots = bankToOpenedSlots(parseE2sBank(built.buffer));
    const row = slots.find(s => !s.empty)!;
    const trimmed = trimE2sSlotPcm(row.pcmData!, 1, 10, 29); // 20 Frames
    expect(trimmed.frames).toBe(20);
    const edited = patchOpenedSlot(slots, row.rowId, {
      pcmData: trimmed.pcmData,
      frames: trimmed.frames,
      loopStart: 0,
      loopEnd: trimmed.frames - 1,
    });
    const { inputs } = openedSlotsToBuildInputs(edited);
    const back = parseE2sBank(buildE2sBank(inputs).buffer).slots.find(
      s => s && s.name === "Trimmy"
    )!;
    expect(back.frames).toBe(20);
    expect(back.loopEnd).toBe(19);
  });
});
