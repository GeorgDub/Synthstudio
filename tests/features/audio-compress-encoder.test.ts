/**
 * tests/features/audio-compress-encoder.test.ts (v3.83.0)
 *
 * Tests für client/src/utils/audioCompressEncoder.ts (Compressed OGG/Opus
 * Audio-Export via WebCodecs API mit WAV-Fallback).
 *
 * env: node — WebCodecs `AudioEncoder` ist in Node nicht verfügbar, also
 * stubben wir `globalThis.AudioEncoder` mit einem deterministischen Mock
 * der die output()-Callback synchron mit kleinen Bytes-Buffern feuert.
 *
 * Coverage:
 *  (1) Pure-Helpers (clampBitrate / filenameForFormat) — 4 Tests
 *  (2) WAV-Fallback wenn WebCodecs fehlt — 2 Tests
 *  (3) WebCodecs-Pfad mit Mock-Encoder → OGG-Blob mit OggS magic — 3 Tests
 *  (4) Bitrate-Routing (Mock empfängt clamped Bitrate) — 2 Tests
 *  (5) Error-Robustheit (invalid Buffer + Encoder-Error → Fallback) — 3 Tests
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encodeAsOgg,
  encodeCompressed,
  isWebCodecsOpusSupported,
  clampBitrate,
  filenameForFormat,
  DEFAULT_OGG_BITRATE_BPS,
  MIN_OGG_BITRATE_BPS,
  MAX_OGG_BITRATE_BPS,
  SUPPORTED_OGG_BITRATES_BPS,
  OGG_MIME,
  WAV_MIME,
  type AudioBufferLike,
} from "@/utils/audioCompressEncoder";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBuffer(durationSec = 0.05, sampleRate = 48000, channels = 2): AudioBufferLike {
  const length = Math.floor(sampleRate * durationSec);
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      ch[i] = Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 0.5;
    }
    data.push(ch);
  }
  return {
    sampleRate,
    length,
    numberOfChannels: channels,
    getChannelData: (ch) => data[ch],
  };
}

/**
 * Deterministischer Mock-Encoder. Konfiguration wird in `lastConfig` festgehalten
 * damit Tests die durchgereichte Bitrate inspizieren können. Pro encode()-Aufruf
 * wird sofort 1 EncodedAudioChunk-ähnlicher Buffer an die output()-Callback
 * weitergegeben (16 Bytes „opus payload" mit deterministischem Inhalt).
 */
let lastEncoderConfig: { codec: string; sampleRate: number; bitrate: number; numberOfChannels: number } | null = null;
let lastEncoderImplName: "ok" | "error" | "none" = "none";

function installMockEncoder(kind: "ok" | "error" = "ok") {
  lastEncoderImplName = kind;
  class MockAudioEncoder {
    private out: (chunk: { byteLength: number; copyTo: (dst: Uint8Array) => void }) => void;
    private err: (e: Error) => void;
    constructor(init: { output: typeof this.out; error: typeof this.err }) {
      this.out = init.output;
      this.err = init.error;
    }
    configure(cfg: { codec: string; sampleRate: number; bitrate: number; numberOfChannels: number }) {
      lastEncoderConfig = cfg;
    }
    encode(_data: unknown) {
      if (kind === "error") {
        this.err(new Error("Mock-Encoder failed"));
        return;
      }
      // Dummy 16-byte "opus packet"
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) bytes[i] = (i * 7) & 0xff;
      this.out({
        byteLength: bytes.length,
        copyTo: (dst) => dst.set(bytes),
      });
    }
    async flush() {
      // no-op
    }
    close() {
      // no-op
    }
  }
  // @ts-expect-error injecting into globalThis
  globalThis.AudioEncoder = MockAudioEncoder;
}

function uninstallMockEncoder() {
  // @ts-expect-error
  delete globalThis.AudioEncoder;
  lastEncoderConfig = null;
  lastEncoderImplName = "none";
}

