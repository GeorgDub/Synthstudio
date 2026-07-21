import { describe, it, expect } from "vitest";
import {
  E2SysexBridge,
  E2SequencerRunningError,
  chunkBytes,
  type E2Transport,
} from "../../client/src/audio/E2SysexBridge";
import {
  E2Model,
  E2Func,
  buildCurrentPatternDump,
  buildPatternDump,
  buildGlobalDump,
  readPatternName,
  readPartOscRefs,
  summarizePatternBody,
  PART_TABLE_OFFSET,
  PART_STRIDE,
  PART_OSC_REF_OFFSET,
  PATTERN_NAME_OFFSET,
} from "../../client/src/utils/korg/e2Sysex";

// A body with a known name + a couple of part osc-refs, for round-trips.
function makeBody(
  name: string,
  oscRefs: Record<number, number> = {}
): Uint8Array {
  const body = new Uint8Array(0x4000);
  for (let i = 0; i < name.length; i++)
    body[PATTERN_NAME_OFFSET + i] = name.charCodeAt(i);
  for (const [pStr, ref] of Object.entries(oscRefs)) {
    const off =
      PART_TABLE_OFFSET + Number(pStr) * PART_STRIDE + PART_OSC_REF_OFFSET;
    body[off] = ref & 0xff;
    body[off + 1] = (ref >> 8) & 0xff;
  }
  return body;
}

const ACK = Uint8Array.from([
  0xf0,
  0x42,
  0x30,
  0x00,
  0x01,
  E2Model.SAMPLER,
  E2Func.ACK,
  0xf7,
]);
const NAK = Uint8Array.from([
  0xf0,
  0x42,
  0x30,
  0x00,
  0x01,
  E2Model.SAMPLER,
  E2Func.NAK,
  0xf7,
]);
function identityReply(
  model = E2Model.SAMPLER,
  ch = 0,
  vMaj = 2,
  vMin = 2
): Uint8Array {
  return Uint8Array.from([
    0xf0,
    0x42,
    0x50,
    0x01,
    ch,
    0x00,
    model,
    0,
    0,
    0,
    vMaj,
    vMin,
    0xf7,
  ]);
}

/** Transport that answers each outgoing frame via a responder (async microtask). */
function fakeDevice(responder: (frame: Uint8Array) => Uint8Array[] | null): {
  transport: E2Transport;
  sent: Uint8Array[];
} {
  const sent: Uint8Array[] = [];
  const transport: E2Transport = {
    onmessage: null,
    send(frame: Uint8Array) {
      sent.push(frame);
      const replies = responder(frame);
      if (replies)
        for (const r of replies) queueMicrotask(() => transport.onmessage?.(r));
    },
  };
  return { transport, sent };
}

function funcOf(frame: Uint8Array): number {
  // search request has a different shape (F0 42 50 00 00 F7); data frames: func @ 6
  if (frame[2] === 0x50) return -1;
  return frame[6];
}

describe("chunkBytes", () => {
  it("returns a single chunk when maxBytes <= 0 (no chunking)", () => {
    const b = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(chunkBytes(b, 0)).toHaveLength(1);
    expect(chunkBytes(b, -1)[0]).toEqual(b);
  });

  it("splits into ceil(len/max) chunks and preserves order (happy path)", () => {
    const b = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);
    const chunks = chunkBytes(b, 3);
    expect(chunks.map(c => Array.from(c))).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(Uint8Array.from(chunks.flatMap(c => Array.from(c)))).toEqual(b);
  });

  it("returns one chunk when buffer fits exactly (edge case)", () => {
    expect(chunkBytes(Uint8Array.from([1, 2, 3]), 3)).toHaveLength(1);
  });
});

describe("pattern body readers", () => {
  it("reads the pattern name (null-terminated, trimmed)", () => {
    expect(readPatternName(makeBody("ACID BASS"))).toBe("ACID BASS");
    expect(readPatternName(makeBody(""))).toBe("");
  });

  it("reads all 16 part osc refs as u16 LE", () => {
    const refs = readPartOscRefs(makeBody("x", { 0: 501, 3: 999, 15: 42 }));
    expect(refs).toHaveLength(16);
    expect(refs[0]).toBe(501);
    expect(refs[3]).toBe(999);
    expect(refs[15]).toBe(42);
    expect(refs[1]).toBe(0);
  });

  it("summarizes name + refs + length together", () => {
    const s = summarizePatternBody(makeBody("LOOP 1", { 2: 777 }));
    expect(s.name).toBe("LOOP 1");
    expect(s.oscRefs[2]).toBe(777);
    expect(s.bodyLength).toBe(0x4000);
  });
});

describe("E2SysexBridge — identify", () => {
  it("sends the search request and resolves identity", async () => {
    const { transport, sent } = fakeDevice(f =>
      funcOf(f) === -1 ? [identityReply(E2Model.SAMPLER, 3, 2, 2)] : null
    );
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    const id = await bridge.identify();
    expect(id).toEqual({
      globalChannel: 3,
      model: E2Model.SAMPLER,
      versionMajor: 2,
      versionMinor: 2,
    });
    expect(Array.from(sent[0])).toEqual([0xf0, 0x42, 0x50, 0x00, 0x00, 0xf7]);
  });

  it("rejects on timeout when the device is silent (edge case)", async () => {
    const { transport } = fakeDevice(() => null);
    const bridge = new E2SysexBridge({ timeoutMs: 20 });
    bridge.attach(transport);
    await expect(bridge.identify()).rejects.toThrow(/timeout/);
  });
});

