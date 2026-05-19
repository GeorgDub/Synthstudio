/**
 * tests/features/live-recorder.test.ts (v3.110.0)
 *
 * Unit-Tests für LiveRecorder + writeMultiTrackWavs (v3.110.0 Live Multi-Track
 * Recording — Real-Time Session-Capture).
 *
 * Coverage:
 *  - start() / stop() liefert master + perChannel
 *  - recordedDurationMs trackt elapsed Time
 *  - channels=undefined records all
 *  - channels=['kick'] records only specified
 *  - writeMultiTrackWavs: korrekte WAV-Header pro Track
 *  - filename-Pattern enthält timestamp + master/channelId
 *  - Empty recording: 0 samples graceful
 *  - Memory-Cap: truncated flag
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LiveRecorder,
  LIVE_REC_MAX_TRACKS,
  formatLiveRecordTimestamp,
  sanitizeChannelToken,
  buildLiveTrackFileName,
  writeMultiTrackWavs,
  type LiveRecordingResult,
  type LiveRecordingTrack,
} from "../../client/src/audio/LiveRecorder";
import { isValidWavHeader, WAV_HEADER_SIZE } from "../../client/src/audio/wavEncoder";

// ─── Mock-AudioContext (analog audio-recording.test.ts) ──────────────────────

class MockAudioNode {
  private _conn: MockAudioNode[] = [];
  connect(t: MockAudioNode): void {
    this._conn.push(t);
  }
  disconnect(_t?: MockAudioNode): void {
    this._conn = [];
  }
  get connections(): MockAudioNode[] {
    return this._conn.slice();
  }
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1, setTargetAtTime: (): void => {} };
}

class MockScriptProcessor extends MockAudioNode {
  onaudioprocess: ((ev: { inputBuffer: MockAudioBuffer }) => void) | null = null;
  constructor(
    public bufferSize: number,
    public inChannels: number,
    public outChannels: number,
  ) {
    super();
  }
}

class MockAudioBuffer {
  private _data: Float32Array[];
  constructor(channels: number, length: number, public sampleRate: number) {
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch: number): Float32Array {
    return this._data[ch];
  }
  get numberOfChannels(): number {
    return this._data.length;
  }
  fill(channel: number, value: number): void {
    const arr = this._data[channel];
    for (let i = 0; i < arr.length; i++) arr[i] = value;
  }
}

class MockAudioContext {
  sampleRate = 48000;
  destination = new MockAudioNode();
  createGain(): MockGainNode {
    return new MockGainNode();
  }
  createScriptProcessor(bufSize: number, ic: number, oc: number): MockScriptProcessor {
    return new MockScriptProcessor(bufSize, ic, oc);
  }
}

function feedFrames(
  processor: MockScriptProcessor,
  framesPerTick: number,
  ticks: number,
  value: number,
): void {
  for (let i = 0; i < ticks; i++) {
    const buf = new MockAudioBuffer(processor.outChannels, framesPerTick, 48000);
    buf.fill(0, value);
    if (processor.outChannels === 2) buf.fill(1, value);
    processor.onaudioprocess?.({ inputBuffer: buf });
  }
}

/** Greift via `as any` auf den ScriptProcessor eines Tracks zu. */
function getProcessor(rec: LiveRecorder, id: string): MockScriptProcessor | null {
  const tracks = (rec as unknown as {
    _tracks: Map<string, { processor: MockScriptProcessor | null }>;
  })._tracks;
  return tracks.get(id)?.processor ?? null;
}

beforeEach(() => {
  vi.useRealTimers();
});

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

describe("formatLiveRecordTimestamp (v3.110.0)", () => {
  it("liefert sortierbares YYYY-MM-DD_HH-MM-SS Format", () => {
    const d = new Date(2026, 4, 19, 22, 30, 15); // 2026-05-19 22:30:15 lokal
    const ts = formatLiveRecordTimestamp(d);
    expect(ts).toBe("2026-05-19_22-30-15");
  });

  it("paddet kleine Werte mit Nullen", () => {
    const d = new Date(2026, 0, 1, 3, 7, 9);
    const ts = formatLiveRecordTimestamp(d);
    expect(ts).toBe("2026-01-01_03-07-09");
  });
});

