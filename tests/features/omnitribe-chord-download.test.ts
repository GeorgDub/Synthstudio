// @vitest-environment jsdom
/**
 * omnitribe-chord-download.test.ts — v3.43.0 Bridge-Polish:
 *   Tests fuer OmniTribeBridge.requestChordUserSlot +
 *   requestAllChordUserSlots + Reply-Handler (CMD 0x02 SUB 0x05).
 *
 * Protocol:
 *   CMD 0x02 SUB 0x05 — Chord User-Slot Download (bidirektional).
 *   Request (H → D)  Payload: [slotIndex(1B)].
 *   Reply   (D → H)  Payload: [slotIndex(1B), intervalCount(1B), N×interval(1B, signed-7bit)].
 *
 * v3.21 hat Upload (SUB 0x04) — v3.43 closes Reverse-Direction.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  OmniTribeBridge,
  OtpCmd,
  buildFrame,
} from "../../client/src/audio/OmniTribeBridge";
import {
  requestChordUserSlot,
  requestAllChordUserSlots,
} from "../../client/src/utils/omniTribeWiring";
import { omniTribeBridge } from "../../client/src/audio/OmniTribeBridge";

// ─── Fakes ────────────────────────────────────────────────────────────────────

class FakeMidiOutput {
  name = "OmniTribe v0.1";
  sent: number[][] = [];
  send(bytes: number[]): void {
    this.sent.push(bytes.slice());
  }
}

class FakeMidiInput {
  name = "OmniTribe v0.1";
  onmidimessage: ((e: { data: Uint8Array }) => void) | null = null;
}

function makeAccess(
  out: FakeMidiOutput | null,
  inp: FakeMidiInput | null,
): MIDIAccess {
  const outputs = new Map<string, FakeMidiOutput>();
  if (out) outputs.set("o1", out);
  const inputs = new Map<string, FakeMidiInput>();
  if (inp) inputs.set("i1", inp);
  return { outputs, inputs, sysexEnabled: true } as unknown as MIDIAccess;
}

function parseFrame(bytes: number[]): {
  cmd: number;
  sub: number;
  payload: number[];
} {
  expect(bytes[0]).toBe(0xF0);
  expect(bytes[bytes.length - 1]).toBe(0xF7);
  const cmd = bytes[4];
  const sub = bytes[5];
  const len = (bytes[6] << 7) | bytes[7];
  const payload = bytes.slice(8, 8 + len);
  return { cmd, sub, payload };
}

function flushThrottler(): void {
  for (let i = 0; i < 40; i++) vi.advanceTimersByTime(11);
}

// ─── Tests: requestChordUserSlot Sysex-Encoding ──────────────────────────────

describe("OmniTribeBridge.requestChordUserSlot — Sysex-Encoding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  async function connectAndReset(): Promise<{ bridge: OmniTribeBridge; out: FakeMidiOutput; inp: FakeMidiInput }> {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));
    flushThrottler();
    out.sent.length = 0;
    return { bridge, out, inp };
  }

  it("sendet CMD 0x02 SUB 0x05 mit [slotIndex] payload", async () => {
    const { bridge, out } = await connectAndReset();

    bridge.requestChordUserSlot(0);
    flushThrottler();

    expect(out.sent.length).toBe(1);
    const { cmd, sub, payload } = parseFrame(out.sent[0]);
    expect(cmd).toBe(OtpCmd.PARAM);     // 0x02
    expect(sub).toBe(0x05);
    expect(payload).toEqual([0]);
  });

  it("sendet je ein Frame pro slotIndex 0..3", async () => {
    const { bridge, out } = await connectAndReset();

    bridge.requestChordUserSlot(0);
    bridge.requestChordUserSlot(1);
    bridge.requestChordUserSlot(2);
    bridge.requestChordUserSlot(3);
    flushThrottler();

    expect(out.sent.length).toBe(4);
    expect(parseFrame(out.sent[0]).payload).toEqual([0]);
    expect(parseFrame(out.sent[1]).payload).toEqual([1]);
    expect(parseFrame(out.sent[2]).payload).toEqual([2]);
    expect(parseFrame(out.sent[3]).payload).toEqual([3]);
  });

  it("wirft bei invalid slotIndex (out-of-range / NaN / float)", async () => {
    const { bridge } = await connectAndReset();
    expect(() => bridge.requestChordUserSlot(4)).toThrow();
    expect(() => bridge.requestChordUserSlot(-1)).toThrow();
    expect(() => bridge.requestChordUserSlot(1.5)).toThrow();
    expect(() => bridge.requestChordUserSlot(Number.NaN)).toThrow();
  });

  it("NO-OP bei Disconnected (kein Frame raus, kein throw)", () => {
    vi.useFakeTimers();
    const bridge = new OmniTribeBridge();
    expect(bridge.isConnected).toBe(false);
    bridge.requestChordUserSlot(0);
    flushThrottler();
    // Kein Throw, kein Crash. Da kein Output verbunden → kein Frame.
    expect(bridge.isConnected).toBe(false);
  });
});

// ─── Tests: Reply-Handler dispatcht CustomEvent ──────────────────────────────

describe("OmniTribeBridge — Chord-User-Slot Reply-Handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** Hilfsfn: baut eine 0x02/0x05-Reply mit signed-7bit intervals. */
  function buildReplyFrame(slotIndex: number, intervals: number[]): Uint8Array {
    const payload: number[] = [slotIndex & 0x7F, intervals.length & 0x7F];
    for (const iv of intervals) {
      const byte = iv < 0 ? (iv + 0x80) & 0x7F : iv & 0x7F;
      payload.push(byte);
    }
    return buildFrame(OtpCmd.PARAM, 0x05, payload);
  }

  it("dispatch omnitribe:chord-user-slot mit korrektem detail", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let received: { slotIndex: number; intervals: number[] } | null = null;
    const handler = (e: Event) => {
      received = (e as CustomEvent).detail;
    };
    window.addEventListener("omnitribe:chord-user-slot", handler);

    try {
      const frame = buildReplyFrame(1, [0, 4, 7]);
      bridge.__testInject(frame);
      expect(received).not.toBeNull();
      expect(received!.slotIndex).toBe(1);
      expect(received!.intervals).toEqual([0, 4, 7]);
    } finally {
      window.removeEventListener("omnitribe:chord-user-slot", handler);
    }
  });

  it("decodiert signed-7bit (negative intervals) korrekt", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let received: { slotIndex: number; intervals: number[] } | null = null;
    const handler = (e: Event) => {
      received = (e as CustomEvent).detail;
    };
    window.addEventListener("omnitribe:chord-user-slot", handler);

    try {
      // -1 → 0x7F, -12 → 0x74, 0 → 0, 4 → 4
      const frame = buildReplyFrame(2, [-1, -12, 0, 4]);
      bridge.__testInject(frame);
      expect(received).not.toBeNull();
      expect(received!.slotIndex).toBe(2);
      expect(received!.intervals).toEqual([-1, -12, 0, 4]);
    } finally {
      window.removeEventListener("omnitribe:chord-user-slot", handler);
    }
  });

  it("Empty payload defaults zu intervals=[]", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let received: { slotIndex: number; intervals: number[] } | null = null;
    const handler = (e: Event) => {
      received = (e as CustomEvent).detail;
    };
    window.addEventListener("omnitribe:chord-user-slot", handler);

    try {
      // Reply mit slotIndex=3, count=0, KEINE intervals.
      const frame = buildReplyFrame(3, []);
      bridge.__testInject(frame);
      expect(received).not.toBeNull();
      expect(received!.slotIndex).toBe(3);
      expect(received!.intervals).toEqual([]);
    } finally {
      window.removeEventListener("omnitribe:chord-user-slot", handler);
    }
  });

  it("truncated bei count > available payload bytes (defensive)", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));

    let received: { slotIndex: number; intervals: number[] } | null = null;
    const handler = (e: Event) => {
      received = (e as CustomEvent).detail;
    };
    window.addEventListener("omnitribe:chord-user-slot", handler);

    try {
      // Malformed: count sagt 5 aber nur 2 bytes danach.
      const malformed = buildFrame(OtpCmd.PARAM, 0x05, [0, 5, 4, 7]);
      bridge.__testInject(malformed);
      expect(received).not.toBeNull();
      expect(received!.slotIndex).toBe(0);
      // Sollte auf available bytes truncaten (2 bytes danach: 4, 7).
      expect(received!.intervals).toEqual([4, 7]);
    } finally {
      window.removeEventListener("omnitribe:chord-user-slot", handler);
    }
  });
});

