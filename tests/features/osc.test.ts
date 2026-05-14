/**
 * Synthstudio – OSC Encoder/Decoder + Binding Tests (v2.17)
 */
import { describe, it, expect } from "vitest";
import { encodeOscMessage, decodeOscMessage, type OscMessage } from "../../client/src/utils/oscEncoder";
import { mapOscToAction } from "../../client/src/utils/oscBindings";

describe("encodeOscMessage / decodeOscMessage (v2.17)", () => {
  it("Round-Trip: Address-only Message ohne Args", () => {
    const msg: OscMessage = { address: "/synth/play", args: [] };
    const back = decodeOscMessage(encodeOscMessage(msg));
    expect(back.address).toBe("/synth/play");
    expect(back.args).toEqual([]);
  });

  it("Round-Trip: int32-Argument", () => {
    const msg: OscMessage = { address: "/synth/bpm", args: [120] };
    const back = decodeOscMessage(encodeOscMessage(msg));
    expect(back.address).toBe("/synth/bpm");
    expect(back.args).toEqual([120]);
  });

  it("Round-Trip: float32-Argument", () => {
    const msg: OscMessage = { address: "/synth/volume", args: [0.75] };
    const encoded = encodeOscMessage(msg);
    const back = decodeOscMessage(encoded);
    expect(back.address).toBe("/synth/volume");
    expect(typeof back.args[0]).toBe("number");
    expect(back.args[0] as number).toBeCloseTo(0.75, 5);
  });

  it("Round-Trip: gemischte Args (string + int + float)", () => {
    const msg: OscMessage = { address: "/synth/cmd", args: ["play", 42, 0.5] };
    const back = decodeOscMessage(encodeOscMessage(msg));
    expect(back.args[0]).toBe("play");
    expect(back.args[1]).toBe(42);
    expect(back.args[2] as number).toBeCloseTo(0.5, 5);
  });

  it("Round-Trip: Boolean True/False/Nil ohne Payload", () => {
    const msg: OscMessage = { address: "/synth/flags", args: [true, false, null] };
    const back = decodeOscMessage(encodeOscMessage(msg));
    expect(back.args).toEqual([true, false, null]);
  });

  it("Round-Trip: Blob-Argument", () => {
    const blob = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x42]);
    const msg: OscMessage = { address: "/synth/blob", args: [blob] };
    const back = decodeOscMessage(encodeOscMessage(msg));
    expect(back.args[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.args[0] as Uint8Array)).toEqual([0xde, 0xad, 0xbe, 0xef, 0x42]);
  });

  it("encode wirft Error wenn Address kein '/' hat", () => {
    expect(() => encodeOscMessage({ address: "bad", args: [] })).toThrow();
  });

  it("decode wirft Error für Bundles (#bundle)", () => {
    const bundle = new TextEncoder().encode("#bundle\0");
    expect(() => decodeOscMessage(bundle)).toThrow(/bundle/i);
  });

  it("Padding: Strings werden auf 4-Byte-Grenzen gepaddet", () => {
    // "/a" + null = 3 Bytes → muss auf 4 gepaddet werden
    const msg: OscMessage = { address: "/a", args: [] };
    const encoded = encodeOscMessage(msg);
    expect(encoded.byteLength % 4).toBe(0);
  });

  it("Negative int32 werden korrekt encodiert", () => {
    const msg: OscMessage = { address: "/x", args: [-42] };
    const back = decodeOscMessage(encodeOscMessage(msg));
    expect(back.args[0]).toBe(-42);
  });
});

describe("mapOscToAction (v2.17)", () => {
  it("/synth/bpm <i> → midi:bpm", () => {
    const action = mapOscToAction({ address: "/synth/bpm", args: [128] });
    expect(action?.event).toBe("midi:bpm");
    expect(action?.detail).toEqual({ value: 128 });
  });

  it("/synth/play → midi:playStop toggle", () => {
    expect(mapOscToAction({ address: "/synth/play", args: [] })?.event).toBe("midi:playStop");
  });

  it("/synth/stop → midi:stop", () => {
    expect(mapOscToAction({ address: "/synth/stop", args: [] })?.event).toBe("midi:stop");
  });

  it("/synth/macro/3 <f> → macro:set index=3", () => {
    const action = mapOscToAction({ address: "/synth/macro/3", args: [0.42] });
    expect(action?.event).toBe("macro:set");
    expect((action?.detail as { index: number }).index).toBe(3);
    expect((action?.detail as { value: number }).value).toBeCloseTo(0.42, 5);
  });

  it("/synth/mute/<partId> <T|F> → midi:partMute", () => {
    const action = mapOscToAction({ address: "/synth/mute/kick-1", args: [true] });
    expect(action?.event).toBe("midi:partMute");
    expect(action?.detail).toEqual({ partId: "kick-1", value: true });
  });

  it("Unbekannte Adresse → null", () => {
    expect(mapOscToAction({ address: "/foo/bar", args: [] })).toBeNull();
  });

  it("Argument-Typ falsch → null", () => {
    // /synth/bpm erwartet number; ein String darf NICHT mappen
    expect(mapOscToAction({ address: "/synth/bpm", args: ["foo"] })).toBeNull();
  });

  it("/synth/pattern <i> rundet float-Indizes", () => {
    const action = mapOscToAction({ address: "/synth/pattern", args: [2.7] });
    expect(action?.event).toBe("midi:pattern");
    expect((action?.detail as { index: number }).index).toBe(3);
  });
});
