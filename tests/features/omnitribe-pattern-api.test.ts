// @vitest-environment jsdom
/**
 * omnitribe-pattern-api.test.ts — Sprint-103 Bridge-Pattern-API Tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  OmniTribeBridge, OtpCmd, type WsTransport,
} from "../../client/src/audio/OmniTribeBridge";

class FakeWs implements WsTransport {
  sent: Uint8Array[] = [];
  closed = false;
  onmessage: ((data: Uint8Array) => void) | null = null;
  onclose: (() => void) | null = null;
  send(d: Uint8Array): void { this.sent.push(new Uint8Array(d)); }
  close(): void { this.closed = true; this.onclose?.(); }
}

describe("Bridge Pattern API (Sprint-103)", () => {
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

  function findFrame(cmd: number, sub: number): Uint8Array | undefined {
    return ws.sent.find((f) =>
      f.length >= 6 && f[0] === 0xF0 && f[4] === cmd && f[5] === sub,
    );
  }

  it("setPatternStepMask encodes 16-bit als 3 bytes (2+7+7)", () => {
    bridge.setPatternStepMask(0xFFFF);
    vi.advanceTimersByTime(20);
    const frame = findFrame(OtpCmd.PATTERN, 0x10);
    expect(frame).toBeDefined();
    // payload bei offset 8: [hi 2bit, mid 7bit, lo 7bit]
    if (frame) {
      expect(frame[8]).toBe(0x03);   // (0xFFFF >> 14) & 3 = 3
      expect(frame[9]).toBe(0x7F);   // (0xFFFF >> 7) & 0x7F = 0x7F
      expect(frame[10]).toBe(0x7F);  // 0xFFFF & 0x7F = 0x7F
    }
  });

  it("setPatternStepMask mit 0x0001 (nur Step 0)", () => {
    bridge.setPatternStepMask(0x0001);
    vi.advanceTimersByTime(20);
    const frame = findFrame(OtpCmd.PATTERN, 0x10);
    expect(frame).toBeDefined();
    if (frame) {
      expect(frame[8]).toBe(0);
      expect(frame[9]).toBe(0);
      expect(frame[10]).toBe(1);
    }
  });

  it("setPatternRootNote sendet CMD 0x04 SUB 0x12", () => {
    bridge.setPatternRootNote(72);
    vi.advanceTimersByTime(20);
    const frame = findFrame(OtpCmd.PATTERN, 0x12);
    expect(frame).toBeDefined();
    if (frame) expect(frame[8]).toBe(72);
  });

  it("setPatternRootNote masked auf 7-bit", () => {
    bridge.setPatternRootNote(200);
    vi.advanceTimersByTime(20);
    const frame = findFrame(OtpCmd.PATTERN, 0x12);
    if (frame) expect(frame[8]).toBe(200 & 0x7F);   // = 72
  });

  it("remotePlay/remoteStop senden CMD 0x0E SUB 0x00/0x01", () => {
    bridge.remotePlay();
    bridge.remoteStop();
    vi.advanceTimersByTime(20);
    expect(findFrame(OtpCmd.TRANSPORT, 0x00)).toBeDefined();
    expect(findFrame(OtpCmd.TRANSPORT, 0x01)).toBeDefined();
  });

  // Sprint-111: 14-bit encoding replaced by 21-bit (3×7-bit).
  it("remoteTempo encodet BPM ×100 als 21-bit (3×7-bit)", () => {
    bridge.remoteTempo(120);   // bpm_x100 = 12000
    vi.advanceTimersByTime(20);
    const frame = findFrame(OtpCmd.TRANSPORT, 0x03);
    expect(frame).toBeDefined();
    if (frame) {
      // 21-bit reconstruction: (hi << 14) | (mid << 7) | lo
      // 12000: hi=(12000>>14)&0x7F=0, mid=(12000>>7)&0x7F=93, lo=12000&0x7F=96
      const bpm_x100 = ((frame[8] & 0x7F) << 14)
                     | ((frame[9] & 0x7F) << 7)
                     |  (frame[10] & 0x7F);
      expect(bpm_x100).toBe(12000);
    }
  });

  it("alle Pattern-Methoden NO-OP ohne Connection", () => {
    const bridge2 = new OmniTribeBridge();   // nicht connected
    expect(() => {
      bridge2.setPatternStepMask(0xFFFF);
      bridge2.setPatternRootNote(60);
      bridge2.remotePlay();
      bridge2.remoteStop();
      bridge2.remoteTempo(120);
    }).not.toThrow();
  });
});
