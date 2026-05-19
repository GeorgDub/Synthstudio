/**
 * tests/features/audio-input-recorder-v3113.test.ts (v3.113.0)
 *
 * Unit-Tests für AudioInputRecorder (external mic/synth/line-in capture)
 * und useAudioInputStore.
 *
 * jsdom-frei mit Mocks für getUserMedia + MediaStream + MediaStreamTrack.
 *
 * (separate file from audio-input-recorder.test.ts which tests the
 *  legacy useAudioInput-Hook formatRecordingDuration helper)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AudioInputRecorder,
  AUDIO_INPUT_SILENCE_DB,
  AUDIO_INPUT_MAX_FRAMES,
  rmsDbFromTimeDomain,
  concatFloat32Chunks,
} from "../../client/src/audio/AudioInputRecorder";
import {
  __resetAudioInputStoreForTests,
  getAudioInputState,
  setAudioInputDevice,
  setAudioInputMonitorEnabled,
  setAudioInputMonitorGain,
  setAudioInputInputGain,
  setAudioInputRecordSyncWithTransport,
  setAudioInputRoute,
  setAudioInputPartial,
} from "../../client/src/store/useAudioInputStore";

// ─── localStorage-Mock (für Node-Tests ohne jsdom) ──────────────────────────

class LocalStorageMock {
  private _data: Record<string, string> = {};
  getItem(key: string): string | null { return this._data[key] ?? null; }
  setItem(key: string, val: string): void { this._data[key] = String(val); }
  removeItem(key: string): void { delete this._data[key]; }
  clear(): void { this._data = {}; }
  get length(): number { return Object.keys(this._data).length; }
  key(i: number): string | null { return Object.keys(this._data)[i] ?? null; }
}

const globalAny = globalThis as unknown as { localStorage?: LocalStorageMock };
if (typeof globalAny.localStorage === "undefined") {
  globalAny.localStorage = new LocalStorageMock();
}

// ─── Mock MediaStream + Track ────────────────────────────────────────────────

class MockMediaStreamTrack {
  kind = "audio";
  enabled = true;
  stopped = false;
  stop(): void { this.stopped = true; }
}
class MockMediaStream {
  private _tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()];
  getTracks(): MockMediaStreamTrack[] { return this._tracks.slice(); }
  getAudioTracks(): MockMediaStreamTrack[] { return this._tracks.slice(); }
}

// ─── Mock AudioContext ───────────────────────────────────────────────────────

class MockAudioNode {
  private _conn: MockAudioNode[] = [];
  connect(t: MockAudioNode): void { this._conn.push(t); }
  disconnect(_t?: MockAudioNode): void { this._conn = []; }
  get connections(): MockAudioNode[] { return this._conn.slice(); }
}

class MockGainNode extends MockAudioNode {
  gain = {
    value: 1,
    setTargetAtTime: (v: number): void => { this.gain.value = v; },
  };
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 1024;
  smoothingTimeConstant = 0.2;
  private _fakeData: Float32Array | null = null;
  getFloatTimeDomainData(arr: Float32Array): void {
    if (this._fakeData) arr.set(this._fakeData.subarray(0, arr.length));
  }
  __setFakeData(data: Float32Array): void { this._fakeData = data; }
}

class MockMediaStreamSource extends MockAudioNode {
  constructor(public stream: MockMediaStream) { super(); }
}

class MockScriptProcessor extends MockAudioNode {
  onaudioprocess: ((ev: { inputBuffer: MockAudioBuffer }) => void) | null = null;
  constructor(public bufferSize: number, public inChannels: number, public outChannels: number) {
    super();
  }
}

class MockAudioBuffer {
  private _data: Float32Array[];
  constructor(channels: number, length: number, public sampleRate: number) {
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch: number): Float32Array { return this._data[ch]; }
  get numberOfChannels(): number { return this._data.length; }
  fill(channel: number, value: number): void {
    const arr = this._data[channel];
    for (let i = 0; i < arr.length; i++) arr[i] = value;
  }
}

class MockAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  destination = new MockAudioNode();
  createGain(): MockGainNode { return new MockGainNode(); }
  createAnalyser(): MockAnalyserNode { return new MockAnalyserNode(); }
  createMediaStreamSource(stream: MockMediaStream): MockMediaStreamSource {
    return new MockMediaStreamSource(stream);
  }
  createScriptProcessor(bufSize: number, ic: number, oc: number): MockScriptProcessor {
    return new MockScriptProcessor(bufSize, ic, oc);
  }
}

// ─── getUserMedia Mock-Hilfen ────────────────────────────────────────────────
//
// Node-Globals: navigator ist write-protected (getter). Wir hängen mediaDevices
// per defineProperty an das bestehende navigator-Objekt (falls vorhanden) oder
// definieren ein neues navigator-Property.

interface MediaDevicesShape {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<unknown>;
  enumerateDevices?: () => Promise<unknown[]>;
  addEventListener?: (t: string, cb: () => void) => void;
  removeEventListener?: (t: string, cb: () => void) => void;
}

function ensureNavigator(): { mediaDevices?: MediaDevicesShape } {
  const g = globalThis as unknown as { navigator?: { mediaDevices?: MediaDevicesShape } };
  if (typeof g.navigator === "undefined") {
    try {
      Object.defineProperty(g, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });
    } catch {
      // Falls auch das fehlschlägt: notfalls Cast.
      (g as unknown as { navigator: unknown }).navigator = {};
    }
  }
  return g.navigator!;
}

function assignMediaDevices(md: MediaDevicesShape | undefined): void {
  const nav = ensureNavigator();
  try {
    Object.defineProperty(nav, "mediaDevices", {
      value: md,
      writable: true,
      configurable: true,
    });
  } catch {
    (nav as { mediaDevices?: MediaDevicesShape }).mediaDevices = md;
  }
}

function setupGetUserMediaSuccess(): MockMediaStream {
  const stream = new MockMediaStream();
  assignMediaDevices({
    getUserMedia: vi.fn(async () => stream),
    enumerateDevices: vi.fn(async () => [
      { kind: "audioinput", deviceId: "default", label: "Default Mic", groupId: "g1" },
      { kind: "audioinput", deviceId: "korg-1", label: "KORG ESX Audio Out", groupId: "g2" },
      { kind: "audiooutput", deviceId: "spk", label: "Speakers", groupId: "g3" },
    ]),
  });
  return stream;
}

function setupGetUserMediaDeny(): void {
  assignMediaDevices({
    getUserMedia: vi.fn(async () => {
      const err = new Error("Permission denied");
      err.name = "NotAllowedError";
      throw err;
    }),
    enumerateDevices: vi.fn(async () => []),
  });
}

function clearGetUserMedia(): void {
  assignMediaDevices(undefined);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  __resetAudioInputStoreForTests();
});

describe("rmsDbFromTimeDomain (v3.113.0)", () => {
  it("liefert SILENCE_DB für leeren Buffer", () => {
    expect(rmsDbFromTimeDomain(new Float32Array(0))).toBe(AUDIO_INPUT_SILENCE_DB);
  });

  it("liefert SILENCE_DB für all-zero Buffer", () => {
    expect(rmsDbFromTimeDomain(new Float32Array(128))).toBe(AUDIO_INPUT_SILENCE_DB);
  });

  it("liefert 0 dB für volle Amplitude (rms=1)", () => {
    const buf = new Float32Array(128).fill(1.0);
    expect(rmsDbFromTimeDomain(buf)).toBeCloseTo(0, 1);
  });

  it("liefert ~-6dB für rms=0.5", () => {
    const buf = new Float32Array(128).fill(0.5);
    expect(rmsDbFromTimeDomain(buf)).toBeCloseTo(-6, 0);
  });
});

describe("concatFloat32Chunks (v3.113.0)", () => {
  it("Empty input → empty output", () => {
    expect(concatFloat32Chunks([]).length).toBe(0);
  });

  it("Single chunk wird kopiert", () => {
    const a = new Float32Array([1, 2, 3]);
    const out = concatFloat32Chunks([a]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("Multiple chunks concatenated", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4, 5]);
    const c = new Float32Array([6]);
    const out = concatFloat32Chunks([a, b, c]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("AudioInputRecorder.enumerateDevices (v3.113.0)", () => {
  it("liefert nur audioinput-Devices", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const list = await rec.enumerateDevices();
    expect(list.length).toBe(2);
    expect(list[0].deviceId).toBe("default");
    expect(list[1].deviceId).toBe("korg-1");
    expect(list.every(d => d.label.length > 0)).toBe(true);
  });

  it("liefert leer wenn mediaDevices nicht verfügbar", async () => {
    clearGetUserMedia();
    const rec = new AudioInputRecorder();
    const list = await rec.enumerateDevices();
    expect(list).toEqual([]);
  });
});

describe("AudioInputRecorder.connect (v3.113.0)", () => {
  it("throws when getUserMedia API not available", async () => {
    clearGetUserMedia();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await expect(rec.connect("default", ctx)).rejects.toThrow();
  });

  it("throws Permission-denied-Error wenn Permission denied", async () => {
    setupGetUserMediaDeny();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await expect(rec.connect("default", ctx)).rejects.toThrow(/Permission denied/);
    expect(rec.isConnected).toBe(false);
  });

  it("returns MediaStreamSource on success + isConnected=true", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    const source = await rec.connect("default", ctx);
    expect(source).toBeDefined();
    expect(rec.isConnected).toBe(true);
    expect(rec.deviceId).toBe("default");
    expect(rec.sampleRate).toBe(48000);
    expect(rec.tapNode).not.toBeNull();
  });

  it("Re-Connect cleared den vorherigen Stream", async () => {
    const stream1 = setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    // Re-connect mit anderem Device
    const stream2 = setupGetUserMediaSuccess();
    await rec.connect("korg-1", ctx);
    expect(rec.deviceId).toBe("korg-1");
    // Tracks vom alten Stream wurden gestoppt.
    expect(stream1.getTracks()[0].stopped).toBe(true);
    expect(stream2.getTracks()[0].stopped).toBe(false);
  });
});

describe("AudioInputRecorder.start / stop (v3.113.0)", () => {
  it("start: returns false wenn nicht connected", () => {
    const rec = new AudioInputRecorder();
    expect(rec.start()).toBe(false);
  });

  it("start/stop: liefert Float32-Buffer + WAV-Bytes", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    expect(rec.start()).toBe(true);
    expect(rec.isRecording).toBe(true);
    // Direkt-Push (kein realer ScriptProcessor in Mock).
    rec.__pushFramesForTest(new Float32Array(256).fill(0.5), new Float32Array(256).fill(0.5));
    const result = rec.stop();
    expect(result.left.length).toBe(256);
    expect(result.right.length).toBe(256);
    expect(result.sampleRate).toBe(48000);
    expect(result.channels).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.wavBytes.length).toBeGreaterThan(44); // WAV-Header + data
  });

  it("start ist idempotent — zweiter Aufruf returnt false", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    expect(rec.start()).toBe(true);
    expect(rec.start()).toBe(false);
  });

  it("stop ohne start liefert leeres Result", () => {
    const rec = new AudioInputRecorder();
    const result = rec.stop();
    expect(result.left.length).toBe(0);
    expect(result.durationMs).toBe(0);
    expect(result.wavBytes.length).toBe(0);
  });
});

describe("AudioInputRecorder.disconnect (v3.113.0)", () => {
  it("Disconnect stoppt MediaStreamTracks (kein Zombie-Mic)", async () => {
    const stream = setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    expect(stream.getTracks()[0].stopped).toBe(false);
    rec.disconnect();
    expect(stream.getTracks()[0].stopped).toBe(true);
    expect(rec.isConnected).toBe(false);
    expect(rec.tapNode).toBeNull();
  });

  it("Disconnect während Recording: stoppt + cleared State", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    rec.start();
    expect(rec.isRecording).toBe(true);
    rec.disconnect();
    expect(rec.isRecording).toBe(false);
    expect(rec.isConnected).toBe(false);
  });
});

describe("AudioInputRecorder.getLevel (v3.113.0)", () => {
  it("liefert SILENCE_DB wenn nicht connected", () => {
    const rec = new AudioInputRecorder();
    expect(rec.getLevel()).toBe(AUDIO_INPUT_SILENCE_DB);
  });

  it("liefert RMS dB nach Analyser-Sample", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    // Internen Analyser-Mock mit Fake-Data füttern.
    const internal = rec as unknown as { _analyser: MockAnalyserNode };
    internal._analyser.__setFakeData(new Float32Array(1024).fill(0.5));
    const db = rec.getLevel();
    expect(db).toBeCloseTo(-6, 0);
  });
});

describe("AudioInputRecorder Setter (v3.113.0)", () => {
  it("setMonitorGain clamped + updated GainNode", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    rec.setMonitorGain(0.75);
    const internal = rec as unknown as { _monitorGain: MockGainNode };
    expect(internal._monitorGain.gain.value).toBeCloseTo(0.75, 5);
    rec.setMonitorGain(99); // clamp
    expect(internal._monitorGain.gain.value).toBe(2);
    rec.setMonitorGain(-1); // clamp
    expect(internal._monitorGain.gain.value).toBe(0);
  });

  it("setInputGain clamped + updated", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    rec.setInputGain(1.5);
    const internal = rec as unknown as { _inputGain: MockGainNode };
    expect(internal._inputGain.gain.value).toBeCloseTo(1.5, 5);
  });
});

describe("AudioInputRecorder Memory-Cap (v3.113.0)", () => {
  it("truncated=true bei Überschreitung", async () => {
    setupGetUserMediaSuccess();
    const rec = new AudioInputRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    await rec.connect("default", ctx);
    rec.start();
    // Push einen Block größer als der Cap.
    const huge = new Float32Array(AUDIO_INPUT_MAX_FRAMES + 1024);
    rec.__pushFramesForTest(huge, huge);
    const result = rec.stop();
    expect(result.truncated).toBe(true);
  });
});

describe("useAudioInputStore — Defaults + Setter (v3.113.0)", () => {
  it("Defaults: kein device, monitor off, monitorGain 0.5, inputGain 1.0, route='master'", () => {
    const s = getAudioInputState();
    expect(s.selectedDeviceId).toBeNull();
    expect(s.monitorEnabled).toBe(false);
    expect(s.monitorGain).toBe(0.5);
    expect(s.recordSyncWithTransport).toBe(false);
    expect(s.inputGain).toBe(1.0);
    expect(s.route).toBe("master");
  });

  it("setAudioInputDevice normalisiert empty/whitespace → null", () => {
    setAudioInputDevice("");
    expect(getAudioInputState().selectedDeviceId).toBeNull();
    setAudioInputDevice("  ");
    expect(getAudioInputState().selectedDeviceId).toBeNull();
    setAudioInputDevice("default");
    expect(getAudioInputState().selectedDeviceId).toBe("default");
  });

  it("setAudioInputMonitorGain clamped 0..2", () => {
    setAudioInputMonitorGain(99);
    expect(getAudioInputState().monitorGain).toBe(2);
    setAudioInputMonitorGain(-1);
    expect(getAudioInputState().monitorGain).toBe(0);
    setAudioInputMonitorGain(0.75);
    expect(getAudioInputState().monitorGain).toBe(0.75);
  });

  it("setAudioInputInputGain clamped 0..2", () => {
    setAudioInputInputGain(5);
    expect(getAudioInputState().inputGain).toBe(2);
    setAudioInputInputGain(1.5);
    expect(getAudioInputState().inputGain).toBe(1.5);
  });

  it("setAudioInputRoute filtert garbage → 'master'", () => {
    setAudioInputRoute("live-recorder");
    expect(getAudioInputState().route).toBe("live-recorder");
    setAudioInputRoute("garbage" as never);
    expect(getAudioInputState().route).toBe("master");
  });

  it("setAudioInputMonitorEnabled idempotent", () => {
    const before = getAudioInputState();
    setAudioInputMonitorEnabled(false); // schon false
    const after = getAudioInputState();
    expect(after).toBe(before);
    setAudioInputMonitorEnabled(true);
    expect(getAudioInputState().monitorEnabled).toBe(true);
  });

  it("setAudioInputRecordSyncWithTransport toggle + persist", () => {
    setAudioInputRecordSyncWithTransport(true);
    expect(getAudioInputState().recordSyncWithTransport).toBe(true);
    setAudioInputRecordSyncWithTransport(false);
    expect(getAudioInputState().recordSyncWithTransport).toBe(false);
  });

  it("setAudioInputPartial bulk-update", () => {
    setAudioInputPartial({
      selectedDeviceId: "korg",
      monitorEnabled: true,
      monitorGain: 0.3,
      inputGain: 1.5,
      route: "both",
      recordSyncWithTransport: true,
    });
    const s = getAudioInputState();
    expect(s.selectedDeviceId).toBe("korg");
    expect(s.monitorEnabled).toBe(true);
    expect(s.monitorGain).toBe(0.3);
    expect(s.inputGain).toBe(1.5);
    expect(s.route).toBe("both");
    expect(s.recordSyncWithTransport).toBe(true);
  });
});

describe("useAudioInputStore Persistence (v3.113.0)", () => {
  it("deviceId + monitorEnabled werden in localStorage persistiert", () => {
    setAudioInputDevice("korg-1");
    setAudioInputMonitorEnabled(true);
    setAudioInputMonitorGain(0.8);
    setAudioInputRoute("both");
    const raw = globalAny.localStorage!.getItem("ss-audio-input:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.selectedDeviceId).toBe("korg-1");
    expect(parsed.monitorEnabled).toBe(true);
    expect(parsed.monitorGain).toBe(0.8);
    expect(parsed.route).toBe("both");
  });

  it("Garbage in localStorage → graceful defaults nach reset", () => {
    globalAny.localStorage!.setItem("ss-audio-input:v1", "not valid json {{{");
    __resetAudioInputStoreForTests();
    const s = getAudioInputState();
    expect(s.selectedDeviceId).toBeNull();
    expect(s.route).toBe("master");
  });
});
