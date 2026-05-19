// @vitest-environment jsdom
/**
 * omnitribe-pitch-offset.test.ts — Sprint-105 Per-Step Pitch-Offset Tests.
 * Bridge-API encoding + patternCache erweitert um pitchOffsets.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  OmniTribeBridge, OtpCmd, type WsTransport,
} from "../../client/src/audio/OmniTribeBridge";
import {
  loadPatternCache, savePatternCache, getDefaultPattern,
} from "../../client/src/utils/patternCache";

class FakeWs implements WsTransport {
  sent: Uint8Array[] = [];
  closed = false;
  onmessage: ((data: Uint8Array) => void) | null = null;
  onclose: (() => void) | null = null;
  send(d: Uint8Array): void { this.sent.push(new Uint8Array(d)); }
  close(): void { this.closed = true; this.onclose?.(); }
}


// ─── Bridge.setPatternStepPitchOffset ─────────────────────

describe("Bridge setPatternStepPitchOffset (Sprint-105)", () => {
  let bridge: OmniTribeBridge;
  let ws: FakeWs;

  beforeEach(async () => {
    vi.useFakeTimers();
    bridge = new OmniTribeBridge();
    ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    vi.advanceTimersByTime(20);
    ws.sent.length = 0;
  });

  afterEach(() => vi.useRealTimers());

  function findPitchFrame(): Uint8Array | undefined {
    return ws.sent.find((f) =>
      f.length >= 6 && f[4] === OtpCmd.PATTERN && f[5] === 0x15,
    );
  }

  it("positive offset sendet 7-bit direct", () => {
    bridge.setPatternStepPitchOffset(0, 12);
    vi.advanceTimersByTime(20);
    const frame = findPitchFrame();
    expect(frame).toBeDefined();
    if (frame) {
      expect(frame[8]).toBe(0);   // stepIdx
      expect(frame[9]).toBe(12);  // raw offset
    }
  });

  it("negative offset → 7-bit two's-complement", () => {
    bridge.setPatternStepPitchOffset(3, -7);
    vi.advanceTimersByTime(20);
    const frame = findPitchFrame();
    if (frame) {
      expect(frame[8]).toBe(3);
      // -7 → (-7 + 0x80) & 0x7F = 0x79 = 121
      expect(frame[9]).toBe(0x79);
    }
  });

  it("max-positive (+63) sendet 0x3F", () => {
    bridge.setPatternStepPitchOffset(0, 63);
    vi.advanceTimersByTime(20);
    const frame = findPitchFrame();
    if (frame) expect(frame[9]).toBe(0x3F);
  });

  it("max-negative (-64) sendet 0x40", () => {
    bridge.setPatternStepPitchOffset(0, -64);
    vi.advanceTimersByTime(20);
    const frame = findPitchFrame();
    if (frame) expect(frame[9]).toBe(0x40);
  });

  it("clamps over-range positive auf 63", () => {
    bridge.setPatternStepPitchOffset(0, 100);
    vi.advanceTimersByTime(20);
    const frame = findPitchFrame();
    if (frame) expect(frame[9]).toBe(0x3F);
  });

  it("clamps over-range negative auf -64", () => {
    bridge.setPatternStepPitchOffset(0, -100);
    vi.advanceTimersByTime(20);
    const frame = findPitchFrame();
    if (frame) expect(frame[9]).toBe(0x40);
  });

  it("stepIdx auf 4-bit gemasked", () => {
    bridge.setPatternStepPitchOffset(20, 5);
    vi.advanceTimersByTime(20);
    const frame = findPitchFrame();
    if (frame) expect(frame[8]).toBe(20 & 0x0F);
  });

  it("NO-OP ohne Verbindung", () => {
    const b2 = new OmniTribeBridge();
    expect(() => b2.setPatternStepPitchOffset(0, 12)).not.toThrow();
  });
});


// ─── patternCache: pitchOffsets ──────────────────────────

describe("patternCache pitchOffsets (Sprint-105)", () => {
  beforeEach(() => window.localStorage.clear());

  it("default pitchOffsets sind alle 0", () => {
    const p = loadPatternCache();
    expect(p.pitchOffsets).toEqual(Array(16).fill(0));
  });

  it("getDefaultPattern enthaelt pitchOffsets feld", () => {
    const p = getDefaultPattern();
    expect(Array.isArray(p.pitchOffsets)).toBe(true);
    expect(p.pitchOffsets.length).toBe(16);
  });

  it("roundtrip preserves pitchOffsets", () => {
    const offsets = [0, 4, 7, 12, -5, 0, 0, 24,
                      -12, 0, 3, 0, 0, 0, 0, 0];
    const def = getDefaultPattern();
    savePatternCache({ ...def, pitchOffsets: offsets });
    const loaded = loadPatternCache();
    expect(loaded.pitchOffsets).toEqual(offsets);
  });

  it("clamps offsets bei load auf [-64, +63]", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.pattern.v1",
      JSON.stringify({
        ...getDefaultPattern(),
        pitchOffsets: [100, -200, 5, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 0],
      }),
    );
    const loaded = loadPatternCache();
    expect(loaded.pitchOffsets[0]).toBe(63);
    expect(loaded.pitchOffsets[1]).toBe(-64);
    expect(loaded.pitchOffsets[2]).toBe(5);
  });

  it("falsche pitchOffsets-Laenge → defaults verwenden", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.pattern.v1",
      JSON.stringify({ ...getDefaultPattern(), pitchOffsets: [1, 2, 3] }),
    );
    const loaded = loadPatternCache();
    expect(loaded.pitchOffsets).toEqual(Array(16).fill(0));
  });

  it("missing pitchOffsets-Feld (alte v3-Daten) → defaults", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.pattern.v1",
      JSON.stringify({
        steps: Array(16).fill(false),
        velocities: Array(16).fill(100),
        bpm: 120, root: 60,
      }),
    );
    const loaded = loadPatternCache();
    expect(loaded.pitchOffsets).toEqual(Array(16).fill(0));
  });
});
