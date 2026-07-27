import { describe, it, expect } from "vitest";
import {
  allpatSlotOffset,
  allpatMinSizeFor,
  writePatternBodyIntoAllpat,
  writePatternBodiesIntoAllpat,
  isFullAllpatContainer,
  E2AllpatError,
  ALLPAT_PATTERN_OFFSET,
  ALLPAT_PATTERN_STRIDE,
  ALLPAT_PATTERN_COUNT,
  E2_PATTERN_BODY_SIZE,
} from "../../client/src/utils/korg/e2AllpatBuild";

const body = (fill: number) => new Uint8Array(E2_PATTERN_BODY_SIZE).fill(fill);
// a base container just big enough for the first few slots
const baseFor = (maxSlot: number) => {
  const b = new Uint8Array(allpatMinSizeFor(maxSlot)).fill(0xaa);
  return b;
};

describe("allpat slot geometry", () => {
  it("matches the verified layout (0x10100 + i*0x4000)", () => {
    expect(allpatSlotOffset(0)).toBe(0x10100);
    expect(allpatSlotOffset(1)).toBe(0x10100 + 0x4000);
    expect(allpatSlotOffset(249)).toBe(
      ALLPAT_PATTERN_OFFSET + 249 * ALLPAT_PATTERN_STRIDE
    );
    expect(allpatMinSizeFor(0)).toBe(0x14100);
  });
});

describe("writePatternBodyIntoAllpat (non-destructive, guarded)", () => {
  it("writes the body at the slot and leaves everything else intact", () => {
    const base = baseFor(2);
    const out = writePatternBodyIntoAllpat(base, 1, body(0x5a));
    // slot 1 region is now 0x5a
    const off = allpatSlotOffset(1);
    expect(out[off]).toBe(0x5a);
    expect(out[off + E2_PATTERN_BODY_SIZE - 1]).toBe(0x5a);
    // byte just before and just after the slot untouched (0xaa)
    expect(out[off - 1]).toBe(0xaa);
    expect(out[off + E2_PATTERN_BODY_SIZE]).toBe(0xaa);
    // original base unchanged
    expect(base[off]).toBe(0xaa);
  });

  it("rejects an out-of-range slot", () => {
    expect(() => writePatternBodyIntoAllpat(baseFor(0), -1, body(0))).toThrow(
      E2AllpatError
    );
    expect(() =>
      writePatternBodyIntoAllpat(baseFor(0), ALLPAT_PATTERN_COUNT, body(0))
    ).toThrow(/out of range/);
  });

  it("rejects a wrong-size body", () => {
    expect(() =>
      writePatternBodyIntoAllpat(baseFor(0), 0, new Uint8Array(100))
    ).toThrow(/must be 16384 bytes/);
  });

  it("rejects a too-small base container", () => {
    const tooSmall = new Uint8Array(0x10100); // no room for slot 0's body
    expect(() => writePatternBodyIntoAllpat(tooSmall, 0, body(1))).toThrow(
      /too small/
    );
  });
});

describe("writePatternBodiesIntoAllpat (all-or-nothing)", () => {
  it("writes multiple slots", () => {
    const base = baseFor(5);
    const out = writePatternBodiesIntoAllpat(base, [
      { index: 0, body: body(0x11) },
      { index: 5, body: body(0x22) },
    ]);
    expect(out[allpatSlotOffset(0)]).toBe(0x11);
    expect(out[allpatSlotOffset(5)]).toBe(0x22);
    // an untouched slot in between keeps the base fill
    expect(out[allpatSlotOffset(3)]).toBe(0xaa);
  });

  it("rejects duplicate slots and never partially patches on error", () => {
    const base = baseFor(2);
    expect(() =>
      writePatternBodiesIntoAllpat(base, [
        { index: 1, body: body(0x11) },
        { index: 1, body: body(0x22) },
      ])
    ).toThrow(/duplicate slot 1/);
    // a bad body in the list aborts before any write
    const before = base.slice();
    expect(() =>
      writePatternBodiesIntoAllpat(base, [
        { index: 0, body: body(0x11) },
        { index: 2, body: new Uint8Array(10) },
      ])
    ).toThrow(/body must be/);
    expect([...base]).toEqual([...before]); // base untouched
  });
});

describe("isFullAllpatContainer", () => {
  it("true only when all 250 slots fit", () => {
    expect(isFullAllpatContainer(baseFor(ALLPAT_PATTERN_COUNT - 1))).toBe(true);
    expect(isFullAllpatContainer(baseFor(10))).toBe(false);
  });
});
