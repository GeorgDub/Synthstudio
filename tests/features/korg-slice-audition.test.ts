/**
 * tests/features/korg-slice-audition.test.ts (v3.9.0)
 *
 * Tests für client/src/utils/korg/sliceAudition.ts:
 *   - findSliceUnderFrame: Region-Hit-Test + Out-of-Range Defenses
 *   - extractSliceBuffer:  Mono + Stereo-Kanal-0 + Bound-Clamping
 *   - playSliceWithContext: Web-Audio one-shot + Stop-Handle Lifecycle
 *
 * AudioContext + AudioBufferSourceNode werden gemockt (kein DOM nötig).
 */

import { describe, it, expect, vi } from "vitest";
import {
  findSliceUnderFrame,
  extractSliceBuffer,
  playSliceWithContext,
  type MinimalAudioCtx,
} from "@/utils/korg/sliceAudition";
import type { OnsetCandidate } from "@/utils/sampleSlicing";

// ─── Mock AudioContext / Web-Audio Nodes ─────────────────────────────────────

class MockAudioBuffer {
  channels: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  copyToChannel(data: Float32Array, ch: number): void {
    const dst = this.channels[ch];
    for (let i = 0; i < data.length && i < dst.length; i++) dst[i] = data[i];
  }
  getChannelData(ch: number): Float32Array { return this.channels[ch]; }
}

class MockAudioNode {
  public connectedTo: MockAudioNode[] = [];
  public disconnected = false;
  connect(target: MockAudioNode): void { this.connectedTo.push(target); }
  disconnect(): void { this.disconnected = true; }
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1 };
}

class MockBufferSource extends MockAudioNode {
  buffer: MockAudioBuffer | null = null;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(): void { this.started = true; }
  stop(): void {
    this.stopped = true;
    // Real Web-Audio fires 'ended' after stop() — simulate.
    queueMicrotask(() => this.onended?.());
  }
}

function makeMockCtx(): MinimalAudioCtx & {
  _buffers: MockAudioBuffer[];
  _sources: MockBufferSource[];
  _gains: MockGainNode[];
} {
  const buffers: MockAudioBuffer[] = [];
  const sources: MockBufferSource[] = [];
  const gains: MockGainNode[] = [];
  const destination = new MockAudioNode();
  return {
    createBuffer: (ch: number, len: number, sr: number) => {
      const b = new MockAudioBuffer(ch, len, sr);
      buffers.push(b);
      return b as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const s = new MockBufferSource();
      sources.push(s);
      return s as unknown as AudioBufferSourceNode;
    },
    createGain: () => {
      const g = new MockGainNode();
      gains.push(g);
      return g as unknown as GainNode;
    },
    destination: destination as unknown as AudioNode,
    _buffers: buffers,
    _sources: sources,
    _gains: gains,
  };
}

// ─── findSliceUnderFrame ─────────────────────────────────────────────────────

describe("findSliceUnderFrame", () => {
  const onsets: OnsetCandidate[] = [
    { frame: 0, strength: 1 },
    { frame: 100, strength: 1 },
    { frame: 300, strength: 1 },
  ];

  it("matches frame inside first slice region (0..100)", () => {
    const r = findSliceUnderFrame(onsets, 50, 500);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(0);
    expect(r!.startFrame).toBe(0);
    expect(r!.endFrame).toBe(100);
  });

  it("matches frame inside middle slice region (100..300)", () => {
    const r = findSliceUnderFrame(onsets, 200, 500);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(1);
    expect(r!.startFrame).toBe(100);
    expect(r!.endFrame).toBe(300);
  });

  it("matches frame inside last slice region (300..totalFrames)", () => {
    const r = findSliceUnderFrame(onsets, 400, 500);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(2);
    expect(r!.startFrame).toBe(300);
    expect(r!.endFrame).toBe(500);
  });

  it("returns null for frame ≥ totalFrames", () => {
    expect(findSliceUnderFrame(onsets, 500, 500)).toBeNull();
    expect(findSliceUnderFrame(onsets, 600, 500)).toBeNull();
  });

  it("returns null for empty onsets", () => {
    expect(findSliceUnderFrame([], 50, 500)).toBeNull();
  });

  it("returns null for frame before first onset", () => {
    const offsetOnsets: OnsetCandidate[] = [
      { frame: 100, strength: 1 },
      { frame: 200, strength: 1 },
    ];
    expect(findSliceUnderFrame(offsetOnsets, 50, 500)).toBeNull();
  });

  it("returns null for totalFrames ≤ 0", () => {
    expect(findSliceUnderFrame(onsets, 50, 0)).toBeNull();
    expect(findSliceUnderFrame(onsets, 50, -1)).toBeNull();
  });

  it("handles unsorted onsets defensively", () => {
    const unsorted: OnsetCandidate[] = [
      { frame: 300, strength: 1 },
      { frame: 0, strength: 1 },
      { frame: 100, strength: 1 },
    ];
    const r = findSliceUnderFrame(unsorted, 50, 500);
    expect(r).not.toBeNull();
    // Original-Index of frame=0 in the unsorted array is 1.
    expect(r!.index).toBe(1);
    expect(r!.startFrame).toBe(0);
    expect(r!.endFrame).toBe(100);
  });
});

