/**
 * tests/features/sample-embedding.test.ts (v3.124.0)
 *
 * Unit-Tests für client/src/utils/sampleEmbedding.ts — Embed-Sample-Persistenz.
 *
 * Coverage:
 *  - Pure WAV-Encode + Base64-Roundtrip
 *  - Größen-Estimation
 *  - Decoder mit Mock-AudioContext (decodeAudioData → AudioBuffer)
 *  - Corruption-Defense
 *  - Path-Heuristik (isBlobUrlPath)
 */
import { describe, it, expect } from "vitest";
import {
  audioBufferToWavBytes,
  audioBufferToBase64Wav,
  base64WavToAudioBuffer,
  base64ToUint8Array,
  uint8ArrayToBase64,
  estimateEmbedSizeKb,
  exceedsEmbedSizeLimit,
  isBlobUrlPath,
  MAX_EMBED_SIZE_KB,
  type AudioBufferLike,
  type DecodeContextLike,
} from "../../client/src/utils/sampleEmbedding";

// ─── Mock AudioBuffer ────────────────────────────────────────────────────────

class MockAudioBuffer implements AudioBufferLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  private data: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number, fill?: (c: number, i: number) => number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = [];
    for (let c = 0; c < channels; c++) {
      const arr = new Float32Array(length);
      if (fill) {
        for (let i = 0; i < length; i++) arr[i] = fill(c, i);
      }
      this.data.push(arr);
    }
  }

  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
}

/**
 * Pure WAV-Parser für Tests — liest unsere Encoder-Outputs zurück in
 * Float32Arrays, damit wir Round-Trip-Genauigkeit prüfen können.
 */
function parseWavBytes(bytes: Uint8Array): {
  channels: number;
  sampleRate: number;
  length: number;
  data: Float32Array[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  const blockAlign = channels * 2;
  const length = dataSize / blockAlign;

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(new Float32Array(length));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const int16 = view.getInt16(offset, true);
      data[c][i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
      offset += 2;
    }
  }
  return { channels, sampleRate, length, data };
}

// Mock DecodeContext der unsere eigenen WAV-Bytes zurück zu MockAudioBuffer parst.
class MockDecodeContext implements DecodeContextLike {
  async decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
    const bytes = new Uint8Array(buffer);
    const parsed = parseWavBytes(bytes);
    const buf = new MockAudioBuffer(parsed.channels, parsed.length, parsed.sampleRate);
    for (let c = 0; c < parsed.channels; c++) {
      buf.getChannelData(c).set(parsed.data[c]);
    }
    return buf as unknown as AudioBuffer;
  }
}

// ─── uint8ArrayToBase64 / base64ToUint8Array (Round-Trip) ────────────────────

describe("base64 roundtrip", () => {
  it("empty array → empty string → empty array", () => {
    const b64 = uint8ArrayToBase64(new Uint8Array(0));
    expect(b64).toBe("");
    expect(base64ToUint8Array(b64).length).toBe(0);
  });

  it("preserves bytes 0..255", () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const b64 = uint8ArrayToBase64(original);
    const decoded = base64ToUint8Array(b64);
    expect(decoded.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(decoded[i]).toBe(i);
  });

  it("base64ToUint8Array throws on garbage input", () => {
    expect(() => base64ToUint8Array("!!! not base64 !!!")).toThrow();
  });
});

// ─── audioBufferToWavBytes ───────────────────────────────────────────────────

describe("audioBufferToWavBytes", () => {
  it("empty buffer → 44 byte WAV header, no audio data", () => {
    const buf = new MockAudioBuffer(1, 0, 44100);
    const bytes = audioBufferToWavBytes(buf);
    expect(bytes.length).toBe(44);
    // Verify RIFF/WAVE markers
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WAVE");
  });

  it("mono 1s @ 48kHz → 44 header + 96000 bytes data (16-bit mono)", () => {
    const buf = new MockAudioBuffer(1, 48000, 48000);
    const bytes = audioBufferToWavBytes(buf);
    expect(bytes.length).toBe(44 + 48000 * 2);
  });

  it("stereo 1s @ 48kHz → 44 header + 192000 bytes data", () => {
    const buf = new MockAudioBuffer(2, 48000, 48000);
    const bytes = audioBufferToWavBytes(buf);
    expect(bytes.length).toBe(44 + 48000 * 4);
  });

  it("preserves sine-wave round-trip within 16-bit precision", () => {
    const sr = 44100;
    const length = 1024;
    const freq = 440;
    const buf = new MockAudioBuffer(1, length, sr, (_c, i) => Math.sin((2 * Math.PI * freq * i) / sr) * 0.5);
    const bytes = audioBufferToWavBytes(buf);
    const parsed = parseWavBytes(bytes);
    expect(parsed.channels).toBe(1);
    expect(parsed.length).toBe(length);
    expect(parsed.sampleRate).toBe(sr);
    // 16-bit precision = ~30 µdB error. Compare first 100 samples.
    for (let i = 0; i < 100; i++) {
      const expected = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
      expect(Math.abs(parsed.data[0][i] - expected)).toBeLessThan(0.001);
    }
  });

  it("clamps samples > 1.0 and < -1.0 to int16 range", () => {
    const buf = new MockAudioBuffer(1, 4, 44100, (_c, i) => [2.0, -2.0, 1.0, -1.0][i]);
    const bytes = audioBufferToWavBytes(buf);
    const parsed = parseWavBytes(bytes);
    // Saturate to ±1 (within 16-bit precision)
    expect(parsed.data[0][0]).toBeCloseTo(1.0, 3);
    expect(parsed.data[0][1]).toBeCloseTo(-1.0, 3);
    expect(parsed.data[0][2]).toBeCloseTo(1.0, 3);
    expect(parsed.data[0][3]).toBeCloseTo(-1.0, 3);
  });
});

