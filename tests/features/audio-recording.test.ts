/**
 * tests/features/audio-recording.test.ts
 *
 * Unit-Tests für TASK-234 (v2.86): Audio-Recording im Mixer / Record-Arm.
 *
 * Coverage:
 *  - encodeWavMono / encodeWavStereo produzieren valide WAV-Header
 *  - isValidWavHeader prüft RIFF/WAVE/fmt/data-Magic + PCM-Format
 *  - concatFloat32 mergt N Chunks korrekt
 *  - buildRecordingFileName sanitized + timestamp-pattern
 *  - isSafeRecordingFileName lehnt Path-Traversal + unsafe-chars ab
 *  - setLiveInputRecordArm toggelt das Flag persistent
 *  - getArmedLiveInputChannelIds liefert nur armed Channels
 *  - AudioRecorder.start/stop produziert WAV mit der frame-count-Dauer
 *  - AudioRecorder respektiert MAX_SIMULTANEOUS_RECORDINGS
 *  - AudioRecorder.cancel räumt ohne Encode auf
 *
 * Web-Audio API wird in Node.js via Mock-Faktories simuliert. Wir testen den
 * Recorder-State-Machine + die Pure-Helpers — keine echten Sample-Roundtrips.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (für Store-Tests) ─────────────────────────────────────
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

// ─── Imports nach localStorage-Setup ─────────────────────────────────────────
import {
  encodeWavMono,
  encodeWavStereo,
  concatFloat32,
  isValidWavHeader,
  WAV_HEADER_SIZE,
} from "../../client/src/audio/wavEncoder";
import {
  buildRecordingFileName,
  isSafeRecordingFileName,
} from "../../client/src/utils/recordingStorage";
import {
  AudioRecorder,
  MAX_SIMULTANEOUS_RECORDINGS,
} from "../../client/src/audio/AudioRecorder";
import {
  addLiveInputChannel,
  setLiveInputRecordArm,
  getArmedLiveInputChannelIds,
  getLiveInputChannel,
  removeLiveInputChannel,
  __resetForTests,
} from "../../client/src/store/useLiveInputStore";

// ─── AudioContext-Mock (Web-Audio in Node) ───────────────────────────────────

class MockAudioNode {
  private _connections: MockAudioNode[] = [];
  connect(target: MockAudioNode): void { this._connections.push(target); }
  disconnect(_target?: MockAudioNode): void { this._connections = []; }
  get connections(): MockAudioNode[] { return this._connections.slice(); }
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
  /** Test-helper: schreibt eine konstante Wave in den Buffer. */
  fill(channel: number, value: number): void {
    const arr = this._data[channel];
    for (let i = 0; i < arr.length; i++) arr[i] = value;
  }
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1, setTargetAtTime: () => {} };
}

class MockAudioContext {
  sampleRate = 48000;
  destination = new MockAudioNode();
  createGain(): MockGainNode { return new MockGainNode(); }
  createScriptProcessor(bufSize: number, ic: number, oc: number): MockScriptProcessor {
    return new MockScriptProcessor(bufSize, ic, oc);
  }
}

/** Simuliert N "onaudioprocess"-Ticks mit konstantem Wert. */
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

// ─── Test-Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
  __resetForTests();
});

// ─── 1. WAV-Encoder ──────────────────────────────────────────────────────────

