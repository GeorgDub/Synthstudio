/**
 * tests/features/sample-transform-worker.test.ts (v3.120.0)
 *
 * Tests für den Web-Worker-Pfad in sampleTransform.ts (closes v3.116 caveat).
 * Wir mocken Worker via Custom-Class — kein echter Worker im Node-Test-Env.
 *
 * Cluster:
 *  1. Worker-Spawn + happy-path message-roundtrip
 *  2. Progress messages emitted (onProgress callback called)
 *  3. Cancel via AbortSignal (worker.terminate() called)
 *  4. Fallback to sync wenn useWorker=false
 *  5. Fallback wenn createWorker null returnt (kein Worker-Global)
 *  6. Error-Message returned on bad input (rejects)
 *  7. Multiple concurrent requests: requestId disambiguates
 *  8. Transferable: result is new buffer
 *  9. Pure transformChannels logic (Worker-Code direkt importiert)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  combinedTransformAsync,
  stretchSampleAsync,
  pitchShiftSampleAsync,
  __setTransformWorkerFactoryForTests,
} from "../../client/src/utils/sampleTransform";

import {
  transformChannels,
  handleTransformMessage,
  type TransformWorkerInboundMessage,
  type TransformWorkerOutboundMessage,
} from "../../client/src/audio/workers/sampleTransform.worker";

// ─── Mock AudioBuffer + Context ─────────────────────────────────────────────

class MockAudioBuffer implements AudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private data: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number, fill?: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => {
      const arr = new Float32Array(length);
      if (fill !== undefined) arr.fill(fill);
      return arr;
    });
  }
  getChannelData(c: number): Float32Array { return this.data[c]; }
  copyFromChannel(): void {}
  copyToChannel(dest: Float32Array, c: number): void {
    this.data[c].set(dest);
  }
}

class MockAudioContext {
  createBuffer(c: number, l: number, sr: number) {
    return new MockAudioBuffer(c, l, sr) as unknown as AudioBuffer;
  }
}
const ctx = new MockAudioContext() as unknown as BaseAudioContext;

// ─── Worker Mock ────────────────────────────────────────────────────────────

/**
 * Worker-Mock der die handleTransformMessage-Function direkt aufruft
 * (über setTimeout(0) damit echtes async/post-Verhalten emuliert wird).
 */
class MockWorker {
  onmessage: ((ev: MessageEvent<TransformWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent | Event) => void) | null = null;
  terminated = false;
  postedMessages: TransformWorkerInboundMessage[] = [];