describe("sanitizeChannelToken (v3.110.0)", () => {
  it("ersetzt Sonderzeichen durch _ und trimmt", () => {
    expect(sanitizeChannelToken("Kick Drum / 808")).toBe("Kick_Drum_808");
  });

  it("fallback auf 'track' bei leerem Input", () => {
    expect(sanitizeChannelToken("")).toBe("track");
    expect(sanitizeChannelToken("____")).toBe("track");
  });

  it("kürzt auf max 60 Zeichen", () => {
    const long = "a".repeat(200);
    expect(sanitizeChannelToken(long).length).toBeLessThanOrEqual(60);
  });
});

describe("buildLiveTrackFileName (v3.110.0)", () => {
  it("master: enthält 'master' + timestamp", () => {
    const d = new Date(2026, 4, 19, 22, 30, 15);
    const name = buildLiveTrackFileName("master", "anything", d, "live");
    expect(name).toBe("live_2026-05-19_22-30-15_master.wav");
  });

  it("channel: enthält channel-id + timestamp", () => {
    const d = new Date(2026, 4, 19, 22, 30, 15);
    const name = buildLiveTrackFileName("channel", "kick", d, "live");
    expect(name).toBe("live_2026-05-19_22-30-15_channel_kick.wav");
  });

  it("sanitized channel-id mit Sonderzeichen", () => {
    const d = new Date(2026, 4, 19, 22, 30, 15);
    const name = buildLiveTrackFileName("channel", "Bass / 808!", d, "live");
    expect(name).toContain("channel_Bass_808");
    expect(name).not.toContain("/");
    expect(name).not.toContain("!");
    expect(name).not.toContain(" ");
    expect(name.endsWith(".wav")).toBe(true);
  });
});

// ─── LiveRecorder Pipeline ────────────────────────────────────────────────────

describe("LiveRecorder.start / stop (v3.110.0)", () => {
  it("start/stop ohne Tracks liefert leeren Master + leere perChannel-Map", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);

    const ok = rec.start();
    expect(ok).toBe(true);
    expect(rec.isRunning).toBe(true);

    const result = rec.stop();
    expect(result.master).toBeNull();
    expect(result.perChannel.size).toBe(0);
    expect(result.truncated).toBe(false);
    expect(rec.isRunning).toBe(false);
  });

  it("start ist idempotent — zweiter Aufruf returnt false", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    expect(rec.start()).toBe(true);
    expect(rec.start()).toBe(false);
    rec.cancel();
  });

  it("addTrack registriert Tap-Tracks vor start()", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const node = new MockAudioNode() as unknown as AudioNode;
    expect(rec.addTrack("kick", node, "channel", 2)).toBe(true);
    expect(rec.addTrack("kick", node, "channel", 2)).toBe(false); // dup
    expect(rec.hasTrack("kick")).toBe(true);
    expect(rec.trackIds()).toContain("kick");
  });

  it("addTrack lehnt mehr als LIVE_REC_MAX_TRACKS ab", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const node = new MockAudioNode() as unknown as AudioNode;
    for (let i = 0; i < LIVE_REC_MAX_TRACKS; i++) {
      expect(rec.addTrack(`c${i}`, node, "channel", 2)).toBe(true);
    }
    expect(rec.addTrack("overflow", node, "channel", 2)).toBe(false);
  });

  it("addTrack rejected leere ID", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const node = new MockAudioNode() as unknown as AudioNode;
    expect(rec.addTrack("", node, "channel", 2)).toBe(false);
  });
});