describe("wavEncoder – encodeWavMono", () => {
  it("produziert WAV mit korrektem RIFF/WAVE/fmt/data Header", () => {
    const samples = new Float32Array(100).fill(0.5);
    const buf = encodeWavMono(samples, 48000);
    expect(buf.byteLength).toBe(WAV_HEADER_SIZE + 100 * 2);
    expect(isValidWavHeader(buf)).toBe(true);
  });

  it("schreibt korrekte Sample-Rate + Mono-Channel-Count in Header", () => {
    const buf = encodeWavMono(new Float32Array(10), 44100);
    const view = new DataView(buf);
    expect(view.getUint16(22, true)).toBe(1);     // numChannels
    expect(view.getUint32(24, true)).toBe(44100); // sampleRate
    expect(view.getUint16(34, true)).toBe(16);    // bitDepth
  });

  it("wirft bei ungültiger Sample-Rate", () => {
    expect(() => encodeWavMono(new Float32Array(10), 0)).toThrow();
    expect(() => encodeWavMono(new Float32Array(10), -1)).toThrow();
    expect(() => encodeWavMono(new Float32Array(10), NaN)).toThrow();
  });

  it("clipped Werte außerhalb [-1, +1]", () => {
    const buf = encodeWavMono(new Float32Array([2, -2, 0]), 48000);
    const view = new DataView(buf);
    // Sample 0 (2.0) → clipped auf +1.0 → +0x7FFF
    expect(view.getInt16(WAV_HEADER_SIZE + 0, true)).toBe(0x7FFF);
    // Sample 1 (-2.0) → clipped auf -1.0 → -0x8000
    expect(view.getInt16(WAV_HEADER_SIZE + 2, true)).toBe(-0x8000);
    // Sample 2 (0) → 0
    expect(view.getInt16(WAV_HEADER_SIZE + 4, true)).toBe(0);
  });
});

describe("wavEncoder – encodeWavStereo", () => {
  it("interleavt L/R im Datenbereich", () => {
    const left = new Float32Array([1, 0, 1]);
    const right = new Float32Array([0, 1, 0]);
    const buf = encodeWavStereo(left, right, 48000);
    const view = new DataView(buf);
    // Stereo: numChannels=2, blockAlign=4
    expect(view.getUint16(22, true)).toBe(2);
    // Sample 0 L = 1 → 0x7FFF, R = 0 → 0
    expect(view.getInt16(WAV_HEADER_SIZE + 0, true)).toBe(0x7FFF);
    expect(view.getInt16(WAV_HEADER_SIZE + 2, true)).toBe(0);
  });

  it("trimmt auf min(L,R)-Länge bei mismatch", () => {
    const left = new Float32Array(50);
    const right = new Float32Array(30);
    const buf = encodeWavStereo(left, right, 48000);
    // 30 Frames * 2 channels * 2 bytes = 120 dataBytes
    expect(buf.byteLength).toBe(WAV_HEADER_SIZE + 120);
  });
});

describe("wavEncoder – isValidWavHeader", () => {
  it("akzeptiert eigene Encoder-Ausgabe", () => {
    const buf = encodeWavMono(new Float32Array(10), 48000);
    expect(isValidWavHeader(buf)).toBe(true);
  });

  it("lehnt zu kleine Buffer ab", () => {
    expect(isValidWavHeader(new ArrayBuffer(10))).toBe(false);
  });

  it("lehnt Buffer mit falschen Magic-Bytes ab", () => {
    const bad = new ArrayBuffer(WAV_HEADER_SIZE);
    const view = new DataView(bad);
    view.setUint8(0, 0x42); // nicht 'R'
    expect(isValidWavHeader(bad)).toBe(false);
  });
});

