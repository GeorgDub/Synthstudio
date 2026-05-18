// @vitest-environment jsdom
/**
 * omnitribe-chord-pad.test.ts — v3.18.0 Wiring-Tests:
 *   - ChordPanel:           sendChordParam (0x1E/0x00 type, 0x01 stagger, 0x03 enable)
 *   - PerformancePadGrid:   sendPerformancePadPress (0x1F/0x00..0x0F)
 *                           sendPerformanceLoopIsolate (0x1F/0x20..0x2F)
 *                           sendPerformanceJamMute (0x1F/0x30..0x3F)
 *   - decodePerformanceParamLow round-trip
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  sendChordParam,
  chordPidToKey,
  CHORD_TYPES,
  CHORD_TYPE_COUNT,
  OMNITRIBE_CHORD,
  sendPerformancePadPress,
  sendPerformanceLoopIsolate,
  sendPerformanceJamMute,
  decodePerformanceParamLow,
  OMNITRIBE_PERFORMANCE,
  __cancelOmniTribeSends,
  __flushOmniTribeSends,
} from "../../client/src/utils/omniTribeWiring";
import { omniTribeBridge } from "../../client/src/audio/OmniTribeBridge";

let setParamCalls: Array<[number, number, number, number]> = [];

beforeEach(() => {
  setParamCalls = [];
  __cancelOmniTribeSends();

  vi.spyOn(omniTribeBridge, "setParam").mockImplementation(
    (part: number, ph: number, pl: number, value: number) => {
      setParamCalls.push([part, ph, pl, value]);
    },
  );
  // Force connected=true for outbound tests
  vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(true);
});

describe("ChordPanel wiring — sendChordParam", () => {
  it("chordType change → setParam (0x1E / 0x00 | (part<<4))", () => {
    sendChordParam(0, "type", 5);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    const [part, ph, pl, value] = setParamCalls[0];
    expect(part).toBe(0);
    expect(ph).toBe(OMNITRIBE_CHORD.PARAM_HIGH);
    expect(pl).toBe(OMNITRIBE_CHORD.TYPE);
    expect(value).toBe(5);
  });

  it("chordType auf Part 3 → paramLow LSB = (3<<4) | 0", () => {
    sendChordParam(3, "type", 1);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    const [part, ph, pl, value] = setParamCalls[0];
    expect(part).toBe(3);
    expect(ph).toBe(0x1E);
    expect(pl).toBe((3 << 4) | OMNITRIBE_CHORD.TYPE);
    expect(value).toBe(1);
  });

  it("stagger change → setParam (0x1E / 0x01)", () => {
    sendChordParam(0, "stagger", 100);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    const [, ph, pl, value] = setParamCalls[0];
    expect(ph).toBe(OMNITRIBE_CHORD.PARAM_HIGH);
    expect(pl).toBe(OMNITRIBE_CHORD.STAGGER);
    expect(value).toBe(100);
  });

  it("enable change → setParam (0x1E / 0x03)", () => {
    sendChordParam(0, "enable", 1);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    const [, ph, pl, value] = setParamCalls[0];
    expect(ph).toBe(OMNITRIBE_CHORD.PARAM_HIGH);
    expect(pl).toBe(OMNITRIBE_CHORD.ENABLE);
    expect(value).toBe(1);
  });

  it("CHORD_TYPES enthaelt 11 Standard + 4 User = 15", () => {
    expect(CHORD_TYPE_COUNT).toBe(15);
    expect(CHORD_TYPES.filter((c) => !c.isUser).length).toBe(11);
    expect(CHORD_TYPES.filter((c) => c.isUser).length).toBe(4);
  });

  it("Standard-Akkord Intervalle: Major=[0,4,7], Minor=[0,3,7]", () => {
    expect(CHORD_TYPES[0].intervals).toEqual([0, 4, 7]);
    expect(CHORD_TYPES[1].intervals).toEqual([0, 3, 7]);
  });

  it("chordPidToKey decodiert PIDs zurueck", () => {
    expect(chordPidToKey(0x00)).toBe("type");
    expect(chordPidToKey(0x01)).toBe("stagger");
    expect(chordPidToKey(0x03)).toBe("enable");
    expect(chordPidToKey(0x0F)).toBeNull();
  });

  it("clamps value range (out-of-range → 0..127)", () => {
    sendChordParam(0, "type", 500);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    expect(setParamCalls[0][3]).toBe(127);

    setParamCalls = [];
    sendChordParam(0, "type", -5);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    expect(setParamCalls[0][3]).toBe(0);
  });
});

describe("PerformancePadGrid wiring", () => {
  it("Pad-Click → setParam (0x1F / 0x00 | padId, 1)", () => {
    sendPerformancePadPress(5);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    const [part, ph, pl, value] = setParamCalls[0];
    expect(part).toBe(0);   // Performance ist global, part=0
    expect(ph).toBe(OMNITRIBE_PERFORMANCE.PARAM_HIGH);
    expect(pl).toBe(OMNITRIBE_PERFORMANCE.PAD_PRESS_BASE | 5);
    expect(value).toBe(1);
  });

  it("Loop-Isolate via Long-Press → setParam (0x1F / 0x20 | padId, 1)", () => {
    sendPerformanceLoopIsolate(7);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    const [, ph, pl, value] = setParamCalls[0];
    expect(ph).toBe(0x1F);
    expect(pl).toBe(OMNITRIBE_PERFORMANCE.LOOP_ISOLATE_BASE | 7);
    expect(value).toBe(1);
  });

  it("Jam-Mute toggle → setParam (0x1F / 0x30 | partId, on/off)", () => {
    sendPerformanceJamMute(3, true);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    let [, ph, pl, value] = setParamCalls[0];
    expect(ph).toBe(0x1F);
    expect(pl).toBe(OMNITRIBE_PERFORMANCE.JAM_MUTE_BASE | 3);
    expect(value).toBe(1);

    setParamCalls = [];
    sendPerformanceJamMute(3, false);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    [, , , value] = setParamCalls[0];
    expect(value).toBe(0);
  });

  it("clamps padId out-of-range (>15 → 15, neg → 0)", () => {
    sendPerformancePadPress(99);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    expect(setParamCalls[0][2]).toBe(OMNITRIBE_PERFORMANCE.PAD_PRESS_BASE | 15);

    setParamCalls = [];
    sendPerformancePadPress(-3);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(1);
    expect(setParamCalls[0][2]).toBe(OMNITRIBE_PERFORMANCE.PAD_PRESS_BASE | 0);
  });

  it("decodePerformanceParamLow: padPress / loopIsolate / jamMute", () => {
    expect(decodePerformanceParamLow(0x05)).toEqual({ kind: "padPress",    id: 5  });
    expect(decodePerformanceParamLow(0x25)).toEqual({ kind: "loopIsolate", id: 5  });
    expect(decodePerformanceParamLow(0x35)).toEqual({ kind: "jamMute",     id: 5  });
    expect(decodePerformanceParamLow(0x0F)).toEqual({ kind: "padPress",    id: 15 });
    expect(decodePerformanceParamLow(0x40)).toEqual({ kind: "unknown",     id: 0  });
  });
});

describe("Connected-Gate: alle send*-Funktionen sind NO-OPs wenn disconnected", () => {
  beforeEach(() => {
    vi.spyOn(omniTribeBridge, "isConnected", "get").mockReturnValue(false);
  });

  it("sendChordParam NO-OP wenn disconnected", () => {
    sendChordParam(0, "type", 5);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(0);
  });

  it("sendPerformancePadPress NO-OP wenn disconnected", () => {
    sendPerformancePadPress(5);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(0);
  });

  it("sendPerformanceJamMute NO-OP wenn disconnected", () => {
    sendPerformanceJamMute(3, true);
    __flushOmniTribeSends();
    expect(setParamCalls.length).toBe(0);
  });
});
