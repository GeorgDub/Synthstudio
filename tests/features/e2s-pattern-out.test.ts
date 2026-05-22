/**
 * Synthstudio - Unit Tests fuer e2sPatternOut (v3.232)
 * Spec: client/src/utils/korg/e2sPatternOut.ts
 * KORG E2/E2S MIDI Implementation Chart.
 */
import { describe, it, expect } from "vitest";
import {
  buildPatternChangeMessages,
  clampPatternIndex,
  clampChannel,
  PATTERN_COUNT,
  MAX_PATTERN_INDEX,
  MIN_PATTERN_INDEX,
  CC_BANK_SELECT_LSB,
  DEFAULT_CHANNEL,
} from "../../client/src/utils/korg/e2sPatternOut";

describe("e2sPatternOut - constants", () => {
  it("PATTERN_COUNT=250", () => { expect(PATTERN_COUNT).toBe(250); });
  it("MAX_PATTERN_INDEX=249", () => { expect(MAX_PATTERN_INDEX).toBe(249); });
  it("MIN_PATTERN_INDEX=0", () => { expect(MIN_PATTERN_INDEX).toBe(0); });
  it("CC_BANK_SELECT_LSB=32", () => { expect(CC_BANK_SELECT_LSB).toBe(32); });
  it("DEFAULT_CHANNEL=0", () => { expect(DEFAULT_CHANNEL).toBe(0); });
});

describe("clampPatternIndex - happy paths", () => {
  it("0", () => { expect(clampPatternIndex(0)).toBe(0); });
  it("127", () => { expect(clampPatternIndex(127)).toBe(127); });
  it("128", () => { expect(clampPatternIndex(128)).toBe(128); });
  it("249", () => { expect(clampPatternIndex(249)).toBe(249); });
});

describe("clampPatternIndex - edge cases", () => {
  it("-1 to 0", () => { expect(clampPatternIndex(-1)).toBe(0); });
  it("-999 to 0", () => { expect(clampPatternIndex(-999)).toBe(0); });
  it("250 to 249", () => { expect(clampPatternIndex(250)).toBe(249); });
  it("999 to 249", () => { expect(clampPatternIndex(999)).toBe(249); });
  it("1.7 to 1", () => { expect(clampPatternIndex(1.7)).toBe(1); });
  it("127.9 to 127", () => { expect(clampPatternIndex(127.9)).toBe(127); });
  it("NaN to 0", () => { expect(clampPatternIndex(NaN)).toBe(0); });
  it("Infinity to 0", () => { expect(clampPatternIndex(Infinity)).toBe(0); });
  it("-Infinity to 0", () => { expect(clampPatternIndex(-Infinity)).toBe(0); });
  it("string to 0", () => { expect(clampPatternIndex('42' as unknown as number)).toBe(0); });
  it("null to 0", () => { expect(clampPatternIndex(null as unknown as number)).toBe(0); });
  it("undefined to 0", () => { expect(clampPatternIndex(undefined as unknown as number)).toBe(0); });
});

describe("clampChannel", () => {
  it("0", () => { expect(clampChannel(0)).toBe(0); });
  it("15", () => { expect(clampChannel(15)).toBe(15); });
  it("-1 to 0", () => { expect(clampChannel(-1)).toBe(0); });
  it("16 to 15", () => { expect(clampChannel(16)).toBe(15); });
  it("NaN to 0", () => { expect(clampChannel(NaN)).toBe(0); });
  it("5.9 to 5", () => { expect(clampChannel(5.9)).toBe(5); });
});

describe("buildPatternChangeMessages - happy path", () => {
  it("p=0 ch=0", () => {
    expect(buildPatternChangeMessages(0, 0)).toEqual([[0xB0, 32, 0], [0xC0, 0]]);
  });
  it("p=1 ch=0", () => {
    expect(buildPatternChangeMessages(1, 0)).toEqual([[0xB0, 32, 0], [0xC0, 1]]);
  });
  it("p=42 ch=0", () => {
    expect(buildPatternChangeMessages(42, 0)).toEqual([[0xB0, 32, 0], [0xC0, 42]]);
  });
  it("returns 2 messages", () => {
    expect(buildPatternChangeMessages(0, 0).length).toBe(2);
  });
  it("first is CC 0xB0", () => {
    expect(buildPatternChangeMessages(50, 3)[0][0] & 0xF0).toBe(0xB0);
  });
  it("first uses CC 32 not 0", () => {
    expect(buildPatternChangeMessages(50, 3)[0][1]).toBe(32);
  });
  it("second is PC 0xC0", () => {
    expect(buildPatternChangeMessages(50, 3)[1][0] & 0xF0).toBe(0xC0);
  });
});

