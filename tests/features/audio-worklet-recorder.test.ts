/**
 * tests/features/audio-worklet-recorder.test.ts (v3.114.0)
 *
 * Unit-Tests für die AudioWorklet-Migration von LiveRecorder + AudioInputRecorder.
 *
 * Cluster:
 *  1. recorderWorkletLoader: isAudioWorkletAvailable + idempotenter loadRecorderWorklet
 *  2. LiveRecorder Worklet-Pfad — addTrack, port.onmessage, chunks accumulieren
 *  3. LiveRecorder Memory-Cap — 'limit' Message setzt truncated=true
 *  4. LiveRecorder Per-Channel: separate AudioWorkletNodes
 *  5. LiveRecorder stop() flusht remaining + emit 'done'
 *  6. LiveRecorder Fallback auf ScriptProcessor wenn AudioWorklet undefined
 *  7. AudioInputRecorder Worklet-Pfad parity
 *
 * jsdom-frei mit Mock-AudioWorkletNode + MessagePort.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LiveRecorder,
  LIVE_REC_MAX_FRAMES_PER_TRACK,
} from "../../client/src/audio/LiveRecorder";
import { AudioInputRecorder } from "../../client/src/audio/AudioInputRecorder";
import {
  isAudioWorkletAvailable,
  loadRecorderWorklet,
  __resetRecorderWorkletForTests,
} from "../../client/src/audio/worklets/recorderWorkletLoader";

// ─── localStorage-Mock ──────────────────────────────────────────────────────
class LocalStorageMock {
  private _d: Record<string, string> = {};
  getItem(k: string): string | null { return this._d[k] ?? null; }
  setItem(k: string, v: string): void { this._d[k] = String(v); }
  removeItem(k: string): void { delete this._d[k]; }
  clear(): void { this._d = {}; }
  get length(): number { return Object.keys(this._d).length; }
  key(i: number): string | null { return Object.keys(this._d)[i] ?? null; }
}
const globalAny = globalThis as unknown as { localStorage?: LocalStorageMock };
if (typeof globalAny.localStorage === "undefined") {
  globalAny.localStorage = new LocalStorageMock();
}

// ─── Mock Audio-Nodes ────────────────────────────────────────────────────────

class MockAudioNode {
  connections: MockAudioNode[] = [];
  connect(t: MockAudioNode): void { this.connections.push(t); }
  disconnect(_t?: MockAudioNode): void { this.connections = []; }
}
class MockGainNode extends MockAudioNode {
  gain = {
    value: 1,
    setTargetAtTime: (v: number): void => { this.gain.value = v; },
  };
}

/** Mock MessagePort. Speichert eingehende cmds + onmessage-Handler. */
class MockMessagePort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postedMessages: unknown[] = [];
  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
  }
  /** Test-Helper: triggert onmessage. */
  __triggerMessage(data: unknown): void {
    if (typeof this.onmessage === "function") {
      this.onmessage({ data } as MessageEvent);
    }
  }
}

class MockAudioWorkletNode extends MockAudioNode {
  port = new MockMessagePort();
  constructor(public name: string, public options?: unknown) {
    super();
  }
}

/** Mock AudioWorklet Container. Trackt addModule-Calls. */
class MockAudioWorklet {
  addModuleCalls: string[] = [];
  failNext = false;
  async addModule(url: string): Promise<void> {
    this.addModuleCalls.push(url);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("addModule failed");
    }
  }
}

class MockAudioBuffer {
  private _data: Float32Array[];
  constructor(channels: number, length: number, public sampleRate: number) {
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch: number): Float32Array { return this._data[ch]; }
  get numberOfChannels(): number { return this._data.length; }
}

class MockScriptProcessor extends MockAudioNode {
  onaudioprocess: ((ev: { inputBuffer: MockAudioBuffer }) => void) | null = null;
  constructor(public bufferSize: number, public ic: number, public oc: number) { super(); }
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 1024;
  smoothingTimeConstant = 0.2;
  getFloatTimeDomainData(_arr: Float32Array): void {}
}

class MockMediaStreamSource extends MockAudioNode {}

class MockAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  destination = new MockAudioNode();
  audioWorklet: MockAudioWorklet | undefined = new MockAudioWorklet();

  createGain(): MockGainNode { return new MockGainNode(); }
  createAnalyser(): MockAnalyserNode { return new MockAnalyserNode(); }
  createMediaStreamSource(_s: unknown): MockMediaStreamSource { return new MockMediaStreamSource(); }
  createScriptProcessor(s: number, i: number, o: number): MockScriptProcessor {
    return new MockScriptProcessor(s, i, o);
  }
}

/**
 * Global AudioWorkletNode-Konstruktor (das `new AudioWorkletNode(ctx, ...)`-Pattern).
 * Wir hängen es als globalThis-Property an, damit der Code (der `new
 * AudioWorkletNode(...)` direkt aufruft) ihn findet.
 */
const globalGAny = globalThis as unknown as { AudioWorkletNode?: unknown };
const originalGlobalAudioWorkletNode = globalGAny.AudioWorkletNode;

function installAudioWorkletNodeGlobal(): void {
  globalGAny.AudioWorkletNode = MockAudioWorkletNode as unknown as typeof AudioWorkletNode;
}
function uninstallAudioWorkletNodeGlobal(): void {
  globalGAny.AudioWorkletNode = originalGlobalAudioWorkletNode;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  installAudioWorkletNodeGlobal();
});

describe("recorderWorkletLoader (v3.114.0)", () => {
  it("isAudioWorkletAvailable: true für Mock-Context mit audioWorklet", () => {
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    expect(isAudioWorkletAvailable(ctx)).toBe(true);
  });

  it("isAudioWorkletAvailable: false wenn audioWorklet undefined", () => {
    const ctx = new MockAudioContext();
    ctx.audioWorklet = undefined;
    expect(isAudioWorkletAvailable(ctx as unknown as BaseAudioContext)).toBe(false);
  });

  it("isAudioWorkletAvailable: false bei null context", () => {
    expect(isAudioWorkletAvailable(null)).toBe(false);
  });

  it("loadRecorderWorklet: ruft addModule mit korrekter URL", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);
    expect(ctx.audioWorklet!.addModuleCalls.length).toBe(1);
    expect(ctx.audioWorklet!.addModuleCalls[0]).toContain("recorder-worklet.js");
  });

  it("loadRecorderWorklet: idempotent — zweiter Aufruf macht keinen erneuten addModule", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);
    expect(ctx.audioWorklet!.addModuleCalls.length).toBe(1);
  });

  it("loadRecorderWorklet: throws wenn AudioWorklet undefined", async () => {
    const ctx = new MockAudioContext();
    ctx.audioWorklet = undefined;
    await expect(
      loadRecorderWorklet(ctx as unknown as BaseAudioContext)
    ).rejects.toThrow(/AudioWorklet not available/);
  });
});

