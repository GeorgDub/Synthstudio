import { describe, it, expect } from "vitest";
import {
  encode7in8,
  decode7in8,
  patternNumberToMidi,
  midiToPatternNumber,
  buildSearchRequest,
  buildCurrentPatternDumpRequest,
  buildPatternDumpRequest,
  buildGlobalDumpRequest,
  buildCurrentPatternDump,
  buildPatternDump,
  buildGlobalDump,
  patternFileToBody,
  bodyToPatternFile,
  parseSysex,
  E2Model,
  E2Func,
  SYSEX_START,
  SYSEX_END,
  KORG_ID,
  E2_FILE_HEADER_SIZE,
} from "../../client/src/utils/korg/e2Sysex";

// Reference vector: 7 raw bytes with mixed MSBs → 8 MIDI bytes.
// bytes 0x80,0x01,0xFF,0x00,0x40,0xC0,0x7F
// header bit i = MSB of byte i: b0=1,b1=0,b2=1,b3=0,b4=0,b5=1,b6=0 = 0b0100101 = 0x25
describe("encode7in8 / decode7in8", () => {
  it("packs a full 7-byte group with the correct high-bit header (happy path)", () => {
    const raw = Uint8Array.from([0x80, 0x01, 0xff, 0x00, 0x40, 0xc0, 0x7f]);
    const enc = encode7in8(raw);
    expect(Array.from(enc)).toEqual([0x25, 0x00, 0x01, 0x7f, 0x00, 0x40, 0x40, 0x7f]);
    // every encoded byte must be 7-bit safe
    expect(enc.every((x) => x <= 0x7f)).toBe(true);
  });

  it("handles a short final group (edge case: length not a multiple of 7)", () => {
    const raw = Uint8Array.from([0xaa, 0x02, 0x81]); // 3 bytes
    const enc = encode7in8(raw);
    // header bits: b0=1(0xAA),b1=0(0x02),b2=1(0x81) = 0b101 = 0x05
    expect(Array.from(enc)).toEqual([0x05, 0x2a, 0x02, 0x01]);
    expect(Array.from(decode7in8(enc))).toEqual([0xaa, 0x02, 0x81]);
  });

  it("round-trips arbitrary binary data of every length 0..64 (bit-exact)", () => {
    for (let len = 0; len <= 64; len++) {
      const raw = new Uint8Array(len);
      for (let i = 0; i < len; i++) raw[i] = (i * 37 + 11) & 0xff;
      const rt = decode7in8(encode7in8(raw));
      expect(Array.from(rt)).toEqual(Array.from(raw));
    }
  });

  it("round-trips a full 16 KB pattern body", () => {
    const body = new Uint8Array(0x4000);
    for (let i = 0; i < body.length; i++) body[i] = (i * 131 + 7) & 0xff;
    const rt = decode7in8(encode7in8(body));
    expect(rt.length).toBe(body.length);
    expect(rt).toEqual(body);
  });
});

describe("patternNumber <-> midi", () => {
  it("encodes low and high pattern numbers as LE 7-bit pairs", () => {
    expect(patternNumberToMidi(0)).toEqual([0, 0]);
    expect(patternNumberToMidi(127)).toEqual([127, 0]);
    expect(patternNumberToMidi(128)).toEqual([0, 1]);
    expect(patternNumberToMidi(249)).toEqual([249 - 128, 1]);
  });

  it("clamps out-of-range pattern numbers (edge case)", () => {
    expect(patternNumberToMidi(-5)).toEqual([0, 0]);
    expect(patternNumberToMidi(9999)).toEqual(patternNumberToMidi(249));
  });

  it("round-trips through midiToPatternNumber", () => {
    for (const n of [0, 1, 63, 127, 128, 200, 249]) {
      const [lsb, msb] = patternNumberToMidi(n);
      expect(midiToPatternNumber(lsb, msb)).toBe(n);
    }
  });
});

describe("request frame builders", () => {
  it("builds the device search request verbatim", () => {
    expect(Array.from(buildSearchRequest())).toEqual([0xf0, 0x42, 0x50, 0x00, 0x00, 0xf7]);
  });

  it("builds current-pattern & global dump requests with the sampler header", () => {
    expect(Array.from(buildCurrentPatternDumpRequest())).toEqual([
      SYSEX_START, KORG_ID, 0x30, 0x00, 0x01, E2Model.SAMPLER, E2Func.CURRENT_PATTERN_DUMP_REQ, SYSEX_END,
    ]);
    expect(Array.from(buildGlobalDumpRequest())).toEqual([
      SYSEX_START, KORG_ID, 0x30, 0x00, 0x01, E2Model.SAMPLER, E2Func.GLOBAL_DUMP_REQ, SYSEX_END,
    ]);
  });

  it("embeds the global channel nibble and pattern number (edge cases)", () => {
    const f = buildPatternDumpRequest(200, { globalChannel: 5 });
    expect(f[2]).toBe(0x35); // 0x30 + channel 5
    expect(f[6]).toBe(E2Func.PATTERN_DUMP_REQ);
    expect(f[7]).toBe(200 - 128); // lsb
    expect(f[8]).toBe(1); // msb
    expect(f[f.length - 1]).toBe(SYSEX_END);
  });

  it("uses the synth model id when requested", () => {
    const f = buildCurrentPatternDumpRequest({ model: E2Model.SYNTH });
    expect(f[5]).toBe(E2Model.SYNTH);
  });
});