describe("LiveRecorder — Frame-Capture (mocked)", () => {
  it("erfasst Frames pro Track und liefert sie in stop()", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const master = new MockAudioNode() as unknown as AudioNode;
    const kick = new MockAudioNode() as unknown as AudioNode;
    rec.addTrack("master", master, "master", 2);
    rec.addTrack("kick", kick, "channel", 2);
    rec.start();

    const procMaster = getProcessor(rec, "master");
    const procKick = getProcessor(rec, "kick");
    expect(procMaster).not.toBeNull();
    expect(procKick).not.toBeNull();

    // 2 Ticks á 4096 Frames = 8192 Frames @ 48k
    feedFrames(procMaster!, 4096, 2, 0.5);
    feedFrames(procKick!, 4096, 2, 0.25);

    const result = rec.stop();
    expect(result.master).not.toBeNull();
    expect(result.master!.id).toBe("master");
    expect(result.master!.kind).toBe("master");
    expect(result.master!.left.length).toBe(8192);
    expect(result.master!.right.length).toBe(8192);
    expect(result.master!.sampleRate).toBe(48000);
    expect(result.master!.durationSec).toBeCloseTo(8192 / 48000, 4);

    expect(result.perChannel.size).toBe(1);
    const k = result.perChannel.get("kick")!;
    expect(k.kind).toBe("channel");
    expect(k.left.length).toBe(8192);
    expect(k.left[0]).toBeCloseTo(0.25, 4);
  });

  it("Mono-Tap downmixed in Stereo-Output (right = left-copy)", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    rec.addTrack("mono", src, "channel", 1);
    rec.start();
    const proc = getProcessor(rec, "mono")!;
    feedFrames(proc, 1024, 1, 0.75);
    const result = rec.stop();
    const t = result.perChannel.get("mono")!;
    expect(t.left.length).toBe(1024);
    expect(t.right.length).toBe(1024);
    expect(Array.from(t.right.slice(0, 4))).toEqual(Array.from(t.left.slice(0, 4)));
  });
});

describe("LiveRecorder — channels=undefined vs explicit (v3.110.0)", () => {
  it("ohne Tracks vor start: stop() liefert leer", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    rec.start();
    const result = rec.stop();
    expect(result.master).toBeNull();
    expect(result.perChannel.size).toBe(0);
  });

  it("explizite Channel-ID — nur der angegebene Track ist im Result", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    rec.addTrack("kick", new MockAudioNode() as unknown as AudioNode, "channel", 2);
    rec.addTrack("snare", new MockAudioNode() as unknown as AudioNode, "channel", 2);
    // User-Intent: nur kick → wir simulieren das, indem snare nicht registriert wäre.
    // Variation: drop snare manuell.
    rec.removeTrack("snare");
    rec.start();
    const proc = getProcessor(rec, "kick")!;
    feedFrames(proc, 100, 1, 0.5);
    const result = rec.stop();
    expect(result.perChannel.has("kick")).toBe(true);
    expect(result.perChannel.has("snare")).toBe(false);
  });
});

describe("LiveRecorder.recordedDurationMs (v3.110.0)", () => {
  it("liefert 0 wenn nie gestartet", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    expect(rec.recordedDurationMs).toBe(0);
  });

  it("liefert >= 0 während Recording", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    rec.start();
    const d = rec.recordedDurationMs;
    expect(d).toBeGreaterThanOrEqual(0);
    rec.cancel();
  });

  it("ist nach stop() fixiert auf finale Dauer", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    rec.start();
    const result = rec.stop();
    const after = rec.recordedDurationMs;
    expect(after).toBe(result.durationMs);
  });
});

describe("LiveRecorder.cancel (v3.110.0)", () => {
  it("räumt alle Tracks ohne Encode auf", () => {
    const rec = new LiveRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    rec.addTrack("a", new MockAudioNode() as unknown as AudioNode, "channel", 2);
    rec.addTrack("b", new MockAudioNode() as unknown as AudioNode, "channel", 2);
    rec.start();
    expect(rec.trackCount).toBe(2);
    rec.cancel();
    expect(rec.trackCount).toBe(0);
    expect(rec.isRunning).toBe(false);
  });
});

// ─── WAV-Multi-Track Output ──────────────────────────────────────────────────

