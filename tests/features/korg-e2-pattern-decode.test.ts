import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  decodePatternBody,
  decodeStep,
} from "../../client/src/utils/korg/e2Sysex";
import { buildE2PatternBody } from "../../client/src/utils/e2sExport";

// Verified step layout (e2sExport writer + data analysis of stock-init + testbank):
//   step record (0x0C): [0]=trigger [1]=note [2]=velocity [3]=gate [4]=gateLen
describe("decodeStep", () => {
  it("decodes an active step record (real testbank tuple)", () => {
    // 01 48 50 01 3D 00... — the exact bytes observed in synthstudio-testbank
    const rec = Uint8Array.from([
      0x01, 0x48, 0x50, 0x01, 0x3d, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const s = decodeStep(rec, 0);
    expect(s.active).toBe(true);
    expect(s.note).toBe(0x48);
    expect(s.velocity).toBe(0x50);
    expect(s.gate).toBe(true);
    expect(s.gateLen).toBe(0x3d);
  });

  it("decodes the inactive/default step template (00 48 60 ...)", () => {
    const rec = Uint8Array.from([0x00, 0x48, 0x60, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const s = decodeStep(rec, 0);
    expect(s.active).toBe(false);
    expect(s.velocity).toBe(0x60);
  });
});

describe("decodePatternBody — round-trip against the e2sExport writer", () => {
  const body = buildE2PatternBody({
    name: "REVTEST",
    bpm: 128,
    stepLength: 16,
    parts: [
      {
        sampleId: 501,
        volume: 100,
        steps: [
          { active: true, note: 60, velocity: 80 },
          { active: false },
          { active: true, note: 67, velocity: 110 },
        ],
      },
    ],
  });
  const dec = decodePatternBody(body);

  it("recovers name, bpm and step-length", () => {
    expect(dec.name).toBe("REVTEST");
    expect(dec.bpm).toBeCloseTo(128, 1);
    expect(dec.stepLength).toBe(16);
    expect(dec.parts).toHaveLength(16);
  });

  it("recovers part 0 config + active steps", () => {
    const p0 = dec.parts[0];
    expect(p0.sampleRef).toBe(501);
    expect(p0.volume).toBe(100);
    expect(p0.steps).toHaveLength(16);
    expect(p0.steps[0]).toMatchObject({ active: true, note: 60, velocity: 80 });
    expect(p0.steps[1].active).toBe(false);
    expect(p0.steps[2]).toMatchObject({
      active: true,
      note: 67,
      velocity: 110,
    });
    expect(p0.activeCount).toBe(2);
  });

  it("decodes 32/64 step-length codes", () => {
    const b32 = buildE2PatternBody({
      name: "X",
      bpm: 120,
      stepLength: 32,
      parts: [],
    });
    expect(decodePatternBody(b32).stepLength).toBe(32);
    const b64 = buildE2PatternBody({
      name: "X",
      bpm: 120,
      stepLength: 64,
      parts: [],
    });
    expect(decodePatternBody(b64).stepLength).toBe(64);
  });
});

describe("decodePatternBody — decodes the real committed testbank", () => {
  const path = fileURLToPath(
    new URL(
      "../../examples/e2s/synthstudio-testbank.e2sallpat",
      import.meta.url
    )
  );
  const file = new Uint8Array(readFileSync(path));
  const PAT_OFF = 0x10100;
  const PAT_LEN = 0x4000;

  function patternBody(i: number): Uint8Array {
    return file.subarray(PAT_OFF + i * PAT_LEN, PAT_OFF + (i + 1) * PAT_LEN);
  }

  it("finds real active steps with plausible velocities across the bank", () => {
    let totalActive = 0;
    const velocities = new Set<number>();
    for (let i = 0; i < 250; i++) {
      const dec = decodePatternBody(patternBody(i));
      for (const part of dec.parts) {
        for (const step of part.steps) {
          if (step.active) {
            totalActive++;
            velocities.add(step.velocity);
            // Active steps observed in the testbank all use note 0x48 and gate on.
            expect(step.note).toBe(0x48);
            expect(step.gate).toBe(true);
          }
        }
      }
    }
    expect(totalActive).toBeGreaterThan(0);
    // velocities span the observed set (0x50, 0x5F, 0x64, 0x6E) — all valid 0..127
    for (const v of velocities)
      (expect(v).toBeGreaterThan(0), expect(v).toBeLessThanOrEqual(127));
  });
});
