/**
 * tests/features/bounce-format-options.test.ts (v3.84.0)
 *
 * Unit-Tests für die OGG-Format-Option im Channel-Bounce (v3.84.0).
 *
 * Coverage:
 *  (1) bounceChannelToBuffer mit format='wav' (Default) → WAV ArrayBuffer + actualFormat='wav'
 *  (2) bounceChannelToBuffer mit format='ogg-opus' + Mock-Encoder → OGG-Bytes + actualFormat='ogg-opus'
 *  (3) bounceChannelToBuffer mit format='ogg-opus' ohne WebCodecs → silent WAV-Fallback
 *  (4) bounceAllChannels format='ogg-opus' → alle Filenames mit .ogg-Endung
 *  (5) bounceAllChannels format='wav' (Default, backward-compat) → alle .wav-Filenames
 *  (6) Bitrate wird an WebCodecs durchgereicht (clamping verified)
 *  (7) bounceChannelToWavBuffer (legacy API) bleibt unverändert WAV-only
 *  (8) BounceAllResult.wav-Alias zeigt auf identische Bytes wie .data (backward-compat)
 *
 * Mock-Strategy:
 *  - OfflineAudioContext-Konstruktor wird via Mock injiziert (kein DOM nötig).
 *  - WebCodecs `AudioEncoder` wird via globalThis-Stub installiert; pro Test
 *    explizit installiert/uninstalliert damit Cross-Test-Pollution ausgeschlossen ist.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  bounceChannelToBuffer,
  bounceChannelToWavBuffer,
  bounceAllChannels,
  type ChannelBounceFormatOptions,
  type OfflineAudioContextCtor,
} from "../../client/src/utils/channelBounce";
import {
  MAX_OGG_BITRATE_BPS,
} from "../../client/src/utils/audioCompressEncoder";
import type { PartData, PatternData, ChannelFx } from "../../client/src/audio/AudioEngine";

// ─── Minimal-AudioBuffer-Mock (ausreichend für Bounce + Format-Encoding) ─────

class MockAudioBuffer {
  private _data: Float32Array[];
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  constructor(channels: number, length: number, sampleRate: number) {
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
  }
  getChannelData(ch: number): Float32Array { return this._data[ch]; }
  copyToChannel(src: Float32Array, ch: number, offset: number = 0): void {
    this._data[ch].set(src, offset);
  }
  copyFromChannel(dest: Float32Array, ch: number, offset: number = 0): void {
    dest.set(this._data[ch].subarray(offset, offset + dest.length));
  }
}

// ─── Mock OfflineAudioContext ────────────────────────────────────────────────

function makeMockOfflineCtxCtor(): OfflineAudioContextCtor {
  // Eine minimalistische OfflineAudioContext-Klasse die nur das implementiert
  // was channelBounce.ts braucht: createXxx + destination + startRendering.
  // Wir ignorieren alle Audio-Wahrheits-Konsistenzen — Tests checken nur
  // Format/Filename/Bitrate-Pfade, nicht Audio-Inhalte.
  return class MockOfflineCtx {
    destination = { __isDestination: true, _kind: "destination" };
    private channels: number;
    private length: number;
    sampleRate: number;
    constructor(channels: number, length: number, sampleRate: number) {
      this.channels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
    }
    private makeParam() {
      return {
        value: 0,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {},
      };
    }
    createBufferSource() {
      return {
        _kind: "bufferSource",
        buffer: null as MockAudioBuffer | null,
        playbackRate: this.makeParam(),
        start: () => {},
        connect: () => {},
        disconnect: () => {},
      };
    }
    createGain() {
      return {
        _kind: "gain",
        gain: this.makeParam(),
        connect: () => {},
        disconnect: () => {},
      };
    }
    createOscillator() {
      return {
        _kind: "oscillator",
        type: "sine" as string,
        frequency: this.makeParam(),
        detune: this.makeParam(),
        start: () => {},
        stop: () => {},
        connect: () => {},
        disconnect: () => {},
      };
    }
    createStereoPanner() {
      return {
        _kind: "panner",
        pan: this.makeParam(),
        connect: () => {},
        disconnect: () => {},
      };
    }
    createBiquadFilter() {
      return {
        _kind: "biquad",
        type: "lowpass" as string,
        frequency: this.makeParam(),
        Q: this.makeParam(),
        gain: this.makeParam(),
        connect: () => {},
        disconnect: () => {},
      };
    }
    createWaveShaper() {
      return {
        _kind: "waveShaper",
        curve: null as Float32Array | null,
        oversample: "none" as string,
        connect: () => {},
        disconnect: () => {},
      };
    }
    createDynamicsCompressor() {
      return {
        _kind: "compressor",
        threshold: this.makeParam(),
        ratio: this.makeParam(),
        attack: this.makeParam(),
        release: this.makeParam(),
        knee: this.makeParam(),
        connect: () => {},
        disconnect: () => {},
      };
    }
    createDelay(_max: number = 2.0) {
      return {
        _kind: "delay",
        delayTime: this.makeParam(),
        connect: () => {},
        disconnect: () => {},
      };
    }
    createConvolver() {
      return {
        _kind: "convolver",
        buffer: null as MockAudioBuffer | null,
        connect: () => {},
        disconnect: () => {},
      };
    }
    createBuffer(channels: number, length: number, sampleRate: number) {
      return new MockAudioBuffer(channels, length, sampleRate);
    }
    async startRendering(): Promise<MockAudioBuffer> {
      // Liefere einen Buffer mit konstanten Werten damit der Encoder etwas
      // zu lesen hat (sonst wäre numberOfChannels=0 valid aber leer).
      const buf = new MockAudioBuffer(this.channels, this.length, this.sampleRate);
      // Füllt mit kleinem Sinus damit getChannelData() nicht leer ist.
      for (let ch = 0; ch < this.channels; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.sin((i / this.sampleRate) * 2 * Math.PI * 440) * 0.1;
        }
      }
      return buf;
    }
  } as unknown as OfflineAudioContextCtor;
}

// ─── WebCodecs Mock-Encoder ──────────────────────────────────────────────────

let lastEncoderConfig: {
  codec: string;
  sampleRate: number;
  bitrate: number;
  numberOfChannels: number;
} | null = null;

function installMockEncoder(kind: "ok" | "error" = "ok") {
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
    async flush() { /* no-op */ }
    close() { /* no-op */ }
  }
  // @ts-expect-error injecting into globalThis
  globalThis.AudioEncoder = MockAudioEncoder;
}

