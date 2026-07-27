import { describe, it, expect } from "vitest";
import {
  encodeEsxSampleToWav,
  buildEsxSampleWavMap,
} from "../../client/src/utils/korg/esxSampleWav";
import type { EsxBank, EsxSample } from "../../client/src/utils/korg/esxParser";

function sample(index: number, channels: 1 | 2, frames: number): EsxSample {
  const len = frames * channels;
  const pcm = new Float32Array(len);
  for (let i = 0; i < len; i++) pcm[i] = Math.sin(i * 0.1) * 0.5;
  return {
    index,
    name: `S${index}`,
    channels,
    sampleRate: 44100,
    frames,
    pcmData: pcm,
    loopStart: 0,
    loopEnd: frames,
    level: 100,
  };
}

const ascii = (b: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...b.subarray(off, off + len));

describe("encodeEsxSampleToWav", () => {
  it("mono → gültiger WAV-Header (RIFF/WAVE) + korrekte Datengröße", () => {
    const wav = encodeEsxSampleToWav(sample(0, 1, 100));
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    // 44-Byte Header + 100 Frames × 1 Kanal × 2 Byte (16-bit) = 244
    expect(wav.length).toBe(44 + 100 * 1 * 2);
  });

  it("stereo → 2 Kanäle, deinterleaved (doppelte Datengröße pro Frame)", () => {
    const wav = encodeEsxSampleToWav(sample(1, 2, 100));
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    // 100 Frames × 2 Kanäle × 2 Byte = 400 Datenbytes
    expect(wav.length).toBe(44 + 100 * 2 * 2);
  });

  it("fällt bei ungültiger Sample-Rate auf 44100 zurück (kein Throw)", () => {
    const s = sample(2, 1, 10);
    s.sampleRate = 0;
    expect(() => encodeEsxSampleToWav(s)).not.toThrow();
  });
});

describe("buildEsxSampleWavMap", () => {
  const bank: EsxBank = {
    source: "t.esx",
    monoSamples: [sample(0, 1, 50), sample(5, 1, 30)],
    stereoSamples: [sample(256, 2, 40)],
    patterns: [],
    songs: [],
    declaredMonoCount: 2,
    declaredStereoCount: 1,
    warnings: [],
  };

  it("keyed by sampleId (Slot-Index), enthält mono + stereo", () => {
    const map = buildEsxSampleWavMap(bank);
    expect(map.size).toBe(3);
    expect(map.has(0)).toBe(true);
    expect(map.has(5)).toBe(true);
    expect(map.has(256)).toBe(true);
    expect(ascii(map.get(5)!, 0, 4)).toBe("RIFF");
  });

  it("überspringt leere Samples (kein PCM)", () => {
    const empty = sample(9, 1, 0);
    empty.pcmData = new Float32Array(0);
    const map = buildEsxSampleWavMap({ ...bank, monoSamples: [empty] });
    expect(map.has(9)).toBe(false);
  });
});
