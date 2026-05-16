/**
 * tests/features/osc-encoder.test.ts (TASK-CVG-OSC-ENCODER / v2.62)
 *
 * Pure-Coverage für client/src/utils/oscEncoder.ts.
 *
 * Binary OSC 1.0 Encoder/Decoder. Spec-konformes Output ist die Bedingung
 * dafür, dass externe OSC-Empfänger (Hardware-Sequencer, TouchOSC, MaxMSP)
 * unsere Pakete lesen können. Diese Suite verifiziert Byte-Layout direkt
 * (Padding, Type-Tags, Big-Endian) und schließt mit Round-Trip-Tests.
 */
import { describe, it, expect } from "vitest";
import { encodeOscMessage, decodeOscMessage, type OscMessage } from "@/utils/oscEncoder";

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...Array.from(bytes.subarray(offset, offset + length)));
}

describe("OscEncoder – encodeOscMessage Basics", () => {
  it("Address ohne führenden Slash wirft", () => {
    expect(() => encodeOscMessage({ address: "no-slash", args: [] })).toThrow(/must start with/);
  });

  it("Leere Args: '/foo' → 'foo\\0' + ','-Tag mit 4-Byte-Padding", () => {
    const bytes = encodeOscMessage({ address: "/foo", args: [] });
    // "/foo" = 4 Bytes + 1 null = 5, gepaddet auf 8 → "/foo\0\0\0\0"
    expect(bytes.byteLength).toBeGreaterThanOrEqual(8 + 4);
    expect(asciiAt(bytes, 0, 4)).toBe("/foo");
    expect(bytes[4]).toBe(0); // null-terminator
    // Tag-String beginnt nach Address-Padding
    expect(asciiAt(bytes, 8, 1)).toBe(",");
  });

  it("Padding rundet auf 4-Byte-Grenze: '/x' (2 chars) → 4 Bytes inkl. null + 3 padding", () => {
    const bytes = encodeOscMessage({ address: "/x", args: [] });
    // "/x" = 2 + null = 3 → padded auf 4. Total = 4 (addr) + 4 (tag ",")
    expect(bytes.byteLength).toBe(8);
  });

  it("Address '/abc' (4 chars) braucht zusätzlich 4 Bytes für null+padding", () => {
    const bytes = encodeOscMessage({ address: "/abc", args: [] });
    // "/abc" = 4 + null = 5 → padded auf 8
    expect(bytes.byteLength).toBe(8 + 4);
  });
});

describe("OscEncoder – Type-Tags", () => {
  it("Integer-Arg bekommt Type-Tag 'i'", () => {
    const bytes = encodeOscMessage({ address: "/n", args: [42] });
    expect(asciiAt(bytes, 4, 3)).toBe(",i\0");
  });

  it("Float-Arg (non-integer) bekommt Type-Tag 'f'", () => {
    const bytes = encodeOscMessage({ address: "/n", args: [3.14] });
    expect(asciiAt(bytes, 4, 3)).toBe(",f\0");
  });

  it("String-Arg bekommt Type-Tag 's'", () => {
    const bytes = encodeOscMessage({ address: "/n", args: ["hi"] });
    expect(asciiAt(bytes, 4, 3)).toBe(",s\0");
  });

  it("true → 'T' (kein Datenbyte für boolean/null)", () => {
    const bytes = encodeOscMessage({ address: "/n", args: [true] });
    expect(asciiAt(bytes, 4, 3)).toBe(",T\0");
    expect(bytes.byteLength).toBe(8); // 4 addr + 4 tag, keine Daten
  });

  it("false → 'F'", () => {
    const bytes = encodeOscMessage({ address: "/n", args: [false] });
    expect(asciiAt(bytes, 4, 3)).toBe(",F\0");
  });

  it("null → 'N'", () => {
    const bytes = encodeOscMessage({ address: "/n", args: [null] });
    expect(asciiAt(bytes, 4, 3)).toBe(",N\0");
  });

  it("Blob (Uint8Array) → 'b'", () => {
    const bytes = encodeOscMessage({ address: "/n", args: [new Uint8Array([1, 2, 3])] });
    expect(asciiAt(bytes, 4, 3)).toBe(",b\0");
  });

  it("Mehrere Args: konkateniertes Type-Tag", () => {
    const bytes = encodeOscMessage({ address: "/n", args: [1, "hi", true] });
    expect(asciiAt(bytes, 4, 5)).toBe(",isT\0");
  });
});