// ─── extractSliceBuffer ──────────────────────────────────────────────────────

describe("extractSliceBuffer", () => {
  it("mono: copies a sub-range into a fresh Float32Array", () => {
    const pcm = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = extractSliceBuffer(pcm, 1, 2, 6);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual([2, 3, 4, 5]);
    // Defensive: own buffer (not a view).
    expect(out.buffer).not.toBe(pcm.buffer);
  });

  it("stereo: deinterleaves channel 0 (L)", () => {
    // L=0..3, R=10..13 interleaved
    const pcm = new Float32Array([0, 10, 1, 11, 2, 12, 3, 13]);
    const out = extractSliceBuffer(pcm, 2, 1, 3);
    expect(out.length).toBe(2);
    expect(Array.from(out)).toEqual([1, 2]);
  });

  it("clamps startFrame < 0 to 0", () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    const out = extractSliceBuffer(pcm, 1, -10, 3);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("clamps endFrame > totalFrames to totalFrames", () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    const out = extractSliceBuffer(pcm, 1, 1, 999);
    expect(Array.from(out)).toEqual([2, 3, 4]);
  });

  it("returns empty array when endFrame ≤ startFrame", () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    expect(extractSliceBuffer(pcm, 1, 3, 3).length).toBe(0);
    expect(extractSliceBuffer(pcm, 1, 5, 1).length).toBe(0);
  });

  it("returns empty array for empty pcm", () => {
    expect(extractSliceBuffer(new Float32Array(0), 1, 0, 10).length).toBe(0);
  });
});

// ─── playSliceWithContext ────────────────────────────────────────────────────

