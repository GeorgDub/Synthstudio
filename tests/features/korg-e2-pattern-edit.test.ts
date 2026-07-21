import { describe, it, expect } from "vitest";
import {
  setStepField,
  setPartField,
  setPatternBpm,
  setPatternName,
} from "../../client/src/utils/korg/e2PatternEdit";
import {
  decodePatternBody,
  PART_TABLE_OFFSET,
  PART_STRIDE,
  PART_SEQ_OFFSET,
  PART_SEQ_STEP_SIZE,
  STEP_MOTION_OFFSET,
} from "../../client/src/utils/korg/e2Sysex";

function mkBody(): Uint8Array {
  const b = new Uint8Array(0x4000);
  // step length code 3 → 64 steps
  b[0x25] = 3;
  // bpm 120.0 → 1200
  b[0x22] = 1200 & 0xff;
  b[0x23] = 1200 >> 8;
  return b;
}
const stepBase = (part: number, step: number) =>
  PART_TABLE_OFFSET +
  part * PART_STRIDE +
  PART_SEQ_OFFSET +
  step * PART_SEQ_STEP_SIZE;

describe("setStepField (non-destructive, verified offsets)", () => {
  it("activates a step + sets note/velocity/gate and round-trips via decode", () => {
    let body = mkBody();
    body = setStepField(body, 2, 5, "active", 1);
    body = setStepField(body, 2, 5, "note", 60);
    body = setStepField(body, 2, 5, "velocity", 100);
    body = setStepField(body, 2, 5, "gate", 1);
    body = setStepField(body, 2, 5, "gateLen", 12);
    const dec = decodePatternBody(body);
    const step = dec.parts[2].steps[5];
    expect(step.active).toBe(true);
    expect(step.note).toBe(60);
    expect(step.velocity).toBe(100);
    expect(step.gate).toBe(true);
    expect(step.gateLen).toBe(12);
  });

  it("preserves the opaque motion bytes when editing a step", () => {
    let body = mkBody();
    // seed motion bytes at part 0 / step 0
    const mBase = stepBase(0, 0) + STEP_MOTION_OFFSET;
    for (let i = 0; i < 7; i++) body[mBase + i] = 0x40 + i;
    body = setStepField(body, 0, 0, "velocity", 77);
    for (let i = 0; i < 7; i++) expect(body[mBase + i]).toBe(0x40 + i);
    expect(decodePatternBody(body).parts[0].steps[0].velocity).toBe(77);
  });

  it("ignores out-of-range part/step (edge case)", () => {
    const body = mkBody();
    expect(setStepField(body, 99, 0, "note", 1)).toEqual(body);
    expect(setStepField(body, 0, 999, "note", 1)).toEqual(body);
  });
});

describe("setPartField", () => {
  it("sets volume/pan (clamped 0..127) and round-trips", () => {
    let body = mkBody();
    body = setPartField(body, 4, "volume", 200); // clamps to 127
    body = setPartField(body, 4, "pan", 64);
    const dec = decodePatternBody(body);
    expect(dec.parts[4].volume).toBe(127);
    expect(dec.parts[4].pan).toBe(64);
  });

  it("sets sampleRef as u16 LE", () => {
    const body = setPartField(mkBody(), 0, "sampleRef", 519);
    expect(decodePatternBody(body).parts[0].sampleRef).toBe(519);
  });
});

describe("setPatternBpm + setPatternName", () => {
  it("writes bpm×10 and decodes back to the float", () => {
    const body = setPatternBpm(mkBody(), 128);
    expect(decodePatternBody(body).bpm).toBe(128);
  });

  it("clamps bpm to the device range", () => {
    expect(decodePatternBody(setPatternBpm(mkBody(), 5)).bpm).toBe(20); // min 200/10
    expect(decodePatternBody(setPatternBpm(mkBody(), 999)).bpm).toBe(300); // max 3000/10
  });

  it("sets the pattern name (16 chars, space-padded)", () => {
    const body = setPatternName(mkBody(), "ACID");
    expect(decodePatternBody(body).name).toBe("ACID");
  });
});