describe("wavEncoder – concatFloat32", () => {
  it("mergt mehrere Chunks", () => {
    const out = concatFloat32([
      new Float32Array([1, 2]),
      new Float32Array([3, 4, 5]),
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("liefert leeren Array bei leerer Input-Liste", () => {
    const out = concatFloat32([]);
    expect(out.length).toBe(0);
  });
});

// ─── 2. Recording-Storage Helpers ────────────────────────────────────────────

describe("recordingStorage – buildRecordingFileName", () => {
  it("baut Pattern Rec-<name>-<YYYYMMDD-HHmmss>.wav", () => {
    const name = buildRecordingFileName("Bassdrum", new Date("2026-05-17T22:30:15"));
    expect(name).toMatch(/^Rec-Bassdrum-20260517-\d{6}\.wav$/);
  });

  it("sanitized Sonderzeichen + Whitespace", () => {
    const name = buildRecordingFileName("My Bass / Drum!", new Date("2026-01-01T00:00:00"));
    // /, !, Space → _   trailing _ wird gestrippt
    expect(name).toMatch(/^Rec-My_Bass_Drum-/);
    expect(name.endsWith(".wav")).toBe(true);
    expect(name).not.toContain("/");
    expect(name).not.toContain(" ");
  });

  it("fallback auf 'channel' bei leerem Input", () => {
    const name = buildRecordingFileName("", new Date("2026-01-01T00:00:00"));
    expect(name).toMatch(/^Rec-channel-/);
  });
});

describe("recordingStorage – isSafeRecordingFileName", () => {
  it("akzeptiert legitime Dateinamen", () => {
    expect(isSafeRecordingFileName("Rec-test-20260101-000000.wav")).toBe(true);
    expect(isSafeRecordingFileName("a.wav")).toBe(true);
    expect(isSafeRecordingFileName("Rec_001.wav")).toBe(true);
  });

  it("lehnt Path-Traversal ab", () => {
    expect(isSafeRecordingFileName("../escape.wav")).toBe(false);
    expect(isSafeRecordingFileName("..\\escape.wav")).toBe(false);
    expect(isSafeRecordingFileName("foo/bar.wav")).toBe(false);
    expect(isSafeRecordingFileName("foo\\bar.wav")).toBe(false);
  });

  it("lehnt Null-Bytes ab", () => {
    expect(isSafeRecordingFileName("foo\0bar.wav")).toBe(false);
  });

  it("lehnt fehlende .wav-Extension ab", () => {
    expect(isSafeRecordingFileName("foo.txt")).toBe(false);
    expect(isSafeRecordingFileName("foo")).toBe(false);
  });

  it("lehnt zu lange + leere Namen ab", () => {
    expect(isSafeRecordingFileName("")).toBe(false);
    expect(isSafeRecordingFileName("a".repeat(125) + ".wav")).toBe(false);
  });

  it("lehnt non-string ab", () => {
    expect(isSafeRecordingFileName(null as unknown as string)).toBe(false);
    expect(isSafeRecordingFileName(undefined as unknown as string)).toBe(false);
  });
});

// ─── 3. Record-Arm im Store ──────────────────────────────────────────────────

describe("useLiveInputStore – Record-Arm", () => {
  it("setLiveInputRecordArm toggelt das Flag persistent", () => {
    const id = addLiveInputChannel({ name: "ESX" });
    expect(getLiveInputChannel(id)?.recordArmed).toBe(false);

    setLiveInputRecordArm(id, true);
    expect(getLiveInputChannel(id)?.recordArmed).toBe(true);

    // Persistenz prüfen
    const stored = localStorageMock.getItem("synthstudio:liveinputs:v1");
    expect(stored).toContain("\"recordArmed\":true");

    setLiveInputRecordArm(id, false);
    expect(getLiveInputChannel(id)?.recordArmed).toBe(false);
  });

  it("getArmedLiveInputChannelIds liefert nur armed Channels", () => {
    const a = addLiveInputChannel({ name: "A" });
    const b = addLiveInputChannel({ name: "B" });
    const c = addLiveInputChannel({ name: "C" });
    setLiveInputRecordArm(a, true);
    setLiveInputRecordArm(c, true);
    const armed = getArmedLiveInputChannelIds();
    expect(armed).toContain(a);
    expect(armed).toContain(c);
    expect(armed).not.toContain(b);
    expect(armed.length).toBe(2);
  });

  it("setLiveInputRecordArm ist no-op für unbekannte IDs", () => {
    expect(() => setLiveInputRecordArm("liveinput:does-not-exist", true)).not.toThrow();
    expect(getArmedLiveInputChannelIds()).toHaveLength(0);
  });

  it("removeLiveInputChannel entfernt armed channel sauber", () => {
    const id = addLiveInputChannel();
    setLiveInputRecordArm(id, true);
    expect(getArmedLiveInputChannelIds()).toContain(id);
    removeLiveInputChannel(id);
    expect(getArmedLiveInputChannelIds()).not.toContain(id);
    expect(getLiveInputChannel(id)).toBeNull();
  });
});

// ─── 4. AudioRecorder (mit Mock-AudioContext) ────────────────────────────────

describe("AudioRecorder – Pipeline", () => {
  it("start tappt source → processor und sammelt Frames", () => {
    const rec = new AudioRecorder();
    const ctx = new MockAudioContext() as unknown as AudioContext;
    rec.setContext(ctx);

    const source = new MockAudioNode() as unknown as AudioNode;
    const ok = rec.start("ch:1", source);
    expect(ok).toBe(true);
    expect(rec.isRecording("ch:1")).toBe(true);
    expect(rec.activeCount()).toBe(1);

    // Simulate 3 ticks á 4096 Frames = 12288 Frames @ 48k = 0.256s
    const proc = rec.activeChannelIds().length > 0
      ? // @ts-expect-error — Access privates for test
        (rec as unknown as { _active: Map<string, { processor: MockScriptProcessor }> })
          ._active.get("ch:1")!.processor
      : null;
    expect(proc).not.toBeNull();
    feedFrames(proc as unknown as MockScriptProcessor, 4096, 3, 0.5);

    const result = rec.stop("ch:1");
    expect(result).not.toBeNull();
    expect(result!.channelId).toBe("ch:1");
    expect(result!.sampleRate).toBe(48000);
    expect(result!.channels).toBe(1);
    expect(result!.durationSec).toBeCloseTo(12288 / 48000, 4);
    expect(isValidWavHeader(result!.wavBuffer)).toBe(true);
    // 12288 Mono-Samples * 2 Byte = 24576 + 44 Header
    expect(result!.wavBuffer.byteLength).toBe(WAV_HEADER_SIZE + 12288 * 2);
    expect(rec.isRecording("ch:1")).toBe(false);
    expect(rec.activeCount()).toBe(0);
  });

  it("start ist idempotent — zweiter Aufruf returnt false", () => {
    const rec = new AudioRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const source = new MockAudioNode() as unknown as AudioNode;
    expect(rec.start("ch:1", source)).toBe(true);
    expect(rec.start("ch:1", source)).toBe(false);
  });

  it("stop returnt null für nicht aktive Channels", () => {
    const rec = new AudioRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    expect(rec.stop("ch:none")).toBeNull();
  });

  it("wirft wenn AudioContext fehlt", () => {
    const rec = new AudioRecorder();
    const source = new MockAudioNode() as unknown as AudioNode;
    expect(() => rec.start("ch:1", source)).toThrow(/AudioContext/);
  });

  it("respektiert MAX_SIMULTANEOUS_RECORDINGS (8)", () => {
    const rec = new AudioRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const source = new MockAudioNode() as unknown as AudioNode;
    for (let i = 0; i < MAX_SIMULTANEOUS_RECORDINGS; i++) {
      expect(rec.start(`ch:${i}`, source)).toBe(true);
    }
    // 9. Aufruf → false
    expect(rec.start("ch:overflow", source)).toBe(false);
    expect(rec.activeCount()).toBe(MAX_SIMULTANEOUS_RECORDINGS);
  });

  it("stopAll finalisiert alle aktiven Aufnahmen", () => {
    const rec = new AudioRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const source = new MockAudioNode() as unknown as AudioNode;
    rec.start("a", source);
    rec.start("b", source);
    rec.start("c", source);
    expect(rec.activeCount()).toBe(3);
    const results = rec.stopAll();
    expect(results).toHaveLength(3);
    expect(rec.activeCount()).toBe(0);
    for (const r of results) {
      expect(isValidWavHeader(r.wavBuffer)).toBe(true);
    }
  });

  it("cancel räumt ohne Encode auf", () => {
    const rec = new AudioRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const source = new MockAudioNode() as unknown as AudioNode;
    rec.start("ch:x", source);
    expect(rec.isRecording("ch:x")).toBe(true);
    rec.cancel("ch:x");
    expect(rec.isRecording("ch:x")).toBe(false);
    // stop() danach returnt null
    expect(rec.stop("ch:x")).toBeNull();
  });

  it("dispose bricht alle Aufnahmen ab", () => {
    const rec = new AudioRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const source = new MockAudioNode() as unknown as AudioNode;
    rec.start("a", source);
    rec.start("b", source);
    rec.dispose();
    expect(rec.activeCount()).toBe(0);
  });

  it("currentDurationMs liefert 0 wenn nicht aktiv, >=0 wenn aktiv", () => {
    const rec = new AudioRecorder();
    rec.setContext(new MockAudioContext() as unknown as AudioContext);
    const source = new MockAudioNode() as unknown as AudioNode;
    expect(rec.currentDurationMs("ch:nope")).toBe(0);
    rec.start("ch:x", source);
    expect(rec.currentDurationMs("ch:x")).toBeGreaterThanOrEqual(0);
  });
});
