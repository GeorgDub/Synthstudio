import { describe, it, expect } from "vitest";
import {
  encodeE2sSlotToWav,
  e2sSampleWavFileName,
  buildE2sSampleWavFiles,
  buildE2sSampleExportManifest,
  bundleE2sSamplesToZip,
  type JSZipCtorLike,
} from "../../client/src/utils/korg/e2sSampleExport";
import type {
  E2sBank,
  E2sSlot,
} from "../../client/src/utils/korg/e2sBankReader";

function slot(
  index: number,
  sampleNumber: number,
  channels: 1 | 2,
  frames: number,
  name = ""
): E2sSlot {
  const len = frames * channels;
  const pcm = new Float32Array(len);
  for (let i = 0; i < len; i++) pcm[i] = Math.sin(i * 0.1) * 0.5;
  return {
    index,
    sampleNumber,
    name,
    category: 2,
    categoryName: "Kick",
    sampleRate: 44100,
    channels,
    frames,
    pcmData: pcm,
    loopType: 0 as E2sSlot["loopType"],
    loopStart: 0,
    loopEnd: frames,
    level: 100,
    gain12db: false,
    sampleTune: 0,
    slices: [],
    sliceSteps: new Uint8Array(64),
    slicingNumSteps: 0,
    slicingBeat: 0,
    slicingNumActive: 0,
  };
}

function bank(slots: Array<E2sSlot | null>): E2sBank {
  return {
    source: "MyBank.all",
    slots,
    offsetTable: new Uint32Array(0),
    trailingBytes: 0,
    warnings: [],
  };
}

const ascii = (b: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...b.subarray(off, off + len));

describe("encodeE2sSlotToWav", () => {
  it("mono → RIFF/WAVE-Header + korrekte Datengröße", () => {
    const wav = encodeE2sSlotToWav(slot(0, 501, 1, 100));
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(wav.length).toBe(44 + 100 * 1 * 2);
  });

  it("stereo → deinterleaved 2 Kanäle (doppelte Datengröße/Frame)", () => {
    const wav = encodeE2sSlotToWav(slot(1, 502, 2, 100));
    expect(wav.length).toBe(44 + 100 * 2 * 2);
  });
});

describe("e2sSampleWavFileName", () => {
  it("sampleNumber zero-padded + Name + _st bei Stereo", () => {
    expect(e2sSampleWavFileName(slot(0, 501, 1, 10, "Kick 1"))).toBe(
      "501_Kick_1.wav"
    );
    expect(e2sSampleWavFileName(slot(1, 777, 2, 10, "Loop"))).toBe(
      "777_Loop_st.wav"
    );
  });

  it("Duplikate → _2/_3 via seen-Set", () => {
    const seen = new Set<string>();
    expect(e2sSampleWavFileName(slot(0, 501, 1, 10, "Hat"), seen)).toBe(
      "501_Hat.wav"
    );
    expect(e2sSampleWavFileName(slot(1, 501, 1, 10, "Hat"), seen)).toBe(
      "501_Hat_2.wav"
    );
  });
});

describe("buildE2sSampleWavFiles", () => {
  it("überspringt null + leere Slots, eindeutige Namen", () => {
    const empty = slot(9, 999, 1, 0, "Empty");
    empty.pcmData = new Float32Array(0);
    const files = buildE2sSampleWavFiles(
      bank([slot(0, 501, 1, 20, "A"), null, empty, slot(3, 700, 2, 20, "B")])
    );
    expect(files.map(f => f.sampleNumber)).toEqual([501, 700]);
    expect(files[1].fileName).toBe("700_B_st.wav");
    expect(ascii(files[0].bytes, 0, 4)).toBe("RIFF");
  });
});

describe("buildE2sSampleExportManifest", () => {
  it("spiegelt name/category/channels/rate/frames", () => {
    const b = bank([slot(0, 501, 2, 30, "A")]);
    const files = buildE2sSampleWavFiles(b);
    const man = buildE2sSampleExportManifest(b, files);
    expect(man.sampleCount).toBe(1);
    expect(man.samples[0]).toMatchObject({
      sampleNumber: 501,
      name: "A",
      category: "Kick",
      channels: 2,
      frames: 30,
    });
  });
});

describe("bundleE2sSamplesToZip", () => {
  it("packt WAVs + manifest.json via injizierten JSZip-Mock", async () => {
    const added: string[] = [];
    const MockZip: JSZipCtorLike = class {
      file(name: string) {
        added.push(name);
      }
      async generateAsync() {
        return new ArrayBuffer(64);
      }
    } as unknown as JSZipCtorLike;
    const res = await bundleE2sSamplesToZip(
      bank([slot(0, 501, 1, 20, "A"), slot(1, 700, 2, 20, "B")]),
      MockZip
    );
    expect(res.sampleCount).toBe(2);
    expect(res.fileName).toBe("MyBank_samples.zip");
    expect(added).toContain("501_A.wav");
    expect(added).toContain("700_B_st.wav");
    expect(added).toContain("manifest.json");
  });
});
