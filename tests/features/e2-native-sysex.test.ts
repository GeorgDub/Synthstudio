/**
 * Tests für client/src/utils/korg/e2NativeSysex.ts
 *
 * Referenzwerte stammen aus Korgs „electribe sampler MIDI Implementation"
 * Rev 1.00 (NOTE 1/2) und sind gegen hacktribe-editor + keijiro/e2edit
 * gegengeprüft:
 *   - Pattern-Body 16384 B → 7-bit-kodiert 18725 B
 *   - Frame CURRENT_PATTERN_DUMP (0x40) gesamt 18733 B
 *   - Frame PATTERN_DUMP (0x4C) gesamt 18735 B
 */
import { describe, it, expect } from "vitest";
import {
  E2_CMD,
  E2_PATTERN_BODY_SIZE,
  E2_MAX_PATTERN_INDEX,
  PRODUCT_ID_E2_SAMPLER,
  PRODUCT_ID_E2_SYNTH,
  encode7Bit,
  decode7Bit,
  buildFrame,
  buildCurrentPatternDumpRequest,
  buildPatternDumpRequest,
  buildGlobalDumpRequest,
  buildCurrentPatternDump,
  buildPatternDump,
  encodePatternIndex,
  decodePatternIndex,
  isE2SysexFrame,
  parseE2SysexResponse,
  buildDeviceSearchRequest,
  parseDeviceSearchReply,
  chunkSysex,
  SYSEX_CHUNK_SIZE,
  wrapPatternBodyAsFile,
} from "../../client/src/utils/korg/e2NativeSysex";

function makeBody(fill = 0): Uint8Array {
  const b = new Uint8Array(E2_PATTERN_BODY_SIZE);
  if (fill !== 0) b.fill(fill);
  return b;
}

describe("encode7Bit / decode7Bit", () => {
  it("round-trips arbitrary 8-bit data", () => {
    const src = new Uint8Array(300);
    for (let i = 0; i < src.length; i++) src[i] = (i * 37 + 11) & 0xff;
    expect(Array.from(decode7Bit(encode7Bit(src)))).toEqual(Array.from(src));
  });

  it("produces only 7-bit-safe bytes (MIDI requirement)", () => {
    const src = new Uint8Array(64).fill(0xff);
    const enc = encode7Bit(src);
    expect(enc.every((b) => b <= 0x7f)).toBe(true);
  });

  it("encodes a 16384-byte pattern body to exactly 18725 bytes", () => {
    expect(encode7Bit(makeBody(0xab)).length).toBe(18725);
  });

  it("packs the high bits into the block header", () => {
    // 7 Bytes, nur das erste und das letzte haben Bit 7 gesetzt.
    const src = Uint8Array.from([0x80, 0x01, 0x02, 0x03, 0x04, 0x05, 0x86]);
    const enc = encode7Bit(src);
    expect(enc.length).toBe(8);
    // Header-Bits: Bit0 (erstes Byte) + Bit6 (siebtes Byte) = 0b1000001
    expect(enc[0]).toBe(0b1000001);
    expect(enc[1]).toBe(0x00); // 0x80 & 0x7F
    expect(enc[7]).toBe(0x06); // 0x86 & 0x7F
  });

  it("handles a partial trailing block", () => {
    const src = Uint8Array.from([0xff, 0x7f, 0x80]); // 3 Bytes = angebrochener Block
    const enc = encode7Bit(src);
    expect(enc.length).toBe(4); // 1 Header + 3 Daten
    expect(Array.from(decode7Bit(enc))).toEqual([0xff, 0x7f, 0x80]);
  });

  it("returns empty output for empty input", () => {
    expect(encode7Bit(new Uint8Array(0)).length).toBe(0);
    expect(decode7Bit(new Uint8Array(0)).length).toBe(0);
  });
});

describe("encodePatternIndex / decodePatternIndex", () => {
  it("splits into LSB-first 7-bit pairs", () => {
    expect(encodePatternIndex(5)).toEqual([5, 0]);
    expect(encodePatternIndex(128)).toEqual([0, 1]);
    expect(encodePatternIndex(249)).toEqual([121, 1]);
  });

  it("round-trips across the whole valid range", () => {
    for (let i = 0; i <= E2_MAX_PATTERN_INDEX; i++) {
      const [lsb, msb] = encodePatternIndex(i);
      expect(decodePatternIndex(lsb, msb)).toBe(i);
    }
  });

  it("clamps out-of-range indices", () => {
    expect(encodePatternIndex(-5)).toEqual([0, 0]);
    expect(decodePatternIndex(...encodePatternIndex(9999))).toBe(E2_MAX_PATTERN_INDEX);
  });
});