describe("data-dump frame builders + parse round-trip", () => {
  const body = (() => {
    const b = new Uint8Array(0x4000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 97 + 3) & 0xff;
    return b;
  })();

  it("current-pattern dump encodes body and parses back bit-exact", () => {
    const frame = buildCurrentPatternDump(body);
    expect(frame[0]).toBe(SYSEX_START);
    expect(frame[6]).toBe(E2Func.CURRENT_PATTERN_DUMP);
    expect(frame[frame.length - 1]).toBe(SYSEX_END);
    const parsed = parseSysex(frame);
    expect(parsed?.kind).toBe("currentPattern");
    if (parsed?.kind === "currentPattern") expect(parsed.body).toEqual(body);
  });

  it("numbered pattern dump preserves slot number and body", () => {
    const frame = buildPatternDump(199, body);
    const parsed = parseSysex(frame);
    expect(parsed?.kind).toBe("pattern");
    if (parsed?.kind === "pattern") {
      expect(parsed.patternNumber).toBe(199);
      expect(parsed.body).toEqual(body);
    }
  });

  it("global dump round-trips (edge case: small odd-length body)", () => {
    const g = Uint8Array.from([0x01, 0x82, 0xff, 0x00, 0x7f]);
    const parsed = parseSysex(buildGlobalDump(g));
    expect(parsed?.kind).toBe("global");
    if (parsed?.kind === "global") expect(parsed.body).toEqual(g);
  });
});

describe("parseSysex classification", () => {
  it("recognises identity reply and extracts channel/model/version", () => {
    const reply = Uint8Array.from([
      0xf0, 0x42, 0x50, 0x01, 0x03, 0x00, 0x24, 0x00, 0x00, 0x00, 0x02, 0x02, 0xf7,
    ]);
    const p = parseSysex(reply);
    expect(p?.kind).toBe("identity");
    if (p?.kind === "identity") {
      expect(p.globalChannel).toBe(3);
      expect(p.model).toBe(0x24);
      expect(p.versionMajor).toBe(2);
      expect(p.versionMinor).toBe(2);
    }
  });

  it("recognises ACK and NAK frames", () => {
    const ack = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, E2Func.ACK, 0xf7]);
    const nak = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, E2Func.NAK, 0xf7]);
    expect(parseSysex(ack)?.kind).toBe("ack");
    expect(parseSysex(nak)?.kind).toBe("nak");
  });

  it("returns null for non-Korg data and 'unknown' for unrecognised funcs", () => {
    expect(parseSysex([0xf0, 0x7d, 0x01, 0x02])).toBeNull(); // OTP, not Korg
    expect(parseSysex([0xf0])).toBeNull();
    const weird = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x77, 0xf7]);
    const p = parseSysex(weird);
    expect(p?.kind).toBe("unknown");
    if (p?.kind === "unknown") expect(p.func).toBe(0x77);
  });
});

describe(".e2pat file <-> body", () => {
  it("strips and re-adds the 0x100 KORG header (round-trip)", () => {
    const body = new Uint8Array(0x4000).map((_, i) => (i * 3) & 0xff);
    const file = bodyToPatternFile(body, true);
    expect(file.length).toBe(E2_FILE_HEADER_SIZE + 0x4000);
    // "KORG" magic + "e2sampler" tag
    expect(Array.from(file.subarray(0, 4))).toEqual([0x4b, 0x4f, 0x52, 0x47]);
    expect(String.fromCharCode(...file.subarray(16, 25))).toBe("e2sampler");
    expect(patternFileToBody(file)).toEqual(body);
  });

  it("writes the synth 'electribe' tag when sampler=false", () => {
    const file = bodyToPatternFile(new Uint8Array(0x4000), false);
    expect(String.fromCharCode(...file.subarray(16, 25))).toBe("electribe");
  });

  it("rejects a truncated pattern file (edge case)", () => {
    expect(() => patternFileToBody(new Uint8Array(10))).toThrow();
  });
});
