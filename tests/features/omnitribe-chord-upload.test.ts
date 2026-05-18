// @vitest-environment jsdom
/**
 * omnitribe-chord-upload.test.ts — v3.21.0 Bridge-Polish:
 *   Tests fuer OmniTribeBridge.uploadChordUserSlot + wrapper uploadChordUserSlot
 *   + parseChordIntervalCsv (Pure-CSV-Helper).
 *
 * Protocol:
 *   CMD 0x02 SUB 0x04 — Chord User-Slot Upload.
 *   Payload: [slotIndex(1B), intervalCount(1B), N×interval(1B, signed-7bit)].
 *   signed → 7-bit: negative wird zu (val+0x80)&0x7F (two's-complement-style).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  OmniTribeBridge,
  OtpCmd,
} from "../../client/src/audio/OmniTribeBridge";
import {
  uploadChordUserSlot,
  parseChordIntervalCsv,
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

/** Parsed Sysex-Frame (Test-Helper). */
function parseFrame(bytes: number[]): {
  cmd: number;
  sub: number;
  payload: number[];
} {
  // F0 7D 01 02 CMD SUB LEN_H LEN_L [PAYLOAD] CHK F7
  expect(bytes[0]).toBe(0xF0);
  expect(bytes[bytes.length - 1]).toBe(0xF7);
  const cmd = bytes[4];
  const sub = bytes[5];
  const len = (bytes[6] << 7) | bytes[7];
  const payload = bytes.slice(8, 8 + len);
  return { cmd, sub, payload };
}

function flushThrottler(): void {
  for (let i = 0; i < 20; i++) vi.advanceTimersByTime(11);
}

// ─── Tests: parseChordIntervalCsv (Pure-Helper) ──────────────────────────────

describe("parseChordIntervalCsv", () => {
  it("parst CSV mit Whitespace-Toleranz", () => {
    expect(parseChordIntervalCsv("0,4,7")).toEqual([0, 4, 7]);
    expect(parseChordIntervalCsv(" 0 , 4 , 7 ")).toEqual([0, 4, 7]);
  });

  it("filtert leere Tokens und ungueltige Werte", () => {
    expect(parseChordIntervalCsv("0,,4,abc,7")).toEqual([0, 4, 7]);
    expect(parseChordIntervalCsv("")).toEqual([]);
    expect(parseChordIntervalCsv("   ")).toEqual([]);
  });

  it("akzeptiert negative Halbtoene", () => {
    expect(parseChordIntervalCsv("-12,0,4,7")).toEqual([-12, 0, 4, 7]);
    expect(parseChordIntervalCsv("-3, -1, 0")).toEqual([-3, -1, 0]);
  });

  it("toleriert Non-Strings defensiv", () => {
    expect(parseChordIntervalCsv(null as unknown as string)).toEqual([]);
    expect(parseChordIntervalCsv(undefined as unknown as string)).toEqual([]);
  });
});

// ─── Tests: OmniTribeBridge.uploadChordUserSlot ──────────────────────────────

