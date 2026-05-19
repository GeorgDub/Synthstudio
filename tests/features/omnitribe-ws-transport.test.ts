// @vitest-environment jsdom
/**
 * omnitribe-ws-transport.test.ts — Sprint-97 Virtual-MIDI-Loop via
 * WebSocket-Transport. Tests fuer OmniTribeBridge.connectWebSocket().
 *
 * Validation Schema:
 *   - WS-Send laeuft durch buildFrame + Throttle-Queue identisch zu Web-MIDI
 *   - handleIncoming-Pipeline funktioniert mit WS-bytes
 *   - disconnect() cleant WS-Adapter sauber
 *   - Mixed-Mode (Web-MIDI + WS gleichzeitig) bevorzugt Web-MIDI
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  OmniTribeBridge,
  OtpCmd,
  buildFrame,
  type WsTransport,
} from "../../client/src/audio/OmniTribeBridge";

// ─── Fake WsTransport ─────────────────────────────────────

class FakeWsTransport implements WsTransport {
  sent: Uint8Array[] = [];
  closed = false;
  onmessage: ((data: Uint8Array) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: Uint8Array): void {
    this.sent.push(new Uint8Array(data));
  }
  close(): void {
    this.closed = true;
    this.onclose?.();
  }
  /** Test-Helper: simulates server-pushed frame. */
  inject(data: Uint8Array): void {
    this.onmessage?.(data);
  }
}

describe("OmniTribeBridge WebSocket transport", () => {
  let bridge: OmniTribeBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new OmniTribeBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connectWebSocket sets isConnected = true", async () => {
    const ws = new FakeWsTransport();
    expect(bridge.isConnected).toBe(false);
    const ok = await bridge.connectWebSocket(ws);
    expect(ok).toBe(true);
    expect(bridge.isConnected).toBe(true);
  });

  it("connectWebSocket sends Identity request automatically", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    // Throttle-Queue → flushQueue setTimeout(10ms)
    vi.advanceTimersByTime(20);
    expect(ws.sent.length).toBeGreaterThanOrEqual(1);
    // CMD 0x01 SUB 0x00 = Identity-Request
    const first = ws.sent[0];
    expect(first[4]).toBe(OtpCmd.IDENTITY);
    expect(first[5]).toBe(0x00);
  });

  it("setParam routes through WS when no Web-MIDI is connected", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    ws.sent.length = 0;       // clear Identity
    bridge.setParam(0, 0x16, 0x00, 42);
    vi.advanceTimersByTime(20);
    // Frame mit CMD 0x02 SUB 0x00
    const frame = ws.sent.find((f) => f[4] === OtpCmd.PARAM && f[5] === 0x00);
    expect(frame).toBeDefined();
  });

  it("incoming WS message dispatches handlers", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    const calls: number[][] = [];
    bridge.on(OtpCmd.IDENTITY, (cmd, sub, payload) => {
      calls.push([cmd, sub, payload.length]);
    });
    // Inject a fake Identity-Response: F0 7D 01 02 01 01 0 5 [0,1,0,0,0] chk F7
    const payload = new Uint8Array([0, 1, 0, 0, 0]);
    const frame = buildFrame(OtpCmd.IDENTITY, 0x01, payload);
    ws.inject(frame);
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe(OtpCmd.IDENTITY);
    expect(calls[0][1]).toBe(0x01);
  });

  it("disconnect closes WS adapter and resets state", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    bridge.disconnect();
    expect(ws.closed).toBe(true);
    expect(bridge.isConnected).toBe(false);
  });

  it("disconnect does not throw if WS.close throws", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    ws.close = () => { throw new Error("network gone"); };
    expect(() => bridge.disconnect()).not.toThrow();
  });

  it("WS.onclose callback transitions to disconnected", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    expect(bridge.isConnected).toBe(true);
    // Simuliere server-side disconnect: ws.onclose-Trigger
    ws.onclose?.();
    expect(bridge.isConnected).toBe(false);
  });

  it("uploadChordUserSlot via WS uses CMD 0x02 SUB 0x04", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    ws.sent.length = 0;
    bridge.uploadChordUserSlot(2, [0, 5, 7]);
    vi.advanceTimersByTime(20);
    const frame = ws.sent.find((f) => f[4] === OtpCmd.PARAM && f[5] === 0x04);
    expect(frame).toBeDefined();
    // Payload bytes after header (offset 8): slot, count, intervals
    if (frame) {
      expect(frame[8]).toBe(2);     // slot
      expect(frame[9]).toBe(3);     // count
      expect(frame[10]).toBe(0);
      expect(frame[11]).toBe(5);
      expect(frame[12]).toBe(7);
    }
  });

  it("requestChordUserSlot via WS uses CMD 0x02 SUB 0x05", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    ws.sent.length = 0;
    bridge.requestChordUserSlot(1);
    vi.advanceTimersByTime(20);
    const frame = ws.sent.find((f) => f[4] === OtpCmd.PARAM && f[5] === 0x05);
    expect(frame).toBeDefined();
    if (frame) {
      expect(frame[8]).toBe(1);     // slot
    }
  });

  it("incoming chord-user-slot reply dispatches CustomEvent", async () => {
    const ws = new FakeWsTransport();
    await bridge.connectWebSocket(ws);
    let received: { slotIndex: number; intervals: number[] } | null = null;
    window.addEventListener("omnitribe:chord-user-slot", (e) => {
      received = (e as CustomEvent).detail as {
        slotIndex: number; intervals: number[];
      };
    });
    // Inject Reply: slot=2, count=3, intervals=[0, 4, 7]
    const payload = new Uint8Array([2, 3, 0, 4, 7]);
    const frame = buildFrame(OtpCmd.PARAM, 0x05, payload);
    ws.inject(frame);
    expect(received).not.toBeNull();
    expect(received!.slotIndex).toBe(2);
    expect(received!.intervals).toEqual([0, 4, 7]);
  });
});
