import { describe, it, expect } from "vitest";
import {
  buildSmplChunk,
  buildCueChunk,
  appendWavChunks,
} from "../../client/src/utils/korg/e2sWavChunks";
import { encodeE2sSlotToWav } from "../../client/src/utils/korg/e2sSampleExport";
import type { E2sSlot } from "../../client/src/utils/korg/e2sBankReader";

const ascii = (b: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...b.subarray(off, off + len));

/** Findet einen RIFF-Chunk in einer WAV (nach 'WAVE') und liefert dessen Offset. */
function findChunk(wav: Uint8Array, id: string): number {
  let pos = 12; // 'RIFF' + size + 'WAVE'
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  while (pos + 8 <= wav.length) {
    const cid = ascii(wav, pos, 4);
    const size = dv.getUint32(pos + 4, true);
    if (cid === id) return pos;
    pos += 8 + size + (size & 1);
  }
  return -1;
}

describe("buildSmplChunk", () => {
  it("Header + Größe + samplePeriod + Loop-Grenzen", () => {
    const c = buildSmplChunk(44100, 100, 500);
    const dv = new DataView(c.buffer);
    expect(ascii(c, 0, 4)).toBe("smpl");
    expect(dv.getUint32(4, true)).toBe(60); // body = 36 + 24
    expect(c.length).toBe(68);
    expect(dv.getUint32(16, true)).toBe(Math.round(1e9 / 44100)); // samplePeriod
    expect(dv.getUint32(36, true)).toBe(1); // numSampleLoops
    expect(dv.getUint32(52, true)).toBe(100); // loop start
    expect(dv.getUint32(56, true)).toBe(500); // loop end
  });
});

describe("buildCueChunk", () => {
  it("N Cue-Punkte, Position = sampleOffset", () => {
    const c = buildCueChunk([{ position: 10 }, { position: 250 }]);
    const dv = new DataView(c.buffer);
    expect(ascii(c, 0, 4)).toBe("cue ");
    expect(dv.getUint32(8, true)).toBe(2); // numCuePoints
    expect(c.length).toBe(8 + 4 + 2 * 24);
    // Erster Cue: position @ +4, sampleOffset @ +20 (relativ zum Cue-Record @ 12)
    expect(dv.getUint32(12 + 4, true)).toBe(10);
    expect(dv.getUint32(12 + 20, true)).toBe(10);
    expect(ascii(c, 12 + 8, 4)).toBe("data");
    // Zweiter Cue
    expect(dv.getUint32(36 + 4, true)).toBe(250);
  });
});

describe("appendWavChunks", () => {
  it("hängt an + korrigiert RIFF-Größe", () => {
    const base = new Uint8Array(44);
    base.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    const extra = new Uint8Array(8);
    const out = appendWavChunks(base, [extra]);
    expect(out.length).toBe(52);
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(52 - 8);
  });
});

function slot(overrides: Partial<E2sSlot>): E2sSlot {
  return {
    index: 0,
    sampleNumber: 501,
    name: "S",
    category: 2,
    categoryName: "Kick",
    sampleRate: 44100,
    channels: 1,
    frames: 100,
    pcmData: new Float32Array(100),
    loopType: 2 as E2sSlot["loopType"],
    loopStart: 0,
    loopEnd: 0,
    level: 100,
    gain12db: false,
    sampleTune: 0,
    slices: [],
    sliceSteps: new Uint8Array(64),
    slicingNumSteps: 0,
    slicingBeat: 0,
    slicingNumActive: 0,
    ...overrides,
  };
}

describe("encodeE2sSlotToWav — smpl/cue opt-in", () => {
  it("ohne opts → keine Extra-Chunks (Basis-WAV)", () => {
    const wav = encodeE2sSlotToWav(slot({ loopStart: 10, loopEnd: 80 }));
    expect(findChunk(wav, "smpl")).toBe(-1);
    expect(findChunk(wav, "cue ")).toBe(-1);
  });

  it("smpl:true + echter Loop → smpl-Chunk vorhanden", () => {
    const wav = encodeE2sSlotToWav(slot({ loopStart: 10, loopEnd: 80 }), {
      smpl: true,
    });
    const off = findChunk(wav, "smpl");
    expect(off).toBeGreaterThan(0);
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(dv.getUint32(off + 8 + 44, true)).toBe(10); // loop start im smpl
  });

  it("smpl:true aber kein Loop (loopEnd<=loopStart) → kein smpl", () => {
    const wav = encodeE2sSlotToWav(slot({ loopStart: 0, loopEnd: 0 }), {
      smpl: true,
    });
    expect(findChunk(wav, "smpl")).toBe(-1);
  });

  it("cue:true + Slices → cue-Chunk mit passenden Positionen", () => {
    const wav = encodeE2sSlotToWav(
      slot({
        slices: [
          { start: 5, length: 10, attackLength: 0, amplitude: 0 },
          { start: 40, length: 10, attackLength: 0, amplitude: 0 },
        ],
      }),
      { cue: true }
    );
    const off = findChunk(wav, "cue ");
    expect(off).toBeGreaterThan(0);
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(dv.getUint32(off + 8, true)).toBe(2); // 2 cues
  });
});