// ─── Tests: requestAllChordUserSlots — Iteration ─────────────────────────────

describe("OmniTribeBridge.requestAllChordUserSlots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("iteriert sequentiell ueber alle 4 Slots", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, inp));
    flushThrottler();
    out.sent.length = 0;

    const pending = bridge.requestAllChordUserSlots();
    // Throttler flushen + Promise-await stepping. Da Bridge intern
    // setTimeout(10ms) zwischen den Iterationen nutzt, mehrere Cycles.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(15);
    }
    await pending;
    flushThrottler();

    expect(out.sent.length).toBe(4);
    expect(parseFrame(out.sent[0]).sub).toBe(0x05);
    expect(parseFrame(out.sent[0]).payload).toEqual([0]);
    expect(parseFrame(out.sent[1]).payload).toEqual([1]);
    expect(parseFrame(out.sent[2]).payload).toEqual([2]);
    expect(parseFrame(out.sent[3]).payload).toEqual([3]);
  });

  it("NO-OP wenn disconnected (resolved sofort, kein Frame)", async () => {
    const bridge = new OmniTribeBridge();
    expect(bridge.isConnected).toBe(false);
    await bridge.requestAllChordUserSlots();
    // Kein throw, Promise resolved.
  });
});

// ─── Tests: Wrapper (omniTribeWiring) ────────────────────────────────────────

describe("omniTribeWiring.requestChordUserSlot Wrapper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ruft bridge.requestChordUserSlot wenn connected", () => {
    const spy = vi.spyOn(omniTribeBridge, "requestChordUserSlot").mockImplementation(() => {});
    vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(true);

    const ok = requestChordUserSlot(2);
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(2);
  });

  it("NO-OP wenn disconnected (kein Bridge-Call)", () => {
    const spy = vi.spyOn(omniTribeBridge, "requestChordUserSlot").mockImplementation(() => {});
    vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(false);

    const ok = requestChordUserSlot(0);
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("requestAllChordUserSlots-Wrapper: connected → ruft Bridge", async () => {
    const spy = vi.spyOn(omniTribeBridge, "requestAllChordUserSlots").mockResolvedValue(undefined);
    vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(true);

    const ok = await requestAllChordUserSlots();
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("requestAllChordUserSlots-Wrapper: disconnected → false", async () => {
    const spy = vi.spyOn(omniTribeBridge, "requestAllChordUserSlots").mockResolvedValue(undefined);
    vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(false);

    const ok = await requestAllChordUserSlots();
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