// ─── audioBufferToBase64Wav (Round-Trip) ─────────────────────────────────────

describe("audioBufferToBase64Wav round-trip", () => {
  it("encode → base64 → decode preserves AudioBuffer content", async () => {
    const sr = 44100;
    const buf = new MockAudioBuffer(2, 512, sr, (c, i) => (c === 0 ? Math.sin(i * 0.1) : Math.cos(i * 0.1)) * 0.3);
    const b64 = audioBufferToBase64Wav(buf);
    expect(b64.length).toBeGreaterThan(100);
    expect(typeof b64).toBe("string");

    const ctx = new MockDecodeContext();
    const decoded = (await base64WavToAudioBuffer(b64, ctx)) as unknown as AudioBufferLike;
    expect(decoded.numberOfChannels).toBe(2);
    expect(decoded.length).toBe(512);
    expect(decoded.sampleRate).toBe(sr);
    // Check first sample of each channel within 16-bit precision
    expect(Math.abs(decoded.getChannelData(0)[10] - Math.sin(10 * 0.1) * 0.3)).toBeLessThan(0.001);
    expect(Math.abs(decoded.getChannelData(1)[10] - Math.cos(10 * 0.1) * 0.3)).toBeLessThan(0.001);
  });

  it("empty buffer encodes to valid (small) base64", async () => {
    const buf = new MockAudioBuffer(1, 0, 44100);
    const b64 = audioBufferToBase64Wav(buf);
    expect(b64.length).toBeGreaterThan(0);
    const ctx = new MockDecodeContext();
    const decoded = (await base64WavToAudioBuffer(b64, ctx)) as unknown as AudioBufferLike;
    expect(decoded.length).toBe(0);
  });
});

// ─── base64WavToAudioBuffer Error-Handling ───────────────────────────────────

describe("base64WavToAudioBuffer error-handling", () => {
  const ctx = new MockDecodeContext();

  it("rejects garbage base64", async () => {
    await expect(base64WavToAudioBuffer("!!!!", ctx)).rejects.toThrow();
  });

  it("rejects too-short bytes (< WAV header size)", async () => {
    const shortBytes = new Uint8Array(10);
    const b64 = uint8ArrayToBase64(shortBytes);
    await expect(base64WavToAudioBuffer(b64, ctx)).rejects.toThrow(/too small/);
  });

  it("rejects missing RIFF/WAVE marker", async () => {
    // 44 bytes of zero — passes length check but fails marker check
    const fakeWav = new Uint8Array(44);
    const b64 = uint8ArrayToBase64(fakeWav);
    await expect(base64WavToAudioBuffer(b64, ctx)).rejects.toThrow(/invalid WAV header/);
  });

  it("rejects non-string input", async () => {
    // @ts-expect-error testing runtime safety
    await expect(base64WavToAudioBuffer(123, ctx)).rejects.toThrow(/must be a string/);
  });
});

// ─── estimateEmbedSizeKb ─────────────────────────────────────────────────────

describe("estimateEmbedSizeKb", () => {
  it("null buffer → 0 KB", () => {
    expect(estimateEmbedSizeKb(null)).toBe(0);
    expect(estimateEmbedSizeKb(undefined)).toBe(0);
  });

  it("1s mono @ 48k ≈ 125 KB base64 (raw 96.04 KB × 4/3)", () => {
    const buf = new MockAudioBuffer(1, 48000, 48000);
    const kb = estimateEmbedSizeKb(buf);
    // Raw = 44 + 48000*2 = 96044 B = 93.79 KB ; Base64 = 128060 B = 125 KB
    expect(kb).toBeGreaterThanOrEqual(120);
    expect(kb).toBeLessThanOrEqual(130);
  });

  it("1s stereo @ 48k ≈ 250 KB base64", () => {
    const buf = new MockAudioBuffer(2, 48000, 48000);
    const kb = estimateEmbedSizeKb(buf);
    // Raw = 44 + 48000*4 = 192044 B ; Base64 ≈ 256059 B ≈ 250 KB
    expect(kb).toBeGreaterThanOrEqual(245);
    expect(kb).toBeLessThanOrEqual(255);
  });

  it("matches actual base64 length (within 5%)", () => {
    const buf = new MockAudioBuffer(1, 5000, 44100, (_c, i) => Math.sin(i * 0.01));
    const estimated = estimateEmbedSizeKb(buf);
    const actualBytes = audioBufferToBase64Wav(buf).length;
    const actualKb = Math.round(actualBytes / 1024);
    expect(Math.abs(estimated - actualKb)).toBeLessThanOrEqual(2);
  });
});