function uninstallMockEncoder() {
  // @ts-expect-error
  delete globalThis.AudioEncoder;
  lastEncoderConfig = null;
}

// ─── Part/Pattern Helpers ────────────────────────────────────────────────────

function defaultChannelFx(overrides: Partial<ChannelFx> = {}): ChannelFx {
  return {
    filterEnabled: false,
    filterType: "lowpass",
    filterFreq: 20000,
    filterQ: 1,
    filterGain: 0,
    distortionEnabled: false,
    distortionAmount: 50,
    compressorEnabled: false,
    compressorThreshold: -24,
    compressorRatio: 4,
    compressorAttack: 0.003,
    compressorRelease: 0.25,
    delayEnabled: false,
    delayTime: 0.25,
    delayFeedback: 0.3,
    delayMix: 0.3,
    reverbEnabled: false,
    reverbDecay: 2.0,
    reverbMix: 0.3,
    eqEnabled: false,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    ...overrides,
  };
}

function makePart(overrides: Partial<PartData> = {}): PartData {
  const steps = Array.from({ length: 16 }, (_, i) => ({
    active: i % 4 === 0,
    velocity: 100,
  }));
  return {
    id: "part-1",
    name: "Kick",
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: defaultChannelFx(),
    sourceType: "sample",
    sampleUrl: "test-sample.wav",
    ...overrides,
  } as PartData;
}

function makePattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: "pat-1",
    name: "Pattern 1",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: null,
    parts: [makePart()],
    ...overrides,
  } as PatternData;
}

