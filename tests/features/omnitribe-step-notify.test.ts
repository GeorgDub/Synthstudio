// @vitest-environment jsdom
/**
 * omnitribe-step-notify.test.ts — Sprint-104 Bridge Step-Notify + per-Step
 * Velocity API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  OmniTribeBridge, OtpCmd, buildFrame, type WsTransport,
} from "../../client/src/audio/OmniTribeBridge";

class FakeWs implements WsTransport {
  sent: Uint8Array[] = [];
  closed = false;
  onmessage: ((data: Uint8Array) => void) | null = null;
  onclose: (() => void) | null = null;
  send(d: Uint8Array): void { this.sent.push(new Uint8Array(d)); }
  close(): void { this.closed = true; this.onclose?.(); }
  inject(d: Uint8Array): void { this.onmessage?.(d); }
}

describe("Bridge Step-Notify + per-step Velocity (Sprint-104)", () => {
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

  // ─── Outbound: setPatternStepVelocity ───────────────────

  it("setPatternStepVelocity sendet CMD 0x04 SUB 0x13 mit [idx, vel]", () => {
    bridge.setPatternStepVelocity(5, 80);
    vi.advanceTimersByTime(20);
    const frame = ws.sent.find((f) =>
      f.length >= 6 && f[0] === 0xF0 && f[4] === OtpCmd.PATTERN && f[5] === 0x13,
    );
    expect(frame).toBeDefined();
    if (frame) {
      expect(frame[8]).toBe(5);
      expect(frame[9]).toBe(80);
    }
  });

  it("setPatternStepVelocity masked idx auf 4 bit, velocity auf 7 bit", () => {
    bridge.setPatternStepVelocity(200, 200);   // beide out-of-range
    vi.advanceTimersByTime(20);
    const frame = ws.sent.find((f) =>
      f.length >= 6 && f[4] === OtpCmd.PATTERN && f[5] === 0x13,
    );
    if (frame) {
      expect(frame[8]).toBe(200 & 0x0F);
      expect(frame[9]).toBe(200 & 0x7F);
    }
  });

  // ─── Inbound: step-notify ───────────────────────────────

  it("incoming Step-Notify dispatched omnitribe:patternStep", () => {
    let detail: { stepIdx: number } | null = null;
    window.addEventListener("omnitribe:patternStep", (e) => {
      detail = (e as CustomEvent).detail;
    }, { once: true });
    // CMD 0x04 SUB 0x14 mit payload [7]
    const frame = buildFrame(OtpCmd.PATTERN, 0x14, new Uint8Array([7]));
    ws.inject(frame);
    expect(detail).not.toBeNull();
    expect(detail!.stepIdx).toBe(7);
  });

  it("Step-Notify mit stepIdx > 15 wird auf 4 bit gemasked", () => {
    let detail: { stepIdx: number } | null = null;
    window.addEventListener("omnitribe:patternStep", (e) => {
      detail = (e as CustomEvent).detail;
    }, { once: true });
    const frame = buildFrame(OtpCmd.PATTERN, 0x14, new Uint8Array([0x1F]));
    ws.inject(frame);
    expect(detail!.stepIdx).toBe(0x1F & 0x0F);   // 15
  });

  it("Step-Notify sequenz: 0,1,2,3 → 4 Events", () => {
    const indices: number[] = [];
    window.addEventListener("omnitribe:patternStep", (e) => {
      const d = (e as CustomEvent).detail as { stepIdx: number };
      indices.push(d.stepIdx);
    });
    for (const i of [0, 1, 2, 3]) {
      const frame = buildFrame(OtpCmd.PATTERN, 0x14, new Uint8Array([i]));
      ws.inject(frame);
    }
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("kein patternStep-Event bei anderen Pattern-Sub-Commands", () => {
    const events: number[] = [];
    window.addEventListener("omnitribe:patternStep", () => events.push(1));
    // CMD 0x04 SUB 0x10 = set-step-mask, sollte NICHT als step-notify zaehlen
    const frame = buildFrame(OtpCmd.PATTERN, 0x10, new Uint8Array([1, 2, 3]));
    ws.inject(frame);
    expect(events).toEqual([]);
  });
});
