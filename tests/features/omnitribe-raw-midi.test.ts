// @vitest-environment jsdom
/**
 * omnitribe-raw-midi.test.ts — Sprint-102 raw-MIDI Bridge-Tests.
 *
 * Verifiziert:
 *   - sendNoteOn/sendNoteOff erzeugen 3-Byte MIDI-Frames im WS-Send-Queue
 *   - Incoming raw-MIDI dispatched omnitribe:noteOn / noteOff Events
 *   - Sysex und raw-MIDI koennen gleichzeitig durch dieselbe Pipe fluten
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  OmniTribeBridge, type WsTransport,
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

describe("OmniTribeBridge raw-MIDI (Sprint-102)", () => {
  let bridge: OmniTribeBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new OmniTribeBridge();
  });
  afterEach(() => vi.useRealTimers());

  // ─── Outbound: sendNoteOn / sendNoteOff ─────────────────

  it("sendNoteOn produces 3-byte 0x90 frame", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    vi.advanceTimersByTime(20);   // Identity-Request drainen
    ws.sent.length = 0;
    bridge.sendNoteOn(0, 60, 100);
    vi.advanceTimersByTime(20);
    expect(ws.sent.length).toBeGreaterThanOrEqual(1);
    const frame = ws.sent[0];
    expect(frame.length).toBe(3);
    expect(frame[0]).toBe(0x90);
    expect(frame[1]).toBe(60);
    expect(frame[2]).toBe(100);
  });

  it("sendNoteOff produces 3-byte 0x80 frame", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    vi.advanceTimersByTime(20);
    ws.sent.length = 0;
    bridge.sendNoteOff(0, 60);
    vi.advanceTimersByTime(20);
    const frame = ws.sent[0];
    expect(frame[0]).toBe(0x80);
    expect(frame[1]).toBe(60);
    expect(frame[2]).toBe(0);
  });

  it("sendNoteOn channels encoded in low nibble", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    vi.advanceTimersByTime(20);
    ws.sent.length = 0;
    bridge.sendNoteOn(7, 64, 80);
    vi.advanceTimersByTime(20);
    expect(ws.sent[0][0]).toBe(0x97);
  });

  it("sendNoteOn ohne Verbindung ist NO-OP", () => {
    expect(() => bridge.sendNoteOn(0, 60)).not.toThrow();
  });

  // ─── Inbound: Note-On dispatch CustomEvent ─────────────

  it("incoming Note-On (3 bytes 0x90) dispatches omnitribe:noteOn", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    let detail: { channel: number; note: number; velocity: number } | null = null;
    window.addEventListener("omnitribe:noteOn", (e) => {
      detail = (e as CustomEvent).detail;
    }, { once: true });
    ws.inject(new Uint8Array([0x90, 64, 90]));
    expect(detail).not.toBeNull();
    expect(detail!.channel).toBe(0);
    expect(detail!.note).toBe(64);
    expect(detail!.velocity).toBe(90);
  });

  it("incoming Note-On with vel=0 dispatches noteOff", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    let offDetail: { channel: number; note: number } | null = null;
    let onDetail: object | null = null;
    window.addEventListener("omnitribe:noteOn", (e) => { onDetail = (e as CustomEvent).detail; }, { once: true });
    window.addEventListener("omnitribe:noteOff", (e) => { offDetail = (e as CustomEvent).detail; }, { once: true });
    ws.inject(new Uint8Array([0x90, 60, 0]));
    expect(onDetail).toBeNull();
    expect(offDetail).not.toBeNull();
    expect(offDetail!.note).toBe(60);
  });

  it("incoming Note-Off (0x80) dispatches noteOff", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    let detail: { channel: number; note: number } | null = null;
    window.addEventListener("omnitribe:noteOff", (e) => {
      detail = (e as CustomEvent).detail;
    }, { once: true });
    ws.inject(new Uint8Array([0x80, 60, 0]));
    expect(detail).not.toBeNull();
    expect(detail!.note).toBe(60);
  });

  it("non-note 3-byte frames are ignored (not noteOn/Off)", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    const captured: string[] = [];
    window.addEventListener("omnitribe:noteOn",
      () => captured.push("on"), { once: true });
    window.addEventListener("omnitribe:noteOff",
      () => captured.push("off"), { once: true });
    // 0xB0 = CC, not Note → soll ignoriert werden
    ws.inject(new Uint8Array([0xB0, 0x07, 0x40]));
    expect(captured).toEqual([]);
  });

  it("sysex and raw-MIDI coexist im Output-Stream", async () => {
    const ws = new FakeWs();
    await bridge.connectWebSocket(ws);
    vi.advanceTimersByTime(20);
    ws.sent.length = 0;
    bridge.setParam(0, 0x16, 0, 42);    // Sysex
    bridge.sendNoteOn(0, 60, 100);      // raw
    bridge.sendNoteOff(0, 60);          // raw
    vi.advanceTimersByTime(20);
    expect(ws.sent.length).toBeGreaterThanOrEqual(3);
    // Erst Sysex (mit 0xF0 prefix)
    expect(ws.sent.find((f) => f[0] === 0xF0)).toBeTruthy();
    // Dann raw-MIDI Note-On
    expect(ws.sent.find((f) => f[0] === 0x90)).toBeTruthy();
    expect(ws.sent.find((f) => f[0] === 0x80)).toBeTruthy();
  });
});