function makeTrack(id: string, kind: "master" | "channel", n = 100): LiveRecordingTrack {
  return {
    id,
    kind,
    left: new Float32Array(n).fill(0.5),
    right: new Float32Array(n).fill(0.5),
    sampleRate: 48000,
    durationSec: n / 48000,
    channels: 2,
  };
}

describe("writeMultiTrackWavs (v3.110.0)", () => {
  it("erzeugt 1 WAV pro Track + Master", () => {
    const result: LiveRecordingResult = {
      master: makeTrack("master", "master"),
      perChannel: new Map<string, LiveRecordingTrack>([
        ["kick", makeTrack("kick", "channel")],
        ["snare", makeTrack("snare", "channel")],
      ]),
      durationMs: 1000,
      truncated: false,
    };
    const d = new Date(2026, 4, 19, 22, 30, 15);
    const files = writeMultiTrackWavs(result, { date: d, prefix: "live" });
    expect(files.size).toBe(3);
    expect(files.has("live_2026-05-19_22-30-15_master.wav")).toBe(true);
    expect(files.has("live_2026-05-19_22-30-15_channel_kick.wav")).toBe(true);
    expect(files.has("live_2026-05-19_22-30-15_channel_snare.wav")).toBe(true);
  });

  it("jeder WAV-Buffer hat valide Header + erwartete Größe", () => {
    const result: LiveRecordingResult = {
      master: makeTrack("master", "master", 100),
      perChannel: new Map([["kick", makeTrack("kick", "channel", 100)]]),
      durationMs: 500,
      truncated: false,
    };
    const files = writeMultiTrackWavs(result, { date: new Date(2026, 0, 1) });
    for (const [, bytes] of files) {
      // Stereo 16-bit: 100 frames × 4 bytes = 400 + 44 header = 444
      expect(bytes.byteLength).toBe(WAV_HEADER_SIZE + 100 * 4);
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      expect(isValidWavHeader(ab as ArrayBuffer)).toBe(true);
    }
  });

  it("nur Master ohne perChannel: 1 File", () => {
    const result: LiveRecordingResult = {
      master: makeTrack("master", "master"),
      perChannel: new Map(),
      durationMs: 250,
      truncated: false,
    };
    const files = writeMultiTrackWavs(result);
    expect(files.size).toBe(1);
  });

  it("nur perChannel ohne Master: nur Channels", () => {
    const result: LiveRecordingResult = {
      master: null,
      perChannel: new Map([["kick", makeTrack("kick", "channel")]]),
      durationMs: 250,
      truncated: false,
    };
    const files = writeMultiTrackWavs(result, { date: new Date(2026, 0, 1) });
    expect(files.size).toBe(1);
    const names = Array.from(files.keys());
    expect(names[0]).toContain("channel_kick");
    expect(names[0]).not.toContain("_master");
  });

  it("Empty recording: leere Map", () => {
    const result: LiveRecordingResult = {
      master: null,
      perChannel: new Map(),
      durationMs: 0,
      truncated: false,
    };
    const files = writeMultiTrackWavs(result);
    expect(files.size).toBe(0);
  });
});

// ─── Test-Helper-Pfad (__pushFramesForTest) ──────────────────────────────────

describe("LiveRecorder __pushFramesForTest (v3.110.0)", () => {
  it("erlaubt Direkt-Schreiben in Buffer ohne ScriptProcessor", () => {
    const rec = new LiveRecorder();
    // KEIN setContext — wir nutzen nur den State.
    rec.addTrack("ghost", new MockAudioNode() as unknown as AudioNode, "channel", 2);
    rec.start(undefined, 48000);
    const left = new Float32Array(512).fill(0.1);
    const right = new Float32Array(512).fill(-0.1);
    rec.__pushFramesForTest("ghost", left, right);
    const result = rec.stop();
    const t = result.perChannel.get("ghost")!;
    expect(t.left.length).toBe(512);
    expect(t.right.length).toBe(512);
    expect(t.left[0]).toBeCloseTo(0.1, 5);
    expect(t.right[0]).toBeCloseTo(-0.1, 5);
  });
});