describe("buildPatternChangeMessages - bank boundary", () => {
  it("p=127 -> bank0 PC127", () => {
    expect(buildPatternChangeMessages(127, 0)).toEqual([[0xB0, 32, 0], [0xC0, 127]]);
  });
  it("p=128 -> bank1 PC0", () => {
    expect(buildPatternChangeMessages(128, 0)).toEqual([[0xB0, 32, 1], [0xC0, 0]]);
  });
  it("p=129 -> bank1 PC1", () => {
    expect(buildPatternChangeMessages(129, 0)).toEqual([[0xB0, 32, 1], [0xC0, 1]]);
  });
  it("p=249 -> bank1 PC121", () => {
    expect(buildPatternChangeMessages(249, 0)).toEqual([[0xB0, 32, 1], [0xC0, 121]]);
  });
  it("p=256 clamped to 249 -> bank1 PC121", () => {
    expect(buildPatternChangeMessages(256, 0)).toEqual([[0xB0, 32, 1], [0xC0, 121]]);
  });
});

describe("buildPatternChangeMessages - channel variations", () => {
  for (let ch = 0; ch < 16; ch++) {
    it("ch " + ch + " status nibbles", () => {
      const msgs = buildPatternChangeMessages(42, ch);
      expect(msgs[0][0]).toBe(0xB0 | ch);
      expect(msgs[1][0]).toBe(0xC0 | ch);
    });
  }
  it("ch -1 -> 0", () => {
    const msgs = buildPatternChangeMessages(42, -1);
    expect(msgs[0][0]).toBe(0xB0);
    expect(msgs[1][0]).toBe(0xC0);
  });
  it("ch 16 -> 15", () => {
    const msgs = buildPatternChangeMessages(42, 16);
    expect(msgs[0][0]).toBe(0xBF);
    expect(msgs[1][0]).toBe(0xCF);
  });
  it("ch NaN -> 0", () => {
    expect(buildPatternChangeMessages(42, NaN)[0][0]).toBe(0xB0);
  });
  it("ch omitted -> 0", () => {
    const msgs = buildPatternChangeMessages(42);
    expect(msgs[0][0]).toBe(0xB0);
    expect(msgs[1][0]).toBe(0xC0);
  });
});

describe("buildPatternChangeMessages - invariants", () => {
  it("all data bytes 0..127", () => {
    for (let pp = 0; pp < 250; pp++) {
      const msgs = buildPatternChangeMessages(pp, 0);
      expect(msgs[0][1]).toBeGreaterThanOrEqual(0);
      expect(msgs[0][1]).toBeLessThanOrEqual(127);
      expect(msgs[0][2]).toBeGreaterThanOrEqual(0);
      expect(msgs[0][2]).toBeLessThanOrEqual(127);
      expect(msgs[1][1]).toBeGreaterThanOrEqual(0);
      expect(msgs[1][1]).toBeLessThanOrEqual(127);
    }
  });
  it("status bytes >= 0x80", () => {
    const msgs = buildPatternChangeMessages(0, 0);
    expect(msgs[0][0]).toBeGreaterThanOrEqual(0x80);
    expect(msgs[1][0]).toBeGreaterThanOrEqual(0x80);
  });
  it("CC 3 bytes; PC 2 bytes", () => {
    const msgs = buildPatternChangeMessages(0, 0);
    expect(msgs[0].length).toBe(3);
    expect(msgs[1].length).toBe(2);
  });
  it("determinism", () => {
    expect(buildPatternChangeMessages(173, 7)).toEqual(buildPatternChangeMessages(173, 7));
  });
});
