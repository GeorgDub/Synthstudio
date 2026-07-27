import { describe, it, expect } from "vitest";
import {
  esxSampleWavFileName,
  buildEsxSampleWavFiles,
  buildEsxSampleExportManifest,
  bundleEsxSamplesToZip,
  type JSZipCtorLike,
} from "../../client/src/utils/korg/esxSampleExport";
import type { EsxBank, EsxSample } from "../../client/src/utils/korg/esxParser";

function sample(
  index: number,
  channels: 1 | 2,
  frames: number,
  name = ""
): EsxSample {
  const len = frames * channels;
  const pcm = new Float32Array(len);
  for (let i = 0; i < len; i++) pcm[i] = Math.sin(i * 0.1) * 0.5;
  return {
    index,
    name,
    channels,
    sampleRate: 44100,
    frames,
    pcmData: pcm,
    loopStart: 0,
    loopEnd: frames,
    level: 100,
  };
}

function bank(mono: EsxSample[], stereo: EsxSample[]): EsxBank {
  return {
    source: "MyBank.esx",
    monoSamples: mono,
    stereoSamples: stereo,
    patterns: [],
    songs: [],
    declaredMonoCount: mono.length,
    declaredStereoCount: stereo.length,
    warnings: [],
  };
}

describe("esxSampleWavFileName", () => {
  it("zero-padded Slot-Index + sanitisierter Name, Stereo mit _st", () => {
    expect(esxSampleWavFileName(sample(3, 1, 10, "Kick 1"))).toBe(
      "003_Kick_1.wav"
    );
    expect(esxSampleWavFileName(sample(256, 2, 10, "Loop"))).toBe(
      "256_Loop_st.wav"
    );
  });

  it("leerer Name → slot-Fallback", () => {
    expect(esxSampleWavFileName(sample(7, 1, 10, ""))).toBe("007_slot.wav");
  });

  it("Duplikate bekommen _2/_3 via seen-Set", () => {
    const seen = new Set<string>();
    const a = esxSampleWavFileName(sample(1, 1, 10, "Hat"), seen);
    const b = esxSampleWavFileName(sample(1, 1, 10, "Hat"), seen);
    expect(a).toBe("001_Hat.wav");
    expect(b).toBe("001_Hat_2.wav");
  });
});

describe("buildEsxSampleWavFiles", () => {
  it("mono zuerst dann stereo, überspringt leere, eindeutige Namen", () => {
    const empty = sample(9, 1, 0, "Empty");
    empty.pcmData = new Float32Array(0);
    const files = buildEsxSampleWavFiles(
      bank([sample(0, 1, 20, "A"), empty], [sample(256, 2, 20, "B")])
    );
    expect(files.map(f => f.sampleId)).toEqual([0, 256]);
    expect(files[0].fileName).toBe("000_A.wav");
    expect(files[1].fileName).toBe("256_B_st.wav");
    // WAV-Header prüfen
    expect(String.fromCharCode(...files[0].bytes.subarray(0, 4))).toBe("RIFF");
  });
});

describe("buildEsxSampleExportManifest", () => {
  it("spiegelt Kanal/Rate/Frames pro exportiertem Sample", () => {
    const b = bank([sample(0, 1, 20, "A")], [sample(256, 2, 30, "B")]);
    const files = buildEsxSampleWavFiles(b);
    const man = buildEsxSampleExportManifest(b, files);
    expect(man.source).toBe("MyBank.esx");
    expect(man.sampleCount).toBe(2);
    expect(man.samples[1]).toMatchObject({
      sampleId: 256,
      channels: 2,
      sampleRate: 44100,
      frames: 30,
    });
  });
});

describe("bundleEsxSamplesToZip", () => {
  it("packt WAVs + manifest.json über injizierten JSZip-Mock", async () => {
    const added: string[] = [];
    const MockZip: JSZipCtorLike = class {
      file(name: string) {
        added.push(name);
      }
      async generateAsync() {
        return new ArrayBuffer(128);
      }
    } as unknown as JSZipCtorLike;

    const res = await bundleEsxSamplesToZip(
      bank([sample(0, 1, 20, "A")], [sample(256, 2, 20, "B")]),
      MockZip
    );
    expect(res.sampleCount).toBe(2);
    expect(res.fileName).toBe("MyBank_samples.zip");
    expect(res.byteSize).toBe(128);
    expect(added).toContain("000_A.wav");
    expect(added).toContain("256_B_st.wav");
    expect(added).toContain("manifest.json");
  });
});
