/**
 * tests/features/e2s-bank-generate.test.ts
 *
 * v3.271.0 — Generates a real multi-pattern .e2sallpat bank through the FULL
 * production pipeline (PatternData → convertSynthstudioPatternToE2 →
 * buildE2AllPatFile) and verifies it end-to-end:
 *   - exact size + KORG/e2sampler/GLST/PTST markers
 *   - prefix byte-identical to the real factory bank (if present)
 *   - parse-back via parseElectribeAllPatBank: names, BPM, step-length, triggers
 *
 * Side effect: (re)generates the committed example bank at
 * "<repo>/examples/e2s/synthstudio-testbank.e2sallpat" (deterministic — same
 * bytes every run, so no spurious git diffs). It also drops a convenience copy
 * into the (gitignored) "Korg e2s files/" folder next to the user's real files
 * for the hardware test. Both writes are best-effort; the in-memory
 * verification always runs.
 *
 * NOTE: samples are NOT transferred (separate .all path). On hardware these
 * patterns trigger whatever samples occupy the destination part slots — test
 * against a bank with samples loaded.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import type { PatternData, PartData, StepData } from "../../client/src/audio/AudioEngine";
import { convertSynthstudioPatternToE2 } from "../../client/src/utils/electribePatternConvert";
import { buildE2AllPatFile, E2S_ALLPAT_FILE_SIZE, E2S_ALLPAT_PREFIX_SIZE } from "../../client/src/utils/e2sExport";
import { parseElectribeAllPatBank } from "../../client/src/utils/electribeImport";

// ─── Pattern construction helpers ─────────────────────────────────────────────

/** Build a 16-part PatternData. `tracks` maps part index → trigger step indices. */
function makePattern(
  name: string,
  bpm: number,
  stepCount: 16 | 32 | 64,
  tracks: Record<number, { name: string; hits: number[]; velocity?: number }>,
): PatternData {
  const parts: PartData[] = Array.from({ length: 16 }, (_, idx) => {
    const track = tracks[idx];
    const steps: StepData[] = Array.from({ length: stepCount }, (_, s) => {
      const active = !!track && track.hits.includes(s);
      const step: StepData = { active };
      if (active && track?.velocity != null) step.velocity = track.velocity;
      return step;
    });
    return {
      id: `${name}-part-${idx}`,
      name: track?.name ?? `Part ${idx + 1}`,
      muted: false,
      soloed: false,
      volume: 0.85,
      pan: 0,
      steps,
    };
  });

  return {
    id: `pat-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    stepCount,
    stepResolution: "1/16",
    bpm,
    parts,
  };
}

/** Eight recognizable drum patterns (part 0=kick, 1=snare, 2=closed hat, 3=clap). */
function buildTestPatterns(): PatternData[] {
  const K = (hits: number[]) => ({ name: "Kick", hits, velocity: 110 });
  const S = (hits: number[]) => ({ name: "Snare", hits, velocity: 100 });
  const H = (hits: number[]) => ({ name: "Hat", hits, velocity: 80 });
  const C = (hits: number[]) => ({ name: "Clap", hits, velocity: 95 });

  return [
    makePattern("4 On Floor", 128, 16, {
      0: K([0, 4, 8, 12]),
      1: S([4, 12]),
      2: H([0, 2, 4, 6, 8, 10, 12, 14]),
    }),
    makePattern("Backbeat", 120, 16, {
      0: K([0, 8]),
      1: S([4, 12]),
      2: H([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    }),
    makePattern("Offbeat Clap", 124, 16, {
      0: K([0, 4, 8, 12]),
      3: C([2, 6, 10, 14]),
      2: H([1, 3, 5, 7, 9, 11, 13, 15]),
    }),
    makePattern("Breakbeat", 170, 16, {
      0: K([0, 10]),
      1: S([4, 12]),
      2: H([0, 2, 4, 6, 8, 10, 12, 14]),
    }),
    makePattern("Techno 32", 132, 32, {
      0: K([0, 4, 8, 12, 16, 20, 24, 28]),
      1: S([8, 24]),
      2: H([2, 6, 10, 14, 18, 22, 26, 30]),
      3: C([12, 28]),
    }),
    makePattern("Half Time", 75, 16, {
      0: K([0]),
      1: S([8]),
      2: H([0, 4, 8, 12]),
    }),
    makePattern("Rolling Fill", 140, 16, {
      0: K([0, 4]),
      1: S([8, 9, 10, 11, 12, 13, 14, 15]),
      2: H([0, 2, 4, 6]),
    }),
    makePattern("Sparse Dub", 90, 16, {
      0: K([0, 6, 11]),
      3: C([4]),
    }),
  ];
}

// ─── Test ───────────────────────────────────────────────────────────────────

const REAL_FILES_DIR = path.resolve(process.cwd(), "Korg e2s files");
const REAL_BANK = path.join(REAL_FILES_DIR, "e2s-2016.e2sallpat");

// Committed, reproducible example output (not gitignored).
const EXAMPLE_DIR = path.resolve(process.cwd(), "examples", "e2s");
const EXAMPLE_FILE = path.join(EXAMPLE_DIR, "synthstudio-testbank.e2sallpat");
// Convenience copy next to the user's real files (gitignored dir).
const CONVENIENCE_FILE = path.join(REAL_FILES_DIR, "synthstudio-testbank.e2sallpat");

describe("e2sExport — generate & verify a real multi-pattern bank", () => {
  const patterns = buildTestPatterns();
  const e2Inputs = patterns.map((p) => convertSynthstudioPatternToE2(p, { globalBpm: 120 }));
  const buffer = buildE2AllPatFile(e2Inputs);
  const bytes = new Uint8Array(buffer);

  it("produces a valid, exact-size bank", () => {
    expect(patterns.length).toBe(8);
    expect(bytes.byteLength).toBe(E2S_ALLPAT_FILE_SIZE);
    expect([...bytes.slice(0, 4)]).toEqual([0x4b, 0x4f, 0x52, 0x47]); // KORG
    expect([...bytes.slice(0x100, 0x104)]).toEqual([0x47, 0x4c, 0x53, 0x54]); // GLST
    expect([...bytes.slice(0x10100, 0x10104)]).toEqual([0x50, 0x54, 0x53, 0x54]); // PTST
  });

  it("round-trips all 8 patterns through parseElectribeAllPatBank", () => {
    const bank = parseElectribeAllPatBank(bytes);
    expect(bank.patterns.length).toBe(250);

    // Each generated pattern lands in slots 0..7 with correct metadata.
    patterns.forEach((src, i) => {
      const parsed = bank.patterns[i];
      expect(parsed.name).toBe(src.name);
      expect(parsed.bpm).toBeCloseTo(src.bpm, 1);
      expect(parsed.stepLength).toBe(src.stepCount);
    });

    // Spot-check triggers: "4 On Floor" kick on 0/4/8/12, hat on evens.
    const floor = bank.patterns[0];
    expect(floor.parts[0].steps[0].active).toBe(true);
    expect(floor.parts[0].steps[4].active).toBe(true);
    expect(floor.parts[0].steps[8].active).toBe(true);
    expect(floor.parts[0].steps[12].active).toBe(true);
    expect(floor.parts[0].steps[1].active).toBe(false);
    expect(floor.parts[2].steps[2].active).toBe(true); // hat
    expect(floor.parts[1].steps[4].active).toBe(true); // snare

    // "Techno 32" is a 32-step pattern, kick every 4.
    const techno = bank.patterns[4];
    expect(techno.stepLength).toBe(32);
    expect(techno.parts[0].steps[16].active).toBe(true);
    expect(techno.parts[0].steps[28].active).toBe(true);

    // Unused slots (8..249) parse as factory init patterns.
    expect(bank.patterns[8].name).toBe("Init Pattern");
    expect(bank.patterns[249].name).toBe("Init Pattern");
  });

  it("prefix is byte-identical to the real factory bank (if present)", () => {
    if (!fs.existsSync(REAL_BANK)) return; // CI / fresh clone — skip
    const real = new Uint8Array(fs.readFileSync(REAL_BANK));
    for (let i = 0; i < E2S_ALLPAT_PREFIX_SIZE; i++) {
      if (bytes[i] !== real[i]) {
        throw new Error(`prefix diff at 0x${i.toString(16)}: built=${bytes[i]} real=${real[i]}`);
      }
    }
  });

  it("writes the committed example bank (deterministic)", () => {
    try {
      fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
      fs.writeFileSync(EXAMPLE_FILE, bytes);
      expect(fs.statSync(EXAMPLE_FILE).size).toBe(E2S_ALLPAT_FILE_SIZE);
    } catch {
      // Non-fatal: in-memory verification above is the real assertion.
    }
  });

  it("drops a convenience copy next to the user's real files (best-effort)", () => {
    try {
      if (!fs.existsSync(REAL_FILES_DIR)) return; // not present on CI
      fs.writeFileSync(CONVENIENCE_FILE, bytes);
    } catch {
      // Non-fatal.
    }
  });
});