describe("playSliceWithContext", () => {
  it("creates AudioBufferSourceNode with the correct sub-buffer + starts it", () => {
    const ctx = makeMockCtx();
    const buf = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const handle = playSliceWithContext(ctx, buf, 44100);
    expect(handle).not.toBeNull();
    expect(ctx._buffers).toHaveLength(1);
    expect(ctx._buffers[0].length).toBe(4);
    expect(ctx._buffers[0].sampleRate).toBe(44100);
    // Buffer-Inhalt korrekt kopiert (Float32 → use closeTo precision).
    const data = ctx._buffers[0].getChannelData(0);
    expect(data[0]).toBeCloseTo(0.1, 5);
    expect(data[1]).toBeCloseTo(0.2, 5);
    expect(data[2]).toBeCloseTo(0.3, 5);
    expect(data[3]).toBeCloseTo(0.4, 5);
    expect(ctx._sources).toHaveLength(1);
    expect(ctx._sources[0].started).toBe(true);
    expect(handle!.active).toBe(true);
  });

  it("routes BufferSource → Gain → outputNode (destination by default)", () => {
    const ctx = makeMockCtx();
    const buf = new Float32Array([0.5, 0.5]);
    playSliceWithContext(ctx, buf, 48000);
    const src = ctx._sources[0] as unknown as MockBufferSource;
    const gain = ctx._gains[0];
    expect(src.connectedTo).toContain(gain);
    expect(gain.connectedTo).toContain(ctx.destination);
  });

  it("stop() stops the source and marks the handle inactive (idempotent)", () => {
    const ctx = makeMockCtx();
    const buf = new Float32Array([0.1, 0.2]);
    const handle = playSliceWithContext(ctx, buf, 44100)!;
    expect(handle.active).toBe(true);
    handle.stop();
    expect(handle.active).toBe(false);
    expect((ctx._sources[0] as unknown as MockBufferSource).stopped).toBe(true);
    // Idempotent
    expect(() => handle.stop()).not.toThrow();
  });

  it("invokes onEnded exactly once on stop()", () => {
    const ctx = makeMockCtx();
    const buf = new Float32Array([0.1, 0.2]);
    const onEnded = vi.fn();
    const handle = playSliceWithContext(ctx, buf, 44100, { onEnded })!;
    handle.stop();
    expect(onEnded).toHaveBeenCalledTimes(1);
    // Calling stop() again must not re-fire onEnded.
    handle.stop();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("returns null for empty buffer", () => {
    const ctx = makeMockCtx();
    expect(playSliceWithContext(ctx, new Float32Array(0), 44100)).toBeNull();
    expect(ctx._sources).toHaveLength(0);
  });

  it("returns null for invalid sampleRate", () => {
    const ctx = makeMockCtx();
    const buf = new Float32Array([1]);
    expect(playSliceWithContext(ctx, buf, 0)).toBeNull();
    expect(playSliceWithContext(ctx, buf, -1)).toBeNull();
    expect(playSliceWithContext(ctx, buf, NaN)).toBeNull();
  });

  it("respects custom outputNode option (routes gain → custom node)", () => {
    const ctx = makeMockCtx();
    const buf = new Float32Array([0.1]);
    const customOut = new MockAudioNode() as unknown as AudioNode;
    playSliceWithContext(ctx, buf, 44100, { outputNode: customOut });
    const gain = ctx._gains[0];
    expect(gain.connectedTo).toContain(customOut);
    // Default destination must NOT be connected.
    expect(gain.connectedTo).not.toContain(ctx.destination);
  });

  it("uses custom gain value when provided", () => {
    const ctx = makeMockCtx();
    const buf = new Float32Array([0.1]);
    playSliceWithContext(ctx, buf, 44100, { gain: 0.5 });
    expect(ctx._gains[0].gain.value).toBe(0.5);
  });

  it("integration: extractSliceBuffer → playSliceWithContext for stereo PCM", () => {
    const ctx = makeMockCtx();
    // Stereo: L=[10,20,30,40], R=[1,2,3,4] interleaved
    const pcm = new Float32Array([10, 1, 20, 2, 30, 3, 40, 4]);
    const sub = extractSliceBuffer(pcm, 2, 1, 3);
    expect(Array.from(sub)).toEqual([20, 30]); // L-Kanal-Slice 1..3
    const handle = playSliceWithContext(ctx, sub, 44100);
    expect(handle).not.toBeNull();
    expect(Array.from(ctx._buffers[0].getChannelData(0))).toEqual([20, 30]);
  });

  it("stop() before stop()-on-second-click: simulates 'next click stops previous'", () => {
    const ctx = makeMockCtx();
    const onEnded1 = vi.fn();
    const onEnded2 = vi.fn();
    const h1 = playSliceWithContext(ctx, new Float32Array([1]), 44100, { onEnded: onEnded1 })!;
    // Caller stoppt h1 bevor sie h2 startet (UI-Pattern).
    h1.stop();
    expect(onEnded1).toHaveBeenCalledTimes(1);
    expect(h1.active).toBe(false);
    const h2 = playSliceWithContext(ctx, new Float32Array([2]), 44100, { onEnded: onEnded2 })!;
    expect(h2.active).toBe(true);
    expect(ctx._sources).toHaveLength(2);
    expect(ctx._sources[1].started).toBe(true);
  });
});