  postMessage(msg: TransformWorkerInboundMessage, _transfer?: ArrayBufferLike[]): void {
    if (this.terminated) return;
    this.postedMessages.push(msg);
    // Async simulieren: in setTimeout 0
    setTimeout(() => {
      if (this.terminated) return;
      handleTransformMessage(msg, (out) => {
        if (this.terminated) return;
        this.onmessage?.({ data: out } as MessageEvent<TransformWorkerOutboundMessage>);
      });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

let lastWorker: MockWorker | null = null;
function installWorkerMock() {
  __setTransformWorkerFactoryForTests(() => {
    const w = new MockWorker();
    lastWorker = w;
    return w as unknown as Worker;
  });
}

beforeEach(() => {
  lastWorker = null;
});

afterEach(() => {
  __setTransformWorkerFactoryForTests(null);
});

// ─── 1. transformChannels (pure logic) ──────────────────────────────────────

describe("transformChannels (pure worker logic)", () => {
  it("identity case returns copy of channels (Float32Array, not same ref)", () => {
    const ch = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const result = transformChannels({
      channels: [ch],
      sampleRate: 48000,
      ratio: 1.0,
      semitones: 0,
    });
    expect(result.channels.length).toBe(1);
    expect(result.channels[0].length).toBe(4);
    expect(result.channels[0]).not.toBe(ch);
    // Float32 precision: compare element-wise mit closeTo
    const expected = [0.1, 0.2, 0.3, 0.4];
    for (let i = 0; i < expected.length; i++) {
      expect(result.channels[0][i]).toBeCloseTo(expected[i], 5);
    }
    expect(result.sampleRate).toBe(48000);
  });

  it("throws on empty input", () => {
    expect(() =>
      transformChannels({ channels: [], sampleRate: 48000, ratio: 1, semitones: 0 }),
    ).toThrow();
    expect(() =>
      transformChannels({
        channels: [new Float32Array(0)],
        sampleRate: 48000,
        ratio: 1,
        semitones: 0,
      }),
    ).toThrow();
  });

  it("stretch by 2× doubles output length", () => {
    const ch = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) ch[i] = Math.sin(i * 0.1);
    const result = transformChannels({
      channels: [ch],
      sampleRate: 48000,
      ratio: 2.0,
      semitones: 0,
    });
    expect(result.channels[0].length).toBe(2048);
  });

  it("emits progress callbacks", () => {
    const ch = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) ch[i] = Math.sin(i * 0.01);
    const progressValues: number[] = [];
    transformChannels(
      { channels: [ch], sampleRate: 48000, ratio: 2.0, semitones: 0 },
      (p) => progressValues.push(p),
    );
    expect(progressValues.length).toBeGreaterThan(0);
    // Last should reach 100
    expect(progressValues[progressValues.length - 1]).toBe(100);
    // All within [0,100]
    for (const p of progressValues) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("multi-channel: keeps channel count", () => {
    const ch0 = new Float32Array(512);
    const ch1 = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      ch0[i] = Math.sin(i * 0.1);
      ch1[i] = Math.cos(i * 0.1);
    }
    const result = transformChannels({
      channels: [ch0, ch1],
      sampleRate: 44100,
      ratio: 1.5,
      semitones: 0,
    });
    expect(result.channels.length).toBe(2);
    expect(result.channels[0].length).toBe(result.channels[1].length);
  });
});

// ─── 2. handleTransformMessage ──────────────────────────────────────────────

describe("handleTransformMessage", () => {
  it("posts 'done' message with transformed channels", () => {
    const outMessages: TransformWorkerOutboundMessage[] = [];
    const ch = new Float32Array(128);
    for (let i = 0; i < 128; i++) ch[i] = i / 128;

    handleTransformMessage(
      {
        cmd: "transform",
        requestId: "req-1",
        channels: [ch],
        sampleRate: 48000,
        ratio: 1.5,
        semitones: 0,
      },
      (out) => outMessages.push(out),
    );

    const done = outMessages.find((m) => m.type === "done");
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.requestId).toBe("req-1");
      expect(done.channels.length).toBe(1);
      expect(done.sampleRate).toBe(48000);
    }
  });

  it("posts 'error' on invalid cmd", () => {
    const outMessages: TransformWorkerOutboundMessage[] = [];
    handleTransformMessage(
      // @ts-expect-error testing bad input
      { cmd: "garbage", requestId: "req-bad" },
      (out) => outMessages.push(out),
    );
    expect(outMessages.length).toBe(1);
    expect(outMessages[0].type).toBe("error");
    if (outMessages[0].type === "error") {
      expect(outMessages[0].requestId).toBe("req-bad");
    }
  });

  it("posts 'error' on empty channels", () => {
    const outMessages: TransformWorkerOutboundMessage[] = [];
    handleTransformMessage(
      {
        cmd: "transform",
        requestId: "req-empty",
        channels: [],
        sampleRate: 48000,
        ratio: 1,
        semitones: 0,
      },
      (out) => outMessages.push(out),
    );
    const err = outMessages.find((m) => m.type === "error");
    expect(err).toBeDefined();
  });
});

// ─── 3. combinedTransformAsync — Worker-Pfad ────────────────────────────────

describe("combinedTransformAsync (worker path)", () => {
  beforeEach(() => {
    installWorkerMock();
  });

  it("happy path: spawn worker, message-roundtrip, returns AudioBuffer", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    const result = await combinedTransformAsync(ctx, buf, 1.5, 0);
    expect(result).toBeDefined();
    expect(result.numberOfChannels).toBe(1);
    expect(result.length).toBeGreaterThan(0);
    expect(lastWorker?.postedMessages.length).toBe(1);
    expect(lastWorker?.postedMessages[0].cmd).toBe("transform");
  });

  it("progress messages emitted via onProgress callback", async () => {
    // Use bigger buffer so worker emits multiple progress steps
    const buf = new MockAudioBuffer(1, 8192, 48000) as unknown as AudioBuffer;
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.01);

    const progressValues: number[] = [];
    await combinedTransformAsync(ctx, buf, 2.0, 0, {
      onProgress: (p) => progressValues.push(p),
    });
    expect(progressValues.length).toBeGreaterThan(0);
    expect(progressValues[progressValues.length - 1]).toBe(100);
  });