describe("LiveRecorder AudioWorklet-Pfad (v3.114.0)", () => {
  it("addTrack vor start() schaltet bei start() Worklet auf wenn ready", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    // Pre-load worklet sodass beim start() ready=true ist (synchron erreichbar).
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);

    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    // Manual ready signal: nach start() laeuft loadRecorderWorklet
    // asynchron — wir nutzen daher den track-add NACH dem start() um
    // garantiert Worklet zu treffen.
    rec.start();
    // Tick durch Microtask, damit loadRecorderWorklet-then-Handler ready setzt.
    await Promise.resolve();
    await Promise.resolve();

    const src = new MockAudioNode();
    rec.addTrack("kick", src as unknown as AudioNode, "channel", 2);
    expect(rec.usesAudioWorklet).toBe(true);
  });

  it("port.onmessage chunks: appended in bufferLeft + frameCount-Aktualisiert", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);

    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    rec.start();
    await Promise.resolve();
    await Promise.resolve();
    const src = new MockAudioNode();
    rec.addTrack("master", src as unknown as AudioNode, "master", 2);

    const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const right = new Float32Array([0.5, 0.6, 0.7, 0.8]);
    rec.__postWorkletMessageForTest("master", {
      type: "chunks",
      left,
      right,
      frameCount: 4,
    });
    const result = rec.stop();
    expect(result.master).not.toBeNull();
    expect(result.master!.left.length).toBe(4);
    expect(result.master!.left[0]).toBeCloseTo(0.1);
    expect(result.master!.right[2]).toBeCloseTo(0.7);
  });

  it("'limit'-Message: setzt truncated=true im Result", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);

    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    rec.start();
    await Promise.resolve();
    await Promise.resolve();
    const src = new MockAudioNode();
    rec.addTrack("oversize", src as unknown as AudioNode, "channel", 2);

    rec.__postWorkletMessageForTest("oversize", { type: "limit", frameCount: LIVE_REC_MAX_FRAMES_PER_TRACK + 1 });
    const result = rec.stop();
    expect(result.truncated).toBe(true);
  });

  it("Per-Channel: zwei addTracks → zwei separate Worklet-Nodes", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);

    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    rec.start();
    await Promise.resolve();
    await Promise.resolve();

    const src1 = new MockAudioNode();
    const src2 = new MockAudioNode();
    rec.addTrack("kick", src1 as unknown as AudioNode, "channel", 2);
    rec.addTrack("snare", src2 as unknown as AudioNode, "channel", 2);

    rec.__postWorkletMessageForTest("kick", {
      type: "chunks", left: new Float32Array([1, 1]), right: new Float32Array([1, 1]), frameCount: 2,
    });
    rec.__postWorkletMessageForTest("snare", {
      type: "chunks", left: new Float32Array([2, 2, 2]), right: new Float32Array([2, 2, 2]), frameCount: 3,
    });
    const result = rec.stop();
    expect(result.perChannel.size).toBe(2);
    expect(result.perChannel.get("kick")!.left.length).toBe(2);
    expect(result.perChannel.get("snare")!.left.length).toBe(3);
  });

  it("Master + Channel: Trennung in master + perChannel", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);

    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    rec.start();
    await Promise.resolve();
    await Promise.resolve();

    rec.addTrack("master", new MockAudioNode() as unknown as AudioNode, "master", 2);
    rec.addTrack("hihat", new MockAudioNode() as unknown as AudioNode, "channel", 2);
    rec.__postWorkletMessageForTest("master", {
      type: "chunks", left: new Float32Array([0.5]), right: new Float32Array([0.5]), frameCount: 1,
    });
    rec.__postWorkletMessageForTest("hihat", {
      type: "chunks", left: new Float32Array([0.9]), right: new Float32Array([0.9]), frameCount: 1,
    });
    const result = rec.stop();
    expect(result.master).not.toBeNull();
    expect(result.master!.kind).toBe("master");
    expect(result.perChannel.size).toBe(1);
    expect(result.perChannel.has("hihat")).toBe(true);
  });

  it("'done'-Message überschreibt streaming-Buffer mit finalem Buffer", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    await loadRecorderWorklet(ctx as unknown as BaseAudioContext);

    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    rec.start();
    await Promise.resolve();
    await Promise.resolve();
    rec.addTrack("vox", new MockAudioNode() as unknown as AudioNode, "channel", 2);

    rec.__postWorkletMessageForTest("vox", {
      type: "chunks", left: new Float32Array([0.1, 0.2]), right: new Float32Array([0.1, 0.2]), frameCount: 2,
    });
    rec.__postWorkletMessageForTest("vox", {
      type: "done",
      left: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      right: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      frameCount: 4,
      truncated: false,
    });
    const result = rec.stop();
    // done-Message überschreibt streaming-Buffer mit komplettem buffer.
    expect(result.perChannel.get("vox")!.left.length).toBe(4);
  });
});