describe("request builders", () => {
  it("builds the documented current-pattern request bytes", () => {
    // F0 42 30 00 01 24 10 F7
    expect(Array.from(buildCurrentPatternDumpRequest())).toEqual([
      0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x10, 0xf7,
    ]);
  });

  it("builds a pattern request with LSB-first index", () => {
    // F0 42 30 00 01 24 1C 05 00 F7
    expect(Array.from(buildPatternDumpRequest(5))).toEqual([
      0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x1c, 0x05, 0x00, 0xf7,
    ]);
  });

  it("honours the global channel in byte 2", () => {
    const f = buildCurrentPatternDumpRequest({ globalChannel: 7 });
    expect(f[2]).toBe(0x37);
  });

  it("clamps an out-of-range global channel", () => {
    expect(buildCurrentPatternDumpRequest({ globalChannel: 99 })[2]).toBe(0x3f);
    expect(buildCurrentPatternDumpRequest({ globalChannel: -3 })[2]).toBe(0x30);
  });

  it("supports the E2 Synth product id", () => {
    const f = buildCurrentPatternDumpRequest({ productId: PRODUCT_ID_E2_SYNTH });
    expect(f[4]).toBe(0x01);
    expect(f[5]).toBe(0x23);
  });

  it("builds a global dump request", () => {
    expect(Array.from(buildGlobalDumpRequest())).toEqual([
      0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x0e, 0xf7,
    ]);
  });
});

describe("buildFrame", () => {
  it("wraps body between header and F7", () => {
    const f = buildFrame(0x42, [1, 2, 3]);
    expect(f[0]).toBe(0xf0);
    expect(f[6]).toBe(0x42);
    expect(Array.from(f.subarray(7, 10))).toEqual([1, 2, 3]);
    expect(f[f.length - 1]).toBe(0xf7);
  });

  it("accepts an empty body", () => {
    expect(buildFrame(0x10).length).toBe(8);
  });

  it("masks the command byte to 7 bit", () => {
    expect(buildFrame(0xff)[6]).toBe(0x7f);
  });
});

describe("dump builders", () => {
  it("builds a current-pattern dump of exactly 18733 bytes", () => {
    expect(buildCurrentPatternDump(makeBody(0x5a)).length).toBe(18733);
  });

  it("builds a slot dump of exactly 18735 bytes", () => {
    expect(buildPatternDump(3, makeBody(0x5a)).length).toBe(18735);
  });

  it("places the index bytes before the payload in a slot dump", () => {
    const f = buildPatternDump(200, makeBody());
    expect(f[6]).toBe(E2_CMD.PATTERN_DUMP);
    expect(decodePatternIndex(f[7], f[8])).toBe(200);
  });

  it("rejects a body of the wrong size", () => {
    expect(() => buildCurrentPatternDump(new Uint8Array(10))).toThrow(/16384/);
    expect(() => buildPatternDump(0, new Uint8Array(10))).toThrow(/16384/);
  });

  it("emits only 7-bit-safe bytes between F0 and F7", () => {
    const f = buildCurrentPatternDump(makeBody(0xff));
    expect(f.subarray(1, f.length - 1).every((b) => b <= 0x7f)).toBe(true);
  });
});

describe("isE2SysexFrame", () => {
  it("accepts a valid sampler frame", () => {
    expect(isE2SysexFrame(buildCurrentPatternDumpRequest())).toBe(true);
  });

  it("accepts a synth frame", () => {
    expect(isE2SysexFrame(buildCurrentPatternDumpRequest({ productId: PRODUCT_ID_E2_SYNTH }))).toBe(true);
  });

  it("rejects foreign manufacturer and short frames", () => {
    expect(isE2SysexFrame([0xf0, 0x43, 0x30, 0x00, 0x01, 0x24, 0x10, 0xf7])).toBe(false);
    expect(isE2SysexFrame([0xf0, 0x42])).toBe(false);
  });

  it("rejects our own OTP frames (F0 7D 01 02 …)", () => {
    expect(isE2SysexFrame([0xf0, 0x7d, 0x01, 0x02, 0x01, 0x00, 0x00, 0x00, 0xf7])).toBe(false);
  });
});