  it("cancel via AbortSignal: worker.terminate() called + promise rejects with AbortError", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    const controller = new AbortController();

    const promise = combinedTransformAsync(ctx, buf, 1.5, 0, {
      signal: controller.signal,
    });

    // Abort BEFORE the setTimeout(0) message-handler fires
    controller.abort();

    await expect(promise).rejects.toThrow(/Aborted/i);
    expect(lastWorker?.terminated).toBe(true);
  });

  it("aborting an already-aborted signal rejects immediately", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    const controller = new AbortController();
    controller.abort();

    const promise = combinedTransformAsync(ctx, buf, 1.5, 0, {
      signal: controller.signal,
    });
    await expect(promise).rejects.toThrow(/Aborted/i);
  });

  it("error from worker rejects the promise", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    // Patch the worker factory to inject a bad-cmd response
    __setTransformWorkerFactoryForTests(() => {
      const w = new MockWorker();
      lastWorker = w;
      // Override postMessage to send error via onmessage
      const origPost = w.postMessage.bind(w);
      w.postMessage = (msg) => {
        // Override: respond with error
        setTimeout(() => {
          if (w.terminated) return;
          w.onmessage?.({
            data: { type: "error", requestId: msg.requestId, message: "Boom" },
          } as MessageEvent<TransformWorkerOutboundMessage>);
        }, 0);
        // Avoid lint warning
        void origPost;
      };
      return w as unknown as Worker;
    });

    await expect(combinedTransformAsync(ctx, buf, 1.5, 0)).rejects.toThrow(/Boom/);
  });

  it("multiple concurrent requests: requestId disambiguates", async () => {
    const buf1 = new MockAudioBuffer(1, 128, 48000, 0.1) as unknown as AudioBuffer;
    const buf2 = new MockAudioBuffer(1, 128, 48000, 0.2) as unknown as AudioBuffer;

    const [r1, r2] = await Promise.all([
      combinedTransformAsync(ctx, buf1, 1.5, 0),
      combinedTransformAsync(ctx, buf2, 2.0, 0),
    ]);

    expect(r1.length).toBeGreaterThan(0);
    expect(r2.length).toBeGreaterThan(0);
    // Length differs because ratios differ
    expect(r2.length).toBeGreaterThan(r1.length);
  });

  it("stretchSampleAsync delegates to worker with semitones=0", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.3) as unknown as AudioBuffer;
    await stretchSampleAsync(ctx, buf, 2.0);
    expect(lastWorker?.postedMessages.length).toBe(1);
    expect(lastWorker?.postedMessages[0].semitones).toBe(0);
    expect(lastWorker?.postedMessages[0].ratio).toBe(2.0);
  });

  it("pitchShiftSampleAsync delegates to worker with ratio=1.0", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.3) as unknown as AudioBuffer;
    await pitchShiftSampleAsync(ctx, buf, 7);
    expect(lastWorker?.postedMessages.length).toBe(1);
    expect(lastWorker?.postedMessages[0].ratio).toBe(1.0);
    expect(lastWorker?.postedMessages[0].semitones).toBe(7);
  });
});

// ─── 4. Fallback Paths ──────────────────────────────────────────────────────

describe("combinedTransformAsync (fallback paths)", () => {
  it("useWorker=false uses sync path (no worker spawned)", async () => {
    const spawned = vi.fn();
    __setTransformWorkerFactoryForTests(() => {
      spawned();
      return new MockWorker() as unknown as Worker;
    });

    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    const result = await combinedTransformAsync(ctx, buf, 1.5, 0, { useWorker: false });
    expect(result).toBeDefined();
    expect(spawned).not.toHaveBeenCalled();
  });

  it("falls back to sync when worker factory returns null/throws", async () => {
    __setTransformWorkerFactoryForTests(() => {
      throw new Error("no worker available");
    });

    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    const result = await combinedTransformAsync(ctx, buf, 1.5, 0);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  it("empty buffer rejects in async API", async () => {
    const buf = new MockAudioBuffer(1, 0, 48000) as unknown as AudioBuffer;
    await expect(combinedTransformAsync(ctx, buf, 1.0, 0)).rejects.toThrow();
  });
});

// ─── 5. Transferable behaviour ──────────────────────────────────────────────

describe("Transferable buffers", () => {
  beforeEach(() => {
    installWorkerMock();
  });

  it("result is a new AudioBuffer (not the input buffer)", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    const result = await combinedTransformAsync(ctx, buf, 1.5, 0);
    expect(result).not.toBe(buf);
  });

  it("worker receives Float32Array channels (not AudioBuffer)", async () => {
    const buf = new MockAudioBuffer(1, 256, 48000, 0.5) as unknown as AudioBuffer;
    await combinedTransformAsync(ctx, buf, 1.5, 0);
    const sentChannels = lastWorker?.postedMessages[0]?.channels;
    expect(sentChannels).toBeDefined();
    expect(sentChannels?.[0]).toBeInstanceOf(Float32Array);
    expect(sentChannels?.[0].length).toBe(256);
  });
});