describe("OmniTribeBridge.uploadChordUserSlot — Sysex-Encoding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /**
   * connect() ruft requestIdentity → der erste gesendete Frame ist Identity,
   * nicht unser Chord-Upload. Wir flushen + clearen out.sent fuer cleane
   * Per-Test-Assertions.
   */
  async function connectAndReset(): Promise<{ bridge: OmniTribeBridge; out: FakeMidiOutput }> {
    const out = new FakeMidiOutput();
    const bridge = new OmniTribeBridge();
    await bridge.connect(makeAccess(out, new FakeMidiInput()));
    flushThrottler();
    out.sent.length = 0;
    return { bridge, out };
  }

  it("sendet CMD 0x02 SUB 0x04 mit [slotIndex, count, ...intervals]", async () => {
    const { bridge, out } = await connectAndReset();

    bridge.uploadChordUserSlot(0, [0, 4, 7]);
    flushThrottler();

    expect(out.sent.length).toBe(1);
    const { cmd, sub, payload } = parseFrame(out.sent[0]);
    expect(cmd).toBe(OtpCmd.PARAM);
    expect(sub).toBe(0x04);
    // [slot=0, count=3, 0, 4, 7]
    expect(payload).toEqual([0, 3, 0, 4, 7]);
  });

  it("encodiert negative Intervalle als 7-bit two's-complement", async () => {
    const { bridge, out } = await connectAndReset();

    // -1 → 0x7F (= 127), -12 → 0x74 (= 116)
    bridge.uploadChordUserSlot(2, [-1, -12, 0, 4]);
    flushThrottler();

    const { payload } = parseFrame(out.sent[0]);
    expect(payload[0]).toBe(2);         // slotIndex
    expect(payload[1]).toBe(4);         // count
    expect(payload[2]).toBe(0x7F);      // -1 + 0x80 = 0x7F
    expect(payload[3]).toBe(0x74);      // -12 + 0x80 = 0x74
    expect(payload[4]).toBe(0);         // 0 → 0
    expect(payload[5]).toBe(4);         // +4 → 4
  });

  it("clampt slotIndex auf 0..3", async () => {
    const { bridge, out } = await connectAndReset();

    // out-of-range slotIndex 99 → 3
    bridge.uploadChordUserSlot(99, [0]);
    bridge.uploadChordUserSlot(-1, [0]);
    flushThrottler();

    expect(out.sent.length).toBe(2);
    expect(parseFrame(out.sent[0]).payload[0]).toBe(3);
    expect(parseFrame(out.sent[1]).payload[0]).toBe(0);
  });

  it("clampt Intervalle auf -64..+63 Hardware-Window", async () => {
    const { bridge, out } = await connectAndReset();

    bridge.uploadChordUserSlot(0, [100, -100, 50]);
    flushThrottler();

    const { payload } = parseFrame(out.sent[0]);
    expect(payload[1]).toBe(3);             // count
    expect(payload[2]).toBe(63);            // +100 → +63
    expect(payload[3]).toBe((-64 + 0x80) & 0x7F); // -100 → -64 → 0x40
    expect(payload[4]).toBe(50);            // unchanged
  });

  it("truncated bei >16 Intervallen", async () => {
    const { bridge, out } = await connectAndReset();

    const long = Array.from({ length: 30 }, (_, i) => i);
    bridge.uploadChordUserSlot(1, long);
    flushThrottler();

    const { payload } = parseFrame(out.sent[0]);
    expect(payload[1]).toBe(16); // capped count
    expect(payload.length).toBe(2 + 16);
  });

  it("NO-OP bei Disconnected (kein Frame raus)", () => {
    const bridge = new OmniTribeBridge();
    // nicht connect()-aufruf
    bridge.uploadChordUserSlot(0, [0, 4, 7]);
    flushThrottler();
    // Keine MIDIOutput, also kann auch nichts gesendet werden.
    // Wichtig: kein throw, kein hängender Timer.
    expect(bridge.isConnected).toBe(false);
  });

  it("toleriert non-array Intervals defensiv", async () => {
    const { bridge, out } = await connectAndReset();

    bridge.uploadChordUserSlot(0, null as unknown as number[]);
    flushThrottler();
    const { payload } = parseFrame(out.sent[0]);
    expect(payload).toEqual([0, 0]); // slot=0, count=0
  });
});

// ─── Tests: uploadChordUserSlot Wrapper (omniTribeWiring) ────────────────────

describe("uploadChordUserSlot Wrapper — Connected-Gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ruft bridge.uploadChordUserSlot wenn connected", () => {
    const spy = vi.spyOn(omniTribeBridge, "uploadChordUserSlot");
    vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(true);

    const ok = uploadChordUserSlot(0, [0, 4, 7]);
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0, [0, 4, 7]);
  });

  it("NO-OP wenn disconnected (kein Bridge-Call)", () => {
    const spy = vi.spyOn(omniTribeBridge, "uploadChordUserSlot");
    vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(false);

    const ok = uploadChordUserSlot(0, [0, 4, 7]);
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