describe("LiveRecorder Fallback auf ScriptProcessor (v3.114.0)", () => {
  it("Ohne AudioWorklet (audioWorklet=undefined): nimmt ScriptProcessor-Pfad", () => {
    const ctx = new MockAudioContext();
    ctx.audioWorklet = undefined;
    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    rec.start();
    const src = new MockAudioNode();
    rec.addTrack("legacy", src as unknown as AudioNode, "channel", 2);
    expect(rec.usesAudioWorklet).toBe(false);
    // ScriptProcessor wurde verbunden — connections beim src
    expect(src.connections.length).toBeGreaterThan(0);
    rec.cancel();
  });

  it("__pushFramesForTest in Fallback-Modus akkumuliert weiter", () => {
    const ctx = new MockAudioContext();
    ctx.audioWorklet = undefined;
    const rec = new LiveRecorder();
    rec.setContext(ctx as unknown as AudioContext);
    rec.start();
    rec.addTrack("legacy", new MockAudioNode() as unknown as AudioNode, "channel", 2);
    rec.__pushFramesForTest("legacy", new Float32Array([0.5, 0.5]), new Float32Array([0.5, 0.5]));
    const result = rec.stop();
    expect(result.perChannel.get("legacy")!.left.length).toBe(2);
  });
});

describe("AudioInputRecorder AudioWorklet-Pfad (v3.114.0)", () => {
  beforeEach(() => {
    // Mock global navigator.mediaDevices
    const g = globalThis as unknown as { navigator?: { mediaDevices?: unknown } };
    if (typeof g.navigator === "undefined") {
      Object.defineProperty(g, "navigator", { value: {}, writable: true, configurable: true });
    }
    const fakeStream = {
      getTracks: () => [{ stop: () => undefined }],
      getAudioTracks: () => [],
    };
    Object.defineProperty(g.navigator!, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => fakeStream),
        enumerateDevices: vi.fn(async () => []),
      },
      writable: true,
      configurable: true,
    });
  });

  it("connect() lädt Worklet im Hintergrund + start() nutzt Worklet wenn ready", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    const rec = new AudioInputRecorder();
    await rec.connect("default", ctx as unknown as AudioContext);
    // Microtasks für loadRecorderWorklet abarbeiten.
    await Promise.resolve();
    await Promise.resolve();
    expect(rec.isConnected).toBe(true);
    expect(rec.start()).toBe(true);
    expect(rec.usesAudioWorklet).toBe(true);
    rec.stop();
  });

  it("Worklet 'chunks'-Message: appends in Buffer + stop() liefert Frames", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    const rec = new AudioInputRecorder();
    await rec.connect("default", ctx as unknown as AudioContext);
    await Promise.resolve();
    await Promise.resolve();
    rec.start();
    rec.__postWorkletMessageForTest({
      type: "chunks",
      left: new Float32Array([0.1, 0.2, 0.3]),
      right: new Float32Array([0.1, 0.2, 0.3]),
      frameCount: 3,
    });
    const result = rec.stop();
    expect(result.left.length).toBe(3);
    expect(result.right.length).toBe(3);
    expect(result.wavBytes.length).toBeGreaterThan(44); // mind. Header
  });

  it("Worklet 'limit'-Message: setzt truncated=true im Result", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    const rec = new AudioInputRecorder();
    await rec.connect("default", ctx as unknown as AudioContext);
    await Promise.resolve();
    await Promise.resolve();
    rec.start();
    rec.__postWorkletMessageForTest({ type: "limit", frameCount: 999999 });
    const result = rec.stop();
    expect(result.truncated).toBe(true);
  });

  it("Fallback auf ScriptProcessor wenn audioWorklet=undefined", async () => {
    const ctx = new MockAudioContext();
    ctx.audioWorklet = undefined;
    const rec = new AudioInputRecorder();
    await rec.connect("default", ctx as unknown as AudioContext);
    rec.start();
    expect(rec.usesAudioWorklet).toBe(false);
    rec.stop();
  });

  it("disconnect() cleared Worklet-State + isConnected=false", async () => {
    const ctx = new MockAudioContext();
    __resetRecorderWorkletForTests(ctx as unknown as BaseAudioContext);
    const rec = new AudioInputRecorder();
    await rec.connect("default", ctx as unknown as AudioContext);
    await Promise.resolve();
    await Promise.resolve();
    expect(rec.isConnected).toBe(true);
    rec.disconnect();
    expect(rec.isConnected).toBe(false);
    expect(rec.usesAudioWorklet).toBe(false);
  });
});

// Cleanup um andere Tests nicht zu beeinflussen.
describe("Cleanup", () => {
  it("uninstall AudioWorkletNode global", () => {
    uninstallAudioWorkletNodeGlobal();
    expect(true).toBe(true);
  });
});