describe("E2SysexBridge — pull", () => {
  it("pulls the current pattern and decodes the body bit-exact", async () => {
    const body = makeBody("EDITBUF", { 0: 501 });
    const { transport } = fakeDevice(f =>
      funcOf(f) === E2Func.CURRENT_PATTERN_DUMP_REQ
        ? [buildCurrentPatternDump(body)]
        : null
    );
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    expect(await bridge.pullCurrentPattern()).toEqual(body);
  });

  it("pulls a numbered pattern and returns a summary", async () => {
    const body = makeBody("SLOT 199", { 5: 640 });
    const { transport } = fakeDevice(f =>
      funcOf(f) === E2Func.PATTERN_DUMP_REQ
        ? [buildPatternDump(199, body)]
        : null
    );
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    const summary = await bridge.pullPatternSummary(199);
    expect(summary.name).toBe("SLOT 199");
    expect(summary.oscRefs[5]).toBe(640);
  });

  it("throws when the device returns NAK (edge case)", async () => {
    const { transport } = fakeDevice(() => [NAK]);
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    await expect(bridge.pullGlobal()).rejects.toThrow(/DATA LOAD ERROR/);
  });

  it("ignores a mismatched pattern number and times out (correlation)", async () => {
    // device answers with pattern 10 while we asked for 11
    const { transport } = fakeDevice(() => [
      buildPatternDump(10, makeBody("X")),
    ]);
    const bridge = new E2SysexBridge({ timeoutMs: 20 });
    bridge.attach(transport);
    await expect(bridge.pullPattern(11)).rejects.toThrow(/timeout/);
  });
});

describe("E2SysexBridge — push", () => {
  it("pushes current pattern and resolves on ACK", async () => {
    const { transport, sent } = fakeDevice(f =>
      funcOf(f) === E2Func.CURRENT_PATTERN_DUMP ? [ACK] : null
    );
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    await expect(
      bridge.pushCurrentPattern(makeBody("NEW"))
    ).resolves.toBeUndefined();
    expect(sent[0][6]).toBe(E2Func.CURRENT_PATTERN_DUMP);
  });

  it("rejects on NAK", async () => {
    const { transport } = fakeDevice(() => [NAK]);
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    await expect(bridge.pushPattern(5, makeBody("NO"))).rejects.toThrow(
      /rejected pattern 5/
    );
  });

  it("blocks writes while the sequencer runs (guard, edge case)", async () => {
    const { transport, sent } = fakeDevice(() => [ACK]);
    const bridge = new E2SysexBridge({ isPlaying: () => true });
    bridge.attach(transport);
    await expect(
      bridge.pushCurrentPattern(makeBody("X"))
    ).rejects.toBeInstanceOf(E2SequencerRunningError);
    expect(sent).toHaveLength(0); // nothing was sent
  });

  it("honours maxChunkBytes for small-buffer transports", async () => {
    const { transport, sent } = fakeDevice(f => {
      // reassemble chunks isn't needed; ack once the terminating F7 arrives
      return f[f.length - 1] === 0xf7 ? [ACK] : null;
    });
    const bridge = new E2SysexBridge({
      maxChunkBytes: 64,
      isPlaying: () => false,
    });
    bridge.attach(transport);
    await bridge.pushGlobal(
      Uint8Array.from({ length: 300 }, (_, i) => i & 0x7f)
    );
    expect(sent.length).toBeGreaterThan(1); // was chunked
    // concatenation of chunks is one valid frame F0..F7
    const whole = Uint8Array.from(sent.flatMap(c => Array.from(c)));
    expect(whole[0]).toBe(0xf0);
    expect(whole[whole.length - 1]).toBe(0xf7);
  });
});

describe("E2SysexBridge — lifecycle", () => {
  it("detach rejects pending waiters and clears the transport", async () => {
    const { transport } = fakeDevice(() => null);
    const bridge = new E2SysexBridge({ timeoutMs: 5000 });
    bridge.attach(transport);
    const pending = bridge.pullCurrentPattern();
    bridge.detach();
    await expect(pending).rejects.toThrow(/detached/);
    expect(bridge.isConnected).toBe(false);
  });

  it("uses the configured model + global channel in request headers", async () => {
    const { transport, sent } = fakeDevice(f =>
      funcOf(f) === E2Func.GLOBAL_DUMP_REQ
        ? [buildGlobalDump(Uint8Array.from([1, 2, 3]))]
        : null
    );
    const bridge = new E2SysexBridge({
      model: E2Model.SYNTH,
      globalChannel: 7,
    });
    bridge.attach(transport);
    await bridge.pullGlobal();
    expect(sent[0][2]).toBe(0x37); // 0x30 + channel 7
    expect(sent[0][5]).toBe(E2Model.SYNTH);
  });
});
