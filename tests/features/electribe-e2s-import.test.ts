import { describe, it, expect } from "vitest";
import { e2sAllpatToImportResult } from "../../client/src/utils/imports/electribeImport";
import {
  writePatternBodyIntoAllpat,
  allpatMinSizeFor,
  ALLPAT_PATTERN_COUNT,
} from "../../client/src/utils/korg/e2AllpatBuild";
import {
  PATTERN_NAME_OFFSET,
  PART_TABLE_OFFSET,
  PART_STRIDE,
  PART_OSC_REF_OFFSET,
  PART_SEQ_OFFSET,
  PART_SEQ_STEP_SIZE,
  PATTERN_BPM_OFFSET,
  PATTERN_STEPLEN_OFFSET,
} from "../../client/src/utils/korg/e2Sysex";

const ALLPAT_OFF = 0x10100;
const STRIDE = 0x4000;

// Build a 0x4000 body with a name, bpm, and one active step on part `part`.
function makeBody(
  name: string,
  opts: {
    part?: number;
    step?: number;
    note?: number;
    vel?: number;
    osc?: number;
  } = {}
): Uint8Array {
  const b = new Uint8Array(STRIDE);
  for (let i = 0; i < name.length; i++)
    b[PATTERN_NAME_OFFSET + i] = name.charCodeAt(i);
  b[PATTERN_STEPLEN_OFFSET] = 0; // 16 steps
  b[PATTERN_BPM_OFFSET] = 1280 & 0xff;
  b[PATTERN_BPM_OFFSET + 1] = 1280 >> 8; // 128.0 bpm
  if (opts.part !== undefined) {
    const base = PART_TABLE_OFFSET + opts.part * PART_STRIDE;
    if (opts.osc) {
      b[base + PART_OSC_REF_OFFSET] = opts.osc & 0xff;
      b[base + PART_OSC_REF_OFFSET + 1] = (opts.osc >> 8) & 0xff;
    }
    const s = base + PART_SEQ_OFFSET + (opts.step ?? 0) * PART_SEQ_STEP_SIZE;
    b[s + 0] = 1; // trigger
    b[s + 1] = opts.note ?? 0x48;
    b[s + 2] = opts.vel ?? 100;
    b[s + 3] = 1; // gate
  }
  return b;
}

// Wrap bodies into an allpat container at their slot offsets.
function makeAllpat(bodies: Record<number, Uint8Array>): Uint8Array {
  const maxSlot = Math.max(...Object.keys(bodies).map(Number), 0);
  const buf = new Uint8Array(ALLPAT_OFF + (maxSlot + 1) * STRIDE);
  for (const [slot, body] of Object.entries(bodies)) {
    buf.set(body, ALLPAT_OFF + Number(slot) * STRIDE);
  }
  return buf;
}

describe("e2sAllpatToImportResult", () => {
  it("decodes real steps from an allpat (not heuristics)", () => {
    const buf = makeAllpat({
      0: makeBody("ACID", { part: 0, step: 3, vel: 111, osc: 519 }),
    });
    const res = e2sAllpatToImportResult(buf, "bank.e2sallpat");
    expect(res.sourceFormat).toBe("elst");
    expect(res.patterns.length).toBeGreaterThanOrEqual(1);
    const p = res.patterns[0];
    expect(p.name).toBe("ACID");
    expect(p.bpm).toBe(128);
    expect(p.stepCount).toBe(16);
    // the active step is real, with its velocity
    expect(p.parts[0].steps[3].active).toBe(true);
    expect(p.parts[0].steps[3].velocity).toBe(111);
    // osc ref surfaced as a sample label
    expect(p.parts[0].name).toBe("#519");
  });

  it("skips empty/init patterns but keeps content-bearing ones", () => {
    const buf = makeAllpat({
      0: new Uint8Array(STRIDE), // empty init
      1: makeBody("REAL", { part: 2, step: 0 }),
      2: new Uint8Array(STRIDE), // empty init
    });
    const res = e2sAllpatToImportResult(buf, "bank.e2sallpat");
    // only the one with content is kept
    expect(res.patterns).toHaveLength(1);
    expect(res.patterns[0].name).toBe("REAL");
  });

  it("decodes a single .e2spat (0x100 header + body)", () => {
    const body = makeBody("SINGLE", { part: 0, step: 1, vel: 90 });
    const withHeader = new Uint8Array(0x100 + STRIDE);
    withHeader.set(body, 0x100);
    const res = e2sAllpatToImportResult(withHeader, "one.e2spat");
    expect(res.patterns[0].name).toBe("SINGLE");
    expect(res.patterns[0].parts[0].steps[1].active).toBe(true);
    expect(res.patterns[0].parts[0].steps[1].velocity).toBe(90);
  });

  it("falls back to pattern 0 when everything is empty (not silently empty)", () => {
    const buf = makeAllpat({ 0: new Uint8Array(STRIDE) });
    const res = e2sAllpatToImportResult(buf, "empty.e2sallpat");
    expect(res.patterns).toHaveLength(1);
  });

  it("bank export ↔ import agree on container geometry (slot 5 round-trips)", () => {
    // A full-size base bank (all 250 slots), then write one body into slot 5
    // via the exporter, and read it back via the importer.
    const base = new Uint8Array(allpatMinSizeFor(ALLPAT_PATTERN_COUNT - 1));
    const body = makeBody("SLOT5", { part: 1, step: 7, vel: 88, osc: 600 });
    const out = writePatternBodyIntoAllpat(base, 5, body);
    const res = e2sAllpatToImportResult(out, "roundtrip.e2sallpat");
    // exactly the one written slot has content
    expect(res.patterns).toHaveLength(1);
    expect(res.patterns[0].name).toBe("SLOT5");
    expect(res.patterns[0].parts[1].steps[7]).toMatchObject({
      active: true,
      velocity: 88,
    });
    expect(res.patterns[0].parts[1].name).toBe("#600");
  });
});