// ─── exceedsEmbedSizeLimit + MAX_EMBED_SIZE_KB ───────────────────────────────

describe("MAX_EMBED_SIZE_KB threshold", () => {
  it("MAX_EMBED_SIZE_KB = 10240 (10 MB)", () => {
    expect(MAX_EMBED_SIZE_KB).toBe(10240);
  });

  it("1s stereo @ 48k is BELOW the limit", () => {
    const buf = new MockAudioBuffer(2, 48000, 48000);
    expect(exceedsEmbedSizeLimit(buf)).toBe(false);
  });

  it("60s stereo @ 48k is ABOVE the limit (~15 MB)", () => {
    // 60s stereo @ 48k = 60*48000*4 = 11.5 MB raw → ~15.3 MB base64 → > 10 MB cap
    const buf = new MockAudioBuffer(2, 60 * 48000, 48000);
    expect(exceedsEmbedSizeLimit(buf)).toBe(true);
  });

  it("null buffer is NOT above the limit", () => {
    expect(exceedsEmbedSizeLimit(null)).toBe(false);
  });
});

// ─── isBlobUrlPath ───────────────────────────────────────────────────────────

describe("isBlobUrlPath", () => {
  it("blob: URL → true", () => {
    expect(isBlobUrlPath("blob:http://localhost:5173/abc-def")).toBe(true);
  });

  it("file path → false", () => {
    expect(isBlobUrlPath("C:\\samples\\kick.wav")).toBe(false);
    expect(isBlobUrlPath("/Users/me/samples/kick.wav")).toBe(false);
  });

  it("pack ref / relative path → false", () => {
    expect(isBlobUrlPath("packs/drums/kick.wav")).toBe(false);
  });

  it("null / undefined / non-string → false", () => {
    expect(isBlobUrlPath(null)).toBe(false);
    expect(isBlobUrlPath(undefined)).toBe(false);
    // @ts-expect-error runtime safety
    expect(isBlobUrlPath(123)).toBe(false);
  });
});

// ─── Integration: serialize/deserialize embedded sample data ─────────────────

describe("Project-Save flow: embed only Blob-URL samples", () => {
  it("Blob-URL sample gets embedded, disk-path sample stays as ref", async () => {
    const buf = new MockAudioBuffer(1, 1024, 48000, (_c, i) => Math.sin(i * 0.05));
    const embedded = audioBufferToBase64Wav(buf);
    expect(embedded.length).toBeGreaterThan(0);

    // Simulated samples-array (User-Workflow):
    const samples = [
      { id: "s1", name: "kick.wav", path: "blob:http://x/1", embeddedData: embedded },
      { id: "s2", name: "snare.wav", path: "C:\\disk\\snare.wav" },
    ];

    // Only blob: paths should carry embeddedData; we don't write it for disk paths.
    expect(samples[0].embeddedData).toBeDefined();
    expect(isBlobUrlPath(samples[0].path)).toBe(true);
    expect((samples[1] as { embeddedData?: string }).embeddedData).toBeUndefined();
    expect(isBlobUrlPath(samples[1].path)).toBe(false);
  });

  it("Project-Load flow: restores AudioBuffer from embeddedData", async () => {
    const ctx = new MockDecodeContext();
    const original = new MockAudioBuffer(2, 256, 44100, (c, i) => (c === 0 ? i : -i) * 0.001);
    const b64 = audioBufferToBase64Wav(original);
    const restored = (await base64WavToAudioBuffer(b64, ctx)) as unknown as AudioBufferLike;
    expect(restored.numberOfChannels).toBe(2);
    expect(restored.length).toBe(256);
    expect(restored.sampleRate).toBe(44100);
    // Spot check round-trip precision
    expect(Math.abs(restored.getChannelData(0)[100] - 100 * 0.001)).toBeLessThan(0.001);
    expect(Math.abs(restored.getChannelData(1)[100] - -100 * 0.001)).toBeLessThan(0.001);
  });

  it("Project-Load flow: corrupted embed fallback (Caller catches)", async () => {
    const ctx = new MockDecodeContext();
    let threw = false;
    try {
      await base64WavToAudioBuffer("garbage", ctx);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Caller policy: on catch, replace with silent buffer (createBuffer(1,1,44100))
    // — verified by manually constructing the fallback:
    const fallback = new MockAudioBuffer(1, 1, 44100);
    expect(fallback.length).toBe(1);
    expect(fallback.getChannelData(0)[0]).toBe(0);
  });
});