describe("parseE2SysexResponse", () => {
  it("round-trips a current-pattern dump", () => {
    const body = makeBody();
    for (let i = 0; i < body.length; i++) body[i] = (i * 13) & 0xff;
    const res = parseE2SysexResponse(buildCurrentPatternDump(body));
    expect(res.kind).toBe("currentPatternDump");
    if (res.kind !== "currentPatternDump") throw new Error("wrong kind");
    expect(res.body.length).toBe(E2_PATTERN_BODY_SIZE);
    expect(Array.from(res.body.subarray(0, 32))).toEqual(Array.from(body.subarray(0, 32)));
  });

  it("round-trips a slot dump including its index", () => {
    const res = parseE2SysexResponse(buildPatternDump(77, makeBody(0x11)));
    expect(res.kind).toBe("patternDump");
    if (res.kind !== "patternDump") throw new Error("wrong kind");
    expect(res.index).toBe(77);
    expect(res.body.length).toBe(E2_PATTERN_BODY_SIZE);
    expect(res.body[0]).toBe(0x11);
  });

  it("recognises ACK and NAK", () => {
    expect(parseE2SysexResponse(buildFrame(E2_CMD.DATA_LOAD_COMPLETED)).kind).toBe("ack");
    expect(parseE2SysexResponse(buildFrame(E2_CMD.WRITE_COMPLETED)).kind).toBe("ack");
    expect(parseE2SysexResponse(buildFrame(E2_CMD.DATA_LOAD_ERROR)).kind).toBe("nak");
    expect(parseE2SysexResponse(buildFrame(E2_CMD.WRITE_ERROR)).kind).toBe("nak");
    expect(parseE2SysexResponse(buildFrame(E2_CMD.DATA_FORMAT_ERROR)).kind).toBe("nak");
  });

  it("flags a truncated pattern body as invalid instead of throwing", () => {
    const short = buildFrame(E2_CMD.CURRENT_PATTERN_DUMP, encode7Bit(new Uint8Array(64)));
    const res = parseE2SysexResponse(short);
    expect(res.kind).toBe("invalid");
  });

  it("flags a missing F7 terminator", () => {
    const f = buildCurrentPatternDumpRequest();
    const broken = f.subarray(0, f.length - 1);
    expect(parseE2SysexResponse(broken).kind).toBe("invalid");
  });

  it("reports unknown commands without throwing", () => {
    const res = parseE2SysexResponse(buildFrame(0x7e));
    expect(res.kind).toBe("unknown");
    if (res.kind !== "unknown") throw new Error("wrong kind");
    expect(res.cmd).toBe(0x7e);
  });

  it("parses a global dump", () => {
    const res = parseE2SysexResponse(buildFrame(E2_CMD.GLOBAL_DUMP, encode7Bit(new Uint8Array(256).fill(7))));
    expect(res.kind).toBe("globalDump");
    if (res.kind !== "globalDump") throw new Error("wrong kind");
    expect(res.data.length).toBe(256);
    expect(res.data[0]).toBe(7);
  });
});

describe("wrapPatternBodyAsFile", () => {
  it("produces a 16640-byte .e2spat file", () => {
    expect(wrapPatternBodyAsFile(makeBody()).length).toBe(16640);
  });

  it("writes the KORG magic and e2sampler identifier", () => {
    const f = wrapPatternBodyAsFile(makeBody());
    expect(String.fromCharCode(...f.subarray(0, 4))).toBe("KORG");
    expect(String.fromCharCode(...f.subarray(0x10, 0x19))).toBe("e2sampler");
    expect(f[0x20]).toBe(0x01);
    expect(f[0x24]).toBe(0xff);
  });

  it("copies the body verbatim behind the header", () => {
    const body = makeBody();
    body[0] = 0xde;
    body[body.length - 1] = 0xad;
    const f = wrapPatternBodyAsFile(body);
    expect(f[0x100]).toBe(0xde);
    expect(f[f.length - 1]).toBe(0xad);
  });

  it("rejects a wrongly sized body", () => {
    expect(() => wrapPatternBodyAsFile(new Uint8Array(5))).toThrow(/16384/);
  });
});

describe("device search", () => {
  it("builds the documented request", () => {
    expect(Array.from(buildDeviceSearchRequest())).toEqual([0xf0, 0x42, 0x50, 0x00, 0x00, 0xf7]);
  });

  it("parses a sampler reply", () => {
    // F0 42 50 01 0g <echo> 24 01 01 00 <maj> <min> … F7
    const reply = [0xf0, 0x42, 0x50, 0x01, 0x02, 0x00, 0x24, 0x01, 0x01, 0x00, 0x02, 0x02, 0xf7];
    const r = parseDeviceSearchReply(reply);
    expect(r).not.toBeNull();
    expect(r!.globalChannel).toBe(2);
    expect(r!.isSampler).toBe(true);
    expect(r!.version).toBe("2.2");
  });

  it("marks a synth reply as non-sampler", () => {
    const reply = [0xf0, 0x42, 0x50, 0x01, 0x00, 0x00, 0x23, 0x01, 0x01, 0x00, 0x02, 0x02, 0xf7];
    expect(parseDeviceSearchReply(reply)!.isSampler).toBe(false);
  });

  it("returns null for unrelated frames", () => {
    expect(parseDeviceSearchReply(buildCurrentPatternDumpRequest())).toBeNull();
    expect(parseDeviceSearchReply([0xf0, 0x42])).toBeNull();
  });
});

describe("chunkSysex", () => {
  it("splits a long frame into 512-byte chunks", () => {
    const f = buildCurrentPatternDump(makeBody());
    const chunks = chunkSysex(f);
    expect(chunks.length).toBe(Math.ceil(f.length / SYSEX_CHUNK_SIZE));
    expect(chunks[0].length).toBe(SYSEX_CHUNK_SIZE);
  });

  it("preserves the byte stream across chunks", () => {
    const f = buildPatternDumpRequest(9);
    const joined = chunkSysex(f, 3).reduce<number[]>((acc, c) => acc.concat(Array.from(c)), []);
    expect(joined).toEqual(Array.from(f));
  });

  it("returns a single chunk for a non-positive size", () => {
    const f = buildCurrentPatternDumpRequest();
    expect(chunkSysex(f, 0).length).toBe(1);
  });
});
