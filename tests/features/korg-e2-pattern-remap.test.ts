import { describe, it, expect } from "vitest";
import {
  remapOscRefsInBody,
  remapOscRefsInAllpat,
  collectAllpatOscRefs,
  buildFactoryShiftMap,
  ALLPAT_PATTERN_OFFSET,
  ALLPAT_PATTERN_STRIDE,
} from "../../client/src/utils/korg/e2PatternRemap";
import {
  PART_TABLE_OFFSET,
  PART_STRIDE,
  PART_OSC_REF_OFFSET,
} from "../../client/src/utils/korg/e2Sysex";

// osc-ref offset for part k inside a single body
const bodyPartOff = (k: number) =>
  PART_TABLE_OFFSET + k * PART_STRIDE + PART_OSC_REF_OFFSET;
// osc-ref offset for pattern i / part k inside an allpat container
const allpatPartOff = (i: number, k: number) =>
  ALLPAT_PATTERN_OFFSET +
  i * ALLPAT_PATTERN_STRIDE +
  PART_TABLE_OFFSET +
  k * PART_STRIDE +
  PART_OSC_REF_OFFSET;

function setU16(buf: Uint8Array, off: number, v: number) {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
}
function getU16(buf: Uint8Array, off: number) {
  return buf[off] | (buf[off + 1] << 8);
}

describe("remapOscRefsInBody", () => {
  it("rewrites mapped part osc refs, leaves the rest (non-destructive)", () => {
    const body = new Uint8Array(0x4000);
    setU16(body, bodyPartOff(0), 20); // factory → will remap
    setU16(body, bodyPartOff(1), 5); // synth → unmapped
    setU16(body, bodyPartOff(2), 600); // user → unmapped
    const out = remapOscRefsInBody(body, new Map([[20, 520]]));
    expect(getU16(out, bodyPartOff(0))).toBe(520);
    expect(getU16(out, bodyPartOff(1))).toBe(5);
    expect(getU16(out, bodyPartOff(2))).toBe(600);
    // original untouched
    expect(getU16(body, bodyPartOff(0))).toBe(20);
  });

  it("accepts a plain-object mapping too", () => {
    const body = new Uint8Array(0x4000);
    setU16(body, bodyPartOff(3), 42);
    const out = remapOscRefsInBody(body, { 42: 542 });
    expect(getU16(out, bodyPartOff(3))).toBe(542);
  });
});

describe("remapOscRefsInAllpat + collectAllpatOscRefs", () => {
  // buffer covering pattern 0 fully (0x10100 + 0x4000)
  const size = ALLPAT_PATTERN_OFFSET + ALLPAT_PATTERN_STRIDE + 0x100;

  it("collects distinct used oscs across parts (sorted)", () => {
    const buf = new Uint8Array(size);
    setU16(buf, allpatPartOff(0, 0), 300);
    setU16(buf, allpatPartOff(0, 1), 18);
    setU16(buf, allpatPartOff(0, 2), 300); // duplicate
    const refs = collectAllpatOscRefs(buf);
    expect(refs).toContain(18);
    expect(refs).toContain(300);
    expect(refs.filter(x => x === 300)).toHaveLength(1); // distinct
    // sorted ascending
    expect([...refs]).toEqual([...refs].sort((a, b) => a - b));
  });

  it("remaps osc refs across the container", () => {
    const buf = new Uint8Array(size);
    setU16(buf, allpatPartOff(0, 0), 300);
    setU16(buf, allpatPartOff(0, 5), 301);
    const out = remapOscRefsInAllpat(
      buf,
      new Map([
        [300, 800],
        [301, 801],
      ])
    );
    expect(getU16(out, allpatPartOff(0, 0))).toBe(800);
    expect(getU16(out, allpatPartOff(0, 5))).toBe(801);
  });
});

describe("buildFactoryShiftMap", () => {
  it("shifts factory samples into the user range from 500+offset, keeps synth/user", () => {
    const { mapping, overflow } = buildFactoryShiftMap(
      [5, 18, 20, 400, 600],
      18
    );
    // synth (5) and user (600) are not in the map (identity)
    expect(mapping.has(5)).toBe(false);
    expect(mapping.has(600)).toBe(false);
    // factory 18,20,400 assigned sequentially from 518
    expect(mapping.get(18)).toBe(518);
    expect(mapping.get(20)).toBe(519);
    expect(mapping.get(400)).toBe(520);
    expect(overflow).toEqual([]);
  });

  it("flags overflow when the user range is exhausted (no silent wrap)", () => {
    // all 483 factory slots (18..500) with offset 18 → start 518,
    // user slots 518..999 = 482 available → exactly 1 overflow.
    const all: number[] = [];
    for (let i = 18; i <= 500; i++) all.push(i);
    const { mapping, overflow } = buildFactoryShiftMap(all, 18);
    expect(mapping.size).toBe(482);
    expect(overflow.length).toBe(1);
    expect(overflow[0]).toBe(500); // the highest factory osc misses out
  });

  it("default offset is 18 (start slot 518)", () => {
    const { mapping } = buildFactoryShiftMap([100]);
    expect(mapping.get(100)).toBe(518);
  });
});