describe("OscEncoder – Big-Endian-Encoding", () => {
  it("Integer 1 → Big-Endian 0x00 0x00 0x00 0x01", () => {
    const bytes = encodeOscMessage({ address: "/x", args: [1] });
    // After "/x\0\0" (4) + ",i\0\0" (4), the int starts at offset 8
    expect(bytes[8]).toBe(0x00);
    expect(bytes[9]).toBe(0x00);
    expect(bytes[10]).toBe(0x00);
    expect(bytes[11]).toBe(0x01);
  });

  it("Integer 256 → 0x00 0x00 0x01 0x00", () => {
    const bytes = encodeOscMessage({ address: "/x", args: [256] });
    expect(bytes[8]).toBe(0x00);
    expect(bytes[9]).toBe(0x00);
    expect(bytes[10]).toBe(0x01);
    expect(bytes[11]).toBe(0x00);
  });

  it("Integer -1 → 0xFF 0xFF 0xFF 0xFF", () => {
    const bytes = encodeOscMessage({ address: "/x", args: [-1] });
    expect(bytes[8]).toBe(0xFF);
    expect(bytes[9]).toBe(0xFF);
    expect(bytes[10]).toBe(0xFF);
    expect(bytes[11]).toBe(0xFF);
  });
});

describe("OscEncoder – Round-Trip (encode → decode)", () => {
  it("Empty Args", () => {
    const msg: OscMessage = { address: "/foo", args: [] };
    expect(decodeOscMessage(encodeOscMessage(msg))).toEqual(msg);
  });

  it("Integer", () => {
    const msg: OscMessage = { address: "/synth/volume", args: [42] };
    expect(decodeOscMessage(encodeOscMessage(msg))).toEqual(msg);
  });

  it("Float (mit toleranter Vergleich)", () => {
    const msg: OscMessage = { address: "/n", args: [3.14] };
    const decoded = decodeOscMessage(encodeOscMessage(msg));
    expect(decoded.address).toBe("/n");
    expect(decoded.args).toHaveLength(1);
    expect(decoded.args[0]).toBeCloseTo(3.14, 5);
  });

  it("String", () => {
    const msg: OscMessage = { address: "/x", args: ["hello"] };
    expect(decodeOscMessage(encodeOscMessage(msg))).toEqual(msg);
  });

  it("Boolean true/false + null", () => {
    const msg: OscMessage = { address: "/x", args: [true, false, null] };
    expect(decodeOscMessage(encodeOscMessage(msg))).toEqual(msg);
  });

  it("Mixed types", () => {
    const msg: OscMessage = { address: "/x", args: [1, "two", 3.0, true, null] };
    const decoded = decodeOscMessage(encodeOscMessage(msg));
    expect(decoded.address).toBe("/x");
    expect(decoded.args[0]).toBe(1);
    expect(decoded.args[1]).toBe("two");
    expect(decoded.args[2]).toBeCloseTo(3.0, 5);
    expect(decoded.args[3]).toBe(true);
    expect(decoded.args[4]).toBeNull();
  });

  it("Blob (Uint8Array)", () => {
    const blob = new Uint8Array([10, 20, 30, 40, 50]);
    const msg: OscMessage = { address: "/x", args: [blob] };
    const decoded = decodeOscMessage(encodeOscMessage(msg));
    expect(decoded.args[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded.args[0] as Uint8Array)).toEqual([10, 20, 30, 40, 50]);
  });

  it("Negative Integer", () => {
    const msg: OscMessage = { address: "/x", args: [-1234] };
    expect(decodeOscMessage(encodeOscMessage(msg))).toEqual(msg);
  });
});

describe("OscEncoder – decodeOscMessage Error-Cases", () => {
  it("Leeres Packet wirft", () => {
    expect(() => decodeOscMessage(new Uint8Array(0))).toThrow(/Empty/);
  });

  it("Bundle-Prefix '#' wirft (Bundles nicht supported)", () => {
    const bundle = new Uint8Array([0x23, 0x62, 0x75, 0x6E]); // "#bun..."
    expect(() => decodeOscMessage(bundle)).toThrow(/bundles are not supported/);
  });
});