async function blobToUint8(blob: Blob): Promise<Uint8Array> {
  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

// ─── (1) Pure-Helpers ────────────────────────────────────────────────────────

describe("audioCompressEncoder pure helpers", () => {
  it("clampBitrate clamps values into [MIN, MAX] and defaults for invalid", () => {
    expect(clampBitrate(192_000)).toBe(192_000);
    expect(clampBitrate(0)).toBe(MIN_OGG_BITRATE_BPS);
    expect(clampBitrate(10_000_000)).toBe(MAX_OGG_BITRATE_BPS);
    expect(clampBitrate(NaN)).toBe(DEFAULT_OGG_BITRATE_BPS);
    expect(clampBitrate(Infinity)).toBe(DEFAULT_OGG_BITRATE_BPS);
    expect(clampBitrate(undefined)).toBe(DEFAULT_OGG_BITRATE_BPS);
  });

  it("filenameForFormat swaps known audio extensions", () => {
    expect(filenameForFormat("track.wav", "ogg")).toBe("track.ogg");
    expect(filenameForFormat("track.ogg", "wav")).toBe("track.wav");
    expect(filenameForFormat("track", "ogg")).toBe("track.ogg");
    expect(filenameForFormat("song.mp3", "ogg")).toBe("song.ogg");
    expect(filenameForFormat("mix.WAV", "ogg")).toBe("mix.ogg");
  });

  it("SUPPORTED_OGG_BITRATES_BPS contains the canonical 5 buckets", () => {
    expect(SUPPORTED_OGG_BITRATES_BPS).toEqual([96_000, 128_000, 192_000, 256_000, 320_000]);
    expect(DEFAULT_OGG_BITRATE_BPS).toBe(192_000);
  });

  it("MIME-constants match RFC media types", () => {
    expect(OGG_MIME).toBe("audio/ogg");
    expect(WAV_MIME).toBe("audio/wav");
  });
});

// ─── (2) WAV-Fallback when WebCodecs is absent ───────────────────────────────

describe("audioCompressEncoder WAV fallback", () => {
  beforeEach(() => uninstallMockEncoder());
  afterEach(() => uninstallMockEncoder());

  it("returns WAV-Blob when globalThis.AudioEncoder is undefined", async () => {
    const buf = makeBuffer(0.04);
    const result = await encodeCompressed(buf);
    expect(result.format).toBe("wav");
    expect(result.usedFallback).toBe(true);
    expect(result.blob.type).toBe(WAV_MIME);
    const bytes = await blobToUint8(result.blob);
    // RIFF header
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WAVE");
  });

  it("isWebCodecsOpusSupported reports false without AudioEncoder", async () => {
    const supported = await isWebCodecsOpusSupported();
    expect(supported).toBe(false);
  });
});

// ─── (3) WebCodecs path produces OGG ─────────────────────────────────────────

describe("audioCompressEncoder WebCodecs path", () => {
  beforeEach(() => installMockEncoder("ok"));
  afterEach(() => uninstallMockEncoder());

  it("encodeAsOgg returns Blob with audio/ogg MIME when encoder works", async () => {
    const buf = makeBuffer(0.04);
    const blob = await encodeAsOgg(buf);
    expect(blob.type).toBe(OGG_MIME);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("encoded OGG starts with 'OggS' magic bytes", async () => {
    const buf = makeBuffer(0.04);
    const blob = await encodeAsOgg(buf);
    const bytes = await blobToUint8(blob);
    // First 4 bytes must be "OggS"
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("OggS");
  });

  it("encodeCompressed reports format='ogg' and usedFallback=false on success", async () => {
    const buf = makeBuffer(0.04);
    const result = await encodeCompressed(buf, { bitrate: 128_000 });
    expect(result.format).toBe("ogg");
    expect(result.usedFallback).toBe(false);
    expect(result.bitrate).toBe(128_000);
  });
});

// ─── (4) Bitrate propagation ─────────────────────────────────────────────────

describe("audioCompressEncoder bitrate routing", () => {
  beforeEach(() => installMockEncoder("ok"));
  afterEach(() => uninstallMockEncoder());

  it("passes the requested bitrate into the encoder config", async () => {
    const buf = makeBuffer(0.04);
    await encodeAsOgg(buf, { bitrate: 256_000 });
    expect(lastEncoderConfig?.bitrate).toBe(256_000);
    expect(lastEncoderConfig?.codec).toBe("opus");
  });

  it("clamps out-of-range bitrate before configure()", async () => {
    const buf = makeBuffer(0.04);
    await encodeAsOgg(buf, { bitrate: 10_000_000 });
    expect(lastEncoderConfig?.bitrate).toBe(MAX_OGG_BITRATE_BPS);
  });
});

// ─── (5) Error robustness ────────────────────────────────────────────────────

describe("audioCompressEncoder error robustness", () => {
  afterEach(() => uninstallMockEncoder());

  it("throws on invalid AudioBuffer (no channels)", async () => {
    const bad: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
    await expect(encodeAsOgg(bad)).rejects.toThrow(/no channels/);
  });

  it("falls back to WAV when encoder error()-callback is invoked", async () => {
    installMockEncoder("error");
    const buf = makeBuffer(0.04);
    const result = await encodeCompressed(buf);
    // The encoder reported an error → silent WAV fallback
    expect(result.format).toBe("wav");
    expect(result.usedFallback).toBe(true);
  });

  it("forceWav=true skips WebCodecs even when AudioEncoder is present", async () => {
    installMockEncoder("ok");
    const buf = makeBuffer(0.04);
    const result = await encodeCompressed(buf, { forceWav: true });
    expect(result.format).toBe("wav");
    // Important: usedFallback is false because forceWav is an explicit choice,
    // not a fallback due to missing support.
    expect(result.usedFallback).toBe(false);
  });
});
