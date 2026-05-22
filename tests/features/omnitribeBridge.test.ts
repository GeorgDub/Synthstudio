// @vitest-environment jsdom
/**
 * omnitribeBridge.test.ts — Unit-Tests für die OmniTribe-Hardware-Bridge.
 *
 * SoT: G:/IdeaProjects/Synthstudio/SYNTHSTUDIO_INTEGRATION.md §9
 *      G:/IdeaProjects/Omnitribe/host/synthstudio/OmniTribeBridge.ts
 *
 * Mocked: MIDIAccess + MIDIInput/Output (Web-MIDI ist in jsdom nicht verfügbar).
 *
 * Test-Strategie:
 *   - FakeMidiOutput sammelt alle gesendeten Frames in .sent
 *   - FakeMidiInput hat optional onmidimessage — wir feuern den Listener
 *     manuell, um Param-Notify-Frames zu simulieren
 *   - Bridge-Throttler nutzt setTimeout 10ms → wir verwenden vi.useFakeTimers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  OmniTribeBridge,
  OtpCmd,
  StreamFlag,
  buildFrame,
  encode7Bit,
  decode7Bit,
} from "../../client/src/audio/OmniTribeBridge";

// ─── Fakes ───────────────────────────────────────────────────────────────────

class FakeMidiOutput {
  name = "OmniTribe v0.1";
  sent: number[][] = [];
  send(bytes: number[]) {
    this.sent.push(bytes.slice());
  }
}

class FakeMidiInput {
  name = "OmniTribe v0.1";
  onmidimessage: ((e: { data: Uint8Array }) => void) | null = null;

  /** Simuliert eingehende Sysex vom Gerät. */
  emit(bytes: number[]) {
    this.onmidimessage?.({ data: new Uint8Array(bytes) });
  }
}

function makeAccess(
  out: FakeMidiOutput | null,
  inp: FakeMidiInput | null,
): MIDIAccess {
  const outputs = new Map<string, FakeMidiOutput>();
  if (out) outputs.set("o1", out);
  const inputs = new Map<string, FakeMidiInput>();
  if (inp) inputs.set("i1", inp);
  return {
    outputs,
    inputs,
    sysexEnabled: true,
  } as unknown as MIDIAccess;
}