function baseFormatOpts(extra: Partial<ChannelBounceFormatOptions> = {}): ChannelBounceFormatOptions {
  // Minimal-Buffer als sampleSource damit der Sample-Pfad in renderChannelToBuffer
  // genommen wird.
  const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
  return {
    length: { mode: "currentPattern" },
    bpm: 120,
    sampleRate: 48000,
    sampleBuffer,
    channels: 2,
    ...extra,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("bounceChannelToBuffer — Format-Option (v3.84.0)", () => {
  beforeEach(() => uninstallMockEncoder());
  afterEach(() => uninstallMockEncoder());

  it("Default-Format = 'wav' (backward-compat) → RIFF/WAVE-Header", async () => {
    const part = makePart();
    const pattern = makePattern();
    const Ctor = makeMockOfflineCtxCtor();
    const out = await bounceChannelToBuffer(part, pattern, baseFormatOpts(), Ctor);
    expect(out.actualFormat).toBe("wav");
    expect(out.extension).toBe(".wav");
    expect(out.mimeType).toBe("audio/wav");
    // RIFF/WAVE magic bytes
    const bytes = new Uint8Array(out.data);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WAVE");
  });

  it("explizit format='wav' liefert identisches Verhalten wie Default", async () => {
    const part = makePart();
    const pattern = makePattern();
    const Ctor = makeMockOfflineCtxCtor();
    const out = await bounceChannelToBuffer(
      part, pattern,
      baseFormatOpts({ format: "wav" }),
      Ctor,
    );
    expect(out.actualFormat).toBe("wav");
    expect(out.extension).toBe(".wav");
    expect(out.data.byteLength).toBeGreaterThan(44); // mind. Header + 1 Sample
  });

  it("format='ogg-opus' mit Mock-WebCodecs → OGG-Bytes (OggS-Magic + actualFormat='ogg-opus')", async () => {
    installMockEncoder("ok");
    const part = makePart();
    const pattern = makePattern();
    const Ctor = makeMockOfflineCtxCtor();
    const out = await bounceChannelToBuffer(
      part, pattern,
      baseFormatOpts({ format: "ogg-opus", bitrate: 128_000 }),
      Ctor,
    );
    expect(out.actualFormat).toBe("ogg-opus");
    expect(out.extension).toBe(".ogg");
    expect(out.mimeType).toBe("audio/ogg");
    // OggS-Magic
    const bytes = new Uint8Array(out.data);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("OggS");
  });

  it("format='ogg-opus' OHNE WebCodecs → silent WAV-Fallback (actualFormat='wav')", async () => {
    // Kein installMockEncoder → kein globalThis.AudioEncoder vorhanden.
    const part = makePart();
    const pattern = makePattern();
    const Ctor = makeMockOfflineCtxCtor();
    const out = await bounceChannelToBuffer(
      part, pattern,
      baseFormatOpts({ format: "ogg-opus" }),
      Ctor,
    );
    // Encoder fehlt → encodeAsOgg liefert WAV-Blob, actualFormat folgt der Realität.
    expect(out.actualFormat).toBe("wav");
    expect(out.extension).toBe(".wav");
    expect(out.mimeType).toBe("audio/wav");
    const bytes = new Uint8Array(out.data);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
  });

  it("Bitrate-Param wird an den WebCodecs-Encoder durchgereicht (verified via Mock)", async () => {
    installMockEncoder("ok");
    const part = makePart();
    const pattern = makePattern();
    const Ctor = makeMockOfflineCtxCtor();
    await bounceChannelToBuffer(
      part, pattern,
      baseFormatOpts({ format: "ogg-opus", bitrate: 256_000 }),
      Ctor,
    );
    expect(lastEncoderConfig?.bitrate).toBe(256_000);
    expect(lastEncoderConfig?.codec).toBe("opus");
  });

  it("Bitrate wird vor configure() geclampt (Max=510k)", async () => {
    installMockEncoder("ok");
    const part = makePart();
    const pattern = makePattern();
    const Ctor = makeMockOfflineCtxCtor();
    await bounceChannelToBuffer(
      part, pattern,
      baseFormatOpts({ format: "ogg-opus", bitrate: 10_000_000 }),
      Ctor,
    );
    expect(lastEncoderConfig?.bitrate).toBe(MAX_OGG_BITRATE_BPS);
  });
});

// ─── bounceAllChannels — Format-Routing ─────────────────────────────────────

describe("bounceAllChannels — Format-Option (v3.84.0)", () => {
  beforeEach(() => uninstallMockEncoder());
  afterEach(() => uninstallMockEncoder());

  it("Default (kein format) → alle Filenames enden auf .wav (backward-compat)", async () => {
    const parts = [
      makePart({ id: "p1", name: "Kick" }),
      makePart({ id: "p2", name: "Snare" }),
    ];
    const pattern = makePattern({ parts });
    const Ctor = makeMockOfflineCtxCtor();
    const results = await bounceAllChannels(
      parts, pattern,
      new Map(),
      {
        length: { mode: "currentPattern" },
        bpm: 120,
        sampleRate: 48000,
        channels: 2,
      },
      "TestProj",
      undefined,
      Ctor,
    );
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.filename.endsWith(".wav")).toBe(true);
      expect(r.actualFormat).toBe("wav");
      expect(r.mimeType).toBe("audio/wav");
    }
  });

  it("format='ogg-opus' mit Mock-Encoder → alle Filenames enden auf .ogg + actualFormat='ogg-opus'", async () => {
    installMockEncoder("ok");
    const parts = [
      makePart({ id: "p1", name: "Kick" }),
      makePart({ id: "p2", name: "Snare" }),
      makePart({ id: "p3", name: "Hat" }),
    ];
    const pattern = makePattern({ parts });
    const Ctor = makeMockOfflineCtxCtor();
    const results = await bounceAllChannels(
      parts, pattern,
      new Map(),
      {
        length: { mode: "currentPattern" },
        bpm: 120,
        sampleRate: 48000,
        channels: 2,
        format: "ogg-opus",
        bitrate: 192_000,
      },
      "TestProj",
      undefined,
      Ctor,
    );
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.filename.endsWith(".ogg")).toBe(true);
      expect(r.actualFormat).toBe("ogg-opus");
      expect(r.mimeType).toBe("audio/ogg");
    }
  });

  it("format='ogg-opus' OHNE WebCodecs → silent Fallback: .wav-Endung trotz format-Wunsch", async () => {
    // Kein Mock-Encoder installiert.
    const parts = [
      makePart({ id: "p1", name: "Kick" }),
      makePart({ id: "p2", name: "Snare" }),
    ];
    const pattern = makePattern({ parts });
    const Ctor = makeMockOfflineCtxCtor();
    const results = await bounceAllChannels(
      parts, pattern,
      new Map(),
      {
        length: { mode: "currentPattern" },
        bpm: 120,
        sampleRate: 48000,
        channels: 2,
        format: "ogg-opus",
      },
      "TestProj",
      undefined,
      Ctor,
    );
    // Silent-Fallback: encoder fehlt → encodeAsOgg liefert WAV-Bytes,
    // actualFormat folgt der Realität.
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.filename.endsWith(".wav")).toBe(true);
      expect(r.actualFormat).toBe("wav");
      expect(r.mimeType).toBe("audio/wav");
    }
  });

  it("Bitrate wird pro Channel an den Encoder durchgereicht", async () => {
    installMockEncoder("ok");
    const parts = [makePart({ id: "p1", name: "Kick" })];
    const pattern = makePattern({ parts });
    const Ctor = makeMockOfflineCtxCtor();
    await bounceAllChannels(
      parts, pattern,
      new Map(),
      {
        length: { mode: "currentPattern" },
        bpm: 120,
        sampleRate: 48000,
        channels: 2,
        format: "ogg-opus",
        bitrate: 320_000,
      },
      "TestProj",
      undefined,
      Ctor,
    );
    expect(lastEncoderConfig?.bitrate).toBe(320_000);
  });

  it("BounceAllResult.wav-Alias zeigt auf identische Bytes wie .data (backward-compat)", async () => {
    const parts = [makePart({ id: "p1", name: "Kick" })];
    const pattern = makePattern({ parts });
    const Ctor = makeMockOfflineCtxCtor();
    const results = await bounceAllChannels(
      parts, pattern,
      new Map(),
      {
        length: { mode: "currentPattern" },
        bpm: 120,
        sampleRate: 48000,
        channels: 2,
      },
      "TestProj",
      undefined,
      Ctor,
    );
    expect(results.length).toBe(1);
    // .wav und .data müssen denselben ArrayBuffer referenzieren
    expect(results[0].wav).toBe(results[0].data);
    expect(results[0].wav.byteLength).toBeGreaterThan(0);
  });
});

// ─── Backward-Compat: bounceChannelToWavBuffer unverändert WAV-only ──────────

describe("bounceChannelToWavBuffer — Backward-Compat (v3.84.0)", () => {
  beforeEach(() => uninstallMockEncoder());
  afterEach(() => uninstallMockEncoder());

  it("bounceChannelToWavBuffer liefert IMMER WAV-ArrayBuffer (egal ob WebCodecs verfügbar)", async () => {
    // Selbst mit installiertem Mock-Encoder soll die alte API WAV liefern.
    installMockEncoder("ok");
    const part = makePart();
    const pattern = makePattern();
    const Ctor = makeMockOfflineCtxCtor();
    const sampleBuffer = new MockAudioBuffer(1, 1000, 48000) as unknown as AudioBuffer;
    const wav = await bounceChannelToWavBuffer(
      part, pattern,
      {
        length: { mode: "currentPattern" },
        bpm: 120,
        sampleRate: 48000,
        sampleBuffer,
        channels: 2,
      },
      Ctor,
    );
    // RIFF-Header garantiert
    const bytes = new Uint8Array(wav);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe("WAVE");
  });
});
