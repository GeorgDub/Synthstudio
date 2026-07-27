import { describe, it, expect } from "vitest";
import {
  cc,
  buildNrpn,
  buildFxEdit,
  buildFxControlMap,
  buildFxControlMapSlot,
  FX_MAP_PARAM,
  ifxFxSlot,
  MFX_FX_SLOT,
  NRPN_CC,
  E2NrpnCategory,
} from "../../client/src/utils/korg/e2Nrpn";
import {
  E2SysexBridge,
  type E2Transport,
} from "../../client/src/audio/E2SysexBridge";

describe("cc", () => {
  it("builds a 3-byte CC message on the channel (happy path)", () => {
    expect(cc(0, 6, 100)).toEqual([0xb0, 6, 100]);
    expect(cc(9, 0x63, 1)).toEqual([0xb9, 0x63, 1]); // channel 10 (index 9)
  });
  it("clamps value to 0..127 and masks controller to 7-bit (edge cases)", () => {
    expect(cc(0, 6, 999)).toEqual([0xb0, 6, 127]);
    expect(cc(0, 6, -5)).toEqual([0xb0, 6, 0]);
  });
});

describe("buildNrpn", () => {
  it("emits NRPN-MSB, LSB, DATA-MSB (+ optional DATA-LSB) in order", () => {
    const withLsb = buildNrpn(0, 0x01, 0x05, 0x02, 0x40);
    expect(Array.from(withLsb)).toEqual([
      0xb0,
      NRPN_CC.MSB,
      0x01,
      0xb0,
      NRPN_CC.LSB,
      0x05,
      0xb0,
      NRPN_CC.DATA_MSB,
      0x02,
      0xb0,
      NRPN_CC.DATA_LSB,
      0x40,
    ]);
    // without DATA-LSB → 9 bytes (3 CCs)
    expect(buildNrpn(0, 1, 2, 3)).toHaveLength(9);
  });
});

describe("buildFxEdit", () => {
  it("maps to category 0x01 + slot/param/value (real hacktribe FX-Edit)", () => {
    const bytes = Array.from(buildFxEdit(0, 0x04, 0x02, 90));
    expect(bytes).toEqual([
      0xb0,
      99,
      E2NrpnCategory.FX_EDIT, // NRPN-MSB = FX Edit
      0xb0,
      98,
      0x04, // NRPN-LSB = fx slot
      0xb0,
      6,
      0x02, // DATA-MSB = param index
      0xb0,
      38,
      90, // DATA-LSB = value
    ]);
  });
  it("clamps value and honours the global channel", () => {
    const bytes = Array.from(buildFxEdit(5, 0, 0, 200));
    expect(bytes[0]).toBe(0xb5); // channel 5
    expect(bytes[11]).toBe(127); // clamped value
  });
});

describe("fx slot helpers", () => {
  it("addresses IFX A/B per part and the MFX slot", () => {
    expect(ifxFxSlot(0, 0)).toBe(0);
    expect(ifxFxSlot(0, 1)).toBe(1);
    expect(ifxFxSlot(3, 0)).toBe(6);
    expect(ifxFxSlot(15, 1)).toBe(31);
    expect(MFX_FX_SLOT).toBe(0x20);
  });
});

describe("buildFxControlMap", () => {
  it("uses category 0x02", () => {
    expect(Array.from(buildFxControlMap(0, 0x04, 1, 10)).slice(0, 3)).toEqual([
      0xb0,
      99,
      E2NrpnCategory.FX_CONTROL_MAP,
    ]);
  });
});

describe("buildFxControlMapSlot", () => {
  it("emits five category-0x02 NRPN transactions in map-param order", () => {
    const seq = buildFxControlMapSlot(0, 0x04, {
      mapSlot: 3,
      sourceControl: 0x02,
      targetParam: 2,
      minValue: 0,
      maxValue: 127,
    });
    // 5 transactions × 12 bytes each (4 CCs incl. DATA-LSB)
    expect(seq).toHaveLength(5 * 12);
    // Split into the 5 transactions and check DATA-MSB (param index) + DATA-LSB.
    const tx = Array.from({ length: 5 }, (_, i) =>
      Array.from(seq.subarray(i * 12, i * 12 + 12))
    );
    // every transaction is category 0x02
    tx.forEach(t => expect(t.slice(0, 3)).toEqual([0xb0, 99, 0x02]));
    // DATA-MSB (index 8) walks map-param indices 0..4
    expect(tx.map(t => t[8])).toEqual([
      FX_MAP_PARAM.MAP_SLOT,
      FX_MAP_PARAM.SOURCE_CONTROL,
      FX_MAP_PARAM.TARGET_PARAM,
      FX_MAP_PARAM.MIN_VALUE,
      FX_MAP_PARAM.MAX_VALUE,
    ]);
    // DATA-LSB (index 11) carries the values
    expect(tx.map(t => t[11])).toEqual([3, 0x02, 2, 0, 127]);
  });

  it("honours the global channel + clamps values", () => {
    const seq = buildFxControlMapSlot(7, 0x20, {
      mapSlot: 0,
      sourceControl: 0x0a,
      targetParam: 0,
      minValue: 0,
      maxValue: 999,
    });
    expect(seq[0]).toBe(0xb7); // channel 7
    expect(seq[seq.length - 1]).toBe(127); // clamped max value
  });
});

describe("E2SysexBridge NRPN send (fire-and-forget)", () => {
  function fake(): { transport: E2Transport; sent: Uint8Array[] } {
    const sent: Uint8Array[] = [];
    return { transport: { onmessage: null, send: b => sent.push(b) }, sent };
  }

  it("sends FX-Edit NRPN via the transport without expecting an ACK", () => {
    const { transport, sent } = fake();
    const bridge = new E2SysexBridge({ globalChannel: 2 });
    bridge.attach(transport);
    bridge.sendFxEdit(0x04, 0x02, 64);
    expect(sent).toHaveLength(1);
    expect(Array.from(sent[0])).toEqual(
      Array.from(buildFxEdit(2, 0x04, 0x02, 64))
    );
  });

  it("throws when no transport is attached", () => {
    const bridge = new E2SysexBridge();
    expect(() => bridge.sendFxEdit(0, 0, 0)).toThrow(/no transport/);
  });
});