/** Flush throttler timers. */
function flushAll() {
  // Bridge throttler kettet sich selber; mehrfach advance damit alle Frames raus sind.
  for (let i = 0; i < 20; i++) {
    vi.advanceTimersByTime(11);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OmniTribeBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects when OmniTribe device present", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    const ok = await bridge.connect(makeAccess(out, inp));
    expect(ok).toBe(true);
    expect(bridge.isConnected).toBe(true);
  });

  it("does not connect when no OmniTribe device present", async () => {
    const otherOut = new FakeMidiOutput();
    otherOut.name = "Random MIDI device";
    const otherInp = new FakeMidiInput();
    otherInp.name = "Random MIDI device";
    const bridge = new OmniTribeBridge();
    const ok = await bridge.connect(makeAccess(otherOut, otherInp));
    expect(ok).toBe(false);
    expect(bridge.isConnected).toBe(false);
  });

  it("setParam sends a 15-byte sysex frame (F0 + 3 mfr + cmd + sub + 2 len + 5 payload + chk + F7)", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));
    out.sent.length = 0; // clear identity-request

    bridge.setParam(0x03, 0x19, 0x42, 1234);
    flushAll();

    // Erwartet: 1 frame (PARAM 0x02 / sub 0x00 / 5-byte-payload)
    const paramFrames = out.sent.filter(f => f[4] === OtpCmd.PARAM && f[5] === 0x00);
    expect(paramFrames.length).toBe(1);
    const frame = paramFrames[0];
    // Frame-Layout: F0 7D 01 02 cmd sub lenH lenL <5 payload> chk F7 = 15 bytes
    expect(frame.length).toBe(15);
    expect(frame[0]).toBe(0xF0);
    expect(frame[frame.length - 1]).toBe(0xF7);
    expect(frame[1]).toBe(0x7D);
    expect(frame[2]).toBe(0x01);
    expect(frame[3]).toBe(0x02);
    // Part 3, paramHigh 0x19, paramLow 0x42
    expect(frame[8]).toBe(0x03);
    expect(frame[9]).toBe(0x19);
    expect(frame[10]).toBe(0x42);
    // 1234 = 0x4D2 → high 7 = 0x09, low 7 = 0x52
    expect(frame[11]).toBe((1234 >> 7) & 0x7F);
    expect(frame[12]).toBe(1234 & 0x7F);
  });

  it("connect triggers an identity-request frame", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));
    flushAll();
    const idFrames = out.sent.filter(f => f[4] === OtpCmd.IDENTITY && f[5] === 0x00);
    expect(idFrames.length).toBeGreaterThanOrEqual(1);
  });

  it("Identity-Request → on(IDENTITY) handler fires with payload", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let captured: { sub: number; payload: number[] } | null = null;
    bridge.on(OtpCmd.IDENTITY, (_cmd, sub, payload) => {
      captured = { sub, payload: Array.from(payload) };
    });

    // Simuliere Identity-Response (CMD 0x01 SUB 0x01, payload = [major,minor,patch])
    const frame = buildFrame(OtpCmd.IDENTITY, 0x01, [0, 1, 7]);
    inp.emit(Array.from(frame));

    expect(captured).not.toBeNull();
    expect(captured!.sub).toBe(0x01);
    expect(captured!.payload).toEqual([0, 1, 7]);
  });

  it("Echo-Schutz: Param-Notify innerhalb 50ms nach setParam wird verworfen", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    const events: unknown[] = [];
    const onParamChange = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener("omnitribe:paramChange", onParamChange);

    try {
      bridge.setParam(0x02, 0x19, 0x00, 555);
      // Nur den 10ms-Throttler-Tick advance — NICHT die 50ms Echo-Window
      vi.advanceTimersByTime(11);

      // Sofort danach Notify mit gleichem (part, ph, pl) → Echo, wird verworfen
      const echoFrame = buildFrame(OtpCmd.PARAM, 0x03, [
        0x02, 0x19, 0x00, (555 >> 7) & 0x7F, 555 & 0x7F,
      ]);
      inp.emit(Array.from(echoFrame));

      expect(events.length).toBe(0);
    } finally {
      window.removeEventListener("omnitribe:paramChange", onParamChange);
    }
  });

  it("Param-Notify nach 50ms wird durchgelassen (Echo-Window abgelaufen)", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    const events: { part: number; value: number }[] = [];
    const onParamChange = (e: Event) => {
      const d = (e as CustomEvent).detail;
      events.push({ part: d.part, value: d.value });
    };
    window.addEventListener("omnitribe:paramChange", onParamChange);

    try {
      bridge.setParam(0x04, 0x16, 0x01, 777);
      flushAll();
      // 60ms warten → Echo-Window weg
      vi.advanceTimersByTime(60);

      const notify = buildFrame(OtpCmd.PARAM, 0x03, [
        0x04, 0x16, 0x01, (777 >> 7) & 0x7F, 777 & 0x7F,
      ]);
      inp.emit(Array.from(notify));

      expect(events.length).toBe(1);
      expect(events[0].part).toBe(0x04);
      expect(events[0].value).toBe(777);
    } finally {
      window.removeEventListener("omnitribe:paramChange", onParamChange);
    }
  });

  it("Disconnect cleans up listeners and state", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));
    expect(bridge.isConnected).toBe(true);
    expect(inp.onmidimessage).not.toBeNull();

    bridge.disconnect();
    expect(bridge.isConnected).toBe(false);
    expect(inp.onmidimessage).toBeNull();

    // setParam ohne Output ist no-op (kein Crash)
    bridge.setParam(0, 0x19, 0, 100);
    flushAll();
    expect(out.sent.filter(f => f[4] === OtpCmd.PARAM).length).toBe(0);
  });

  it("VU-Meter-Stream dispatched omnitribe:vuMeter CustomEvent", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let received: number[] | null = null;
    const onVu = (e: Event) => {
      received = (e as CustomEvent).detail.levels;
    };
    window.addEventListener("omnitribe:vuMeter", onVu);

    try {
      const levels = Array.from({ length: 16 }, (_, i) => (i * 7) & 0x7F);
      const frame = buildFrame(OtpCmd.STREAM, 0x02, levels);
      inp.emit(Array.from(frame));
      expect(received).not.toBeNull();
      expect(received!.length).toBe(16);
      expect(received![0]).toBe(0);
      expect(received![15]).toBe((15 * 7) & 0x7F);
    } finally {
      window.removeEventListener("omnitribe:vuMeter", onVu);
    }
  });

  it("Spectrum-Stream dispatched omnitribe:spectrum CustomEvent mit 64 bins", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let bins: number[] | null = null;
    const onSpec = (e: Event) => { bins = (e as CustomEvent).detail.bins; };
    window.addEventListener("omnitribe:spectrum", onSpec);

    try {
      const data = Array.from({ length: 64 }, (_, i) => i & 0x7F);
      const frame = buildFrame(OtpCmd.STREAM, 0x03, data);
      inp.emit(Array.from(frame));
      expect(bins).not.toBeNull();
      expect(bins!.length).toBe(64);
    } finally {
      window.removeEventListener("omnitribe:spectrum", onSpec);
    }
  });

  it("enableStreams sends correct bitfield payload", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));
    out.sent.length = 0;

    bridge.enableStreams(StreamFlag.VU_METER | StreamFlag.SPECTRUM | StreamFlag.PARAM_NOTIFY);
    flushAll();

    const streamFrames = out.sent.filter(f => f[4] === OtpCmd.STREAM && f[5] === 0x00);
    expect(streamFrames.length).toBe(1);
    // Payload = 1 byte = VU(1) | SPEC(2) | PARAM_NOTIFY(16) = 19
    expect(streamFrames[0][8]).toBe(0x13);
  });

  it("Invalid sysex (wrong manufacturer) is silently ignored", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let fired = false;
    bridge.on(OtpCmd.IDENTITY, () => { fired = true; });

    // F0 [wrong manufacturer] 01 00 ... F7
    inp.emit([0xF0, 0x42, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xF7]);
    expect(fired).toBe(false);
  });

  it("Checksum mismatch → frame is dropped", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let fired = false;
    bridge.on(OtpCmd.IDENTITY, () => { fired = true; });

    // Build valid frame, then corrupt the checksum byte
    const frame = Array.from(buildFrame(OtpCmd.IDENTITY, 0x01, [1, 2, 3]));
    frame[frame.length - 2] = (frame[frame.length - 2] ^ 0x55) & 0x7F;
    inp.emit(frame);
    expect(fired).toBe(false);
  });

  it("buildFrame XOR-Checksum is correct for known payload", () => {
    // payload [1,2,3]: 1 ^ 2 ^ 3 = 0
    const frame = buildFrame(0x01, 0x00, [1, 2, 3]);
    expect(frame[frame.length - 2]).toBe(0);
    // payload [0x10, 0x20, 0x30]: 0x10 ^ 0x20 ^ 0x30 = 0
    const f2 = buildFrame(0x01, 0x00, [0x10, 0x20, 0x30]);
    expect(f2[f2.length - 2]).toBe(0);
    // payload [0x7F, 0x01]: 0x7F ^ 0x01 = 0x7E
    const f3 = buildFrame(0x01, 0x00, [0x7F, 0x01]);
    expect(f3[f3.length - 2]).toBe(0x7E);
  });

  it("encode7Bit / decode7Bit round-trip preserves arbitrary 8-bit data", () => {
    const data = new Uint8Array([0x80, 0xFF, 0x00, 0x7F, 0x42, 0x99, 0xAB, 0x01]);
    const encoded = encode7Bit(data);
    const decoded = decode7Bit(encoded);
    expect(Array.from(decoded.slice(0, data.length))).toEqual(Array.from(data));
    // Alle Bytes im encodierten Stream sind 7-bit-safe
    for (let i = 0; i < encoded.length; i++) {
      expect(encoded[i] & 0x80).toBe(0);
    }
  });

  it("Remote-Transport: remoteTempo encodes BPM*100 as 21-bit (Sprint-111)", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));
    out.sent.length = 0;

    bridge.remoteTempo(120.5);
    flushAll();

    const f = out.sent.find(fr => fr[4] === OtpCmd.TRANSPORT && fr[5] === 0x03);
    expect(f).toBeDefined();
    const bpm100 = 12050;
    expect(f![8]).toBe((bpm100 >> 14) & 0x7F);
    expect(f![9]).toBe((bpm100 >> 7)  & 0x7F);
    expect(f![10]).toBe(bpm100        & 0x7F);
  });

  it("on() returns an unbind function that removes the handler", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let calls = 0;
    const unbind = bridge.on(OtpCmd.IDENTITY, () => { calls++; });

    const frame = buildFrame(OtpCmd.IDENTITY, 0x01, [0, 1, 2]);
    inp.emit(Array.from(frame));
    expect(calls).toBe(1);

    unbind();
    inp.emit(Array.from(frame));
    expect(calls).toBe(1); // didn't increment
  });
});
