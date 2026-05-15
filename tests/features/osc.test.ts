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

  it("/synth/mute/<partId> <T> → midi:partMute (Toggle-Event, detail=partId)", () => {
    // v2.34: Loop-Closing — detail ist die partId als String (passt zu
    // App.tsx-Listener aus v1.76 der mit detail-as-string toggelt).
    const action = mapOscToAction({ address: "/synth/mute/kick-1", args: [true] });
    expect(action?.event).toBe("midi:partMute");
    expect(action?.detail).toBe("kick-1");
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

// ─── v2.34: OSC-In/Out-Symmetrie ─────────────────────────────────────────────

describe("v2.34: OSC-Loop-Closing (OSC-In erkennt OSC-Out-Adressen)", () => {
  it("/synth/bpm/current <f> → midi:bpm (BPM-Out-Alias)", () => {
    const a = mapOscToAction({ address: "/synth/bpm/current", args: [128.5] });
    expect(a?.event).toBe("midi:bpm");
    expect((a?.detail as { value: number }).value).toBeCloseTo(128.5, 5);
  });

  it("/synth/transport/play und /synth/transport/stop sind Aliase", () => {
    expect(mapOscToAction({ address: "/synth/transport/play", args: [] })?.event).toBe("midi:playStop");
    expect(mapOscToAction({ address: "/synth/transport/stop", args: [] })?.event).toBe("midi:stop");
  });

  it("/synth/pattern <s> akzeptiert Pattern-ID-String", () => {
    const a = mapOscToAction({ address: "/synth/pattern", args: ["pattern_abc123"] });
    expect(a?.event).toBe("midi:pattern");
    expect((a?.detail as { patternId: string }).patternId).toBe("pattern_abc123");
  });

  it("/synth/pattern lehnt leeren String ab", () => {
    expect(mapOscToAction({ address: "/synth/pattern", args: [""] })).toBeNull();
  });

  it("/synth/volume/<partId> <f> → midi:partVolume", () => {
    const a = mapOscToAction({ address: "/synth/volume/kick", args: [0.8] });
    expect(a?.event).toBe("midi:partVolume");
    expect(a?.detail).toEqual({ partId: "kick", value: 0.8 });
  });

  it("/synth/pan/<partId> <f> → midi:partPan", () => {
    const a = mapOscToAction({ address: "/synth/pan/snare", args: [-0.5] });
    expect(a?.event).toBe("midi:partPan");
    expect(a?.detail).toEqual({ partId: "snare", value: -0.5 });
  });

  it("/synth/solo/<partId> → midi:partSolo", () => {
    const a = mapOscToAction({ address: "/synth/solo/lead", args: [] });
    expect(a?.event).toBe("midi:partSolo");
    expect(a?.detail).toBe("lead");
  });

  it("/synth/mute akzeptiert String \"1\"/\"0\" (OSC-Out-Format)", () => {
    const truthy = mapOscToAction({ address: "/synth/mute/kick", args: ["1"] });
    expect(truthy?.event).toBe("midi:partMute");
    expect(truthy?.detail).toBe("kick");

    const falsy = mapOscToAction({ address: "/synth/mute/kick", args: ["0"] });
    expect(falsy?.event).toBe("midi:partMuteSet");
    expect(falsy?.detail).toEqual({ partId: "kick", value: false });
  });

  it("/synth/mute akzeptiert Integer 1/0", () => {
    expect(mapOscToAction({ address: "/synth/mute/k", args: [1] })?.event).toBe("midi:partMute");
    expect(mapOscToAction({ address: "/synth/mute/k", args: [0] })?.event).toBe("midi:partMuteSet");
  });

  it("/synth/mute akzeptiert Boolean true/false", () => {
    expect(mapOscToAction({ address: "/synth/mute/k", args: [true] })?.event).toBe("midi:partMute");
    expect(mapOscToAction({ address: "/synth/mute/k", args: [false] })?.event).toBe("midi:partMuteSet");
  });

  it("partId mit URL-encodierten Sonderzeichen wird decodiert", () => {
    const a = mapOscToAction({ address: "/synth/volume/Hi%2DHat%20cl%2E", args: [0.5] });
    expect(a?.event).toBe("midi:partVolume");
    expect((a?.detail as { partId: string }).partId).toBe("Hi-Hat cl.");
  });
});

describe("v2.34: oscIsTruthy", () => {
  it("Boolean true/false", async () => {
    const { oscIsTruthy } = await import("../../client/src/utils/oscBindings");
    expect(oscIsTruthy(true)).toBe(true);
    expect(oscIsTruthy(false)).toBe(false);
  });

  it("Integer 1, 0, -1", async () => {
    const { oscIsTruthy } = await import("../../client/src/utils/oscBindings");
    expect(oscIsTruthy(1)).toBe(true);
    expect(oscIsTruthy(-1)).toBe(true);
    expect(oscIsTruthy(0)).toBe(false);
  });

  it("String \"1\"/\"0\"/\"true\"/\"on\"/\"yes\"", async () => {
    const { oscIsTruthy } = await import("../../client/src/utils/oscBindings");
    for (const t of ["1", "true", "T", "on", "yes", " TRUE ", "Yes"]) {
      expect(oscIsTruthy(t)).toBe(true);
    }
    for (const f of ["0", "false", "off", "no", "", "foo"]) {
      expect(oscIsTruthy(f)).toBe(false);
    }
  });

  it("Sonstige Typen → false", async () => {
    const { oscIsTruthy } = await import("../../client/src/utils/oscBindings");
    expect(oscIsTruthy(null)).toBe(false);
    expect(oscIsTruthy(undefined)).toBe(false);
    expect(oscIsTruthy({})).toBe(false);
    expect(oscIsTruthy([])).toBe(false);
  });
});
